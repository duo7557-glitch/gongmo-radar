-- 공모주 레이더: Supabase SQL Editor에서 한 번 실행하세요.
-- 브라우저에는 anon key만 사용합니다. service_role key는 절대 노출하지 마세요.

create table if not exists public.ipo_listings (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sector text not null default '',
  subscription_start date,
  subscription_end date,
  price_text text not null default '',
  broker text not null default '',
  score smallint not null default 0 check (score between 0 and 100),
  reason text not null default '',
  tags text[] not null default '{}',
  status text not null default '예정' check (status in ('예정', '진행중', '마감', '연기', '철회')),
  source_dart_url text,
  source_kind_url text,
  is_published boolean not null default false,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists ipo_listings_subscription_start_idx on public.ipo_listings(subscription_start);

create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  room text not null default 'lobby' check (char_length(room) between 1 and 40),
  display_name text not null check (char_length(display_name) between 1 and 12),
  body text not null check (char_length(body) between 1 and 160),
  moderation_status text not null default 'visible' check (moderation_status in ('visible', 'hidden', 'pending')),
  created_at timestamptz not null default now()
);

alter table public.ipo_listings enable row level security;
alter table public.chat_messages enable row level security;

-- 방문자는 공개된 공모주 데이터와 visible 채팅만 읽습니다.
create policy "public can read published listings" on public.ipo_listings for select using (is_published = true);
create policy "public can read visible messages" on public.chat_messages for select using (moderation_status = 'visible');

-- MVP용 익명 입력 정책입니다. 공개 운영 전에 CAPTCHA/로그인/Edge Function 기반의 속도 제한을 권장합니다.
create policy "public can submit short chat messages" on public.chat_messages for insert with check (
  moderation_status = 'visible'
  and char_length(display_name) between 1 and 12
  and char_length(body) between 1 and 160
);

-- Supabase Dashboard > Database > Replication에서 chat_messages를 Realtime publication에 추가하세요.
