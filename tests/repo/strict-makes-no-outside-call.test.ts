// @vitest-environment jsdom
//
// Strict makes no outside call of any kind. The popup and the site say so in one sentence, so this
// drives every path that can send something out (the reading on a post, a video and a comment
// room, the licence probe, the time-stamp round) over a modelled day on each of the five sites,
// with a paid key present and the stored reading switch ON (the state an install that was moved to
// Strict later can be in), and counts everything that would leave: fetch, sendBeacon, WebSocket,
// XMLHttpRequest and EventSource. The pipeline, the AI client, the scorer and the time-stamp client
// run for real; only storage around them is stubbed.
//
// The same run at Moderate and Relaxed shows the calls are made there, so a zero in Strict is the
// gate and not a fetch that never fired.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
vi.mock('../../src/storage/license', () => ({
  getLicense: vi.fn(async () => ({ tier: 'family', secret: 's' })),
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

/** One modelled day: a post, a video and a comment room on the site, then the licence probe and a time-stamp round. */
async function modelledDay(platform: Platform): Promise<void> {
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
  await probeProxy(`fw-family-${platform}-${SETTINGS.mode}-secret`);
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
});

describe('Strict, with a paid key and the stored reading switch on', () => {
  it.each(PLATFORMS)('%s: a modelled day sends nothing anywhere', async (platform) => {
    SETTINGS.mode = 'child';
    await modelledDay(platform);
    expect(calls).toEqual([]);
  });

  it('the licence probe answers from what it had, or unchecked, and asks nobody', async () => {
    SETTINGS.mode = 'child';
    expect(await probeProxy('fw-family-abc-secret')).toBe('unknown');
    expect(calls).toEqual([]);
  });

  it('a time-stamp round returns no anchor and names why, on both routes', async () => {
    SETTINGS.mode = 'child';
    const round = await requestVerifiedTimestamps(HASH);
    expect(round.anchors).toEqual([]);
    expect(round.reasons).toEqual(['strict_makes_no_calls']);
    expect(calls).toEqual([]);
  });
});

describe('Moderate and Relaxed make the calls Strict does not', () => {
  it.each(['teen', 'adult'] as const)('%s: the reading, the licence probe and the time stamps all go out', async (mode) => {
    SETTINGS.mode = mode;
    await modelledDay('twitter');
    const proxyCalls = calls.filter((c) => c.includes(PROXY));
    expect(proxyCalls.some((c) => c.includes('/v1/chat/completions'))).toBe(true);
    expect(proxyCalls.some((c) => c.includes('/v1/models'))).toBe(true);
    for (const host of TSA_HOSTS) expect(calls.some((c) => c.includes(host))).toBe(true);
    expect(proxyCalls.some((c) => c.includes('/v1/tsa'))).toBe(true);
  });
});
