-- 종목토론방(게시판): 종목별 글과 댓글. rate-limit.sql의 chat_client_hash()를 재사용해 도배를 막는다.
-- 실행 순서: schema.sql → rate-limit.sql 이후 SQL Editor에서 한 번 실행. (여러 번 실행해도 안전)

create table if not exists public.stock_posts (
  id bigint generated always as identity primary key,
  stock_code text not null check (char_length(stock_code) between 6 and 12),
  nickname text not null check (char_length(nickname) between 1 and 12),
  title text not null check (char_length(title) between 2 and 60),
  body text not null check (char_length(body) between 2 and 1000),
  views integer not null default 0,
  client_hash text,
  moderation_status text not null default 'visible' check (moderation_status in ('visible', 'hidden')),
  created_at timestamptz not null default now()
);
create index if not exists stock_posts_code_idx on public.stock_posts(stock_code, created_at desc);

create table if not exists public.stock_comments (
  id bigint generated always as identity primary key,
  post_id bigint not null references public.stock_posts(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 12),
  body text not null check (char_length(body) between 1 and 300),
  client_hash text,
  moderation_status text not null default 'visible' check (moderation_status in ('visible', 'hidden')),
  created_at timestamptz not null default now()
);
create index if not exists stock_comments_post_idx on public.stock_comments(post_id, created_at);

alter table public.stock_posts enable row level security;
alter table public.stock_comments enable row level security;

-- 읽기: 공개(숨김 글은 제외). 해시 컬럼은 노출하지 않는다.
revoke all on public.stock_posts from anon, authenticated;
revoke all on public.stock_comments from anon, authenticated;
grant select (id, stock_code, nickname, title, body, views, created_at, moderation_status) on public.stock_posts to anon, authenticated;
grant select (id, post_id, nickname, body, created_at, moderation_status) on public.stock_comments to anon, authenticated;
grant insert (stock_code, nickname, title, body) on public.stock_posts to anon, authenticated;
grant insert (post_id, nickname, body) on public.stock_comments to anon, authenticated;
grant usage on sequence public.stock_posts_id_seq to anon, authenticated;
grant usage on sequence public.stock_comments_id_seq to anon, authenticated;
grant all on public.stock_posts to service_role;
grant all on public.stock_comments to service_role;

drop policy if exists "read visible posts" on public.stock_posts;
create policy "read visible posts" on public.stock_posts for select using (moderation_status = 'visible');
drop policy if exists "read visible comments" on public.stock_comments;
create policy "read visible comments" on public.stock_comments for select using (moderation_status = 'visible');
drop policy if exists "write posts" on public.stock_posts;
create policy "write posts" on public.stock_posts for insert with check (true);
drop policy if exists "write comments" on public.stock_comments;
create policy "write comments" on public.stock_comments for insert with check (true);

-- 조회수: 글 하나를 여는 것만 +1. 숨김 글은 올리지 않는다.
create or replace function public.bump_post_view(post bigint) returns void
language sql security definer set search_path = public as $$
  update stock_posts set views = views + 1 where id = post and moderation_status = 'visible';
$$;
revoke all on function public.bump_post_view(bigint) from public;
grant execute on function public.bump_post_view(bigint) to anon, authenticated;

-- 도배 방지: 글은 10분에 3개, 1분에 1개까지. 댓글은 1분에 5개까지. 빈 내용은 막는다.
create or replace function public.board_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  h text := public.chat_client_hash();
  n integer;
begin
  new.client_hash := h;
  new.nickname := btrim(new.nickname);
  if char_length(btrim(new.body)) = 0 then raise exception 'empty_body' using errcode = 'P0001'; end if;
  if TG_TABLE_NAME = 'stock_posts' then
    if char_length(btrim(new.title)) = 0 then raise exception 'empty_title' using errcode = 'P0001'; end if;
    select count(*) into n from stock_posts where client_hash = h and created_at > now() - interval '10 minutes';
    if n >= 3 then raise exception 'rate_limited' using errcode = 'P0001'; end if;
    if exists (select 1 from stock_posts where client_hash = h and created_at > now() - interval '1 minute') then raise exception 'rate_limited' using errcode = 'P0001'; end if;
  else
    select count(*) into n from stock_comments where client_hash = h and created_at > now() - interval '1 minute';
    if n >= 5 then raise exception 'rate_limited' using errcode = 'P0001'; end if;
  end if;
  return new;
end $$;

drop trigger if exists stock_posts_guard_trg on public.stock_posts;
create trigger stock_posts_guard_trg before insert on public.stock_posts for each row execute function public.board_guard();
drop trigger if exists stock_comments_guard_trg on public.stock_comments;
create trigger stock_comments_guard_trg before insert on public.stock_comments for each row execute function public.board_guard();
