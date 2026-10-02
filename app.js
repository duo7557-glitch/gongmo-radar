const $ = selector => document.querySelector(selector);
const { koreaDate, statusOf, scoreOf, inMonth, selectListings } = window.RadarCore;
const config = window.GONGMO_CONFIG || {};
const publicKey = config.supabasePublishableKey || config.supabaseAnonKey;
let db = null;
try { if (config.supabaseUrl && publicKey && window.supabase) db = window.supabase.createClient(config.supabaseUrl, publicKey); } catch {}
const today = koreaDate();
let currentMonth = today.slice(0, 7), ipoData = [], demoMode = false, dataState = db ? 'loading' : 'unconfigured';
let savedOnly = false, quickFilter = 'all', channel, messages = [], sending = false, lastSentAt = 0, blockedUntil = 0, reportId;
const room = config.chatRoom || 'lobby';
const readStored = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const store = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
let saved = readStored('gongmo-radar-saved', []);
if (!Array.isArray(saved)) saved = [];
let includeSpac = readStored('gongmo-radar-spac', false) === true;
const isSpac = item => item.sector === 'SPAC' || /스팩|SPAC|기업인수목적/i.test(item.name || '');
let viewMode = readStored('gongmo-radar-view', 'list'); if (!['list', 'calendar'].includes(viewMode)) viewMode = 'list';
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const dateLabel = value => value ? value.slice(5).replace('-', '. ') : '확인중';
const monthText = month => `${month.slice(0, 4)}년 ${Number(month.slice(5))}월`;
const scoreLabel = item => scoreOf(item) === null ? '분석 대기' : `${scoreOf(item)}점`;
// 🔥 HOT: 공시 숫자 기준(자동 분석 80점 이상, 기관 수요예측 1,000:1 이상, 희망가 상단 초과 확정) 중 하나라도 해당하면 표시한다.
const hotReasons = item => {
  const p = item.source_payload || {}, s = p.score_signals || {}, reasons = [], score = scoreOf(item);
  const demand = s.demand_ratio?.value, lockup = s.lockup_rate?.value, top = Array.isArray(p.price_band) ? p.price_band[1] : null, confirmed = p.confirmed_price;
  if (score !== null && score >= 80) reasons.push(`분석 점수 ${score}점`);
  if (demand >= 1000) reasons.push(`기관 수요예측 ${demand.toLocaleString('ko-KR')}:1`);
  if (confirmed && top && confirmed > top) reasons.push(`희망가 상단 ${top.toLocaleString('ko-KR')}원 초과 확정`);
  if (reasons.length && lockup >= 10) reasons.push(`의무보유확약 ${lockup}%`);
  return reasons;
};
const hotBadge = item => { const reasons = hotReasons(item); return reasons.length ? `<span class="hot-badge" title="${escapeHtml('핫한 공모주 · ' + reasons.join(' · '))}">🔥 HOT</span>` : ''; };

