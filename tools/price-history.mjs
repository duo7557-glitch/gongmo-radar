// 올해 공모로 신규·이전상장한 전 종목의 상장일~최신 거래일 시세를 받아 data/price-history-2026.js로 저장한다.
// 상장 목록: KIND 신규상장기업현황, 시세: 네이버 금융 일별 시세(siseJson). 공모가가 없는 재상장 등은 제외한다.
// 사용: node tools/price-history.mjs   (기간 변경: YEAR=2026)
import { writeFile } from 'node:fs/promises';

const year = process.env.YEAR || '2026';
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const listingSource = 'https://kind.krx.co.kr/listinvstg/listingcompany.do?method=searchListingTypeMain';
const clean = text => text.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchRetry(url, options = {}, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    if (i) await sleep(i * 2000);
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) { lastError = error; }
  }
  throw lastError;
}

async function kindListings() {
  const rows = [];
  for (let page = 1; ; page++) {
    const query = new URLSearchParams({ method: 'searchListingTypeSub', forward: 'listingtype_sub', fromDate: `${year}-01-01`, toDate: today, currentPageSize: '100', pageIndex: String(page), choicTypeArrStr: '02|', listTypeArrStr: '01|02|03|04|05|', marketType: '', orderMode: '1', orderStat: 'D', secuGrpArrStr: 'ST|FS|MF|SC|RT|IF|DR|' });
    const html = await (await fetchRetry('https://kind.krx.co.kr/listinvstg/listingcompany.do', { method: 'POST', body: query })).text();
    const total = Number(html.match(/전체\s*<em>([\d,]+)<\/em>/)?.[1]?.replaceAll(',', ''));
    const pageRows = [...html.matchAll(/<tr\b[\s\S]*?<\/tr>/g)].map(([row]) => row).filter(row => row.includes('fnDetailView('));
    rows.push(...pageRows);
    if (!Number.isFinite(total)) throw new Error('KIND 응답에서 전체 건수를 찾지 못했습니다.');
    if (rows.length >= total || !pageRows.length) {
      if (rows.length !== total) throw new Error(`KIND 목록이 불완전합니다 (${rows.length}/${total})`);
      return rows;
    }
  }
}

const items = [], skipped = [];
for (const row of (await kindListings()).reverse()) {
  const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(([, value]) => clean(value));
  const [name, listedAt, listingType] = cells;
  const offerPrice = Number(cells.at(-1).replaceAll(',', ''));
  if (!['신규상장', '이전상장'].includes(listingType) || !(offerPrice > 0)) { skipped.push({ name, listedAt, reason: offerPrice > 0 ? '공모 신규·이전상장 아님' : '공모가 없음' }); continue; }
  const isur = row.match(/fnDetailView\('([^']+)'/)?.[1];
  if (!/^[0-9A-Z]{5}$/.test(isur || '')) { skipped.push({ name, listedAt, reason: '종목코드 확인 필요' }); continue; }
  let code = isur + '0';
  try {
    // 외국 기업은 KIND가 종목코드 대신 발행사 코드(예: USA28)를 주므로, 네이버 종목 검색에서 이름이 하나로 맞을 때만 코드를 쓴다.
    if (/^[A-Z]{3}/.test(isur)) {
      const found = (await (await fetchRetry(`https://ac.stock.naver.com/ac?q=${encodeURIComponent(name)}&target=stock`)).json()).items || [];
      const matches = found.filter(item => item.category === 'stock' && item.name.replace(/\(.*?\)/g, '').trim() === name);
      if (matches.length !== 1) throw new Error('외국 기업 종목코드 확인 필요');
      code = matches[0].code;
    }
    const priceApi = `https://api.finance.naver.com/siseJson.naver?symbol=${code}&requestType=1&startTime=${listedAt.replaceAll('-', '')}&endTime=${today.replaceAll('-', '')}&timeframe=day`;
    const text = await (await fetchRetry(priceApi)).text();
    const days = [...text.matchAll(/\["(\d{8})",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/g)]
      .map(([, d, o, h, l, c]) => [`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, +o, +h, +l, +c])
      .filter(([date]) => date >= listedAt).sort((a, b) => a[0].localeCompare(b[0]));
    // 상장일 시세가 첫 거래일이어야 하고, 시가·고가·저가·종가 관계가 맞아야 한다.
    if (!days.length || days[0][0] !== listedAt) throw new Error('상장일 시세 없음');
    if (days.some(([, o, h, l, c]) => !(l > 0 && l <= o && o <= h && l <= c && c <= h))) throw new Error('시세 값 이상');
    items.push({ name, code, listedAt, offerPrice, spac: /스팩|SPAC/i.test(name), days });
  } catch (error) {
    skipped.push({ name, listedAt, reason: '시세 조회 실패: ' + String(error.message || error).slice(0, 80) });
  }
  await sleep(150);
}

const asOf = items.reduce((max, item) => (item.days.at(-1)[0] > max ? item.days.at(-1)[0] : max), '');
const data = { year, asOf, fetchedAt: new Date().toISOString(), note: `KIND ${year}년 공모 신규·이전상장 종목, 네이버 금융 일별 시세(상장일~${asOf}). 수수료·세금 전.`, listingSource, skipped, items };
await writeFile(new URL(`../data/price-history-${year}.js`, import.meta.url), `window.GONGMO_PRICE_HISTORY = ${JSON.stringify(data)};\n`, 'utf8');
console.log(`${year}년 공모 상장 ${items.length}종목 시세 저장 (최신 거래일 ${asOf}), 제외 ${skipped.length}건`);
for (const item of skipped) console.log(`  제외: ${item.listedAt} ${item.name} — ${item.reason}`);
