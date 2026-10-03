// 상장일 실시간 차트: Supabase Edge Function(intraday)이 네이버 분봉을 대신 받아 준다.
// 장중(평일 09:00~15:30)에는 15초마다 갱신하고, 장이 끝나면 마지막 거래일 차트를 보여준다.
(function () {
  const root = document.querySelector('#live');
  const config = window.GONGMO_CONFIG || {};
  if (!root || !config.supabaseUrl) return;
  const endpoint = config.supabaseUrl.replace(/\/$/, '') + '/functions/v1/intraday';
  const POSITIVE = '#d25c4d', NEGATIVE = '#477fc1';
  const SESSION = 390, MIN_SPAN = 10;
  const $ = selector => root.querySelector(selector);
  const won = n => Math.round(n).toLocaleString('ko-KR') + '원';
  const pct = n => (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  const escape = s => String(s).replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
  const kstNow = () => new Date(Date.now() + 9 * 3600 * 1000);
  const kstToday = () => kstNow().toISOString().slice(0, 10);
  const marketOpen = () => { const d = kstNow(), day = d.getUTCDay(), hm = d.toISOString().slice(11, 16); return day >= 1 && day <= 5 && hm >= '08:59' && hm <= '15:35'; };
  const minutes = t => (Number(t.slice(0, 2)) - 9) * 60 + Number(t.slice(2));
  const clock = m => `${String(9 + Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const aggregate = (bars, step) => {
    const groups = new Map();
    for (const b of bars) {
      const m = Math.floor(minutes(b[0]) / step) * step;
      const g = groups.get(m);
      if (g) { g.h = Math.max(g.h, b[2]); g.l = Math.min(g.l, b[3]); g.c = b[4]; g.v += b[5] || 0; }
      else groups.set(m, { m, o: b[1], h: b[2], l: b[3], c: b[4], v: b[5] || 0 });
    }
    return [...groups.values()];
  };
  let options = [], selected = null, timer = null, view = 'listing', db = null, lastData = null;
  let step = 1, zoom = { t0: 0, t1: SESSION }, scale = null, drag = null;
  const client = () => (db ||= window.supabase?.createClient(config.supabaseUrl, config.supabasePublishableKey || config.supabaseAnonKey, { auth: { persistSession: false } }));

  async function upcomingListings() {
    // 청약이 최근 2주 안에 끝나 아직 시세 데이터에 없는 종목 = 곧 상장하거나 오늘 상장하는 종목
    if (!client()) return [];
    const from = new Date(kstNow().getTime() - 14 * 86400 * 1000).toISOString().slice(0, 10);
    const { data } = await client().from('ipo_listings').select('name,subscription_end,price_text,source_payload').eq('is_published', true).gte('subscription_end', from).lte('subscription_end', kstToday()).order('subscription_end', { ascending: false }).limit(12);
    return (data || []).map(row => ({ name: row.name, offerPrice: row.source_payload?.confirmed_price || null, note: `${row.subscription_end.slice(5).replace('-', '.')} 청약 마감`, upcoming: true }));
  }

  async function resolveCode(option) {
    if (option.code || option.resolved) return option.code;
    option.resolved = true;
    try { option.code = (await (await fetch(`${endpoint}?name=${encodeURIComponent(option.name)}`)).json()).code || null; } catch { option.code = null; }
    return option.code;
  }

  async function loadOptions() {
    const today = kstToday();
    const listed = (window.PriceHistory?.items || []).slice().sort((a, b) => b.listedAt.localeCompare(a.listedAt)).slice(0, 12)
      .map(item => ({ name: item.name, code: item.code, offerPrice: item.offerPrice, listedAt: item.listedAt, note: item.listedAt === today ? '오늘 상장' : `${item.listedAt.slice(5).replace('-', '.')} 상장` }));
    const known = new Set(listed.map(item => item.name.replace(/\s/g, '')));
    const upcoming = (await upcomingListings().catch(() => [])).filter(item => !known.has(item.name.replace(/\s/g, '')));
    options = [...upcoming, ...listed];
    $('#liveSelect').innerHTML = (upcoming.length ? `<optgroup label="곧 상장 · 오늘 상장">${upcoming.map((o, i) => `<option value="${i}">${escape(o.name)} · ${escape(o.note)}</option>`).join('')}</optgroup>` : '') +
      `<optgroup label="최근 상장">${listed.map((o, i) => `<option value="${upcoming.length + i}">${escape(o.name)} · ${escape(o.note)}</option>`).join('')}</optgroup>`;
    // 오늘 상장 종목을 먼저 보여 주고, 없으면 오늘 거래가 시작된 곧-상장 종목, 그것도 없으면 가장 최근 상장 종목
    let index = options.findIndex(o => o.listedAt === today);
    if (index < 0) for (const [i, o] of options.entries()) { if (!o.upcoming || i > 5) break; if (await resolveCode(o)) { index = i; break; } }
    if (index < 0) index = upcoming.length;
    if (options[index]) { $('#liveSelect').value = String(index); await select(index); }
  }

  async function select(index) {
    selected = options[index];
    zoom = { t0: 0, t1: SESSION };
    clearTimeout(timer);
    $('#liveHead').innerHTML = `<b>${escape(selected.name)}</b><span class="live-muted">불러오는 중…</span>`;
    $('#liveChart').innerHTML = '';
    if (!(await resolveCode(selected))) { $('#liveHead').innerHTML = `<b>${escape(selected.name)}</b><span class="live-muted">아직 상장 전이라 종목코드가 없습니다. 상장 당일 거래가 시작되면 실시간 차트가 표시됩니다.</span>`; return; }
    await refresh();
  }

  async function refresh() {
    const current = selected;
    const today = kstToday();
    const get = async date => { try { return await (await fetch(`${endpoint}?code=${encodeURIComponent(current.code)}${date ? '&date=' + date : ''}`)).json(); } catch { return null; } };
    let data, note = '';
    if (view === 'listing' && current.listedAt && current.listedAt !== today) {
      data = await get(current.listedAt.replaceAll('-', ''));
      if (data && !data.error && !data.bars?.length) {
        // 네이버는 분봉을 약 1~2주만 보관하므로, 지난 상장일은 DB에 보관해 둔 분봉을 쓴다.
        const { data: row } = await client()?.from('ipo_price_history').select('listing_day_bars').eq('code', current.code).maybeSingle() || {};
        if (row?.listing_day_bars?.length) data = { date: current.listedAt.replaceAll('-', ''), bars: row.listing_day_bars };
        else { data = await get(); note = '상장일 분봉은 보관 기간이 지나 최근 거래일을 표시합니다. '; }
      }
    } else data = await get();
    if (current !== selected) return;
    if (data) data.note = note;
    if (!data || data.error) $('#liveStatus').textContent = '시세 연결이 불안정합니다. 잠시 후 다시 시도합니다.';
    else { lastData = data; render(data); }
    const live = marketOpen() && lastData?.date === today.replaceAll('-', '');
    $('#liveStatus').textContent = live ? '● 실시간 · 15초마다 갱신' : '장 마감 · 마지막 거래일 기준';
    $('#liveStatus').classList.toggle('is-live', live);
    if (live) timer = setTimeout(refresh, 15000);
  }

  function redraw() { if (lastData?.bars?.length) render(lastData); }

  function render(data) {
    const bars = data.bars || [];
    const offer = selected.offerPrice;
    if (!bars.length) { $('#liveHead').innerHTML = `<b>${escape(selected.name)}</b><span class="live-muted">아직 거래 데이터가 없습니다.</span>`; $('#liveChart').innerHTML = ''; scale = null; return; }
    // 네이버 분봉의 15:30 값은 통합 시세라 거래소 종가와 다를 수 있다. 장이 끝난 날은 거래소 공식 일별 시세로 맞춘다.
    const isoDate = data.date ? `${data.date.slice(0, 4)}-${data.date.slice(4, 6)}-${data.date.slice(6)}` : '';
    const official = (window.PriceHistory?.daysFor(selected.code) || []).find(day => day.date === isoDate);
    if (official) { const lastBar = bars.at(-1); if (lastBar[0] === '1530') lastBar[4] = official.close; else bars.push(['1530', official.close, official.close, official.close, official.close, 0]); }
    const closes = bars.map(b => b[4]), open = official?.open ?? bars[0][1], last = official?.close ?? closes.at(-1);
    const high = official?.high ?? Math.max(...bars.map(b => b[2])), low = official?.low ?? Math.min(...bars.map(b => b[3])), volume = bars.reduce((sum, b) => sum + (b[5] || 0), 0);
    const date = data.date ? `${data.date.slice(4, 6)}.${data.date.slice(6)}` : '';
    const isListingDay = selected.listedAt ? selected.listedAt.replaceAll('-', '') === data.date : bars.length && data.date === kstToday().replaceAll('-', '');
    const color = offer ? (last >= offer ? POSITIVE : NEGATIVE) : (last >= open ? POSITIVE : NEGATIVE);
    $('#liveHead').innerHTML = `<b>${escape(selected.name)}</b><span class="live-muted">${official ? '종가(거래소)' : '현재가'}</span><span class="live-price" style="color:${color}">${won(last)}</span>` +
      (offer ? `<span class="live-chip" style="color:${color}">공모가 대비 ${pct((last / offer - 1) * 100)}</span>` : '') +
      `<span class="live-chip">시초가 ${won(open)} (${offer ? pct((open / offer - 1) * 100) : '공모가 확인중'})</span><span class="live-chip">고가 ${won(high)} · 저가 ${won(low)}</span><span class="live-muted">${date}${isListingDay ? ' 상장일' : ''}${official ? '' : ` · 거래량 ${volume.toLocaleString('ko-KR')}주`}</span>`;

    const W = Math.max(320, Math.round($('#liveChart').clientWidth || 900)), H = 300, padL = 64, padR = 16, padT = 14, padB = 26;
    const innerW = W - padL - padR, innerH = H - padT - padB;
    const span = zoom.t1 - zoom.t0, full = span >= SESSION;
    const candlesAll = aggregate(bars, step);
    const shown = candlesAll.filter(c => c.m + step >= zoom.t0 && c.m <= zoom.t1);
    const basis = shown.length ? shown : candlesAll;
    const values = [...basis.flatMap(c => [c.h, c.l]), ...(full ? [offer, high, low].filter(Boolean) : [])];
    const min = Math.min(...values) * 0.995, max = Math.max(...values) * 1.005;
    const xm = m => padL + (m - zoom.t0) / span * innerW;
    const y = v => padT + (max - v) / (max - min) * innerH;
    scale = { W, H, padL, innerW, span, xm, y, shown, offer, min, max };
    // 캔들: 분봉 간격(1·3·5·10·30분)마다 몸통(시가~종가)과 꼬리(고가~저가). 상승은 빨강, 하락은 파랑(한국 증시 표기).
    const bodyW = Math.max(1, innerW / span * step * 0.7);
    const candles = shown.map(c => {
      const cx = xm(c.m + step / 2), up = c.c >= c.o, col = up ? POSITIVE : NEGATIVE;
      const top = y(Math.max(c.o, c.c)), bottom = y(Math.min(c.o, c.c));
      return `<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${y(c.h).toFixed(1)}" y2="${y(c.l).toFixed(1)}" stroke="${col}" stroke-width="1"></line><rect x="${(cx - bodyW / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bodyW.toFixed(1)}" height="${Math.max(1, bottom - top).toFixed(1)}" fill="${col}"></rect>`;
    }).join('');
    const ticks = Array.from({ length: 5 }, (_, i) => min + (max - min) * i / 4);
    const every = span <= 90 ? 15 : span <= 180 ? 30 : 60;
    const hours = []; for (let m = 0; m <= SESSION; m += every) if (m >= zoom.t0 && m <= zoom.t1) hours.push(m);
    if (zoom.t1 >= SESSION && !hours.includes(SESSION)) hours.push(SESSION);
    $('#liveChart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="live-svg" role="img" aria-label="${escape(selected.name)} ${step}분봉 주가, 현재 ${won(last)}">` +
      ticks.map(v => `<line x1="${padL}" x2="${W - padR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="live-grid"></line><text x="${padL - 8}" y="${(y(v) + 4).toFixed(1)}" class="live-axis" text-anchor="end">${Math.round(v).toLocaleString('ko-KR')}</text>`).join('') +
      hours.map(m => `<text x="${xm(m).toFixed(1)}" y="${H - 6}" class="live-axis" text-anchor="middle">${clock(m)}</text>`).join('') +
      (offer && offer >= min && offer <= max ? `<line x1="${padL}" x2="${W - padR}" y1="${y(offer).toFixed(1)}" y2="${y(offer).toFixed(1)}" class="live-offer"></line><text x="${W - padR - 4}" y="${(y(offer) - 6).toFixed(1)}" class="live-axis live-offer-label" text-anchor="end">공모가 ${won(offer)}</text>` : '') +
      `<g class="live-candles">${candles}</g>` +
      `<line class="live-cross" y1="${padT}" y2="${H - padB}" hidden></line></svg><div class="live-tip" hidden></div>`;
    $('#liveCaption').textContent = (data.note || '') + (isListingDay && offer ? `상장일 가격 범위: ${won(offer * 0.6)} ~ ${won(offer * 4)} (공모가 60~400%, 호가단위 반영 전). ` : '') + '시세: 네이버 금융 분 단위(정규장). 휠로 확대·축소, 드래그로 이동, 더블클릭으로 전체 보기. 회색 선은 공모가입니다. 매수·매도 권유가 아닙니다.';
  }

  const chart = $('#liveChart');
  function onMove(event) {
    if (drag || !scale) return;
    const svg = $('.live-svg'), cross = $('.live-cross'), tip = $('.live-tip');
    if (!svg || !cross || !tip) return;
    const rect = svg.getBoundingClientRect(), px = (event.clientX - rect.left) / rect.width * scale.W;
    if (px < scale.padL || px > scale.W - 16) { cross.setAttribute('hidden', ''); tip.hidden = true; return; }
    const m = zoom.t0 + (px - scale.padL) / scale.innerW * scale.span;
    let best = null;
    for (const c of scale.shown) if (!best || Math.abs(c.m + step / 2 - m) < Math.abs(best.m + step / 2 - m)) best = c;
    if (!best) return;
    const cx = scale.xm(best.m + step / 2);
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.removeAttribute('hidden');
    const range = step > 1 ? `${clock(best.m)}~${clock(best.m + step)}` : clock(best.m);
    tip.innerHTML = `<span>${range}</span><b>${won(best.c)}</b>${scale.offer ? `<span>공모가 대비 ${pct((best.c / scale.offer - 1) * 100)}</span>` : ''}<span>거래량 ${best.v.toLocaleString('ko-KR')}주</span>`;
    tip.hidden = false;
    const left = Math.min(rect.width - 150, Math.max(0, cx / scale.W * rect.width + 12));
    tip.style.left = left + 'px'; tip.style.top = Math.max(0, scale.y(best.c) / scale.H * rect.height - 30) + 'px';
  }
  chart.addEventListener('pointermove', onMove);
  chart.addEventListener('pointerleave', () => { if (drag) return; const cross = $('.live-cross'), tip = $('.live-tip'); cross?.setAttribute('hidden', ''); if (tip) tip.hidden = true; });

  chart.addEventListener('wheel', event => {
    if (!scale) return;
    event.preventDefault();
    const rect = $('.live-svg').getBoundingClientRect(), px = (event.clientX - rect.left) / rect.width * scale.W;
    const anchor = Math.min(zoom.t1, Math.max(zoom.t0, zoom.t0 + (px - scale.padL) / scale.innerW * scale.span));
    const cur = zoom.t1 - zoom.t0, next = Math.min(SESSION, Math.max(MIN_SPAN, cur * (event.deltaY < 0 ? 0.8 : 1.25)));
    const t0 = Math.min(Math.max(0, anchor - (anchor - zoom.t0) / cur * next), SESSION - next);
    zoom = { t0, t1: t0 + next };
    redraw();
  }, { passive: false });

  chart.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !scale) return;
    drag = { x: event.clientX, t0: zoom.t0, t1: zoom.t1 };
    chart.classList.add('is-drag');
  });
  window.addEventListener('pointermove', event => {
    if (!drag || !scale) return;
    const rect = $('.live-svg').getBoundingClientRect(), span = drag.t1 - drag.t0;
    const dm = -(event.clientX - drag.x) / rect.width * scale.W / scale.innerW * span;
    const t0 = Math.min(Math.max(0, drag.t0 + dm), SESSION - span);
    zoom = { t0, t1: t0 + span };
    redraw();
  });
  window.addEventListener('pointerup', () => { drag = null; chart.classList.remove('is-drag'); });
  chart.addEventListener('dblclick', () => { zoom = { t0: 0, t1: SESSION }; redraw(); });

  chart.insertAdjacentHTML('beforebegin', `<div class="live-tools" role="group" aria-label="분봉 간격">
    <span class="live-muted">간격</span>
    ${[1, 3, 5, 10, 30].map(n => `<button type="button" data-tf="${n}" aria-pressed="${n === step}">${n}분</button>`).join('')}
    <button type="button" data-reset>전체 보기</button>
    <span class="live-muted">휠: 확대·축소 · 드래그: 이동</span></div>`);
  $('.live-tools').addEventListener('click', event => {
    const btn = event.target.closest('button');
    if (!btn) return;
    if (btn.dataset.reset !== undefined) zoom = { t0: 0, t1: SESSION };
    else step = Number(btn.dataset.tf);
    root.querySelectorAll('.live-tools [data-tf]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.tf) === step)));
    redraw();
  });

  $('#liveSelect').addEventListener('change', event => select(Number(event.target.value)));
  $('#liveView').addEventListener('click', event => { const btn = event.target.closest('[data-view]'); if (!btn || !selected?.code) return; view = btn.dataset.view; root.querySelectorAll('#liveView button').forEach(b => b.setAttribute('aria-pressed', String(b === btn))); clearTimeout(timer); refresh(); });
  let resizeTimer; window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(redraw, 150); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && selected?.code && marketOpen()) { clearTimeout(timer); refresh(); } });
  // ranking.js가 DB 시세로 목록을 갱신할 시간을 조금 준 뒤 종목 목록을 만든다.
  setTimeout(loadOptions, 400);
})();
