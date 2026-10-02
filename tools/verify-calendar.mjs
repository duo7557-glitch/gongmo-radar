// 실제 상장 종목(KIND, data/price-history-YYYY.js)을 정답으로 놓고 공모주 캘린더(Supabase ipo_listings)를 대조한다.
// 읽기 전용: 공개 키로 게시된 종목만 읽는다. 사용: node tools/verify-calendar.mjs
import { readFile } from 'node:fs/promises';

const year = process.env.YEAR || '2026';
const configText = await readFile(new URL('../config.js', import.meta.url), 'utf8');
const url = configText.match(/supabaseUrl:\s*'([^']+)'/)?.[1];
const key = configText.match(/supabasePublishableKey:\s*'([^']+)'/)?.[1];
const history = await readFile(new URL(`../data/price-history-${year}.js`, import.meta.url), 'utf8');
const truth = JSON.parse(history.slice(history.indexOf('{'), history.lastIndexOf('}') + 1)).items;

const rows = [];
for (let offset = 0; ; offset += 1000) {
  const response = await fetch(`${url}/rest/v1/ipo_listings?select=name,subscription_start,subscription_end,price_text,broker,status,source_key,source_dart_url,source_payload&order=subscription_start&offset=${offset}&limit=1000`, { headers: { apikey: key } });
  if (!response.ok) throw new Error(`Supabase ${response.status}`);
  const page = await response.json(); rows.push(...page); if (page.length < 1000) break;
}
const norm = s => String(s || '').replace(/\(.*?\)|주식회사|㈜|\s/g, '').toLowerCase();
const byName = new Map(rows.map(row => [norm(row.name), row]));
const won = n => Number(String(n).replace(/[^\d]/g, ''));
const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

let ok = 0;
const problems = [];
for (const item of truth) {
  const row = byName.get(norm(item.name));
  if (!row) { problems.push(`❌ 누락  ${item.listedAt} ${item.name} (공모가 ${item.offerPrice.toLocaleString()}원)`); continue; }
  const confirmed = /확정 공모가/.test(row.price_text || '') ? won(row.price_text.match(/^[\d,]+/)?.[0]) : null;
  const issues = [];
  if (confirmed !== item.offerPrice) issues.push(`가격 "${row.price_text}" ≠ KIND ${item.offerPrice.toLocaleString()}원`);
  const gap = days(row.subscription_end, item.listedAt);
  if (!(gap >= 2 && gap <= 30)) issues.push(`청약 ${row.subscription_start}~${row.subscription_end} → 상장 ${item.listedAt} (${gap}일 차이)`);
  if (issues.length) problems.push(`⚠️ 불일치 ${item.listedAt} ${item.name}: ${issues.join(' / ')}`);
  else ok++;
}
const extra = rows.filter(row => row.subscription_start >= `${year}-01-01` && !truth.some(item => norm(item.name) === norm(row.name)));
console.log(`실제 상장 ${truth.length}종목 중 정상 ${ok} · 문제 ${problems.length} (DB 게시 ${rows.length}건)`);
for (const line of problems) console.log('  ' + line);
console.log(`\nKIND 상장 목록에 없는 DB 종목 ${extra.length}건 (아직 상장 전이거나 이름 차이):`);
for (const row of extra) console.log(`  · ${row.subscription_start}~${row.subscription_end} ${row.name} ${row.price_text} ${row.status}`);
