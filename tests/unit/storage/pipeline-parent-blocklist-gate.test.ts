/** @vitest-environment jsdom */
// The parent blocklist as a pipeline gate (laydown section 8d).
//
// The matcher itself is covered by parent-blocklist.test.ts. What this file
// pins is the WIRING, and specifically the two things that are easy to get
// wrong and impossible to notice afterwards:
//
//   1. The gate runs ABOVE the dedup cache. The cache is keyed on
//      platform/mode/locale/outputLanguage/text and knows nothing about the
//      blocklist. If the gate sat below it, a post cached before the parent
//      added the word would keep serving its old verdict for the rest of the
//      browser session, and the parent would conclude the feature is broken.
//   2. It applies on the free tier and in adult mode. The free-tier
//      short-circuit and the adult carve-outs both sit further down the file;
//      a rule the user typed themselves is not an AI guess and neither of
//      those exemptions should reach it.
//
// Mock surface copied from pipeline-harm-gates.test.ts: the I/O-coupled
// dependencies are stubbed, the deterministic code under test runs live.

import { describe, it, expect, beforeEach, vi } from 'vitest';

type CombinedDetectArgs = Parameters<
  (typeof import('../../../src/core/neutralizer'))['combinedDetectAndNeutralize']
>;

vi.mock('../../../src/storage/settings', () => ({
  getSettings: vi.fn(),
}));
const licenseMock = vi.fn(async () => ({ tier: 'family', secret: 's' }));
vi.mock('../../../src/storage/license', () => ({
  getLicense: () => licenseMock(),
  dailyCapForTier: vi.fn(() => 2000),
  effectiveMonthlyTokenCap: vi.fn(() => 1_000_000),
  isUncappedTier: vi.fn(() => false),
}));
const getPersistentMock = vi.fn(async () => null as unknown);
vi.mock('../../../src/storage/cache', () => ({
  processingCache: {
    getPersistent: () => getPersistentMock(),
    set: vi.fn(),
  },
}));
vi.mock('../../../src/core/calibration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/core/calibration')>()),
  getEffectiveThreshold: vi.fn(async () => 0.45),
}));
vi.mock('../../../src/forensics/author-store', () => ({
  getAuthorProfile: vi.fn(async () => null),
}));
vi.mock('../../../src/ai/client', () => ({
  getLastCallMeta: vi.fn(() => ({ model: 'm', provider: 'groq' })),
  getLastFailureKind: vi.fn(() => null),
}));
vi.mock('../../../src/ai/neutralize-only', () => ({
  neutralizeText: vi.fn(async () => 'calm'),
}));
const combinedMock = vi.fn(async (..._args: CombinedDetectArgs) => ({
  analysis: {
    postId: 'x',
    isManipulative: false,
    overallScore: 0,
    overallConfidence: 0,
    processingTimeMs: 1,
    techniques: [],
    primaryTechnique: undefined,
    action: undefined,
  },
  neutralized: null,
}));
vi.mock('../../../src/core/neutralizer', () => ({
  combinedDetectAndNeutralize: (...args: CombinedDetectArgs) => combinedMock(...args),
}));

import { process } from '../../../src/analysis/pipeline';
import { getSettings } from '../../../src/storage/settings';
import type { PostContent } from '../../../src/types/post';

const BLOCKLIST = { words: ['diet'], phrases: ['body check'], accounts: ['@kim'] };

function setSettings(overrides: Record<string, unknown> = {}, blocklistOn = true) {
  (getSettings as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    mode: 'teen',
    strictLanguage: false,
    locale: 'en',
    outputLanguage: 'auto',
    dailyCap: 2000,
    monthlyUsdCapOverride: null,
    totalChecksToday: 0,
    totalTokensThisMonth: 0,
    features: {
      'parent-blocklist': { enabled: blocklistOn, value: BLOCKLIST },
    },
    ...overrides,
  });
}

function makePost(text: string, author = '@someone'): PostContent {
  return {
    id: 'p1',
    text,
    author,
    timestamp: new Date().toISOString(),
    platform: 'twitter',
    domRef: new WeakRef(document.createElement('div')),
  } as PostContent;
}

