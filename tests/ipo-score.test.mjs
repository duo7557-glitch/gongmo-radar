import test from 'node:test';
import assert from 'node:assert/strict';
import { extractIpoSignals, extractIssuedLockup, scoreIpoSignals, applyAutomaticScore } from '../tools/ipo-score.mjs';

test('automatic score requires enough disclosed IPO signals', () => {
  const text = '기관 수요예측 경쟁률은 1,205.4:1 이며 의무보유확약 비율은 16.2% 입니다. 상장예정주식수 1,000,000주 중 27.5%에 해당하는 275,000주는 상장 직후 유통가능 물량입니다.';
  const signals = extractIpoSignals(text);
  assert.equal(signals.demand_ratio.value, 1205.4);
  assert.equal(signals.lockup_rate.value, 16.2);
  assert.equal(signals.float_rate.value, 27.5);
  assert.equal(scoreIpoSignals(signals).score_status, 'auto');
  const listing = applyAutomaticScore({ source_payload: {} }, text, new Date('2026-10-03T00:00:00Z'));
  assert.equal(listing.score_status, 'auto');
  assert.ok(listing.score >= 0 && listing.score <= 100);
  assert.match(listing.reason, /투자 권유가 아닙니다/);
});

test('ambiguous or incomplete signals keep a listing pending', () => {
  const mixed = extractIpoSignals('수요예측 경쟁률 100:1 수요예측 경쟁률 200:1');
  assert.equal(mixed.demand_ratio, null);
  const pending = applyAutomaticScore({ source_payload: {} }, '수요예측 경쟁률은 800:1 입니다.');
  assert.equal(pending.score, null);
  assert.equal(pending.score_status, 'pending');
});

test('two disclosed signals can produce a transparent partial-coverage comparison', () => {
  const signals = extractIpoSignals('의무보유확약 비율 15% 상장예정주식수 10,000,000주 중 28%에 해당하는 2,800,000주는 상장 직후 유통가능 물량입니다.');
  const result = scoreIpoSignals(signals);
  assert.equal(result.score_status, 'auto');
  assert.equal(result.coverage, 55);
});

test('institutional demand is extracted only from an explicit final participation-ratio row', () => {
  const text = '수요예측 참여 내역 합계 수량 1,000,000 경쟁률 100.00 250.50 1,234.56 주1) 경쟁률은 기관투자자 배정주수 810,000주를 기준으로 산출한 단순경쟁률입니다. (나) 수요예측 신청가격 분포';
  assert.equal(extractIpoSignals(text).demand_ratio.value, 1234.56);
  assert.equal(extractIpoSignals('청약 경쟁률 1,234.56:1').demand_ratio, null);
  assert.equal(extractIpoSignals('수요예측 일정은 다음과 같습니다. 경쟁률은 추후 공시 예정입니다.').demand_ratio, null);
});

test('float availability ignores shareholder ownership and computes only the post-IPO summary', () => {
  const wrong = '최대주주 보유 지분율 62.16%. 최대주주등 8,203,900주 46.27%';
  assert.equal(extractIpoSignals(wrong).float_rate, null);
  const right = '상장예정주식수(금번 공모주식 및 의무인수분 포함) 17,729,964 중 30.83%에 해당하는 5,465,381주는 상장 직후 유통가능 물량에 해당합니다.';
  const result = extractIpoSignals(right).float_rate;
  assert.equal(result.value, 30.83);
  assert.equal(result.source, 'calculated');
  const corrected = extractIpoSignals('정정 전 상장예정주식수 10,000,000주 중 40%에 해당하는 4,000,000주는 상장 직후 유통가능 물량입니다. 정정 후 상장예정주식수 12,000,000주 중 25%에 해당하는 3,000,000주는 상장 직후 유통가능 물량입니다.');
  assert.equal(corrected.float_rate.value, 25);
});

test('float availability reads the listing-day row only inside the dedicated aggregate table', () => {
  const text = '최대주주 보유 지분 62.16% [상장 후 유통가능 주식수 현황] 구분 주식수 비율 상장일 유통가능 2,000,000주 25.00% 상장 후 1개월 뒤 유통가능 3,000,000주 37.50%';
  const result = extractIpoSignals(text).float_rate;
  assert.equal(result.value, 25);
  assert.equal(result.source, 'table');
});

test('issuance report lockup rate uses allocated shares, excluding uncommitted shares', () => {
  const report = '기관투자자 의무보유확약기간별 배정현황 6개월 확약 100 10.0 - - 200 20.0 3개월 확약 300 30.0 - - 400 40.0 미확약 200 20.0 계 800 100.0 Ⅲ.';
  const lockup = extractIssuedLockup(report);
  assert.equal(lockup.value, 75);
  assert.equal(lockup.source, 'issued');
});
