/** @vitest-environment jsdom */
// The Teen and Child post judge, and the triage call before it, get the author's label and copies
// of the text and the caption context with the known handles replaced, and the names go back
// into the reason and the rewrite before anything reads them. The Adult path is unchanged.
//
// The pipeline, the frozen judge (core/neutralizer.ts) and the AI client all run for real; only
// fetch and the storage around them are stubbed, so the bodies read here are what would leave.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const SETTINGS = vi.hoisted(() => ({
  mode: 'teen',
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

import { process } from '../../../src/analysis/pipeline';
import { processingCache } from '../../../src/storage/cache';
import { _resetForTests as resetFlushBudget } from '../../../src/ai/global-flush-budget';
import type { PostContent } from '../../../src/types/post';

const AUTHOR = '@the_sharer';
const CONTEXT = '• @viewer_one: first reaction to this video\n• @viewer_two: second reaction, @the_sharer is right';
const POST_TEXT =
  'Anyone who still backs this plan is a fool, and @viewer_one and the rest of us are tired of carrying people who cannot think, says @the_sharer.';

function makePost(over: Partial<PostContent> = {}): PostContent {
  return {
    id: 'p1',
    text: POST_TEXT,
    author: AUTHOR,
    context: CONTEXT,
    timestamp: new Date().toISOString(),
    platform: 'tiktok',
    domRef: new WeakRef(document.createElement('div')),
    ...over,
  } as PostContent;
}

interface Sent { system: string; user: string }
let sent: Sent[];
let classify: Record<string, unknown>;