beforeEach(() => {
  combinedMock.mockClear();
  getPersistentMock.mockClear();
  getPersistentMock.mockResolvedValue(null);
  licenseMock.mockResolvedValue({ tier: 'family', secret: 's' });
});

describe('parent blocklist gate — what it returns', () => {
  it('hides on a word rule and names the rule in the detection mode', async () => {
    setSettings();
    const result = await process(makePost('my diet is going well'));
    expect(result.action).toBe('hide');
    expect(result.detectionMode).toBe('blocklist:word:diet');
  });

  it('hides on a phrase rule', async () => {
    setSettings();
    const result = await process(makePost('daily body check time'));
    expect(result.detectionMode).toBe('blocklist:phrase:body check');
  });

  it('hides on an account rule regardless of the text', async () => {
    setSettings();
    const result = await process(makePost('good morning everyone', '@Kim'));
    expect(result.action).toBe('hide');
    expect(result.detectionMode).toBe('blocklist:account:kim');
  });

  it('claims no manipulation and no technique — it obeyed, it did not judge', async () => {
    setSettings();
    const result = await process(makePost('my diet is going well'));
    expect(result.analysis?.isManipulative).toBe(false);
    expect(result.analysis?.techniques).toEqual([]);
    expect(result.analysis?.primaryTechnique).toBeUndefined();
  });

  it('never reaches the LLM on a hit', async () => {
    setSettings();
    await process(makePost('my diet is going well'));
    expect(combinedMock).not.toHaveBeenCalled();
  });

  it('does not fire when the text and author miss every rule', async () => {
    setSettings();
    const result = await process(makePost('a perfectly ordinary sentence about weather'));
    expect(result.detectionMode ?? '').not.toMatch(/^blocklist:/);
    expect(result.action).not.toBe('hide');
  });

  it('does not fire when the toggle is off, even with rules stored', async () => {
    setSettings({}, false);
    const result = await process(makePost('my diet is going well'));
    expect(result.detectionMode ?? '').not.toMatch(/^blocklist:/);
    expect(result.action).not.toBe('hide');
  });
});

describe('parent blocklist gate — position on the ladder', () => {
  it('runs ABOVE the dedup cache: a cached verdict does not survive a new rule', async () => {
    // The cache would happily return a "neutralize" verdict recorded before
    // the parent added the word. The gate must win, and must not even ask.
    getPersistentMock.mockResolvedValue({
      analysis: { isManipulative: true, postId: 'p1' },
      neutralizedText: 'a calm rewrite from before the rule existed',
    });
    setSettings();
    const result = await process(makePost('my diet is going well'));
    expect(result.action).toBe('hide');
    expect(result.detectionMode).toBe('blocklist:word:diet');
    expect(getPersistentMock).not.toHaveBeenCalled();
  });

  it('applies on the free tier — the rule costs nothing to enforce', async () => {
    licenseMock.mockResolvedValue({ tier: 'free', secret: '' });
    setSettings();
    const result = await process(makePost('my diet is going well'));
    expect(result.action).toBe('hide');
    expect(result.detectionMode).toBe('blocklist:word:diet');
  });

  it('applies in adult mode — the adult carve-out is for guesses, not for rules', async () => {
    setSettings({ mode: 'adult' });
    const result = await process(makePost('my diet is going well'));
    expect(result.action).toBe('hide');
    expect(result.detectionMode).toBe('blocklist:word:diet');
  });
});


describe('parent blocklist gate — the card around the words (2026-09-07)', () => {
  it('hides when the quoted post is by a blocked account, whoever wrote the outer post', async () => {
    setSettings();
    const post = { ...makePost('cannot believe he predicted it', '@someone'), card: { text: 'the quoted words', accounts: ['kim'] } } as PostContent;
    const result = await process(post);
    expect(result.action).toBe('hide');
    expect(result.detectionMode).toBe('blocklist:account:kim');
    expect(combinedMock).not.toHaveBeenCalled();
  });

  it('hides when a blocked word sits only on the card', async () => {
    setSettings();
    const post = { ...makePost('a kind message', '@someone'), card: { text: 'my diet starts tomorrow' } } as PostContent;
    const result = await process(post);
    expect(result.action).toBe('hide');
    expect(result.detectionMode).toBe('blocklist:word:diet');
  });
});
