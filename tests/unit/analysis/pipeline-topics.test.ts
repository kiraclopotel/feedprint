/** @vitest-environment jsdom */
// A topic the person switched on as a pipeline gate (Topics U1, 13 Oct 2026). The matcher is covered by
// topic-lexicon.test.ts; this file pins the WIRING, the same three things the household's word list pins
// (pipeline-parent-blocklist-gate.test.ts):
//
//   1. It hides at every level, with a key and without one: a rule the person chose is not an AI guess, so no level and
//      no tier softens it.
//   2. It runs ABOVE the dedup cache, so a post cached before the person switched the topic on is hidden at once.
//   3. It claims nothing about the post: no technique, no severity, no model call. It obeyed; it did not judge.
//
// Mock surface copied from pipeline-parent-blocklist-gate.test.ts.

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
import { childPreset, teenPreset, adultPreset, offStartPreset } from '../../../src/storage/presets';
import type { PostContent } from '../../../src/types/post';

const GAMBLING_POST = 'Join the online casino today and get a no deposit bonus on blackjack';

function setSettings(mode: 'child' | 'teen' | 'adult', features: Record<string, unknown> = {}) {
  (getSettings as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    mode,
    strictLanguage: false,
    locale: 'en',
    outputLanguage: 'auto',
    dailyCap: 2000,
    monthlyUsdCapOverride: null,
    totalChecksToday: 0,
    totalTokensThisMonth: 0,
    features: { 'topic-gambling': { enabled: true }, ...features },
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

describe.each(['child', 'teen', 'adult'] as const)('a switched-on topic at %s', (mode) => {
  it.each([['with a key', { tier: 'family', secret: 's' }], ['with no key', { tier: 'free', secret: '' }]] as const)(
    'hides the post %s and names the topic in the detection mode',
    async (_label, license) => {
      licenseMock.mockResolvedValue(license);
      setSettings(mode);
      const result = await process(makePost(GAMBLING_POST));
      expect(result.action).toBe('hide');
      expect(result.detectionMode).toBe('topic:gambling');
    },
  );

  it('claims no manipulation, no technique and no score, and never asks a model', async () => {
    setSettings(mode);
    const result = await process(makePost(GAMBLING_POST));
    expect(result.analysis?.isManipulative).toBe(false);
    expect(result.analysis?.techniques).toEqual([]);
    expect(result.analysis?.primaryTechnique).toBeUndefined();
    expect(result.analysis?.overallScore).toBe(0);
    expect(combinedMock).not.toHaveBeenCalled();
  });

  it('leaves an ordinary post to the rest of the ladder', async () => {
    setSettings(mode);
    const result = await process(makePost('a perfectly ordinary sentence about the weather'));
    expect(result.detectionMode ?? '').not.toMatch(/^topic:/);
    expect(result.action).not.toBe('hide');
  });

  it('does nothing when the topic is switched off', async () => {
    setSettings(mode, { 'topic-gambling': { enabled: false } });
    const result = await process(makePost(GAMBLING_POST));
    expect(result.detectionMode ?? '').not.toMatch(/^topic:/);
    expect(result.action).not.toBe('hide');
  });
});

describe('a switched-on topic: position on the ladder', () => {
  it('runs ABOVE the dedup cache: a cached verdict does not survive a new topic', async () => {
    getPersistentMock.mockResolvedValue({
      analysis: { isManipulative: true, postId: 'p1' },
      neutralizedText: 'a calm rewrite from before the topic was switched on',
    });
    setSettings('adult');
    const result = await process(makePost(GAMBLING_POST));
    expect(result.action).toBe('hide');
    expect(result.detectionMode).toBe('topic:gambling');
    expect(getPersistentMock).not.toHaveBeenCalled();
  });

  it('reads the card around the post as well', async () => {
    setSettings('teen');
    const post = { ...makePost('what a game last night'), card: { text: 'free bet on the final at bet365' } } as PostContent;
    const result = await process(post);
    expect(result.action).toBe('hide');
    expect(result.detectionMode).toBe('topic:gambling');
  });

  it('the household\'s own word is read first, and still names itself', async () => {
    setSettings('teen', { 'parent-blocklist': { enabled: true, value: { words: ['casino'], phrases: [], accounts: [] } } });
    const result = await process(makePost(GAMBLING_POST));
    expect(result.action).toBe('hide');
    expect(result.detectionMode).toBe('blocklist:word:casino');
  });
});

describe('no level switches a topic on', () => {
  it.each([['child', childPreset], ['teen', teenPreset], ['adult', adultPreset], ['Off start', offStartPreset]] as const)('%s preset has it off', (_name, preset) => {
    expect(preset()['topic-gambling']).toEqual({ enabled: false });
  });
});
