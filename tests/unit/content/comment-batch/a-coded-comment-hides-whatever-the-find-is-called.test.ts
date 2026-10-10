/** @vitest-environment jsdom */
// G2, the guard on the comment path (green before and after the relabel): a comment with a directed self-harm push or a
// sexual ask, carrying the rule's own verdict from codedHarmVerdictFields (action 'hide', severity 9), ends hidden through
// the real flush and the real logger in every mode. The verdict is built from the shared mapping, so the test follows
// whatever the find is called: nothing in the flush hides it only because of the technique's name.

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
        index: 1, technique: state.technique, severity: state.severity, sentiment: 'negative',
        confidence: 0.85, action: state.action, reason: state.reason, overrideOrigin: 'coded-harm',
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
import { detectCodedHarm, codedHarmVerdictFields } from '../../../../src/core/coded-harm-catcher';
import type { DecisionBlock, ForensicRecord } from '../../../../src/types/forensic';
import type { PostContent } from '../../../../src/types/post';

const FINDS = [
  { category: 'self-harm-encouragement', text: 'nobody likes you, just kill yourself already' },
  { category: 'sexual-solicitation', text: 'send me nude pics' },
  { category: 'sexual-explicit', text: 'she was deepthroating in the clip' },
] as const;

function makeComment(id: string, parentVideoId: string, text: string): { post: PostContent; host: HTMLElement } {
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
  return { post, host };
}

let n = 0;

/** One coded comment through the real flush, with the verdict the shared mapping gives for its find. */
async function run(mode: 'child' | 'teen' | 'adult', text: string): Promise<{ record: ForensicRecord; decision: DecisionBlock }> {
  const hit = detectCodedHarm(text);
  if (!hit) throw new Error(`the catcher did not fire on: ${text}`);
  const fields = codedHarmVerdictFields(hit);
  state.mode = mode;
  state.action = fields.hideTier ? 'hide' : undefined;
  state.technique = fields.technique;
  state.severity = fields.severity;
  state.reason = `coded-harm catcher: ${hit.category} (${hit.evidence})`;
  state.added.length = 0;
  setMode(mode);
  _resetForensicDedupForTesting();
  clearPendingCommentBatchState();
  document.body.innerHTML = '';
  const own = `${text} number ${++n}`;
  const id = `yt-${n}`;
  const { post } = makeComment(id, `parent-${id}`, own);
  if (mode === 'child') mountProtection(post, performance.now());
  stampClassification(post);
  enqueueComment(post);
  const mine = () => state.added.filter((r) => r.kind === 'comment' && r.originalText === own) as unknown as ForensicRecord[];
  for (let i = 0; i < 80 && mine().length === 0; i++) await vi.advanceTimersByTimeAsync(250);
  await vi.advanceTimersByTimeAsync(500);
  const records = mine();
  expect(records, `${mode} ${hit.category}: one comment record`).toHaveLength(1);
  return { record: records[0], decision: records[0].decision as DecisionBlock };
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

describe('a coded comment ends hidden whatever the find is called', () => {
  for (const mode of ['child', 'teen', 'adult'] as const) {
    for (const find of FINDS) {
      it(`${mode}: ${find.category} is a hide, and the record says it landed`, async () => {
        const { decision, record } = await run(mode, find.text);
        expect(decision.applied).toBe('hide');
        expect(record.verdict).toBe('flagged-hidden');
        expect(record.techniques[0]?.severity, 'severity 9 as before').toBe(9);
      });
    }
  }
});
