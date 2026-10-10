/** @vitest-environment jsdom */
// The rewrite switch decides whether a flagged post is shown in other words. The verdict cache is
// keyed without it, so a rewrite cached while the switch was on is still there after the parent
// turns it off. A cache hit with the switch off must end where a fresh verdict with no rewrite
// ends: hidden when the judges' own rules hide a severe flag that has no rewrite, otherwise marked
// on the original text, or folded in Child. Those rules also read what the model said on this very
// call, which the cache does not keep, so the post is judged again.
//
// The pipeline, the real cache, both judges in core/neutralizer.ts and the AI client all run; only
// fetch and the storage around them are stubbed. The cache is primed the way the pipeline primes
// it after it served a rewrite.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const SETTINGS = vi.hoisted(() => ({
  mode: 'teen' as 'child' | 'teen' | 'adult',
  strictLanguage: false,
  locale: 'en',
  outputLanguage: 'auto',
  dailyCap: 2000,
  monthlyUsdCapOverride: null,
  totalChecksToday: 0,
  totalTokensThisMonth: 0,
  features: {
    'reframe-rewrites': { enabled: true } as { enabled: boolean; perPlatform?: Record<string, { enabled?: boolean }> },
  },
}));

vi.mock('../../../src/storage/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/storage/settings')>()),
  getSettings: vi.fn(async () => structuredClone(SETTINGS)),
  recordAiCall: vi.fn(async () => undefined),
}));
vi.mock('../../../src/storage/license', () => ({
  getLicense: vi.fn(async () => ({ tier: 'family', secret: 's' })),
  dailyCapForTier: vi.fn(() => 2000),
  effectiveMonthlyTokenCap: vi.fn(() => 1_000_000),
  isUncappedTier: vi.fn(() => false),
}));
vi.mock('../../../src/core/calibration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/core/calibration')>()),
  getEffectiveThreshold: vi.fn(async () => 0.6),
}));
vi.mock('../../../src/forensics/author-store', () => ({
  getAuthorProfile: vi.fn(async () => null),
  getExposurePressure: vi.fn(() => ({
    fired: false, reason: null, distinctDays: 0, creativeCount: 0,
  })),
  creativeHash: vi.fn(() => 'stub-hash'),
}));
vi.mock('../../../src/storage/feature-flags', () => ({ isFeatureEnabled: vi.fn(async () => false) }));
vi.mock('../../../src/forensics/neutralizer-diagnostics', () => ({
  recordNeutralizerEvent: vi.fn(async () => undefined),
}));
vi.mock('../../../src/ai/telemetry', () => ({
  buildGroqCallTelemetry: vi.fn(() => ({})),
  recordGroqCallTelemetry: vi.fn(async () => undefined),
}));
vi.mock('../../../src/storage/context-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/storage/context-guard')>()),
  safeSendMessage: vi.fn(async () => undefined),
}));

import { process } from '../../../src/analysis/pipeline';
import { processingCache } from '../../../src/storage/cache';
import { verdictCacheKeyInput } from '../../../src/storage/cache-key';
import { sha256 } from '../../../src/forensics/hasher';
import { JUDGE_V1_MODEL, JUDGE_V1_SECOND_MODEL, TRIAGE_STAGE1_SYSTEM } from '../../../src/ai/prompts';
import { _resetForTests as resetFlushBudget } from '../../../src/ai/global-flush-budget';
import type { AnalysisResult } from '../../../src/types/analysis';
import type { PostContent } from '../../../src/types/post';

const POST_TEXT =
  'Anyone who still backs this plan is a fool, and the rest of us are tired of carrying people who cannot think for themselves.';
const REWRITE_TEXT =
  'I think anyone who still backs this plan is mistaken, and I am tired of the argument going nowhere.';
const JUDGE = { model: 'the-judge', provider: 'deepinfra' };
const CONCERN = 'fear pushed at the reader about the plan';

/** What each judge says when the post is judged again. */
let legacySeverity: number;
let adultSeverity: number;
let modelsAsked: string[];

function proxyResponse(content: string): Response {
  const body = {
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
  const res = {
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name.toLowerCase() === 'x-fw-provider' ? 'deepinfra' : null) },
    json: () => Promise.resolve(body),
    clone: () => res,
  };
  return res as unknown as Response;
}

function makePost(): PostContent {
  return {
    id: 'p1',
    text: POST_TEXT,
    author: '@u',
    timestamp: new Date().toISOString(),
    platform: 'twitter',
    domRef: new WeakRef(document.createElement('div')),
  } as PostContent;
}

/** The analysis the Child and Teen judge returns alongside a rewrite it wrote. */
function legacyFlag(severity: number): AnalysisResult {
  return {
    postId: 'earlier',
    techniques: [{ technique: 'fear-appeal', present: true, confidence: 0.9, severity, evidence: [CONCERN] }],
    overallScore: severity,
    overallConfidence: 0.9,
    isManipulative: true,
    processingTimeMs: 1,
    explanation: CONCERN,
    primaryTechnique: 'fear-appeal',
    action: 'rewrite',
  } as AnalysisResult;
}

/** The analysis the Adult judge returns alongside a rewrite: hostile, below its own hide cut. */
function adultFlag(severity: number): AnalysisResult {
  return {
    postId: 'earlier',
    techniques: [{ technique: 'anger-trigger', present: true, confidence: 0.9, severity, evidence: ['judge-v1: hostile'] }],
    overallScore: severity,
    overallConfidence: 0.9,
    isManipulative: true,
    processingTimeMs: 1,
    primaryTechnique: 'anger-trigger',
    action: 'rewrite',
    judge: {
      id: 'judge-v1-pair',
      hash: 'h',
      model: `${JUDGE_V1_MODEL}+${JUDGE_V1_SECOND_MODEL}`,
      charged: true,
      family: 'hostile',
      severity,
      effect: 'recruit',
      intent: 'react',
    },
  } as AnalysisResult;
}

