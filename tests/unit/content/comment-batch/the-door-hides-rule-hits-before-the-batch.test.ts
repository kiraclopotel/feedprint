/** @vitest-environment jsdom */
// A rule hides a comment at the door, not after a batch (11 Oct 2026, the Tester's fourth pass on a real YouTube page).
// With "trump" on the household list, 2 of 34 comments holding it were hidden on a fresh video; the same threat lines
// that were hidden in top comments stayed visible in opened replies. The check ran inside the batch flush, and a
// batch is not a given: the free tier's failed batch puts the video into a 30 s cooldown that drops every comment
// that arrives meanwhile, and a budget hold defers the flush. A rule needs none of that, so it runs the moment the
// extractor hands a comment over. Here the batch path is dead on purpose (a cooldown, and a reader that must not be
// asked), so only the door can be the reason a comment ends hidden.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = vi.hoisted(() => ({
  mode: 'adult' as 'child' | 'teen' | 'adult',
  words: ['trump'] as string[],
  added: [] as Array<Record<string, unknown>>,
  scored: 0,
}));

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    getSettings: vi.fn(async () => ({
      mode: state.mode, uiLanguage: 'en', outputLanguage: 'auto', dailyCap: 200, strictLanguage: true,
      features: state.words.length
        ? { 'parent-blocklist': { enabled: true, value: { words: state.words, phrases: [], accounts: [] } } }
        : {},
    })),
    isFeatureEnabled: vi.fn(() => true),
    isCommentRewriteEnabled: vi.fn(() => true),
  };
});
vi.mock('../../../../src/core/lang-detect', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/core/lang-detect')>()),
  resolvePromptLanguage: vi.fn(async () => 'English'),
}));
vi.mock('../../../../src/analysis/comment-batch-scorer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/analysis/comment-batch-scorer')>();
  return {
    ...actual,
    // Nobody may be asked: a rule hit must not wait for, or spend, a reading.
    scoreBatch: vi.fn(async () => { state.scored++; throw new Error('the reader must not be asked'); }),
    scoreRoom: vi.fn(async () => null),
  };
});
vi.mock('../../../../src/forensics/store', () => ({
  addRecord: vi.fn(async (r: Record<string, unknown>) => { state.added.push(r); }),
  getChainState: vi.fn(async () => ({ nextPosition: 0, prevRecordHash: '' })),
}));
vi.mock('../../../../src/forensics/hasher', () => ({ sha256: vi.fn(async (s: string) => `hash-of-len-${s.length}`) }));
vi.mock('../../../../src/forensics/signing', () => ({
  signHash: vi.fn(async () => 'stub-signature'),
  getPublicKeyFingerprint: vi.fn(async () => 'stub-fp'),
}));
vi.mock('../../../../src/content/record/forensic-retry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/content/record/forensic-retry')>();
  const logger = await import('../../../../src/forensics/logger');
  return {
    ...actual,
    sendHighStakesForensicLog: vi.fn(async (msg: { type: string; payload: never }) => {
      if (msg.type === 'FORENSIC_LOG') await logger.logForensicEvent(msg.payload);
      else if (msg.type === 'PASS_LOG') await logger.logPassEvent(msg.payload);
      else if (msg.type === 'BLOCKED_LOG') await logger.logBlockedEvent(msg.payload);
      else if (msg.type === 'CANCEL_LOG') await logger.logCancelEvent(msg.payload);
      return 'accepted' as const;
    }),
  };
});

import {
  _onPostDetectedForTesting,
  _setQueueForTesting,
  _setChildProtectionModeForTesting as setMode,
  _childProtectionActiveCountForTesting as activeCount,
} from '../../../../src/content/index';
import { _resetViewportTrackerForTesting, setParentCooldown } from '../../../../src/content/post-path/viewport-tracker';
import { clearPendingCommentBatchState, pendingBatches } from '../../../../src/content/comment-batch/queue';
import { _resetForensicDedupForTesting } from '../../../../src/content/record/forensic-gate';
import { _clearSessionVerdictCachesOnModeChangeForTesting as clearSessionCaches } from '../../../../src/content/post-path/late-verdict-cache';
import type { DecisionBlock, ForensicRecord } from '../../../../src/types/forensic';
import type { PostContent } from '../../../../src/types/post';
import type { ProcessingQueue } from '../../../../src/content/post-path/post-queue';

let n = 0;
const PARENT = 'yt-vid-door';

function makeComment(text: string, kind: 'top-comment' | 'reply' = 'top-comment', ownId?: string): { post: PostContent; textEl: HTMLElement } {
  const id = ownId ?? `yt-door-${++n}`;
  const host = document.createElement('ytd-comment-view-model');
  const textEl = document.createElement('div');
  textEl.id = 'content-text';
  textEl.textContent = text;
  host.appendChild(textEl);
  document.body.appendChild(host);
  const post = {
    id, text, author: 'some-user', timestamp: '', platform: 'youtube', kind, parentVideoId: PARENT, depth: kind === 'reply' ? 2 : 1,
    domRef: new WeakRef(textEl),
  } as unknown as PostContent;
  return { post, textEl };
}

