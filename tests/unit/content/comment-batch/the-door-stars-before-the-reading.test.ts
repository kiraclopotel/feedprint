/** @vitest-environment jsdom */
// With a key the swear mask used to wait for the reading batch (the Tester's recheck, 12 Oct 2026, build mv4sh6hi): the
// words were starred 6.7 s to 13.5 s after the comment appeared, and when every reading call answered 500 none of three
// swearing lines was starred in 30 s. The mask is a rule, so it now runs at the door even when a reading follows, and the
// reading goes on as before. Here a reading IS allowed, and the real flush runs (fake timers; only the model calls and the
// record's delivery are stubbed), so what is pinned is the whole hand-over: the stars are on the page before the batch
// answers; the batch still finds the row by the words it scored and rewrites, hides or re-stars it; and a reading that
// cannot finish leaves the stars and writes the mask's record, never a cancel that says nothing changed.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Behaviour = 'pass' | 'rewrite' | 'hide' | 'failed' | 'throws';

const state = vi.hoisted(() => ({
  mode: 'adult' as 'child' | 'teen' | 'adult',
  behaviour: 'pass' as Behaviour,
  scored: 0,
  sent: [] as Array<{ type: string; payload: Record<string, unknown> }>,
}));

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    getSettings: vi.fn(async () => ({
      mode: state.mode, uiLanguage: 'en', outputLanguage: 'auto', dailyCap: 200, strictLanguage: true, features: {},
    })),
    isFeatureEnabled: vi.fn(() => true),
    isCommentRewriteEnabled: vi.fn(() => true),
  };
});
vi.mock('../../../../src/storage/license', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/storage/license')>()),
  getLicense: vi.fn(async () => ({ tier: 'pro', secret: 'a-key' })),
}));
vi.mock('../../../../src/ai/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/ai/client')>()),
  // A key is stored and the level reads: a reading follows every comment.
  readingAllowed: vi.fn(async () => true),
}));
vi.mock('../../../../src/core/lang-detect', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/core/lang-detect')>()),
  resolvePromptLanguage: vi.fn(async () => 'English'),
}));
vi.mock('../../../../src/ai/neutralize-only', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/ai/neutralize-only')>()),
  neutralizeText: vi.fn(async () => 'I do not agree with this at all, honestly.'),
}));
vi.mock('../../../../src/analysis/comment-batch-scorer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/analysis/comment-batch-scorer')>();
  const environment = {
    label: 'mixed', negativePct: 50, positivePct: 0, neutralPct: 50, dominantTechnique: 'none', toxicityScore: 3,
    slurPrevalencePct: 0, authorRecidivism: 'none', discourseQuality: 'poor', algorithmicAmplification: 'unknown',
  };
  return {
    ...actual,
    scoreBatch: vi.fn(async () => {
      state.scored++;
      if (state.behaviour === 'throws') throw new Error('the reading service is down');
      if (state.behaviour === 'failed') {
        return {
          comments: [], environment, batchSize: 1, failed: true, generationTimeMs: 40, truncatedIndices: [],
          commentHarmFloors: [undefined], failureKind: 'transient-http', retryAfterMs: 1000,
        } as unknown as import('../../../../src/analysis/comment-batch-scorer').BatchScoreResult;
      }
      const verdict = state.behaviour === 'pass'
        ? { technique: 'none', severity: 0, sentiment: 'neutral', confidence: 0.9 }
        : state.behaviour === 'hide'
          ? { technique: 'shame-attack', severity: 8, sentiment: 'negative', confidence: 0.9, action: 'hide' }
          : { technique: 'shame-attack', severity: 6, sentiment: 'negative', confidence: 0.9, neutralizedText: 'I do not agree with this at all, honestly.' };
      return {
        comments: [{ index: 1, ...verdict }], environment, batchSize: 1, failed: false, generationTimeMs: 40, truncatedIndices: [],
        commentHarmFloors: [undefined],
      } as unknown as import('../../../../src/analysis/comment-batch-scorer').BatchScoreResult;
    }),
    scoreRoom: vi.fn(async () => null),
  };
});
vi.mock('../../../../src/content/record/forensic-retry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/content/record/forensic-retry')>();
  return {
    ...actual,
    sendHighStakesForensicLog: vi.fn(async (msg: { type: string; payload: Record<string, unknown> }) => {
      state.sent.push({ type: msg.type, payload: msg.payload });
      return 'accepted' as const;
    }),
  };
});

