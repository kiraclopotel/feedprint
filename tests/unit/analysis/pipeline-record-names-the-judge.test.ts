/** @vitest-environment jsdom */
// A post's record names the model and provider of the call that produced its verdict. On the
// adult path the judges are followed by a rewrite call on another model, so reading "whatever
// call finished last" named the rewrite model when the rewrite answered, and no model at all
// (a record that says rules) when the rewrite failed, although two cloud models had read the text.
//
// When both judges answered, the record names both, as the record's own decision block does, and
// each name is the model the proxy says answered: the deployed proxy answers a model it does not
// allow with gpt-oss-20b, so the model the client asked for is not evidence of what read the text.
//
// The pipeline, the frozen adult judge (core/neutralizer.ts) and the AI client all run for real;
// only fetch and the storage around them are stubbed, so each proxy reply carries the provider
// header the proxy sets and, where a case scripts one, the model the reply names.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installChromeStorageStub, type ChromeStorageStub } from '../../helpers/chrome-storage';
import { readingConsentFor } from '../../helpers/reading-consent';

const SETTINGS = vi.hoisted(() => ({
  mode: 'adult',
  strictLanguage: false,
  locale: 'en',
  outputLanguage: 'auto',
  dailyCap: 2000,
  monthlyUsdCapOverride: null,
  totalChecksToday: 0,
  totalTokensThisMonth: 0,
  features: { 'reframe-rewrites': { enabled: true } },
}));

