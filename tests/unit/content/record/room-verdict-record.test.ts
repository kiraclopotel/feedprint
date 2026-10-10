/** @vitest-environment jsdom */
// The room verdict, at the apply path, on the record it actually writes.
//
// PLAN-2026-09-14 item 4's proof line: "on a feed fixture with a video post
// and ten comments, the post carries the room verdict; on a text post it does
// not; the record hashes unchanged for legacy records." The last of the three
// is pinned in tests/unit/forensics/canonical-payload-stability.test.ts; the first two
// are here, driven through the same `onProcessingResult` seam the free-tier
// record test uses, so what is asserted is the payload that reaches the chain.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    getSettings: vi.fn(async () => ({ mode: 'teen', uiLanguage: 'en', dailyCap: 2000 })),
    isFeatureEnabled: vi.fn(() => true),
  };
});

vi.mock('../../../../src/content/injector', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/content/injector')>();
  return {
    ...actual,
    injectIntoElement: vi.fn(),
    injectCollapseOrHide: vi.fn(() => true),
    injectAdHide: vi.fn(() => true),
    injectHardHide: vi.fn(() => true),
    markOnlyElement: vi.fn(),
  };
});

vi.mock('../../../../src/content/record/forensic-retry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/content/record/forensic-retry')>();
  return {
    ...actual,
    sendHighStakesForensicLog: vi.fn(async () => 'accepted' as const),
  };
});

vi.mock('../../../../src/core/calibration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/core/calibration')>()),
  getEffectiveThreshold: vi.fn(async () => 0.45),
}));

vi.mock('../../../../src/storage/context-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/context-guard')>();
  return { ...actual, safeSendMessage: vi.fn(() => undefined) };
});

import {
  _onProcessingResultForTesting as onProcessingResult,
  _setActiveAdapterForTesting,
  _clearSessionVerdictCachesOnModeChangeForTesting,
} from '../../../../src/content/index';
import { _resetForensicDedupForTesting } from '../../../../src/content/record/forensic-gate';
import { _resetDiagnosticsForTesting } from '../../../../src/diagnostics/diagnostics';
import { sendHighStakesForensicLog } from '../../../../src/content/record/forensic-retry';
import {
  releaseHeldRoomVerdicts,
  settleRoomVerdict,
  _heldRoomVerdictCountForTesting,
  type RoomVerdict,
} from '../../../../src/content/post-path/room-verdict';
import type { PipelineResult, PassReason } from '../../../../src/analysis/pipeline';
import type { PostContent } from '../../../../src/types/post';
import type { PlatformAdapter } from '../../../../src/content/platforms/adapter';

function makePost(id: string, text: string, extra: Partial<PostContent> = {}): PostContent {
  const el = document.createElement('div');
  el.textContent = text;
  document.body.appendChild(el);
  return {
    id, text, author: 'example_creator', timestamp: '2026-09-14T20:38:00Z',
    platform: 'tiktok', domRef: new WeakRef(el), kind: 'video',
    parentVideoId: id,
    ...extra,
  } as unknown as PostContent;
}

function pass(reason: PassReason): PipelineResult {
  return { action: 'pass', passContext: { reason } } as unknown as PipelineResult;
}

function harmfulRoom(): RoomVerdict {
  return {
    manipulative: true,
    technique: 'pile-on',
    severity: 7,
    confidence: 0.82,
    summary: 'The comments turn on the person in the clip.',
    batchSize: 10,
    aiModel: 'test-model',
    aiProvider: 'test-provider',
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5));
}

const sends = () => vi.mocked(sendHighStakesForensicLog).mock.calls
  .map((c) => c[0] as { type: string; payload: Record<string, unknown> });

beforeEach(() => {
  _resetForensicDedupForTesting();
  _clearSessionVerdictCachesOnModeChangeForTesting();
  _resetDiagnosticsForTesting();
  releaseHeldRoomVerdicts();
  _setActiveAdapterForTesting({ platform: 'tiktok' } as unknown as PlatformAdapter);
  vi.mocked(sendHighStakesForensicLog).mockClear();
  document.body.innerHTML = '';
});

