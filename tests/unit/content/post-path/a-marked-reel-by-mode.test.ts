/** @vitest-environment jsdom */
// A marked TikTok video, by mode (src/content/post-path/video-feed-words.ts). The record's anchor on
// TikTok's feed is the whole video item. Handed that item, the rewrite and the fold wrote their text
// over everything inside it, so the video and its buttons were gone and the card held one line of
// text. Now the words go to the caption and nowhere else:
//   Child: the video is skipped, and the record says hide.
//   Teen:  the caption is rewritten and the video stays.
//   Adult: the caption keeps its words, marked in yellow, and the video stays.
// A fold on a video is a hide in every mode. Each case is checked on the page and in the record.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ mode: 'teen' as 'child' | 'teen' | 'adult' }));

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    getSettings: vi.fn(async () => ({ mode: state.mode, uiLanguage: 'en', dailyCap: 2000, features: {} })),
    isFeatureEnabled: vi.fn(() => true),
  };
});
vi.mock('../../../../src/content/record/forensic-retry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/content/record/forensic-retry')>();
  return { ...actual, sendHighStakesForensicLog: vi.fn(async () => 'accepted' as const) };
});
vi.mock('../../../../src/core/calibration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/core/calibration')>()),
  getEffectiveThreshold: vi.fn(async () => 0.45),
}));
vi.mock('../../../../src/storage/context-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/context-guard')>();
  return { ...actual, safeSendMessage: vi.fn(() => undefined) };
});

import { injectIntoElement, injectCollapseOrHide } from '../../../../src/content/injector';
import {
  _applyNeutralizedRewriteTerminalForTesting as applyNeutralizedRewriteTerminal,
  _clearSessionVerdictCachesOnModeChangeForTesting,
  _mountProtectionForTesting,
  _onProcessingResultForTesting as onProcessingResult,
  _setActiveAdapterForTesting,
  _setChildProtectionModeForTesting,
} from '../../../../src/content/index';
import { _resetForensicDedupForTesting } from '../../../../src/content/record/forensic-gate';
import { _resetDiagnosticsForTesting } from '../../../../src/diagnostics/diagnostics';
import { sendHighStakesForensicLog } from '../../../../src/content/record/forensic-retry';
import { _resetAdvanceBreakerForTesting, _setHostForTesting, SILENCED_ATTR } from '../../../../src/content/protection/video-feed-hide';
import { MARKER_STRINGS } from '../../../../src/i18n/marker-strings';
import { YELLOW_ATTR, videoWordsOf, kindOnVideo } from '../../../../src/content/post-path/video-feed-words';
import type { AnalysisResult } from '../../../../src/types/analysis';
import type { NeutralizedContent } from '../../../../src/types/neutralization';
import type { PipelineResult } from '../../../../src/analysis/pipeline';
import type { PostContent } from '../../../../src/types/post';
import type { PlatformAdapter } from '../../../../src/content/platforms/adapter';
import type { FWSettings } from '../../../../src/storage/settings';

const CAPTION = 'you will never be enough unless you buy this';
const REWRITE = 'this product is being promoted here';

function judged(): AnalysisResult {
  return {
    postId: 'tk1',
    techniques: [{ technique: 'shame-attack', present: true, confidence: 0.9, severity: 7, evidence: [] }],
    overallScore: 7,
    overallConfidence: 0.9,
    isManipulative: true,
    processingTimeMs: 1,
    primaryTechnique: 'shame-attack',
    explanation: 'it shames the viewer into buying',
    judge: {
      id: 'judge-v1', hash: 'judge-hash', model: 'openai/gpt-oss-120b',
      charged: true, family: 'hostile', severity: 7, effect: 'recruit', intent: 'react',
    },
  } as AnalysisResult;
}

function rewrite(): NeutralizedContent {
  return {
    postId: 'tk1', originalHash: 'h', rewrittenText: REWRITE, analysis: judged(),
    aiSource: 'cloud', processingTimeMs: 1, writerModel: 'openai/gpt-oss-20b',
  };
}

interface Reel { box: HTMLElement; video: HTMLVideoElement; caption: HTMLElement }

/** An Instagram reel as _extractReelSurface reads it: the box under <main>, its video, its caption span. */
function instagramReel(): Reel {
  const main = document.createElement('main');
  const box = document.createElement('div');
  const video = document.createElement('video');
  const caption = document.createElement('span');
  caption.setAttribute('dir', 'auto');
  caption.textContent = CAPTION;
  const rail = document.createElement('div');
  rail.innerHTML = '<button aria-label="Like"></button>';
  box.append(video, caption, rail);
  main.appendChild(box);
  document.body.appendChild(main);
  return { box, video, caption };
}

