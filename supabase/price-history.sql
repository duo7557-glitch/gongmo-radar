-- 올해 공모 상장주의 상장일~최신 거래일 시세. GitHub Actions(tools/price-history.mjs)가 평일 장 마감 후 갱신한다.
-- 공개 시세 데이터라 누구나 읽을 수 있고, 쓰기는 service_role만 가능하다.
create table if not exists public.ipo_price_history (
  code text primary key,
  name text not null,
  listed_at date not null,
  offer_price integer not null check (offer_price > 0),
  spac boolean not null default false,
  days jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.ipo_price_history enable row level security;
drop policy if exists "public can read price history" on public.ipo_price_history;
create policy "public can read price history" on public.ipo_price_history for select using (true);
revoke all on public.ipo_price_history from anon, authenticated;
grant select on public.ipo_price_history to anon, authenticated;
grant all on public.ipo_price_history to service_role;
