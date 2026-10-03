import test from 'node:test';
import assert from 'node:assert/strict';
import { extractIpoSignals, extractIssuedLockup, scoreIpoSignals, applyAutomaticScore } from '../tools/ipo-score.mjs';

test('automatic score requires enough disclosed IPO signals', () => {
  const text = '기관 수요예측 경쟁률은 1,205.4:1 이며 의무보유확약 비율은 16.2% 입니다. 상장일 유통가능물량은 27.5% 입니다.';
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
  const signals = extractIpoSignals('의무보유확약 비율 15% 상장일 유통가능물량 28%');
  const result = scoreIpoSignals(signals);
  assert.equal(result.score_status, 'auto');
  assert.equal(result.coverage, 55);
});

test('issuance report lockup rate uses allocated shares, excluding uncommitted shares', () => {
  const report = '기관투자자 의무보유확약기간별 배정현황 6개월 확약 100 10.0 - - 200 20.0 3개월 확약 300 30.0 - - 400 40.0 미확약 200 20.0 계 800 100.0 Ⅲ.';
  const lockup = extractIssuedLockup(report);
  assert.equal(lockup.value, 75);
  assert.equal(lockup.source, 'issued');
});
