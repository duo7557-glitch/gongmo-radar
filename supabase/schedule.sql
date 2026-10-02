-- ipo-sync 배포 후, Dashboard > Vault에 gongmo_project_url과 gongmo_sync_secret을 먼저 저장하세요.
-- gongmo_sync_secret 값은 Edge Function secret IPO_SYNC_SECRET과 동일해야 합니다.
-- DART_API_KEY는 Edge Function Secrets에만 저장합니다.
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'gongmo_project_url')
    or not exists (select 1 from vault.decrypted_secrets where name = 'gongmo_sync_secret') then
    raise exception 'Vault에 gongmo_project_url과 gongmo_sync_secret을 먼저 저장해 주세요.';
  end if;
end $$;
-- UTC 03/09/15/21시 = 한국 12/18/00/06시. 월이 바뀌어도 계속 신규·정정 공시를 확인합니다.
select cron.schedule('gongmo-ipo-sync', '0 3,9,15,21 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'gongmo_project_url' limit 1) || '/functions/v1/ipo-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'gongmo_sync_secret' limit 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);
