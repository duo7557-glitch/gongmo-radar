const MODEL_VERSION = 'public-signals-v3';

const cleanText = value => String(value || '')
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/\s+/g, ' ')
  .trim();
const toNumber = value => Number(String(value).replaceAll(',', ''));
const excerpt = (text, at, length = 220) => text.slice(Math.max(0, at - 60), at + length).trim();

function uniqueMatch(text, regex, { min = 0, max = Infinity }) {
  const candidates = [];
  for (const match of text.matchAll(regex)) {
    const value = toNumber(match[1]);
    if (Number.isFinite(value) && value >= min && value <= max) candidates.push({ value, excerpt: excerpt(text, match.index), position: match.index });
  }
  const distinct = [...new Map(candidates.map(candidate => [candidate.value, candidate])).values()];
  // Tables can repeat an identical result. Different candidates are ambiguous, so never guess.
  return distinct.length === 1 ? distinct[0] : null;
}

export function extractIpoSignals(document) {
  const text = cleanText(document);
  return {
    demand_ratio: extractDemandRatio(text),
    lockup_rate: uniqueMatch(text, /의무보유확약[\s\S]{0,160}?(?:비율|신청수량|확약)[\s\S]{0,90}?([0-9]+(?:\.[0-9]+)?)\s*%/g, { min: 0, max: 100 }),
    float_rate: extractFloatRate(text)
  };
}

function extractDemandRatio(text) {
  const explicit = uniqueMatch(text, /수요예측[\s\S]{0,130}?(?:경쟁률|경쟁율)[\s\S]{0,70}?([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?::\s*1|대\s*1)/g, { min: 1, max: 100000 });
  const candidates = explicit ? [explicit] : [];
  for (const heading of text.matchAll(/수요예측\s*참여\s*내역/g)) {
    const rest = text.slice(heading.index);
    const nextSection = rest.search(/수요예측\s*신청\s*가격\s*분포/);
    const section = nextSection < 0 ? rest.slice(0, 16000) : rest.slice(0, nextSection);
    const row = section.match(/경쟁률\s*(?:\(?주\d+\)?)?\s+((?:-|[0-9][0-9,]*(?:\.[0-9]+)?)(?:\s+(?:-|[0-9][0-9,]*(?:\.[0-9]+)?)){1,24})/);
    if (!row) continue;
    const footnote = section.slice(row.index + row[0].length, row.index + row[0].length + 1000);
    // Only use the aggregate row when the filing explicitly states that it is the final
    // institutional-demand ratio based on the allocated institutional shares.
    if (!/경쟁률은[\s\S]{0,240}(?:기관투자자|배정주식|배정주수)[\s\S]{0,120}(?:기준|산출|단순경쟁률)/.test(footnote)) continue;
    const values = row[1].trim().split(/\s+/).filter(value => value !== '-').map(toNumber).filter(value => Number.isFinite(value) && value >= 1 && value <= 100000);
    const value = values.at(-1);
    if (value !== undefined) candidates.push({ value, excerpt: excerpt(text, heading.index + row.index, 360), position: heading.index + row.index });
  }
  // DART correction filings embed the old "정정 전" passage and the latest
  // "정정 후" passage in document order. The last matching summary is the current one.
  const latest = candidates.reduce((current, candidate) => !current || candidate.position >= current.position ? candidate : current, null);
  if (!latest) return null;
  const { position, ...signal } = latest;
  return signal;
}

function extractFloatRate(text) {
  const candidates = [];
  const statement = /상장예정주식수(?:\s*\([^)]{0,120}\))?\s*([0-9][0-9,]*)\s*주?\s*중\s*(?:([0-9]+(?:\.[0-9]+)?)\s*%\s*에\s*해당하는\s*)?([0-9][0-9,]*)\s*주[^.]{0,100}?(?:상장\s*(?:직후|일)\s*유통가능|유통가능\s*물량)/g;
  for (const match of text.matchAll(statement)) {
    const totalShares = toNumber(match[1]), availableShares = toNumber(match[3]);
    if (!totalShares || !availableShares || availableShares > totalShares) continue;
    const value = Math.round(availableShares / totalShares * 10000) / 100;
    const disclosed = match[2] == null ? null : Number(match[2]);
    // The prose percentage is rounded. A larger mismatch indicates a column/phrase mix-up.
    if (disclosed != null && Math.abs(value - disclosed) > 0.11) continue;
    candidates.push({ value, excerpt: match[0], source: 'calculated', position: match.index });
  }
  // Some issuers disclose the listing-day aggregate only in the dedicated
  // post-listing float table. Read the first (post-offering, non-diluted) pair
  // after that table's heading; never read percentages from shareholder rows.
  const tableHeading = /기간별\s*유통가능\s*주식수(?:\s*현황)?|상장\s*후\s*유통가능\s*주식수\s*현황/g;
  for (const heading of text.matchAll(tableHeading)) {
    const section = text.slice(heading.index, heading.index + 2400);
    const row = section.match(/상장일\s*유통가능\s*([0-9][0-9,]*)\s*주?\s*([0-9]+(?:[.,][0-9]+)?)\s*%?/);
    if (!row) continue;
    const rawRate = row[2];
    const value = Number(rawRate.includes(',') && !rawRate.includes('.') ? rawRate.replace(',', '.') : rawRate);
    if (Number.isFinite(value) && value >= 0 && value <= 100) candidates.push({ value, excerpt: section.slice(0, row.index + row[0].length), source: 'table', position: heading.index + row.index });
  }
  // Corrected DART filings include both the old and amended summaries; the last
  // validated post-IPO share calculation is the latest "정정 후" value.
  const latest = candidates.reduce((current, candidate) => !current || candidate.position >= current.position ? candidate : current, null);
  if (!latest) return null;
  const { position, ...signal } = latest;
  return signal;
}

