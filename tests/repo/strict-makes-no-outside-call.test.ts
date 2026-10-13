// @vitest-environment jsdom
//
// Silent (the Strict level) makes no outside call without a key and the agreement. The popup and the site say so in one
// sentence, so this drives every path that can send something out (the reading on a post, a video and a comment
// room, the licence probe, the time-stamp round) over a modelled day on each of the five sites, and counts everything
// that would leave: fetch, sendBeacon, WebSocket, XMLHttpRequest and EventSource. The pipeline, the AI client, the
// scorer and the time-stamp client run for real; only storage around them is stubbed.
//
// Since 12 Oct 2026 Silent reads once a key is added and the agreement is given: with a key and no agreement the only call
// is the licence check (the key is checked like at any level); with both, the reading and the time stamps go out like
// Calm's. The same run at Calm and Open shows the calls are made there, so a zero at Silent is the gate and not a
// fetch that never fired.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// What the gate finds for the key and the agreement.
const HELD = vi.hoisted(() => ({ tier: 'family' as string, agreed: false }));

const SETTINGS = vi.hoisted(() => ({
  mode: 'child',
  aiAnalysisEnabled: true,
  strictLanguage: false,
  locale: 'en',
  outputLanguage: 'auto',
  dailyCap: 2000,
  monthlyUsdCapOverride: null,
  totalChecksToday: 0,
  totalTokensThisMonth: 0,
  features: { 'reframe-rewrites': { enabled: true } },
}));

vi.mock('../../src/storage/settings', () => ({
  getSettings: vi.fn(async () => ({ ...SETTINGS })),
  isFeatureEnabled: (
    s: { features?: Record<string, { enabled?: boolean }> },
    id: string,
  ) => s.features?.[id]?.enabled === true,
  recordAiCall: vi.fn(async () => undefined),
}));
vi.mock('../../src/storage/reading-consent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/storage/reading-consent')>()),
  getReadingConsent: vi.fn(async () => (HELD.agreed ? { at: '2026-10-12T10:00:00Z', provider: 'p', textHash: 'h' } : null)),
}));
vi.mock('../../src/storage/license', () => ({
  getLicense: vi.fn(async () => ({ tier: HELD.tier, secret: HELD.tier === 'free' ? '' : 's' })),
  dailyCapForTier: vi.fn(() => 2000),
  effectiveMonthlyTokenCap: vi.fn(() => 1_000_000),
  isUncappedTier: vi.fn(() => false),
}));
vi.mock('../../src/storage/cache', () => ({
  processingCache: { getPersistent: vi.fn(async () => null), set: vi.fn() },
}));
vi.mock('../../src/core/calibration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/core/calibration')>()),
  getEffectiveThreshold: vi.fn(async () => 0.6),
}));
vi.mock('../../src/forensics/author-store', () => ({
  getAuthorProfile: vi.fn(async () => null),
  getExposurePressure: vi.fn(() => ({ fired: false, reason: null, distinctDays: 0, creativeCount: 0 })),
  creativeHash: vi.fn(() => 'stub-hash'),
}));
vi.mock('../../src/storage/feature-flags', () => ({ isFeatureEnabled: vi.fn(async () => false) }));
vi.mock('../../src/forensics/neutralizer-diagnostics', () => ({
  recordNeutralizerEvent: vi.fn(async () => undefined),
}));
vi.mock('../../src/ai/telemetry', () => ({
  buildGroqCallTelemetry: vi.fn(() => ({})),
  recordGroqCallTelemetry: vi.fn(async () => undefined),
}));
vi.mock('../../src/storage/context-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/storage/context-guard')>()),
  safeSendMessage: vi.fn(async () => undefined),
}));

import { process as analyse } from '../../src/analysis/pipeline';
import { scoreBatch, encounterFromLegacyBatchInput, __resetBatchCacheForTests } from '../../src/analysis/comment-batch-scorer';
import { probeProxy } from '../../src/ai/client';
import { requestVerifiedTimestamps } from '../../src/forensics/tsa-client';
import { _resetForTests as resetFlushBudget } from '../../src/ai/global-flush-budget';
import type { Platform, PostContent } from '../../src/types/post';

const PLATFORMS: readonly Platform[] = ['twitter', 'instagram', 'tiktok', 'facebook', 'youtube'];
const PROXY = 'https://api.feelingwise.org/';
const TSA_HOSTS = ['freetsa.org', 'timestamp.digicert.com', 'timestamp.sectigo.com'];
const HASH = 'ab'.repeat(32);

let calls: string[];
let probeSeq = 0;

function record(kind: string, target: unknown): void {
  calls.push(`${kind} ${typeof target === 'string' ? target : (target as { url?: string })?.url ?? String(target)}`);
}