// 상세 창 핵심 체크리스트: 공시에서 자동으로 확인되는 숫자만 보여주고, 없으면 추측하지 않고 "확인 불가"로 표시한다.
const fmtWon = n => Math.round(n).toLocaleString('ko-KR') + '원';
const fmtEok = n => n >= 1e12 ? (n / 1e12).toFixed(2) + '조원' : Math.round(n / 1e8).toLocaleString('ko-KR') + '억원';
function checklistRows(item) {
  const p = item.source_payload || {}, s = p.score_signals || {}, beforeDemand = !p.final_terms_receipt_no;
  const unknown = why => '<span class="check-unknown">확인 불가' + (why ? ' · ' + why : '') + '</span>';
  const [low, high] = Array.isArray(p.price_band) ? p.price_band : [], confirmed = p.confirmed_price, shares = p.offer_shares;
  const position = !confirmed || !high ? null : confirmed > high ? '희망가 상단 초과' : confirmed === high ? '희망가 상단' : low && confirmed < low ? '희망가 하단 미만' : '희망가 밴드 안';
  const rows = [
    ['공모가', confirmed ? fmtWon(confirmed) + (position ? ' · ' + position : '') + (high ? ' (희망 ' + fmtWon(low) + '~' + fmtWon(high) + ')' : '') : high ? '희망 ' + fmtWon(low) + '~' + fmtWon(high) + ' · 확정 전' : unknown('공시 확인 필요'), '확정 공모가가 희망 밴드 상단을 넘으면 기관 수요가 강했다는 뜻입니다.'],
    ['기관 수요예측 경쟁률', s.demand_ratio ? s.demand_ratio.value.toLocaleString('ko-KR') + ' : 1' : unknown(beforeDemand ? '수요예측 결과 공시 전' : '원문에서 확인 안 됨'), '기관투자자들이 배정 물량보다 몇 배 많이 신청했는지입니다.'],
    ['의무보유확약 비율', s.lockup_rate ? s.lockup_rate.value + '%' : unknown(beforeDemand ? '수요예측 결과 공시 전' : '원문에서 확인 안 됨'), '기관이 상장 후 일정 기간 팔지 않겠다고 약속한 비율입니다. 높을수록 상장 직후 매물이 적습니다.'],
    ['상장일 유통가능물량', s.float_rate ? s.float_rate.value + '%' : unknown('원문에서 확인 안 됨'), '상장 첫날 바로 팔 수 있는 주식 비율입니다. 낮을수록 매물 부담이 적습니다.'],
    ['공모주식수 · 공모금액', shares ? shares.toLocaleString('ko-KR') + '주 · ' + (confirmed ? fmtEok(shares * confirmed) + ' (확정가 기준)' : high ? fmtEok(shares * low) + '~' + fmtEok(shares * high) + ' (희망가 기준)' : unknown()) : unknown(), '공모주식수 × 공모가로 계산합니다.'],
    ['구주매출 비중', shares && p.seller_shares != null ? (p.seller_shares ? Math.round(p.seller_shares / shares * 100) + '% (' + p.seller_shares.toLocaleString('ko-KR') + '주)' : '0% · 전량 신주') : unknown(), '기존 주주가 이번 공모에서 파는 주식 비중입니다. 높으면 회사가 아닌 기존 주주에게 돈이 갑니다.'],
    ['상장일 가격 범위', confirmed ? fmtWon(confirmed * 0.6) + ' ~ ' + fmtWon(confirmed * 4) + ' <small>= 공모가 × 60%~400%, 호가단위 반영 전</small>' : unknown('확정 공모가 공시 후 계산'), '현행 신규상장 제도의 상장 첫날 가격 범위입니다. 최고가 도달을 가정하면 안 됩니다.']
  ];
  return '<section class="detail-checklist"><h3>핵심 체크리스트</h3><p class="check-note">공시(DART)에서 자동 확인한 값입니다. 확인되지 않은 값은 추측하지 않습니다.</p><dl>' + rows.map(([label, value, help]) => '<div><dt>' + label + '</dt><dd>' + value + '<small>' + help + '</small></dd></div>').join('') + '</dl>' +
    (confirmed ? '<div class="breakeven" data-price="' + confirmed + '"><h4>비용 포함 손익분기 계산</h4><label>배정 주수 <input type="number" min="1" value="1" data-be="shares"></label><label>청약수수료(원) <input type="number" min="0" value="2000" data-be="fee"></label><label>매도 수수료·세금(가정, %) <input type="number" min="0" step="0.01" value="0.2" data-be="rate"></label><p data-be="out"></p></div>' : '') +
    '<p class="check-note">수요예측 경쟁률이나 확약 비율은 상장 후 주가를 보장하지 않습니다. 증권사별 청약수수료와 세율은 실제 조건을 확인해 주세요.</p></section>';
}
function wireBreakeven(root) {
  const box = root.querySelector('.breakeven'); if (!box) return;
  const price = Number(box.dataset.price), get = key => Number(box.querySelector('[data-be="' + key + '"]').value) || 0;
  const update = () => {
    const shares = Math.max(1, Math.floor(get('shares'))), fee = get('fee'), rate = get('rate') / 100;
    const breakeven = (price * shares + fee) / (shares * (1 - rate));
    box.querySelector('[data-be="out"]').innerHTML = '손익분기 매도가 <b>' + fmtWon(Math.ceil(breakeven)) + '</b> (공모가 대비 +' + ((breakeven / price - 1) * 100).toFixed(2) + '%)<small>= (공모가 ' + fmtWon(price) + ' × ' + shares + '주 + 수수료 ' + fmtWon(fee) + ') ÷ (' + shares + '주 × (1 − ' + (rate * 100).toFixed(2) + '%))</small>';
  };
  box.addEventListener('input', update); update();
}
const scoreColor = score => score >= 80 ? '#3fa265' : score >= 70 ? '#e49b28' : '#909b94';
const sourceUrl = (value, host) => { try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === host ? u.href : null; } catch { return null; } };
const fromDbListing = row => ({ ...row, month: row.subscription_start?.slice(0, 7), dates: `${dateLabel(row.subscription_start)} — ${dateLabel(row.subscription_end)}`, price: row.price_text, tags: Array.isArray(row.tags) ? row.tags : [] });
const demoData = [
  ['에코네트웍스', '친환경 소재', '13', '14', '18,000 — 21,000원', '미래에셋증권', 82, '유통물량과 성장성을 함께 비교하는 분석 예시입니다.', ['유통물량 확인', '성장성']],
  ['메디큐브랩', '의료 AI', '20', '21', '12,000 — 15,000원', '한국투자증권', 76, '기업의 성장성과 공모가 산정 근거를 비교하는 예시입니다.', ['성장 산업', '밸류 확인']],
  ['모션로보틱스', '산업 자동화', '27', '28', '24,000 — 28,000원', 'NH투자증권', 71, '수주 흐름과 상장 직후 매물 부담을 비교하는 예시입니다.', ['수주 확인', '유통 주의']],
  ['다온스팩 12호', 'SPAC', '25', '26', '2,000원', '삼성증권', null, '스팩은 일반 기업 공모주와 별도로 비교합니다.', ['스팩']]
];
function displayedData() {
  return demoMode ? demoData.map((x, i) => fromDbListing({ id: `demo-${i}`, name: x[0], sector: x[1], subscription_start: `${currentMonth}-${x[2]}`, subscription_end: `${currentMonth}-${x[3]}`, price_text: x[4], broker: x[5], score: x[6], score_status: x[6] === null ? 'pending' : 'complete', reason: x[7], tags: x[8], status: '예정' })) : ipoData;
}
function render() {
  // 스팩은 상장 후 성과처럼 기본 제외하고, '스팩 포함'을 누르면 함께 보여준다.
  const all = displayedData().filter(item => includeSpac || !isSpac(item)), monthly = all.filter(item => inMonth(item, currentMonth));
  const baseEntries = selectListings(all, { month: currentMonth, search: $('#stockSearch').value, status: $('#statusFilter').value, sort: $('#sortFilter').value, savedOnly, saved });
  $('#monthLabel').textContent = monthText(currentMonth); $('#heroMonth').textContent = `${Number(currentMonth.slice(5))}월`;
  $('#savedCount').textContent = saved.length; $('#demoWarning').hidden = !demoMode;
  $('#demoToggle').textContent = demoMode ? '실제 데이터 보기' : '예시 화면 보기'; $('#demoToggle').setAttribute('aria-pressed', String(demoMode));
  $('#calendarSpac').setAttribute('aria-pressed', String(includeSpac)); $('#calendarSpac').textContent = includeSpac ? '스팩 제외' : '스팩 포함';
  $('#savedFilter').setAttribute('aria-pressed', String(savedOnly)); $('#savedFilter').textContent = savedOnly ? '★ 관심만 보기' : '☆ 관심만 보기';
  const statusText = { loading: '공시 데이터를 불러오는 중', live: '공시 데이터 연결됨', error: '데이터를 불러오지 못했습니다. 새로고침해 주세요.', unconfigured: '공시 데이터 연결 준비중' };
  $('#dataStatus').textContent = demoMode ? '예시 모드 · 가상 기업과 점수' : statusText[dataState]; $('#dataStatus').dataset.state = demoMode ? 'demo' : dataState;
  const scored = monthly.filter(item => scoreOf(item) !== null && !['철회', '연기'].includes(statusOf(item)));
  $('#stockCount').textContent = monthly.length; $('#upcomingCount').textContent = `${monthly.filter(item => ['예정', '진행중'].includes(statusOf(item))).length}개`;
  $('#avgScore').textContent = scored.length ? `${Math.round(scored.reduce((sum, item) => sum + scoreOf(item), 0) / scored.length)}점` : '분석 대기';
  $('#heroScore').textContent = scored.length ? Math.max(...scored.map(scoreOf)) : '—';
  const active = monthly.filter(item => ['예정', '진행중'].includes(statusOf(item))).sort((a, b) => a.subscription_start.localeCompare(b.subscription_start));
  $('#nextDate').textContent = active.length ? dateLabel(active[0].subscription_start) : '—';
  const threeDaysLater = new Date(`${today}T00:00:00Z`); threeDaysLater.setUTCDate(threeDaysLater.getUTCDate() + 3);
  const closingSoon = active.filter(item => item.subscription_end >= today && item.subscription_end <= threeDaysLater.toISOString().slice(0, 10));
  $('#closingCount').textContent = closingSoon.length;
  const entries = quickFilter === 'active' ? baseEntries.filter(item => statusOf(item) === '진행중') : quickFilter === 'closing' ? baseEntries.filter(item => item.subscription_end >= today && item.subscription_end <= threeDaysLater.toISOString().slice(0, 10)) : quickFilter === 'hot' ? baseEntries.filter(item => hotReasons(item).length) : baseEntries;
  $('#calendarCta').innerHTML = active.length ? `이번 달 ${active.length}개 일정 보기 <span>→</span>` : '월별 일정 보기 <span>→</span>';
  $('#resultCount').textContent = monthly.length ? `${entries.length}개 종목 표시 중` : '';
  document.querySelectorAll('#quickFilter button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.quick === quickFilter)));
  renderActionRail(monthly, active, closingSoon);
  const newest = monthly.map(item => item.updated_at).filter(Boolean).sort().at(-1);
  $('#lastUpdated').textContent = demoMode ? '가상 데이터 · 실제 청약에 사용할 수 없습니다.' : newest ? `공시 반영 ${new Date(newest).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}` : '청약일 기준으로 월별 자동 분류합니다.';
  const empty = dataState === 'loading' && !demoMode ? '공모주 일정을 불러오는 중입니다.' : monthly.length ? '검색 조건에 맞는 공모주가 없습니다.' : '이 달의 공모주가 아직 등록되지 않았습니다.';
  $('#ipoRows').innerHTML = entries.length ? entries.map(item => {
    const id = escapeHtml(item.id), score = scoreOf(item), status = statusOf(item);
    return `<tr><td><div class="stock-name"><button class="save-button ${saved.includes(String(item.id)) ? 'is-saved' : ''}" data-save="${id}" aria-label="${escapeHtml(item.name)} 관심 등록" aria-pressed="${saved.includes(String(item.id))}">${saved.includes(String(item.id)) ? '★' : '☆'}</button><div><b>${escapeHtml(item.name)}</b>${hotBadge(item)}<small>${escapeHtml(item.sector || '업종 확인중')} <span class="status-badge ${status === '진행중' ? 'active' : ''}">${escapeHtml(status)}</span></small></div></div></td><td>${escapeHtml(item.dates)}</td><td>${escapeHtml(item.price || '공시 확인중')}</td><td class="broker">${escapeHtml(item.broker || '확인중')}</td><td>${score === null ? '<span class="pending-score">분석 대기</span>' : `<span class="score"><i style="--score:${score}%;--score-color:${scoreColor(score)}"></i>${score}점</span>`}</td><td><button class="view-button" data-detail="${id}">분석 보기</button></td></tr>`;
  }).join('') : `<tr><td colspan="6"><div class="empty-state"><span>◎</span><b>${escapeHtml(empty)}</b><p>${monthly.length ? '검색어 또는 필터를 변경해 보세요.' : '새 공시가 등록되면 해당 월 일정에 표시됩니다.'}</p></div></td></tr>`;
  renderCalendar(entries);
  const picks = [...scored].filter(item => scoreOf(item) >= 70).sort((a, b) => scoreOf(b) - scoreOf(a)).slice(0, 3);
  $('#pickGrid').innerHTML = picks.map((item, i) => `<article class="pick-card ${i === 0 ? 'featured' : ''}"><span class="tag">${demoMode ? 'SAMPLE' : i === 0 ? 'TOP SIGNAL' : 'WATCHLIST'}</span><div class="score-pill">${scoreOf(item)}</div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.reason)}</p><div class="signals">${item.tags.slice(0, 2).map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div><button class="card-detail" data-detail="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.name)} 분석 보기">↗</button></article>`).join('') || '<div class="analysis-empty"><b>근거가 모이면 분석이 시작됩니다.</b><p>청약 일정은 자동 갱신됩니다. 기관 수요·확약·유통물량 자료가 부족한 종목은 점수를 표시하지 않습니다.</p></div>';
}
function renderActionRail(monthly, active, closingSoon) {
  const ongoing = monthly.filter(item => statusOf(item) === '진행중');
  const targets = ongoing.length ? ongoing.slice(0, 3) : active.slice(0, 3);
  const lead = ongoing.length ? `오늘 청약 중인 종목 ${ongoing.length}개` : closingSoon.length ? `3일 안에 마감하는 종목 ${closingSoon.length}개` : targets.length ? '가장 가까운 청약 일정' : '이번 달 일정 안내';
  const content = targets.length ? targets.map(item => `<button class="agenda-item" data-detail="${escapeHtml(item.id)}"><span class="agenda-date">${escapeHtml(dateLabel(item.subscription_start))}</span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.broker || '주관사 확인중')} · ${escapeHtml(statusOf(item))}</small><span aria-hidden="true">→</span></button>`).join('') : '<div class="agenda-empty">등록된 청약 일정이 아직 없습니다. 새 공시가 반영되면 이곳에 표시됩니다.</div>';
  $('#actionRail').innerHTML = `<div class="agenda-heading"><span>${lead}</span><small>청약일 기준 · 공시 변경 가능</small></div><div class="agenda-list">${content}</div>`;
}
function renderCalendar(entries) {
  const grid = $('#calendarGrid');
  const [year, mon] = currentMonth.split('-').map(Number);
  const firstDow = new Date(Date.UTC(year, mon - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const cells = Array(firstDow).fill(null).concat(Array.from({ length: daysInMonth }, (_, i) => `${currentMonth}-${String(i + 1).padStart(2, '0')}`));
  while (cells.length % 7) cells.push(null);
  const byDay = day => entries.filter(item => item.subscription_start && item.subscription_end && item.subscription_start <= day && day <= item.subscription_end);
  grid.innerHTML = cells.map(day => {
    if (!day) return '<div class="calendar-cell is-empty"></div>';
    const items = byDay(day);
    const shown = items.slice(0, 3);
    return `<div class="calendar-cell${day === today ? ' is-today' : ''}"><span class="calendar-date">${Number(day.slice(8))}</span><div class="calendar-items">${shown.map(item => {
      const score = scoreOf(item);
      const hot = hotReasons(item).length > 0;
      return `<button class="calendar-pill${hot ? ' is-hot' : ''}" data-detail="${escapeHtml(item.id)}" style="--pill-color:${score === null ? '#909b94' : scoreColor(score)}" title="${escapeHtml(item.name + (hot ? ' · 핫한 공모주: ' + hotReasons(item).join(' · ') : ''))}">${hot ? '🔥 ' : ''}${escapeHtml(item.name)}</button>`;
    }).join('')}${items.length > shown.length ? `<span class="calendar-more">+${items.length - shown.length}개 더</span>` : ''}</div></div>`;
  }).join('');
}
function setViewMode(mode) {
  viewMode = mode; store('gongmo-radar-view', mode);
  $('#listView').hidden = mode !== 'list'; $('#calendarView').hidden = mode !== 'calendar';
  document.querySelectorAll('#viewSwitch button').forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.view === mode)));
}
$('#viewSwitch').addEventListener('click', event => { const btn = event.target.closest('[data-view]'); if (btn) setViewMode(btn.dataset.view); });
function changeMonth(delta) { const date = new Date(`${currentMonth}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + delta); currentMonth = date.toISOString().slice(0, 7); render(); }
$('#prevMonth').addEventListener('click', () => changeMonth(-1)); $('#nextMonth').addEventListener('click', () => changeMonth(1));
$('#todayMonth').addEventListener('click', () => { currentMonth = koreaDate().slice(0, 7); render(); });
$('#stockSearch').addEventListener('input', render); $('#statusFilter').addEventListener('change', render); $('#sortFilter').addEventListener('change', render);
$('#calendarSpac').addEventListener('click', () => { includeSpac = !includeSpac; store('gongmo-radar-spac', includeSpac); render(); });
$('#quickFilter').addEventListener('click', event => { const button = event.target.closest('[data-quick]'); if (!button) return; quickFilter = button.dataset.quick; render(); });
$('#savedFilter').addEventListener('click', () => { savedOnly = !savedOnly; render(); }); $('#savedNav').addEventListener('click', () => { savedOnly = true; render(); });
$('#demoToggle').addEventListener('click', () => { demoMode = !demoMode; render(); }); $('#howButton').addEventListener('click', () => document.querySelector('.method').scrollIntoView());
$('#closeDialog').addEventListener('click', () => $('#detailDialog').close());
document.addEventListener('click', event => {
  const saveButton = event.target.closest('[data-save]');
  if (saveButton) { const id = saveButton.dataset.save; saved = saved.includes(id) ? saved.filter(x => x !== id) : [...saved, id]; store('gongmo-radar-saved', saved); render(); }
  const detailButton = event.target.closest('[data-detail]');
  if (detailButton) {
    const item = displayedData().find(row => String(row.id) === detailButton.dataset.detail); if (!item) return;
    const dart = sourceUrl(item.source_dart_url, 'dart.fss.or.kr'), kind = sourceUrl(item.source_kind_url, 'kind.krx.co.kr');
    $('#dialogContent').innerHTML = `<p class="eyebrow"><span></span> ${demoMode ? 'SAMPLE ANALYSIS' : 'IPO OVERVIEW'}</p><h2 class="detail-title">${escapeHtml(item.name)} ${hotBadge(item)}</h2><p class="detail-sub">${escapeHtml(item.sector || '업종 확인중')} · ${escapeHtml(statusOf(item))} · ${scoreLabel(item)}</p><div class="detail-grid"><div><span>청약 기간</span><b>${escapeHtml(item.dates)}</b></div><div><span>공모가</span><b>${escapeHtml(item.price || '확인중')}</b></div><div><span>인수인 · 주관사</span><b>${escapeHtml(item.broker || '확인중')}</b></div>${hotReasons(item).length ? `<div><span>핫한 이유</span><b>${escapeHtml(hotReasons(item).join(' · '))}</b></div>` : ''}<div><span>분석 의견</span><b>${escapeHtml(item.reason || '기관 수요예측과 유통물량 확인 후 분석됩니다.')}</b></div></div>${demoMode ? '' : checklistRows(item)}<div class="source-links">${dart ? `<a href="${escapeHtml(dart)}" target="_blank" rel="noopener noreferrer">DART 원문 ↗</a>` : ''}${kind ? `<a href="${escapeHtml(kind)}" target="_blank" rel="noopener noreferrer">KIND 원문 ↗</a>` : ''}</div><p class="detail-caution">${demoMode ? '가상 기업의 예시 데이터입니다.' : '일정과 가격은 정정 공시로 변경될 수 있습니다. 공시상 청약기일이 일반 투자자 청약일과 일치하는지 원문에서 확인해 주세요.'} 분석 점수는 공개 지표의 비교 결과입니다.</p>`;
    wireBreakeven($('#dialogContent'));
    $('#detailDialog').showModal();
  }
  const report = event.target.closest('[data-report]');
  if (report) { reportId = report.dataset.report; $('#reportFeedback').textContent = ''; $('#reportDialog').showModal(); }
});
async function loadListings() {
  if (!db) { dataState = 'unconfigured'; render(); return; }
  $('#refreshData').disabled = true;
  try {
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db.from('ipo_listings').select('*').eq('is_published', true).order('subscription_start').order('id').range(offset, offset + 999);
      if (error) throw error; rows.push(...data); if (data.length < 1000) break;
    }
    ipoData = rows.map(fromDbListing); dataState = 'live';
  } catch { dataState = 'error'; } finally { $('#refreshData').disabled = false; render(); }
}
$('#refreshData').addEventListener('click', loadListings);
$('#chatName').value = readStored('gongmo-radar-nickname', '');
$('#chatName').addEventListener('change', () => store('gongmo-radar-nickname', $('#chatName').value.trim()));
const messageFromDb = row => ({ id: String(row.id), name: row.display_name, text: row.body, createdAt: row.created_at });
function renderMessages(forceScroll = false) {
  const box = $('#messages'), bottom = box.scrollHeight - box.scrollTop - box.clientHeight < 65, oldTop = box.scrollTop;
  box.innerHTML = messages.map(message => `<div class="message"><div class="message-meta"><b>${escapeHtml(message.name)}</b><time>${escapeHtml(new Date(message.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }))}</time>${db ? `<button class="report-button" data-report="${escapeHtml(message.id)}">신고</button>` : ''}</div><p>${escapeHtml(message.text)}</p></div>`).join('') || `<div class="chat-empty">${db ? '아직 대화가 없습니다. 첫 이야기를 남겨보세요.' : '로컬 라운지입니다. 메시지는 이 브라우저에만 저장됩니다.'}</div>`;
  if (bottom || forceScroll) { box.scrollTop = box.scrollHeight; $('#newMessages').hidden = true; } else { box.scrollTop = oldTop; $('#newMessages').hidden = false; }
}
function addMessage(row, forceScroll = false) {
  const message = messageFromDb(row); if (messages.some(item => item.id === message.id)) return;
  messages.push(message); messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || Number(a.id) - Number(b.id)); messages = messages.slice(-50); renderMessages(forceScroll);
}
async function loadMessages(forceScroll = false) {
  const knownIds = new Set(messages.map(x => x.id));
  const { data, error } = await db.from('chat_messages').select('id,display_name,body,created_at').eq('room', room).eq('moderation_status', 'visible').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(50);
  if (error) throw error;
  const oldIds = messages.map(x => x.id).join(',');
  const arrivals = messages.filter(x => !knownIds.has(x.id));
  messages = data.reverse().map(messageFromDb);
  for (const arrival of arrivals) if (!messages.some(x => x.id === arrival.id)) messages.push(arrival);
  messages.sort((a,b) => a.createdAt.localeCompare(b.createdAt) || Number(a.id) - Number(b.id)); messages = messages.slice(-50);
  if (oldIds !== messages.map(x => x.id).join(',') || forceScroll) renderMessages(forceScroll);
}
function chatStatus(text, connected = false) { $('#chatStatus').textContent = text; $('#chatDot').style.background = connected ? '#4cb46a' : '#dfa74d'; }
const formatWait = seconds => seconds >= 60 ? `${Math.ceil(seconds / 60)}분` : `${seconds}초`;
async function notifyBlocked() {
  let seconds = 10;
  try { const { data } = await db.rpc('chat_block_remaining'); seconds = Math.max(Number(data) || 10, 1); } catch {}
  blockedUntil = Date.now() + seconds * 1000; $('#chatFeedback').textContent = `도배 방지로 ${formatWait(seconds)} 동안 채팅이 제한됩니다.`;
}
$('#chatForm').addEventListener('submit', async event => {
  event.preventDefault(); const name = $('#chatName').value.trim().slice(0, 12) || '익명', text = $('#chatInput').value.trim();
  if (!text || sending) return;
  if (blockedUntil > Date.now()) { $('#chatFeedback').textContent = `${formatWait(Math.ceil((blockedUntil - Date.now()) / 1000))} 뒤에 다시 보낼 수 있습니다.`; return; }
  if (Date.now() - lastSentAt < 1000) return;
  sending = true; lastSentAt = Date.now(); $('#sendChat').disabled = true; $('#chatFeedback').textContent = '';
  try {
    if (db) {
      const { data, error } = await db.from('chat_messages').insert({ room, display_name: name, body: text }).select('id,display_name,body,created_at');
      if (error) {
        const reason = error.message || ''; if (reason.includes('blocked')) { await notifyBlocked(); return; }
        $('#chatFeedback').textContent = reason.includes('rate_limited') ? '잠시 후 다시 보내 주세요.' : reason.includes('duplicate_message') ? '같은 메시지를 반복할 수 없습니다.' : '전송에 실패했습니다. 입력 내용은 보관되어 있습니다.'; return;
      }
      if (!data?.length) { await notifyBlocked(); return; }
      data.forEach(row => addMessage(row, true));
    } else {
      messages.push({ id: `local-${Date.now()}`, name, text, createdAt: new Date().toISOString() }); messages = messages.slice(-50); store('gongmo-radar-chat-v2', messages); renderMessages(true);
    }
    if ($('#chatInput').value.trim() === text) $('#chatInput').value = ''; store('gongmo-radar-nickname', name);
  } catch { $('#chatFeedback').textContent = '네트워크 연결을 확인하고 다시 보내 주세요.'; } finally { sending = false; $('#sendChat').disabled = false; }
});
$('#newMessages').addEventListener('click', () => { $('#messages').scrollTop = $('#messages').scrollHeight; $('#newMessages').hidden = true; });
document.querySelector('.chat-prompts').addEventListener('click', event => { const button = event.target.closest('[data-prompt]'); if (!button) return; $('#chatInput').value = button.dataset.prompt; $('#chatInput').focus(); });
$('#cancelReport').addEventListener('click', () => $('#reportDialog').close());
$('#reportForm').addEventListener('submit', async event => {
  event.preventDefault(); if (!db || !reportId) return; const button = event.submitter; button.disabled = true;
  try { const { error } = await db.from('chat_reports').insert({ message_id: reportId, reason: $('#reportReason').value }); $('#reportFeedback').textContent = error ? '신고 접수가 연결되지 않았습니다. 운영자에게 알려 주세요.' : '신고가 접수되었습니다.'; }
  catch { $('#reportFeedback').textContent = '연결을 확인하고 다시 시도해 주세요.'; } finally { button.disabled = false; }
});
async function connectChat() {
  if (!db) {
    messages = readStored('gongmo-radar-chat-v2', []); if (!Array.isArray(messages)) messages = [];
    chatStatus('로컬 모드'); $('#presenceText').textContent = '이 브라우저에서만 보이는 대화'; renderMessages(); return;
  }
  try { await loadMessages(true); } catch { $('#chatFeedback').textContent = '채팅 내역을 불러오지 못했습니다.'; }
  channel = db.channel(`gongmo-chat:${room}`, { config: { presence: { key: crypto.randomUUID() } } });
  channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room=eq.${room}` }, payload => { if (payload.new.moderation_status === 'visible') addMessage(payload.new); })
    .on('presence', { event: 'sync' }, () => { $('#presenceText').textContent = `${Object.keys(channel.presenceState()).length}개 접속 세션 · 라운지 참여중`; })
    .subscribe(async status => {
      if (status === 'SUBSCRIBED') { chatStatus('실시간 연결됨', true); await channel.track({ online_at: new Date().toISOString() }); loadMessages().catch(() => {}); }
      else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) { chatStatus('재연결중'); $('#presenceText').textContent = '라운지 연결 재시도중'; }
    });
}
setViewMode(viewMode); render(); renderMessages(); loadListings(); connectChat();
setInterval(() => { if (!document.hidden && db) loadMessages().catch(() => {}); }, 30000);
setInterval(() => { if (!document.hidden && db) loadListings(); }, 300000);
window.addEventListener('online', () => { loadListings(); if (db) loadMessages().catch(() => {}); });

