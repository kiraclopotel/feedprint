/** @vitest-environment jsdom */
// E1 — adult Block Ads: visual gate + record shape (owner live report
// 2026-08-04, x.com/home).
//
// The contract locked here, on the live collapse/hide apply path
// (onProcessingResult):
//   1. Adult + Block Ads ON + 'sponsored-ad:adult' verdict → the ad is
//      FULLY removed (injectAdHide) and the chain gets a BLOCKED_LOG
//      category event (blockReason 'ads') — never a FORENSIC_LOG, so an ad
//      can never enter an adult's record as a manipulation finding, and no
//      NEUTRALIZATION_COMPLETE (a category block is not a neutralization).
//   2. Adult + Block Ads OFF → the ad stays visible and the chain says so
//      (wiring audit 2026-09-13, C7): a FORENSIC_LOG whose decision block
//      names the sponsored row with applied 'allow' and the switched-off
//      note, no technique and no score, so it derives to a pass and the
//      paid-placement count still sees the ad; the intervention ledger reads
//      suppressed/setting-disabled, not failed. Until 2026-09-13 nothing was
//      written, so the export measured ads acted on, not ads served.
//   3. Child keeps the pre-existing shape untouched: 'sponsored-ad' verdict
//      → injectAdHide + FORENSIC_LOG with the deterministic
//      consumer-rapid-frame analysis.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NOTE_SETTING_OFF } from '../../../src/content/record/decision';

vi.mock('../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/storage/settings')>();
  return {
    ...actual,
    getSettings: vi.fn(async () => ({ mode: 'adult', uiLanguage: 'en', dailyCap: 200 })),
    isFeatureEnabled: vi.fn(() => true),
  };
});

vi.mock('../../../src/content/injector', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/content/injector')>();
  return {
    ...actual,
    injectIntoElement: vi.fn(),
    injectCollapseOrHide: vi.fn(() => true),
    injectAdHide: vi.fn(() => true),
    injectHardHide: vi.fn(() => true),
    markOnlyElement: vi.fn(),
  };
});

vi.mock('../../../src/content/record/forensic-retry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/content/record/forensic-retry')>();
  return {
    ...actual,
    sendHighStakesForensicLog: vi.fn(async () => 'accepted' as const),
  };
});

vi.mock('../../../src/core/calibration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/core/calibration')>()),
  getEffectiveThreshold: vi.fn(async () => 0.45),
}));

vi.mock('../../../src/storage/context-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/storage/context-guard')>();
  return {
    ...actual,
    safeSendMessage: vi.fn(() => undefined),
  };
});

import {
  _onProcessingResultForTesting as onProcessingResult,
  _setActiveAdapterForTesting,
  _clearSessionVerdictCachesOnModeChangeForTesting,
} from '../../../src/content/index';
import { _resetForensicDedupForTesting } from '../../../src/content/record/forensic-gate';
import { _resetDiagnosticsForTesting, _getDiagnosticCountersForTesting } from '../../../src/diagnostics/diagnostics';
import { getSettings, isFeatureEnabled } from '../../../src/storage/settings';
import { injectAdHide, injectCollapseOrHide } from '../../../src/content/injector';
import { sendHighStakesForensicLog } from '../../../src/content/record/forensic-retry';
import { safeSendMessage } from '../../../src/storage/context-guard';
import type { AnalysisResult } from '../../../src/types/analysis';
import type { PostContent } from '../../../src/types/post';
import type { PipelineResult } from '../../../src/analysis/pipeline';
import type { PlatformAdapter } from '../../../src/content/platforms/adapter';

function makePost(id: string, text: string): { post: PostContent; el: HTMLElement } {
  const el = document.createElement('article');
  el.textContent = text;
  document.body.appendChild(el);
  const post = {
    id,
    text,
    author: '@brand',
    timestamp: '2026-08-04T00:00:00Z',
    platform: 'twitter',
    domRef: new WeakRef(el),
    kind: 'post',
    is_sponsored: true,
  } as unknown as PostContent;
  return { post, el };
}

function adultAdVerdict(postId: string): PipelineResult {
  const analysis: AnalysisResult = {
    postId,
    isManipulative: false,
    overallScore: 0,
    overallConfidence: 0.99,
    processingTimeMs: 1,
    techniques: [],
    action: 'collapse',
  };
  return { action: 'collapse', analysis, detectionMode: 'sponsored-ad:adult' };
}

function childAdVerdict(postId: string): PipelineResult {
  const analysis: AnalysisResult = {
    postId,
    isManipulative: true,
    overallScore: 6,
    overallConfidence: 0.99,
    processingTimeMs: 1,
    techniques: [{
      technique: 'consumer-rapid-frame',
      present: true,
      confidence: 0.99,
      severity: 6,
      evidence: ['platform sponsored/ad marker'],
    }],
    primaryTechnique: 'consumer-rapid-frame',
    action: 'collapse',
  };
  return { action: 'collapse', analysis, detectionMode: 'sponsored-ad' };
}

function setMode(mode: 'child' | 'teen' | 'adult'): void {
  vi.mocked(getSettings).mockResolvedValue(
    { mode, uiLanguage: 'en', dailyCap: 200 } as never,
  );
}

function setBlockAds(on: boolean): void {
  vi.mocked(isFeatureEnabled).mockImplementation(
    ((_s: never, id: string) => (id === 'block-ads' ? on : true)) as never,
  );
}

const counters = () => _getDiagnosticCountersForTesting();

async function settle(): Promise<void> {
  // The apply path runs in a fire-and-forget async closure; flush it.
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5));
}

