/** @vitest-environment jsdom */
// What a comment's record says, read against what the page did, through the real flush and the real
// logger. A swear mask whose stars did not land leaves the comment as served, and a flagged comment
// whose rewrite did not land does too: both records say so with the note the block already has for it.
// The rewrite that landed and the hide are the controls.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = vi.hoisted(() => ({
  mode: 'child' as 'child' | 'teen' | 'adult',
  action: 'hide' as string | undefined,
  technique: 'shame-attack' as string,
  severity: 8,
  reason: '' as string,
  added: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    getSettings: vi.fn(async () => ({ mode: state.mode, outputLanguage: 'auto', dailyCap: 200, strictLanguage: true, features: {} })),
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
    scoreBatch: vi.fn(async () => ({
      comments: [{
        index: 1, technique: state.technique, severity: state.severity, sentiment: state.technique === 'none' ? 'neutral' : 'negative',
        confidence: 0.9, action: state.action, reason: state.reason,
        neutralizedText: state.action === undefined && state.technique !== 'none' ? 'a calmer way of saying it here' : undefined,
      }],
      environment: {
        label: 'hostile-crowd', negativePct: 100, positivePct: 0, neutralPct: 0, dominantTechnique: 'shame-attack', toxicityScore: 9,
        slurPrevalencePct: 0, authorRecidivism: 'none', discourseQuality: 'poor', algorithmicAmplification: 'unknown',
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
  _mountProtectionForTesting as mountProtection,
  _stampClassificationForTesting as stampClassification,
} from '../../../../src/content/index';
import { _resetViewportTrackerForTesting } from '../../../../src/content/post-path/viewport-tracker';
import { clearPendingCommentBatchState } from '../../../../src/content/comment-batch/queue';
import { _resetForensicDedupForTesting } from '../../../../src/content/record/forensic-gate';
import { NOTE_NOT_APPLIED } from '../../../../src/content/record/decision';
import type { DecisionBlock, ForensicRecord } from '../../../../src/types/forensic';
import type { PostContent } from '../../../../src/types/post';

const SWEARING = 'this is a fucking terrible take';

function makeComment(id: string, parentVideoId: string, text: string): { post: PostContent; host: HTMLElement; textEl: HTMLElement } {
  const host = document.createElement('ytd-comment-view-model');
  const textEl = document.createElement('div');
  textEl.id = 'content-text';
  textEl.textContent = text;
  host.appendChild(textEl);
  document.body.appendChild(host);
  host.dataset.fwCommentSeen = 'true';
  textEl.dataset.fwCommentSeen = 'true';
  const post = {
    id, text, author: 'some-user', timestamp: '', platform: 'youtube', kind: 'top-comment', parentVideoId, depth: 1, domRef: new WeakRef(textEl),
  } as unknown as PostContent;
  return { post, host, textEl };
}

interface Run { record: ForensicRecord; decision: DecisionBlock; textEl: HTMLElement; host: HTMLElement }

let n = 0;

/** One comment through the real flush. `detach` takes the comment off the page before the swap, so nothing can land. */
async function run(mode: 'child' | 'teen' | 'adult', text: string, verdict: { action?: string; technique: string; severity: number; reason?: string }, detach = false): Promise<Run> {
  state.mode = mode;
  state.action = verdict.action;
  state.technique = verdict.technique;
  state.severity = verdict.severity;
  state.reason = verdict.reason ?? '';
  state.added.length = 0;
  setMode(mode);
  _resetForensicDedupForTesting();
  clearPendingCommentBatchState();
  document.body.innerHTML = '';
  // Each run's own words, so a record a slow run writes late is never read as the next run's.
  const own = `${text} number ${++n}`;
  const id = `yt-${n}`;
  const { post, host, textEl } = makeComment(id, `parent-${id}`, own);
  if (mode === 'child') mountProtection(post, performance.now());
  stampClassification(post);
  enqueueComment(post);
  if (detach) host.remove();
  const mine = () => state.added.filter((r) => r.kind === 'comment' && r.originalText === own) as unknown as ForensicRecord[];
  // The flush is timer-driven and the writers are real; give both the same turns a loaded machine needs.
  for (let i = 0; i < 80 && mine().length === 0; i++) await vi.advanceTimersByTimeAsync(250);
  await vi.advanceTimersByTimeAsync(500);
  const records = mine();
  expect(records, `${mode} ${verdict.technique} detach=${detach}: one comment record`).toHaveLength(1);
  return { record: records[0], decision: records[0].decision as DecisionBlock, textEl, host };
}

beforeEach(() => {
  vi.useFakeTimers();
  _resetViewportTrackerForTesting();
});
afterEach(() => {
  setMode('adult');
  clearPendingCommentBatchState();
  _resetViewportTrackerForTesting();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('a swear mask on a comment', () => {
  for (const mode of ['child', 'teen', 'adult'] as const) {
    it(`${mode}: stars that landed are recorded as stars, with the words the page shows`, async () => {
      const { decision, record, textEl } = await run(mode, SWEARING, { action: undefined, technique: 'none', severity: 0 });
      expect(decision).toMatchObject({ row: 'D1', action: 'allow', applied: 'mask', note: null });
      expect(record.verdict).toBe('masked');
      expect(record.neutralizedText).toContain('*');
      expect(textEl.textContent).toBe(record.neutralizedText);
    });

    it(`${mode}: stars that did not land leave the comment as served, and the record says so`, async () => {
      const { decision, record } = await run(mode, SWEARING, { action: undefined, technique: 'none', severity: 0 }, true);
      expect(decision).toMatchObject({ row: 'D1', action: 'allow', applied: 'allow', note: NOTE_NOT_APPLIED, rewrite: { attempted: true, outcome: 'failed' } });
      expect(record.neutralizedText).toBe('');
      expect(record.verdict).toBe('pass');
    });
  }
});

describe('a flagged comment, the controls', () => {
  const SHAME = 'you people are all worthless and stupid';
  for (const mode of ['teen', 'adult'] as const) {
    it(`${mode}: a rewrite that landed is softened`, async () => {
      const { decision, record } = await run(mode, SHAME, { action: undefined, technique: 'shame-attack', severity: 7 });
      expect(decision.applied).toBe('soften');
      expect(record.neutralizedText).not.toBe('');
    });

    it(`${mode}: the judge's reason rides on the record's technique (gem 77)`, async () => {
      const { record } = await run(mode, SHAME, { action: undefined, technique: 'shame-attack', severity: 7, reason: 'calls the whole group worthless' });
      expect(record.techniques).toHaveLength(1);
      expect(record.techniques[0]).toMatchObject({ name: 'shame-attack', why: 'calls the whole group worthless' });
    });

    it(`${mode}: a rewrite that did not land is a failed rewrite shown as served`, async () => {
      const { decision, record } = await run(mode, SHAME, { action: undefined, technique: 'shame-attack', severity: 7 }, true);
      expect(decision).toMatchObject({ applied: 'allow', rewrite: { attempted: true, outcome: 'failed' }, note: NOTE_NOT_APPLIED });
      expect(record.neutralizedText).toBe('');
    });
  }

  it('child: a hide that landed is a hide', async () => {
    const { decision, record } = await run('child', SHAME, { action: 'hide', technique: 'shame-attack', severity: 8 });
    expect(decision.applied).toBe('hide');
    expect(record.verdict).toBe('flagged-hidden');
  });
});
