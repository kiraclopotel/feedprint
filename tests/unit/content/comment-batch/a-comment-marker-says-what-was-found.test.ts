/** @vitest-environment jsdom */
// G5 (the grow owner's row G5, from A7's third part and critic 1's note of 22:58 on G2). The dot beside a caught comment
// carries the pattern's own title ("Self-harm risk", "Body comparison") instead of "Pattern detected". Until now the
// comment flush passed the verdict's technique on only when it was one of eight names in a hand list
// (STANDARD_TECHNIQUES), so a verdict of 'self-harm' (G2 made it reach comments) or 'body-comparison-priming' rendered
// a marker with no primaryTechnique, and the dot read the generic title.
//
// Now primaryTechnique is the verdict's technique when the title table (MARKER_TITLES.en) has an own entry for it, except
// 'combined' (two meanings; kept generic until its own card). One source of truth: a pattern added to the table later
// gets its title on a comment without anyone remembering a second list.
//
// The marker looks its title up from primaryTechnique alone (teen-marker.ts getTitleFor: no technique, the generic
// "Pattern detected"; otherwise MARKER_TITLES), so the analysis the marker is rendered with is what is read here.
// This drives the REAL flushBatch through the production debounce timer and the real FlushDeps wired in content/index.ts
// (the way comment-batch-encounter-throw.test.ts does), with the model's answer (scoreBatch) fixed. What is read is the
// analysis the marker is rendered with. Which markers render and which comments hide is not touched here.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    getSettings: vi.fn(async () => ({
      mode: 'teen',
      outputLanguage: 'auto',
      uiLanguage: 'en',
      dailyCap: 200,
    })),
    isFeatureEnabled: vi.fn(() => true),
    isCommentRewriteEnabled: vi.fn(() => false),
  };
});

vi.mock('../../../../src/analysis/comment-batch-scorer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/analysis/comment-batch-scorer')>();
  return { ...actual, scoreBatch: vi.fn(), scoreRoom: vi.fn(async () => null) };
});

vi.mock('../../../../src/content/markers/teen-marker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/content/markers/teen-marker')>();
  return { ...actual, renderTeenMarker: vi.fn(actual.renderTeenMarker) };
});

vi.mock('../../../../src/content/record/forensic-retry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/content/record/forensic-retry')>();
  return { ...actual, sendHighStakesForensicLog: vi.fn(async () => 'accepted' as const) };
});

vi.mock('../../../../src/core/lang-detect', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/core/lang-detect')>();
  return { ...actual, resolvePromptLanguage: vi.fn(async () => 'English') };
});

import { _enqueueCommentForBatchForTesting as enqueueComment, _setChildProtectionModeForTesting as setMode } from '../../../../src/content/index';
import { _resetViewportTrackerForTesting } from '../../../../src/content/post-path/viewport-tracker';
import { clearPendingCommentBatchState } from '../../../../src/content/comment-batch/queue';
import { scoreBatch, type BatchScoreResult } from '../../../../src/analysis/comment-batch-scorer';
import { renderTeenMarker } from '../../../../src/content/markers/teen-marker';
import { MARKER_TITLES } from '../../../../src/i18n/marker-strings';
import type { BatchCommentVerdict } from '../../../../src/types/batch-verdict';
import type { PostContent } from '../../../../src/types/post';

function makeComment(id: string, parentVideoId: string, text: string): PostContent {
  const host = document.createElement('ytd-comment-view-model');
  const textEl = document.createElement('div');
  textEl.id = 'content-text';
  textEl.textContent = text;
  host.appendChild(textEl);
  document.body.appendChild(host);
  return {
    id,
    text,
    author: 'someone',
    timestamp: '',
    platform: 'youtube',
    kind: 'top-comment',
    parentVideoId,
    depth: 1,
    domRef: new WeakRef(textEl),
  } as PostContent;
}

