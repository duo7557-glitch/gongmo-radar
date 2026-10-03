// Reconcile completed IPO calendar prices against the official KIND listing history.
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');

const year = process.env.YEAR || '2026';
const text = await (await import('node:fs/promises')).readFile(new URL(`../data/price-history-${year}.js`, import.meta.url), 'utf8');
const history = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
const headers = { apikey: key, Authorization: `Bearer ${key}` };
const normalize = value => String(value || '').replace(/\(.*?\)|\s/g, '').toLowerCase();

const listings = [];
for (let offset = 0; ; offset += 1000) {
  const endpoint = new URL(`${url}/rest/v1/ipo_listings`);
  endpoint.searchParams.set('select', 'id,name,subscription_end,price_text');
  endpoint.searchParams.set('is_published', 'eq.true');
  endpoint.searchParams.set('order', 'subscription_start');
  endpoint.searchParams.set('offset', String(offset));
  endpoint.searchParams.set('limit', '1000');
  const response = await fetch(endpoint, { headers, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Calendar read failed (${response.status})`);
  const page = await response.json();
  listings.push(...page);
  if (page.length < 1000) break;
}

let updated = 0;
for (const item of history.items) {
  const matches = listings.filter(row => normalize(row.name) === normalize(item.name));
  for (const row of matches) {
    const gap = Math.round((new Date(item.listedAt) - new Date(row.subscription_end)) / 86400000);
    if (gap < 2 || gap > 30) continue;
    const price = `${item.offerPrice.toLocaleString('en-US')}\uC6D0 (\uD655\uC815 \uACF5\uBAA8\uAC00)`;
    if (row.price_text === price) continue;
    const endpoint = new URL(`${url}/rest/v1/ipo_listings`);
    endpoint.searchParams.set('id', `eq.${row.id}`);
    const response = await fetch(endpoint, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ price_text: price, updated_at: history.fetchedAt }),
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error(`Calendar update failed (${response.status})`);
    row.price_text = price;
    updated++;
    console.log(`${row.name}: ${price}`);
  }
}
console.log(`Reconciled ${updated} calendar price(s) from KIND ${history.asOf} listing history.`);
