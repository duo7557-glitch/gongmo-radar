import { unzipSync } from 'fflate';
import { createDartClient, documentText, DartError } from '../supabase/functions/_shared/dart.mjs';
import { applyAutomaticScore, MODEL_VERSION } from './ipo-score.mjs';
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
  if (row.score_status === 'auto' && payload.score_model === MODEL_VERSION) return false;
  const last = Date.parse(payload.score_checked_at || '');
  return !Number.isFinite(last) || Date.now() - last > 20 * 60 * 60 * 1000;
};
try {
  const rows = await rest(`ipo_listings?is_published=eq.true&dart_receipt_no=not.is.null&subscription_end=gte.${kstDate()}&select=*`);
  const due = rows.filter(isDue), client = createDartClient(DART_API_KEY); let updated = 0;
  for (const row of due) {
    try {
      const document = documentText(await client.document(row.dart_receipt_no), unzipSync);
      const scored = applyAutomaticScore(row, document);
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
