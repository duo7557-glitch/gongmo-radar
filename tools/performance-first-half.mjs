// Reproduce the 2026 H1 performance snapshot using public KIND and Naver data.
// Prints JSON only; the reviewed output is published as a static data asset.
const asOf = '2026-10-02';
const listingSource = 'https://kind.krx.co.kr/listinvstg/listingcompany.do?method=searchListingTypeMain';
const query = new URLSearchParams({ method: 'searchListingTypeSub', forward: 'listingtype_sub', fromDate: '2026-01-01', toDate: '2026-06-30', currentPageSize: '100', pageIndex: '1', choicTypeArrStr: '02|', listTypeArrStr: '01|02|03|04|05|', marketType: '', orderMode: '1', orderStat: 'D', secuGrpArrStr: 'ST|FS|MF|SC|RT|IF|DR|' });
const response = await fetch('https://kind.krx.co.kr/listinvstg/listingcompany.do', { method: 'POST', body: query, signal: AbortSignal.timeout(25000) });
if (!response.ok) throw new Error('KIND listing request failed');
const html = await response.text();
const clean = text => text.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const rows = [...html.matchAll(/<tr\b[\s\S]*?<\/tr>/g)].filter(([row]) => row.includes('fnDetailView('));
const total = Number(html.match(/전체\s*<em>([\d,]+)<\/em>/)?.[1]?.replaceAll(',', ''));
if (!Number.isFinite(total) || rows.length !== total || total >= 100) throw new Error('KIND listing response is incomplete');
const months = Object.fromEntries(Array.from({ length: 6 }, (_, i) => {
  const month = `2026-${String(i + 1).padStart(2, '0')}`;
  return [month, { month, asOf, fetchedAt: new Date().toISOString(), note: 'KIND 공모가 확인 종목. 시세: 네이버 금융. 상장일 포함 첫 5거래일, 수수료·세금 전.', items: [], excluded: [] }];
}));
for (const [row] of rows.reverse()) {
  const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(([, value]) => clean(value));
  const [name, listedAt, listingType] = cells;
  const offerPrice = Number(cells.at(-1).replaceAll(',', ''));
  const dataset = months[listedAt.slice(0, 7)];
  if (!dataset) throw new Error('Unexpected listing month');
  if (!['신규상장', '이전상장'].includes(listingType) || !(offerPrice > 0)) {
    dataset.excluded.push({ name, listedAt, reason: offerPrice > 0 ? '공모 신규·이전상장 아님' : '공모가 없음' });
    continue;
  }
  const isur = row.match(/fnDetailView\('([^']+)'/)?.[1];
  if (!/^[0-9A-Z]{5}$/.test(isur) || /^USA/.test(isur)) throw new Error(`Stock code needs verification: ${name}`);
  const code = isur + '0';
  const basicResponse = await fetch(`https://m.stock.naver.com/api/stock/${code}/basic`, { signal: AbortSignal.timeout(20000) });
  if (!basicResponse.ok) throw new Error(`Stock identity unavailable: ${code}`);
  const basic = await basicResponse.json();
  if (basic.itemCode !== code || !basic.stockName) throw new Error(`Stock identity mismatch: ${code}`);
  const priceApiSource = `https://api.finance.naver.com/siseJson.naver?symbol=${code}&requestType=1&startTime=${listedAt.replaceAll('-', '')}&endTime=${asOf.replaceAll('-', '')}&timeframe=day`;
  const prices = await fetch(priceApiSource, { signal: AbortSignal.timeout(20000) });
  if (!prices.ok) throw new Error(`Price request failed: ${name}`);
  const text = await prices.text();
  const days = [...text.matchAll(/\["(\d{8})",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/g)]
    .map(([, d, o, h, l, c, v]) => ({ date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, open: +o, high: +h, low: +l, close: +c, volume: +v }))
    .filter(day => day.date >= listedAt && day.date <= asOf).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  if (days.length !== 5 || days[0].date !== listedAt || new Set(days.map(day => day.date)).size !== 5 || days.some(day => !(day.low > 0 && day.low <= day.open && day.open <= day.high && day.low <= day.close && day.close <= day.high))) throw new Error(`Invalid five-session data: ${name}`);
  dataset.items.push({ name, priceName: basic.stockName, code, listedAt, offerPrice, spac: /스팩|SPAC/i.test(name), listingSource, priceSource: `https://stock.naver.com/domestic/stock/${code}/price`, priceApiSource, days });
}
console.log(JSON.stringify(months, null, 2));
