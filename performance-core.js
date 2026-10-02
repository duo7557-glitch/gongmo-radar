(function (root) {
  const percent = (price, base) => Number.isFinite(price) && Number.isFinite(base) && base > 0 ? (price / base - 1) * 100 : null;
  function analyze(item) {
    const days = [...item.days].filter(row => row.date >= item.listedAt).sort((a, b) => a.date.localeCompare(b.date));
    const first = days[0]?.date === item.listedAt ? days[0] : null;
    const fifth = first && days.length >= 5 ? days[4] : null;
    return { ...item, first, fifth, openReturn: percent(first?.open, item.offerPrice), dayOneReturn: percent(first?.close, item.offerPrice), weekReturn: percent(fifth?.close, item.offerPrice), afterOpenReturn: percent(fifth?.close, first?.open), quadrupleHit: Boolean(first && first.high >= item.offerPrice * 4), quadrupleClose: Boolean(first && first.close >= item.offerPrice * 4), sessions: days.length };
  }
  const api = { percent, analyze };
  root.PerformanceCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