import {
  _onPostDetectedForTesting,
  _setQueueForTesting,
  _setChildProtectionModeForTesting as setMode,
} from '../../../../src/content/index';
import { _resetViewportTrackerForTesting } from '../../../../src/content/post-path/viewport-tracker';
import { clearPendingCommentBatchState, pendingBatches } from '../../../../src/content/comment-batch/queue';
import { _resetForensicDedupForTesting } from '../../../../src/content/record/forensic-gate';
import { _clearSessionVerdictCachesOnModeChangeForTesting as clearSessionCaches } from '../../../../src/content/post-path/late-verdict-cache';
import { verifyAnchorMatch } from '../../../../src/forensics/anchor-revalidation';
import { computeAnchorKey } from '../../../../src/core/anchor-key';
import { buildCommentEntryForRoot, swapCommentTextInPlace } from '../../../../src/content/protection/comment-overlay';
import { doorStarStanding, restoreScoredText } from '../../../../src/core/door-star';
import type { PostContent } from '../../../../src/types/post';
import type { ProcessingQueue } from '../../../../src/content/post-path/post-queue';

let n = 0;
const SWEAR = 'This is fucking ridiculous, honestly';

function makeComment(text: string): { post: PostContent; host: HTMLElement; textEl: HTMLElement; parent: string } {
  const id = `yt-star-${++n}`;
  const parent = `yt-vid-star-${n}`;
  const host = document.createElement('ytd-comment-view-model');
  const textEl = document.createElement('div');
  textEl.id = 'content-text';
  textEl.textContent = text;
  host.appendChild(textEl);
  document.body.appendChild(host);
  const post = {
    id, text, author: 'some-user', timestamp: '', platform: 'youtube', kind: 'top-comment', parentVideoId: parent, depth: 1,
    domRef: new WeakRef(textEl),
  } as unknown as PostContent;
  return { post, host, textEl, parent };
}

async function detect(post: PostContent): Promise<void> {
  await _onPostDetectedForTesting(post, performance.now());
  await vi.advanceTimersByTimeAsync(10);
}

/** The records of this comment, whatever kind, in the order they were handed over. */
const recordsOf = (text: string): Array<{ type: string; payload: Record<string, unknown> }> =>
  state.sent.filter((m) => m.payload.originalText === text && m.type !== 'ENVIRONMENT_LOG');

