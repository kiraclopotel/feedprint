// Strict makes no outside call, and a post that reaches the reading at Strict used to be written as a failed call: in the owner's
// export (read 12 Oct 2026, crew/reading/EXPORT-STUDY-2026-10-12.md) 625 of the 1,233 failed posts were Strict's, a level that holds
// 2.2 percent of the records, and three such refusals in ten seconds armed the shared fifteen-second hold that stops the calls of
// every other level. The pipeline now says what is true (the rules ran, nothing was read at this level) and does not place the call;
// and the hold is armed by the three transient kinds only, as the comment batch has always done.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FWSettings } from '../../../src/storage/settings';

// Strict reads for an adult who holds a key and has agreed, but only once the build lets it (types/strict-reads-switch.ts, shut as
// shipped); the cases that open it set GATE.open here.
const GATE = vi.hoisted(() => ({ open: false, tier: 'family', consent: null as object | null }));
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
vi.mock('../../../src/types/strict-reads-switch', () => ({
  get STRICT_READS_WITH_A_KEY() { return GATE.open; },
}));
vi.mock('../../../src/storage/reading-consent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/storage/reading-consent')>()),
  getReadingConsent: vi.fn(async () => GATE.consent),
}));
vi.mock('../../../src/storage/license', () => ({
  getLicense: vi.fn(async () => ({ tier: GATE.tier, secret: '' })),
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
  Object.assign(GATE, { open: false, tier: 'family', consent: null });
});

describe('a level that sends nothing out reads nothing, and says so', () => {
  it('Strict: the post passes as not read at this level, the judge is not asked and no failure is counted', async () => {
    settings = { mode: 'child' };
    const result = await process(makePost(BENIGN_POST));
    expect(result.action).toBe('pass');
    expect(result.passContext?.reason).toBe('pre-llm-level-reads-nothing');
    expect(combinedMock).not.toHaveBeenCalled();
    expect(recordFailureMock).not.toHaveBeenCalled();
  });

  it('a level nobody has chosen yet is the same: the call that would have gone out is not placed', async () => {
    settings = { mode: 'teen', levelChosen: false };
    const result = await process(makePost(BENIGN_POST));
    expect(result.passContext?.reason).toBe('pre-llm-level-reads-nothing');
    expect(combinedMock).not.toHaveBeenCalled();
  });

  it('Moderate still places its call', async () => {
    combinedMock.mockResolvedValue(null);
    const result = await process(makePost(BENIGN_POST));
    expect(combinedMock).toHaveBeenCalledTimes(1);
    expect(result.passContext?.reason).toBe('pre-llm-ai-call-failed');
  });

  it('the rules at Strict still act before the level is asked (a threat is hidden, not passed as unread)', async () => {
    settings = { mode: 'child' };
    const result = await process(makePost('you should kill yourself, nobody would miss you at all'));
    expect(result.passContext?.reason).not.toBe('pre-llm-level-reads-nothing');
    expect(combinedMock).not.toHaveBeenCalled();
  });
});

describe('Strict reads only when the build lets it, and then only for an adult who holds a key and has agreed', () => {
  const AGREED = { textVersion: 'reading-consent-3', textHash: 'h', at: '2026-10-12T10:00:00Z', provider: 'DeepInfra' };

  it('as shipped (the switch shut) a key and an agreement change nothing: Strict reads nothing', async () => {
    settings = { mode: 'child' };
    Object.assign(GATE, { open: false, tier: 'family', consent: AGREED });
    const result = await process(makePost(BENIGN_POST));
    expect(result.passContext?.reason).toBe('pre-llm-level-reads-nothing');
    expect(combinedMock).not.toHaveBeenCalled();
  });

  it('the switch open, a key and the agreement: the call is placed like any other level', async () => {
    settings = { mode: 'child' };
    combinedMock.mockResolvedValue(null);
    Object.assign(GATE, { open: true, tier: 'family', consent: AGREED });
    const result = await process(makePost(BENIGN_POST));
    expect(combinedMock).toHaveBeenCalledTimes(1);
    expect(result.passContext?.reason).toBe('pre-llm-ai-call-failed');
  });

  it.each([
    ['a key without the agreement', { tier: 'family', consent: null }],
    ['the agreement without a key', { tier: 'free', consent: AGREED }],
    ['no key and no agreement', { tier: 'free', consent: null }],
  ])('the switch open, %s: the post passes as not read, the judge is not asked and no failure is counted', async (_name, who) => {
    settings = { mode: 'child' };
    Object.assign(GATE, { open: true, ...who });
    const result = await process(makePost(BENIGN_POST));
    expect(result.passContext?.reason).toBe('pre-llm-level-reads-nothing');
    expect(combinedMock).not.toHaveBeenCalled();
    expect(recordFailureMock).not.toHaveBeenCalled();
  });

  it('the switch open, a key and the agreement, but a level nobody has chosen: still nothing is read', async () => {
    settings = { mode: 'teen', levelChosen: false };
    Object.assign(GATE, { open: true, tier: 'family', consent: AGREED });
    const result = await process(makePost(BENIGN_POST));
    expect(result.passContext?.reason).toBe('pre-llm-level-reads-nothing');
    expect(combinedMock).not.toHaveBeenCalled();
  });
});

describe('only a failing vendor arms the shared hold', () => {
  it.each(['rate-limit', 'transient-http', 'network'])('%s arms it', async (kind) => {
    lastFailureKind = kind;
    combinedMock.mockResolvedValue(null);
    await process(makePost(BENIGN_POST));
    expect(recordFailureMock).toHaveBeenCalledTimes(1);
  });

  it.each(['cap-exhausted', 'auth-refusal', 'consent-required', 'json-refusal'])('%s does not: it is no sign of a vendor in distress', async (kind) => {
    lastFailureKind = kind;
    combinedMock.mockResolvedValue(null);
    const result = await process(makePost(BENIGN_POST));
    expect(result.passContext?.reason).toBe('pre-llm-ai-call-failed');
    expect(recordFailureMock).not.toHaveBeenCalled();
  });

  it('a failure nobody named still arms it, as before', async () => {
    lastFailureKind = null;
    combinedMock.mockResolvedValue(null);
    await process(makePost(BENIGN_POST));
    expect(recordFailureMock).toHaveBeenCalledTimes(1);
  });
});