function proxyResponse(content: string): Response {
  const body = {
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
  const res = {
    ok: true, status: 200,
    headers: { get: (name: string) => (name.toLowerCase() === 'x-fw-provider' ? 'deepinfra' : null) },
    json: () => Promise.resolve(body),
    clone: () => res,
  };
  return res as unknown as Response;
}

beforeEach(() => {
  resetFlushBudget();
  sent = [];
  classify = {
    concerning: true, primary_concern: 'hostile shaming of @user_B and the reader by @user_A',
    severity: 7, confidence: 0.9, acts_on_reader: true, should_rewrite: true,
    neutralized_text: 'I think anyone who still backs this plan is mistaken, and @user_B and I are tired of the argument going nowhere.',
  };
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { messages: { content: string }[] };
    const system = body.messages[0].content;
    const user = body.messages[1].content;
    sent.push({ system, user });
    const triage = system.startsWith('You are a content safety triage classifier');
    return proxyResponse(triage ? 'yes' : JSON.stringify(classify));
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(processingCache.set).mockClear();
  SETTINGS.mode = 'teen';
});

describe('the Teen post judge reads labels and the family reads names', () => {
  it('neither the triage nor the judge body carries the author or the context handles', async () => {
    await process(makePost());
    expect(sent).toHaveLength(2);
    for (const { user } of sent) {
      expect(user).not.toContain('the_sharer');
      expect(user).not.toContain('viewer_one');
      expect(user).not.toContain('viewer_two');
      expect(user).toContain('• @user_B: first reaction to this video');
      expect(user).toContain('• @user_C: second reaction, @user_A is right');
      expect(user).toContain('and @user_B and the rest of us');
    }
    expect(sent[1].user).toMatch(/AUTHOR: [^\n]*@user_A/);
  });

  it('an emoji before a name, a TikTok shown name with spaces, and a name cut at 280 do not leave', async () => {
    const cut = ('a '.repeat(135) + '@viewer_two thanks').slice(0, 280);
    const context = [
      '\u2022 @\u{1F422} Example Name \u{1F422}: this is so fake',
      '\u2022 @Jess Smith: agreed with @viewer_two',
      `\u2022 @viewer_two: ${cut}`,
    ].join('\n');
    await process(makePost({ context, text: '\u{1F480} lol @the_sharer and Jess Smith are both lying to everyone here' }));
    expect(sent).toHaveLength(2);
    for (const { user } of sent) {
      expect(user).not.toContain('the_sharer');
      expect(user).not.toContain('Jess Smith');
      expect(user).not.toContain('Example Name');
      expect(user).not.toContain('viewer_t');
      expect(user).toContain('\u{1F480} lol @user_A and @user_C are both lying');
    }
  });

  it('the reason and the rewrite come back with the names, before the record and the screen', async () => {
    const result = await process(makePost());
    expect(result.action).toBe('neutralize');
    expect(result.neutralized?.rewrittenText).toBe(
      'I think anyone who still backs this plan is mistaken, and @viewer_one and I are tired of the argument going nowhere.',
    );
    expect(result.neutralized?.analysis.explanation).toBe('hostile shaming of @viewer_one and the reader by @the_sharer');
    const evidence = result.neutralized?.analysis.techniques.flatMap((t) => t.evidence) ?? [];
    expect(evidence.join(' ')).toContain('@viewer_one');
    expect(evidence.join(' ')).not.toContain('user_');
    // The cache write holds the restored rewrite, never a label.
    const cached = vi.mocked(processingCache.set).mock.calls.at(-1);
    expect(String(cached?.[2])).toContain('@viewer_one');
    expect(String(cached?.[2])).not.toContain('user_');
  });

  it('a severe hostile post whose rewrite still holds a label nobody got is hidden, as when the judge rejects its rewrite', async () => {
    // "personal attack" is what the judge maps to shame-attack; "shaming" alone maps to no technique.
    classify.primary_concern = 'personal attack on @user_B and the reader by @user_A';
    // The same verdict with a rewrite the judge itself rejects: the judge hides it.
    classify.neutralized_text = 'The user is wrong about this plan.';
    expect((await process(makePost({ id: 'p0' }))).action).toBe('hide');
    classify.neutralized_text = 'I think @user_Q is mistaken and the rest of us are tired of carrying people.';
    const result = await process(makePost());
    expect(result.action).toBe('hide');
    expect(result.neutralized).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('user_Q');
  });

  it('a milder flag whose rewrite is dropped for a label stays as a mark in Teen; Child (Strict) never asks, so it passes', async () => {
    classify.neutralized_text = 'I think @user_Q is mistaken and the rest of us are tired of carrying people.';
    classify.severity = 5;
    const teen = await process(makePost());
    expect(teen.action).toBe('mark');
    expect(teen.neutralized).toBeUndefined();
    SETTINGS.mode = 'child';
    const child = await process(makePost({ id: 'p2' }));
    // Strict makes no call (PLAN-A S2): the judge that produced the label above is never asked for
    // Child, so there is no verdict to fold on and no label to leak; a plain pass, nothing to redact.
    expect(child.action).toBe('pass');
    expect(JSON.stringify(child)).not.toContain('user_Q');
  });

  it("a reason and a rewrite that quote a caption comment's \"USER A\" keep those words, and the name still comes back", async () => {
    // @creator is @user_A and viewer_one @user_B; the comment's own capitals are not a label.
    classify.primary_concern = 'hostile shaming of the reader, echoing "IS THIS USER A BOT" at @user_B';
    classify.neutralized_text = 'I think anyone who still backs this plan is mistaken, and "IS THIS USER A BOT" is not an answer, @user_B.';
    const result = await process(makePost({
      id: 'p3',
      author: '@creator',
      context: '\u2022 @viewer_one: IS THIS USER A BOT',
      text: 'Anyone who still backs this plan is a fool, and the rest of us are tired of carrying people who cannot think, says @creator.',
    }));
    expect(sent[1].user).toContain('\u2022 @user_B: IS THIS USER A BOT');
    expect(result.action).toBe('neutralize');
    expect(result.neutralized?.analysis.explanation).toBe(
      'hostile shaming of the reader, echoing "IS THIS USER A BOT" at @viewer_one',
    );
    expect(result.neutralized?.rewrittenText).toBe(
      'I think anyone who still backs this plan is mistaken, and "IS THIS USER A BOT" is not an answer, @viewer_one.',
    );
  });

  it('a caption that names its author bare gets the bare name back in the rewrite', async () => {
    classify.neutralized_text = '@user_A here, and anyone who still backs this plan may be mistaken.';
    const result = await process(makePost({
      author: '@dancequeen',
      context: undefined,
      text: 'dancequeen here, and anyone who still backs this plan is a fool who cannot think at all.',
    }));
    expect(sent[1].user).not.toContain('dancequeen');
    expect(result.action).toBe('neutralize');
    expect(result.neutralized?.rewrittenText).toBe('dancequeen here, and anyone who still backs this plan may be mistaken.');
  });

  it('a post whose page shows no author still says unknown, and the text goes as it is', async () => {
    await process(makePost({ author: '', context: undefined }));
    expect(sent[1].user).toMatch(/AUTHOR: [^\n]*unknown/);
    expect(sent[1].user).toContain('@the_sharer');
  });

  it('the Adult judge is unchanged: the text goes as written and no author line exists', async () => {
    SETTINGS.mode = 'adult';
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { messages: { content: string }[] };
      sent.push({ system: body.messages[0].content, user: body.messages[1].content });
      return proxyResponse(JSON.stringify({ charged: false, family: 'none', severity: 0, effect: 'inert', intent: 'none' }));
    }));
    await process(makePost());
    expect(sent).toHaveLength(1);
    expect(sent[0].user).toContain('@the_sharer');
    expect(sent[0].user).not.toContain('user_');
    expect(sent[0].user).not.toContain('AUTHOR:');
  });
});
