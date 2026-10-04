-- Supabase SQL Editor에서 한 번 실행: 자동 갱신 상태 공개(민감 정보 없이 상태/시각만) + 운영자 신고함.
-- ipo_sync_runs, chat_messages, chat_reports 테이블이 먼저 준비되어 있어야 합니다.

create or replace function public.public_ipo_sync_status()
returns table(last_finished_at timestamptz, last_status text)
language sql
stable
security definer
set search_path = public
as $$
  select r.finished_at, r.status::text
  from public.ipo_sync_runs r
  where r.finished_at is not null
  order by r.finished_at desc, r.id desc
  limit 1
$$;
revoke all on function public.public_ipo_sync_status() from public, anon, authenticated;
grant execute on function public.public_ipo_sync_status() to anon, authenticated;

-- 신고자 해시·IP 정보는 운영자 신고함에 노출하지 않습니다.
grant select on public.chat_messages, public.chat_reports to service_role;
grant update (moderation_status) on public.chat_messages to service_role;
create or replace view public.chat_moderation_queue
with (security_invoker = true)
as
  select m.id as message_id,
         m.created_at as message_created_at,
         m.room,
         m.display_name,
         m.body,
         m.moderation_status,
         count(r.id)::integer as report_count,
         max(r.created_at) as last_reported_at,
         string_agg(distinct case r.reason
           when 'spam' then '도배·광고'
           when 'abuse' then '욕설·괴롭힘'
           when 'misinformation' then '허위 정보·수익 보장'
           else '기타'
         end, ', ') as reasons
  from public.chat_messages m
  join public.chat_reports r on r.message_id = m.id
  group by m.id, m.created_at, m.room, m.display_name, m.body, m.moderation_status;
revoke all on public.chat_moderation_queue from public, anon, authenticated;
grant select on public.chat_moderation_queue to service_role;
