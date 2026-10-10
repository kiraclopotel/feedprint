/** @vitest-environment jsdom */
// A rewrite the reading made earlier is cached under a key that holds no licence, and the cache outlives the key.
// The pipeline serves it only while the reading may run, so once the key is removed, the level is Strict or the AI
// switch is off, the post takes the path of an install without the reading: no earlier rewrite comes back, and no
// marker with it.
//
// The pipeline and the AI client run for real; the cache holds one rewrite for the post, and fetch must not be
// called at all, since every case is answered either from the cache or by the path that makes no call.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const SETTINGS = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));
const LICENSE = vi.hoisted(() => ({ tier: 'family', secret: 's' }));

vi.mock('../../../src/storage/settings', () => ({
  getSettings: vi.fn(async () => ({ ...SETTINGS.current })),
  isFeatureEnabled: (
    s: { features?: Record<string, { enabled?: boolean }> },
    id: string,
  ) => s.features?.[id]?.enabled === true,
  recordAiCall: vi.fn(async () => undefined),
}));
vi.mock('../../../src/storage/license', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/storage/license')>()),
  getLicense: vi.fn(async () => ({ ...LICENSE })),
  dailyCapForTier: vi.fn((tier: string) => (tier === 'free' ? 0 : 2000)),
  effectiveMonthlyTokenCap: vi.fn(() => 1_000_000),
  isUncappedTier: vi.fn(() => false),
}));

const POST_TEXT =
  'Anyone who still backs this plan is a fool, and the rest of us are tired of carrying people who cannot think for themselves.';
const CACHED_REWRITE =
  'I think anyone who still backs this plan is mistaken, and I am tired of the argument going nowhere.';

vi.mock('../../../src/storage/cache', () => ({
  processingCache: {
    getPersistent: vi.fn(async () => ({
      analysis: {
        postId: 'earlier',
        isManipulative: true,
        overallScore: 7,
        techniques: [],
        explanation: 'cached',
      },
      neutralizedText: CACHED_REWRITE,
    })),
    set: vi.fn(),
  },
}));
vi.mock('../../../src/core/calibration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/core/calibration')>()),
  getEffectiveThreshold: vi.fn(async () => 0.6),
}));
vi.mock('../../../src/forensics/author-store', () => ({
  getAuthorProfile: vi.fn(async () => null),
  getExposurePressure: vi.fn(() => ({
    fired: false, reason: null, distinctDays: 0, creativeCount: 0,
  })),
  creativeHash: vi.fn(() => 'stub-hash'),
}));
vi.mock('../../../src/storage/feature-flags', () => ({ isFeatureEnabled: vi.fn(async () => false) }));
vi.mock('../../../src/forensics/neutralizer-diagnostics', () => ({
  recordNeutralizerEvent: vi.fn(async () => undefined),
}));
vi.mock('../../../src/ai/telemetry', () => ({
  buildGroqCallTelemetry: vi.fn(() => ({})),
  recordGroqCallTelemetry: vi.fn(async () => undefined),
}));
vi.mock('../../../src/storage/context-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/storage/context-guard')>()),
  safeSendMessage: vi.fn(async () => undefined),
}));

import { process } from '../../../src/analysis/pipeline';
import { _resetForTests as resetFlushBudget } from '../../../src/ai/global-flush-budget';
import type { PostContent } from '../../../src/types/post';

function makePost(): PostContent {
  return {
    id: 'p1',
    text: POST_TEXT,
    author: '@u',
    timestamp: new Date().toISOString(),
    platform: 'twitter',
    domRef: new WeakRef(document.createElement('div')),
  } as PostContent;
}

const fetchSpy = vi.fn(async () => { throw new Error('no call is expected'); });

beforeEach(() => {
  resetFlushBudget();
  fetchSpy.mockClear();
  vi.stubGlobal('fetch', fetchSpy);
  LICENSE.tier = 'family';
  SETTINGS.current = {
    mode: 'adult',
    strictLanguage: false,
    locale: 'en',
    outputLanguage: 'auto',
    dailyCap: 2000,
    monthlyUsdCapOverride: null,
    totalChecksToday: 0,
    totalTokensThisMonth: 0,
    aiAnalysisEnabled: true,
    features: { 'reframe-rewrites': { enabled: true } },
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a cached rewrite comes back only while the reading may run', () => {
  it('with a key that holds the reading, the cached rewrite is served', async () => {
    const result = await process(makePost());
    expect(result.action).toBe('neutralize');
    expect(result.neutralized?.rewrittenText).toBe(CACHED_REWRITE);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('with the key removed, the cached rewrite is not served', async () => {
    LICENSE.tier = 'free';
    const result = await process(makePost());
    expect(result.neutralized?.rewrittenText).not.toBe(CACHED_REWRITE);
    expect(result.action).not.toBe('neutralize');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('with a key at Strict, which sends nothing, the cached rewrite is not served', async () => {
    SETTINGS.current = { ...SETTINGS.current, mode: 'child' };
    const result = await process(makePost());
    expect(result.neutralized?.rewrittenText).not.toBe(CACHED_REWRITE);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('with a key but the AI switch off, the cached rewrite is not served', async () => {
    SETTINGS.current = { ...SETTINGS.current, aiAnalysisEnabled: false };
    const result = await process(makePost());
    expect(result.neutralized?.rewrittenText).not.toBe(CACHED_REWRITE);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
