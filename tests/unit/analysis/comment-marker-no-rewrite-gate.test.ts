// No-rewrite comment-marker gate — the marker decision keys on the flag
// (technique class + severity), NOT on sentiment polarity.
//
// Pre-fix, the render loop in src/content/index.ts required
// `verdict.sentiment === 'negative'` before marking a flagged comment that
// had no usable rewrite. Warm-toned confirmed concerns — parasocial-coercion,
// toxic-positivity, fomo — are exactly the manipulation classes that read as
// positive, so they fell through to a silent on-screen pass while the chain
// recorded a flag. The gate now lives in comment-batch-scorer.ts
// (`shouldRenderNoRewriteMarker`) so it is directly testable and cannot
// drift from the shipped consumer.
//
// Guard in the other direction: benign verdicts (NON_MANIPULATION_TECHNIQUES)
// and sub-floor severities still never mark — the fix does not expand what
// gets flagged, only guarantees confirmed flags are never invisible.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import {
  shouldRenderNoRewriteMarker,
  COMMENT_MARKER_SEVERITY_FLOOR,
} from '../../../src/analysis/comment-batch-scorer';

const INDEX_PATH = 'src/content/comment-batch/flush.ts';

describe('shouldRenderNoRewriteMarker — flag-keyed, sentiment-blind', () => {
  it('confirmed parasocial-coercion with POSITIVE sentiment → marker', () => {
    expect(
      shouldRenderNoRewriteMarker({
        technique: 'parasocial-coercion',
        severity: 7,
        sentiment: 'positive',
      } as never),
    ).toBe(true);
  });

  it('toxic-positivity at the floor with positive sentiment → marker', () => {
    expect(
      shouldRenderNoRewriteMarker({
        technique: 'toxic-positivity',
        severity: COMMENT_MARKER_SEVERITY_FLOOR,
        sentiment: 'positive',
      } as never),
    ).toBe(true);
  });

  it('fomo with neutral sentiment above floor → marker', () => {
    expect(
      shouldRenderNoRewriteMarker({
        technique: 'fomo',
        severity: 6,
        sentiment: 'neutral',
      } as never),
    ).toBe(true);
  });

  it('negative-sentiment shame-attack above floor → marker (previous behavior kept)', () => {
    expect(
      shouldRenderNoRewriteMarker({
        technique: 'shame-attack',
        severity: 6,
        sentiment: 'negative',
      } as never),
    ).toBe(true);
  });

  it('benign verdicts never mark, regardless of severity or sentiment', () => {
    for (const technique of ['sarcasm', 'genuine-opinion', 'none', 'neutral', 'off-topic', 'supportive'] as const) {
      expect(shouldRenderNoRewriteMarker({ technique, severity: 9 })).toBe(false);
    }
  });

  it('manipulation technique below the severity floor → no marker (flagging not expanded)', () => {
    expect(
      shouldRenderNoRewriteMarker({
        technique: 'parasocial-coercion',
        severity: COMMENT_MARKER_SEVERITY_FLOOR - 1,
      }),
    ).toBe(false);
  });
});

describe('wiring — content script consumes the shared gate', () => {
  // The render loop lives in the content script, which cannot be imported in
  // a unit test (side-effectful module). Assert the source consumes the
  // shared predicate and the sentiment condition is gone, mirroring the
  // source-line assertion pattern in strict-language-gate.test.ts.
  const src = fs.readFileSync(INDEX_PATH, 'utf8');

  it('marker render loop calls shouldRenderNoRewriteMarker', () => {
    expect(src).toMatch(/!commentRewrite && !shouldRenderNoRewriteMarker\(verdict\)/);
  });

  it('no sentiment condition remains in the no-rewrite marker gate', () => {
    expect(src).not.toMatch(/sentiment !== 'negative'/);
  });
});
