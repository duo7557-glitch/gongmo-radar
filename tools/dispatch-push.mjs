import webpush from 'web-push';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  throw new Error('Push dispatcher is missing required secrets.');
}

webpush.setVapidDetails('mailto:excelkospi@outlook.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
const base = SUPABASE_URL.replace(/\/$/, '');
const auth = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
async function rows(path) {
  const all = [];
  for (let start = 0; ; start += 1000) {
    const response = await fetch(`${base}/rest/v1/${path}`, { headers: { ...auth, Range: `${start}-${start + 999}` }, cache: 'no-store' });
    if (!response.ok) throw new Error(`Supabase query failed (${response.status}).`);
    const page = await response.json();
    all.push(...page);
    if (page.length < 1000) return all;
  }
}
function dueAt(end, slot) {
  const [year, month, day] = end.split('-').map(Number);
  let dueDate = new Date(Date.UTC(year, month - 1, day));
  if (slot.key === 'eve') dueDate = new Date(dueDate.getTime() - 86400000);
  const [hour, minute] = slot.time.split(':').map(Number);
  return Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate(), hour - 9, minute);
}
function dateOf(iso) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)); }
const now = Date.now();
const recentWindow = 10 * 60 * 1000;
const [subscriptions, listings] = await Promise.all([
  rows('ipo_push_subscriptions?select=endpoint,p256dh,auth,ipo_ids,schedule'),
  rows('ipo_listings?select=id,name,subscription_end,broker,status,is_published&is_published=eq.true&subscription_end=not.is.null')
]);
const byId = new Map(listings.filter(row => !['철회', '연기'].includes(row.status)).map(row => [String(row.id), row]));
let delivered = 0, skipped = 0, expired = 0;
for (const subscription of subscriptions) {
  for (const id of subscription.ipo_ids || []) {
    const ipo = byId.get(String(id));
    if (!ipo?.subscription_end) continue;
    for (const slot of subscription.schedule || []) {
      if (!['eve', 'morning', 'afternoon'].includes(slot.key) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.time || '')) continue;
      const due = dueAt(ipo.subscription_end, slot);
      if (due > now || now - due > recentWindow) continue;
      const delivery = { endpoint: subscription.endpoint, ipo_id: String(ipo.id), subscription_end: ipo.subscription_end, slot: slot.key };
      const claim = await fetch(`${base}/rest/v1/ipo_push_deliveries?on_conflict=endpoint,ipo_id,subscription_end,slot`, {
        method: 'POST', headers: { ...auth, Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify(delivery)
      });
      if (!claim.ok) throw new Error(`Could not reserve a due notification (${claim.status}).`);
      if (!(await claim.json()).length) { skipped++; continue; }
      const timing = slot.key === 'eve' ? '내일 청약 마감' : '오늘 청약 마감';
      const body = `${ipo.name} · ${timing}\n마감 예정 ${ipo.subscription_end} ${slot.time} · ${ipo.broker || '증권사 공지 확인'}\n실제 청약 마감 시각은 증권사 안내를 확인하세요.`;
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify({
          title: `공모주 청약 알림 · ${ipo.name}`, body, tag: `ipo-${ipo.id}-${slot.key}-${ipo.subscription_end}`, url: './#calendar'
        }), { TTL: 43200 });
        delivered++;
      } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) {
          expired++;
          await fetch(`${base}/rest/v1/ipo_push_subscriptions?endpoint=eq.${encodeURIComponent(subscription.endpoint)}`, { method: 'DELETE', headers: auth });
        } else {
          await fetch(`${base}/rest/v1/ipo_push_deliveries?endpoint=eq.${encodeURIComponent(subscription.endpoint)}&ipo_id=eq.${encodeURIComponent(ipo.id)}&subscription_end=eq.${ipo.subscription_end}&slot=eq.${slot.key}`, { method: 'DELETE', headers: auth });
          throw new Error(`Push delivery failed (${error.statusCode || 'network'}).`);
        }
      }
    }
  }
}
console.log(JSON.stringify({ checkedAt: new Date(now).toISOString(), subscriptions: subscriptions.length, listings: byId.size, delivered, skipped, expired }));
