-- 웹푸시 구독은 전화번호/계정 없이 브라우저가 발급한 endpoint와 키만 보관합니다.
create table if not exists public.ipo_push_subscriptions (
  endpoint text primary key check (char_length(endpoint) between 1 and 2048),
  p256dh text not null check (char_length(p256dh) between 20 and 200),
  auth text not null check (char_length(auth) between 10 and 100),
  ipo_ids text[] not null default '{}',
  schedule jsonb not null default '[]'::jsonb check (jsonb_typeof(schedule) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ipo_push_subscriptions enable row level security;
revoke all on public.ipo_push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on public.ipo_push_subscriptions to service_role;

create table if not exists public.ipo_push_deliveries (
  endpoint text not null references public.ipo_push_subscriptions(endpoint) on delete cascade,
  ipo_id text not null,
  subscription_end date not null,
  slot text not null check (slot in ('eve', 'morning', 'afternoon')),
  sent_at timestamptz not null default now(),
  primary key(endpoint, ipo_id, subscription_end, slot)
);
alter table public.ipo_push_deliveries enable row level security;
revoke all on public.ipo_push_deliveries from public, anon, authenticated;
grant select, insert, delete on public.ipo_push_deliveries to service_role;

create or replace function public.save_ipo_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_ipo_ids text[], p_schedule jsonb
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint) > 2048
     or p_p256dh is null or char_length(p_p256dh) not between 20 and 200
     or p_auth is null or char_length(p_auth) not between 10 and 100
     or coalesce(array_length(p_ipo_ids, 1), 0) > 50
     or jsonb_typeof(p_schedule) <> 'array' or jsonb_array_length(p_schedule) > 3 then
    raise exception 'invalid_push_subscription';
  end if;
  insert into public.ipo_push_subscriptions(endpoint, p256dh, auth, ipo_ids, schedule, updated_at)
  values (p_endpoint, p_p256dh, p_auth, coalesce(p_ipo_ids, '{}'), p_schedule, now())
  on conflict (endpoint) do update set
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    ipo_ids = excluded.ipo_ids,
    schedule = excluded.schedule,
    updated_at = now();
end $$;
revoke all on function public.save_ipo_push_subscription(text, text, text, text[], jsonb) from public;
grant execute on function public.save_ipo_push_subscription(text, text, text, text[], jsonb) to anon, authenticated;

create or replace function public.remove_ipo_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = public, pg_temp as $$
  delete from public.ipo_push_subscriptions where endpoint = p_endpoint;
$$;
revoke all on function public.remove_ipo_push_subscription(text) from public;
grant execute on function public.remove_ipo_push_subscription(text) to anon, authenticated;
