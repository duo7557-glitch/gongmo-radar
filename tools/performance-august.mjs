// KIND 신규상장기업현황: 2026-08-01~31, 주권 및 주식예탁증권.
// 재상장인 한화머시너리앤서비스홀딩스는 공모가가 없어 제외합니다.
// Prints a reproducible snapshot; no credentials or database writes.
const seeds = [
  ['딜리셔스', '483350', '2026-08-12', 7000],
  ['케이앤에스아이앤씨', '487400', '2026-08-13', 11000],
  ['인제니아테라퓨틱스', '950260', '2026-08-18', 12000],
  ['기도산업', '282620', '2026-08-21', 28400],
  ['니어스랩', '417030', '2026-08-24', 41200],
  ['해치텍', '0155E0', '2026-08-25', 23000]
];
const asOf = '2026-10-02';
const listingSource = 'https://kind.krx.co.kr/listinvstg/listingcompany.do?method=searchListingTypeMain';
const items = [];
for (const [name, code, listedAt, offerPrice] of seeds) {
  const priceApiSource = `https://api.finance.naver.com/siseJson.naver?symbol=${code}&requestType=1&startTime=20260801&endTime=20261002&timeframe=day`;
  const response = await fetch(priceApiSource, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`시세 조회 실패: ${name}`);
  const text = await response.text();
  const days = [...text.matchAll(/\["(\d{8})",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/g)]
    .map(([, d, o, h, l, c, v]) => ({ date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, open: +o, high: +h, low: +l, close: +c, volume: +v }))
    .filter(day => day.date >= listedAt && day.date <= asOf).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  if (days.length !== 5 || days[0].date !== listedAt || new Set(days.map(day => day.date)).size !== 5 || days.some(day => !(day.low > 0 && day.low <= day.open && day.open <= day.high && day.low <= day.close && day.close <= day.high))) throw new Error(`5거래일 시세 확인 필요: ${name}`);
  items.push({ name, code, listedAt, offerPrice, spac: false, listingSource, priceSource: `https://stock.naver.com/domestic/stock/${code}/price`, priceApiSource, days });
}
console.log(JSON.stringify({ month: '2026-08', asOf, fetchedAt: new Date().toISOString(), note: 'KIND 신규상장 공모기업 6개. 공모가 없는 재상장은 제외. 시세: 네이버 금융, 상장일 포함 5거래일.', items }, null, 2));
