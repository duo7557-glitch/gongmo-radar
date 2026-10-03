const MODEL_VERSION = 'public-signals-v2';

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
    if (Number.isFinite(value) && value >= min && value <= max) candidates.push({ value, excerpt: excerpt(text, match.index) });
  }
  const distinct = [...new Map(candidates.map(candidate => [candidate.value, candidate])).values()];
  // Tables can repeat an identical result. Different candidates are ambiguous, so never guess.
  return distinct.length === 1 ? distinct[0] : null;
}

export function extractIpoSignals(document) {
  const text = cleanText(document);
  return {
    demand_ratio: uniqueMatch(text, /수요예측[\s\S]{0,130}?(?:경쟁률|경쟁율)[\s\S]{0,70}?([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?::\s*1|대\s*1)/g, { min: 1, max: 100000 }),
    lockup_rate: uniqueMatch(text, /의무보유확약[\s\S]{0,160}?(?:비율|신청수량|확약)[\s\S]{0,90}?([0-9]+(?:\.[0-9]+)?)\s*%/g, { min: 0, max: 100 }),
    float_rate: uniqueMatch(text, /(?:상장일[\s\S]{0,80}?)?유통가능(?:물량|주식)[\s\S]{0,150}?([0-9]+(?:\.[0-9]+)?)\s*%/g, { min: 0, max: 100 })
  };
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
