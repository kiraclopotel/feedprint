/** @vitest-environment jsdom */
// A comment the batch could not judge is recorded as unjudged, and the record names a provider
// only when one answered, because a signed record naming a company that never read the text is false.
// The real flushBatch, batch scorer and AI client run; only fetch and the storage around them are
// stubbed, so the provider comes off the header the proxy sets.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    getSettings: vi.fn(async () => ({
      mode: 'teen',
      outputLanguage: 'auto',
      dailyCap: 200,
      totalChecksToday: 0,
    })),
    isFeatureEnabled: vi.fn(() => true),
    isCommentRewriteEnabled: vi.fn(() => true),
    recordAiCall: vi.fn(async () => undefined),
  };
});
vi.mock('../../../../src/storage/license', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/storage/license')>()),
  getLicense: vi.fn(async () => ({ tier: 'family', secret: 's' })),
}));
vi.mock('../../../../src/ai/telemetry', () => ({
  buildGroqCallTelemetry: vi.fn(() => ({})),
  recordGroqCallTelemetry: vi.fn(async () => undefined),
}));
vi.mock('../../../../src/content/record/forensic-retry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/content/record/forensic-retry')>();
  return {
    ...actual,
    sendHighStakesForensicLog: vi.fn(async () => 'accepted' as const),
  };
});
vi.mock('../../../../src/core/lang-detect', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/core/lang-detect')>();
  return {
    ...actual,
    resolvePromptLanguage: vi.fn(async () => 'English'),
  };
});

import { _enqueueCommentForBatchForTesting as enqueueComment } from '../../../../src/content/index';
import { _resetViewportTrackerForTesting } from '../../../../src/content/post-path/viewport-tracker';
import { clearPendingCommentBatchState } from '../../../../src/content/comment-batch/queue';
import { sendHighStakesForensicLog } from '../../../../src/content/record/forensic-retry';
import { _resetForTests as resetFlushBudget } from '../../../../src/ai/global-flush-budget';
import type { FWMessage } from '../../../../src/types/messages';
import type { PostContent } from '../../../../src/types/post';

interface ProxyReply { status: number; content?: string; provider: string; served?: string }

let reply: ProxyReply;

function proxyResponse(r: ProxyReply): Response {
  const body = r.content === undefined
    ? { error: { code: 'content_policy' } }
    : {
      ...(r.served === undefined ? {} : { model: r.served }),
      choices: [{ message: { content: r.content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };
  const res = {
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    headers: { get: (name: string) => (name.toLowerCase() === 'x-fw-provider' ? r.provider : null) },
    json: () => Promise.resolve(body),
    clone: () => res,
  };
  return res as unknown as Response;
}

function makeComment(id: string, parentVideoId: string, text: string): PostContent {
  const host = document.createElement('ytd-comment-view-model');
  const textEl = document.createElement('div');
  textEl.id = 'content-text';
  textEl.textContent = text;
  host.appendChild(textEl);
  document.body.appendChild(host);
  return {
    id,
    text,
    author: 'someone',
    timestamp: '',
    platform: 'youtube',
    kind: 'top-comment',
    parentVideoId,
    depth: 1,
    domRef: new WeakRef(textEl),
  } as PostContent;
}

async function unjudgedRecordFor(post: PostContent): Promise<Extract<FWMessage, { type: 'CANCEL_LOG' }>['payload']> {
  enqueueComment(post);
  // Past the batch debounce and the client's one retry of a transient failure.
  await vi.advanceTimersByTimeAsync(5000);
  const cancel = vi
    .mocked(sendHighStakesForensicLog)
    .mock.calls.map((c) => c[0] as FWMessage)
    .find((m): m is Extract<FWMessage, { type: 'CANCEL_LOG' }> => m.type === 'CANCEL_LOG');
  expect(cancel).toBeDefined();
  expect(cancel!.payload.verdict).toBe('cancelled-batch-llm-failure');
  return cancel!.payload;
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.useFakeTimers();
  resetFlushBudget();
  _resetViewportTrackerForTesting();
  clearPendingCommentBatchState();
  vi.stubGlobal('fetch', vi.fn(async () => proxyResponse(reply)));
});

afterEach(() => {
  clearPendingCommentBatchState();
  _resetViewportTrackerForTesting();
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('an unjudged comment names the provider only when one answered', () => {
  it('the provider answered with nothing readable: the record names the provider and model it named', async () => {
    reply = { status: 200, content: 'this is not a verdict', provider: 'deepinfra', served: 'openai/gpt-oss-120b' };

    const payload = await unjudgedRecordFor(makeComment('yt-a-1', 'parent-a', 'I watched this twice and still liked the ending'));

    expect(payload.failureKind).toBe('provider-unparseable-json');
    expect(payload.aiProvider).toBe('deepinfra');
    expect(payload.aiModel).toBe('openai/gpt-oss-120b');
  });

  it('no provider answered: the record names none', async () => {
    reply = { status: 451, provider: 'deepinfra' };

    const payload = await unjudgedRecordFor(makeComment('yt-b-1', 'parent-b', 'I watched this twice and still liked the ending'));

    expect(payload.failureKind).toBe('content-policy');
    expect(payload.aiProvider).toBeUndefined();
  });
});