beforeEach(() => {
  vi.useFakeTimers();
  state.mode = 'adult';
  state.behaviour = 'pass';
  state.scored = 0;
  state.sent.length = 0;
  document.body.innerHTML = '';
  clearPendingCommentBatchState();
  _resetForensicDedupForTesting();
  clearSessionCaches();
  _resetViewportTrackerForTesting();
  _setQueueForTesting({ enqueue: vi.fn(() => true) } as unknown as ProcessingQueue);
  setMode('adult');
});
afterEach(() => {
  setMode('adult');
  clearPendingCommentBatchState();
  _resetViewportTrackerForTesting();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('with a reading to follow, the swearing is starred before the reading answers', () => {
  it('the stars are on the page at once, the comment waits in the batch, and nothing is recorded yet', async () => {
    const { post, textEl, parent } = makeComment(SWEAR);
    await detect(post);
    expect(textEl.textContent, 'starred before the batch has asked anyone').toMatch(/\*{3,}/);
    expect(textEl.textContent).not.toMatch(/fuck/i);
    expect(state.scored, 'the reading has not been asked yet').toBe(0);
    expect(pendingBatches.get(parent)?.posts ?? [], 'the comment is waiting for its reading').toHaveLength(1);
    expect(recordsOf(SWEAR), 'no record of a mask that a reading may still replace').toHaveLength(0);
  });

  it('the batch still finds the row by the words it scored: the anchor matches and the row reads as the original', async () => {
    const { post, textEl } = makeComment(SWEAR);
    await detect(post);
    expect(textEl.textContent).toMatch(/\*/);
    expect(verifyAnchorMatch(computeAnchorKey(post), post, post.domRef)).toBe('match');
    expect(doorStarStanding(textEl)).not.toBeNull();
    const entry = buildCommentEntryForRoot(textEl, 'youtube');
    expect(entry?.text, 'the row reads as the comment it was').toBe(SWEAR);
    expect(textEl.textContent, 'while the page still shows the stars').toMatch(/\*/);
  });

  it('a page that replaced the stars with other words is no longer the comment that was scored', async () => {
    const { post, textEl } = makeComment(SWEAR);
    await detect(post);
    textEl.textContent = 'A different comment now sits in this node';
    expect(doorStarStanding(textEl)).toBeNull();
    expect(verifyAnchorMatch(computeAnchorKey(post), post, post.domRef)).toBe('dom-recycled');
  });

  it('a swap that replaces the stars ends the tolerance: the row is then the rewrite, as for any other row', async () => {
    const { post, textEl } = makeComment(SWEAR);
    await detect(post);
    const entry = buildCommentEntryForRoot(textEl, 'youtube')!;
    swapCommentTextInPlace(entry, 'something calmer');
    expect(doorStarStanding(textEl)).toBeNull();
    expect(buildCommentEntryForRoot(textEl, 'youtube'), 'a rewritten row is left alone by later walks').toBeNull();
  });
});

describe('what the batch does with a comment the door starred', () => {
  it('a passing comment that swears: stays starred, and one record says a rule starred it', async () => {
    state.behaviour = 'pass';
    const { post, textEl } = makeComment(SWEAR);
    await detect(post);
    await vi.advanceTimersByTimeAsync(2600);
    expect(state.scored).toBe(1);
    expect(textEl.textContent).toMatch(/\*{3,}/);
    const records = recordsOf(SWEAR);
    expect(records, 'one record').toHaveLength(1);
    expect(records[0].type).toBe('FORENSIC_LOG');
    expect(records[0].payload.aiSource).toBe('rules');
    expect(records[0].payload.detectionMode).toBe('profanity-mask');
    expect(records[0].payload.neutralizedText).toBe(textEl.textContent);
  });

  it('a flagged comment the reading rewrites: the rewrite replaces the stars, and the record is the reading\'s', async () => {
    state.mode = 'teen';
    setMode('teen');
    state.behaviour = 'rewrite';
    const { post, textEl } = makeComment(SWEAR);
    await detect(post);
    expect(textEl.textContent, 'starred while it waits').toMatch(/\*/);
    await vi.advanceTimersByTimeAsync(2600);
    expect(textEl.textContent).toContain('I do not agree with this at all, honestly.');
    const records = recordsOf(SWEAR);
    expect(records, 'one record').toHaveLength(1);
    expect(records[0].payload.aiSource, 'a reading wrote it').not.toBe('rules');
    expect(records[0].payload.neutralizedText).toBe('I do not agree with this at all, honestly.');
  });

  it('a comment the reading hides: the hide lands on the starred row and is recorded', async () => {
    state.behaviour = 'hide';
    const { post, host, textEl } = makeComment(SWEAR);
    await detect(post);
    expect(textEl.textContent).toMatch(/\*/);
    await vi.advanceTimersByTimeAsync(2600);
    expect(textEl.textContent, 'the stars gave way to the hide: neither the words nor the stars remain').not.toMatch(/fuck|\*{3,}/i);
    expect(host.textContent ?? '').not.toMatch(/fuck/i);
    const records = recordsOf(SWEAR);
    expect(records.map((r) => r.type), 'one record, and it is the hide').toEqual(['FORENSIC_LOG']);
    expect((records[0].payload.decision as { applied: string }).applied).toBe('hide');
  });
});

describe('a reading that cannot finish leaves the stars and records the mask', () => {
  it.each(['failed', 'throws'] as const)('the reading %s: starred, one record by the rules, no cancel', async (behaviour) => {
    state.behaviour = behaviour;
    const { post, textEl } = makeComment(SWEAR);
    await detect(post);
    await vi.advanceTimersByTimeAsync(2600);
    expect(state.scored).toBe(1);
    expect(textEl.textContent, 'the words are still starred').toMatch(/\*{3,}/);
    const records = recordsOf(SWEAR);
    expect(records.map((r) => r.type), 'one record, and it is not a cancel').toEqual(['FORENSIC_LOG']);
    expect(records[0].payload.aiSource).toBe('rules');
    expect(records[0].payload.detectionMode).toBe('profanity-mask');
    expect(records[0].payload.neutralizedText).toBe(textEl.textContent);
  });

  it('a comment the page took away before the reading failed is not claimed as starred: it is a cancel, as before', async () => {
    state.behaviour = 'failed';
    const { post, host } = makeComment(SWEAR);
    await detect(post);
    host.remove();
    await vi.advanceTimersByTimeAsync(2600);
    const records = recordsOf(SWEAR);
    expect(records.filter((r) => r.type === 'FORENSIC_LOG' && r.payload.detectionMode === 'profanity-mask')).toHaveLength(0);
  });

  it('a comment with no swearing is untouched and its failed reading is a cancel, as before', async () => {
    state.behaviour = 'failed';
    const { post, textEl } = makeComment('lovely weather today, thanks for the video');
    await detect(post);
    expect(textEl.textContent).toBe('lovely weather today, thanks for the video');
    await vi.advanceTimersByTimeAsync(2600);
    const records = recordsOf(post.text);
    expect(records.map((r) => r.type)).toEqual(['CANCEL_LOG']);
  });
});

// The viewport gate gives a comment back for reading again when it was off screen at the flush, and the extractor then reads
// the page, which holds the door's stars. Read as it stands that is a second comment with starred words, judged and
// recorded as such ("pass", nothing to mask) while the comment that was starred is never recorded (the Tester's record
// check of mv4tym2p, 12 Oct 2026: "shit" starred on screen in three runs, recorded in none).
describe('a comment read again from a row that shows the door\'s stars is the comment that was starred', () => {
  it('its words go back to the ones the stars replaced, so it is judged and recorded as that comment', async () => {
    const { post, textEl } = makeComment(SWEAR);
    await detect(post);
    expect(textEl.textContent).toMatch(/\*{3,}/);
    // What the extractor hands over the second time: the same row and its id, the words the page now shows.
    const again = { ...post, text: textEl.textContent ?? '' } as PostContent;
    expect(again.text).not.toBe(SWEAR);
    expect(restoreScoredText(again)).toBe(true);
    expect(again.text).toBe(SWEAR);
  });

  it('is not touched when the row shows other words, or no star was written', async () => {
    const { post, textEl } = makeComment(SWEAR);
    await detect(post);
    const other = { ...post, text: 'A different comment now sits in this node' } as PostContent;
    expect(restoreScoredText(other)).toBe(false);
    expect(other.text).toBe('A different comment now sits in this node');
    const plain = makeComment('lovely weather today, thanks for the video');
    expect(restoreScoredText({ ...plain.post })).toBe(false);
    expect(textEl.textContent).toMatch(/\*/);
  });

  it('end to end: the comment read again with its stars is recorded as the mask of the original words', async () => {
    state.behaviour = 'failed';
    const { post, textEl, parent } = makeComment(SWEAR);
    await detect(post);
    // The first read is dropped unjudged (off screen at the flush); what comes back is the page as it stands.
    pendingBatches.get(parent)!.posts.splice(0);
    const again = { ...post, text: textEl.textContent ?? '' } as PostContent;
    await detect(again);
    expect(again.text).toBe(SWEAR);
    await vi.advanceTimersByTimeAsync(2600);
    const forStars = state.sent.filter((m) => String(m.payload.originalText ?? '').includes('*') && m.type !== 'ENVIRONMENT_LOG');
    expect(forStars, 'nothing is recorded under the starred words').toHaveLength(0);
    const records = recordsOf(SWEAR);
    expect(records.map((r) => r.type)).toEqual(['FORENSIC_LOG']);
    expect(records[0].payload.detectionMode).toBe('profanity-mask');
  });
});
