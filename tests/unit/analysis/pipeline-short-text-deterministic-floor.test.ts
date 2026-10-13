// Short-text deterministic-floor shadow (regression lock).
//
// BUG (verified 2026-08-01): `process()` ran the `pre-llm-too-short`
// (text.length < 12) and `pre-llm-non-substantive` (< 3 words) early-PASS
// returns BEFORE every cost-zero deterministic HIDE gate (slur filter,
// coded-harm floor, sponsored-ad, child-mode profanity). So a post whose
// ENTIRE text is a slur, a directed self-harm phrase, or (child mode) a
// profane word passed with zero protection — the disqualifying
// under-protection direction (VISION "complete failure" #2). The existing
// coded-harm test even padded its fixtures ("kill yourself you absolute
// loser") specifically to clear the substantive floor, working around this
// gap instead of catching it.
//
// FIX: the two LLM-noise reject returns now run AFTER the deterministic HIDE
// gates. Normal posts are unaffected (both predicates are false for them);
// short posts gain the deterministic protection they always should have had.
// These asserts FAIL on the pre-fix ordering (action 'pass',
// detectionMode 'pre-llm-too-short' / 'pre-llm-non-substantive').

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FWSettings } from '../../../src/storage/settings';

type Mode = FWSettings['mode'];

let currentMode: Mode = 'teen';
let currentStrict = false;
let currentOn = new Set<string>();
let currentFeatures: Record<string, unknown> = {};
let currentTier = 'family';
const combinedMock = vi.fn();

function makeSettings(mode: Mode): FWSettings {
  return {
    mode,
    strictLanguage: currentStrict,
    features: currentFeatures,
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
  // A switch is on only when a test names it: Mask swearing stays off, so only Strict language turns the mask on, and
  // the cached-rewrite case turns the rewrites on so that cachedRewriteSwitchedOff does not skip the cache for it.
  isFeatureEnabled: vi.fn((_settings: unknown, feature: string) => currentOn.has(feature)),
}));

