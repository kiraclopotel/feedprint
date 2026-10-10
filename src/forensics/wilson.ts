/**
 * One place for a printed share. Every percentage the dashboard or the export
 * prints comes with its numerator, its denominator and a 95% Wilson score
 * interval, so a share can never leave the product without the n that made it
 * (the capability audit of 2026-09-06, P0 item 2: a share without its n and its
 * interval is the door the x364 error walked through).
 *
 * Same arithmetic as scripts/research/lib/harness-common.ts wilsonInterval (the research
 * lane), restated over integer counts so a caller cannot pass a rate without
 * its denominator. Pure, no rounding except in the *Pct fields, which are what
 * the UI prints.
 */
export interface Share {
  /** Numerator. */
  k: number;
  /** Denominator. */
  n: number;
  /** k / n, unrounded, in [0, 1]. */
  p: number;
  /** Wilson 95% lower bound, unrounded, in [0, 1]. */
  lower: number;
  /** Wilson 95% upper bound, unrounded, in [0, 1]. */
  upper: number;
  /** Math.round(p * 100). */
  pct: number;
  /** Math.round(lower * 100). */
  lowerPct: number;
  /** Math.round(upper * 100). */
  upperPct: number;
}

/**
 * Wilson score interval for k successes in n trials. Returns null when there is
 * no denominator, so a caller has to render the empty case on purpose. Counts
 * are clamped to integers >= 0 and k to <= n; a caller that hands in a rate
 * instead of a count gets k = 0 or 1, which is the wrong answer on purpose.
 */
export function wilson(k: number, n: number, z = 1.96): Share | null {
  const nn = Math.max(0, Math.floor(n));
  if (nn === 0 || !Number.isFinite(nn)) return null;
  const kk = Math.min(nn, Math.max(0, Math.floor(k)));
  const p = kk / nn;
  const z2 = z * z;
  const denom = 1 + z2 / nn;
  const center = p + z2 / (2 * nn);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * nn)) / nn);
  const lower = Math.max(0, (center - margin) / denom);
  const upper = Math.min(1, (center + margin) / denom);
  return {
    k: kk,
    n: nn,
    p,
    lower,
    upper,
    pct: Math.round(p * 100),
    lowerPct: Math.round(lower * 100),
    upperPct: Math.round(upper * 100),
  };
}
