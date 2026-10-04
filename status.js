(() => {
  const contact = document.querySelector('#contact');
  document.querySelector('#openContact')?.addEventListener('click', () => { if (contact && !contact.open) contact.showModal(); });
  document.querySelector('#closeContact')?.addEventListener('click', () => contact?.close());
  contact?.addEventListener('click', event => { if (event.target === contact) contact.close(); });
  const support = document.querySelector('#supportDialog');
  document.querySelector('#openSupport')?.addEventListener('click', () => support?.showModal());
  document.querySelector('#closeSupport')?.addEventListener('click', () => support?.close());
  support?.addEventListener('click', event => { if (event.target === support) support.close(); });
  document.querySelector('#copySupportAccount')?.addEventListener('click', async () => {
    const account = document.querySelector('#supportAccount')?.textContent?.trim();
    const feedback = document.querySelector('#supportFeedback');
    if (!account || !feedback) return;
    try { await navigator.clipboard.writeText(account); feedback.textContent = '토스뱅크 계좌번호를 복사했습니다.'; }
    catch { feedback.textContent = '계좌번호 복사에 실패했어요. 계좌번호를 직접 선택해 주세요.'; }
  });
  const web = document.querySelector('#webStatus');
  const webLed = document.querySelector('#webStatusLed');
  const api = document.querySelector('#apiStatus');
  const apiLed = document.querySelector('#apiStatusLed');
  const checked = document.querySelector('#statusCheckedAt');
  const freshness = document.querySelector('#ipoFreshness');
  const setFreshness = (label, state) => {
    for (const element of [checked, freshness]) if (element) { element.dataset.state = state; element.textContent = label; }
  };
  if (web && webLed) { web.textContent = '응답 중'; webLed.classList.remove('pending', 'error'); }
  if (!api || !apiLed) return;

  const finish = (label, state) => {
    api.textContent = label;
    apiLed.classList.remove('pending', 'error');
    if (state) apiLed.classList.add(state);
    if (checked) checked.textContent = `마지막 확인 ${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`;
  };
  const cfg = window.GONGMO_CONFIG || {};
  const key = cfg.supabasePublishableKey || cfg.supabaseAnonKey;
  if (!cfg.supabaseUrl || !key) { finish('미연결', 'error'); setFreshness('갱신 이력 연결 필요', 'warning'); return; }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const base = cfg.supabaseUrl.replace(/\/$/, '');
  const apiCheck = fetch(`${base}/rest/v1/ipo_listings?select=id&limit=1&is_published=eq.true`, {
    headers, cache: 'no-store', signal: controller.signal
  }).then(response => { finish(response.ok ? 'API 응답' : '확인 필요', response.ok ? '' : 'error'); return response.ok; })
    .catch(() => { finish('응답 없음', 'error'); return false; });
  const syncCheck = fetch(`${base}/rest/v1/rpc/public_ipo_sync_status`, {
    method: 'POST', headers, body: '{}', cache: 'no-store', signal: controller.signal
  }).then(async response => response.ok ? response.json() : null).catch(() => null);
  Promise.all([apiCheck, syncCheck]).then(([, rows]) => {
    if (!checked) return;
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row?.last_finished_at) {
      setFreshness('갱신 이력 연결 필요', 'warning');
      return;
    }
    const updated = new Date(row.last_finished_at), age = Date.now() - updated.getTime();
    const when = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(updated);
    const stale = age > 12 * 60 * 60 * 1000;
    const failed = row.last_status === 'failed';
    const review = row.last_status === 'needs_review';
    setFreshness(`데이터 ${when} 갱신${failed ? ' · 최근 수집 실패' : stale ? ' · 갱신 지연' : review ? ' · 검토 필요' : ' · 정상'}`, failed ? 'error' : stale || review ? 'warning' : 'ok');
  }).finally(() => clearTimeout(timeout));
})();
