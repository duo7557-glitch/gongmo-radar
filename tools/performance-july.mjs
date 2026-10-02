// Reproducible 2026-07 IPO performance snapshot from public KIND and Naver endpoints.
const fromDate = '2026-07-01', toDate = '2026-07-31', asOf = '2026-10-02';
const params = new URLSearchParams({ method: 'searchListingTypeSub', forward: 'listingtype_sub', fromDate, toDate, currentPageSize: '100', pageIndex: '1', choicTypeArrStr: '02|', listTypeArrStr: '01|02|03|04|05|', marketType: '', orderMode: '1', orderStat: 'D', secuGrpArrStr: 'ST|FS|MF|SC|RT|IF|DR|' });
const response = await fetch('https://kind.krx.co.kr/listinvstg/listingcompany.do', { method: 'POST', body: params, signal: AbortSignal.timeout(25000) });
if (!response.ok) throw new Error('KIND listing request failed');
const html = await response.text();
const clean = value => value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const rows = [...html.matchAll(/<tr\b[\s\S]*?<\/tr>/g)].filter(([row]) => row.includes('fnDetailView('));
const count = Number(html.match(/<em>([\d,]+)<\/em>/)?.[1]?.replaceAll(',', ''));
if (count !== 7 || rows.length !== count) throw new Error('KIND July listings need review');
const items = [], excluded = [];
for (const [row] of rows.reverse()) {
  const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(([, cell]) => clean(cell));
  const [name, listedAt, type] = cells;
  const offerPrice = Number(cells.at(-1).replaceAll(',', ''));
  if (!['신규상장', '이전상장'].includes(type) || !(offerPrice > 0)) {
    excluded.push({ name, listedAt, reason: offerPrice > 0 ? '공모 신규·이전상장 아님' : 'KIND에 공모가 미기재' });
    continue;
  }
  const shortCode = row.match(/fnDetailView\('([^']+)'/)?.[1];
  if (!/^[0-9A-Z]{5}$/.test(shortCode) || shortCode.startsWith('USA')) throw new Error(`Unverified KIND code: ${name}`);
  const code = shortCode + '0';
  const basicResponse = await fetch(`https://m.stock.naver.com/api/stock/${code}/basic`, { signal: AbortSignal.timeout(20000) });
  if (!basicResponse.ok) throw new Error(`Naver identity unavailable: ${code}`);
  const basic = await basicResponse.json();
  if (basic.itemCode !== code || basic.stockName !== name) throw new Error(`KIND/Naver name mismatch: ${name}`);
  const priceApiSource = `https://api.finance.naver.com/siseJson.naver?symbol=${code}&requestType=1&startTime=${listedAt.replaceAll('-', '')}&endTime=${asOf.replaceAll('-', '')}&timeframe=day`;
  const priceResponse = await fetch(priceApiSource, { signal: AbortSignal.timeout(20000) });
  if (!priceResponse.ok) throw new Error(`Naver price request failed: ${name}`);
  const text = await priceResponse.text();
  const days = [...text.matchAll(/\["(\d{8})",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/g)]
    .map(([, d, o, h, l, c, v]) => ({ date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, open: +o, high: +h, low: +l, close: +c, volume: +v }))
    .filter(day => day.date >= listedAt && day.date <= asOf).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  if (days.length !== 5 || days[0].date !== listedAt || days.some(day => !(day.low > 0 && day.low <= day.open && day.open <= day.high && day.low <= day.close && day.close <= day.high))) throw new Error(`Invalid first five sessions: ${name}`);
  items.push({ name, code, listedAt, offerPrice, spac: false, listingSource: 'https://kind.krx.co.kr/listinvstg/listingcompany.do?method=searchListingTypeMain', priceSource: `https://stock.naver.com/domestic/stock/${code}/price`, priceApiSource, days });
}
console.log(JSON.stringify({ month: '2026-07', asOf, fetchedAt: new Date().toISOString(), note: 'KIND 신규상장 공모가 확인 종목. 시세: 네이버 금융. 상장일 포함 첫 5거래일, 수수료·세금 전.', items, excluded }, null, 2));
