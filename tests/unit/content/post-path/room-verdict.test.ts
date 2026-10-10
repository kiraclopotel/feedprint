// The room verdict for a text-less post: the hold, the settle, the timeout,
// and the reduction from a scored batch to the one verdict applied.
//
// PLAN-2026-09-14 standing decision 3. The read path is
// src/content/post-path/room-verdict.ts; the reduction lives beside the batch it reads
// (src/content/comment-batch/flush.ts roomVerdictFromBatch).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ROOM_VERDICT_WAIT_MS,
  holdForRoomVerdict,
  isTextlessPassReason,
  releaseHeldRoomVerdicts,
  roomVerdictAnalysis,
  roomVerdictKeyForPost,
  settleRoomVerdict,
  _heldRoomVerdictCountForTesting,
  type RoomVerdict,
} from '../../../../src/content/post-path/room-verdict';

function verdict(overrides: Partial<RoomVerdict> = {}): RoomVerdict {
  return {
    manipulative: true,
    technique: 'pile-on',
    severity: 7,
    confidence: 0.8,
    summary: 'The comments turn on the person in the clip.',
    batchSize: 5,
    aiModel: 'test-model',
    aiProvider: 'test-provider',
    ...overrides,
  };
}

const textlessVideo = { platform: 'tiktok', id: 'tk-vid-1', parentVideoId: 'tk-vid-1' } as const;

beforeEach(() => {
  releaseHeldRoomVerdicts();
});

afterEach(() => {
  releaseHeldRoomVerdicts();
  vi.useRealTimers();
});

describe('which posts are held', () => {
  it('a pass the pipeline made because there was no prose is a text-less pass', () => {
    // The definition is the pipeline's own, not a new one.
    expect(isTextlessPassReason('pre-llm-too-short')).toBe(true);
    expect(isTextlessPassReason('pre-llm-non-substantive')).toBe(true);
  });

  it('a pass for any other reason is not', () => {
    for (const reason of [
      'post-llm-pass',
      'pre-llm-free-tier-no-ai',
      'pre-llm-cap-exhausted',
      'pre-llm-cache-pass',
      'pre-llm-ai-call-failed',
    ]) {
      expect(isTextlessPassReason(reason)).toBe(false);
    }
  });

  it('the hold key is the bucket key its comments are filed under', () => {
    expect(roomVerdictKeyForPost(textlessVideo)).toBe(
      roomVerdictKeyForPost({ platform: 'tiktok', id: 'something-else', parentVideoId: 'tk-vid-1' }),
    );
  });
});

describe('the held record is written exactly once', () => {
  it('with the room, when the room is read inside the wait', () => {
    const write = vi.fn();
    expect(holdForRoomVerdict(textlessVideo, write)).toBe(true);
    expect(write).not.toHaveBeenCalled();
    expect(_heldRoomVerdictCountForTesting()).toBe(1);

    const v = verdict();
    expect(settleRoomVerdict('tiktok', 'tk-vid-1', v)).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(v);
    expect(_heldRoomVerdictCountForTesting()).toBe(0);
  });

  it('without the room, when the wait runs out first', () => {
    vi.useFakeTimers();
    const write = vi.fn();
    holdForRoomVerdict(textlessVideo, write);

    vi.advanceTimersByTime(ROOM_VERDICT_WAIT_MS - 1);
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(null);

    // And a room that arrives after the wait cannot write a second record.
    expect(settleRoomVerdict('tiktok', 'tk-vid-1', verdict())).toBe(false);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('without the room, when the reader leaves the surface', () => {
    vi.useFakeTimers();
    const write = vi.fn();
    holdForRoomVerdict(textlessVideo, write);
    releaseHeldRoomVerdicts();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(null);

    // The timer must be disarmed by the release, or the record is written twice.
    vi.advanceTimersByTime(ROOM_VERDICT_WAIT_MS * 2);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('a settle for a room nobody is waiting on does nothing', () => {
    expect(settleRoomVerdict('tiktok', 'tk-vid-unheld', verdict())).toBe(false);
  });

  it('a second hold on the same room is refused, so the caller writes its own record', () => {
    const first = vi.fn();
    const second = vi.fn();
    expect(holdForRoomVerdict(textlessVideo, first)).toBe(true);
    expect(holdForRoomVerdict(textlessVideo, second)).toBe(false);
    expect(_heldRoomVerdictCountForTesting()).toBe(1);
  });
});

describe('what the room verdict puts on the record', () => {
  it('a harmful room carries its technique, severity and sentence', () => {
    const a = roomVerdictAnalysis('tk-vid-1', verdict());
    expect(a.isManipulative).toBe(true);
    expect(a.overallScore).toBe(7);
    expect(a.primaryTechnique).toBe('pile-on');
    expect(a.techniques).toHaveLength(1);
    expect(a.techniques[0].evidence).toEqual(['The comments turn on the person in the clip.']);
    expect(a.explanation).toBe('The comments turn on the person in the clip.');
  });

  it('a benign room carries no technique, exactly as a pass record does', () => {
    const a = roomVerdictAnalysis('tk-vid-1', verdict({ manipulative: false, technique: 'none', severity: 0 }));
    expect(a.isManipulative).toBe(false);
    expect(a.overallScore).toBe(0);
    expect(a.techniques).toEqual([]);
    expect(a.primaryTechnique).toBeUndefined();
  });
});
