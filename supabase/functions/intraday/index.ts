// 상장일 실시간 차트용 분봉 프록시. 브라우저는 네이버 시세 API를 직접 부를 수 없어(CORS) 이 함수가 대신 받아 준다.
// 공개 시세만 다루며 비밀값을 쓰지 않는다. 가장 최근 거래일의 정규장(09:00~15:30) 분봉만 돌려준다.
const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Cache-Control': 'public, max-age=10' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });
const ymd = (date: Date) => date.toISOString().slice(0, 10).replaceAll('-', '');

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers });
  const params = new URL(request.url).searchParams;
  // 상장 전후에는 DART에 종목코드가 없으므로, ?name=으로 네이버 종목 검색에서 이름이 정확히 하나 맞을 때만 코드를 돌려준다.
  const name = (params.get('name') || '').trim();
  if (name) {
    if (name.length > 40) return json({ error: 'invalid name' }, 400);
    try {
      const found = await (await fetch(`https://ac.stock.naver.com/ac?q=${encodeURIComponent(name)}&target=stock`, { signal: AbortSignal.timeout(8000) })).json();
      const matches = (found.items || []).filter((item: { category: string; name: string }) => item.category === 'stock' && item.name.replace(/\(.*?\)/g, '').replace(/\s/g, '') === name.replace(/\s/g, ''));
      return json({ name, code: matches.length === 1 ? matches[0].code : null });
    } catch { return json({ error: 'upstream unavailable' }, 502); }
  }
  const code = params.get('code') || '';
  if (!/^[0-9A-Z]{6}$/.test(code)) return json({ error: 'invalid code' }, 400);
  const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
  // ?date=YYYYMMDD면 그날(예: 상장일) 분봉, 없으면 최근 10일 중 마지막 거래일. 네이버는 분봉을 약 1~2주만 보관한다.
  const day = /^\d{8}$/.test(params.get('date') || '') ? params.get('date') as string : null;
  const start = day || ymd(new Date(kstNow.getTime() - 10 * 86400 * 1000)), end = day || ymd(kstNow);
  try {
    const response = await fetch(`https://api.stock.naver.com/chart/domestic/item/${code}/minute?startDateTime=${start}0900&endDateTime=${end}1530`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return json({ error: 'upstream ' + response.status }, 502);
    const rows = await response.json() as Array<{ localDateTime: string; openPrice: number; highPrice: number; lowPrice: number; currentPrice: number; accumulatedTradingVolume: number }>;
    const regular = (Array.isArray(rows) ? rows : []).filter(row => { const t = row.localDateTime.slice(8, 12); return t >= '0900' && t <= '1530'; });
    const date = regular.at(-1)?.localDateTime.slice(0, 8) || null;
    const bars = regular.filter(row => row.localDateTime.startsWith(date || '-')).map(row => [row.localDateTime.slice(8, 12), row.openPrice, row.highPrice, row.lowPrice, row.currentPrice, row.accumulatedTradingVolume]);
    return json({ code, date, bars, fetchedAt: new Date().toISOString() });
  } catch {
    return json({ error: 'upstream unavailable' }, 502);
  }
});
