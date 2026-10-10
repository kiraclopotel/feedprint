/** @vitest-environment jsdom */
// B7 unit 3 (P32), site 3b (S5, critic 1's two notes on site 3): the outer catch of the comment flush keeps the covers and
// puts the comments back in the pool, but a comment still on screen at the throw, or not scrolled back within 30 s, is never
// read again and had only a counter: no chain record, and the video's bucket could re-form against the same fault at once.
// Now the chain says each comment went unjudged (a CANCEL_LOG, cancelled-batch-llm-failure, failureKind internal-error, as the
// failed-batch branch writes it) when the settings were read, and the video gets the same 30 s cooldown the failed-batch branch
// sets. The harness is a copy of site 3's own test file (not edited).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = vi.hoisted(() => ({
  breakEnvironment: false,
  throwOnSettingsRead: false,
  added: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    getSettings: vi.fn(async () => {
      if (state.throwOnSettingsRead) throw new Error('injected: the settings read threw');
      return { mode: 'child', outputLanguage: 'auto', dailyCap: 200, strictLanguage: true, features: {} };
    }),
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
// The one place the test makes the flush throw: the batch result comes back without its environment, which the flush reads
// after scoring, outside the try that guards the scoring call.
vi.mock('../../../../src/analysis/comment-batch-scorer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/analysis/comment-batch-scorer')>();
  return {
    ...actual,
    scoreBatch: vi.fn(async () => ({
      comments: [{ index: 1, technique: 'none', severity: 0, sentiment: 'neutral', confidence: 0.9, reason: '' }],
      environment: state.breakEnvironment ? undefined : {
        label: 'healthy-discussion', negativePct: 0, positivePct: 50, neutralPct: 50, dominantTechnique: null, toxicityScore: 0,
        slurPrevalencePct: 0, authorRecidivism: 'none', discourseQuality: 'good', algorithmicAmplification: 'unknown', summary: '',
      },
      batchSize: 1, failed: false, generationTimeMs: 100, truncatedIndices: [],
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
  return { ...actual, sendHighStakesForensicLog: vi.fn(async (..._args: unknown[]) => 'accepted' as const) };
});

import {
  _enqueueCommentForBatchForTesting as enqueueComment,
  _setChildProtectionModeForTesting as setMode,
  _mountProtectionForTesting as mountProtection,
  _stampClassificationForTesting as stampClassification,
  _childProtectionActiveCountForTesting as coverCount,
} from '../../../../src/content/index';
import { _resetViewportTrackerForTesting, isParentInCooldown } from '../../../../src/content/post-path/viewport-tracker';
import { clearPendingCommentBatchState } from '../../../../src/content/comment-batch/queue';
import { _resetForensicDedupForTesting } from '../../../../src/content/record/forensic-gate';
import { sendHighStakesForensicLog } from '../../../../src/content/record/forensic-retry';
import { _resetDiagnosticsForTesting, _getDiagnosticCountersForTesting } from '../../../../src/diagnostics/diagnostics';
import type { PostContent } from '../../../../src/types/post';

function makeComment(id: string, parentVideoId: string, text: string): PostContent {
  const host = document.createElement('ytd-comment-view-model');
  const textEl = document.createElement('div');
  textEl.id = 'content-text';
  textEl.textContent = text;
  host.appendChild(textEl);
  document.body.appendChild(host);
  host.dataset.fwCommentSeen = 'true';
  textEl.dataset.fwCommentSeen = 'true';
  return {
    id, text, author: 'some-user', timestamp: '', platform: 'youtube', kind: 'top-comment', parentVideoId, depth: 1, domRef: new WeakRef(textEl),
  } as unknown as PostContent;
}

const unhandled: unknown[] = [];
const onUnhandled = (e: unknown): void => { unhandled.push(e); };
let n = 0;

interface Ran { parentVideoId: string; text: string }

/** One ordinary comment, covered at Strict, through the real flush; returns after the flush has had its turns. */
async function runOne(): Promise<Ran> {
  state.added.length = 0;
  setMode('child');
  _resetForensicDedupForTesting();
  clearPendingCommentBatchState();
  document.body.innerHTML = '';
  const id = `yt-${++n}`;
  const parentVideoId = `parent-${id}`;
  const text = `an ordinary remark about the video number ${n}`;
  const post = makeComment(id, parentVideoId, text);
  mountProtection(post, performance.now());
  stampClassification(post);
  enqueueComment(post);
  // From here the settings read is the flush's own: nothing else reads it before the flush starts on its timer.
  state.throwOnSettingsRead = pendingSettingsThrow;
  for (let i = 0; i < 40; i++) await vi.advanceTimersByTimeAsync(250);
  await vi.advanceTimersByTimeAsync(500);
  return { parentVideoId, text };
}

let pendingSettingsThrow = false;

const cancelLogs = (text: string): Array<Record<string, unknown>> =>
  vi.mocked(sendHighStakesForensicLog).mock.calls
    .map((call) => call[0] as { type: string; payload: Record<string, unknown> })
    .filter((msg) => msg.type === 'CANCEL_LOG' && msg.payload.originalText === text)
    .map((msg) => msg.payload);

beforeEach(() => {
  state.breakEnvironment = false;
  state.throwOnSettingsRead = false;
  pendingSettingsThrow = false;
  unhandled.length = 0;
  vi.mocked(sendHighStakesForensicLog).mockClear();
  _resetDiagnosticsForTesting();
  vi.useFakeTimers();
  _resetViewportTrackerForTesting();
  process.removeListener('unhandledRejection', onUnhandled);
  process.on('unhandledRejection', onUnhandled);
});
afterEach(() => {
  setMode('adult');
  clearPendingCommentBatchState();
  _resetViewportTrackerForTesting();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('a throw in the comment flush says so on the chain and cools the video', () => {
  it('control: an ordinary flush writes no unjudged record and sets no cooldown', async () => {
    const ran = await runOne();
    expect(cancelLogs(ran.text)).toEqual([]);
    expect(isParentInCooldown(ran.parentVideoId)).toBe(false);
    expect(_getDiagnosticCountersForTesting().commentFlushThrew).toBeUndefined();
  });

  it('after the settings were read: one unjudged record per comment, the video cools, the cover stays and it counts once', async () => {
    state.breakEnvironment = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ran = await runOne();
    const logs = cancelLogs(ran.text);
    expect(logs, 'one record for the one comment').toHaveLength(1);
    expect(logs[0]).toMatchObject({ verdict: 'cancelled-batch-llm-failure', failureKind: 'internal-error', mode: 'child', parentVideoId: ran.parentVideoId, kind: 'comment' });
    expect(isParentInCooldown(ran.parentVideoId), 'the video cools for 30 s').toBe(true);
    expect(coverCount(), 'site 3 still holds: the cover stays').toBe(1);
    expect(_getDiagnosticCountersForTesting().commentFlushThrew).toBe(1);
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 5));
    expect(unhandled).toEqual([]);
    warn.mockRestore();
    err.mockRestore();
  });

  it('before the settings could be read there is no mode to name, so no record is written, but the video still cools', async () => {
    state.breakEnvironment = true;
    pendingSettingsThrow = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ran = await runOne();
    expect(cancelLogs(ran.text), 'no mode to name, no record').toEqual([]);
    expect(isParentInCooldown(ran.parentVideoId), 'the video still cools').toBe(true);
    expect(_getDiagnosticCountersForTesting().commentFlushThrew).toBe(1);
    warn.mockRestore();
    err.mockRestore();
  });
});
