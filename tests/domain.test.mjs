import test from 'node:test';
import assert from 'node:assert/strict';
import core from '../radar-core.js';
import performance from '../performance-core.js';
import { datesFromText, normalizeOffering, createDartClient, ipoEvidence, collectOfferings, confirmedPrice, priceBand, extractSubscriptionBrokers, PARSER_VERSION } from '../supabase/functions/_shared/dart.mjs';

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
test('원문 다운로드 도중 시간 초과나 일시 오류는 재시도하고 키는 숨긴다', async () => {
  let calls = 0;
  const zip = new Uint8Array([0x50, 0x4b, 1, 2]);
  const flaky = createDartClient('a'.repeat(40), async () => {
    calls++;
    if (calls === 1) return { ok: false, status: 503 };
    if (calls === 2) return { ok: true, arrayBuffer: async () => { throw new Error('The operation was aborted due to timeout'); } };
    return { ok: true, arrayBuffer: async () => zip.buffer };
  }, { retryDelayMs: 0 });
  assert.deepEqual([...await flaky.document('1')], [...zip]); assert.equal(calls, 3);
  const down = createDartClient('a'.repeat(40), async url => { throw new Error('connect failed ' + url); }, { retryDelayMs: 0 });
  await assert.rejects(down.document('1'), error => /네트워크 요청 실패/.test(error.message) && !/crtfc_key|aaaa/.test(error.message));
  let notFound = 0;
  const missing = createDartClient('a'.repeat(40), async () => { notFound++; return { ok: false, status: 404 }; }, { retryDelayMs: 0 });
  await assert.rejects(missing.document('1'), /HTTP 404/); assert.equal(notFound, 1);
});
test('이미 반영한 정정 공시는 다시 만들지 않는다', async () => {
  const client = { list: async params => params.pblntf_detail_ty ? [{ ...report, report_nm: '증권신고서(지분증권)' }] : [], equity: () => { throw new Error('should not be called'); } };
  const result = await collectOfferings({ client, unzip: () => ({}), now: new Date('2026-10-02T00:00:00Z'), existing: [{ source_key: 'dart-ipo:00001234', dart_receipt_no: report.rcept_no, source_payload: { parser_version: PARSER_VERSION } }] });
  assert.equal(result.listings.length, 0); assert.equal(result.review.length, 0);
});
test('예전 파서로 저장된 종목은 같은 공시라도 한 번 다시 계산한다', async () => {
  let equityCalls = 0;
  const client = { list: async params => params.corp_code ? [] : [{ ...report, report_nm: '증권신고서(지분증권)' }], equity: async () => { equityCalls++; return payload; }, document: async () => new Uint8Array() };
  const unzip = () => ({ 'a.xml': new TextEncoder().encode('금번 공모는 코스닥시장 신규상장을 위한 일반공모입니다.') });
  const result = await collectOfferings({ client, unzip, now: new Date('2026-10-02T00:00:00Z'), existing: [{ source_key: 'dart-ipo:00001234', dart_receipt_no: report.rcept_no, source_payload: {} }] });
  assert.equal(equityCalls, 1);
  assert.equal(result.listings[0].source_payload.parser_version, PARSER_VERSION);
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
test('확정 공모가는 발행조건확정 정정 후 값만, 희망가는 밴드로 읽는다', () => {
  // 실제 원문 문구(스카이랩스·덕산넵코어스)
  assert.equal(confirmedPrice('정정 전 모집(매출)가액(예정): 12,400원 ~ 14,600원 정정 후 0% - 모집(매출)가액: 14,600원 - 모집(매출)총액: 43,800,000,000원'), '14,600');
  assert.equal(confirmedPrice('협의한 후 1주당 확정공모가액을 10,000원으로 최종 결정하였습니다'), '10,000');
  assert.equal(confirmedPrice('제시 희망공모가액인 13,000원 ~ 16,000원 중 최저가액인 13,000원 기준입니다'), null);
  assert.deepEqual(priceBand('제시 희망공모가액인 13,000원 ~ 16,000원 중 최저가액인 13,000원 기준입니다'), ['13,000', '16,000']);
});
test('청약취급처 원문에서 일반청약자 접수 증권사만 추린다', () => {
  const text = '청약취급처: ① 우리사주조합 : 미래에셋증권㈜ ② 기관투자자 : 미래에셋증권㈜ 본점 ③ 일반청약자 : 미래에셋증권㈜ 및 현대차증권㈜ 본·지점 ④ 일반청약자는 중복 청약을 할 수 없습니다. 청약취급처 ③ 일반청약자 : 삼성증권㈜ 본·지점';
  assert.deepEqual(extractSubscriptionBrokers(text, ['미래에셋증권', '현대차증권', 'NH투자증권']), ['미래에셋증권', '현대차증권', '삼성증권']);
  assert.deepEqual(extractSubscriptionBrokers('청약취급처는 각 인수단에 문의하시기 바랍니다.', ['미래에셋증권']), []);
});
test('기도산업·스팩식 상장 문구도 인식하지만 유상증자는 거른다', () => {
  assert.ok(ipoEvidence('주8) 본 주식은 코스닥시장 상장을 목적으로 모집(매출)하는 것으로 상장예비심사 승인을 받았습니다'));
  assert.ok(ipoEvidence('또한, 코스닥시장 상장을 위한 최초의 모집 이후에는 채무증권을 발행할 수 없습니다'));
  assert.ok(ipoEvidence('⑤ 최초로 모집한 주권에 대한 주금납입일부터 90일 이내 증권시장에 상장할 것'));
  assert.equal(ipoEvidence('당사는 2024년 코스닥시장에 상장하였으며, 이번 모집은 시설자금 조달을 위한 주주배정 유상증자입니다.'), null);
  // 상장사 유상증자 신고서가 예전 상장 당시의 상장주선인 의무를 언급해도 공모주로 보지 않는다(이노스페이스·클로봇 사례).
  assert.equal(ipoEvidence('공모를 통해 조달한 공모자금 (상장주선인 의무인수분 포함)은 시설투자에 사용합니다.'), null);
  assert.ok(ipoEvidence('공모일정 변동가능성 및 상장예비심사결과 효력 종료에 관한 위험'));
  assert.ok(ipoEvidence('본 주식은 한국거래소 내 코스닥시장 상장을 목적으로 모집(매출)하는 것으로'));
});
test('KIND 신규상장 목록에 있는 종목은 원문 문구가 달라도 공모주로 인정한다', () => {
  const text = '당행은 유가증권시장 상장 후 6개월간 추가 발행을 하지 않습니다.';
  assert.ok(normalizeOffering(payload, report, text).review);
  assert.equal(normalizeOffering(payload, report, text, { kindListed: true }).listing.source_payload.evidence, 'KIND 신규상장(공모) 종목으로 확인');
});
test('외국 기업의 증권예탁증권(DR) 공모도 DR 요약으로 자동 게시한다', async () => {
  const dr = { ...report, report_nm: '증권신고서(증권예탁증권)' };
  const client = {
    list: async params => params.corp_code ? [] : params.pblntf_detail_ty === 'C005' ? [dr] : [],
    equity: () => { throw new Error('지분증권 요약을 쓰면 안 됨'); },
    depositary: async () => payload,
    document: async () => new Uint8Array()
  };
  const result = await collectOfferings({ client, unzip: unzipText, now: new Date('2026-10-02T00:00:00Z') });
  assert.equal(result.review.length, 0);
  assert.equal(result.listings.length, 1);
  assert.equal(result.listings[0].source_key, 'dart-ipo:00001234');
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
