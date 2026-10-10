// Capability audit 2026-09-06, P0 item 2: one wilson() helper behind every
// printed share. The reference values are the textbook Wilson score interval
// (Wilson 1927, z = 1.96); the harness's wilsonInterval in scripts/ computes the
// same numbers from a rate, this one from counts.

import { describe, it, expect } from 'vitest';
import { wilson } from '../../../src/forensics/wilson';

describe('wilson()', () => {
  it('returns null on an empty denominator instead of a fake 0%', () => {
    expect(wilson(0, 0)).toBeNull();
    expect(wilson(5, 0)).toBeNull();
    expect(wilson(3, -2)).toBeNull();
  });

  it('matches the textbook interval on a known case (k=42, n=169)', () => {
    const s = wilson(42, 169)!;
    expect(s.p).toBeCloseTo(0.2485, 4);
    expect(s.lower).toBeCloseTo(0.1897, 3);
    expect(s.upper).toBeCloseTo(0.3187, 3);
    expect(s.pct).toBe(25);
    expect(s.lowerPct).toBe(19);
    expect(s.upperPct).toBe(32);
  });

  it('never claims certainty at the boundaries', () => {
    const none = wilson(0, 10)!;
    expect(none.lower).toBe(0);
    expect(none.upper).toBeGreaterThan(0.25);
    const all = wilson(10, 10)!;
    expect(all.upper).toBe(1);
    expect(all.lower).toBeLessThan(0.75);
  });

  it('narrows as n grows at a fixed rate', () => {
    const small = wilson(5, 20)!;
    const large = wilson(500, 2000)!;
    expect(large.upper - large.lower).toBeLessThan(small.upper - small.lower);
  });

  it('clamps k to n and floors non-integers, so a rate passed by mistake reads wrong loudly', () => {
    const s = wilson(0.25, 100)!;
    expect(s.k).toBe(0);
    expect(wilson(120, 100)!.k).toBe(100);
  });

  it('agrees with the research lane arithmetic (harness wilsonInterval)', () => {
    // scripts/research/lib/harness-common.ts wilsonInterval(p, n): same formula from a rate.
    const p = 0.588;
    const n = 500;
    const z = 1.96;
    const z2 = z * z;
    const denom = 1 + z2 / n;
    const center = p + z2 / (2 * n);
    const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
    const s = wilson(294, 500)!;
    expect(s.lower).toBeCloseTo((center - margin) / denom, 10);
    expect(s.upper).toBeCloseTo((center + margin) / denom, 10);
  });
});
