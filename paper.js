// 모의투자: 가상 자금 1억 원으로 상장 종목을 사고파는 시뮬레이션. 이 브라우저(localStorage)에만 저장되며 실제 주문과 연결되지 않는다.
// 체결가는 최신 종가로 가정하고 수수료(매수·매도)와 매도 세금을 반영한다.
(function () {
  const KEY = 'gongmo-radar-paper';
  const START = 100000000, FEE = 0.00015, TAX = 0.0018;
  const anchor = document.querySelector('#news') || document.querySelector('#board');
  if (!anchor) return;
  if (!document.querySelector('link[href="paper.css"]')) { const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'paper.css'; document.head.appendChild(link); }

  const fresh = () => ({ cash: START, holdings: {}, trades: [] });
  const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return v && typeof v.cash === 'number' ? v : fresh(); } catch { return fresh(); } };
  let state = read();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} };
  const won = n => Math.round(n).toLocaleString('ko-KR') + '원';
  const pct = n => (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  const signed = n => (n > 0 ? '+' : '') + Math.round(n).toLocaleString('ko-KR') + '원';
  const el = (tag, attrs = {}, text) => { const node = document.createElement(tag); Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v)); if (text !== undefined) node.textContent = text; return node; };

  const section = document.createElement('section');
  section.className = 'paper';
  section.id = 'paper';
  section.innerHTML = `
    <div class="section-heading"><div><p class="eyebrow"><span></span> PAPER TRADING</p><h2>모의투자</h2></div>
      <button type="button" class="view-button" id="paperReset">처음부터 다시</button></div>
    <p class="chart-caption">가상 자금 1억 원으로 상장 종목을 사고파는 연습입니다. 체결가는 최신 종가, 수수료 0.015%·매도 세금 0.18%를 가정합니다. 실제 주문이나 투자 권유가 아닙니다.</p>
    <form class="paper-form" id="paperForm">
      <select name="code" aria-label="종목 선택" required></select>
      <input name="qty" type="number" min="1" step="1" placeholder="수량" aria-label="수량" required />
      <button type="submit" name="side" value="buy" class="primary-button">매수</button>
      <button type="submit" name="side" value="sell" class="view-button">매도</button>
    </form>
    <p class="paper-feedback" id="paperFeedback" role="status"></p>
    <div class="paper-summary" id="paperSummary"></div>
    <div class="paper-table-wrap"><table class="paper-table"><thead><tr><th>종목</th><th>수량</th><th>평균 매입가</th><th>현재가</th><th>평가금액</th><th>평가손익</th><th>수익률</th></tr></thead><tbody id="paperHoldings"></tbody></table></div>
    <h3 class="paper-sub">거래 내역</h3>
    <div class="paper-table-wrap"><table class="paper-table"><thead><tr><th>체결일</th><th>구분</th><th>종목</th><th>수량</th><th>체결가</th><th>수수료·세금</th><th>실현손익</th></tr></thead><tbody id="paperTrades"></tbody></table></div>`;
  anchor.insertAdjacentElement('afterend', section);

  const form = section.querySelector('#paperForm');
  const select = form.querySelector('select[name="code"]');
  const feedback = section.querySelector('#paperFeedback');
  const items = () => (window.PriceHistory?.items || []).slice().sort((a, b) => b.listedAt.localeCompare(a.listedAt));
  const quote = code => { const item = items().find(row => row.code === code); const last = item?.days?.at(-1); return last ? { price: last[4], date: last[0], name: item.name } : null; };

  function fillSelect() {
    const current = select.value;
    select.innerHTML = '<option value="">종목 선택</option>' + items().map(item => `<option value="${item.code}">${item.name}</option>`).join('');
    if (current) select.value = current;
  }

  function render() {
    let holdingsValue = 0;
    const holdings = section.querySelector('#paperHoldings');
    holdings.innerHTML = '';
    for (const [code, h] of Object.entries(state.holdings)) {
      const q = quote(code);
      const price = q ? q.price : h.avg;
      const worth = h.qty * price, gain = worth - h.qty * h.avg;
      holdingsValue += worth;
      const tone = gain >= 0 ? 'up' : 'down';
      const tr = el('tr');
      tr.append(el('td', {}, h.name), el('td', {}, h.qty.toLocaleString('ko-KR')), el('td', {}, won(h.avg)),
        el('td', {}, q ? `${won(q.price)} · ${q.date.slice(5).replace('-', '.')}` : '시세 없음'), el('td', {}, won(worth)),
        el('td', { class: tone }, signed(gain)), el('td', { class: tone }, pct((price / h.avg - 1) * 100)));
      holdings.append(tr);
    }
    if (!Object.keys(state.holdings).length) { const tr = el('tr'); tr.append(el('td', { colspan: '7', class: 'paper-muted' }, '보유 종목이 없습니다. 위에서 매수해 보세요.')); holdings.append(tr); }

    const total = state.cash + holdingsValue, ret = (total / START - 1) * 100;
    const realized = state.trades.filter(t => t.side === 'sell').reduce((sum, t) => sum + t.pnl, 0);
    section.querySelector('#paperSummary').innerHTML = `<div><span>총 자산</span><b>${won(total)}</b></div><div><span>현금</span><b>${won(state.cash)}</b></div><div><span>수익률 (시작 1억 원)</span><b class="${ret >= 0 ? 'up' : 'down'}">${pct(ret)}</b></div><div><span>실현손익</span><b class="${realized >= 0 ? 'up' : 'down'}">${signed(realized)}</b></div>`;

    const trades = section.querySelector('#paperTrades');
    trades.innerHTML = '';
    for (const t of state.trades.slice(-30).reverse()) {
      const tr = el('tr');
      tr.append(el('td', {}, t.at.slice(5, 16).replace('T', ' ')), el('td', { class: t.side === 'buy' ? 'up' : 'down' }, t.side === 'buy' ? '매수' : '매도'), el('td', {}, t.name), el('td', {}, t.qty.toLocaleString('ko-KR')), el('td', {}, won(t.price)), el('td', {}, won(t.cost)), el('td', { class: t.side === 'sell' ? (t.pnl >= 0 ? 'up' : 'down') : '' }, t.side === 'sell' ? signed(t.pnl) : '-'));
      trades.append(tr);
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const side = event.submitter?.value;
    const option = select.selectedOptions[0];
    const qty = Math.floor(Number(form.qty.value));
    feedback.textContent = '';
    if (!option?.value || !(qty > 0)) { feedback.textContent = '종목과 수량을 입력해 주세요.'; return; }
    const q = quote(option.value);
    if (!q) { feedback.textContent = '이 종목의 최신 종가를 찾지 못했습니다.'; return; }
    const at = new Date().toISOString();
    if (side === 'buy') {
      const gross = q.price * qty, fee = Math.round(gross * FEE), cost = gross + fee;
      if (cost > state.cash) { feedback.textContent = `현금이 부족합니다. 필요 ${won(cost)} · 보유 ${won(state.cash)}`; return; }
      const h = state.holdings[option.value] || { name: q.name, qty: 0, avg: 0 };
      const newQty = h.qty + qty;
      h.avg = (h.avg * h.qty + cost) / newQty; h.qty = newQty; h.name = q.name;
      state.holdings[option.value] = h;
      state.cash -= cost;
      state.trades.push({ at, side: 'buy', code: option.value, name: q.name, qty, price: q.price, cost: fee, pnl: 0 });
    } else {
      const h = state.holdings[option.value];
      if (!h || h.qty < qty) { feedback.textContent = `보유 수량(${h ? h.qty : 0}주)보다 많이 팔 수 없습니다.`; return; }
      const gross = q.price * qty, fee = Math.round(gross * FEE), tax = Math.round(gross * TAX), net = gross - fee - tax;
      const pnl = net - h.avg * qty;
      h.qty -= qty;
      if (h.qty === 0) delete state.holdings[option.value];
      state.cash += net;
      state.trades.push({ at, side: 'sell', code: option.value, name: q.name, qty, price: q.price, cost: fee + tax, pnl });
    }
    save();
    form.qty.value = '';
    render();
  });

  section.querySelector('#paperReset').addEventListener('click', () => {
    if (window.confirm('모의투자 기록을 모두 지우고 1억 원으로 다시 시작할까요?')) { state = fresh(); save(); render(); }
  });

  fillSelect();
  render();
  setTimeout(() => { fillSelect(); render(); }, 700);
})();
