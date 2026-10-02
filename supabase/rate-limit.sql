-- 채팅 도배 방지: schema.sql 실행 후 Supabase SQL Editor에서 실행하세요. (여러 번 실행해도 안전)
-- 접속자 단위(IP 솔트 해시) 규칙:
--   1) 5초 안에 3번째 메시지 -> 그 메시지는 버려지고 위반 기록, 이후 차단
--      차단 시간: 10초 -> 30초 -> 1분 -> 2분 -> 5분 -> 10분(상한)
--      마지막 위반 후 10분간 조용하면 위반 횟수 초기화
--   2) 10분에 20개 초과 금지
--   3) 60초 안에 같은 내용 반복 금지
--   4) 공백만 있는 메시지 금지
-- 위반 순간에는 예외 대신 NULL을 반환합니다(예외를 던지면 위반 기록도 롤백되기 때문).

alter table public.chat_messages add column if not exists client_hash text;
create index if not exists chat_messages_client_created_idx on public.chat_messages(client_hash, created_at desc);

create table if not exists public.chat_penalties (
  client_hash text primary key,
  strikes int not null default 0,
  blocked_until timestamptz,
  last_strike_at timestamptz
);
alter table public.chat_penalties enable row level security;
revoke all on public.chat_penalties from anon, authenticated;

-- 해시용 서버 비밀값(랜덤 생성, 외부 접근 불가). 해시가 API에 보여도 IP를 역추적할 수 없게 합니다.
create table if not exists public.chat_secret (
  id int primary key default 1 check (id = 1),
  secret text not null default (md5(random()::text || gen_random_uuid()::text) || md5(gen_random_uuid()::text))
);
alter table public.chat_secret enable row level security;
revoke all on public.chat_secret from anon, authenticated;
insert into public.chat_secret default values on conflict do nothing;

create or replace function public.chat_client_hash() returns text
language plpgsql stable security definer set search_path = public as $$
declare
  headers json;
  ip text;
  s text;
begin
  select secret into s from chat_secret where id = 1;
  begin
    headers := current_setting('request.headers', true)::json;
  exception when others then
    headers := null;
  end;
  ip := split_part(coalesce(headers->>'x-forwarded-for', headers->>'cf-connecting-ip', 'unknown'), ',', 1);
  return md5(s || ':' || btrim(ip));
end $$;

-- 브라우저에서 남은 차단 시간(초)을 조회합니다.
create or replace function public.chat_block_remaining() returns int
language sql stable security definer set search_path = public as $$
  select coalesce((
    select greatest(0, ceil(extract(epoch from (blocked_until - now())))::int)
    from chat_penalties where client_hash = public.chat_client_hash()
  ), 0)
$$;
grant execute on function public.chat_block_remaining() to anon, authenticated;

create or replace function public.chat_messages_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  h text := public.chat_client_hash();
  p chat_penalties%rowtype;
  steps int[] := array[10, 30, 60, 120, 300, 600];
  new_strikes int;
begin
  new.body := btrim(new.body);
  new.display_name := btrim(new.display_name);
  if char_length(new.body) = 0 or char_length(new.display_name) = 0 then
    raise exception 'empty_message' using errcode = 'P0001';
  end if;
  new.client_hash := h;

  select * into p from chat_penalties where client_hash = h;

  if p.blocked_until is not null and p.blocked_until > now() then
    raise exception 'blocked' using errcode = 'P0001';
  end if;

  if (select count(*) from chat_messages where client_hash = h and created_at > now() - interval '5 seconds') >= 2 then
    new_strikes := case when p.last_strike_at is null or p.last_strike_at < now() - interval '10 minutes'
                        then 1 else p.strikes + 1 end;
    insert into chat_penalties(client_hash, strikes, blocked_until, last_strike_at)
    values (h, new_strikes, now() + make_interval(secs => steps[least(new_strikes, array_length(steps, 1))]), now())
    on conflict (client_hash) do update
      set strikes = excluded.strikes, blocked_until = excluded.blocked_until, last_strike_at = excluded.last_strike_at;
    return null; -- 메시지를 버리고 위반 기록은 커밋
  end if;

  if (select count(*) from chat_messages where client_hash = h and created_at > now() - interval '10 minutes') >= 20 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  if exists (select 1 from chat_messages where client_hash = h and body = new.body and created_at > now() - interval '60 seconds') then
    raise exception 'duplicate_message' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists chat_messages_guard_trg on public.chat_messages;
create trigger chat_messages_guard_trg before insert on public.chat_messages
  for each row execute function public.chat_messages_guard();
