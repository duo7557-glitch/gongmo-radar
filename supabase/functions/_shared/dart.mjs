// Pure normalization + injectable HTTP layer, shared by local runner and Edge Function.
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
    /(?:금번|이번|본)\s*(?:주식\s*)?(?:공모|모집)[^.]{0,100}(?:신규\s*상장|이전\s*상장)[^.]{0,80}(?:위한|위해|목적)/
  ];
  for (const pattern of patterns) { const match = String(text).match(pattern); if (match) return match[0]; }
  return null;
}
const groupRows = (groups, title) => groups.filter(g => String(g.title).replaceAll(' ', '') === title).flatMap(g => g.list || []);
export function normalizeOffering(payload, report, text) {
  const groups = payload.group || [];
  const general = groupRows(groups, '일반사항').filter(row => row.rcept_no === report.rcept_no);
  if (general.length !== 1) return { review: '최신 정정 공시와 API 요약 접수번호가 일치하지 않거나 일반사항이 모호합니다.' };
  const detail = general[0], date = datesFromText(detail.sbd);
  if (!date) return { review: '청약기일이 누락되었거나 복수 구간으로 표시되었습니다.' };
  const evidence = ipoEvidence(text);
  if (!evidence) return { review: '원문에서 이번 공모의 신규·이전상장 근거를 확인하지 못했습니다.' };
  const stocks = groupRows(groups, '증권의종류').filter(row => row.rcept_no === report.rcept_no);
  if (!stocks.length || !stocks.some(row => /일반\s*공모/.test(row.slmthn || ''))) return { review: '일반공모 모집방법을 확인하지 못했습니다.' };
  const prices = [...new Set(stocks.map(row => row.slprc).filter(p => p && p !== '-'))];
  const brokers = [...new Set(groupRows(groups, '인수인정보').filter(row => row.rcept_no === report.rcept_no).map(row => row.actnmn).filter(n => n && n !== '-'))];
  const payment = datesFromText(detail.pymd);
  return { listing: {
    source_key: 'dart-ipo:' + report.corp_code, dart_corp_code: report.corp_code, dart_receipt_no: report.rcept_no,
    name: detail.corp_name || report.corp_name, sector: '', subscription_start: date.start, subscription_end: date.end,
    price_text: prices.length ? prices.join(' / ') + '원 (공시상 모집가액)' : '공모가 확인중', broker: brokers.join(' · '),
    payment_date: payment?.start || null,
    source_dart_url: 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' + report.rcept_no,
    status: (report.rm || '').includes('철') ? '철회' : '예정', score: null, score_status: 'pending',
    reason: '기관 수요예측·의무보유확약·유통물량 자료 확인 후 분석됩니다.', tags: ['DART 공시', '분석 대기'],
    is_published: !(report.rm || '').includes('철'), source_payload: { evidence, general: detail, securities: stocks }, updated_at: new Date().toISOString()
  } };
}
export function createDartClient(key, fetcher = fetch) {
  if (!/^[a-zA-Z0-9]{40}$/.test(key || '')) throw new Error('DART_API_KEY에 유효한 40자리 키를 설정해 주세요.');
  async function request(endpoint, params, binary = false) {
    const query = new URLSearchParams({ ...params, crtfc_key: key });
    // Never include URL in errors: it contains the private API key.
    let response;
    try { response = await fetcher('https://opendart.fss.or.kr/api/' + endpoint + '?' + query, { signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(25000) : undefined }); }
    catch (error) {
      const reason = String(error?.message || error?.name || 'unknown').replace(/https?:\/\/\S+/g, 'URL hidden').slice(0, 160);
      throw new Error('OpenDART 네트워크 요청 실패: ' + reason);
    }
    if (!response.ok) throw new Error('OpenDART HTTP ' + response.status);
    if (binary) {
      const data = new Uint8Array(await response.arrayBuffer());
      if (data.length > 25000000) throw new Error('공시 원문 크기 제한 초과');
      if (data[0] !== 0x50 || data[1] !== 0x4b) throw new Error('공시 원문 ZIP을 받지 못했습니다.');
      return data;
    }
    const json = await response.json();
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
  return { list, equity: (code, range) => request('estkRs.json', { corp_code: code, bgn_de: range.begin, end_de: range.end }), document: no => request('document.xml', { rcept_no: no }, true) };
}
export async function collectOfferings({ client, unzip, now = new Date(), existing = [], range: overrideRange } = {}) {
  const range = overrideRange || dateRange(now);
  const todayStr = dateRange(now).end;
  const reports = await client.list({ bgn_de: range.begin, end_de: range.end, pblntf_detail_ty: 'C001', last_reprt_at: 'N' });
  const companies = new Map();
  for (const report of reports) {
    if (!/증권신고서.*지분증권/.test(report.report_nm || '')) continue;
    const prior = companies.get(report.corp_code);
    if (!prior || report.rcept_no > prior.rcept_no) companies.set(report.corp_code, report);
  }
  const listings = [], review = [];
  // estkRs 시작일은 최초 신고서 기준이라 이전 연도부터 넉넉히, 종료일은 백필이어도 오늘까지 본다.
  const historyBegin = String(Number(range.begin.slice(0, 4)) - 1) + '0101';
  for (const candidate of companies.values()) {
    const previous = existing.find(row => row.source_key === 'dart-ipo:' + candidate.corp_code);
    // Persisted history is retained. Already imported revisions are not recomputed.
    if (previous && [previous.dart_receipt_no, previous.source_payload?.latest_receipt_no].includes(candidate.rcept_no) && !candidate.rm?.includes('철')) continue;
    let report = candidate;
    try {
      const payload = await client.equity(candidate.corp_code, { begin: historyBegin, end: todayStr });
      const summarized = new Set(groupRows(payload.group || [], '일반사항').map(row => row.rcept_no));
      // estkRs 요약은 [발행조건확정]·투자설명서·실적보고서·철회신고서를 반영하지 않고 마지막 증권신고서(정정 포함)
      // 기준으로 응답한다. 그래서 "최신 공시"를 추측하지 않고, 요약이 가리키는 신고서를 이 회사 이력에서 찾아 맞춘다.
      let history = null;
      if (!summarized.has(candidate.rcept_no)) {
        history = await client.list({ corp_code: candidate.corp_code, bgn_de: historyBegin, end_de: todayStr, pblntf_ty: 'C' });
        const matched = history.filter(row => summarized.has(row.rcept_no) && /증권신고서.*지분증권/.test(row.report_nm || '')).sort((a, b) => b.rcept_no.localeCompare(a.rcept_no))[0];
        if (matched) report = matched;
      }
      const text = documentText(await client.document(report.rcept_no), unzip);
      const normalized = normalizeOffering(payload, report, text);
      if (normalized.listing) {
        const newest = (history || [candidate]).filter(row => /증권신고서.*지분증권/.test(row.report_nm || '')).reduce((a, b) => (b.rcept_no > a.rcept_no ? b : a), candidate);
        normalized.listing.source_payload.latest_receipt_no = newest.rcept_no;
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
