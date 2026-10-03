// 내 자산: 보유 종목·수량·평균 매입가를 이 브라우저(localStorage)에만 저장하고, 최신 종가로 평가손익을 계산한다.
// 계정이나 서버에 저장하지 않는다. 실제 주문과 연결되지 않는다.
(function () {
  const KEY = 'gongmo-radar-assets';
  const anchor = document.querySelector('#news') || document.querySelector('#board');
  if (!anchor) return;

  const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? v : []; } catch { return []; } };
  const write = list => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {} };
  const won = n => Math.round(n).toLocaleString('ko-KR') + '원';
  const pct = n => (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  const signed = n => (n > 0 ? '+' : '') + Math.round(n).toLocaleString('ko-KR') + '원';
  const el = (tag, attrs = {}, text) => { const node = document.createElement(tag); Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v)); if (text !== undefined) node.textContent = text; return node; };

  const section = document.createElement('section');
  section.className = 'asset';
  section.id = 'asset';
  section.innerHTML = `
    <div class="section-heading"><div><p class="eyebrow"><span></span> MY PORTFOLIO</p><h2>내 자산</h2></div></div>
    <p class="chart-caption">이 브라우저에만 저장됩니다(계정·서버 저장 없음). 평가는 최신 종가 기준이며 수수료·세금은 제외합니다. 실제 매매와 연결되지 않습니다.</p>
    <form class="asset-form" id="assetForm">
      <select name="code" aria-label="종목 선택" required></select>
      <input name="qty" type="number" min="1" step="1" placeholder="수량" aria-label="수량" required />
      <input name="avg" type="number" min="1" step="1" placeholder="평균 매입가(원)" aria-label="평균 매입가" required />
      <button type="submit" class="primary-button">추가</button>
    </form>
    <div class="asset-summary" id="assetSummary"></div>
    <div class="asset-table-wrap"><table class="asset-table"><thead><tr><th>종목</th><th>수량</th><th>평균 매입가</th><th>현재가</th><th>평가금액</th><th>평가손익</th><th>수익률</th><th></th></tr></thead><tbody id="assetRows"></tbody></table></div>`;
  anchor.insertAdjacentElement('afterend', section);

  const form = section.querySelector('#assetForm');
  const select = form.querySelector('select[name="code"]');
  const rows = section.querySelector('#assetRows');
  const summary = section.querySelector('#assetSummary');

  function items() {
    return (window.PriceHistory?.items || []).slice().sort((a, b) => b.listedAt.localeCompare(a.listedAt));
  }
  function fillSelect() {
    const list = items();
    select.innerHTML = '<option value="">종목 선택</option>' + list.map(item => `<option value="${item.code}" data-name="${item.name}">${item.name}</option>`).join('');
  }
  function lastClose(code) {
    const item = items().find(row => row.code === code);
    const last = item?.days?.at(-1);
    return last ? { price: last[4], date: last[0], offer: item.offerPrice, name: item.name } : null;
  }

  function render() {
    const holdings = read();
    rows.innerHTML = '';
    let cost = 0, value = 0, missing = 0;
    for (const holding of holdings) {
      const quote = lastClose(holding.code);
      const invested = holding.qty * holding.avg;
      cost += invested;
      const tr = el('tr');
      if (!quote) { missing++; tr.append(el('td', {}, holding.name), el('td', {}, holding.qty.toLocaleString('ko-KR')), el('td', {}, won(holding.avg)), el('td', { colspan: '4', class: 'asset-muted' }, '시세 없음')); }
      else {
        const worth = holding.qty * quote.price, gain = worth - invested, rate = (quote.price / holding.avg - 1) * 100;
        value += worth;
        const tone = gain >= 0 ? 'up' : 'down';
        tr.append(
          el('td', {}, holding.name),
          el('td', {}, holding.qty.toLocaleString('ko-KR')),
          el('td', {}, won(holding.avg)),
          el('td', {}, `${won(quote.price)} · ${quote.date.slice(5).replace('-', '.')} 종가`),
          el('td', {}, won(worth)),
          el('td', { class: tone }, signed(gain)),
          el('td', { class: tone }, pct(rate)));
      }
      const remove = el('button', { type: 'button', class: 'view-button asset-remove', 'data-code': holding.code, 'aria-label': holding.name + ' 삭제' }, '삭제');
      tr.append(el('td', {}, '')); tr.lastChild.append(remove);
      rows.append(tr);
    }
    if (!holdings.length) rows.append(el('tr', {}, '')), rows.lastChild.innerHTML = '<td colspan="8" class="asset-muted">아직 보유 종목이 없습니다. 위에서 종목을 추가해 보세요.</td>';
    const gain = value - cost, rate = cost ? (value / cost - 1) * 100 : 0;
    summary.innerHTML = holdings.length
      ? `<div><span>총 매입금액</span><b>${won(cost)}</b></div><div><span>총 평가금액</span><b>${won(value)}</b></div><div><span>평가손익</span><b class="${gain >= 0 ? 'up' : 'down'}">${signed(gain)} (${pct(rate)})</b></div>${missing ? `<p class="asset-muted">시세를 찾지 못한 ${missing}종목은 합계에서 뺐습니다.</p>` : ''}`
      : '';
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const option = select.selectedOptions[0];
    const qty = Math.floor(Number(form.qty.value)), avg = Math.round(Number(form.avg.value));
    if (!option?.value || !(qty > 0) || !(avg > 0)) return;
    const list = read().filter(row => row.code !== option.value);
    list.push({ code: option.value, name: option.dataset.name, qty, avg });
    write(list);
    form.reset();
    render();
  });

  rows.addEventListener('click', event => {
    const btn = event.target.closest('.asset-remove');
    if (!btn) return;
    write(read().filter(row => row.code !== btn.dataset.code));
    render();
  });

  fillSelect();
  render();
  setTimeout(() => { fillSelect(); render(); }, 700);
})();
