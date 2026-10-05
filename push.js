(() => {
  const config = window.GONGMO_CONFIG || {};
  const key = config.vapidPublicKey;
  const endpoint = (config.supabaseUrl || '').replace(/\/$/, '');
  const apiKey = config.supabasePublishableKey || config.supabaseAnonKey;
  const available = () => Boolean(key && endpoint && apiKey && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
  const headers = () => ({ apikey: apiKey, Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' });
  const b64 = value => {
    const padded = value.padEnd(value.length + (4 - value.length % 4) % 4, '=');
    return Uint8Array.from(atob(padded.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
  };
  async function rpc(name, body) {
    const response = await fetch(`${endpoint}/rest/v1/rpc/${name}`, { method: 'POST', headers: headers(), body: JSON.stringify(body), cache: 'no-store' });
    if (!response.ok) throw new Error(`알림 설정 저장에 실패했습니다 (${response.status}).`);
    return response;
  }
  async function registration() {
    return navigator.serviceWorker.register(new URL('service-worker.js', document.baseURI), { scope: './' });
  }
  async function currentSubscription(reg, { create = false } = {}) {
    let subscription = await reg.pushManager.getSubscription();
    if (!subscription && create) subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
    return subscription;
  }
  function slotsFrom(schedule) {
    return [
      { key: 'eve', offset: -1, time: schedule.eve?.time, enabled: schedule.eve?.enabled },
      { key: 'morning', offset: 0, time: schedule.morning?.time, enabled: schedule.morning?.enabled },
      { key: 'afternoon', offset: 0, time: schedule.afternoon?.time, enabled: schedule.afternoon?.enabled }
    ].filter(slot => slot.enabled && /^([01]\d|2[0-3]):[0-5]\d$/.test(slot.time || ''));
  }
  async function save(subscription, ipoIds, schedule) {
    const json = subscription.toJSON();
    await rpc('save_ipo_push_subscription', {
      p_endpoint: json.endpoint,
      p_p256dh: json.keys?.p256dh,
      p_auth: json.keys?.auth,
      p_ipo_ids: [...new Set(ipoIds.map(String))],
      p_schedule: slotsFrom(schedule)
    });
  }
  async function sync(ipoIds, schedule, { askPermission = false } = {}) {
    if (!available()) return { enabled: false, reason: 'unsupported' };
    let permission = Notification.permission;
    if (permission === 'default' && askPermission) permission = await Notification.requestPermission();
    if (permission !== 'granted') return { enabled: false, reason: 'permission' };
    const reg = await registration();
    const subscription = await currentSubscription(reg, { create: askPermission });
    if (!subscription) return { enabled: false, reason: 'subscription' };
    const ids = [...new Set(ipoIds.map(String))];
    if (!ids.length || !slotsFrom(schedule).length) {
      await rpc('remove_ipo_push_subscription', { p_endpoint: subscription.endpoint });
      return { enabled: true, active: false };
    }
    await save(subscription, ids, schedule);
    return { enabled: true, active: true, registration: reg };
  }
  async function test() {
    const reg = await registration();
    await reg.showNotification('공모주 알림 설정 완료', { body: '사이트를 닫아도 신청한 청약 알림을 받을 수 있어요.', tag: 'ipo-push-test' });
  }
  async function remove() {
    if (!available()) return;
    const reg = await registration();
    const subscription = await currentSubscription(reg);
    if (!subscription) return;
    await rpc('remove_ipo_push_subscription', { p_endpoint: subscription.endpoint });
    await subscription.unsubscribe();
  }
  window.IpoWebPush = { available, sync, test, remove };
  if ('serviceWorker' in navigator && location.protocol !== 'file:') registration().catch(() => {});
})();