/** The entry the pipeline writes after it served a rewrite, under the key it reads. */
async function primeCachedRewrite(mode: 'child' | 'teen' | 'adult', analysis: AnalysisResult): Promise<void> {
  const key = await sha256(verdictCacheKeyInput('twitter', mode, 'en', 'auto', POST_TEXT));
  processingCache.set(key, analysis, REWRITE_TEXT, JUDGE, 'the-writer');
}

beforeEach(() => {
  resetFlushBudget();
  processingCache.clear();
  SETTINGS.mode = 'teen';
  SETTINGS.features['reframe-rewrites'] = { enabled: true };
  legacySeverity = 6;
  adultSeverity = 5;
  modelsAsked = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body)) as { model: string; messages: Array<{ content: string }> };
    modelsAsked.push(request.model);
    if (request.messages[0].content === TRIAGE_STAGE1_SYSTEM) return proxyResponse('yes');
    if (request.model === JUDGE_V1_MODEL || request.model === JUDGE_V1_SECOND_MODEL) {
      return proxyResponse(JSON.stringify({
        charged: true, family: 'hostile', severity: adultSeverity, effect: 'recruit', intent: 'react',
      }));
    }
    // The Child and Teen judge with the switch off: it still says a rewrite could be written, and
    // writes none.
    return proxyResponse(JSON.stringify({
      concerning: true,
      acts_on_reader: true,
      primary_concern: CONCERN,
      severity: legacySeverity,
      confidence: 0.9,
      uncertainty_reason: null,
      should_rewrite: true,
      neutralized_text: null,
    }));
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a cached rewrite obeys the rewrite switch', () => {
  it('switch on: the cached rewrite is served and no model is asked', async () => {
    await primeCachedRewrite('teen', legacyFlag(6));

    const result = await process(makePost());

    expect(result.action).toBe('neutralize');
    expect(result.neutralized?.rewrittenText).toBe(REWRITE_TEXT);
    expect(result.aiMeta).toEqual(JUDGE);
    expect(modelsAsked).toEqual([]);
  });

  it('switch off in Teen: the post is judged again and the flag is marked on the original text', async () => {
    await primeCachedRewrite('teen', legacyFlag(6));
    SETTINGS.features['reframe-rewrites'] = { enabled: false };

    const result = await process(makePost());

    expect(modelsAsked.length).toBeGreaterThan(0);
    expect(result.action).toBe('mark');
    expect(result.neutralized).toBeUndefined();
    expect(result.analysis?.isManipulative).toBe(true);
    expect(result.analysis?.postId).toBe('p1');
  });

  it('switch off in Teen, severity 7 fear appeal: hidden, as a fresh verdict with no rewrite is', async () => {
    await primeCachedRewrite('teen', legacyFlag(7));
    SETTINGS.features['reframe-rewrites'] = { enabled: false };
    legacySeverity = 7;

    const result = await process(makePost());

    expect(result.action).toBe('hide');
    expect(result.neutralized).toBeUndefined();
  });

  it('switch off in Child (Strict makes no call, PLAN-A S2): the stale cache is dropped and nothing local catches it, so it passes', async () => {
    await primeCachedRewrite('child', legacyFlag(6));
    SETTINGS.mode = 'child';
    SETTINGS.features['reframe-rewrites'] = { enabled: false };

    const result = await process(makePost());

    // Strict never asks a judge (client.ts callAI refuses before fetch), so the cached rewrite's
    // stale verdict is not trusted and nothing replaces it: no local rule flags this text, and the
    // result is a plain pass, not the fold a pre-Strict child judge would have produced.
    expect(modelsAsked).toEqual([]);
    expect(result.action).toBe('pass');
    expect(result.neutralized).toBeUndefined();
  });

  it('switch off for this platform only, Adult: the flag is marked', async () => {
    await primeCachedRewrite('adult', adultFlag(5));
    SETTINGS.mode = 'adult';
    SETTINGS.features['reframe-rewrites'] = { enabled: true, perPlatform: { twitter: { enabled: false } } };

    const result = await process(makePost());

    expect(modelsAsked).toEqual([JUDGE_V1_MODEL, JUDGE_V1_SECOND_MODEL]);
    expect(result.action).toBe('mark');
    expect(result.neutralized).toBeUndefined();
  });

  it('switch off for this platform only, Adult, hostile at severity 7: hidden, as a fresh verdict with no rewrite is', async () => {
    await primeCachedRewrite('adult', adultFlag(7));
    SETTINGS.mode = 'adult';
    SETTINGS.features['reframe-rewrites'] = { enabled: true, perPlatform: { twitter: { enabled: false } } };
    adultSeverity = 7;

    const result = await process(makePost());

    expect(result.action).toBe('hide');
    expect(result.neutralized).toBeUndefined();
  });

  it('switch on again: the rewrite kept in the cache is served again without asking a model', async () => {
    await primeCachedRewrite('teen', legacyFlag(6));
    SETTINGS.features['reframe-rewrites'] = { enabled: false };
    expect((await process(makePost())).action).toBe('mark');
    const askedWhileOff = modelsAsked.length;

    SETTINGS.features['reframe-rewrites'] = { enabled: true };
    const result = await process(makePost());

    expect(result.action).toBe('neutralize');
    expect(result.neutralized?.rewrittenText).toBe(REWRITE_TEXT);
    expect(modelsAsked.length).toBe(askedWhileOff);
  });
});
