// G2, the guard on the post path (green before and after the relabel): a post with a directed self-harm push or a
// sexual ask ends hidden, at severity 9, in every mode, with no AI called, whatever the find is called. The action is the
// rule's own ('hide'); no later step hides it only because of the technique's name.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FWSettings } from '../../../src/storage/settings';

type Mode = FWSettings['mode'];

let currentMode: Mode = 'teen';
const combinedMock = vi.fn();

function makeSettings(mode: Mode): FWSettings {
  return {
    mode,
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
  getSettings: vi.fn(async () => makeSettings(currentMode)),
}));
vi.mock('../../../src/storage/license', () => ({
  getLicense: vi.fn(async () => ({ tier: 'free', secret: '' })),
  dailyCapForTier: (tier: string) => (tier === 'free' ? 0 : 2000),
  effectiveMonthlyTokenCap: () => 1e12,
  isUncappedTier: (tier: string) => tier === 'dev',
}));
vi.mock('../../../src/core/neutralizer', () => ({
  combinedDetectAndNeutralize: (...args: unknown[]) => combinedMock(...args),
}));
vi.mock('../../../src/ai/neutralize-only', () => ({ neutralizeText: vi.fn(async () => '') }));
vi.mock('../../../src/forensics/hasher', () => ({ sha256: vi.fn(async () => 'hash') }));
vi.mock('../../../src/forensics/author-store', () => ({
  getAuthorProfile: vi.fn(async () => null),
}));
vi.mock('../../../src/storage/cache', () => ({
  processingCache: {
    getPersistent: vi.fn(async () => null),
    get: vi.fn(() => null),
    set: vi.fn(),
  },
}));
vi.mock('../../../src/core/calibration', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../src/core/calibration')>()), getEffectiveThreshold: vi.fn(async () => 0.4) }));
vi.mock('../../../src/diagnostics/perf-trace', () => ({
  startTrace: vi.fn(async () => ({ wrap: async (_s: unknown, fn: () => unknown) => fn() })),
}));
vi.mock('../../../src/ai/client', () => ({ getLastCallMeta: vi.fn(() => undefined), callAI: vi.fn() }));
vi.mock('../../../src/storage/feature-flags', () => ({ isFeatureEnabled: vi.fn(async () => false) }));
vi.mock('../../../src/ai/global-flush-budget', () => ({ isHolding: vi.fn(() => false), recordFailure: vi.fn() }));
vi.mock('../../../src/analysis/comment-rewriter', () => ({ validateRewriteLanguage: vi.fn(() => true) }));

import { process } from '../../../src/analysis/pipeline';
import { detectCodedHarm, codedHarmVerdictFields } from '../../../src/core/coded-harm-catcher';
import type { PostContent } from '../../../src/types/post';

function makePost(text: string): PostContent {
  return {
    id: 'p1',
    text,
    author: '',
    timestamp: '2026-09-30T00:00:00.000Z',
    platform: 'twitter',
    domRef: new WeakRef({} as unknown as HTMLElement),
  } as PostContent;
}

// Padded to clear the pipeline's substantive-text floor (>=3 words, >=12 chars).
const FINDS = [
  { category: 'self-harm-encouragement', text: 'kill yourself you absolute loser' },
  { category: 'sexual-solicitation', text: 'hey you, send me nude pics right now' },
  { category: 'sexual-explicit', text: 'that clip has a cumshot in it and worse' },
] as const;

beforeEach(() => {
  combinedMock.mockReset();
  currentMode = 'teen';
});

describe('a coded post ends hidden at severity 9 whatever the find is called', () => {
  for (const mode of ['child', 'teen', 'adult'] as const) {
    for (const find of FINDS) {
      it(`${mode}: ${find.category}`, async () => {
        currentMode = mode;
        const hit = detectCodedHarm(find.text);
        expect(hit?.category, 'the catcher reaches the category').toBe(find.category);
        const fields = codedHarmVerdictFields(hit!);
        expect(fields.hideTier).toBe(true);
        expect(fields.severity).toBe(9);

        const result = await process(makePost(find.text));

        expect(result.action).toBe('hide');
        expect(result.analysis?.overallScore).toBe(9);
        expect(result.detectionMode).toBe(`coded-harm:${find.category}`);
        expect(combinedMock, 'no AI was called').not.toHaveBeenCalled();
      });
    }
  }
});
