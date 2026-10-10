// The debug tab's "Pipeline performance" row for the AI step said "1011× · 100% ok" on a day the
// AI health block beside it showed 26 of the last 100 answers were HTTP 429. The timing wrapper
// marked the step ok whenever the judge's promise resolved, and the judge resolves to null when
// the AI gave no reading (a failed call, an unreadable reply, a cancel), so every failure was
// timed as a success. A step with no reading has to count against the ok share.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FWSettings } from '../../../src/storage/settings';

type Outcome = { success: boolean; error?: string };

const combinedMock = vi.fn();
const recorded: Array<{ stage: string; outcome: Outcome }> = [];

function makeSettings(): FWSettings {
  return {
    mode: 'teen',
    strictLanguage: false,
    dailyCap: 0,
    monthlyUsdCapOverride: null,
    locale: 'en',
    outputLanguage: 'auto',
    totalChecksToday: 0,
    totalTokensThisMonth: 0,
  } as unknown as FWSettings;
}

vi.mock('../../../src/storage/settings', () => ({
  getSettings: vi.fn(async () => makeSettings()),
  isFeatureEnabled: vi.fn(async () => false),
}));
vi.mock('../../../src/storage/license', () => ({
  getLicense: vi.fn(async () => ({ tier: 'family', secret: '' })),
  dailyCapForTier: () => 2000,
  effectiveMonthlyTokenCap: () => 1e12,
  isUncappedTier: (tier: string) => tier === 'dev',
}));
vi.mock('../../../src/core/neutralizer', () => ({
  combinedDetectAndNeutralize: (...args: unknown[]) => combinedMock(...args),
}));
vi.mock('../../../src/ai/neutralize-only', () => ({ neutralizeText: vi.fn(async () => '') }));
vi.mock('../../../src/forensics/hasher', () => ({ sha256: vi.fn(async () => 'hash') }));
vi.mock('../../../src/forensics/author-store', () => ({ getAuthorProfile: vi.fn(async () => null) }));
vi.mock('../../../src/storage/cache', () => ({
  processingCache: { getPersistent: vi.fn(async () => null), get: vi.fn(() => null), set: vi.fn() },
}));
vi.mock('../../../src/core/calibration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/core/calibration')>()),
  getEffectiveThreshold: vi.fn(async () => 0.4),
}));
// The tracer a real build uses when timings are on: a step is ok unless the wrapped call threw,
// or the caller's own judgement of the result says it was not.
vi.mock('../../../src/diagnostics/perf-trace', () => ({
  startTrace: vi.fn(async () => ({
    wrap: async (stage: string, fn: () => Promise<unknown>, outcome?: (r: unknown) => Outcome) => {
      const r = await fn();
      recorded.push({ stage, outcome: outcome ? outcome(r) : { success: true } });
      return r;
    },
  })),
}));
vi.mock('../../../src/ai/client', () => ({
  getLastCallMeta: vi.fn(() => undefined),
  getLastFailureKind: vi.fn(() => 'rate-limit'),
  callAI: vi.fn(),
}));
vi.mock('../../../src/storage/feature-flags', () => ({ isFeatureEnabled: vi.fn(async () => false) }));
vi.mock('../../../src/ai/global-flush-budget', () => ({ isHolding: vi.fn(() => false), recordFailure: vi.fn() }));
vi.mock('../../../src/analysis/comment-rewriter', () => ({ validateRewriteLanguage: vi.fn(() => true) }));

import { process } from '../../../src/analysis/pipeline';
import type { PostContent } from '../../../src/types/post';

const BENIGN_POST = 'I really enjoyed the sunset at the beach today with my family';

function makePost(text: string): PostContent {
  return {
    id: 'p1',
    text,
    author: '',
    timestamp: '2026-09-25T00:10:00.000Z',
    platform: 'youtube',
    domRef: new WeakRef({} as unknown as HTMLElement),
  } as PostContent;
}

function benignReading(): unknown {
  return {
    analysis: {
      postId: '',
      techniques: [],
      overallScore: 0,
      overallConfidence: 0.1,
      isManipulative: false,
      processingTimeMs: 1,
      explanation: 'nothing here',
    },
    neutralized: null,
  };
}

beforeEach(() => {
  combinedMock.mockReset();
  recorded.length = 0;
});

describe('the AI step in Pipeline performance counts a call with no reading as not ok', () => {
  it('a judge call that came back with no reading is timed as a failure, naming why', async () => {
    combinedMock.mockResolvedValue(null);
    const result = await process(makePost(BENIGN_POST));
    expect(combinedMock).toHaveBeenCalledTimes(1);
    expect(result.passContext?.reason).toBe('pre-llm-ai-call-failed');
    const step = recorded.find(r => r.stage === 'combined_call');
    expect(step).toBeDefined();
    expect(step!.outcome.success).toBe(false);
    expect(step!.outcome.error).toBe('rate-limit');
  });

  it('a judge call that returned a reading is still timed as ok', async () => {
    combinedMock.mockResolvedValue(benignReading());
    await process(makePost(BENIGN_POST));
    const step = recorded.find(r => r.stage === 'combined_call');
    expect(step).toBeDefined();
    expect(step!.outcome.success).toBe(true);
  });
});
