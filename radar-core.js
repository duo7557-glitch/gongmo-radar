(function (root) {
  const koreaDate = (date = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(date);
  function statusOf(item, today = koreaDate()) {
    if (['철회', '연기'].includes(item.status)) return item.status;
    if (!item.subscription_start || !item.subscription_end) return item.status || '일정 확인중';
    if (today > item.subscription_end) return '마감';
    return today >= item.subscription_start ? '진행중' : '예정';
  }
  function scoreOf(item) {
    if (item.score_status === 'pending' || item.score == null) return null;
    const value = Number(item.score);
    return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
  }
  function inMonth(item, month) {
    if (!item.subscription_start) return item.month === month;
    const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10);
    return item.subscription_start <= last && (item.subscription_end || item.subscription_start) >= month + '-01';
  }
  function selectListings(items, { month, search = '', status = 'all', sort = 'date', savedOnly = false, saved = [] }) {
    const query = search.trim().toLowerCase();
    return items.filter(item => inMonth(item, month))
      .filter(item => !query || [item.name, item.broker, item.sector].join(' ').toLowerCase().includes(query))
      .filter(item => status === 'all' || statusOf(item) === status)
      .filter(item => !savedOnly || saved.includes(String(item.id)))
      .sort((a, b) => sort === 'score' ? (scoreOf(b) ?? -1) - (scoreOf(a) ?? -1) || String(a.subscription_start).localeCompare(String(b.subscription_start)) : String(a.subscription_start).localeCompare(String(b.subscription_start)) || String(a.name).localeCompare(String(b.name)));
  }
  const api = { koreaDate, statusOf, scoreOf, inMonth, selectListings };
  root.RadarCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
