/** @vitest-environment jsdom */
// On the page, a post hidden because the person switched a topic on (Topics U1, 13 Oct 2026) is hidden at every level, with
// the notice that says why in the level's own voice: at Calm and Open a one-line notice, "Mentions gambling", with "Show
// anyway" beside it; at Silent the post is simply gone and nothing is said. The record is written, and says R5.

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
import { MARKER_STRINGS } from '../../../../src/i18n/marker-strings';
import { ruleAnalysis } from '../../../../src/core/analysis-result';
import type { PipelineResult } from '../../../../src/analysis/pipeline';
import type { PostContent } from '../../../../src/types/post';
import type { PlatformAdapter } from '../../../../src/content/platforms/adapter';

const TEXT = 'Join the online casino today and get a no deposit bonus';

function xPost(): { cell: HTMLElement; body: HTMLElement } {
  const cell = document.createElement('div');
  cell.setAttribute('data-testid', 'cellInnerDiv');
  const article = document.createElement('article');
  article.setAttribute('role', 'article');
  const body = document.createElement('div');
  body.setAttribute('data-testid', 'tweetText');
  const span = document.createElement('span');
  span.textContent = TEXT;
  body.appendChild(span);
  article.appendChild(body);
  cell.appendChild(article);
  document.body.appendChild(cell);
  return { cell, body };
}

function postOn(body: HTMLElement): PostContent {
  return {
    id: 'topic-1', text: TEXT, author: '@someone', timestamp: '2026-10-13T08:00:00Z',
    platform: 'twitter', domRef: new WeakRef(body), kind: 'post', feedSource: 'for-you',
  } as unknown as PostContent;
}

const topicResult = (post: PostContent): PipelineResult => ({
  action: 'hide',
  analysis: ruleAnalysis({ postId: post.id, startTime: Date.now(), confidence: 1, action: 'hide' }),
  detectionMode: 'topic:gambling',
}) as PipelineResult;

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 5));
}

function records(): Record<string, unknown>[] {
  return vi.mocked(sendHighStakesForensicLog).mock.calls
    .map((c) => c[0] as { type: string; payload: Record<string, unknown> })
    .filter((m) => m.type === 'FORENSIC_LOG')
    .map((m) => m.payload);
}

beforeEach(() => {
  document.body.innerHTML = '';
  _resetForensicDedupForTesting();
  _clearSessionVerdictCachesOnModeChangeForTesting();
  _resetDiagnosticsForTesting();
  _setActiveAdapterForTesting({ platform: 'twitter' } as unknown as PlatformAdapter);
  vi.mocked(sendHighStakesForensicLog).mockClear();
});
afterEach(() => {
  level.mode = 'adult';
  _setChildProtectionModeForTesting('adult');
});

describe.each(['teen', 'adult'] as const)('at %s', (mode) => {
  beforeEach(() => {
    level.mode = mode;
    _setChildProtectionModeForTesting(mode);
  });

  it('the post is hidden behind one line that says "Mentions gambling", with Show anyway', async () => {
    const { cell, body } = xPost();
    const post = postOn(body);
    onProcessingResult(post, topicResult(post));
    await settle();
    const notice = cell.querySelector('[data-fw-hide-notice]');
    expect(notice?.textContent, 'the notice names who and why').toContain('Mentions gambling');
    expect(notice?.textContent).toContain('@someone');
    const button = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === MARKER_STRINGS.en.hideShowAnyway);
    expect(button, 'a way to see it anyway').toBeTruthy();
    const article = cell.querySelector('article')!;
    expect(article.getAttribute('data-fw-hard-hidden'), 'the post itself is out of the feed').toBe('true');
    expect(article.style.getPropertyValue('display')).toBe('none');
    // Show anyway brings it back, and the reveal is the person's: the notice stays so they can hide it again.
    (button as HTMLButtonElement).click();
    expect(article.style.getPropertyValue('display')).not.toBe('none');
    expect(article.textContent).toContain(TEXT);
  });

  it('writes the record: row R5, the topic rail, hide', async () => {
    const { body } = xPost();
    const post = postOn(body);
    onProcessingResult(post, topicResult(post));
    await settle();
    const [record] = records();
    expect(record, 'the hide is recorded').toBeTruthy();
    expect(record.detectionMode).toBe('topic:gambling');
    expect(record.aiSource).toBe('rules');
    expect(record.decision).toMatchObject({ row: 'R5', action: 'hide', rails: [{ name: 'topic', match: '' }], household: { topicRule: 'gambling' } });
  });
});

describe('at Silent', () => {
  beforeEach(() => {
    level.mode = 'child';
    _setChildProtectionModeForTesting('child');
  });

  it('the post is gone and the page says nothing about it', async () => {
    const { cell, body } = xPost();
    const post = postOn(body);
    onProcessingResult(post, topicResult(post));
    await settle();
    expect(cell.querySelector('article')!.style.getPropertyValue('display'), 'the post is gone').toBe('none');
    expect(cell.querySelector('[data-fw-hide-notice]'), 'no notice').toBeNull();
    expect(document.body.textContent ?? '').not.toContain('Mentions gambling');
    expect(Array.from(document.querySelectorAll('button')).some((b) => b.textContent === MARKER_STRINGS.en.hideShowAnyway)).toBe(false);
    const [record] = records();
    expect(record?.decision).toMatchObject({ row: 'R5', action: 'hide' });
  });
});