function postFor(reel: Reel): PostContent {
  return {
    id: 'ig1', text: CAPTION, author: 'seller', timestamp: '2026-09-26T04:00:00Z',
    platform: 'instagram', domRef: new WeakRef(reel.caption), kind: 'post',
  } as unknown as PostContent;
}

function records(): Record<string, unknown>[] {
  return vi.mocked(sendHighStakesForensicLog).mock.calls
    .map(c => c[0] as { type: string; payload: Record<string, unknown> })
    .filter(m => m.type === 'FORENSIC_LOG')
    .map(m => m.payload);
}

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 5));
}

function useMode(mode: 'child' | 'teen' | 'adult'): void {
  state.mode = mode;
  _setChildProtectionModeForTesting(mode);
}

beforeEach(() => {
  document.body.innerHTML = '';
  _resetForensicDedupForTesting();
  _clearSessionVerdictCachesOnModeChangeForTesting();
  _resetDiagnosticsForTesting();
  _resetAdvanceBreakerForTesting();
  _setHostForTesting('www.instagram.com');
  history.pushState({}, '', '/reels/AAA/');
  _setActiveAdapterForTesting({ platform: 'instagram' } as unknown as PlatformAdapter);
  vi.mocked(sendHighStakesForensicLog).mockClear();
  useMode('teen');
});
afterEach(() => { _setHostForTesting(null); history.pushState({}, '', '/'); });

describe('a marked Instagram reel, by mode', () => {
  it('Teen: the caption is rewritten, the reel and its video stay', async () => {
    const reel = instagramReel();
    onProcessingResult(postFor(reel), {
      action: 'neutralize', neutralized: rewrite(), detectionMode: 'combined-detect-neutralize',
      aiMeta: { model: 'openai/gpt-oss-120b', provider: 'deepinfra' },
    } as PipelineResult);
    await settle();
    expect(reel.box.contains(reel.video)).toBe(true);
    expect(reel.caption.textContent).toContain(REWRITE);
    expect(reel.box.style.getPropertyValue('display')).toBe('');
  });

  it('Adult: the caption keeps its words in yellow, the video plays, the record says mark', async () => {
    useMode('adult');
    const reel = instagramReel();
    onProcessingResult(postFor(reel), {
      action: 'neutralize', neutralized: rewrite(), detectionMode: 'combined-detect-neutralize',
      aiMeta: { model: 'openai/gpt-oss-120b', provider: 'deepinfra' },
    } as PipelineResult);
    await settle();
    expect(reel.box.contains(reel.video)).toBe(true);
    expect(reel.caption.textContent).toContain(CAPTION);
    expect(reel.caption.getAttribute(YELLOW_ATTR)).toBe('true');
    expect(reel.box.hasAttribute(SILENCED_ATTR)).toBe(false);
    const decision = records()[0].decision as { applied: string };
    expect(decision.applied).toBe('mark');
  });

  it('Child: the caption says the kind line, the reel is paused, its box is never hidden or wiped', () => {
    useMode('child');
    const reel = instagramReel();
    vi.spyOn(reel.video, 'pause').mockImplementation(() => undefined);
    const post = postFor(reel);
    _mountProtectionForTesting(post, performance.now());
    const terminal = applyNeutralizedRewriteTerminal(
      post, reel.caption, rewrite(), { mode: 'child', uiLanguage: 'en', features: {} } as unknown as FWSettings,
    );
    expect(terminal).toBe('skipped');
    expect(reel.box.contains(reel.video)).toBe(true);
    expect(reel.box.style.getPropertyValue('display')).toBe('');
    expect(reel.box.style.getPropertyValue('visibility')).toBe('');
    expect(reel.box.textContent).toContain(MARKER_STRINGS.en.skipLineChild);
    expect(reel.box.getAttribute(SILENCED_ATTR)).toBe('true');
  });

  it('the reel words point at the caption, and the box alone gives nothing to write to', () => {
    const reel = instagramReel();
    const words = videoWordsOf(reel.caption);
    expect(words?.item).toBe(reel.box);
    expect(words?.caption).toBe(reel.caption);
    expect(words?.skipTarget).toBe(reel.caption);
    expect(videoWordsOf(reel.box)).toBeNull();
    expect(kindOnVideo(reel.caption, 'collapse')).toBe('hide');
  });
});
