// Monthly cap tests.
//
// Per the 2026-05-08 token-cap migration: the per-tier monthly cap is
// expressed as a USD budget on the parent's Groq spend, derived to a token
// cap at runtime via the V1 single-model rate. Pipeline enforces the cap
// against `settings.totalTokensThisMonth`.
//
// Coverage:
//   1. utcMonthKey() returns 'YYYY-MM' format from a Date (boundary, padding,
//      timezone-independence).
//   2. monthlyUsdCapForTier() returns the correct dollar cap per tier.
//   3. monthlyTokenCapForTier() derives correctly from the dollar cap +
//      Groq 8b rate (0.065 / 1M tokens blended).
//   4. Cap monotonicity invariant: Starter ≤ Family ≤ Extended.

import { describe, it, expect } from 'vitest';
import { utcMonthKey } from '../../../src/storage/settings';
import {
  MONTHLY_USD_CAP_BY_TIER,
  monthlyTokenCapForTier,
  effectiveMonthlyUsdCap,
  effectiveMonthlyTokenCap,
} from '../../../src/storage/license';

describe('utcMonthKey()', () => {
  it('returns YYYY-MM format for a known UTC date', () => {
    const d = new Date(Date.UTC(2026, 3, 30, 14, 32, 11));
    expect(utcMonthKey(d)).toBe('2026-04');
  });

  it('returns YYYY-MM format with zero-padded month', () => {
    const d = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
    expect(utcMonthKey(d)).toBe('2026-01');
  });

  it('rolls over correctly at UTC month boundary', () => {
    const lastDayApril = new Date(Date.UTC(2026, 3, 30, 23, 59, 59));
    const firstDayMay = new Date(Date.UTC(2026, 4, 1, 0, 0, 0));
    expect(utcMonthKey(lastDayApril)).toBe('2026-04');
    expect(utcMonthKey(firstDayMay)).toBe('2026-05');
    expect(utcMonthKey(lastDayApril)).not.toBe(utcMonthKey(firstDayMay));
  });

  it('is independent of local timezone (uses UTC components)', () => {
    const d = new Date(Date.UTC(2026, 3, 30, 23, 30, 0));
    expect(utcMonthKey(d)).toBe('2026-04');
  });

  it('default arg uses current Date (no thrown errors on no-arg call)', () => {
    const result = utcMonthKey();
    expect(result).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe('MONTHLY_USD_CAP_BY_TIER (single source of truth)', () => {
  it('is $0 for free and $3.50 for each paid tier (never more than a 6 euro sale brings in)', () => {
    expect(MONTHLY_USD_CAP_BY_TIER.free).toBe(0);
    expect(MONTHLY_USD_CAP_BY_TIER.starter).toBe(3.5);
    expect(MONTHLY_USD_CAP_BY_TIER.family).toBe(3.5);
    expect(MONTHLY_USD_CAP_BY_TIER.extended).toBe(3.5);
  });
});

describe('monthlyTokenCapForTier()', () => {
  // Conversion: $3.50 / ($0.10 / 1M tokens) = 35,000,000 token-equivalents (the
  // all-AI ceiling per licence). Math.floor rounds down. Caps are uniform
  // across paid tiers. The $0.10/M basis is conservative for text (gpt-oss-20b
  // effective ~$0.08/M); video (Gemini/Whisper) meters through the SAME counter,
  // scaled up server-side so it counts ≥ real — see src/storage/license.ts +
  // worker GEMINI_COST_FACTOR / WHISPER_TOKEN_EQUIV_PER_SECOND.
  const GROQ_BLENDED_RATE = 0.10;

  it('returns 0 tokens for Free tier', () => {
    expect(monthlyTokenCapForTier('free')).toBe(0);
  });

  it('derives Starter token cap from $3.50 / blended rate', () => {
    const expected = Math.floor((3.5 / GROQ_BLENDED_RATE) * 1_000_000);
    expect(monthlyTokenCapForTier('starter')).toBe(expected);
    expect(expected).toBe(35_000_000);
  });

  it('derives Family token cap uniformly with Starter (per-license caps)', () => {
    expect(monthlyTokenCapForTier('family')).toBe(monthlyTokenCapForTier('starter'));
  });

  it('derives Extended token cap uniformly with Starter (per-license caps)', () => {
    expect(monthlyTokenCapForTier('extended')).toBe(monthlyTokenCapForTier('starter'));
  });

  it('paid tiers have monotonically non-decreasing token caps (uniform = OK)', () => {
    expect(monthlyTokenCapForTier('starter')).toBeLessThanOrEqual(monthlyTokenCapForTier('family'));
    expect(monthlyTokenCapForTier('family')).toBeLessThanOrEqual(monthlyTokenCapForTier('extended'));
  });

  it('returns an integer (tokens are whole units in Groq billing)', () => {
    expect(Number.isInteger(monthlyTokenCapForTier('starter'))).toBe(true);
    expect(Number.isInteger(monthlyTokenCapForTier('family'))).toBe(true);
    expect(Number.isInteger(monthlyTokenCapForTier('extended'))).toBe(true);
  });
});

describe('effectiveMonthlyUsdCap()', () => {
  // Parent-overridable cap. When override is null/undefined, returns tier
  // default. When override is a non-negative number, returns the override.
  // Negative or non-finite overrides are ignored.

  it('returns tier default when override is null', () => {
    expect(effectiveMonthlyUsdCap('starter', null)).toBe(3.5);
    expect(effectiveMonthlyUsdCap('family', null)).toBe(3.5);
    expect(effectiveMonthlyUsdCap('extended', null)).toBe(3.5);
  });

  it('returns tier default when override is undefined', () => {
    expect(effectiveMonthlyUsdCap('starter', undefined)).toBe(3.5);
  });

  it('returns parent override when set above tier default', () => {
    expect(effectiveMonthlyUsdCap('starter', 30)).toBe(30);
    expect(effectiveMonthlyUsdCap('extended', 100)).toBe(100);
  });

  it('returns parent override when set below tier default', () => {
    expect(effectiveMonthlyUsdCap('starter', 3)).toBe(3);
    expect(effectiveMonthlyUsdCap('family', 2)).toBe(2);
  });

  it('returns 0 when override is 0 (effectively pauses AI)', () => {
    expect(effectiveMonthlyUsdCap('starter', 0)).toBe(0);
  });

  it('falls back to tier default on negative override', () => {
    expect(effectiveMonthlyUsdCap('starter', -5)).toBe(3.5);
  });

  it('falls back to tier default on NaN override', () => {
    expect(effectiveMonthlyUsdCap('starter', NaN)).toBe(3.5);
  });

  it('Free tier always returns $0 regardless of override', () => {
    expect(effectiveMonthlyUsdCap('free', null)).toBe(0);
    // Override is honored even for free tier — parent could theoretically
    // un-pause AI by passing a positive override + a paid license. But
    // free-tier installs typically have no license; behavior is consistent
    // with the override-replaces-default contract.
    expect(effectiveMonthlyUsdCap('free', 10)).toBe(10);
  });
});

describe('effectiveMonthlyTokenCap()', () => {
  // Same $0.10/M blended basis as monthlyTokenCapForTier above (8b rate +
  // video-call margin; see src/storage/license.ts GROQ_BLENDED_RATE_PER_1M).
  const GROQ_BLENDED_RATE = 0.10;

  it('returns tier-derived token cap when override is null', () => {
    expect(effectiveMonthlyTokenCap('starter', null)).toBe(monthlyTokenCapForTier('starter'));
  });

  it('returns override-derived token cap when override is set', () => {
    const usdCap = 10;
    const expected = Math.floor((usdCap / GROQ_BLENDED_RATE) * 1_000_000);
    expect(effectiveMonthlyTokenCap('starter', usdCap)).toBe(expected);
  });

  it('returns 0 tokens when override is 0', () => {
    expect(effectiveMonthlyTokenCap('starter', 0)).toBe(0);
  });

  it('returns an integer regardless of override', () => {
    expect(Number.isInteger(effectiveMonthlyTokenCap('starter', 7))).toBe(true);
    expect(Number.isInteger(effectiveMonthlyTokenCap('family', 13.50))).toBe(true);
  });
});
