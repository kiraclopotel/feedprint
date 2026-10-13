// The Moderate judge is told where the item sits (the export study, 12 Oct 2026, Board row 398): the site, whether it is a post, a comment
// or a video, and the post a comment answers. The pipeline passed these on, but only the Relaxed judge's prompt has fields for them; the
// Moderate judge read a reply to a thread as a post of no known site. They now go into the context block the Moderate prompt already has,
// in the words the Relaxed judge's prompt uses. The parent arrives with its names already replaced by letters. Relaxed and Strict are untouched.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FWSettings } from '../../../src/storage/settings';

const combinedMock = vi.fn();
const recordFailureMock = vi.fn();
let lastFailureKind: string | null = null;
let settings: Partial<FWSettings> = {};

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
    levelChosen: true,
    ...settings,
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
vi.mock('../../../src/diagnostics/perf-trace', () => ({
  startTrace: vi.fn(async () => ({ wrap: async (_stage: string, fn: () => Promise<unknown>) => fn() })),
}));
vi.mock('../../../src/ai/client', () => ({
  getLastCallMeta: vi.fn(() => undefined),
  getLastFailureKind: vi.fn(() => lastFailureKind),
  readingAllowed: vi.fn(async () => true),
  callAI: vi.fn(),
}));
vi.mock('../../../src/storage/feature-flags', () => ({ isFeatureEnabled: vi.fn(async () => false) }));
vi.mock('../../../src/ai/global-flush-budget', () => ({ isHolding: vi.fn(() => false), recordFailure: (...a: unknown[]) => recordFailureMock(...a) }));
vi.mock('../../../src/analysis/comment-rewriter', () => ({ validateRewriteLanguage: vi.fn(() => true) }));

import { process } from '../../../src/analysis/pipeline';
import type { PostContent } from '../../../src/types/post';

const BENIGN_POST = 'I really enjoyed the sunset at the beach today with my family';

function makePost(text: string): PostContent {
  return {
    id: 'p1', text, author: '', timestamp: '2026-10-12T09:00:00.000Z', platform: 'twitter',
    domRef: new WeakRef({} as unknown as HTMLElement),
  } as PostContent;
}

beforeEach(() => {
  combinedMock.mockReset();
  recordFailureMock.mockReset();
  lastFailureKind = null;
  settings = {};
});


const REPLY_TEXT = 'I really enjoyed the sunset at the beach today with my family';

function makeReply(parentText: string | undefined, over: Record<string, unknown> = {}) {
  return { ...makePost(REPLY_TEXT), kind: 'reply', parentText, ...over } as ReturnType<typeof makePost>;
}

/** The sixth argument of the judge call: the context block. */
function contextSent(): string | undefined {
  expect(combinedMock).toHaveBeenCalledTimes(1);
  return combinedMock.mock.calls[0][5] as string | undefined;
}

beforeEach(() => { combinedMock.mockResolvedValue(null); });

