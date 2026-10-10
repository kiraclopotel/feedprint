// FeelingWise — Global flush budget unit tests.
//
// Locks the cross-call cooldown at src/ai/global-flush-budget.ts. Three
// failures inside a 10s rolling window trip a 15s hold across all callers.
// This is the cross-cutting brake that prevents 5xx storms from billing
// upstream tokens — it bypasses per-key rate-limiter logic and gates the
// entire client. Wrong window math = either thrash (hold-too-short) or
// over-conservative (hold-too-long).
//
// Tests pass `now` explicitly to every helper: real Date.now() inside
// assertions makes the suite flaky.

import { afterEach, describe, it, expect, beforeEach } from 'vitest';

import {
  recordFailure,
  isHolding,
  holdRemainingMs,
  _resetForTests,
} from '../../../src/ai/global-flush-budget';

const HOLD_DURATION_MS = 15_000;

describe('global-flush-budget', () => {
  beforeEach(() => {
    _resetForTests();
  });

  afterEach(() => {
    _resetForTests();
  });

  it('after _resetForTests, isHolding(now) is false', () => {
    expect(isHolding(0)).toBe(false);
    expect(isHolding(123_456)).toBe(false);
  });

  it('one failure does not trigger hold', () => {
    recordFailure(0);
    expect(isHolding(0)).toBe(false);
    expect(holdRemainingMs(0)).toBe(0);
  });

  it('three failures within 10s window trip the hold', () => {
    recordFailure(0);
    recordFailure(1000);
    recordFailure(2000);

    expect(isHolding(2000)).toBe(true);
    // holdUntil = 2000 + 15000 = 17000; remaining at now=2000 is 15000.
    expect(holdRemainingMs(2000)).toBe(HOLD_DURATION_MS);
  });

  it('hold expires after HOLD_DURATION_MS elapses past the third failure', () => {
    recordFailure(0);
    recordFailure(1000);
    recordFailure(2000);

    // Past hold expiry: 2000 + 15000 + 1 = 17001.
    expect(isHolding(17_001)).toBe(false);
    expect(holdRemainingMs(17_001)).toBe(0);
  });

  it('three failures spread across more than the 10s window do NOT trigger hold', () => {
    // First failure at 0, second at 5000, third at 15000.
    // pruneOldFailures uses cutoff = now - HOLD_WINDOW_MS = 15000 - 10000 = 5000.
    // After pushing 15000, log = [0, 5000, 15000]; while-loop drops entries
    // with timestamp < 5000, so 0 is removed. Surviving log = [5000, 15000];
    // length 2 < 3 → no hold.
    recordFailure(0);
    recordFailure(5000);
    recordFailure(15_000);

    expect(isHolding(15_000)).toBe(false);
    expect(holdRemainingMs(15_000)).toBe(0);
  });

  it('exact-window boundary: 10s exact between first and third failure DOES trigger hold', () => {
    // Failures at 0 and 5000. Third at 10000 — cutoff = 10000 - 10000 = 0.
    // failureLog[0] = 0 is NOT < 0, so the prune loop does not remove it.
    // Push 10000 → log = [0, 5000, 10000]; length 3 → hold triggers.
    recordFailure(0);
    recordFailure(5000);
    recordFailure(10_000);

    expect(isHolding(10_000)).toBe(true);
    expect(holdRemainingMs(10_000)).toBe(HOLD_DURATION_MS);
  });

  it('a fourth failure within the window re-arms holdUntil from that timestamp', () => {
    // After 3 failures at 0/1000/2000, holdUntil = 17000.
    // Fourth failure at 3000: log still has length 3 (within window),
    // so holdUntil = 3000 + 15000 = 18000.
    recordFailure(0);
    recordFailure(1000);
    recordFailure(2000);
    recordFailure(3000);

    expect(isHolding(3000)).toBe(true);
    expect(holdRemainingMs(3000)).toBe(HOLD_DURATION_MS);
    // Past the original 17000 expiry but inside the new 18000 expiry.
    expect(isHolding(17_500)).toBe(true);
  });

  it('holdRemainingMs returns 0 when not holding', () => {
    // No failures recorded.
    expect(holdRemainingMs(100)).toBe(0);
    expect(holdRemainingMs(999_999_999)).toBe(0);
  });

  it('holdRemainingMs never returns a negative number', () => {
    recordFailure(0);
    recordFailure(1000);
    recordFailure(2000);
    // Way past hold expiry — holdUntil - now would be negative without the clamp.
    expect(holdRemainingMs(1_000_000)).toBe(0);
  });

  it('_resetForTests after a triggered hold clears state completely', () => {
    recordFailure(0);
    recordFailure(1000);
    recordFailure(2000);
    expect(isHolding(2000)).toBe(true);

    _resetForTests();

    expect(isHolding(2000)).toBe(false);
    expect(holdRemainingMs(2000)).toBe(0);
    // And a fresh single failure does not trigger anything.
    recordFailure(2000);
    expect(isHolding(2000)).toBe(false);
  });
});
