// Rule-based AnalysisResult builder (ARCHITECTURE-6 item 4). The expected
// objects below are the literals src/analysis/pipeline.ts spelled by hand before
// the builder existed, copied verbatim with fixed inputs, key order included.
// If the builder drifts from any of them, this fails.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ruleAnalysis } from '../../../src/core/analysis-result';
import type { AnalysisResult } from '../../../src/types/analysis';

const postId = 'post-1';
const startTime = 100;

function withNow<T>(now: number, fn: () => T): T {
  const spy = vi.spyOn(performance, 'now').mockReturnValue(now);
  try {
    return fn();
  } finally {
    spy.mockRestore();
  }
}

function expectSame(actual: AnalysisResult, literal: AnalysisResult): void {
  expect(actual).toEqual(literal);
  expect(Object.keys(actual)).toEqual(Object.keys(literal));
  expect(JSON.stringify(actual)).toBe(JSON.stringify(literal));
}

afterEach(() => vi.restoreAllMocks());

describe('ruleAnalysis matches the former pipeline literals', () => {
  it('parent blocklist hide (pipeline.ts blocklistAnalysis)', () => {
    const literal: AnalysisResult = {
      postId,
      isManipulative: false,
      overallScore: 0,
      overallConfidence: 1,
      processingTimeMs: 150 - startTime,
      techniques: [],
      action: 'hide',
    };
    const actual = withNow(150, () => ruleAnalysis({ postId, startTime, confidence: 1, action: 'hide' }));
    expectSame(actual, literal);
  });

  it('adult sponsored collapse (pipeline.ts adultAdAnalysis)', () => {
    const literal: AnalysisResult = {
      postId,
      isManipulative: false,
      overallScore: 0,
      overallConfidence: 0.99,
      processingTimeMs: 150 - startTime,
      techniques: [],
      action: 'collapse',
    };
    const actual = withNow(150, () => ruleAnalysis({ postId, startTime, confidence: 0.99, action: 'collapse' }));
    expectSame(actual, literal);
  });

  it('slur hide (pipeline.ts slurAnalysis)', () => {
    const matches = ['slur-a', 'slur-b'];
    const literal: AnalysisResult = {
      postId,
      isManipulative: true,
      overallScore: 9,
      overallConfidence: 0.98,
      processingTimeMs: 150 - startTime,
      techniques: [{
        technique: 'profanity',
        present: true,
        confidence: 0.98,
        severity: 9,
        evidence: matches,
      }],
      primaryTechnique: 'profanity',
      action: 'hide',
    };
    const actual = withNow(150, () => ruleAnalysis({
      postId, startTime, technique: 'profanity', severity: 9, confidence: 0.98, evidence: matches, action: 'hide',
    }));
    expectSame(actual, literal);
    expect(actual.techniques[0].evidence).toBe(matches);
  });

  it('sponsored collapse for child/teen (pipeline.ts adAnalysis)', () => {
    const literal: AnalysisResult = {
      postId,
      isManipulative: true,
      overallScore: 6,
      overallConfidence: 0.99,
      processingTimeMs: 150 - startTime,
      techniques: [{
        technique: 'consumer-rapid-frame',
        present: true,
        confidence: 0.99,
        severity: 6,
        evidence: ['platform sponsored/ad marker'],
      }],
      primaryTechnique: 'consumer-rapid-frame',
      action: 'collapse',
    };
    const actual = withNow(150, () => ruleAnalysis({
      postId, startTime, technique: 'consumer-rapid-frame', severity: 6, confidence: 0.99,
      evidence: ['platform sponsored/ad marker'], action: 'collapse',
    }));
    expectSame(actual, literal);
  });

  it('profanity hide and soften differ only in score and action (pipeline.ts profanityAnalysis x2)', () => {
    const matches = ['word'];
    const hide: AnalysisResult = {
      postId,
      isManipulative: true,
      overallScore: 8,
      overallConfidence: 0.95,
      processingTimeMs: 150 - startTime,
      techniques: [{ technique: 'profanity', present: true, confidence: 0.95, severity: 8, evidence: matches }],
      primaryTechnique: 'profanity',
      action: 'hide',
    };
    const soften: AnalysisResult = {
      postId,
      isManipulative: true,
      overallScore: 4,
      overallConfidence: 0.95,
      processingTimeMs: 150 - startTime,
      techniques: [{ technique: 'profanity', present: true, confidence: 0.95, severity: 4, evidence: matches }],
      primaryTechnique: 'profanity',
      action: 'rewrite',
    };
    expectSame(
      withNow(150, () => ruleAnalysis({ postId, startTime, technique: 'profanity', severity: 8, confidence: 0.95, evidence: matches, action: 'hide' })),
      hide,
    );
    expectSame(
      withNow(150, () => ruleAnalysis({ postId, startTime, technique: 'profanity', severity: 4, confidence: 0.95, evidence: matches, action: 'rewrite' })),
      soften,
    );
  });

  it('dehumanization, violence-graphic and laundering hides (pipeline.ts dehum/vn/launder)', () => {
    const dehum: AnalysisResult = {
      postId,
      isManipulative: true,
      overallScore: 9,
      overallConfidence: 0.98,
      processingTimeMs: 150 - startTime,
      techniques: [{ technique: 'extreme-toxicity', present: true, confidence: 0.98, severity: 9, evidence: ['ev-1'] }],
      primaryTechnique: 'extreme-toxicity',
      action: 'hide',
    };
    const vn: AnalysisResult = {
      postId,
      isManipulative: true,
      overallScore: 8,
      overallConfidence: 0.9,
      processingTimeMs: 150 - startTime,
      techniques: [{ technique: 'violence-graphic', present: true, confidence: 0.9, severity: 8, evidence: ['narrated'] }],
      primaryTechnique: 'violence-graphic',
      action: 'hide',
    };
    const launder: AnalysisResult = {
      postId,
      isManipulative: true,
      overallScore: 9,
      overallConfidence: 0.95,
      processingTimeMs: 150 - startTime,
      techniques: [{ technique: 'extreme-toxicity', present: true, confidence: 0.95, severity: 9, evidence: ['m'] }],
      primaryTechnique: 'extreme-toxicity',
      action: 'hide',
    };
    expectSame(withNow(150, () => ruleAnalysis({ postId, startTime, technique: 'extreme-toxicity', severity: 9, confidence: 0.98, evidence: ['ev-1'], action: 'hide' })), dehum);
    expectSame(withNow(150, () => ruleAnalysis({ postId, startTime, technique: 'violence-graphic', severity: 8, confidence: 0.9, evidence: ['narrated'], action: 'hide' })), vn);
    expectSame(withNow(150, () => ruleAnalysis({ postId, startTime, technique: 'extreme-toxicity', severity: 9, confidence: 0.95, evidence: ['m'], action: 'hide' })), launder);
  });

  it('coded harm hide takes technique and severity from the shared mapping (pipeline.ts codedAnalysis)', () => {
    const literal: AnalysisResult = {
      postId,
      isManipulative: true,
      overallScore: 7,
      overallConfidence: 0.95,
      processingTimeMs: 150 - startTime,
      techniques: [{
        technique: 'self-harm',
        present: true,
        confidence: 0.95,
        severity: 7,
        evidence: ['coded-harm:cat:ev'],
      }],
      primaryTechnique: 'self-harm',
      action: 'hide',
    };
    const actual = withNow(150, () => ruleAnalysis({
      postId, startTime, technique: 'self-harm', severity: 7, confidence: 0.95, evidence: ['coded-harm:cat:ev'], action: 'hide',
    }));
    expectSame(actual, literal);
  });

  it('harm-floor collapse uses the pre-measured elapsed time (pipeline.ts synthesisedAnalysis)', () => {
    const literal: AnalysisResult = {
      postId,
      isManipulative: true,
      overallScore: 6,
      overallConfidence: 0.7,
      processingTimeMs: 42,
      techniques: [{
        technique: 'extreme-toxicity',
        present: true,
        confidence: 0.7,
        severity: 6,
        evidence: ['s1:e1', 's2:e2'],
      }],
      primaryTechnique: 'extreme-toxicity',
      action: 'collapse',
    };
    const actual = withNow(999, () => ruleAnalysis({
      postId, startTime, processingTimeMs: 42, technique: 'extreme-toxicity', severity: 6, confidence: 0.7,
      evidence: ['s1:e1', 's2:e2'], action: 'collapse',
    }));
    expect(actual).toEqual(literal);
    expect(actual.processingTimeMs).toBe(42);
  });
});
