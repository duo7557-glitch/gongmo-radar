-- 기존 schema.sql, rate-limit.sql 이후 실행. 기존 공모주·채팅 데이터는 보존합니다.
alter table public.ipo_listings alter column score drop not null;
alter table public.ipo_listings alter column score drop default;
alter table public.ipo_listings add column if not exists score_status text not null default 'manual';
alter table public.ipo_listings add column if not exists source_key text;
alter table public.ipo_listings add column if not exists dart_corp_code text;
alter table public.ipo_listings add column if not exists dart_receipt_no text;
alter table public.ipo_listings add column if not exists payment_date date;
alter table public.ipo_listings add column if not exists source_payload jsonb;
create unique index if not exists ipo_listings_source_key_idx on public.ipo_listings(source_key);

create table if not exists public.ipo_sync_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  summary jsonb not null default '{}'
);
alter table public.ipo_sync_runs enable row level security;
revoke all on public.ipo_sync_runs from anon, authenticated;
grant all on public.ipo_sync_runs to service_role;
grant usage, select on sequence public.ipo_sync_runs_id_seq to service_role;

-- Serialize scheduler/manual starts so two collectors cannot race and overwrite revisions.
create or replace function public.claim_ipo_sync() returns bigint
language plpgsql security definer set search_path = public as $$
declare run_id bigint;
begin
  if not pg_try_advisory_xact_lock(hashtext('gongmo-ipo-sync')) then return null; end if;
  if exists(select 1 from public.ipo_sync_runs where status = 'running' and started_at > now() - interval '10 minutes') then return null; end if;
  insert into public.ipo_sync_runs(status) values ('running') returning id into run_id;
  return run_id;
end $$;
revoke all on function public.claim_ipo_sync() from public, anon, authenticated;
grant execute on function public.claim_ipo_sync() to service_role;

create or replace function public.keep_latest_ipo_revision() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.dart_receipt_no is not null and new.dart_receipt_no is not null and old.dart_receipt_no > new.dart_receipt_no then return null; end if;
  return new;
end $$;
drop trigger if exists keep_latest_ipo_revision_trg on public.ipo_listings;
create trigger keep_latest_ipo_revision_trg before update on public.ipo_listings for each row execute function public.keep_latest_ipo_revision();
grant select on public.ipo_listings to anon, authenticated;
grant all on public.ipo_listings to service_role;

create table if not exists public.chat_reports (
  id bigint generated always as identity primary key,
  message_id bigint not null references public.chat_messages(id),
  reason text not null check (reason in ('spam', 'abuse', 'misinformation', 'other')),
  reporter_hash text not null,
  created_at timestamptz not null default now(),
  unique(message_id, reporter_hash)
);
alter table public.chat_reports enable row level security;
revoke all on public.chat_reports from anon, authenticated;
grant insert(message_id, reason) on public.chat_reports to anon, authenticated;
grant usage on sequence public.chat_reports_id_seq to anon, authenticated;
grant all on public.chat_reports to service_role;
drop policy if exists "submit reports" on public.chat_reports;
create policy "submit reports" on public.chat_reports for insert to anon, authenticated with check (true);

create or replace function public.chat_report_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- rate-limit.sql의 접속자 해시를 재사용합니다.
  new.reporter_hash := public.chat_client_hash();
  perform pg_advisory_xact_lock(hashtext('gongmo-report:' || new.reporter_hash));
  new.created_at := now();
  if (select count(*) from public.chat_reports where reporter_hash = new.reporter_hash and created_at > now() - interval '1 minute') >= 3 then
    raise exception 'report_rate_limited';
  end if;
  return new;
end $$;
drop trigger if exists chat_report_guard_trg on public.chat_reports;
create trigger chat_report_guard_trg before insert on public.chat_reports for each row execute function public.chat_report_guard();
