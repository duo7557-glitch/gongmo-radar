// 올해 상장주 전체 시세를 공유하고, 공모가 대비 상승·하락 TOP 10을 그린다.
// 먼저 정적 파일(data/price-history-YYYY.js)로 그리고, Supabase(ipo_price_history)에 더 최신 시세가 있으면 다시 그린다.
(function () {
  let data = window.GONGMO_PRICE_HISTORY || null;
  let byCode = new Map();
  const toDays = item => item.days.map(([date, open, high, low, close]) => ({ date, open, high, low, close }));
  // 상장 후 성과 그래프가 첫 5거래일이 아니라 상장일~최신 거래일 전체를 그리도록 제공한다.
  window.PriceHistory = { get asOf() { return data?.asOf; }, get items() { return data?.items || []; }, daysFor: code => (byCode.has(code) ? toDays(byCode.get(code)) : null) };
  const root = document.querySelector('#ranking');

  const POSITIVE = '#d25c4d', NEGATIVE = '#477fc1';
  let basis = 'current', includeSpac = false, analyzed = [];
  const pct = n => (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  const won = n => n.toLocaleString('ko-KR') + '원';
  const md = date => date.slice(5).replace('-', '.');
  const escape = s => String(s).replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));

  function load(next) {
    data = next;
    byCode = new Map((data?.items || []).map(item => [item.code, item]));
    analyzed = (data?.items || []).filter(item => item.days?.length).map(item => {
      const last = item.days.at(-1);
      let peak = item.days[0], trough = item.days[0];
      for (const day of item.days) { if (day[4] > peak[4]) peak = day; if (day[4] < trough[4]) trough = day; }
      const ret = price => (price / item.offerPrice - 1) * 100;
      return { ...item, closes: item.days.map(day => day[4]), last, current: ret(last[4]), peak, peakReturn: ret(peak[4]), trough, troughReturn: ret(trough[4]) };
    });
  }

  function spark(item, color) {
    const W = 120, H = 34, pad = 3, values = item.closes.map(c => c / item.offerPrice * 100);
    const min = Math.min(100, ...values), max = Math.max(100, ...values), range = Math.max(max - min, 1);
    const x = i => pad + (values.length > 1 ? i / (values.length - 1) : 0.5) * (W - pad * 2);
    const y = v => H - pad - (v - min) / range * (H - pad * 2);
    const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    return `<svg class="rank-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><line x1="${pad}" x2="${W - pad}" y1="${y(100).toFixed(1)}" y2="${y(100).toFixed(1)}" class="rank-base"></line><polyline points="${points}" style="stroke:${color}"></polyline><circle cx="${x(values.length - 1).toFixed(1)}" cy="${y(values.at(-1)).toFixed(1)}" r="2.6" style="fill:${color}"></circle></svg>`;
  }

  function row(item, rank, up) {
    const value = basis === 'current' ? item.current : up ? item.peakReturn : item.troughReturn;
    const point = basis === 'current' ? item.last : up ? item.peak : item.trough;
    const color = value >= 0 ? POSITIVE : NEGATIVE;
    const when = basis === 'current' ? `${md(point[0])} 종가` : `${md(point[0])} ${up ? '최고' : '최저'} 종가`;
    const title = `${item.name}: 공모가 ${won(item.offerPrice)} → ${when} ${won(point[4])} (${pct(value)}), 상장 ${item.listedAt}`;
    return `<li class="rank-row" title="${escape(title)}"><span class="rank-no">${rank}</span><div class="rank-name"><a href="https://stock.naver.com/domestic/stock/${escape(item.code)}/price" target="_blank" rel="noopener noreferrer">${escape(item.name)}</a><small>${md(item.listedAt)} 상장 · 공모가 ${won(item.offerPrice)}</small></div>${spark(item, color)}<div class="rank-value"><b style="color:${color}">${pct(value)}</b><small>${won(point[4])} · ${when}</small></div></li>`;
  }

  function render() {
    if (!root || !data) return;
    const pool = analyzed.filter(item => includeSpac || !item.spac);
    const key = up => item => (basis === 'current' ? item.current : up ? item.peakReturn : item.troughReturn);
    const ups = pool.filter(item => key(true)(item) > 0).sort((a, b) => key(true)(b) - key(true)(a)).slice(0, 10);
    const downs = pool.filter(item => key(false)(item) < 0).sort((a, b) => key(false)(a) - key(false)(b)).slice(0, 10);
    const below = pool.filter(item => item.current < 0).length;
    root.querySelector('#rankingSummary').textContent = `${data.year}년 공모 상장 ${pool.length}종목${includeSpac ? '(스팩 포함)' : '(스팩 제외)'} · 공모가 대비 · ${md(data.asOf)} 종가 기준 · 지금 공모가 아래 ${below}종목`;
    root.querySelector('#rankUp').innerHTML = ups.map((item, i) => row(item, i + 1, true)).join('') || '<li class="rank-empty">공모가보다 오른 종목이 없습니다.</li>';
    root.querySelector('#rankDown').innerHTML = downs.map((item, i) => row(item, i + 1, false)).join('') || '<li class="rank-empty">공모가보다 내린 종목이 없습니다.</li>';
    root.querySelector('#rankUpTitle').textContent = basis === 'current' ? '상승률 TOP 10' : '상장 후 최고 상승률 TOP 10';
    root.querySelector('#rankDownTitle').textContent = basis === 'current' ? '하락률 TOP 10' : '상장 후 최저 하락률 TOP 10';
    root.querySelectorAll('#rankBasis button').forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.basis === basis)));
    root.querySelector('#rankSpac').setAttribute('aria-pressed', String(includeSpac));
    root.querySelector('#rankSpac').textContent = includeSpac ? '스팩 제외' : '스팩 포함';
  }

  // 매일 장 마감 후 GitHub Actions가 갱신하는 Supabase 시세를 읽는다. 실패하면 정적 파일 그대로 둔다.
  async function refreshFromDatabase() {
    const config = window.GONGMO_CONFIG || {}, key = config.supabasePublishableKey || config.supabaseAnonKey;
    if (!window.supabase || !config.supabaseUrl || !key) return;
    try {
      const db = window.supabase.createClient(config.supabaseUrl, key, { auth: { persistSession: false } });
      const { data: rows, error } = await db.from('ipo_price_history').select('code,name,listed_at,offer_price,spac,days').order('listed_at');
      if (error || !rows?.length) return;
      const items = rows.map(row => ({ code: row.code, name: row.name, listedAt: row.listed_at, offerPrice: row.offer_price, spac: row.spac, days: row.days })).filter(item => Array.isArray(item.days) && item.days.length);
      const asOf = items.reduce((max, item) => (item.days.at(-1)[0] > max ? item.days.at(-1)[0] : max), '');
      if (!items.length || (data && (asOf < data.asOf || (asOf === data.asOf && items.length <= data.items.length)))) return;
      load({ year: data?.year || asOf.slice(0, 4), asOf, items });
      render();
      window.dispatchEvent(new CustomEvent('gongmo:price-history'));
    } catch { /* 네트워크 오류는 정적 데이터로 계속 보여준다 */ }
  }

  load(data);
  if (root) {
    root.querySelector('#rankBasis').addEventListener('click', event => { const btn = event.target.closest('[data-basis]'); if (btn) { basis = btn.dataset.basis; render(); } });
    root.querySelector('#rankSpac').addEventListener('click', () => { includeSpac = !includeSpac; render(); });
  }
  render();
  refreshFromDatabase();
})();
