self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch {}
  const title = payload.title || '공모주 레이더 청약 알림';
  const options = {
    body: payload.body || '신청한 공모주 일정을 확인해 보세요.',
    tag: payload.tag || 'ipo-reminder',
    data: { url: payload.url || './#calendar' },
    renotify: false
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './#calendar', self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => client.url.startsWith(self.registration.scope));
    if (existing) { await existing.focus(); existing.navigate(target); }
    else await self.clients.openWindow(target);
  })());
});
