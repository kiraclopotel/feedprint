/** @vitest-environment jsdom */
// The room verdict on Facebook, Instagram and X (PLAN-2026-09-15 item 6), at the
// apply path, on the record it actually writes. Same harness as
// room-verdict-record.test.ts.
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

const PLATFORMS = [
  { platform: 'facebook', id: '1234567890123456', kind: 'post' },
  { platform: 'instagram', id: 'C9xYz12AbCd', kind: 'post' },
  { platform: 'twitter', id: '1966000000000000001', kind: 'post' },
] as const;

/** On X the room exists only on a permalink page. */
const extra = (platform: string): Partial<PostContent> =>
  (platform === 'twitter' ? { platform_specific: { platform: 'twitter', surfaceKind: 'twitter-permalink' } } : {}) as Partial<PostContent>;

for (const p of PLATFORMS) {
  describe(`${p.platform}: a caption-less post is judged by its room`, () => {
    beforeEach(() => {
      _setActiveAdapterForTesting({ platform: p.platform } as unknown as PlatformAdapter);
    });

    it('holds its one record and writes the room verdict when the room is read', async () => {
      const post = makePost(p.id, '#fyp @someone 🔥', { platform: p.platform, kind: p.kind, ...extra(p.platform) } as Partial<PostContent>);
      onProcessingResult(post, pass('pre-llm-too-short'));
      await settle();
      expect(sends()).toHaveLength(0);
      expect(_heldRoomVerdictCountForTesting()).toBe(1);
      expect(settleRoomVerdict(p.platform, p.id, harmfulRoom())).toBe(true);
      await settle();
      const all = sends();
      expect(all).toHaveLength(1);
      expect(all[0].type).toBe('FORENSIC_LOG');
      expect(all[0].payload.verdictOrigin).toBe('room');
    });

    it('a short real caption is not held and keeps the record it always had', async () => {
      const post = makePost(`${p.id}9`, 'Mayor lies', { platform: p.platform, kind: p.kind, ...extra(p.platform) } as Partial<PostContent>);
      onProcessingResult(post, pass('pre-llm-too-short'));
      await settle();
      expect(_heldRoomVerdictCountForTesting()).toBe(0);
      const all = sends();
      expect(all).toHaveLength(1);
      expect(all[0].payload.verdictOrigin).toBeUndefined();
    });

    it('a post whose id is a random fallback is never held', async () => {
      const post = makePost('0b9e5f5e-1c7a-4d3e-9a61-2f4b8c7d6e5a', '', { platform: p.platform, kind: p.kind, ...extra(p.platform) } as Partial<PostContent>);
      onProcessingResult(post, pass('pre-llm-too-short'));
      await settle();
      expect(_heldRoomVerdictCountForTesting()).toBe(0);
      expect(sends()).toHaveLength(1);
    });

    it('a comment is never held', async () => {
      const post = makePost(`${p.id}7`, '', { platform: p.platform, kind: 'comment', parentVideoId: p.id } as Partial<PostContent>);
      onProcessingResult(post, pass('pre-llm-too-short'));
      await settle();
      expect(_heldRoomVerdictCountForTesting()).toBe(0);
    });
  });
}

describe('twitter: a feed post is not held, because no room is batched under it', () => {
  it('writes its record at once', async () => {
    _setActiveAdapterForTesting({ platform: 'twitter' } as unknown as PlatformAdapter);
    const post = makePost('1966000000000000077', '', { platform: 'twitter', kind: 'post', platform_specific: { platform: 'twitter', surfaceKind: 'twitter-home-feed' } } as unknown as Partial<PostContent>);
    onProcessingResult(post, pass('pre-llm-too-short'));
    await settle();
    expect(_heldRoomVerdictCountForTesting()).toBe(0);
    expect(sends()).toHaveLength(1);
  });
});
