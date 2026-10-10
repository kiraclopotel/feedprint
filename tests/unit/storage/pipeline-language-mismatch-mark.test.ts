/** @vitest-environment jsdom */
// Language-mismatch fallback — a confirmed detection whose rewrite drifted
// to the wrong language must MARK, never silently PASS.
//
// Pre-fix, the code-side language guard (src/analysis/pipeline.ts) treated a
// RO/EN-drifted rewrite as passWith('post-llm-language-mismatch'): the
// forensic record was written but the screen showed nothing — a confirmed
// flag with zero visible output. The fix routes the branch to the same
// MARK fallback the rewrite-unavailable branch uses: rewrite discarded
// (no broken-language text shipped), severity dot rendered on the original.
//
// Guard in the other direction: a below-threshold / not-manipulative result
// still PASSes — the fallback only fires on confirmed flags.
//
// Mock strategy mirrors tests/unit/storage/pipeline-harm-gates.test.ts: the
// I/O-coupled dependencies are mocked; the language detector + validator
// (core/lang-detect.ts, analysis/comment-rewriter.ts) run LIVE so the
// guard under test is exercised with real language scoring.

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../src/storage/settings', () => ({
  getSettings: vi.fn(),
  // Same shape as the real helper for the keys these tests exercise: the
  // W44 purpose gate reads reframe-rewrites on every post, and the guard
  // under test needs the full (rewrite-carrying) path.
  isFeatureEnabled: (
    s: { features?: Record<string, { enabled?: boolean }> },
    id: string,
  ) => s.features?.[id]?.enabled === true,
}));
vi.mock('../../../src/storage/license', () => ({
  getLicense: vi.fn(async () => ({ tier: 'family', secret: 's' })),
  dailyCapForTier: vi.fn(() => 2000),
  effectiveMonthlyTokenCap: vi.fn(() => 1_000_000),
  isUncappedTier: vi.fn(() => false),
}));
vi.mock('../../../src/storage/cache', () => ({
  processingCache: {
    getPersistent: vi.fn(async () => null),
    set: vi.fn(),
  },
}));
vi.mock('../../../src/core/calibration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/core/calibration')>()),
  getEffectiveThreshold: vi.fn(async () => 0.45),
}));
vi.mock('../../../src/forensics/author-store', () => ({
  getAuthorProfile: vi.fn(async () => null),
  // Exposure gate surface. Stubbed quiet so this test exercises only the
  // language-mismatch fork; the gate itself is covered by
  // pipeline-exposure-gate.test.ts.
  getExposurePressure: vi.fn(() => ({
    fired: false, reason: null, distinctDays: 0, creativeCount: 0,
  })),
  creativeHash: vi.fn(() => 'stub-hash'),
}));
vi.mock('../../../src/ai/client', () => ({
  getLastCallMeta: vi.fn(() => ({ model: 'llama-3.1-8b-instant', provider: 'groq' })),
}));
vi.mock('../../../src/ai/neutralize-only', () => ({
  neutralizeText: vi.fn(async () => 'unused'),
}));
const combinedMock = vi.fn();
vi.mock('../../../src/core/neutralizer', () => ({
  combinedDetectAndNeutralize: (...args: unknown[]) => combinedMock(...args),
}));

import { process } from '../../../src/analysis/pipeline';
import { getSettings } from '../../../src/storage/settings';
import { _resetForTests as resetFlushBudget } from '../../../src/ai/global-flush-budget';
import type { PostContent } from '../../../src/types/post';

const baseSettings = {
  mode: 'teen',
  strictLanguage: false,
  locale: 'en',
  outputLanguage: 'auto',
  dailyCap: 2000,
  monthlyUsdCapOverride: null,
  totalChecksToday: 0,
  totalTokensThisMonth: 0,
  // W44: the rewrite tier is switch-owned; these tests exercise the
  // rewrite-carrying path, so the switch is on (the preset default).
  features: { 'reframe-rewrites': { enabled: true } },
};

function makePost(text: string): PostContent {
  return {
    id: 'p1',
    text,
    author: '@u',
    timestamp: new Date().toISOString(),
    platform: 'twitter',
    domRef: new WeakRef(document.createElement('div')),
  } as PostContent;
}

// fear-appeal: a manipulation technique NOT in HIGH_RISK_PASS_THROUGH_TECHNIQUES,
// so the pipeline trusts the rewrite and the language guard is what decides.
function confirmedAnalysis() {
  return {
    postId: 'p1',
    isManipulative: true,
    overallScore: 7,
    overallConfidence: 0.9,
    processingTimeMs: 1,
    techniques: [
      { name: 'fear-appeal', present: true, severity: 7, confidence: 0.9, evidence: 'x' },
    ],
    primaryTechnique: 'fear-appeal' as const,
    action: 'rewrite' as const,
  };
}

// English post text — detectLanguage must land on 'en' so the RO/EN branch
// of validateRewriteLanguage runs.
const EN_POST = 'You should really worry about this because everyone is against you and the time is running out';

beforeEach(() => {
  resetFlushBudget();
  combinedMock.mockReset();
  (getSettings as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ...baseSettings });
});

describe('language-mismatch fallback — confirmed flag must stay visible', () => {
  it('confirmed detection + RO-drifted rewrite on an EN post → MARK, not PASS', async () => {
    combinedMock.mockResolvedValue({
      analysis: confirmedAnalysis(),
      neutralized: {
        postId: 'p1',
        // Romanian rewrite (diacritics + RO stopwords) for an English post.
        rewrittenText: 'Nu sunt de acord cu această idee și cred că putem discuta despre altceva.',
      },
    });
    const result = await process(makePost(EN_POST));
    expect(result.action).toBe('mark');
    expect(result.analysis?.primaryTechnique).toBe('fear-appeal');
    // The drifted rewrite must not be shipped.
    expect(result.neutralized).toBeUndefined();
  });

  it('confirmed detection + same-language rewrite → NEUTRALIZE as normal', async () => {
    combinedMock.mockResolvedValue({
      analysis: confirmedAnalysis(),
      neutralized: {
        postId: 'p1',
        rewrittenText: 'I think there are some things worth being careful about here.',
      },
    });
    const result = await process(makePost(EN_POST));
    expect(result.action).toBe('neutralize');
    expect(result.neutralized?.rewrittenText).toBe(
      'I think there are some things worth being careful about here.',
    );
  });

  it('not-manipulative result still PASSes (fallback does not expand flagging)', async () => {
    combinedMock.mockResolvedValue({
      analysis: {
        postId: 'p1',
        isManipulative: false,
        overallScore: 0,
        overallConfidence: 0,
        processingTimeMs: 1,
        techniques: [],
        primaryTechnique: undefined,
        action: undefined,
      },
      neutralized: null,
    });
    const result = await process(makePost(EN_POST));
    expect(result.action).toBe('pass');
  });
});