vi.mock('../../../src/storage/settings', () => ({
  getSettings: vi.fn(async () => ({ ...SETTINGS })),
  isFeatureEnabled: (
    s: { features?: Record<string, { enabled?: boolean }> },
    id: string,
  ) => s.features?.[id]?.enabled === true,
  recordAiCall: vi.fn(async () => undefined),
}));
vi.mock('../../../src/storage/license', () => ({
  getLicense: vi.fn(async () => ({ tier: 'family', secret: 's' })),
  dailyCapForTier: vi.fn(() => 2000),
  effectiveMonthlyTokenCap: vi.fn(() => 1_000_000),
  isUncappedTier: vi.fn(() => false),
}));
vi.mock('../../../src/storage/cache', () => ({
  processingCache: {
    getPersistent: vi.fn(async () => null),
    set: vi.fn(),
  },
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
// The rewrite makes the same call the real neutralizeText makes (default model, the signal it
// was handed) and names its writer the same way, from the reply under that signal, without its
// voice validators, which are not what this file is about.
vi.mock('../../../src/ai/neutralize-only', async () => {
  const { callAI } = await import('../../../src/ai/client');
  const { callProvenanceFor } = await import('../../../src/ai/call-provenance');
  return {
    neutralizeText: async (input: { text: string; signal?: AbortSignal; onWriter?: (model: string) => void }) => {
      const reply = await callAI('rewrite', input.text, true, { signal: input.signal });
      const writer = input.signal ? callProvenanceFor(input.signal)?.model : undefined;
      if (reply.ok && writer) input.onWriter?.(writer);
      return reply.ok ? reply.value : '';
    },
  };
});

import { process } from '../../../src/analysis/pipeline';
import { GROQ_FAST_MODEL } from '../../../src/ai/client';
import { JUDGE_V1_MODEL, JUDGE_V1_SECOND_MODEL } from '../../../src/ai/prompts';
import { _resetForTests as resetFlushBudget } from '../../../src/ai/global-flush-budget';
import type { PostContent } from '../../../src/types/post';

// `served` is the model the reply body names; left out, the body names none.
interface ProxyReply { status: number; content?: string; provider: string; served?: string }

const JUDGE_PROVIDER = 'deepinfra';
const REWRITE_PROVIDER = 'workers-ai';
const FIRES = JSON.stringify({
  charged: true, family: 'hostile', severity: 5, effect: 'recruit', intent: 'react',
});
const POST_TEXT =
  'Anyone who still backs this plan is a fool, and the rest of us are tired of carrying people who cannot think for themselves.';
const REWRITE_TEXT =
  'I think anyone who still backs this plan is mistaken, and I am tired of the argument going nowhere.';

let replies: Map<string, ProxyReply>;
let modelsAsked: string[];
let onAsked: ((model: string) => void) | undefined;

function proxyResponse(reply: ProxyReply): Response {
  const body = reply.content === undefined
    ? { error: { code: 'content_policy' } }
    : {
      ...(reply.served === undefined ? {} : { model: reply.served }),
      choices: [{ message: { content: reply.content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };
  const res = {
    ok: reply.status >= 200 && reply.status < 300,
    status: reply.status,
    headers: { get: (name: string) => (name.toLowerCase() === 'x-fw-provider' ? reply.provider : null) },
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

// The licence is the mocked family key; its stored go-ahead lets the reading reach the (stubbed) network.
let storage: ChromeStorageStub;

beforeEach(() => {
  storage = installChromeStorageStub({ initial: readingConsentFor('fw-family-s') });
  resetFlushBudget();
  modelsAsked = [];
  onAsked = undefined;
  replies = new Map<string, ProxyReply>([
    [JUDGE_V1_MODEL, { status: 200, content: FIRES, provider: JUDGE_PROVIDER }],
    [JUDGE_V1_SECOND_MODEL, { status: 200, content: FIRES, provider: JUDGE_PROVIDER }],
    [GROQ_FAST_MODEL, { status: 200, content: REWRITE_TEXT, provider: REWRITE_PROVIDER }],
  ]);
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const model = (JSON.parse(String(init.body)) as { model: string }).model;
    modelsAsked.push(model);
    onAsked?.(model);
    if (init.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const reply = replies.get(model);
    if (!reply) throw new Error(`no reply scripted for ${model}`);
    return proxyResponse(reply);
  }));
});

afterEach(() => {
  storage.restore();
  vi.unstubAllGlobals();
});

describe('the record names the judge, not the call that happened to finish last', () => {
  it('adult path, rewrite answered: the record names the judge, not the rewrite model', async () => {
    const result = await process(makePost());

    expect(modelsAsked).toEqual([JUDGE_V1_MODEL, JUDGE_V1_SECOND_MODEL, GROQ_FAST_MODEL]);
    expect(result.action).toBe('neutralize');
    // The verdict is the first judge's reading and the second only gates it, so naming either
    // alone would misstate who decided; the record names both, as its decision block does.
    expect(result.aiMeta).toEqual({ model: `${JUDGE_V1_MODEL}+${JUDGE_V1_SECOND_MODEL}`, provider: JUDGE_PROVIDER });
    expect(result.neutralized?.analysis.judge?.model).toBe(`${JUDGE_V1_MODEL}+${JUDGE_V1_SECOND_MODEL}`);
  });

  it('the proxy answers the second judge with another model: the record names the one that answered', async () => {
    replies.set(JUDGE_V1_SECOND_MODEL, {
      status: 200, content: FIRES, provider: JUDGE_PROVIDER, served: 'openai/gpt-oss-20b',
    });

    const result = await process(makePost());

    expect(modelsAsked).toEqual([JUDGE_V1_MODEL, JUDGE_V1_SECOND_MODEL, GROQ_FAST_MODEL]);
    expect(result.action).toBe('neutralize');
    expect(result.aiMeta).toEqual({ model: `${JUDGE_V1_MODEL}+openai/gpt-oss-20b`, provider: JUDGE_PROVIDER });
  });

  it('the second judge is asked and does not answer: the record names only the judge that did', async () => {
    replies.set(JUDGE_V1_SECOND_MODEL, { status: 451, provider: JUDGE_PROVIDER });

    const result = await process(makePost());

    expect(modelsAsked).toEqual([JUDGE_V1_MODEL, JUDGE_V1_SECOND_MODEL]);
    expect(result.action).toBe('pass');
    expect(result.passContext?.aiMeta).toEqual({ model: JUDGE_V1_MODEL, provider: JUDGE_PROVIDER });
  });

  it('adult path, rewrite failed: the record still names the judge, so it cannot say rules', async () => {
    replies.set(GROQ_FAST_MODEL, { status: 451, provider: REWRITE_PROVIDER });

    const result = await process(makePost());

    // The rewrite is asked for twice: one more try when the first did not come back, never a third.
    expect(modelsAsked).toEqual([JUDGE_V1_MODEL, JUDGE_V1_SECOND_MODEL, GROQ_FAST_MODEL, GROQ_FAST_MODEL]);
    expect(result.action).toBe('mark');
    expect(result.rewriteWhy).toBe('no-text+retry');
    // result-apply.ts writes aiSource 'rules' for a mark whose aiMeta is absent.
    expect(result.aiMeta).toEqual({ model: `${JUDGE_V1_MODEL}+${JUDGE_V1_SECOND_MODEL}`, provider: JUDGE_PROVIDER });
  });

  it('adult path, first judge does not fire: only it ran, and the record names it', async () => {
    replies.set(JUDGE_V1_MODEL, {
      status: 200,
      content: JSON.stringify({ charged: false, family: 'none', severity: 0, effect: 'inert', intent: 'none' }),
      provider: JUDGE_PROVIDER,
    });

    const result = await process(makePost());

    expect(modelsAsked).toEqual([JUDGE_V1_MODEL]);
    expect(result.action).toBe('pass');
    expect(result.passContext?.aiMeta).toEqual({ model: JUDGE_V1_MODEL, provider: JUDGE_PROVIDER });
  });

  it('the judge answers with nothing readable: the unjudged result names the judge that answered', async () => {
    replies.set(JUDGE_V1_MODEL, { status: 200, content: 'this is not a verdict', provider: JUDGE_PROVIDER });

    const result = await process(makePost());

    expect(modelsAsked).toEqual([JUDGE_V1_MODEL]);
    expect(result.passContext?.reason).toBe('pre-llm-ai-call-failed');
    expect(result.passContext?.aiMeta).toEqual({ model: JUDGE_V1_MODEL, provider: JUDGE_PROVIDER });
  });

  it('no judge answers: the unjudged result names no one', async () => {
    replies.set(JUDGE_V1_MODEL, { status: 451, provider: JUDGE_PROVIDER });

    const result = await process(makePost());

    expect(modelsAsked).toEqual([JUDGE_V1_MODEL]);
    expect(result.passContext?.reason).toBe('pre-llm-ai-call-failed');
    expect(result.passContext?.aiMeta).toBeUndefined();
  });

  it('adult path: the rewrite names the model that wrote it, for the page\'s AI mark, and not the judges', async () => {
    replies.set(GROQ_FAST_MODEL, {
      status: 200, content: REWRITE_TEXT, provider: REWRITE_PROVIDER, served: 'the-rewriter-that-answered',
    });

    const result = await process(makePost());

    expect(result.action).toBe('neutralize');
    expect(result.neutralized?.rewrittenText).toBe(REWRITE_TEXT);
    expect(result.neutralized?.writerModel).toBe('the-rewriter-that-answered');
    expect(result.aiMeta).toEqual({ model: `${JUDGE_V1_MODEL}+${JUDGE_V1_SECOND_MODEL}`, provider: JUDGE_PROVIDER });
  });

  it('Teen path: the rewrite names the classify call\'s model, not the triage call before it', async () => {
    // On Teen and Child the rewrite comes in the classify reply. The triage call before it runs
    // under the same signal and only answers yes or no, so a different model answering it (the
    // proxy's second rung) is in the record's list of what answered, and is not the writer.
    const classify = JSON.stringify({
      concerning: true, primary_concern: 'hostile shaming attack on people who disagree',
      severity: 7, confidence: 0.9, acts_on_reader: true,
      should_rewrite: true, neutralized_text: REWRITE_TEXT,
    });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { model: string; messages: { content: string }[] };
      modelsAsked.push(body.model);
      const triage = body.messages[0].content.startsWith('You are a content safety triage classifier');
      return proxyResponse(triage
        ? { status: 200, content: 'yes', provider: JUDGE_PROVIDER, served: 'the-triage-model' }
        : { status: 200, content: classify, provider: JUDGE_PROVIDER, served: 'the-classify-model' });
    }));
    SETTINGS.mode = 'teen';
    try {
      const result = await process(makePost());

      expect(modelsAsked).toHaveLength(2);
      expect(result.action).toBe('neutralize');
      expect(result.neutralized?.rewrittenText).toBe(REWRITE_TEXT);
      expect(result.neutralized?.writerModel).toBe('the-classify-model');
      expect(result.aiMeta).toEqual({ model: 'the-triage-model+the-classify-model', provider: JUDGE_PROVIDER });
    } finally {
      SETTINGS.mode = 'adult';
    }
  });

  it('the judge runs under its own signal, and a cancel from the queue still reaches it', async () => {
    const queue = new AbortController();
    onAsked = () => queue.abort();

    const result = await process(makePost(), queue.signal);

    expect(modelsAsked).toEqual([JUDGE_V1_MODEL]);
    expect(result.action).toBe('cancelled');
    expect(result.cancelKind).toBe('stale');
  });
});
