import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const UA = { 'User-Agent': 'Mozilla/5.0' };
const fetchJson = async url => (await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) })).json();
const ksicPath = fileURLToPath(new URL('../data/ksic-10.json', import.meta.url));
let ksic = null;

async function ksicName(code) {
  ksic ||= JSON.parse(await readFile(ksicPath, 'utf8'));
  const digits = String(code || '');
  for (let n = digits.length; n >= 2; n--) if (ksic[digits.slice(0, n)]) return ksic[digits.slice(0, n)];
  return '';
}

async function naverGroupName(stockCode) {
  const info = await fetchJson(`https://m.stock.naver.com/api/stock/${stockCode}/integration`);
  if (!info.industryCode) return '';
  const group = await fetchJson(`https://m.stock.naver.com/api/stocks/industry/${info.industryCode}`);
  return group.groupInfo?.name || '';
}

// 상장 종목은 네이버 업종 그룹명, 상장 전 종목은 DART 업종코드를 한국표준산업분류 명칭으로 바꾼다.
export async function sectorFor(client, corpCode) {
  const company = await Promise.race([client.company(corpCode), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 30000))]);
  if (company.stock_code) {
    const name = await naverGroupName(company.stock_code).catch(() => '');
    if (name) return name;
  }
  return ksicName(company.induty_code);
}
