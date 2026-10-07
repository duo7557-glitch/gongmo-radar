(() => {
  const STORAGE_KEY = 'gongmoRadarOwnerAnalyticsSettings';
  const SCOPE = 'openid email https://www.googleapis.com/auth/analytics.readonly';
  const form = document.querySelector('#settingsForm');
  const clientInput = document.querySelector('#clientId');
  const propertyInput = document.querySelector('#propertyId');
  const emailInput = document.querySelector('#ownerEmail');
  const signInButton = document.querySelector('#signIn');
  const status = document.querySelector('#status');
  const metrics = document.querySelector('#metrics');
  const updatedAt = document.querySelector('#updatedAt');
  let tokenClient;
  let accessToken;

  const readSettings = () => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch { return {}; }
  };

  const setStatus = (message, kind = '') => {
    status.textContent = message;
    status.className = `status ${kind}`.trim();
  };

  const settings = readSettings();
  clientInput.value = settings.clientId || '';
  propertyInput.value = settings.propertyId || '';
  emailInput.value = settings.ownerEmail || '';
  if (settings.clientId && settings.propertyId && settings.ownerEmail) {
    setStatus('설정이 저장됐어요. 본인 Google 계정으로 로그인해 통계를 불러오세요.');
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const clientId = clientInput.value.trim();
    const propertyId = propertyInput.value.trim();
    const ownerEmail = emailInput.value.trim().toLowerCase();
    if (!clientId.endsWith('.apps.googleusercontent.com')) {
      setStatus('OAuth 클라이언트 ID 형식을 확인해 주세요. 보통 .apps.googleusercontent.com 으로 끝납니다.', 'error');
      return;
    }
    if (!/^\d+$/.test(propertyId)) {
      setStatus('G-로 시작하는 측정 ID가 아니라 GA4 속성의 숫자 ID를 입력해야 합니다.', 'error');
      return;
    }
    if (!ownerEmail) {
      setStatus('허용할 Google 계정 이메일을 입력해 주세요.', 'error');
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ clientId, propertyId, ownerEmail }));
    accessToken = undefined;
    tokenClient = undefined;
    metrics.hidden = true;
    setStatus('설정을 이 브라우저에 저장했어요. 이제 Google로 로그인하세요.', 'success');
  });

  const callReport = async (dateRange, token, propertyId) => {
    const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [dateRange],
        metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }]
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `Analytics API 오류 (${response.status})`);
    return (data.rows?.[0]?.metricValues || []).map(item => Number(item.value || 0));
  };

  const fetchDashboard = async token => {
    const current = readSettings();
    const userResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!userResponse.ok) throw new Error('Google 계정 정보를 확인하지 못했어요. 다시 로그인해 주세요.');
    const user = await userResponse.json();
    if (!user.email || user.email.toLowerCase() !== current.ownerEmail) {
      accessToken = undefined;
      throw new Error('허용된 운영자 계정과 로그인 계정이 달라요. 운영자 Google 계정으로 로그인해 주세요.');
    }
    const [today, last7Days, last28Days] = await Promise.all([
      callReport({ startDate: 'today', endDate: 'today' }, token, current.propertyId),
      callReport({ startDate: '6daysAgo', endDate: 'today' }, token, current.propertyId),
      callReport({ startDate: '27daysAgo', endDate: 'today' }, token, current.propertyId)
    ]);
    document.querySelector('#usersToday').textContent = today[0]?.toLocaleString('ko-KR') || '0';
    document.querySelector('#users7').textContent = last7Days[0]?.toLocaleString('ko-KR') || '0';
    document.querySelector('#users28').textContent = last28Days[0]?.toLocaleString('ko-KR') || '0';
    document.querySelector('#sessions7').textContent = last7Days[1]?.toLocaleString('ko-KR') || '0';
    document.querySelector('#views7').textContent = last7Days[2]?.toLocaleString('ko-KR') || '0';
    metrics.hidden = false;
    updatedAt.textContent = `Google 계정: ${user.email} · 마지막 조회 ${new Date().toLocaleString('ko-KR')}`;
    setStatus('GA4 통계를 불러왔어요.', 'success');
  };

  signInButton.addEventListener('click', () => {
    const current = readSettings();
    if (!current.clientId || !current.propertyId || !current.ownerEmail) {
      setStatus('먼저 OAuth 클라이언트 ID, GA4 속성 ID, 허용 이메일을 저장해 주세요.', 'error');
      return;
    }
    if (!window.google?.accounts?.oauth2) {
      setStatus('Google 로그인 모듈을 불러오지 못했어요. 광고 차단 설정을 확인한 뒤 다시 시도해 주세요.', 'error');
      return;
    }
    tokenClient ||= window.google.accounts.oauth2.initTokenClient({
      client_id: current.clientId,
      scope: SCOPE,
      callback: async response => {
        if (response.error) {
          setStatus(`Google 로그인에 실패했어요: ${response.error}`, 'error');
          return;
        }
        accessToken = response.access_token;
        setStatus('GA4에서 방문 통계를 불러오는 중…');
        try { await fetchDashboard(accessToken); }
        catch (error) { metrics.hidden = true; setStatus(error.message, 'error'); }
      },
      error_callback: error => setStatus(error.message || 'Google 로그인 창을 열지 못했어요.', 'error')
    });
    tokenClient.requestAccessToken({ prompt: 'consent select_account' });
  });
})();
