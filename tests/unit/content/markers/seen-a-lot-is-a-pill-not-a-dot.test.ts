/** @vitest-environment jsdom */
// The "seen a lot" notice is a count about a source, not a verdict about a post (13 Oct 2026). On the page it is a quiet
// pill with its sentence, never the severity dot, at every level; it changes no text; the record claims no severity and
// no manipulation; and the page tells the profile which surface the sighting came from and whether the notice spoke,
// so the gate counts only the recommended feed and keeps its once-a-day cap across tabs.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const level = vi.hoisted(() => ({ mode: 'adult' as 'adult' | 'teen' | 'child' }));

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    getSettings: vi.fn(async () => ({ mode: level.mode, uiLanguage: 'en', dailyCap: 2000, features: {} })),
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

import {
  _clearSessionVerdictCachesOnModeChangeForTesting,
  _onProcessingResultForTesting as onProcessingResult,
  _setActiveAdapterForTesting,
  _setChildProtectionModeForTesting,
} from '../../../../src/content/index';
import { _resetForensicDedupForTesting } from '../../../../src/content/record/forensic-gate';
import { _resetDiagnosticsForTesting } from '../../../../src/diagnostics/diagnostics';
import { sendHighStakesForensicLog } from '../../../../src/content/record/forensic-retry';
import { safeSendMessage } from '../../../../src/storage/context-guard';
import { isFeatureEnabled } from '../../../../src/storage/settings';
import { exposureMarkResult, type PipelineResult } from '../../../../src/analysis/pipeline';
import { seenALotSentence, SEEN_PILL_CLASS } from '../../../../src/content/markers/seen-a-lot-pill';
import { MARKER_STRINGS } from '../../../../src/i18n/marker-strings';
import type { ExposurePressure } from '../../../../src/forensics/author-store';
import type { AnalysisResult } from '../../../../src/types/analysis';
import type { PostContent, FeedSource } from '../../../../src/types/post';
import type { PlatformAdapter } from '../../../../src/content/platforms/adapter';

const ORIGINAL = 'Ordinary copy that no severity gate would ever flag.';

const days: ExposurePressure = { fired: true, reason: 'days', distinctDays: 9, creativeCount: 0, surface: 'for-you' };
const sameOne: ExposurePressure = { fired: true, reason: 'creative', distinctDays: 2, creativeCount: 5, surface: 'for-you' };

function xPost(): { body: HTMLElement } {
  const cell = document.createElement('div');
  cell.setAttribute('data-testid', 'cellInnerDiv');
  const article = document.createElement('article');
  article.setAttribute('role', 'article');
  const body = document.createElement('div');
  body.setAttribute('data-testid', 'tweetText');
  const span = document.createElement('span');
  span.textContent = ORIGINAL;
  body.appendChild(span);
  article.appendChild(body);
  cell.appendChild(article);
  document.body.appendChild(cell);
  return { body };
}

function postOn(body: HTMLElement, feedSource: FeedSource = 'for-you', id = 'seen-1'): PostContent {
  return {
    id, text: ORIGINAL, author: '@someone', timestamp: '2026-10-13T08:00:00Z',
    platform: 'twitter', domRef: new WeakRef(body), kind: 'post', feedSource,
  } as unknown as PostContent;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 5));
}

function records(): Record<string, unknown>[] {
  return vi.mocked(sendHighStakesForensicLog).mock.calls
    .map((c) => c[0] as { type: string; payload: Record<string, unknown> })
    .filter((m) => m.type === 'FORENSIC_LOG')
    .map((m) => m.payload);
}

function authorUpdates(): { surface?: string; noticed?: boolean; day?: string }[] {
  return vi.mocked(safeSendMessage).mock.calls
    .map((c) => c[0] as { type: string; payload: { surface?: string; noticed?: boolean; day?: string } })
    .filter((m) => m.type === 'AUTHOR_UPDATE')
    .map((m) => m.payload);
}

beforeEach(() => {
  document.body.innerHTML = '';
  _resetForensicDedupForTesting();
  _clearSessionVerdictCachesOnModeChangeForTesting();
  _resetDiagnosticsForTesting();
  _setActiveAdapterForTesting({ platform: 'twitter' } as unknown as PlatformAdapter);
  vi.mocked(sendHighStakesForensicLog).mockClear();
  vi.mocked(safeSendMessage).mockClear();
});
afterEach(() => {
  level.mode = 'adult';
  _setChildProtectionModeForTesting('adult');
  vi.mocked(isFeatureEnabled).mockImplementation(() => true);
});

