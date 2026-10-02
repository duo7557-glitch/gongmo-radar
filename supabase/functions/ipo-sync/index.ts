import { unzipSync } from 'npm:fflate@0.8.2';
import { collectOfferings, createDartClient } from '../_shared/dart.mjs';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
// Supabase injects these server-only credentials. Never put them in config.js.
Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405);
  const syncSecret = Deno.env.get('IPO_SYNC_SECRET');
  if (!syncSecret || request.headers.get('Authorization') !== `Bearer ${syncSecret}`) return json({ error: 'Unauthorized' }, 401);
  const url = Deno.env.get('SUPABASE_URL'), adminKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), dartKey = Deno.env.get('DART_API_KEY');
  if (!url || !adminKey || !dartKey) return json({ error: 'Server environment is incomplete' }, 503);
  const headers = { apikey: adminKey, Authorization: `Bearer ${adminKey}`, 'Content-Type': 'application/json' };
  async function rest(path: string, options: RequestInit = {}) {
    const response = await fetch(`${url}/rest/v1/${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) }, signal: AbortSignal.timeout(25000) });
    if (!response.ok) { const error = new Error(`Supabase database error ${response.status}`) as Error & { status?: number }; error.status = response.status; throw error; }
    const text = await response.text(); return text ? JSON.parse(text) : null;
  }
  let runId;
  let stage = 'claim-run';
  try {
    try { runId = await rest('rpc/claim_ipo_sync', { method: 'POST', body: '{}' }); }
    catch (error) {
      // Existing installs that ran the earlier migration have the table but not
      // the newer claim function. Keep first import usable; the next SQL update
      // restores the atomic scheduler lock.
      if ((error as { status?: number }).status !== 404) throw error;
      const running = await rest('ipo_sync_runs?status=eq.running&started_at=gte.' + encodeURIComponent(new Date(Date.now() - 10 * 60000).toISOString()) + '&select=id');
      if (running.length) return json({ error: 'Sync already running' }, 409);
      const run = await rest('ipo_sync_runs', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'running' }) });
      runId = run[0].id;
    }
    if (!runId) return json({ error: 'Sync already running' }, 409);
    stage = 'load-existing';
    const existing = await rest('ipo_listings?source_key=like.dart-ipo:*&select=*');
    stage = 'collect-dart';
    const result = await collectOfferings({ client: createDartClient(dartKey), unzip: unzipSync, existing });
    // Revision upsert keeps one initial IPO record per DART corporation, irrespective of month changes.
    stage = 'upsert-listings';
    for (const listing of result.listings) await rest('ipo_listings?on_conflict=source_key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(listing) });
    const summary = { scanned: result.scanned, updated: result.listings.length, review: result.review, range: result.range };
    stage = 'finish-run';
    await rest('ipo_sync_runs?id=eq.' + runId, { method: 'PATCH', body: JSON.stringify({ status: result.review.length ? 'needs_review' : 'success', finished_at: new Date().toISOString(), summary }) });
    return json(summary);
  } catch (error) {
    // No raw network errors or credentials are logged/returned.
    if (runId) { try { await rest('ipo_sync_runs?id=eq.' + runId, { method: 'PATCH', body: JSON.stringify({ status: 'failed', finished_at: new Date().toISOString() }) }); } catch {} }
    const detail = String((error as Error)?.message || 'unknown').replace(/https?:\/\/\S+/g, 'URL hidden').slice(0, 140);
    return json({ error: 'IPO sync failed. Check DART key, database migration, and function settings.', stage, detail }, 502);
  }
});
