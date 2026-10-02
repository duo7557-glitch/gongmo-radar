// 2026-09 snapshot. KIND confirms listing date / offering price; Naver supplies daily OHLC.
// This script prints JSON only. No write/API admin credential is required.
const companySeeds = [
  ['스카이랩스','386380','2026-09-04',10000,false],
  ['엔에이치스팩34호','0197V0','2026-09-10',2000,true],
  ['네오사피엔스','0161M0','2026-09-21',10000,false],
  ['한국제17호스팩','0200G0','2026-09-22',2000,true],
  ['KB제34호스팩','0209J0','2026-09-22',2000,true],
  ['와이즈플래닛컴퍼니','0010S0','2026-09-23',12000,false],
  ['글로벌테크놀로지','486510','2026-09-29',10000,false],
  ['빅웨이브로보틱스','0035S0','2026-09-29',18000,false],
  ['덕산넵코어스','266690','2026-09-30',14600,false]
];
const listingSource = 'https://kind.krx.co.kr/listinvstg/listingcompany.do?method=searchListingTypeMain';
const asOf = '2026-10-02';
const items = [];
for (const [name, code, listedAt, offerPrice, spac] of companySeeds) {
  const source = `https://api.finance.naver.com/siseJson.naver?symbol=${code}&requestType=1&startTime=20260901&endTime=${asOf.replaceAll('-','')}&timeframe=day`;
  const response = await fetch(source, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`시세 조회 실패: ${name}`);
  const text = await response.text();
  const matches = [...text.matchAll(/\["(\d{8})",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/g)];
  const days = matches.map(([,d,o,h,l,c,v]) => ({ date: `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6)}`, open: Number(o), high: Number(h), low: Number(l), close: Number(c), volume: Number(v) })).filter(day => day.date >= listedAt && day.date <= asOf);
  if (!days.length || days[0].date !== listedAt) throw new Error(`상장일 시세 확인 필요: ${name}`);
  items.push({ name, code, listedAt, offerPrice, spac, listingSource, priceSource: `https://stock.naver.com/domestic/stock/${code}/price`, priceApiSource: source, days });
}
console.log(JSON.stringify({ month: '2026-09', asOf, fetchedAt: new Date().toISOString(), note: '공모가·상장일: KIND, 일별 시세: 네이버 금융. 상장일 포함 5거래일째 종가. 수수료·세금 제외.', items }, null, 2));