function okResponse(): Response {
  const body = {
    choices: [{ message: { content: 'no' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
  const res = {
    ok: true, status: 200,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    clone: () => res,
  };
  return res as unknown as Response;
}

function makePost(platform: Platform, kind: 'post' | 'video'): PostContent {
  return {
    id: `${platform}-${kind}`,
    text: 'Anyone who still backs this plan is a fool, and the rest of us are tired of carrying people who cannot think.',
    author: '@someone',
    timestamp: new Date().toISOString(),
    platform,
    kind,
    domRef: new WeakRef(document.createElement('div')),
  } as PostContent;
}

/** One modelled day: a post, a video and a comment room on the site, then the licence probe (a key is needed for it) and a time-stamp round. */
async function modelledDay(platform: Platform, probe = true): Promise<void> {
  await analyse(makePost(platform, 'post'));
  await analyse(makePost(platform, 'video'));
  await scoreBatch(
    encounterFromLegacyBatchInput({
      comments: [{ author: 'alice', text: 'this is a sample comment from someone' }, { author: 'bob', text: 'and a second one that says something else' }],
      videoCaption: 'a caption',
      language: 'English',
      platform,
    }),
    SETTINGS.mode as 'child' | 'teen' | 'adult',
  );
  // A new key each time: the probe keeps a definite answer for five minutes per key, and a cached one makes no call.
  if (probe) await probeProxy(`fw-family-${platform}-${SETTINGS.mode}-secret-${++probeSeq}`);
  await requestVerifiedTimestamps(HASH);
}

beforeEach(() => {
  resetFlushBudget();
  __resetBatchCacheForTests();
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { record('fetch', url); return okResponse(); }));
  vi.stubGlobal('WebSocket', class { constructor(url: string) { record('websocket', url); } });
  vi.stubGlobal('EventSource', class { constructor(url: string) { record('eventsource', url); } });
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: (url: string) => { record('beacon', url); return true; } });
  vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation((_m: string, url: string | URL) => { record('xhr', String(url)); });
  vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(() => undefined);
  // Direct time-stamp requests need the host permission; a real install has it.
  (globalThis as unknown as { chrome: unknown }).chrome = { permissions: { contains: async () => true } };
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  SETTINGS.mode = 'child';
  SETTINGS.aiAnalysisEnabled = true;
  HELD.tier = 'family';
  HELD.agreed = false;
});

describe('Silent without a key', () => {
  it.each(PLATFORMS)('%s: a modelled day sends nothing anywhere', async (platform) => {
    SETTINGS.mode = 'child';
    HELD.tier = 'free';
    await modelledDay(platform, false);
    expect(calls).toEqual([]);
  });
});

describe('Silent with a key and the stored reading switch on, no agreement given yet', () => {
  it.each(PLATFORMS)('%s: a modelled day sends only the licence check', async (platform) => {
    SETTINGS.mode = 'child';
    await modelledDay(platform);
    // The key is checked like at any level; the reading and the time stamps wait for the agreement.
    expect(calls).toEqual([`fetch ${PROXY}v1/models`]);
  });

  it('the licence probe asks the relay about the key', async () => {
    SETTINGS.mode = 'child';
    expect(await probeProxy('fw-family-abc-secret')).toBe('ok');
    expect(calls).toEqual([`fetch ${PROXY}v1/models`]);
  });

  it('a time-stamp round returns no anchor and names why, on both routes', async () => {
    SETTINGS.mode = 'child';
    const round = await requestVerifiedTimestamps(HASH);
    expect(round.anchors).toEqual([]);
    expect(round.reasons).toEqual(['strict_makes_no_calls']);
    expect(calls).toEqual([]);
  });
});

describe('Silent with a key and the agreement given', () => {
  it('the reading, the licence check and the time stamps all go out, as at Calm', async () => {
    SETTINGS.mode = 'child';
    HELD.agreed = true;
    await modelledDay('twitter');
    const proxyCalls = calls.filter((c) => c.includes(PROXY));
    expect(proxyCalls.some((c) => c.includes('/v1/chat/completions'))).toBe(true);
    expect(proxyCalls.some((c) => c.includes('/v1/models'))).toBe(true);
    for (const host of TSA_HOSTS) expect(calls.some((c) => c.includes(host))).toBe(true);
  });

  it('with the reading switched off nothing is read and no time stamp goes out; only the licence check does', async () => {
    SETTINGS.mode = 'child';
    HELD.agreed = true;
    SETTINGS.aiAnalysisEnabled = false;
    await modelledDay('twitter');
    expect(calls).toEqual([`fetch ${PROXY}v1/models`]);
  });
});

describe('Calm and Open make the calls Silent does not make without a key and the agreement', () => {
  it.each(['teen', 'adult'] as const)('%s: the reading, the licence probe and the time stamps all go out', async (mode) => {
    SETTINGS.mode = mode;
    // The client reads the go-ahead before any reading leaves (cold audit 13 Oct 2026, finding 4), at every level.
    HELD.agreed = true;
    await modelledDay('twitter');
    const proxyCalls = calls.filter((c) => c.includes(PROXY));
    expect(proxyCalls.some((c) => c.includes('/v1/chat/completions'))).toBe(true);
    expect(proxyCalls.some((c) => c.includes('/v1/models'))).toBe(true);
    for (const host of TSA_HOSTS) expect(calls.some((c) => c.includes(host))).toBe(true);
    expect(proxyCalls.some((c) => c.includes('/v1/tsa'))).toBe(true);
  });
});
