import { unzipSync } from 'fflate';
import { createDartClient, documentText, DartError } from '../supabase/functions/_shared/dart.mjs';
import { extractIpoSignals, extractIssuedLockup, scoreFromSignals, MODEL_VERSION } from './ipo-score.mjs';

// 최신 [발행조건확정] 공시가 사소한 문구 정정뿐이라 지표가 비어 있을 때를 대비해,
// 같은 회사의 다른 증권신고서·정정·투자설명서를 최신 순으로 더 훑어 지표를 채운다.
const REVISION_FILING = /증권신고서|투자설명서|발행조건확정/;
const MAX_FALLBACK_DOCS = 6;
async function collectSignals(client, unzip, row, primaryReceiptNo, kstDate) {
  const primaryText = documentText(await client.document(primaryReceiptNo), unzip);
  let signals = extractIpoSignals(primaryText);
  if (!row.dart_corp_code || Object.values(signals).every(Boolean)) return signals;
  const begin = (row.dart_receipt_no || primaryReceiptNo).slice(0, 8);
  const history = await client.list({ corp_code: row.dart_corp_code, bgn_de: begin, end_de: kstDate.replaceAll('-', ''), pblntf_ty: 'C' });
  const candidates = history
    .filter(report => REVISION_FILING.test(report.report_nm || '') && report.rcept_no !== primaryReceiptNo)
    .sort((a, b) => b.rcept_no.localeCompare(a.rcept_no))
    .slice(0, MAX_FALLBACK_DOCS);
  for (const candidate of candidates) {
    if (Object.values(signals).every(Boolean)) break;
    const text = documentText(await client.document(candidate.rcept_no), unzip);
    const found = extractIpoSignals(text);
    for (const key of Object.keys(signals)) if (!signals[key] && found[key]) signals[key] = found[key];
  }
  return signals;
}
import { loadEnv } from './load-env.mjs';
await loadEnv();

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY, DART_API_KEY } = process.env;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !DART_API_KEY) { console.error('Missing required automation environment variables.'); process.exit(1); }
const headers = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
async function rest(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  if (!response.ok) throw new Error(`Supabase database error ${response.status}`);
  const text = await response.text(); return text ? JSON.parse(text) : null;
}
const kstDate = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const isDue = row => {
  const payload = row.source_payload || {};
  if (payload.score_model !== MODEL_VERSION) return true;
  if (row.score_status === 'auto') return false;
  const last = Date.parse(payload.score_checked_at || '');
  return !Number.isFinite(last) || Date.now() - last > 20 * 60 * 60 * 1000;
};
try {
  const scoreStart = `${kstDate().slice(0, 4)}-01-01`;
  const rows = await rest(`ipo_listings?is_published=eq.true&dart_receipt_no=not.is.null&subscription_end=gte.${scoreStart}&select=*`);
  const due = rows.filter(isDue), client = createDartClient(DART_API_KEY); let updated = 0;
  for (const row of due) {
    try {
      // Use the final prospectus for pre-IPO signals, falling back to earlier revisions when the
      // latest [발행조건확정] filing turns out to be a small wording-only correction with no tables.
      // After subscription, the issuance report publishes actual institutional lockup allocations.
      const primaryReceiptNo = row.source_payload?.final_terms_receipt_no || row.dart_receipt_no;
      const signals = await collectSignals(client, unzipSync, row, primaryReceiptNo, kstDate());
      if (row.subscription_end < kstDate() && row.dart_corp_code && /^\d{14}$/.test(row.dart_receipt_no || '')) {
        const begin = row.dart_receipt_no.slice(0, 8);
        const reports = await client.list({ corp_code: row.dart_corp_code, bgn_de: begin, end_de: kstDate().replaceAll('-', ''), pblntf_ty: 'C' });
        const issuance = reports.find(report => /증권발행실적보고서/.test(report.report_nm || ''));
        if (issuance) {
          const issuedLockup = extractIssuedLockup(documentText(await client.document(issuance.rcept_no), unzipSync));
          if (issuedLockup) signals.lockup_rate = issuedLockup;
        }
      }
      const scored = scoreFromSignals(row, signals, new Date());
      await rest(`ipo_listings?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify({ ...scored, updated_at: new Date().toISOString() }) });
      updated++;
    } catch (error) {
      if (error instanceof DartError && ['010', '011', '012', '020', '901'].includes(error.status)) throw error;
      console.warn(`Scoring skipped for listing ${row.id}.`);
    }
  }
  console.log(`Automatic scoring checked ${due.length} listing(s), updated ${updated}.`);
} catch {
  console.error('Automatic IPO scoring failed. Check the DART and database configuration.'); process.exitCode = 1;
}
