// Pure normalization + injectable HTTP layer, shared by local runner and Edge Function.
// Bump when parsing rules change so previously imported rows are recomputed once.
export const PARSER_VERSION = 11;
const OFFERING_FILING = /증권신고서.*(?:지분증권|증권예탁증권)/;
export class DartError extends Error {
  constructor(status) { super(`OpenDART 오류 ${status}`); this.status = status; }
}
export function dateRange(now = new Date()) {
  const end = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(now).replaceAll('-', '');
  const start = new Date(end.slice(0, 4) + '-' + end.slice(4, 6) + '-' + end.slice(6) + 'T00:00:00Z');
  start.setUTCDate(start.getUTCDate() - 85); // corp_code 없는 검색은 최대 3개월
  return { begin: start.toISOString().slice(0, 10).replaceAll('-', ''), end };
}
export function datesFromText(value) {
  const matches = [...String(value || '').matchAll(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?/g)];
  const dates = matches.map(([, y, m, d]) => `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
  if (!dates.length || dates.some(s => { const t = new Date(s + 'T00:00:00Z'); return !Number.isFinite(t.getTime()) || t.toISOString().slice(0, 10) !== s; })) return null;
  // Ambiguous ranges (institution/employee/general dates mixed) are withheld.
  if (dates.length > 2) return null;
  // A shortened end date must not become a one-day subscription.
  if (dates.length === 1 && /(?:~|～|∼|부터|\s[-–—]\s)/.test(String(value))) return null;
  if (dates.length === 1) return { start: dates[0], end: dates[0] };
  if (dates[1] < dates[0]) return null;
  return { start: dates[0], end: dates[1] };
}
export function documentText(bytes, unzip) {
  const files = unzip(bytes, { filter: file => /\.(xml|html?)$/i.test(file.name) && file.originalSize < 25000000 });
  return Object.values(files).map(buffer => {
    let decoded = new TextDecoder('utf-8').decode(buffer);
    if (/encoding\s*=\s*["'](?:euc-kr|ks_c_5601-1987)/i.test(decoded.slice(0, 250))) decoded = new TextDecoder('euc-kr').decode(buffer);
    return decoded.replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|#160);/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  }).join(' ');
}
export function ipoEvidence(text) {
  // Current-offering statement is required. A general mention of IPO/history is insufficient.
  const patterns = [
    /(?:금번|이번|본)\s*(?:주식\s*)?(?:공모|모집)[^.]{0,220}(?:코스닥|유가증권|코스피)[^.]{0,90}(?:신규\s*상장|이전\s*상장)[^.]{0,90}(?:위한|위해|목적)/,
    /(?:금번|이번|본)\s*(?:주식\s*)?(?:공모|모집)[^.]{0,100}(?:신규\s*상장|이전\s*상장)[^.]{0,80}(?:위한|위해|목적)/,
    // "본 주식은 코스닥시장 상장을 목적으로 모집(매출)하는 것으로" (기도산업 등)
    /(?:금번|이번|본)\s*주식은[^.]{0,30}?(?:코스닥|유가증권|코스피)\s*시장\s*(?:신규\s*)?상장을\s*(?:목적|위한|위해)/,
    // 상장 심사 중인 공모의 위험 항목: "공모일정 변동가능성 및 상장예비심사결과 효력 종료에 관한 위험" (채비)
    /공모\s*일정[^.]{0,40}상장\s*예비\s*심사/,
    // 스팩: "코스닥시장 상장을 위한 최초의 모집", "최초로 모집한 주권 … 90일 이내 … 상장"
    /(?:코스닥|유가증권|코스피)\s*시장\s*상장을\s*위한\s*최초(?:의)?\s*(?:모집|공모)/,
    /최초(?:로)?\s*모집한\s*주권[^.]{0,60}90\s*일\s*이내[^.]{0,40}상장/
  ];
  for (const pattern of patterns) { const match = String(text).match(pattern); if (match) return match[0]; }
  return null;
}
// [발행조건확정] 정정표의 "정정 후" 값만 확정가로 본다. 정정 전 값은 "모집(매출)가액(예정): a ~ b" 형태라 걸리지 않는다.
export function confirmedPrice(text) {
  const s = String(text || '');
  const m = s.match(/모집\s*\(\s*매출\s*\)\s*가액\s*:\s*([\d,]+)\s*원\s*-\s*모집\s*\(\s*매출\s*\)\s*총액/) || s.match(/확정\s*공모\s*가액(?:인|을|은|:)?\s*([\d,]+)\s*원/);
  return m ? m[1] : null;
}
export function priceBand(text) {
  const m = String(text || '').match(/희망\s*공모\s*가액(?:인|은|:)?\s*([\d,]+)\s*원\s*[~∼～]\s*([\d,]+)\s*원/);
  return m ? [m[1], m[2]] : null;
}
const groupRows = (groups, title) => groups.filter(g => String(g.title).replaceAll(' ', '') === title).flatMap(g => g.list || []);
export function extractSubscriptionBrokers(text, underwriters = []) {
  const source = String(text || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  const markers = [...source.matchAll(/청약(?:사무)?취급처/g)];
  const key = value => String(value || '').toLowerCase().replace(/주식회사|㈜|\(주\)|（주）/g, '').replace(/[^\p{L}\p{N}]/gu, '');
  const knownBrokers = [
    ['한국투자증권', ['한국투자증권']], ['NH투자증권', ['NH투자증권']], ['미래에셋증권', ['미래에셋증권']],
    ['삼성증권', ['삼성증권']], ['KB증권', ['KB증권']], ['신한투자증권', ['신한투자증권', '신한금융투자']],
    ['대신증권', ['대신증권']], ['키움증권', ['키움증권']], ['하나증권', ['하나증권']], ['유안타증권', ['유안타증권']],
    ['현대차증권', ['현대차증권']], ['한화투자증권', ['한화투자증권']], ['유진투자증권', ['유진투자증권']],
    ['교보증권', ['교보증권']], ['DB금융투자', ['DB금융투자']], ['IBK투자증권', ['IBK투자증권']],
    ['SK증권', ['SK증권']], ['LS증권', ['LS증권', '이베스트투자증권']], ['iM증권', ['iM증권', '하이투자증권']],
    ['메리츠증권', ['메리츠증권']], ['신영증권', ['신영증권']], ['다올투자증권', ['다올투자증권']],
    ['토스증권', ['토스증권']], ['한양증권', ['한양증권']], ['부국증권', ['부국증권']], ['유화증권', ['유화증권']]
  ];
  const allMatched = [];
  for (const marker of markers) {
    const nearby = source.slice(marker.index, marker.index + 1800);
    const generalStart = nearby.search(/일반\s*(?:청약자|공모청약)/);
    if (generalStart < 0) continue;
    const generalText = nearby.slice(generalStart).split(/(?:④|기관\s*투자자\s*[:：]|우리사주조합\s*[:：])/)[0];
    const normalizedText = key(generalText);
    const matched = knownBrokers.filter(([, aliases]) => aliases.some(alias => normalizedText.includes(key(alias)))).map(([name, aliases]) => ({ name, position: Math.min(...aliases.map(alias => normalizedText.indexOf(key(alias))).filter(index => index >= 0)) })).sort((a, b) => a.position - b.position).map(({ name }) => name);
    for (const name of underwriters) if (key(name).length > 1 && normalizedText.includes(key(name)) && !matched.some(found => key(found) === key(name))) matched.push(name);
    for (const name of matched) if (!allMatched.some(found => key(found) === key(name))) allMatched.push(name);
  }
  return allMatched;
}
// kindListed: KIND 신규상장(공모) 목록에 종목코드가 있으면 원문 문구가 달라도(예: 케이뱅크) 실제 공모 상장으로 인정한다.
// 증권신고서 "수요예측 일시" 표의 기간(수요예측 시작~마감)을 읽는다.
export function demandPeriod(text) {
  const at = String(text || '').indexOf('수요예측 일시');
  if (at < 0) return null;
  const dates = datesFromText(text.slice(at + 7, at + 160));
  return dates ? { start: dates.start, end: dates.end } : null;
}
export function normalizeOffering(payload, report, text, { kindListed = false, demand = null } = {}) {
  const groups = payload.group || [];
  const general = groupRows(groups, '일반사항').filter(row => row.rcept_no === report.rcept_no);
  if (general.length !== 1) return { review: '최신 정정 공시와 API 요약 접수번호가 일치하지 않거나 일반사항이 모호합니다.' };
  const detail = general[0], date = datesFromText(detail.sbd);
  if (!date) return { review: '청약기일이 누락되었거나 복수 구간으로 표시되었습니다.' };
  const evidence = ipoEvidence(text) || (kindListed ? 'KIND 신규상장(공모) 종목으로 확인' : null);
  if (!evidence) return { review: '원문에서 이번 공모의 신규·이전상장 근거를 확인하지 못했습니다.' };
  const stocks = groupRows(groups, '증권의종류').filter(row => row.rcept_no === report.rcept_no);
  // 공모주식수와 구주매출(매출인 매도 주식수). 값이 '-'면 0으로 보고, 숫자가 아니면 확인 불가(null)로 둔다.
  const shareCount = value => { const text = String(value ?? '').trim(); if (text === '-' || text === '') return 0; const n = Number(text.replaceAll(',', '')); return Number.isFinite(n) ? n : null; };
  const offerShares = stocks.reduce((sum, row) => (sum === null || shareCount(row.stkcnt) === null ? null : sum + shareCount(row.stkcnt)), 0) || null;
  const sellerRows = groupRows(groups, '매출인에관한사항').filter(row => row.rcept_no === report.rcept_no);
  const sellerShares = sellerRows.length ? sellerRows.reduce((sum, row) => (sum === null || shareCount(row.slstk) === null ? null : sum + shareCount(row.slstk)), 0) : 0;
  if (!stocks.length || !stocks.some(row => /일반\s*공모/.test(row.slmthn || ''))) return { review: '일반공모 모집방법을 확인하지 못했습니다.' };
  const prices = [...new Set(stocks.map(row => row.slprc).filter(p => p && p !== '-'))];
  const brokers = [...new Set(groupRows(groups, '인수인정보').filter(row => row.rcept_no === report.rcept_no).map(row => row.actnmn).filter(n => n && n !== '-'))];
  const subscriptionBrokers = extractSubscriptionBrokers(text, brokers);
  const payment = datesFromText(detail.pymd);
  // estkRs slprc는 희망가 밴드의 최저가라 단독으로 보여주면 공모가로 오해한다. 원문에서 밴드를 읽을 수 있으면 밴드로 표시한다.
  const band = priceBand(text);
  return { listing: {
    source_key: 'dart-ipo:' + report.corp_code, dart_corp_code: report.corp_code, dart_receipt_no: report.rcept_no,
    name: detail.corp_name || report.corp_name, sector: '', subscription_start: date.start, subscription_end: date.end,
    price_text: band ? `${band[0]}~${band[1]}원 (희망 공모가)` : prices.length ? prices.join(' / ') + '원 (공시상 모집가액)' : '공모가 확인중', broker: brokers.join(' · '),
    payment_date: payment?.start || null,
    source_dart_url: 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' + report.rcept_no,
    status: (report.rm || '').includes('철') ? '철회' : '예정', score: null, score_status: 'pending',
    reason: '기관 수요예측·의무보유확약·유통물량 자료 확인 후 분석됩니다.', tags: ['DART 공시', '분석 대기'],
    is_published: !(report.rm || '').includes('철'), source_payload: { evidence, demand: demand || demandPeriod(text), general: detail, securities: stocks, underwriters: brokers, subscription_brokers: subscriptionBrokers, price_band: band ? band.map(v => Number(v.replaceAll(',', ''))) : null, offer_shares: offerShares, seller_shares: sellerShares }, updated_at: new Date().toISOString()
  } };
}
export function createDartClient(key, fetcher = fetch, { retryDelayMs = 3000 } = {}) {
  if (!/^[a-zA-Z0-9]{40}$/.test(key || '')) throw new Error('DART_API_KEY에 유효한 40자리 키를 설정해 주세요.');
  async function request(endpoint, params, binary = false) {
    const query = new URLSearchParams({ ...params, crtfc_key: key });
    // 해외(GitHub Actions)에서 원문 ZIP을 받으면 본문 다운로드 중 시간 초과가 잦다.
    // 응답 본문까지 포함해 재시도하고, 일시적 서버 오류(5xx·429)도 재시도한다.
    const timeoutMs = binary ? 90000 : 45000;
    let body, lastError;
    for (let attempt = 0; attempt < 3 && body === undefined; attempt++) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, attempt * retryDelayMs));
      let response;
      try {
        response = await fetcher('https://opendart.fss.or.kr/api/' + endpoint + '?' + query, { signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined });
        if (!response.ok) { lastError = new Error('OpenDART HTTP ' + response.status); if (response.status >= 500 || response.status === 429) continue; throw lastError; }
        body = binary ? new Uint8Array(await response.arrayBuffer()) : await response.json();
      } catch (error) {
        if (response && !response.ok && response.status < 500 && response.status !== 429) throw error;
        // Never include URL in errors: it contains the private API key.
        const reason = String(error?.message || error?.name || 'unknown').replace(/https?:\/\/\S+/g, 'URL hidden').slice(0, 160);
        lastError = new Error('OpenDART 네트워크 요청 실패: ' + reason);
      }
    }
    if (body === undefined) throw lastError;
    if (binary) {
      const data = body;
      if (data.length > 25000000) throw new Error('공시 원문 크기 제한 초과');
      if (data[0] !== 0x50 || data[1] !== 0x4b) throw new Error('공시 원문 ZIP을 받지 못했습니다.');
      return data;
    }
    const json = body;
    if (json.status === '013') return { list: [], group: [], total_page: 0 };
    if (json.status !== '000') throw new DartError(json.status);
    return json;
  }
  async function list(params) {
    const rows = []; let page = 1, total = 1;
    do {
      const data = await request('list.json', { page_count: '100', sort: 'date', sort_mth: 'desc', ...params, page_no: String(page) });
      rows.push(...(data.list || [])); total = Number(data.total_page || 0); page++;
    } while (page <= total);
    return rows;
  }
  return { list, company: corp => request('company.json', { corp_code: corp }), equity: (code, range) => request('estkRs.json', { corp_code: code, bgn_de: range.begin, end_de: range.end }), depositary: (code, range) => request('stkdpRs.json', { corp_code: code, bgn_de: range.begin, end_de: range.end }), document: no => request('document.xml', { rcept_no: no }, true) };
}
export async function collectOfferings({ client, unzip, now = new Date(), existing = [], range: overrideRange, knownListings = null, concurrency = 4 } = {}) {
  const range = overrideRange || dateRange(now);
  const todayStr = dateRange(now).end;
  // 외국 기업은 주식 대신 증권예탁증권(DR, 공시유형 C005)으로 상장하므로 함께 조회한다.
  const reports = [];
  for (const type of ['C001', 'C005']) reports.push(...await client.list({ bgn_de: range.begin, end_de: range.end, pblntf_detail_ty: type, last_reprt_at: 'N' }));
  const companies = new Map();
  for (const report of reports) {
    if (!OFFERING_FILING.test(report.report_nm || '')) continue;
    const prior = companies.get(report.corp_code);
    if (!prior || report.rcept_no > prior.rcept_no) companies.set(report.corp_code, report);
  }
  const listings = [], review = [];
  // estkRs 시작일은 최초 신고서 기준이라 이전 연도부터 넉넉히, 종료일은 백필이어도 오늘까지 본다.
  const historyBegin = String(Number(range.begin.slice(0, 4)) - 1) + '0101';
  async function processCandidate(candidate) {
    const previous = existing.find(row => row.source_key === 'dart-ipo:' + candidate.corp_code);
    // Persisted history is retained. Already imported revisions are not recomputed,
    // unless they were parsed by an older parser (e.g. before confirmed prices were read).
    if (previous?.source_payload?.parser_version === PARSER_VERSION && [previous.dart_receipt_no, previous.source_payload?.latest_receipt_no].includes(candidate.rcept_no) && !candidate.rm?.includes('철')) return;
    let report = candidate;
    try {
      const isDepositary = /증권예탁증권/.test(candidate.report_nm || '');
      const payload = await (isDepositary ? client.depositary : client.equity)(candidate.corp_code, { begin: historyBegin, end: todayStr });
      const summarized = new Set(groupRows(payload.group || [], '일반사항').map(row => row.rcept_no));
      // estkRs 요약은 [발행조건확정]·투자설명서·실적보고서·철회신고서를 반영하지 않고 마지막 증권신고서(정정 포함)
      // 기준으로 응답한다. 그래서 "최신 공시"를 추측하지 않고, 요약이 가리키는 신고서를 이 회사 이력에서 찾아 맞춘다.
      // 백필 구간 밖(이후)에 나온 [발행조건확정]·철회도 보도록 회사 공시 이력은 항상 오늘까지 조회한다.
      // 그래야 어떤 구간을 어떤 순서로 돌려도 확정 공모가가 희망가로 덮이지 않는다.
      const history = await client.list({ corp_code: candidate.corp_code, bgn_de: historyBegin, end_de: todayStr, pblntf_ty: 'C' });
      if (!summarized.has(candidate.rcept_no)) {
        const matched = history.filter(row => summarized.has(row.rcept_no) && OFFERING_FILING.test(row.report_nm || '')).sort((a, b) => b.rcept_no.localeCompare(a.rcept_no))[0];
        if (matched) report = matched;
      }
      const text = documentText(await client.document(report.rcept_no), unzip);
      // 정정 증권신고서에는 수요예측 일시 표가 없을 수 있어, 같은 회사의 가장 이른 증권신고서에서 기간을 찾는다.
      let demand = demandPeriod(text);
      if (!demand) {
        for (const row of history.filter(row => OFFERING_FILING.test(row.report_nm || '')).sort((a, b) => a.rcept_no.localeCompare(b.rcept_no))) {
          demand = demandPeriod(documentText(await client.document(row.rcept_no), unzip));
          if (demand) break;
        }
      }
      const normalized = normalizeOffering(payload, report, text, { kindListed: Boolean(knownListings?.has(candidate.stock_code || report.stock_code)), demand });
      if (normalized.listing) {
        const newest = (history || [candidate]).filter(row => OFFERING_FILING.test(row.report_nm || '')).reduce((a, b) => (b.rcept_no > a.rcept_no ? b : a), candidate);
        normalized.listing.source_payload.latest_receipt_no = newest.rcept_no;
        normalized.listing.source_payload.parser_version = PARSER_VERSION;
        // 확정 공모가는 estkRs에 반영되지 않으므로 [발행조건확정] 원문에서 직접 읽는다.
        const finalTerms = history?.filter(row => /발행조건확정/.test(row.report_nm || '') && row.rcept_no > report.rcept_no).sort((a, b) => b.rcept_no.localeCompare(a.rcept_no))[0];
        if (finalTerms) {
          const price = confirmedPrice(documentText(await client.document(finalTerms.rcept_no), unzip));
          normalized.listing.source_payload.final_terms_receipt_no = finalTerms.rcept_no;
          normalized.listing.source_dart_url = 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' + finalTerms.rcept_no;
          if (price) { normalized.listing.price_text = `${price}원 (확정 공모가)`; normalized.listing.source_payload.confirmed_price = Number(price.replaceAll(',', '')); }
        }
        const withdrawal = history?.find(row => /철회/.test(row.report_nm || '') && row.rcept_no > report.rcept_no);
        if (withdrawal) Object.assign(normalized.listing, { status: '철회', is_published: false, source_dart_url: 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' + withdrawal.rcept_no });
        listings.push(normalized.listing);
      } else review.push({ company: report.corp_name, receiptNo: report.rcept_no, reason: normalized.review });
    } catch (error) {
      // Authentication / quota failures abort the entire sync rather than pretending success.
      if (error instanceof DartError && ['010', '011', '012', '020', '901'].includes(error.status)) throw error;
      review.push({ company: report.corp_name, receiptNo: report.rcept_no, reason: error.message });
    }
  }
  // 해외 서버에서는 원문 다운로드가 느리므로 여러 종목을 동시에(기본 4건) 처리한다. 인증·한도 오류는 전체를 중단한다.
  const queue = [...companies.values()];
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => { while (queue.length) await processCandidate(queue.shift()); }));
  // Detect withdrawal filings for active IPOs, including reports outside C001.
  for (const previous of existing.filter(row => row.dart_corp_code && row.status !== '철회' && (!row.subscription_end || row.subscription_end >= range.begin.slice(0,4) + '-' + range.begin.slice(4,6) + '-' + range.begin.slice(6)))) {
    const latest = await client.list({ corp_code: previous.dart_corp_code, bgn_de: range.begin, end_de: todayStr, pblntf_ty: 'C' });
    // 실제 철회 공시 제목은 "철회신고서"처럼 '지분증권'이 빠진 형태가 많다.
    const withdrawal = latest.find(row => /철회/.test(row.report_nm || '') && row.rcept_no > previous.dart_receipt_no);
    if (withdrawal) {
      const i = listings.findIndex(row => row.source_key === previous.source_key); if (i >= 0) listings.splice(i, 1);
      listings.push({ ...previous, status: '철회', is_published: false, dart_receipt_no: withdrawal.rcept_no, source_dart_url: 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' + withdrawal.rcept_no, updated_at: new Date().toISOString() });
    }
  }
  return { listings, review, range, scanned: reports.length };
}
