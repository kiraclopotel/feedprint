// @vitest-environment jsdom
// G7 (the grow owner's row G7, the violence label G2 left out and G5 needed). A post or comment caught by the local coded-harm
// check for narrated violence was filed under 'hyperreal-trauma-bait', so its hide notice said it hid "AI-generated synthetic
// content", which is untrue of a real violent post. It is now called 'violence-graphic', and the notice names graphic violence.
//
// What does not change, and is pinned here green before and after: the post still ends hidden at severity 8 in every mode with
// no AI called, by the rule's own action; no step on the coded path hides the post's media (the classifier path's
// violence-graphic media hide is a different path); and the AI's own 'hyperreal-trauma-bait' verdict keeps its name and its
// notice line "AI-generated synthetic content".

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FWSettings } from '../../../src/storage/settings';

type Mode = FWSettings['mode'];

let currentMode: Mode = 'teen';
const combinedMock = vi.fn();

function makeSettings(mode: Mode): FWSettings {
  return {
    mode,
    strictLanguage: false,
    dailyCap: 0,
    monthlyUsdCapOverride: null,
    locale: 'en',
    outputLanguage: 'auto',
    totalChecksToday: 0,
    totalTokensThisMonth: 0,
  } as unknown as FWSettings;
}

vi.mock('../../../src/storage/settings', () => ({
  getSettings: vi.fn(async () => makeSettings(currentMode)),
}));
vi.mock('../../../src/storage/license', () => ({
  getLicense: vi.fn(async () => ({ tier: 'free', secret: '' })),
  dailyCapForTier: (tier: string) => (tier === 'free' ? 0 : 2000),
  effectiveMonthlyTokenCap: () => 1e12,
  isUncappedTier: (tier: string) => tier === 'dev',
}));
vi.mock('../../../src/core/neutralizer', () => ({
  combinedDetectAndNeutralize: (...args: unknown[]) => combinedMock(...args),
}));
vi.mock('../../../src/ai/neutralize-only', () => ({ neutralizeText: vi.fn(async () => '') }));
vi.mock('../../../src/forensics/hasher', () => ({ sha256: vi.fn(async () => 'hash') }));
vi.mock('../../../src/forensics/author-store', () => ({
  getAuthorProfile: vi.fn(async () => null),
}));
vi.mock('../../../src/storage/cache', () => ({
  processingCache: {
    getPersistent: vi.fn(async () => null),
    get: vi.fn(() => null),
    set: vi.fn(),
  },
}));
vi.mock('../../../src/core/calibration', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../src/core/calibration')>()), getEffectiveThreshold: vi.fn(async () => 0.4) }));
vi.mock('../../../src/diagnostics/perf-trace', () => ({
  startTrace: vi.fn(async () => ({ wrap: async (_s: unknown, fn: () => unknown) => fn() })),
}));
vi.mock('../../../src/ai/client', () => ({ getLastCallMeta: vi.fn(() => undefined), callAI: vi.fn() }));
vi.mock('../../../src/storage/feature-flags', () => ({ isFeatureEnabled: vi.fn(async () => false) }));
vi.mock('../../../src/ai/global-flush-budget', () => ({ isHolding: vi.fn(() => false), recordFailure: vi.fn() }));
vi.mock('../../../src/analysis/comment-rewriter', () => ({ validateRewriteLanguage: vi.fn(() => true) }));

import { process } from '../../../src/analysis/pipeline';
import { injectCollapseOrHide } from '../../../src/content/injector';
import { detectCodedHarm, codedHarmVerdictFields } from '../../../src/core/coded-harm-catcher';
import type { PostContent } from '../../../src/types/post';

function makePost(text: string): PostContent {
  return {
    id: 'p1',
    text,
    author: '',
    timestamp: '2026-09-30T00:00:00.000Z',
    platform: 'twitter',
    domRef: new WeakRef({} as unknown as HTMLElement),
  } as PostContent;
}


// Narrated violence, from the catcher's own fixtures (coded-harm-catcher.test.ts), padded to clear the pipeline's
// substantive-text floor (>=3 words, >=12 chars).
const VIOLENCE_TEXT = 'petrol bomb thrown at the crowd';

function postHost(): HTMLElement {
  const article = document.createElement('article');
  const text = document.createElement('div');
  text.setAttribute('data-testid', 'tweetText');
  text.textContent = VIOLENCE_TEXT;
  article.appendChild(text);
  document.body.appendChild(article);
  return text;
}

beforeEach(() => {
  combinedMock.mockReset();
  currentMode = 'teen';
  document.body.innerHTML = '';
});

describe('a violent find is called violence', () => {
  it('the mapping calls narrated violence graphic violence, severity 8, hidden', () => {
    const hit = detectCodedHarm(VIOLENCE_TEXT);
    expect(hit?.category, 'the catcher reaches the category').toBe('violence-narration');
    expect(codedHarmVerdictFields(hit!)).toEqual({ technique: 'violence-graphic', severity: 8, hideTier: true });
  });

  for (const mode of ['child', 'teen', 'adult'] as const) {
    it(`${mode}: the post ends hidden at severity 8 with no AI, its record names violence-graphic, and the hide notice names graphic violence`, async () => {
      currentMode = mode;
      const result = await process(makePost(VIOLENCE_TEXT));

      // Green before and after: what is hidden, how severe, how decided.
      expect(result.action).toBe('hide');
      expect(result.analysis?.overallScore).toBe(8);
      expect(result.detectionMode).toBe('coded-harm:violence-narration');
      expect(combinedMock, 'no AI was called').not.toHaveBeenCalled();
      expect(result.analysis?.techniques.map((t) => t.technique)).toEqual(['violence-graphic']);

      // The notice a person reads.
      const host = postHost();
      injectCollapseOrHide(host, result.analysis!, 'hide', false, VIOLENCE_TEXT, 'en');
      expect(host.textContent).toContain('graphic violence');
      expect(host.textContent).not.toContain('AI-generated synthetic');
    });
  }

  it('the coded path never hides the post media (no new media hide beside the name)', async () => {
    const article = document.createElement('article');
    const video = document.createElement('video');
    const host = document.createElement('div');
    host.setAttribute('data-testid', 'tweetText');
    host.textContent = VIOLENCE_TEXT;
    article.append(host, video);
    document.body.appendChild(article);
    const result = await process(makePost(VIOLENCE_TEXT));
    expect(result.action).toBe('hide');
    expect(video.style.display, 'the pipeline touches no element').not.toBe('none');
  });

  it("the AI's own 'hyperreal-trauma-bait' verdict keeps its name and its notice line", () => {
    const host = postHost();
    injectCollapseOrHide(host, {
      postId: 'p1',
      techniques: [{ technique: 'hyperreal-trauma-bait', present: true, confidence: 0.9, severity: 7, evidence: [] }],
      overallScore: 7, overallConfidence: 0.9, isManipulative: true, processingTimeMs: 0,
      primaryTechnique: 'hyperreal-trauma-bait', explanation: 'x',
    }, 'hide', false, VIOLENCE_TEXT, 'en');
    expect(host.textContent).toContain('AI-generated synthetic');
  });
});
