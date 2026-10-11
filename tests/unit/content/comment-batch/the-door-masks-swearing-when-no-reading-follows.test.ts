/** @vitest-environment jsdom */
// The swear mask runs at the door when no reading will follow (11 Oct 2026, the Tester's full test, build fwbid-mv3uqo2d).
// Strict promises "masks swearing" with the switch locked on, and Relaxed with Mask swearing on and no key says it stars
// out ordinary swear words; on YouTube 4 of 4 swearing comments were left as written. The mask was collected inside the
// batch after scoring, and a batch is not a given: with no key it fails and returns first, at Strict nothing is ever
// asked, and the failed batch's 30 s cooldown drops every comment that arrives meanwhile. A mask needs no reading, so it
// runs the moment the extractor hands a comment over, exactly as the household list and the threat rules do (65ecbde4).
// Here the batch path is dead on purpose (a cooldown, and a reader that must not be asked), so only the door can be the
// reason a comment ends starred. With a reading allowed the batch keeps the mask, because the reading may rewrite the
// comment and a text starred first would no longer match the one it scored.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = vi.hoisted(() => ({
  mode: 'adult' as 'child' | 'teen' | 'adult',
  soften: true,
  reading: false,
  added: [] as Array<Record<string, unknown>>,
  scored: 0,
}));

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    getSettings: vi.fn(async () => ({
      mode: state.mode, uiLanguage: 'en', outputLanguage: 'auto', dailyCap: 200, strictLanguage: state.soften,
      features: {},
    })),
    isFeatureEnabled: vi.fn(() => state.soften),
    isCommentRewriteEnabled: vi.fn(() => true),
  };
});
vi.mock('../../../../src/storage/license', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/storage/license')>()),
  getLicense: vi.fn(async () => ({ tier: 'free', secret: '' })),
}));
vi.mock('../../../../src/ai/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/ai/client')>()),
  readingAllowed: vi.fn(async () => state.reading),
}));
vi.mock('../../../../src/core/lang-detect', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/core/lang-detect')>()),
  resolvePromptLanguage: vi.fn(async () => 'English'),
}));
vi.mock('../../../../src/analysis/comment-batch-scorer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/analysis/comment-batch-scorer')>();
  return {
    ...actual,
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
const PARENT = 'yt-vid-mask';

function makeComment(text: string, ownId?: string): { post: PostContent; textEl: HTMLElement } {
  const id = ownId ?? `yt-mask-${++n}`;
  const host = document.createElement('ytd-comment-view-model');
  const textEl = document.createElement('div');
  textEl.id = 'content-text';
  textEl.textContent = text;
  host.appendChild(textEl);
  document.body.appendChild(host);
  const post = {
    id, text, author: 'some-user', timestamp: '', platform: 'youtube', kind: 'top-comment', parentVideoId: PARENT, depth: 1,
    domRef: new WeakRef(textEl),
  } as unknown as PostContent;
  return { post, textEl };
}

async function detect(post: PostContent): Promise<void> {
  await _onPostDetectedForTesting(post, performance.now());
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 5));
}

const recordsFor = (text: string): ForensicRecord[] =>
  state.added.filter((r) => r.kind === 'comment' && r.originalText === text) as unknown as ForensicRecord[];

const SWEAR = 'This is fucking ridiculous, honestly';
const SWEAR_2 = 'What a shit take from the host';

beforeEach(() => {
  state.mode = 'adult';
  state.soften = true;
  state.reading = false;
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

describe('with no reading to follow, the mask is applied at the door', () => {
  it.each([SWEAR, SWEAR_2])('%s: starred on the page, recorded as a mask, nobody asked', async (line) => {
    const { post, textEl } = makeComment(line);
    await detect(post);
    expect(textEl.textContent, 'the swear word is starred').toMatch(/\*/);
    expect(textEl.textContent).not.toMatch(/fuck|shit/i);
    expect(textEl.textContent, 'and the rest of the words are untouched').toContain(line.split(' ').slice(-1)[0]);
    const records = recordsFor(line);
    expect(records, 'one record').toHaveLength(1);
    expect(records[0].aiSource, 'a rule, so no reading is claimed').toBe('rules');
    expect((records[0] as unknown as { detectionMode?: string }).detectionMode).toBe('profanity-mask');
    expect((records[0].decision as DecisionBlock).applied).toBe('mask');
    expect(records[0].neutralizedText).toBe(textEl.textContent);
    expect(state.scored, 'the reader was never asked').toBe(0);
    expect(pendingBatches.get(PARENT)?.posts ?? [], 'and the comment did not join a batch').toHaveLength(0);
  });

  it('the same comment handed over again on a fresh node is starred again and recorded once', async () => {
    const first = makeComment(SWEAR, 'yt-mask-same');
    await detect(first.post);
    const second = makeComment(SWEAR, 'yt-mask-same');
    await detect(second.post);
    expect(second.textEl.textContent).toMatch(/\*/);
    expect(recordsFor(SWEAR), 'one record for the one comment').toHaveLength(1);
  });

  it('Strict: starred, and no cover is left behind', async () => {
    state.mode = 'child';
    setMode('child');
    const { post, textEl } = makeComment(SWEAR);
    await detect(post);
    expect(textEl.textContent).toMatch(/\*/);
    expect(recordsFor(SWEAR)).toHaveLength(1);
    expect(activeCount(), 'the provisional cover came off').toBe(0);
  });

  it('a comment that does not swear is left alone and goes on to the batch path', async () => {
    const { post, textEl } = makeComment('lovely weather today');
    await detect(post);
    expect(textEl.textContent).toBe('lovely weather today');
    expect(recordsFor(post.text)).toHaveLength(0);
  });
});

describe('where the mask is not the door\'s to apply', () => {
  it('with the switch off nothing is starred', async () => {
    state.soften = false;
    const { post, textEl } = makeComment(SWEAR);
    await detect(post);
    expect(textEl.textContent).toBe(SWEAR);
    expect(recordsFor(SWEAR)).toHaveLength(0);
  });

  it('with a reading to follow the batch keeps the mask: the door leaves the words as served', async () => {
    state.reading = true;
    const { post, textEl } = makeComment(SWEAR);
    await detect(post);
    expect(textEl.textContent).toBe(SWEAR);
    expect(recordsFor(SWEAR)).toHaveLength(0);
  });

  it('a comment the rules escalate (an identity slur, a threat) is not starred: the hide or mark is theirs', async () => {
    for (const line of ['I know where you live you fucking idiot, I will find you', 'fucking faggots everywhere in this video']) {
      const { post, textEl } = makeComment(line);
      await detect(post);
      expect(textEl.textContent, line).not.toMatch(/\*{2}/);
    }
  });

  it('a row that moved before the mask could land is not claimed: no record says it was starred', async () => {
    const { post, textEl } = makeComment(SWEAR);
    textEl.remove();
    await detect(post);
    expect(recordsFor(SWEAR).filter((r) => (r.decision as DecisionBlock | undefined)?.applied === 'mask')).toHaveLength(0);
  });
});
