/** Paginated review queue. Does not publish or guess missing IPO fields. */
import { mkdir, writeFile } from 'node:fs/promises';
import { createDartClient, dateRange } from '../supabase/functions/_shared/dart.mjs';
import { loadEnv } from './load-env.mjs';
await loadEnv();
try {
  const range = dateRange();
  const begin = process.env.DART_BEGIN_DATE || range.begin;
  const end = process.env.DART_END_DATE || range.end;
  if (!/^\d{8}$/.test(begin) || !/^\d{8}$/.test(end) || begin > end) throw new Error('조회 기간은 YYYYMMDD 형식으로 설정해 주세요.');
  const client = createDartClient(process.env.DART_API_KEY);
  const reports = await client.list({ bgn_de: begin, end_de: end, pblntf_detail_ty: 'C001', last_reprt_at: 'N' });
  const items = reports.filter(row => /증권신고서.*지분증권/.test(row.report_nm || '')).map(row => ({
    company: row.corp_name, corpCode: row.corp_code, receiptNo: row.rcept_no, receivedAt: row.rcept_dt,
    reportName: row.report_nm, dartUrl: 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' + row.rcept_no,
    status: '검증 대기', note: 'IPO 여부·청약일·공모가·주관사를 원문에서 확인하세요.'
  }));
  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  await writeFile(new URL('../data/ipo-review-queue.json', import.meta.url), JSON.stringify({ generatedAt: new Date().toISOString(), period: { begin, end }, items }, null, 2) + '\n', 'utf8');
  console.log(items.length + '개 공시 후보를 data/ipo-review-queue.json에 저장했습니다.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
