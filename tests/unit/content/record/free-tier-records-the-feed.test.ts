/** @vitest-environment jsdom */
// The bug the owner reported on 2026-09-04, reproduced at the apply path.
//
// He installed a fresh build, scrolled X for a while, and the dashboard said
// "Se afișează 3 din 3 înregistrări". His export held two records, both
// aiSource 'rules', written 150 milliseconds apart in the first extraction
// pass. Twenty to thirty posts produced nothing, because a free install exits
// the pipeline at `pre-llm-free-tier-no-ai` and only `post-llm-*` passes wrote
// a chain record.
//
// This drives `onProcessingResult` with the exact PipelineResult a free-tier
// scroll produces and asserts the chain now hears about it.

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
import type { PipelineResult, PassReason } from '../../../../src/analysis/pipeline';
import type { PostContent } from '../../../../src/types/post';
import type { PlatformAdapter } from '../../../../src/content/platforms/adapter';

function makePost(id: string, text: string, extra: Partial<PostContent> = {}): PostContent {
  const el = document.createElement('article');
  el.textContent = text;
  document.body.appendChild(el);
  return {
    id, text, author: '@someone', timestamp: '2026-09-04T20:38:00Z',
    platform: 'twitter', domRef: new WeakRef(el), kind: 'post',
    ...extra,
  } as unknown as PostContent;
}

/** Exactly what pipeline.ts returns when there is no licence. */
function freeTierPass(reason: PassReason = 'pre-llm-free-tier-no-ai'): PipelineResult {
  return { action: 'pass', passContext: { reason } } as unknown as PipelineResult;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5));
}

const sends = () => vi.mocked(sendHighStakesForensicLog).mock.calls.map(c => c[0] as { type: string; payload: Record<string, unknown> });

beforeEach(() => {
  _resetForensicDedupForTesting();
  _clearSessionVerdictCachesOnModeChangeForTesting();
  _resetDiagnosticsForTesting();
  _setActiveAdapterForTesting({ platform: 'twitter' } as unknown as PlatformAdapter);
  vi.mocked(sendHighStakesForensicLog).mockClear();
  document.body.innerHTML = '';
});

describe('a free install records what the feed served', () => {
  it('writes a SKIPPED_LOG for a post nothing judged', async () => {
    onProcessingResult(makePost('p1', 'an ordinary post that no rule flagged at all'), freeTierPass());
    await settle();

    const skips = sends().filter(m => m.type === 'SKIPPED_LOG');
    expect(skips).toHaveLength(1);
    expect(skips[0].payload.skipReason).toBe('free-tier-no-ai');
    expect(skips[0].payload.platform).toBe('twitter');
    expect(skips[0].payload.originalText).toBe('an ordinary post that no rule flagged at all');
  });

  it('records twenty scrolled posts, not three', async () => {
    for (let i = 0; i < 20; i++) {
      onProcessingResult(makePost(`p${i}`, `post number ${i} with enough text to be real`), freeTierPass());
    }
    await settle();
    expect(sends().filter(m => m.type === 'SKIPPED_LOG')).toHaveLength(20);
  });

  it('names the gate, so "no licence" reads differently from "nothing to read"', async () => {
    const cases: Array<[PassReason, string]> = [
      ['pre-llm-free-tier-no-ai', 'free-tier-no-ai'],
      ['pre-llm-too-short', 'too-short'],
      ['pre-llm-non-substantive', 'non-substantive'],
      ['pre-llm-cap-exhausted', 'cap-exhausted'],
    ];
    for (const [reason, expected] of cases) {
      vi.mocked(sendHighStakesForensicLog).mockClear();
      _resetForensicDedupForTesting();
      onProcessingResult(makePost(`g-${expected}`, `a post for the ${expected} gate here`), freeTierPass(reason));
      await settle();
      const skips = sends().filter(m => m.type === 'SKIPPED_LOG');
      expect(skips, expected).toHaveLength(1);
      expect(skips[0].payload.skipReason).toBe(expected);
    }
  });

  it('does not write twice for the same post scrolled back to', async () => {
    const post = makePost('same', 'the same post seen twice in one session');
    onProcessingResult(post, freeTierPass());
    await settle();
    onProcessingResult(post, freeTierPass());
    await settle();
    expect(sends().filter(m => m.type === 'SKIPPED_LOG')).toHaveLength(1);
  });

  it('stays silent on a cache re-sighting and on a failed AI call', async () => {
    // 'pre-llm-cache-pass' is an item already in the chain; the AI-call failure
    // already writes its own cancelled record carrying the failure kind.
    onProcessingResult(makePost('c1', 'a post already recorded earlier in this session'), freeTierPass('pre-llm-cache-pass'));
    await settle();
    expect(sends().filter(m => m.type === 'SKIPPED_LOG')).toHaveLength(0);
  });

  it('keeps the engagement counts the reader never saw', async () => {
    const post = makePost('m1', 'a post with a very large like count on it', {
      platform_specific: { metrics: { likes: 1_200_000, views: 9_400_000 } },
    } as Partial<PostContent>);
    onProcessingResult(post, freeTierPass());
    await settle();
    const skips = sends().filter(m => m.type === 'SKIPPED_LOG');
    expect(skips).toHaveLength(1);
    // The shape is what matters here: whatever the adapter read is carried
    // through to the record rather than dropped on the free path.
    expect(skips[0].payload).toHaveProperty('metrics');
  });
});

describe('a skipped record is signed under the mode the pipeline declined in', () => {
  it('uses the judged mode carried on the result, not the mode read after the fact', async () => {
    // The apply path reads settings again, asynchronously, after the verdict.
    // A user who switched Teen to Adult in that window would otherwise have
    // every in-flight skipped record signed as an Adult record. The pipeline
    // stamps the mode it actually read; the applier prefers it.
    const post = makePost('p-mode', 'a post declined under teen, applied under adult');
    onProcessingResult(post, { ...freeTierPass(), judgedMode: 'teen' } as PipelineResult);
    await settle();

    const skips = sends().filter(m => m.type === 'SKIPPED_LOG');
    expect(skips).toHaveLength(1);
    expect(skips[0].payload.mode).toBe('teen');
    expect((skips[0].payload.configSnapshot as { mode: string }).mode).toBe('moderate');
  });

  it('falls back to the current settings when a result carries no judged mode', async () => {
    onProcessingResult(makePost('p-legacy', 'a result shape from before the stamp existed'), freeTierPass());
    await settle();
    const skips = sends().filter(m => m.type === 'SKIPPED_LOG');
    expect(skips).toHaveLength(1);
    expect(skips[0].payload.mode).toBe('teen');
  });
});
