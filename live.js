// 상장일 실시간 차트: Supabase Edge Function(intraday)이 네이버 분봉을 대신 받아 준다.
// 장중(평일 09:00~15:30)에는 15초마다 갱신하고, 장이 끝나면 마지막 거래일 차트를 보여준다.
(function () {
  const root = document.querySelector('#live');
  const config = window.GONGMO_CONFIG || {};
  if (!root || !config.supabaseUrl) return;
  const endpoint = config.supabaseUrl.replace(/\/$/, '') + '/functions/v1/intraday';
  const POSITIVE = '#d25c4d', NEGATIVE = '#477fc1';
  const $ = selector => root.querySelector(selector);
  const won = n => Math.round(n).toLocaleString('ko-KR') + '원';
  const pct = n => (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  const escape = s => String(s).replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
  const kstNow = () => new Date(Date.now() + 9 * 3600 * 1000);
  const kstToday = () => kstNow().toISOString().slice(0, 10);
  const marketOpen = () => { const d = kstNow(), day = d.getUTCDay(), hm = d.toISOString().slice(11, 16); return day >= 1 && day <= 5 && hm >= '08:59' && hm <= '15:35'; };
  let options = [], selected = null, timer = null, lastBars = [], view = 'listing', db = null, lastData = null;
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
    lastBars = [];
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
    else { lastBars = data.bars || []; lastData = data; render(data); }
    const live = marketOpen() && lastData?.date === today.replaceAll('-', '');
    $('#liveStatus').textContent = live ? '● 실시간 · 15초마다 갱신' : '장 마감 · 마지막 거래일 기준';
    $('#liveStatus').classList.toggle('is-live', live);
    if (live) timer = setTimeout(refresh, 15000);
  }

  function render(data) {
    const bars = data.bars || [];
    const offer = selected.offerPrice;
    if (!bars.length) { $('#liveHead').innerHTML = `<b>${escape(selected.name)}</b><span class="live-muted">아직 거래 데이터가 없습니다.</span>`; $('#liveChart').innerHTML = ''; return; }
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
    const values = [...closes, ...(offer ? [offer] : [])];
    const min = Math.min(...values, ...bars.map(b => b[3]), low) * 0.995, max = Math.max(...values, ...bars.map(b => b[2]), high) * 1.005;
    const minutes = t => (Number(t.slice(0, 2)) - 9) * 60 + Number(t.slice(2));
    const x = t => padL + Math.min(minutes(t), 390) / 390 * (W - padL - padR);
    const y = v => padT + (max - v) / (max - min) * (H - padT - padB);
    // 캔들: 1분봉 하나당 몸통(시가~종가)과 꼬리(고가~저가). 상승은 빨강, 하락은 파랑(한국 증시 표기).
    const slot = (W - padL - padR) / 390, bodyW = Math.max(1, slot * 0.7);
    const candles = bars.map(b => {
      const cx = x(b[0]), up = b[4] >= b[1], c = up ? POSITIVE : NEGATIVE;
      const top = y(Math.max(b[1], b[4])), bottom = y(Math.min(b[1], b[4]));
      return `<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${y(b[2]).toFixed(1)}" y2="${y(b[3]).toFixed(1)}" stroke="${c}" stroke-width="1"></line><rect x="${(cx - bodyW / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bodyW.toFixed(1)}" height="${Math.max(1, bottom - top).toFixed(1)}" fill="${c}"></rect>`;
    }).join('');
    const ticks = Array.from({ length: 5 }, (_, i) => min + (max - min) * i / 4);
    const hours = ['0900', '1000', '1100', '1200', '1300', '1400', '1500', '1530'];
    $('#liveChart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="live-svg" role="img" aria-label="${escape(selected.name)} 분 단위 주가, 현재 ${won(last)}">` +
      ticks.map(v => `<line x1="${padL}" x2="${W - padR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="live-grid"></line><text x="${padL - 8}" y="${(y(v) + 4).toFixed(1)}" class="live-axis" text-anchor="end">${Math.round(v).toLocaleString('ko-KR')}</text>`).join('') +
      hours.map(t => `<text x="${x(t).toFixed(1)}" y="${H - 6}" class="live-axis" text-anchor="middle">${t.slice(0, 2)}:${t.slice(2)}</text>`).join('') +
      (offer ? `<line x1="${padL}" x2="${W - padR}" y1="${y(offer).toFixed(1)}" y2="${y(offer).toFixed(1)}" class="live-offer"></line><text x="${W - padR - 4}" y="${(y(offer) - 6).toFixed(1)}" class="live-axis live-offer-label" text-anchor="end">공모가 ${won(offer)}</text>` : '') +
      `<g class="live-candles">${candles}</g>` +
      `<line class="live-cross" y1="${padT}" y2="${H - padB}" hidden></line><rect class="live-hit" x="${padL}" y="${padT}" width="${W - padL - padR}" height="${H - padT - padB}"></rect></svg><div class="live-tip" hidden></div>`;
    $('#liveCaption').textContent = (data.note || '') + (isListingDay && offer ? `상장일 가격 범위: ${won(offer * 0.6)} ~ ${won(offer * 4)} (공모가 60~400%, 호가단위 반영 전). ` : '') + '시세: 네이버 금융 분 단위(정규장). 회색 선은 공모가입니다. 매수·매도 권유가 아닙니다.';
    wireHover(x, y, W, H, offer);
  }

  function wireHover(x, y, W, H, offer) {
    const svg = $('.live-svg'), cross = $('.live-cross'), tip = $('.live-tip');
    if (!svg) return;
    const move = event => {
      const rect = svg.getBoundingClientRect(), px = (event.clientX - rect.left) / rect.width * W;
      let best = lastBars[0];
      for (const bar of lastBars) if (Math.abs(x(bar[0]) - px) < Math.abs(x(best[0]) - px)) best = bar;
      cross.setAttribute('x1', x(best[0])); cross.setAttribute('x2', x(best[0])); cross.removeAttribute('hidden');
      tip.innerHTML = `<span>${best[0].slice(0, 2)}:${best[0].slice(2)}</span><b>${won(best[4])}</b>${offer ? `<span>공모가 대비 ${pct((best[4] / offer - 1) * 100)}</span>` : ''}<span>거래량 ${(best[5] || 0).toLocaleString('ko-KR')}주</span>`;
      tip.hidden = false;
      const left = Math.min(rect.width - 150, Math.max(0, x(best[0]) / W * rect.width + 12));
      tip.style.left = left + 'px'; tip.style.top = Math.max(0, y(best[4]) / H * rect.height - 30) + 'px';
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerleave', () => { cross.setAttribute('hidden', ''); tip.hidden = true; });
  }

  $('#liveSelect').addEventListener('change', event => select(Number(event.target.value)));
  $('#liveView').addEventListener('click', event => { const btn = event.target.closest('[data-view]'); if (!btn || !selected?.code) return; view = btn.dataset.view; root.querySelectorAll('#liveView button').forEach(b => b.setAttribute('aria-pressed', String(b === btn))); clearTimeout(timer); refresh(); });
  let resizeTimer; window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (lastData?.bars?.length) render(lastData); }, 150); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && selected?.code && marketOpen()) { clearTimeout(timer); refresh(); } });
  // ranking.js가 DB 시세로 목록을 갱신할 시간을 조금 준 뒤 종목 목록을 만든다.
  setTimeout(loadOptions, 400);
})();
