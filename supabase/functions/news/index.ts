// 공모주·상장 관련 뉴스 목록(제목·언론사·시간·짧은 요약·원문 링크). 기사 본문은 가져오지 않는다.
const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Cache-Control': 'public, max-age=300' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });
const QUERY = '(공모주 OR 상장 청약 OR 신규상장) when:14d';
// 공모주·상장과 무관한 기사(검색어 OR 매칭 잡음)는 거른다.
const RELEVANT = /공모|상장|청약|IPO|스팩|수요예측/i;

// 구글 뉴스 요약은 이중 인코딩(&amp;nbsp; 등)이라 엔티티를 두 번 풀고, 그다음 태그를 지운다.
const entities = (s: string) => s
  .replace(/&nbsp;|&#160;/g, ' ')
  .replace(/&quot;|&#34;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const clean = (s: string) => entities(entities(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')))
  .replace(/<[^>]*>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const tag = (block: string, name: string) => clean(block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] || '');

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers });
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(QUERY)}&hl=ko&gl=KR&ceid=KR:ko`;
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; gongmo-radar/1.0)', 'Accept-Language': 'ko-KR,ko;q=0.9' }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) return json({ error: 'upstream ' + response.status }, 502);
    const xml = await response.text();
    const seen = new Set<string>();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, block]) => {
      const rawTitle = tag(block, 'title');
      // 구글 뉴스 제목은 "제목 - 언론사" 형식이라 언론사 이름을 떼어 따로 보여준다.
      const source = tag(block, 'source') || (rawTitle.includes(' - ') ? rawTitle.split(' - ').at(-1) || '' : '');
      const title = source && rawTitle.endsWith(' - ' + source) ? rawTitle.slice(0, -(' - ' + source).length) : rawTitle;
      let summary = tag(block, 'description');
      if (source && summary.endsWith(source)) summary = summary.slice(0, -source.length).trim();
      if (summary.length > 140) summary = summary.slice(0, 140) + '…';
      const pub = Date.parse(tag(block, 'pubDate'));
      return { title, source, link: tag(block, 'link'), published: Number.isFinite(pub) ? new Date(pub).toISOString() : '', summary };
    })
      .filter(item => item.title && /^https:\/\//.test(item.link))
      .filter(item => RELEVANT.test(item.title + ' ' + item.summary))
      .filter(item => { const key = item.title.replace(/\s/g, ''); if (seen.has(key)) return false; seen.add(key); return true; })
      .sort((a, b) => b.published.localeCompare(a.published))
      .slice(0, 30);
    return json({ fetchedAt: new Date().toISOString(), items });
  } catch (error) {
    return json({ error: 'upstream unavailable', detail: String((error as Error)?.message || error).slice(0, 120) }, 502);
  }
});