async function detect(post: PostContent): Promise<void> {
  await _onPostDetectedForTesting(post, performance.now());
  // The record goes through the logger's own awaits.
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 5));
}

const recordsFor = (text: string): ForensicRecord[] =>
  state.added.filter((r) => r.kind === 'comment' && r.originalText === text) as unknown as ForensicRecord[];

beforeEach(() => {
  state.mode = 'adult';
  state.words = ['trump'];
  state.added.length = 0;
  state.scored = 0;
  document.body.innerHTML = '';
  clearPendingCommentBatchState();
  _resetForensicDedupForTesting();
  clearSessionCaches();
  _resetViewportTrackerForTesting();
  _setQueueForTesting({ enqueue: vi.fn(() => true) } as unknown as ProcessingQueue);
  setMode('adult');
  // The free tier's failed batch leaves the video in a cooldown that drops every comment that arrives next.
  setParentCooldown(PARENT, 30_000);
});
afterEach(() => {
  setMode('adult');
  clearPendingCommentBatchState();
  _resetViewportTrackerForTesting();
  document.body.innerHTML = '';
});

describe('a household word hides a comment at the door', () => {
  for (const kind of ['top-comment', 'reply'] as const) {
    it(`${kind}: hidden and recorded with the batch path dead`, async () => {
      const { post } = makeComment('Trump is going to win again', kind);
      await detect(post);
      const records = recordsFor(post.text);
      expect(records, 'one record').toHaveLength(1);
      const decision = records[0].decision as DecisionBlock;
      expect(records[0].verdict).toBe('flagged-hidden');
      expect(decision.applied).toBe('hide');
      expect(decision.rails?.[0]?.name).toBe('blocklist');
      expect(decision.rails?.[0]?.match).toBe('trump');
      expect(records[0].aiSource, 'a rule, so no reading is claimed').toBe('rules');
      expect(records[0].kind).toBe('comment');
      expect(state.scored, 'the reader was never asked').toBe(0);
      expect(pendingBatches.get(PARENT)?.posts ?? [], 'and the comment did not join a batch').toHaveLength(0);
    });
  }

  it('the same words seen again on a fresh node are hidden again and recorded once', async () => {
    // A virtualised list hands the same comment over again on a new node: the same id, the same words.
    const first = makeComment('Trump is going to win again', 'top-comment', 'yt-c-same');
    await detect(first.post);
    const second = makeComment('Trump is going to win again', 'top-comment', 'yt-c-same');
    await detect(second.post);
    expect(recordsFor(first.post.text), 'one record for the one comment').toHaveLength(1);
    expect(state.scored).toBe(0);
  });

  it('Child: hidden, and no cover is left behind', async () => {
    state.mode = 'child';
    setMode('child');
    const { post } = makeComment('Trump is going to win again');
    await detect(post);
    expect(recordsFor(post.text)).toHaveLength(1);
    expect(activeCount(), 'the provisional cover is committed, not left up').toBe(0);
  });
});

describe('a threat hides at the door with no list and no reader', () => {
  it.each([
    'I know where you live and I will find you',
    'Nobody at school likes you, just delete your account',
  ])('%s', async (line) => {
    state.words = [];
    const { post } = makeComment(line);
    await detect(post);
    const records = recordsFor(line);
    expect(records, 'one record').toHaveLength(1);
    expect(records[0].verdict).toBe('flagged-hidden');
    expect(records[0].aiSource).toBe('rules');
    expect(records[0].techniques.length, 'it names the technique the rule found').toBe(1);
    expect(state.scored).toBe(0);
  });
});

describe('controls: what no rule catches still goes to the batch', () => {
  it('an ordinary comment is not hidden and joins the batch (here: refused by the cooldown, as before)', async () => {
    const { post } = makeComment('lovely weather today');
    await detect(post);
    expect(recordsFor(post.text)).toHaveLength(0);
    expect(state.scored).toBe(0);
  });

  it('with the list empty a word does nothing', async () => {
    state.words = [];
    const { post } = makeComment('Trump is going to win again');
    await detect(post);
    expect(recordsFor(post.text)).toHaveLength(0);
  });

  it('a longer word that only contains the listed one is not a match', async () => {
    state.words = ['ass'];
    const { post } = makeComment('this class is great');
    await detect(post);
    expect(recordsFor(post.text)).toHaveLength(0);
  });

  it('a cheerful near-miss of a threat is left alone', async () => {
    state.words = [];
    const { post } = makeComment('congrats, I know where you live now, we are neighbours!');
    await detect(post);
    expect(recordsFor(post.text)).toHaveLength(0);
  });
});