describe('what the Moderate judge is told about where the item sits', () => {
  it('a post: the site and the kind', async () => {
    await process(makePost(REPLY_TEXT));
    const context = contextSent()!;
    expect(context).toContain('Platform: twitter');
    expect(context).toContain('Kind: post');
    expect(context).not.toContain('THE POST IT REPLIES TO');
  });

  it('a reply: the kind is comment and the post it answers is shown as context only', async () => {
    await process(makeReply('Who else is tired of this endless argument about the road works?'));
    const context = contextSent()!;
    expect(context).toContain('Kind: comment');
    expect(context).toContain('THE POST IT REPLIES TO (context only, not the item to judge):\nWho else is tired');
  });

  it('a video caption is told as a video', async () => {
    await process({ ...makePost(REPLY_TEXT), kind: 'video', platform: 'tiktok' } as ReturnType<typeof makePost>);
    expect(contextSent()).toContain('Kind: video');
    expect(contextSent()).toContain('Platform: tiktok');
  });

  it('the parent is cut at six hundred characters', async () => {
    await process(makeReply('x'.repeat(2000)));
    const context = contextSent()!;
    expect(context).toContain('x'.repeat(600));
    expect(context).not.toContain('x'.repeat(601));
  });

  it('the caption context the adapter gave comes first and is kept', async () => {
    await process(makeReply('a parent post', { context: '\u2022 @someone: an earlier comment' }));
    const context = contextSent()!;
    expect(context.indexOf('an earlier comment')).toBeGreaterThanOrEqual(0);
    expect(context.indexOf('an earlier comment')).toBeLessThan(context.indexOf('Platform: twitter'));
  });

  it('the parent reaches the judge with its names replaced by letters, not as written', async () => {
    await process(makeReply('@zebediah_quartz said the road works are a disgrace and @zebediah_quartz should resign'));
    const context = contextSent()!;
    expect(context).toContain('THE POST IT REPLIES TO');
    expect(context).not.toContain('zebediah_quartz');
  });
});

describe('the other levels are untouched', () => {
  it('Relaxed gets the context it always got: none, when the adapter gave none (it has fields of its own for the rest)', async () => {
    settings = { mode: 'adult' };
    await process(makeReply('a parent post'));
    expect(contextSent()).toBeUndefined();
  });

  it('Strict reads nothing, so no context is built or sent', async () => {
    settings = { mode: 'child' };
    await process(makeReply('a parent post'));
    expect(combinedMock).not.toHaveBeenCalled();
  });
});

describe('the quoted post and the link card, with no name (the Leader, 12 Oct 2026)', () => {
  const withCard = (card: Record<string, unknown>) => makeReply(undefined, { kind: 'post', card });

  it('the quoted body goes, capped, as context only', async () => {
    await process(withCard({ quotedBody: 'z'.repeat(1000), text: 'z'.repeat(1000) }));
    const context = contextSent()!;
    expect(context).toContain('THE POST IT QUOTES (context only, not the item to judge):');
    expect(context).toContain('z'.repeat(400));
    expect(context).not.toContain('z'.repeat(401));
  });

  it('a handle inside the quoted body goes as a letter, not as written', async () => {
    await process(withCard({ quotedBody: 'as @zebediah_quartz said, the road works are a disgrace', text: 'Ada Brightwell\nas @zebediah_quartz said' }));
    const context = contextSent()!;
    expect(context).toContain('THE POST IT QUOTES');
    expect(context).not.toContain('zebediah_quartz');
  });

  it('the quoted account\'s display name and handle never go: they ride the card text for the household list and nowhere else', async () => {
    await process(withCard({ quotedBody: 'quoted words', text: 'quoted words\nAda Brightwell', accounts: ['adabrightwell'] }));
    const context = contextSent()!;
    expect(context).toContain('quoted words');
    expect(context).not.toContain('Ada Brightwell');
    expect(context).not.toContain('adabrightwell');
  });

  it('a link card goes as its title and its domain only', async () => {
    await process(withCard({ link: { title: 'A headline about the road works', domain: 'example.com' }, text: 'example.com\nA headline about the road works\nthe long description' }));
    const context = contextSent()!;
    expect(context).toContain('A LINK CARD UNDER THE POST (context only): A headline about the road works (example.com)');
    expect(context).not.toContain('long description');
  });

  it('a card with neither adds nothing', async () => {
    await process(withCard({ text: 'From someone', accounts: ['someone'] }));
    const context = contextSent()!;
    expect(context).not.toContain('QUOTES');
    expect(context).not.toContain('LINK CARD');
    expect(context).not.toContain('someone');
  });

  it('Relaxed does not get the card in a context block it does not have', async () => {
    settings = { mode: 'adult' };
    await process(withCard({ quotedBody: 'quoted words' }));
    expect(contextSent()).toBeUndefined();
  });
});
