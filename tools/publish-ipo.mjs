/**
 * GitHub Actions(또는 다른 Node 환경)에서 주기 실행하는 자동 갱신 스크립트.
 * Supabase Edge Function(ipo-sync)과 동일한 로직을 사용하지만, OpenDART 서버가
 * TLS 1.2까지만 지원해 Supabase Edge Runtime(Deno)에서는 접속이 거부된다.
 * Node.js(OpenSSL 기반)는 문제 없이 접속되므로 이 스크립트가 실제 수집을 담당한다.
 */
import { unzipSync } from 'fflate';
import { collectOfferings, createDartClient } from '../supabase/functions/_shared/dart.mjs';
import { loadEnv } from './load-env.mjs';
await loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DART_API_KEY = process.env.DART_API_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !DART_API_KEY) {
  console.error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DART_API_KEY 환경변수가 모두 필요합니다.');
  process.exit(1);
}

const headers = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
async function rest(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  if (!response.ok) throw new Error(`Supabase database error ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

let runId;
try {
  // claim_ipo_sync는 schema.sql/updates.sql로 이미 등록된 잠금 함수입니다.
  // 두 수집기(Edge Function/GitHub Actions)가 동시에 겹쳐 돌아도 하나만 실행됩니다.
  runId = await rest('rpc/claim_ipo_sync', { method: 'POST', body: '{}' });
  if (!runId) { console.log('다른 수집이 이미 실행 중입니다. 이번 실행은 건너뜁니다.'); process.exit(0); }

  const existing = await rest('ipo_listings?source_key=like.dart-ipo:*&select=*');
  const client = createDartClient(DART_API_KEY);
  const result = await collectOfferings({ client, unzip: unzipSync, existing });

  for (const listing of result.listings) {
    await rest('ipo_listings?on_conflict=source_key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(listing) });
  }

  const summary = { scanned: result.scanned, updated: result.listings.length, review: result.review, range: result.range };
  await rest('ipo_sync_runs?id=eq.' + runId, { method: 'PATCH', body: JSON.stringify({ status: result.review.length ? 'needs_review' : 'success', finished_at: new Date().toISOString(), summary }) });
  console.log(`공시 ${result.scanned}건 확인 · 등록/갱신 ${result.listings.length}건 · 검토 필요 ${result.review.length}건`);
  if (result.review.length) console.log('검토 필요 목록:', JSON.stringify(result.review, null, 2));
} catch (error) {
  if (runId) { try { await rest('ipo_sync_runs?id=eq.' + runId, { method: 'PATCH', body: JSON.stringify({ status: 'failed', finished_at: new Date().toISOString() }) }); } catch {} }
  // DART_API_KEY 등 민감정보가 섞여 있을 수 있는 원문 에러는 출력하지 않습니다.
  console.error('자동 갱신 실패. DART 키, DB 마이그레이션, 환경변수를 확인하세요.');
  process.exitCode = 1;
}
