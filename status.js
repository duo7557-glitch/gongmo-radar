(() => {
  const contactLink = document.querySelector('.footer-links a[href^="mailto:"]');
  if (contactLink) contactLink.href = '#contact';
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
  if (!cfg.supabaseUrl || !key) { finish('미연결', 'error'); return; }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  fetch(`${cfg.supabaseUrl.replace(/\/$/, '')}/rest/v1/ipo_listings?select=id&limit=1&is_published=eq.true`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store', signal: controller.signal
  }).then(response => finish(response.ok ? 'API 응답' : '확인 필요', response.ok ? '' : 'error'))
    .catch(() => finish('응답 없음', 'error'))
    .finally(() => clearTimeout(timeout));
})();