vi.mock('../../../src/storage/license', () => ({
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
// The real filter, with the mask open to one test that needs a found word the mask leaves unchanged.
vi.mock('../../../src/core/profanity-filter', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../src/core/profanity-filter')>();
  return { ...real, maskProfanity: vi.fn(real.maskProfanity) };
});

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
vi.mock('../../../src/ai/client', () => ({ getLastCallMeta: vi.fn(() => undefined), callAI: vi.fn(), readingAllowed: vi.fn(async () => true) }));
vi.mock('../../../src/storage/feature-flags', () => ({ isFeatureEnabled: vi.fn(async () => false) }));
vi.mock('../../../src/ai/global-flush-budget', () => ({ isHolding: vi.fn(() => false), recordFailure: vi.fn() }));
vi.mock('../../../src/analysis/comment-rewriter', () => ({ validateRewriteLanguage: vi.fn(() => true) }));

import { process } from '../../../src/analysis/pipeline';
import { processingCache } from '../../../src/storage/cache';
import { maskProfanity } from '../../../src/core/profanity-filter';
import type { PostContent } from '../../../src/types/post';

function makePost(text: string): PostContent {
  return {
    id: 'p1',
    text,
    author: '',
    timestamp: '2026-07-13T00:00:00.000Z',
    platform: 'twitter',
    domRef: new WeakRef({} as unknown as HTMLElement),
  } as PostContent;
}

beforeEach(() => {
  combinedMock.mockReset();
  currentMode = 'teen';
  currentTier = 'family';
  currentStrict = false;
  currentOn = new Set();
  currentFeatures = {};
});

describe('short-text deterministic floors are not shadowed by the LLM-noise reject', () => {
  it('a bare single-word slur post (< 12 chars) HIDES, not passes', async () => {
    currentTier = 'free';
    const result = await process(makePost('faggot'));
    expect(result.action).toBe('hide');
    expect(result.detectionMode).toContain('slur');
    expect(combinedMock).not.toHaveBeenCalled();
  });

  it('a 2-word directed self-harm post ("kill yourself", < 3 words) HIDES via coded-harm', async () => {
    currentTier = 'free';
    const result = await process(makePost('kill yourself'));
    expect(result.action).toBe('hide');
    expect(result.detectionMode).toContain('coded-harm');
    expect(combinedMock).not.toHaveBeenCalled();
  });

  it('the "kys" monogram (3 chars) HIDES via coded-harm', async () => {
    currentTier = 'free';
    const result = await process(makePost('kys'));
    expect(result.action).toBe('hide');
    expect(result.detectionMode).toContain('coded-harm');
  });

  it('child mode: a bare profane word (< 12 chars) HIDES', async () => {
    currentTier = 'free';
    currentMode = 'child';
    const result = await process(makePost('shit'));
    expect(result.action).toBe('hide');
    expect(result.detectionMode).toContain('profanity');
  });

  // 9 Oct 2026: the swear mask ran after the floor, so with Strict language on a short post kept its swear word
  // while the popup told the parent swear words are replaced with stars.
  it.each(['teen', 'adult'] as const)('%s with Strict language: a short swearing post is starred, not passed', async (mode) => {
    currentTier = 'free';
    currentMode = mode;
    currentStrict = true;
    for (const text of ['oh shit', 'shit']) {
      const result = await process(makePost(text));
      expect(result.action, `${text}: ${JSON.stringify(result.passContext ?? result.detectionMode)}`).toBe('neutralize');
      expect(result.detectionMode, text).toContain('profanity-mask');
      const masked = (result as { neutralized?: { rewrittenText: string } }).neutralized?.rewrittenText ?? '';
      expect(masked, text).not.toMatch(/shit/i);
      expect(masked, text).toContain('*');
    }
    expect(combinedMock).not.toHaveBeenCalled();
  });

  it('without Strict language or Mask swearing, a short swearing post still passes (the mask is a choice)', async () => {
    currentTier = 'free';
    currentMode = 'teen';
    const result = await process(makePost('oh shit'));
    expect(result.action).toBe('pass');
  });

  // 9 Oct 2026: a pass cached while the mask was off came back unstarred after Strict language was turned on.
  it('a pass or rewrite cached before Strict language was turned on is starred, not served', async () => {
    const cachedPass = { analysis: { isManipulative: false }, neutralizedText: null, timestamp: Date.now() };
    const text = 'well that was a shit game last night';
    vi.mocked(processingCache.getPersistent).mockResolvedValueOnce(cachedPass as never);
    expect((await process(makePost(text))).action).toBe('pass');
    currentStrict = true;
    vi.mocked(processingCache.getPersistent).mockResolvedValueOnce(cachedPass as never);
    const result = await process(makePost(text));
    expect(result.action).toBe('neutralize');
    expect(result.detectionMode).toContain('profanity-mask');
    // A rewrite cached before the switch is not served either: it may still carry the swear word. Rewrites are on,
    // so only the mask check can skip this entry.
    currentOn = new Set(['reframe-rewrites']);
    vi.mocked(processingCache.getPersistent).mockResolvedValueOnce(
      { analysis: { isManipulative: true }, neutralizedText: 'that was a shit game', timestamp: Date.now() } as never,
    );
    const rewritten = await process(makePost(text));
    // A served rewrite is a 'neutralize' too, so the mode tells them apart: stars, not the cached rewrite.
    expect(rewritten.action).toBe('neutralize');
    expect(rewritten.detectionMode ?? 'the cached rewrite was served').toContain('profanity-mask');
    expect(combinedMock).not.toHaveBeenCalled();
  });

  // The Head's check, 10 Oct 2026: when the filter finds a word but the mask leaves the text as it was, the mask block
  // falls through, so the cache check must not throw away a valid hit and pay for the reading again.
  it('a cached pass is served when the mask would leave the text unchanged', async () => {
    currentStrict = true;
    const text = 'well that was a shit game last night';
    vi.mocked(maskProfanity).mockImplementation((t: string) => ({ masked: t, matches: [] }));
    try {
      vi.mocked(processingCache.getPersistent).mockResolvedValueOnce(
        { analysis: { isManipulative: false }, neutralizedText: null, timestamp: Date.now() } as never,
      );
      const result = await process(makePost(text));
      expect(result.action).toBe('pass');
      expect(result.passContext?.reason).toBe('pre-llm-cache-pass');
    } finally {
      vi.mocked(maskProfanity).mockReset();
      const real = await vi.importActual<typeof import('../../../src/core/profanity-filter')>('../../../src/core/profanity-filter');
      vi.mocked(maskProfanity).mockImplementation(real.maskProfanity);
    }
  });

  it('FP guard: short benign posts still PASS (no new over-blocking)', async () => {
    currentTier = 'free';
    for (const mode of ['child', 'teen', 'adult'] as Mode[]) {
      currentMode = mode;
      for (const text of ['ok thanks', 'good morning', 'see you soon', 'love this', 'nice one']) {
        const result = await process(makePost(text));
        expect(result.action, `${mode} / "${text}" should pass`).toBe('pass');
      }
    }
  });
});

// The word gate counted words with ASCII \w: a Cyrillic or Chinese post counted no words and never reached the reading,
// and Romanian lost its short words with diacritics ("și", "îți"). Words now count in any alphabet, and in the scripts
// written without spaces every two characters count as one.
describe('the word gate counts words in every script', () => {
  const reachesTheReading = async (text: string): Promise<boolean> => {
    combinedMock.mockReset();
    const result = await process(makePost(text)).catch(() => null);
    return combinedMock.mock.calls.length > 0 && result?.detectionMode !== 'pre-llm-non-substantive';
  };

  it.each([
    ['Romanian with diacritics', 'Îți știi și țara?'],
    ['Cyrillic', 'Он опять врёт всем нам'],
    ['Chinese', '这个人一直在网上撒谎骗大家'],
  ])('a %s post of real length reaches the reading', async (_script, text) => {
    expect(await reachesTheReading(text)).toBe(true);
  });

  it('a two-word Latin post still stops at the gate', async () => {
    expect(await reachesTheReading('totally agreed!!')).toBe(false);
  });
});

// The pipeline asks the cache with the parent it shows the judge.
describe('the pipeline looks up a reply under its parent', () => {
  it('the same reply under two different posts is two cache lookups', async () => {
    const { sha256 } = await import('../../../src/forensics/hasher');
    vi.mocked(sha256).mockImplementation(async (input: string) => input);
    const lookups: string[] = [];
    vi.mocked(processingCache.getPersistent).mockImplementation(async (key: string) => { lookups.push(key); return null; });
    const reply = 'same here, could not agree more with every word of this';
    for (const parentText of ['What a lovely thing to do for your neighbours.', 'People like her should be run out of town.']) {
      await process({ ...makePost(reply), parentText } as PostContent).catch(() => null);
    }
    expect(lookups).toHaveLength(2);
    expect(lookups[0]).not.toBe(lookups[1]);
  });
});

// 12 Oct 2026: the Silent veil's deadline asks the pipeline for the local result only, so a post still waiting for its
// reading is lifted as what the rules make of it and never as the raw post. The rules are the ones every post meets.
describe('localOnly: the rules answer and no model is asked', () => {
  const localOnly = { localOnly: true };

  it('a post the rules leave alone passes, with no call placed', async () => {
    const result = await process(makePost('I really enjoyed the sunset at the beach today with my family'), undefined, localOnly);
    expect(result.action).toBe('pass');
    expect(result.passContext?.reason).toBe('pre-llm-deadline-local-only');
    expect(combinedMock).not.toHaveBeenCalled();
  });

  it('without the option the same post places its call, so the option is what stops it', async () => {
    combinedMock.mockResolvedValue(null);
    await process(makePost('I really enjoyed the sunset at the beach today with my family'));
    expect(combinedMock).toHaveBeenCalledTimes(1);
  });

  it('a slur is hidden', async () => {
    const result = await process(makePost('faggot'), undefined, localOnly);
    expect(result.action).toBe('hide');
    expect(result.detectionMode).toContain('slur');
    expect(combinedMock).not.toHaveBeenCalled();
  });

  it('directed self-harm is hidden', async () => {
    const result = await process(makePost('kill yourself'), undefined, localOnly);
    expect(result.action).toBe('hide');
    expect(result.detectionMode).toContain('coded-harm');
  });

  it('swearing is starred when the mask is on', async () => {
    currentStrict = true;
    const result = await process(makePost('well that was a shit game last night'), undefined, localOnly);
    expect(result.action).toBe('neutralize');
    expect(result.detectionMode).toContain('profanity-mask');
    const masked = (result as { neutralized?: { rewrittenText: string } }).neutralized?.rewrittenText ?? '';
    expect(masked).not.toMatch(/shit/i);
    expect(masked).toContain('*');
    expect(combinedMock).not.toHaveBeenCalled();
  });

  it('the person\'s own list hides', async () => {
    currentFeatures = { 'parent-blocklist': { enabled: true, value: { words: ['sunset'], phrases: [], accounts: [] } } };
    const result = await process(makePost('I really enjoyed the sunset at the beach today with my family'), undefined, localOnly);
    expect(result.action).toBe('hide');
    expect(result.detectionMode).toContain('blocklist:');
    expect(combinedMock).not.toHaveBeenCalled();
  });

  it('a cached verdict is served as it is, since it costs nothing', async () => {
    currentOn = new Set(['reframe-rewrites']);
    vi.mocked(processingCache.getPersistent).mockResolvedValueOnce(
      { analysis: { isManipulative: true }, neutralizedText: 'a calmer sentence about the game', timestamp: Date.now() } as never,
    );
    const result = await process(makePost('well that was an absolutely terrible game last night'), undefined, localOnly);
    expect(result.action).toBe('neutralize');
    expect((result as { neutralized?: { rewrittenText: string } }).neutralized?.rewrittenText).toBe('a calmer sentence about the game');
    expect(combinedMock).not.toHaveBeenCalled();
  });
});
