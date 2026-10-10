/** @vitest-environment jsdom */
// A hide or collapse verdict whose DOM change cannot be applied must not
// uncover the post in Child, and the signed record must not say "hidden"
// (audit PROTECTION-PATH-5 / MEDIA-ENGAGEMENT-8): before this the live
// terminal released the cover and wrote FORENSIC_LOG with action hide.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/storage/settings')>();
  return {
    ...actual,
    getSettings: vi.fn(async () => ({ mode: 'child', uiLanguage: 'en', dailyCap: 200 })),
    isFeatureEnabled: vi.fn(() => true),
  };
});

vi.mock('../../../src/content/injector', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/content/injector')>();
  return {
    ...actual,
    injectIntoElement: vi.fn(),
    injectCollapseOrHide: vi.fn(() => false),
    injectAdHide: vi.fn(() => false),
    injectHardHide: vi.fn(() => false),
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
  _setChildProtectionModeForTesting,
  _mountProtectionForTesting,
} from '../../../src/content/index';
import { _resetForensicDedupForTesting } from '../../../src/content/record/forensic-gate';
import { getSettings } from '../../../src/storage/settings';
import { sendHighStakesForensicLog } from '../../../src/content/record/forensic-retry';
import type { AnalysisResult } from '../../../src/types/analysis';
import type { PostContent } from '../../../src/types/post';
import type { PipelineResult } from '../../../src/analysis/pipeline';
import type { PlatformAdapter } from '../../../src/content/platforms/adapter';

function makePost(id: string, text: string): { post: PostContent; article: HTMLElement } {
  const article = document.createElement('article');
  article.setAttribute('role', 'article');
  const textEl = document.createElement('div');
  textEl.dataset.testid = 'tweetText';
  textEl.textContent = text;
  article.appendChild(textEl);
  document.body.appendChild(article);
  const post = {
    id,
    text,
    author: '@someone',
    timestamp: '2026-08-23T00:00:00Z',
    platform: 'twitter',
    domRef: new WeakRef(textEl),
    kind: 'post',
  } as unknown as PostContent;
  return { post, article };
}

function hideVerdict(postId: string): PipelineResult {
  const analysis: AnalysisResult = {
    postId,
    isManipulative: true,
    overallScore: 9,
    overallConfidence: 0.99,
    processingTimeMs: 1,
    techniques: [{ technique: 'shame-attack', present: true, confidence: 0.99, severity: 9, evidence: ['slur'] }],
    primaryTechnique: 'shame-attack',
    action: 'hide',
  };
  return { action: 'hide', analysis, detectionMode: 'identity-slur' };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5));
}

beforeEach(() => {
  _resetForensicDedupForTesting();
  _clearSessionVerdictCachesOnModeChangeForTesting();
  _setActiveAdapterForTesting({ platform: 'twitter' } as unknown as PlatformAdapter);
  vi.mocked(sendHighStakesForensicLog).mockClear();
  document.body.innerHTML = '';
});

describe('hide verdict whose visual does not apply', () => {
  it('Child: the cover stays on and the record says visualApplied:false', async () => {
    vi.mocked(getSettings).mockResolvedValue({ mode: 'child', uiLanguage: 'en', dailyCap: 200 } as never);
    _setChildProtectionModeForTesting('child');
    const { post, article } = makePost('hide-fail-child', 'you are a worthless slur and everyone knows it');
    _mountProtectionForTesting(post, performance.now());
    expect(article.querySelector('.fw-provisional-shield')).not.toBeNull();

    onProcessingResult(post, hideVerdict(post.id));
    await settle();

    expect(article.querySelector('.fw-provisional-shield')).not.toBeNull();
    const forensic = vi.mocked(sendHighStakesForensicLog).mock.calls
      .map((c) => c[0] as { type: string; payload: { visualApplied?: false } })
      .find((m) => m.type === 'FORENSIC_LOG');
    expect(forensic).toBeDefined();
    expect(forensic?.payload.visualApplied).toBe(false);
  });

  it('Teen: the record says visualApplied:false and nothing is left covered', async () => {
    vi.mocked(getSettings).mockResolvedValue({ mode: 'teen', uiLanguage: 'en', dailyCap: 200 } as never);
    _setChildProtectionModeForTesting('teen');
    const { post, article } = makePost('hide-fail-teen', 'you are a worthless slur and everyone knows it too');

    onProcessingResult(post, hideVerdict(post.id));
    await settle();

    expect(article.querySelector('.fw-provisional-shield')).toBeNull();
    const forensic = vi.mocked(sendHighStakesForensicLog).mock.calls
      .map((c) => c[0] as { type: string; payload: { visualApplied?: false } })
      .find((m) => m.type === 'FORENSIC_LOG');
    expect(forensic?.payload.visualApplied).toBe(false);
  });
});
