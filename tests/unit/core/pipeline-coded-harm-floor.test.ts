// Post-path coded-harm deterministic floor (AI-1, swarm-2026-07-13).
//
// Regression lock for the P0 "asymmetric floor at the PATH level": the
// 0-FP-validated `detectCodedHarm` catcher was wired only into the COMMENT
// path. On the POST path (`src/analysis/pipeline.ts`) a directed self-harm / sexual
// solicitation / doxxing / narrated-violence post passed SILENTLY on both the
// free-tier short-circuit and the paid AI-outage branch, because no
// deterministic gate consumed the L1 harm-present verdict and the harm-floor
// synth is gated on `detected.length === 0`.
//
// These tests assert the post path now runs `detectCodedHarm(post.text)` and
// routes hide-tier categories through the SAME `codedHarmVerdictFields` mapping
// the comment path uses — success path and no-AI path can never drift.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FWSettings } from '../../../src/storage/settings';

// settings.ts declares Mode locally without exporting it; derive it.
type Mode = FWSettings['mode'];

// --- controllable test doubles (declared before the mock factories) ---
let currentMode: Mode = 'teen';
let currentTier = 'family';
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
  // free tier → cap 0 → free-tier short-circuit; any other tier → paid path.
  getLicense: vi.fn(async () => ({ tier: currentTier, secret: '' })),
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
    author: '', // empty → skips author-intelligence branch
    timestamp: '2026-07-13T00:00:00.000Z',
    platform: 'twitter',
    domRef: new WeakRef({} as unknown as HTMLElement),
  } as PostContent;
}

// Directed self-harm from the catcher's OWN fixtures (kill-yourself / kys),
// padded to clear the pipeline's substantive-text floor (>=3 words, >=12 chars).
const SELF_HARM_POST = 'kill yourself you absolute loser';
const KYS_POST = 'honestly just kys already you loser';
const BENIGN_POST = 'I really enjoyed the sunset at the beach today with my family';

beforeEach(() => {
  combinedMock.mockReset();
  currentMode = 'teen';
  currentTier = 'family';
});

describe('AI-1 — post-path coded-harm deterministic floor', () => {
  it('(a) free-tier directed self-harm post does NOT pass — reaches hide-tier verdict', async () => {
    currentTier = 'free'; // dailyCapForTier('free') === 0 → free-tier short-circuit
    const result = await process(makePost(SELF_HARM_POST));

    expect(result.action).toBe('hide');
    expect(result.action).not.toBe('pass');
    expect(result.analysis?.overallScore).toBeGreaterThanOrEqual(8);
    expect(result.detectionMode).toContain('coded-harm');
    // The LLM must never have been consulted on the free tier.
    expect(combinedMock).not.toHaveBeenCalled();
  });

  it('(b) AI-outage (paid, provider returns null) directed self-harm post → hide', async () => {
    currentTier = 'family';
    combinedMock.mockResolvedValue(null); // Groq outage / fail-closed
    const result = await process(makePost(KYS_POST));

    expect(result.action).toBe('hide');
    expect(result.analysis?.overallScore).toBeGreaterThanOrEqual(8);
    expect(result.detectionMode).toContain('coded-harm');
  });

  it('(c) benign post passes on BOTH the free-tier and the AI-outage path', async () => {
    // free tier
    currentTier = 'free';
    const free = await process(makePost(BENIGN_POST));
    expect(free.action).toBe('pass');

    // paid + AI outage (provider null)
    currentTier = 'family';
    combinedMock.mockResolvedValue(null);
    const outage = await process(makePost(BENIGN_POST));
    expect(outage.action).toBe('pass');

    // Sanity: the catcher itself does not fire on the benign text.
    expect(detectCodedHarm(BENIGN_POST)).toBeNull();
  });

  it('(d) asymmetry lock — free-tier and AI-outage produce the SAME verdict mapping, matching codedHarmVerdictFields', async () => {
    // free-tier path
    currentTier = 'free';
    const free = await process(makePost(SELF_HARM_POST));

    // AI-outage path (paid, provider null)
    currentTier = 'family';
    combinedMock.mockResolvedValue(null);
    const outage = await process(makePost(SELF_HARM_POST));

    // Same action + same severity + same technique across the two no-AI paths.
    expect(outage.action).toBe(free.action);
    expect(outage.analysis?.overallScore).toBe(free.analysis?.overallScore);
    expect(outage.analysis?.primaryTechnique).toBe(free.analysis?.primaryTechnique);

    // …and both equal the single shared category→verdict mapping (one source of
    // truth shared with the comment path — no post/comment or success/fail drift).
    const hit = detectCodedHarm(SELF_HARM_POST)!;
    const fields = codedHarmVerdictFields(hit);
    expect(free.action).toBe('hide');
    expect(fields.hideTier).toBe(true);
    expect(free.analysis?.overallScore).toBe(fields.severity);
    expect(free.analysis?.primaryTechnique).toBe(fields.technique);
  });

  it('adult mode also hides coded hard-harm — mirrors the comment path (mode-blind) and the post-path slur/dehumanization floors', async () => {
    currentTier = 'free';
    currentMode = 'adult';
    const result = await process(makePost(SELF_HARM_POST));
    expect(result.action).toBe('hide');
    expect(result.detectionMode).toContain('coded-harm');
  });
});