afterEach(() => {
  releaseHeldRoomVerdicts();
});

describe('a post with no text of its own is judged by its room', () => {
  it('holds its one record until the room is read, then writes the room verdict', async () => {
    const post = makePost('tk-vid-9000000001', '');
    onProcessingResult(post, pass('pre-llm-too-short'));
    await settle();

    // Nothing written yet: the record is waiting for the comments under it.
    expect(sends()).toHaveLength(0);
    expect(_heldRoomVerdictCountForTesting()).toBe(1);

    expect(settleRoomVerdict('tiktok', 'tk-vid-9000000001', harmfulRoom())).toBe(true);
    await settle();

    const all = sends();
    // Exactly one record for the item, not two.
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe('FORENSIC_LOG');
    expect(all[0].payload.verdictOrigin).toBe('room');
    expect(all[0].payload.detectionMode).toBe('room-verdict:10');
    expect(all[0].payload.aiSource).toBe('cloud');
    expect(all[0].payload.aiModel).toBe('test-model');
    expect(all[0].payload.originalText).toBe('');
    // The rewrite slot is empty: nothing on the page was changed.
    expect(all[0].payload.neutralizedText).toBe('');
    const analysis = all[0].payload.analysis as { isManipulative: boolean; overallScore: number };
    expect(analysis.isManipulative).toBe(true);
    expect(analysis.overallScore).toBe(7);
  });

  it('records a benign room as a pass that still says where it was read', async () => {
    const post = makePost('tk-vid-9000000002', '');
    onProcessingResult(post, pass('pre-llm-non-substantive'));
    await settle();

    settleRoomVerdict('tiktok', 'tk-vid-9000000002', {
      ...harmfulRoom(), manipulative: false, technique: 'none', severity: 0,
      summary: 'Ordinary conversation under the clip.',
    });
    await settle();

    const all = sends();
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe('PASS_LOG');
    // The claim is "the comments were read and found nothing", which is not
    // the same claim as "the item's own words were read and found nothing".
    expect(all[0].payload.verdictOrigin).toBe('room');
  });

  it('writes the record it always wrote when no room arrives in time', async () => {
    const post = makePost('tk-vid-9000000003', '');
    onProcessingResult(post, pass('pre-llm-too-short'));
    await settle();
    expect(sends()).toHaveLength(0);

    // The reader left the surface before the comments were batched.
    releaseHeldRoomVerdicts();
    await settle();

    const all = sends();
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe('PASS_LOG');
    expect(all[0].payload.verdictOrigin).toBeUndefined();
    expect(all[0].payload.aiSource).toBe('rules');
    expect(all[0].payload.passReason).toBe('pre-llm-too-short');
  });
});

describe('a post that carried its own text is not judged by its room', () => {
  it('is never held, and its record carries no verdictOrigin', async () => {
    const post = makePost(
      'tk-vid-9000000004',
      'A caption long enough and substantive enough for the judge to read.',
    );
    onProcessingResult(post, pass('post-llm-not-manipulative'));
    await settle();

    expect(_heldRoomVerdictCountForTesting()).toBe(0);
    for (const m of sends()) {
      expect(m.payload.verdictOrigin).toBeUndefined();
    }
    // And a room verdict arriving for its parent cannot attach itself to it.
    expect(settleRoomVerdict('tiktok', 'tk-vid-9000000004', harmfulRoom())).toBe(false);
  });

  it('a free-tier pass is not a text-less pass, so it is written at once', async () => {
    // YouTube is the platform whose free-tier videos are recorded; the reason
    // is not one of the two text-less gates, so nothing is held.
    _setActiveAdapterForTesting({ platform: 'youtube' } as unknown as PlatformAdapter);
    const post = makePost('yt-vid-abc', '', { platform: 'youtube', parentVideoId: 'yt-vid-abc' });
    onProcessingResult(post, pass('pre-llm-free-tier-no-ai'));
    await settle();

    expect(_heldRoomVerdictCountForTesting()).toBe(0);
    const all = sends();
    expect(all.length).toBeGreaterThan(0);
    for (const m of all) expect(m.payload.verdictOrigin).toBeUndefined();
  });
});