describe('the sentence', () => {
  it('says the count about the account or about the post', () => {
    const a = exposureMarkResult(postOn(xPost().body), days, 0).analysis as AnalysisResult;
    const b = exposureMarkResult(postOn(xPost().body), sameOne, 0).analysis as AnalysisResult;
    expect(seenALotSentence(a, 'en')).toBe('This account reached you on 9 days this month');
    expect(seenALotSentence(b, 'en')).toBe('This same post reached you 5 times');
  });

  it('exists in every language (English until the words route sends the others) and carries the count', () => {
    const a = exposureMarkResult(postOn(xPost().body), days, 0).analysis as AnalysisResult;
    const languages = Object.keys(MARKER_STRINGS) as (keyof typeof MARKER_STRINGS)[];
    expect(languages.length).toBe(4);
    for (const lang of languages) {
      expect(seenALotSentence(a, lang)).toContain('9');
    }
  });

  it('says nothing when the analysis carries no count', () => {
    const a = exposureMarkResult(postOn(xPost().body), days, 0).analysis as AnalysisResult;
    expect(seenALotSentence({ ...a, exposure: undefined }, 'en')).toBeNull();
    expect(seenALotSentence({ ...a, exposure: { reason: 'days', count: 0, surface: 'for-you' } }, 'en')).toBeNull();
  });
});

describe.each(['teen', 'adult', 'child'] as const)('on the page at %s', (mode) => {
  beforeEach(() => {
    level.mode = mode;
    _setChildProtectionModeForTesting(mode);
  });

  it('a count is a pill after the text, never the dot, and the words are the author\'s', async () => {
    const { body } = xPost();
    const post = postOn(body);
    onProcessingResult(post, exposureMarkResult(post, days, 0) as PipelineResult);
    await settle();
    const pills = body.querySelectorAll(`.${SEEN_PILL_CLASS}`);
    expect(pills).toHaveLength(1);
    expect(pills[0].textContent).toBe('This account reached you on 9 days this month');
    expect(body.querySelector('.fw-teen-marker')).toBeNull();
    expect(body.querySelector('span')?.textContent).toBe(ORIGINAL);
    expect(body.getAttribute('data-fw-neutralized')).toBeNull();
  });

  it('the same post again keeps one pill', async () => {
    const { body } = xPost();
    const post = postOn(body);
    onProcessingResult(post, exposureMarkResult(post, sameOne, 0) as PipelineResult);
    await settle();
    onProcessingResult(post, exposureMarkResult(post, sameOne, 0) as PipelineResult);
    await settle();
    const pills = body.querySelectorAll(`.${SEEN_PILL_CLASS}`);
    expect(pills).toHaveLength(1);
    expect(pills[0].textContent).toBe('This same post reached you 5 times');
  });
});

describe('with the markers switched off', () => {
  it('there is no pill and the record is still written', async () => {
    vi.mocked(isFeatureEnabled).mockImplementation((_s, name) => name !== 'show-reframe-markers');
    const { body } = xPost();
    const post = postOn(body);
    onProcessingResult(post, exposureMarkResult(post, days, 0) as PipelineResult);
    await settle();
    expect(body.querySelector(`.${SEEN_PILL_CLASS}`)).toBeNull();
    expect(records()).toHaveLength(1);
  });
});

describe('the record', () => {
  it('names the count and the surface and claims no severity and no manipulation', async () => {
    const { body } = xPost();
    const post = postOn(body);
    onProcessingResult(post, exposureMarkResult(post, days, 0) as PipelineResult);
    await settle();
    const [record] = records();
    const analysis = record.analysis as AnalysisResult;
    expect(analysis.isManipulative).toBe(false);
    expect(analysis.overallScore).toBe(0);
    expect(analysis.techniques).toHaveLength(1);
    expect(analysis.techniques[0].technique).toBe('repeat-exposure');
    expect(analysis.techniques[0].severity).toBe(0);
    expect(analysis.techniques[0].evidence).toEqual(['source reached you on 9 of the last 30 days, on the for-you feed']);
    expect(record.neutralizedText).toBe('');
  });
});

describe('what the page tells the profile', () => {
  it('carries the surface of the sighting and says the notice spoke', async () => {
    const { body } = xPost();
    const post = postOn(body, 'for-you');
    onProcessingResult(post, exposureMarkResult(post, days, 0) as PipelineResult);
    await settle();
    const updates = authorUpdates();
    expect(updates).toHaveLength(1);
    expect(updates[0].surface).toBe('for-you');
    expect(updates[0].noticed).toBe(true);
  });

  it('a mark that is not the count does not say the notice spoke, and the surface passes through', async () => {
    const { body } = xPost();
    const post = postOn(body, 'following', 'flag-1');
    const judged: AnalysisResult = {
      postId: 'flag-1',
      techniques: [{ technique: 'shame-attack', present: true, confidence: 0.9, severity: 7, evidence: [] }],
      overallScore: 7, overallConfidence: 0.9, isManipulative: true, processingTimeMs: 1,
      primaryTechnique: 'shame-attack', explanation: 'it shames the reader for a belief',
    };
    onProcessingResult(post, { action: 'mark', analysis: judged, detectionMode: 'combined-detect-neutralize' } as PipelineResult);
    await settle();
    const updates = authorUpdates();
    expect(updates).toHaveLength(1);
    expect(updates[0].surface).toBe('following');
    expect(updates[0].noticed).toBe(false);
    expect(body.querySelector(`.${SEEN_PILL_CLASS}`)).toBeNull();
    expect(body.querySelector('.fw-teen-marker')).not.toBeNull();
  });
});
