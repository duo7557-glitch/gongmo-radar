import test from 'node:test';
import assert from 'node:assert/strict';
import core from '../radar-core.js';
import performance from '../performance-core.js';
import { datesFromText, normalizeOffering, createDartClient, ipoEvidence, collectOfferings } from '../supabase/functions/_shared/dart.mjs';

test('월을 걸치는 청약은 두 달에 표시하고 상태는 한국 날짜로 계산한다', () => {
  const row = { subscription_start: '2026-09-30', subscription_end: '2026-10-02' };
  assert.equal(core.inMonth(row, '2026-09'), true); assert.equal(core.inMonth(row, '2026-10'), true); assert.equal(core.inMonth(row, '2026-11'), false);
  assert.equal(core.statusOf(row, '2026-10-02'), '진행중'); assert.equal(core.statusOf(row, '2026-10-03'), '마감'); assert.equal(core.statusOf({ ...row, status: '철회' }, '2026-10-02'), '철회');
});
test('분석 대기 점수와 빈 값은 0점으로 오인하지 않는다', () => {
  assert.equal(core.scoreOf({ score: null }), null); assert.equal(core.scoreOf({ score: 0, score_status: 'pending' }), null);
  const rows = [{ id: 'a', month: '2026-10', name: 'A', score: 72 }, { id: 'b', month: '2026-10', name: 'B', score: 91 }];
  assert.equal(core.selectListings(rows, { month: '2026-10', sort: 'score' })[0].id, 'b');
  assert.equal(core.selectListings(rows, { month: '2026-10', savedOnly: true, saved: ['a'] }).length, 1);
});
test('청약 날짜를 검증하고 기관·일반 복수 구간은 보류한다', () => {
  assert.deepEqual(datesFromText('2026년 10월 13일 ~ 2026년 10월 14일'), { start: '2026-10-13', end: '2026-10-14' });
  assert.equal(datesFromText('2026.02.30'), null); assert.equal(datesFromText('2026.10.13~2026.10.14 / 2026.10.15'), null);
  assert.equal(datesFromText('2026.10.13~14'), null);
  assert.equal(ipoEvidence('2019년 코스닥 신규상장. 이번 모집은 운영자금 유상증자입니다.'), null);
});
const report = { corp_code: '00001234', corp_name: '검증기업', rcept_no: '20261001000001' };
const payload = { group: [
  { title: '일반사항', list: [{ ...report, sbd: '2026.10.13 ~ 2026.10.14', pymd: '2026.10.16' }] },
  { title: '증권의종류', list: [{ ...report, slprc: '12,000', slmthn: '일반공모' }] },
  { title: '인수인정보', list: [{ ...report, actnmn: '검증증권' }] }
] };
test('원문 IPO 근거와 최신 접수번호가 있어야 자동 게시한다', () => {
  const text = '금번 공모는 코스닥시장 신규상장을 위한 일반공모입니다.';
  const result = normalizeOffering(payload, report, text);
  assert.equal(result.listing.subscription_start, '2026-10-13'); assert.equal(result.listing.score, null); assert.equal(result.listing.is_published, true);
  assert.equal(result.listing.source_key, 'dart-ipo:00001234');
  assert.ok(normalizeOffering(payload, { ...report, rcept_no: '20261002000001' }, text).review);
  assert.ok(normalizeOffering(payload, report, '유상증자입니다.').review);
});
test('공시 목록은 100건 이후 페이지도 조회하고 잘못된 키를 숨긴다', async () => {
  let calls = 0;
  const client = createDartClient('a'.repeat(40), async () => { calls++; return { ok: true, json: async () => ({ status: '000', total_page: 2, list: [{ page: calls }] }) }; });
  assert.equal((await client.list({})).length, 2);
  const bad = createDartClient('a'.repeat(40), async () => ({ ok: true, json: async () => ({ status: '010' }) }));
  await assert.rejects(bad.list({}), /오류 010/);
});
test('이미 반영한 정정 공시는 다시 만들지 않는다', async () => {
  const client = { list: async params => params.pblntf_detail_ty ? [{ ...report, report_nm: '증권신고서(지분증권)' }] : [], equity: () => { throw new Error('should not be called'); } };
  const result = await collectOfferings({ client, unzip: () => ({}), now: new Date('2026-10-02T00:00:00Z'), existing: [{ source_key: 'dart-ipo:00001234', dart_receipt_no: report.rcept_no }] });
  assert.equal(result.listings.length, 0); assert.equal(result.review.length, 0);
});