export function extractIssuedLockup(document) {
  const text = cleanText(document);
  const heading = '기관투자자 의무보유확약기간별 배정현황';
  const start = text.indexOf(heading);
  if (start < 0) return null;
  const tail = text.slice(start);
  const end = tail.search(/Ⅲ\.|III\./);
  const section = end < 0 ? tail.slice(0, 5000) : tail.slice(0, end);
  const rows = [...section.matchAll(/(\d+\s*(?:개월|일)\s*확약)([\s\S]*?)(?=\d+\s*(?:개월|일)\s*확약|미확약)/g)];
  const lockedShares = rows.reduce((sum, row) => {
    const values = [...row[2].matchAll(/(?:^|\s)([\d,]+(?:\.\d+)?)(?=\s|$)/g)].map(match => toNumber(match[1]));
    return sum + (values.length >= 2 ? values.at(-2) : 0);
  }, 0);
  const totalRow = section.match(/(?:^|\s)계\s+([\s\S]*)$/);
  const totals = totalRow ? [...totalRow[1].matchAll(/(?:^|\s)([\d,]+(?:\.\d+)?)(?=\s|$)/g)].map(match => toNumber(match[1])) : [];
  const institutionalShares = totals.at(-2);
  if (!lockedShares || !institutionalShares || lockedShares > institutionalShares) return null;
  const value = Math.round(lockedShares / institutionalShares * 1000) / 10;
  return { value, excerpt: section.slice(0, 500), source: 'issued' };
}

const demandPoint = value => value >= 1000 ? 100 : value >= 500 ? 85 : value >= 200 ? 68 : value >= 100 ? 52 : 35;
const lockupPoint = value => value >= 20 ? 100 : value >= 10 ? 80 : value >= 5 ? 60 : value >= 1 ? 40 : 20;
const floatPoint = value => value <= 20 ? 100 : value <= 30 ? 80 : value <= 40 ? 60 : value <= 50 ? 40 : 20;

export function scoreIpoSignals(signals) {
  const rules = [['demand_ratio', 45, demandPoint], ['lockup_rate', 30, lockupPoint], ['float_rate', 25, floatPoint]];
  const available = rules.filter(([key]) => signals[key]);
  const coverage = available.reduce((sum, [, weight]) => sum + weight, 0);
  if (coverage < 55) return { score: null, score_status: 'pending', coverage };
  return { score: Math.round(available.reduce((sum, [key, weight, points]) => sum + weight * points(signals[key].value), 0) / coverage), score_status: 'auto', coverage };
}

const signalText = (key, signal) => key === 'demand_ratio' ? `수요예측 ${signal.value.toLocaleString('ko-KR')}:1` : key === 'lockup_rate' ? `의무보유확약 ${signal.value}%${signal.source === 'issued' ? ' (실제 배정)' : ''}` : `유통가능물량 ${signal.value}%`;

export function applyAutomaticScore(listing, document, now = new Date(), resultDocument = '') {
  const signals = extractIpoSignals(document);
  const issuedLockup = resultDocument && extractIssuedLockup(resultDocument);
  if (issuedLockup) signals.lockup_rate = issuedLockup;
  const result = scoreIpoSignals(signals);
  const source_payload = {
    ...(listing.source_payload || {}), score_model: MODEL_VERSION, score_checked_at: now.toISOString(),
    score_signals: Object.fromEntries(Object.entries(signals).map(([key, signal]) => [key, signal ? { value: signal.value, excerpt: signal.excerpt, ...(signal.source ? { source: signal.source } : {}) } : null]))
  };
  const entries = Object.entries(signals).filter(([, signal]) => signal);
  if (result.score_status !== 'auto') return {
    score: null, score_status: 'pending', source_payload, tags: ['DART 공시', '분석 대기'],
    reason: entries.length ? `공개 공시에서 ${entries.map(([key, signal]) => signalText(key, signal)).join(' · ')}만 확인됐습니다. 핵심 지표 2개 이상이 확인되면 자동 산출합니다.` : '기관 수요예측·의무보유확약·상장일 유통가능물량이 공시되면 자동으로 분석합니다.'
  };
  const labels = entries.map(([key, signal]) => signalText(key, signal));
  return {
    score: result.score, score_status: 'auto', source_payload, tags: ['DART 공시', '자동 산출', ...labels],
    reason: `공개 공시 지표 자동 비교: ${labels.join(' · ')}. 점수는 공개 지표의 비교용 신호이며 투자 권유가 아닙니다.`
  };
}

export { MODEL_VERSION };
