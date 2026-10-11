/** @vitest-environment jsdom */
// The household's own list reaches comments (11 Oct 2026, the night walk). With "trump" on Feedprint's list a YouTube
// watch page swapped the video's title for "Hidden: on this household's block list" and left all 50 comments holding
// the word on screen: the list was checked only in the per-post pipeline, and a batched comment never goes there. The
// real flush and the real logger run here; the batch scorer is replaced by a reading that finds nothing wrong, or by a
// failed batch (what the free tier gets), so only the household's rule can be the reason a comment ends hidden.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = vi.hoisted(() => ({
  mode: 'adult' as 'child' | 'teen' | 'adult',
  failed: false,
  words: ['trump'] as string[],
  accounts: [] as string[],
  added: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    getSettings: vi.fn(async () => ({
      mode: state.mode, outputLanguage: 'auto', dailyCap: 200, strictLanguage: true,
      features: state.words.length || state.accounts.length
        ? { 'parent-blocklist': { enabled: true, value: { words: state.words, phrases: [], accounts: state.accounts } } }
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
vi.mock('../../../../src/ai/neutralize-only', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/ai/neutralize-only')>()),
  neutralizeText: vi.fn(async () => 'a calmer way of saying it'),
}));
vi.mock('../../../../src/analysis/comment-batch-scorer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/analysis/comment-batch-scorer')>();
  return {
    ...actual,
    // The reading finds nothing wrong with the one comment, or the batch fails the way the free tier's does.
    scoreBatch: vi.fn(async () => ({
      comments: [{
        index: 1, technique: 'genuine-opinion', severity: 1, sentiment: 'neutral', confidence: 0.9, reason: '',
      }],
      environment: {
        label: 'healthy-discussion', negativePct: 0, positivePct: 0, neutralPct: 100, dominantTechnique: 'none', toxicityScore: 0,
        slurPrevalencePct: 0, authorRecidivism: 'none', discourseQuality: 'good', algorithmicAmplification: 'unknown',
      },
      batchSize: 1, failed: state.failed, generationTimeMs: 100, truncatedIndices: [],
      ...(state.failed ? { failureKind: 'cap-exhausted', cap: 'tier-free' } : {}),
    } as unknown as import('../../../../src/analysis/comment-batch-scorer').BatchScoreResult)),
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
      else if (msg.type === 'ENVIRONMENT_LOG') { /* the room summary is not a comment record */ }
      return 'accepted' as const;
    }),
  };
});

import {
  _enqueueCommentForBatchForTesting as enqueueComment,
  _setChildProtectionModeForTesting as setMode,
  _stampClassificationForTesting as stampClassification,
} from '../../../../src/content/index';
import { _resetViewportTrackerForTesting } from '../../../../src/content/post-path/viewport-tracker';
import { clearPendingCommentBatchState } from '../../../../src/content/comment-batch/queue';
import { _resetForensicDedupForTesting } from '../../../../src/content/record/forensic-gate';
import type { DecisionBlock, ForensicRecord } from '../../../../src/types/forensic';
import type { PostContent } from '../../../../src/types/post';

let n = 0;

function makeComment(text: string, author = 'some-user'): { post: PostContent; host: HTMLElement } {
  const id = `yt-${++n}`;
  const host = document.createElement('ytd-comment-view-model');
  const textEl = document.createElement('div');
  textEl.id = 'content-text';
  textEl.textContent = text;
  host.appendChild(textEl);
  document.body.appendChild(host);
  host.dataset.fwCommentSeen = 'true';
  textEl.dataset.fwCommentSeen = 'true';
  const post = {
    id, text, author, timestamp: '', platform: 'youtube', kind: 'top-comment', parentVideoId: `parent-${id}`, depth: 1, domRef: new WeakRef(textEl),
  } as unknown as PostContent;
  return { post, host };
}

/** One comment through the real flush; the records the logger wrote for it. */
async function run(text: string, opts: { author?: string } = {}): Promise<{ records: ForensicRecord[]; host: HTMLElement }> {
  state.added.length = 0;
  setMode(state.mode);
  _resetForensicDedupForTesting();
  clearPendingCommentBatchState();
  document.body.innerHTML = '';
  const own = `${text} number ${n + 1}`;
  const { post, host } = makeComment(own, opts.author);
  stampClassification(post);
  enqueueComment(post);
  const mine = () => state.added.filter((r) => r.kind === 'comment' && r.originalText === own) as unknown as ForensicRecord[];
  for (let i = 0; i < 80 && mine().length === 0; i++) await vi.advanceTimersByTimeAsync(250);
  await vi.advanceTimersByTimeAsync(500);
  return { records: mine(), host };
}

beforeEach(() => {
  vi.useFakeTimers();
  _resetViewportTrackerForTesting();
  state.failed = false;
  state.words = ['trump'];
  state.accounts = [];
});
afterEach(() => {
  setMode('adult');
  clearPendingCommentBatchState();
  _resetViewportTrackerForTesting();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('a comment that holds a word on the household list ends hidden and says the list did it', () => {
  for (const mode of ['child', 'teen', 'adult'] as const) {
    for (const failed of [false, true]) {
      it(`${mode}, ${failed ? 'the batch failed (free tier)' : 'the reading found nothing wrong'}: hidden, and the record names the rule`, async () => {
        state.mode = mode;
        state.failed = failed;
        const { records } = await run('Trump is going to win again');
        expect(records, 'one comment record').toHaveLength(1);
        const record = records[0];
        const decision = record.decision as DecisionBlock;
        expect(record.verdict).toBe('flagged-hidden');
        expect(decision.applied).toBe('hide');
        expect(decision.rails?.[0]?.name, 'the rail is the household list').toBe('blocklist');
        expect(decision.rails?.[0]?.match, 'and the record names the word').toBe('trump');
        expect(record.aiSource, 'a rule hid it, so the record does not claim a reading').toBe('rules');
        expect(record.techniques, 'no technique is invented for it').toHaveLength(0);
      });
    }
  }

  it('an account on the list hides every comment by that account', async () => {
    state.words = [];
    state.accounts = ['some-user'];
    const { records } = await run('lovely weather today', { author: 'some-user' });
    expect(records).toHaveLength(1);
    expect((records[0].decision as DecisionBlock).rails?.[0]?.name).toBe('blocklist');
    expect(records[0].verdict).toBe('flagged-hidden');
  });
});

describe('controls', () => {
  it('a comment without the word is left to the reading, as before', async () => {
    const { records } = await run('lovely weather today');
    expect(records.filter((r) => r.verdict === 'flagged-hidden')).toHaveLength(0);
  });

  it('with the list empty, the word does nothing', async () => {
    state.words = [];
    const { records } = await run('Trump is going to win again');
    expect(records.filter((r) => r.verdict === 'flagged-hidden')).toHaveLength(0);
  });

  it('a longer word that only contains the listed one is not a match', async () => {
    state.words = ['ass'];
    const { records } = await run('this class is great');
    expect(records.filter((r) => r.verdict === 'flagged-hidden')).toHaveLength(0);
  });
});