// 실제 DART 이력(클로봇·채비·마키나락스): estkRs 요약은 마지막 [기재정정]증권신고서를 가리키고
// 그 뒤의 [발행조건확정]·투자설명서·실적보고서·철회신고서는 반영하지 않는다.
const amended = { ...report, rcept_no: '20260623000402', report_nm: '[기재정정]증권신고서(지분증권)' };
const finalTerms = { ...report, rcept_no: '20260703000419', report_nm: '[발행조건확정]증권신고서(지분증권)' };
const resultReport = { ...report, rcept_no: '20260824000231', report_nm: '증권발행실적보고서' };
const amendedPayload = { group: [
  { title: '일반사항', list: [{ ...amended, sbd: '2026.10.13 ~ 2026.10.14', pymd: '2026.10.16' }] },
  { title: '증권의종류', list: [{ ...amended, slprc: '12,000', slmthn: '일반공모' }] },
  { title: '인수인정보', list: [{ ...amended, actnmn: '검증증권' }] }
] };
const ipoText = '금번 공모는 코스닥시장 신규상장을 위한 일반공모입니다.';
const historyClient = history => ({
  list: async params => params.corp_code ? history : [finalTerms],
  equity: async () => amendedPayload,
  document: async () => new Uint8Array()
});
const unzipText = () => ({ 'a.xml': new TextEncoder().encode(ipoText) });
test('발행조건확정 이후에도 요약이 가리키는 정정신고서 기준으로 자동 게시한다', async () => {
  const result = await collectOfferings({ client: historyClient([resultReport, finalTerms, amended]), unzip: unzipText, now: new Date('2026-10-02T00:00:00Z') });
  assert.equal(result.review.length, 0);
  assert.equal(result.listings.length, 1);
  assert.equal(result.listings[0].dart_receipt_no, amended.rcept_no);
  assert.equal(result.listings[0].source_payload.latest_receipt_no, finalTerms.rcept_no);
  assert.equal(result.listings[0].is_published, true);
  // 다음 실행에서 같은 최신 공시를 다시 만나면 재계산하지 않는다.
  const again = await collectOfferings({ client: { ...historyClient([]), equity: () => { throw new Error('should not be called'); } }, unzip: unzipText, now: new Date('2026-10-02T00:00:00Z'), existing: [result.listings[0]] });
  assert.equal(again.listings.length, 0); assert.equal(again.review.length, 0);
});
test('요약 이후 철회신고서가 있으면 철회로 숨긴다', async () => {
  const withdrawal = { ...report, rcept_no: '20260831001297', report_nm: '철회신고서' };
  const result = await collectOfferings({ client: historyClient([withdrawal, finalTerms, amended]), unzip: unzipText, now: new Date('2026-10-02T00:00:00Z') });
  assert.equal(result.listings[0].status, '철회');
  assert.equal(result.listings[0].is_published, false);
});
test('5거래일 성과는 휴장일을 건너뛰고 시초가 매수 수익률을 별도로 계산한다', () => {
  const sample = { listedAt: '2026-09-21', offerPrice: 10000, days: [
    { date: '2026-09-21', open: 25250, high: 40000, close: 36900 },
    { date: '2026-09-22', close: 29800 }, { date: '2026-09-23', close: 24800 },
    { date: '2026-09-28', close: 20600 }, { date: '2026-09-29', close: 17260 }
  ] };
  const result = performance.analyze(sample);
  assert.equal(result.fifth.date, '2026-09-29'); assert.ok(Math.abs(result.weekReturn - 72.6) < 0.001);
  assert.ok(result.afterOpenReturn < 0); assert.equal(result.quadrupleHit, true); assert.equal(result.quadrupleClose, false);
  assert.equal(performance.analyze({ ...sample, days: sample.days.slice(0, 4) }).weekReturn, null);
});