beforeEach(() => {
  _resetForensicDedupForTesting();
  _clearSessionVerdictCachesOnModeChangeForTesting();
  _resetDiagnosticsForTesting();
  _setActiveAdapterForTesting({ platform: 'twitter' } as unknown as PlatformAdapter);
  vi.mocked(injectAdHide).mockClear().mockReturnValue(true);
  vi.mocked(injectCollapseOrHide).mockClear();
  vi.mocked(sendHighStakesForensicLog).mockClear();
  vi.mocked(safeSendMessage).mockClear();
  document.body.innerHTML = '';
});

describe('E1 — adult Block Ads ON removes the ad and records a category event', () => {
  it('injectAdHide runs and the ONLY chain write is BLOCKED_LOG reason ads', async () => {
    setMode('adult');
    setBlockAds(true);
    const { post } = makePost('ad-on-1', 'limited time only, act now before the deal expires');

    onProcessingResult(post, adultAdVerdict(post.id));
    await settle();

    expect(injectAdHide).toHaveBeenCalledTimes(1);
    expect(sendHighStakesForensicLog).toHaveBeenCalledTimes(1);
    const msg = vi.mocked(sendHighStakesForensicLog).mock.calls[0][0] as {
      type: string; payload: { blockReason: string; mode: string; caption: string; kind?: string; configSnapshot?: { mode: string; threshold: number; dailyCap: number } };
    };
    expect(msg.type).toBe('BLOCKED_LOG');
    expect(msg.payload.blockReason).toBe('ads');
    // M114: the blocked ad carries the post's own kind, not the historical 'video' stamp.
    expect(msg.payload.kind).toBe('post');
    expect(msg.payload.mode).toBe('adult');
    expect(msg.payload.caption).toBe(post.text);
    // The ad block carries the configuration it was reached under, like every
    // other emit site in result-apply (2026-09-06: 181 snapshot-less ad blocks).
    expect(msg.payload.configSnapshot).toMatchObject({ mode: 'relaxed' });
    expect(typeof msg.payload.configSnapshot!.threshold).toBe('number');
    expect(typeof msg.payload.configSnapshot!.dailyCap).toBe('number');
    expect(counters().postInterventionApplied).toBe(1);
  });

  it('never sends NEUTRALIZATION_COMPLETE for the adult category verdict', async () => {
    setMode('adult');
    setBlockAds(true);
    const { post } = makePost('ad-on-2', 'huge discount on everything today only friends');

    onProcessingResult(post, adultAdVerdict(post.id));
    await settle();

    // A category block is not a neutralization: the badge counter message
    // must not fire (child/teen keep firing it — asserted below).
    const types = vi.mocked(safeSendMessage).mock.calls
      .map((c) => (c[0] as { type: string }).type);
    expect(types).not.toContain('NEUTRALIZATION_COMPLETE');
    expect(types).toContain('SCAN_LOG');
  });
});

describe('E1 — adult Block Ads OFF shows the ad and records that it was served', () => {
  it('no visual, one pass record under the sponsored row with the switched-off note', async () => {
    setMode('adult');
    setBlockAds(false);
    const { post } = makePost('ad-off-1', 'our new phone case drops today, tap to browse it');

    onProcessingResult(post, adultAdVerdict(post.id));
    await settle();

    expect(injectAdHide).not.toHaveBeenCalled();
    expect(injectCollapseOrHide).not.toHaveBeenCalled();
    expect(sendHighStakesForensicLog).toHaveBeenCalledTimes(1);
    const msg = vi.mocked(sendHighStakesForensicLog).mock.calls[0][0] as {
      type: string;
      payload: { analysis: AnalysisResult; detectionMode: string; aiSource: string; decision?: { row: string; action: string; applied: string; note: string | null } };
    };
    expect(msg.type).toBe('FORENSIC_LOG');
    expect(msg.payload.detectionMode).toBe('sponsored-ad:adult');
    expect(msg.payload.aiSource).toBe('rules');
    // Never a finding: no technique, no score.
    expect(msg.payload.analysis.techniques).toEqual([]);
    expect(msg.payload.analysis.overallScore).toBe(0);
    expect(msg.payload.decision).toMatchObject({ row: 'R4', action: 'collapse', applied: 'allow', note: NOTE_SETTING_OFF });
    expect(counters().postInterventionSuppressed).toBe(1);
    expect(counters().postInterventionFailed).toBeUndefined();
  });
});

describe('E1 — child sponsored path is untouched', () => {
  it('child ad verdict still writes FORENSIC_LOG with the deterministic analysis', async () => {
    setMode('child');
    setBlockAds(true);
    const { post } = makePost('ad-child-1', 'fifty percent off today only, use code SAVE50 now');

    onProcessingResult(post, childAdVerdict(post.id));
    await settle();

    expect(injectAdHide).toHaveBeenCalledTimes(1);
    expect(sendHighStakesForensicLog).toHaveBeenCalledTimes(1);
    const msg = vi.mocked(sendHighStakesForensicLog).mock.calls[0][0] as {
      type: string; payload: { analysis: AnalysisResult; detectionMode: string };
    };
    expect(msg.type).toBe('FORENSIC_LOG');
    expect(msg.payload.detectionMode).toBe('sponsored-ad');
    expect(msg.payload.analysis.primaryTechnique).toBe('consumer-rapid-frame');
    // The RECORD is untouched, and since 2026-09-14 the badge counter is not:
    // an ad is a paid placement the reader's own Block Ads rule hid, so it
    // bumps no "actions today" figure in any mode (rebuild plan, standing
    // decision 1). The adult path has always been out; child and teen joined
    // it, which is half the hero number on the owner's own install.
    const types = vi.mocked(safeSendMessage).mock.calls
      .map((c) => (c[0] as { type: string }).type);
    expect(types).not.toContain('NEUTRALIZATION_COMPLETE');
  });
});
