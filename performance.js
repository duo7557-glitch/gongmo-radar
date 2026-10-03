(function () {
  const datasets = { ...window.GONGMO_PERFORMANCE_MONTHS };
  if (window.GONGMO_PERFORMANCE) datasets[window.GONGMO_PERFORMANCE.month] = window.GONGMO_PERFORMANCE;
  const months = Object.keys(datasets).sort().reverse();
  if (!months.length) return;
  let selectedMonth = months[0];
  const monthLabel = month => `${month.slice(0, 4)}년 ${Number(month.slice(5))}월`;
  const heading = document.querySelector('#performance .section-heading');
  const controls = document.createElement('div');
  controls.className = 'performance-controls';
  controls.innerHTML = '<div class="month-switch" aria-label="상장 성과 월 선택"><button type="button" id="performancePrev" aria-label="이전 달">←</button><strong id="performanceMonth"></strong><button type="button" id="performanceNext" aria-label="다음 달">→</button></div>';
  controls.append(document.querySelector('#includeSpac'));
  heading.after(controls);
  const monthText = controls.querySelector('#performanceMonth');
  const moveMonth = delta => {
    const index = months.indexOf(selectedMonth);
    const nextIndex = Math.max(0, Math.min(months.length - 1, index + delta));
    selectedMonth = months[nextIndex];
    render();
  };
  controls.querySelector('#performancePrev').addEventListener('click', () => moveMonth(1));
  controls.querySelector('#performanceNext').addEventListener('click', () => moveMonth(-1));
  document.querySelector('#performance .performance-intro').textContent = '상장한 달을 선택해 공모가 배정·시초가 매수 성과를 비교하세요. 상장일을 포함한 첫 5거래일 기준이며, 청약한 달과는 다를 수 있습니다.';
  let includeSpac = false;
  let returnMetric = 'dayOneReturn';
  let lastEntries = [];
  const POSITIVE = '#d25c4d';
  const NEGATIVE = '#477fc1';
  const METRIC_LABEL = { openReturn: '첫날 시가', dayOneReturn: '첫날 종가', weekReturn: '5거래일째 종가' };
  const money = n => n == null ? '—' : n.toLocaleString('ko-KR') + '원';
  const pct = n => n == null ? '—' : (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  const result = n => `<small class="return-value ${n >= 0 ? 'positive' : 'negative'}">${pct(n)}</small>`;
  const escape = s => String(s).replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));

  function render() {
    const dataset = datasets[selectedMonth];
    monthText.textContent = monthLabel(selectedMonth);
    controls.querySelector('#performancePrev').disabled = months.indexOf(selectedMonth) === months.length - 1;
    controls.querySelector('#performanceNext').disabled = months.indexOf(selectedMonth) === 0;
    heading.querySelector('h2').textContent = `${monthLabel(selectedMonth)}, 상장 후 성과`;
    document.querySelector('#performance .performance-footnote').textContent = `상장일을 1일째로 계산하며 휴장일은 제외합니다. 수익률은 수수료·세금 전입니다. ${dataset.asOf.replaceAll('-', '.')}까지 확인한 자료로, 5거래일 미만 종목은 5일 성과 집계에서 제외합니다.`;
    if (dataset.excluded?.length) document.querySelector('#performance .performance-footnote').textContent += ` 비교 제외: ${dataset.excluded.map(item => `${item.name}(${item.reason})`).join(', ')}.`;
    const tooltip = document.querySelector('#sparkTooltip');
    if (tooltip) tooltip.hidden = true;
    const entries = dataset.items.filter(item => includeSpac || !item.spac).map(PerformanceCore.analyze);
    lastEntries = entries;
    const completed = entries.filter(item => item.fifth);
    const mean = completed.length ? completed.reduce((sum, item) => sum + item.weekReturn, 0) / completed.length : null;
    const winners = completed.filter(item => item.weekReturn > 0).length;
    document.querySelector('#performanceStats').innerHTML = `<div><span>비교 종목</span><b>${entries.length}<small>개 · ${includeSpac ? '스팩 포함' : '일반 공모주'}</small></b></div><div><span>5거래일 평균 · 공모가 대비</span><b class="${mean >= 0 ? 'positive' : 'negative'}">${pct(mean)}<small>${completed.length}개 종목 집계</small></b></div><div><span>5일째 공모가 위</span><b>${winners}<small>/ ${completed.length}개</small></b></div><div><span>첫날 장중 4배 도달</span><b>${entries.filter(x => x.quadrupleHit).length}<small>개 · 종가와 다릅니다</small></b></div>`;
    document.querySelector('#performanceRows').innerHTML = entries.map(item => `<tr><td><b>${escape(item.name)}</b><small>${item.listedAt.slice(5).replace('-', '. ')} · <a href="${item.priceSource}" target="_blank" rel="noopener noreferrer">일별 시세 ↗</a></small></td><td>${money(item.offerPrice)}</td><td>${money(item.first?.open)}${result(item.openReturn)}</td><td>${money(item.first?.close)}${result(item.dayOneReturn)}</td><td>${item.fifth ? money(item.fifth.close) + result(item.weekReturn) + '<small>' + item.fifth.date.slice(5).replace('-', '. ') + ' 종가</small>' : '<span class="pending-score">5거래일 대기</span><small>현재 ' + item.sessions + '거래일</small>'}</td><td>${item.fifth ? result(item.afterOpenReturn) : '—'}</td><td><span class="record-tag ${item.quadrupleHit ? 'record-hot' : ''}">${item.quadrupleClose ? '종가 4배' : item.quadrupleHit ? '장중 4배 도달' : item.dayOneReturn >= 100 ? '종가 +100% 이상' : '—'}</span></td></tr>`).join('');
    document.querySelector('#includeSpac').setAttribute('aria-pressed', String(includeSpac));
    if (!entries.length) document.querySelector('#performanceRows').innerHTML = `<tr><td colspan="7"><div class="empty-state"><b>${dataset.items.length ? '스팩을 제외한 상장 종목이 없습니다.' : '해당 월에 비교할 공모 신규상장 종목이 없습니다.'}</b><p>${dataset.items.length ? '스팩 포함을 선택하면 해당 종목의 성과를 볼 수 있습니다.' : '상장일 기준으로 확인한 결과입니다. 다른 달을 선택해 주세요.'}</p></div></td></tr>`;
    document.querySelector('#includeSpac').textContent = includeSpac ? '스팩 제외' : '스팩 포함';
    renderReturnChart(entries);
    // 미니 그래프는 상장일부터 최신 거래일까지 전체 종가를 그린다(전체 시세가 없으면 성과 데이터의 날짜만 사용).
    renderPriceChart(entries.map(item => ({ ...item, days: window.PriceHistory?.daysFor(item.code) || item.days })));
  }

  // 공모가 대비 수익률 비교: 가로 디버징 막대, 0을 가운데 두고 양쪽으로 자랍니다.
  function renderReturnChart(entries) {
    const el = document.querySelector('#returnChart');
    const rows = entries.filter(item => item[returnMetric] != null).sort((a, b) => b[returnMetric] - a[returnMetric]);
    if (!rows.length) { el.innerHTML = '<p class="chart-empty">선택한 달·조건에 비교할 데이터가 없습니다.</p>'; return; }
    const max = Math.max(1, ...rows.map(item => Math.abs(item[returnMetric])));
    el.innerHTML = rows.map(item => {
      const value = item[returnMetric];
      const sign = value >= 0 ? 'positive' : 'negative';
      const width = (Math.abs(value) / max * 50).toFixed(1);
      return `<div class="return-bar-row" tabindex="0"><span class="return-bar-name">${escape(item.name)}</span><span class="return-bar-track"><span class="return-bar-fill ${sign}" style="--w:${width}%"></span></span><span class="return-bar-value ${sign}">${pct(value)}</span></div>`;
    }).join('');
  }

  // 거래일별 주가 추이: 종목이 많아 한 차트에 겹치면 못 읽으므로 스몰 멀티플(카드별 미니 라인)로 나눕니다.
  function sparkCard(item) {
    const days = item.days;
    const W = 220, H = 78, padX = 8, padY = 10;
    const values = days.map(d => d.close / item.offerPrice * 100);
    const minV = Math.min(100, ...values);
    const maxV = Math.max(100, ...values);
    const range = Math.max(maxV - minV, 1);
    const xAt = i => padX + (days.length > 1 ? (i / (days.length - 1)) * (W - padX * 2) : (W - padX * 2) / 2);
    const yAt = v => H - padY - ((v - minV) / range) * (H - padY * 2);
    const points = values.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');
    const baseY = yAt(100).toFixed(1);
    const last = values[values.length - 1];
    const rising = last >= 100;
    const color = rising ? POSITIVE : NEGATIVE;
    const latestReturn = PerformanceCore.percent(days[days.length - 1].close, item.offerPrice);
    return `<div class="spark-card" data-w="${W}" data-padx="${padX}"><div class="spark-head"><b>${escape(item.name)}</b><span class="spark-badge ${rising ? 'positive' : 'negative'}">${pct(latestReturn)}</span></div><svg class="spark-svg" tabindex="0" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${escape(item.name)} 공모가 대비 ${pct(latestReturn)}, ${days.length}거래일째"><line class="spark-baseline" x1="${padX}" y1="${baseY}" x2="${W - padX}" y2="${baseY}"></line><polyline class="spark-line" points="${points}" style="stroke:${color}"></polyline><line class="spark-cross" x1="0" y1="0" x2="0" y2="${H}" hidden></line><circle class="spark-end" cx="${xAt(values.length - 1).toFixed(1)}" cy="${yAt(last).toFixed(1)}" r="4" style="fill:${color};stroke:#fff;stroke-width:2"></circle></svg><div class="spark-foot"><span>${item.listedAt.slice(5).replace('-', '.')} 상장</span><span>${days.length}거래일째</span></div></div>`;
  }

  function ensureSparkTooltip() {
    let tip = document.querySelector('#sparkTooltip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'sparkTooltip';
      tip.className = 'spark-tooltip';
      tip.hidden = true;
      tip.innerHTML = '<span class="spark-tooltip-name"></span><b class="spark-tooltip-value"></b><span class="spark-tooltip-meta"></span>';
      document.body.appendChild(tip);
    }
    return tip;
  }

  function attachSparkHover(card, item) {
    const svg = card.querySelector('.spark-svg');
    const cross = card.querySelector('.spark-cross');
    const W = Number(card.dataset.w);
    const padX = Number(card.dataset.padx);
    const days = item.days;
    const tip = ensureSparkTooltip();
    const nameEl = tip.querySelector('.spark-tooltip-name');
    const valueEl = tip.querySelector('.spark-tooltip-value');
    const metaEl = tip.querySelector('.spark-tooltip-meta');
    function move(evt) {
      const rect = svg.getBoundingClientRect();
      const relX = ((evt.clientX - rect.left) / rect.width) * W;
      const ratio = Math.min(1, Math.max(0, (relX - padX) / (W - padX * 2)));
      const idx = Math.round(ratio * (days.length - 1));
      const day = days[idx];
      const idxValue = day.close / item.offerPrice * 100;
      const crossX = (padX + ratio * (W - padX * 2)).toFixed(1);
      cross.setAttribute('x1', crossX);
      cross.setAttribute('x2', crossX);
      cross.removeAttribute('hidden');
      nameEl.textContent = item.name;
      valueEl.textContent = pct(idxValue - 100);
      valueEl.style.color = idxValue >= 100 ? POSITIVE : NEGATIVE;
      metaEl.textContent = `${day.date.slice(5).replace('-', '.')} · ${money(day.close)}`;
      tip.hidden = false;
      tip.style.left = `${evt.clientX + 14}px`;
      tip.style.top = `${evt.clientY + 14}px`;
    }
    function leave() { cross.setAttribute('hidden', ''); tip.hidden = true; }
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerleave', leave);
    svg.addEventListener('focus', () => move({ clientX: svg.getBoundingClientRect().right, clientY: svg.getBoundingClientRect().top }));
    svg.addEventListener('blur', leave);
  }

  const SPARK_PREVIEW = 3;
  function renderPriceChart(entries) {
    const grid = document.querySelector('#priceChart');
    if (!entries.length) { grid.innerHTML = '<p class="chart-empty">선택한 달·조건에 비교할 데이터가 없습니다.</p>'; return; }
    grid.innerHTML = entries.map(sparkCard).join('');
    grid.querySelectorAll('.spark-card').forEach((card, i) => { attachSparkHover(card, entries[i]); if (i >= SPARK_PREVIEW) card.classList.add('is-extra'); });
    let more = grid.nextElementSibling?.classList?.contains('spark-more') ? grid.nextElementSibling : null;
    if (!more) { more = document.createElement('button'); more.type = 'button'; more.className = 'view-button spark-more'; grid.after(more); more.addEventListener('click', () => { grid.classList.toggle('is-expanded'); more.textContent = grid.classList.contains('is-expanded') ? '접기' : more.dataset.label; }); }
    more.hidden = entries.length <= SPARK_PREVIEW;
    more.dataset.label = `더보기 (${entries.length - SPARK_PREVIEW}개)`;
    if (!grid.classList.contains('is-expanded')) more.textContent = more.dataset.label;
  }

  // ranking.js가 Supabase에서 더 최신 시세를 받으면 미니 그래프를 다시 그린다.
  window.addEventListener('gongmo:price-history', () => render());
  document.querySelector('#includeSpac').addEventListener('click', () => { includeSpac = !includeSpac; render(); });
  document.querySelectorAll('#returnMetricTabs button').forEach(btn => {
    btn.addEventListener('click', () => {
      returnMetric = btn.dataset.metric;
      document.querySelectorAll('#returnMetricTabs button').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      renderReturnChart(lastEntries);
    });
  });
  render();
})();
