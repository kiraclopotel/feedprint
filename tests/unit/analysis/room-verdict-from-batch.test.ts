/** @vitest-environment jsdom */
// The reduction from a scored comment batch to the one verdict a text-less
// post is judged by (PLAN-2026-09-14 standing decision 3).
//
// It lives beside the batch it reads (src/content/comment-batch/flush.ts)
// rather than in room-verdict.ts, because it is the only piece that has to
// know the batch's own shape and its own `isManipulative` gate.

import { describe, expect, it } from 'vitest';
import { roomVerdictFromBatch } from '../../../src/content/comment-batch/flush';
import type { BatchScoreResult, RoomAnalysis } from '../../../src/analysis/comment-batch-scorer';

function comment(over: Partial<BatchScoreResult['comments'][number]>): BatchScoreResult['comments'][number] {
  return {
    index: 1,
    technique: 'none',
    sentiment: 'neutral',
    severity: 0,
    confidence: 0.5,
    reason: '',
    action: 'rewrite',
    ...over,
  } as BatchScoreResult['comments'][number];
}

function batch(comments: BatchScoreResult['comments'], summary = 'Batch summary line.'): BatchScoreResult {
  return {
    comments,
    environment: { label: 'mixed', summary } as unknown as BatchScoreResult['environment'],
    batchSize: comments.length,
    failed: false,
    generationTimeMs: 100,
    truncatedIndices: [],
    commentHarmFloors: comments.map(() => undefined),
  };
}

describe('roomVerdictFromBatch', () => {
  it('takes the most severe comment the batch judged manipulative', () => {
    const v = roomVerdictFromBatch(
      batch([
        comment({ index: 1, technique: 'mockery', severity: 5, confidence: 0.6 }),
        comment({ index: 2, technique: 'pile-on', severity: 8, confidence: 0.9 }),
        comment({ index: 3, technique: 'supportive', severity: 0 }),
      ]),
      null,
      'groq',
    );
    expect(v.manipulative).toBe(true);
    expect(v.technique).toBe('pile-on');
    expect(v.severity).toBe(8);
    expect(v.confidence).toBe(0.9);
    expect(v.batchSize).toBe(3);
    expect(v.aiProvider).toBe('groq');
  });

  it('is benign when nothing in the batch crossed the gate', () => {
    const v = roomVerdictFromBatch(
      batch([
        comment({ index: 1, technique: 'genuine-opinion', severity: 2 }),
        comment({ index: 2, technique: 'neutral', severity: 0 }),
      ]),
      null,
      'groq',
    );
    expect(v.manipulative).toBe(false);
    expect(v.technique).toBeNull();
    expect(v.severity).toBe(0);
  });

  it('prefers the room sensor sentence when there is one, and falls back to the batch environment', () => {
    const room = { summary: 'The room is a pile-on.' } as unknown as RoomAnalysis;
    expect(roomVerdictFromBatch(batch([comment({})]), room, 'groq').summary)
      .toBe('The room is a pile-on.');
    expect(roomVerdictFromBatch(batch([comment({})], 'Fallback line.'), null, 'groq').summary)
      .toBe('Fallback line.');
  });

  it('never claims more than the batch did: an empty batch is a benign room', () => {
    const v = roomVerdictFromBatch(batch([]), null, 'groq');
    expect(v.manipulative).toBe(false);
    expect(v.batchSize).toBe(0);
  });
});