function updateSmallLotEstimate() {
  const read = id => Math.max(0, Number(document.getElementById(id).value) || 0);
  const price = read('miniIpoPrice'), minimumShares = Math.max(1, Math.floor(read('miniMinShares')));
  const depositRate = Math.min(100, read('miniDepositRate')) / 100;
  const allocatedShares = Math.floor(read('miniAllocated')), returnRate = Number(document.getElementById('miniReturnPct').value) || 0;
  const fee = read('miniFee'), deposit = Math.ceil(price * minimumShares * depositRate);
  const profit = allocatedShares ? price * allocatedShares * returnRate / 100 - fee : 0;
  document.querySelector('.chicken-result div:nth-child(2) span').textContent = '청약 수수료 반영 손익(가정)';
  $('#miniDepositResult').textContent = fmtWon(deposit);
  $('#miniProfitResult').textContent = `${profit > 0 ? '+' : ''}${fmtWon(profit)}`;
  $('#miniProfitResult').classList.toggle('is-loss', profit < 0);
  $('#miniCalcNote').textContent = `최소 신청 ${minimumShares.toLocaleString('ko-KR')}주 · 배정 ${allocatedShares.toLocaleString('ko-KR')}주 가정 · 공모가 대비 ${returnRate}% 매도 · 수수료 ${fmtWon(fee)} 반영. 배정되면 증거금 외 잔금을 납부해야 합니다.`;
}
document.querySelectorAll('.chicken-fields input').forEach(input => input.addEventListener('input', updateSmallLotEstimate));
updateSmallLotEstimate();