function answer(technique: string, extra: Record<string, unknown> = {}): BatchScoreResult {
  const verdict = {
    index: 1,
    technique,
    sentiment: 'negative',
    severity: 8,
    confidence: 0.9,
    reason: 'a reason the model wrote for this comment',
    action: 'rewrite',
    ...extra,
  } as unknown as BatchCommentVerdict;
  return {
    comments: [verdict],
    environment: {
      label: 'unknown', negativePct: 100, positivePct: 0, neutralPct: 0, dominantTechnique: null, summary: '',
      toxicityScore: 0, slurPrevalencePct: 0, authorRecidivism: 1, discourseQuality: 100,
    },
    batchSize: 1,
    failed: false,
    generationTimeMs: 1,
    truncatedIndices: [],
    commentHarmFloors: [undefined],
  } as unknown as BatchScoreResult;
}

/** One comment, one verdict of `technique`, through the real flush; the analysis the marker was rendered with. */
let n = 0;
async function markerAnalysisFor(technique: string, extra: Record<string, unknown> = {}): Promise<{ rendered: boolean; primaryTechnique: unknown }> {
  n += 1;
  vi.mocked(scoreBatch).mockResolvedValueOnce(answer(technique, extra));
  vi.mocked(renderTeenMarker).mockClear();
  const post = makeComment(`g5-${n}`, `g5-parent-${n}`, 'a comment that was caught');
  enqueueComment(post);
  await vi.advanceTimersByTimeAsync(1600);
  const call = vi.mocked(renderTeenMarker).mock.calls[0];
  if (!call) return { rendered: false, primaryTechnique: undefined };
  const analysis = call[0].analysis as unknown as Record<string, unknown>;
  return { rendered: true, primaryTechnique: analysis.primaryTechnique };
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.useFakeTimers();
  _resetViewportTrackerForTesting();
  clearPendingCommentBatchState();
  setMode('teen');
});

afterEach(() => {
  setMode('adult');
  clearPendingCommentBatchState();
  _resetViewportTrackerForTesting();
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('a comment marker says what was found (G5)', () => {
  // The verdict's technique has a title in the table: the marker carries it and the dot reads that title.
  const titled: Array<[string, string]> = [
    ['self-harm', 'Self-harm risk'],
    ['sexual', 'Sexual content'],
    ['body-comparison-priming', 'Body comparison'],
    ['parasocial-coercion', 'Loyalty test'],
    ['hyperreal-trauma-bait', 'Synthetic AI drama'],
    ['violence-graphic', 'Graphic violence'],   // narrated violence is called this by the coded check since G7
    ['consumer-rapid-frame', 'Buy-now pressure'],
    ['false-urgency', 'Manufactured rush'],
  ];
  for (const [technique, title] of titled) {
    it(`a '${technique}' verdict renders a marker whose analysis carries that technique: the dot reads "${title}"`, async () => {
      const r = await markerAnalysisFor(technique);
      expect(r.rendered, 'the marker still renders').toBe(true);
      expect(r.primaryTechnique).toBe(technique);
      expect(MARKER_TITLES.en[technique as keyof typeof MARKER_TITLES.en]).toBe(title);
    });
  }

  // Green before and after: the eight names the hand list held keep passing through.
  for (const technique of ['fear-appeal', 'shame-attack', 'anger-trigger', 'bandwagon', 'fomo', 'scapegoating', 'toxic-positivity', 'misleading-format']) {
    it(`a '${technique}' verdict keeps its technique, as before`, async () => {
      const r = await markerAnalysisFor(technique);
      expect(r.rendered).toBe(true);
      expect(r.primaryTechnique).toBe(technique);
    });
  }

  // Green before and after: these keep the generic title.
  // 'profanity' stays generic too (critic 1, G5-CRITIC.md 3): its fallback reason counts the evidence, and on a comment the
  // evidence is the judge's reason string (always 1), so the count line would say "one word from the filter list" of a
  // verdict the judge made. It gets its title when that line knows whether its evidence is terms or a reason.
  for (const technique of ['combined', 'pile-on', 'mockery', 'profanity', 'constructor', 'toString']) {
    it(`a '${technique}' verdict keeps the generic title (no primaryTechnique)`, async () => {
      const r = await markerAnalysisFor(technique);
      expect(r.rendered, 'the marker still renders, as before').toBe(true);
      expect(r.primaryTechnique).toBeUndefined();
    });
  }
});
