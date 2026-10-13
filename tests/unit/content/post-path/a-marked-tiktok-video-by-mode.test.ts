/** @vitest-environment jsdom */
// A marked TikTok video, by mode (src/content/post-path/video-feed-words.ts). The record's anchor on
// TikTok's feed is the whole video item. Handed that item, the rewrite and the fold wrote their text
// over everything inside it, so the video and its buttons were gone and the card held one line of
// text. Now the words go to the caption and nowhere else:
//   Child: the video is skipped, and the record says hide.
//   Teen:  the caption is rewritten and the video stays.
//   Adult: the caption keeps its words, marked in yellow, and the video stays.
// A fold on a video is a hide in every mode. Each case is checked on the page and in the record.

import { beforeEach, describe, expect, it, vi } from 'vitest';

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
import { _resetAdvanceBreakerForTesting } from '../../../../src/content/protection/video-feed-hide';
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

interface Card { item: HTMLElement; video: HTMLVideoElement; caption: HTMLElement; next: HTMLElement }

/** A TikTok feed card as the page draws it: video, caption, button rail. A second card follows. */
function tiktokCard(): Card {
  const list = document.createElement('div');
  const make = (text: string): { item: HTMLElement; video: HTMLVideoElement; caption: HTMLElement } => {
    const item = document.createElement('div');
    item.setAttribute('data-e2e', 'recommend-list-item-container');
    const media = document.createElement('div');
    const video = document.createElement('video');
    media.appendChild(video);
    const caption = document.createElement('div');
    caption.setAttribute('data-e2e', 'video-desc');
    const span = document.createElement('span');
    span.textContent = text;
    caption.appendChild(span);
    const rail = document.createElement('div');
    rail.innerHTML = '<button data-e2e="comment-icon"></button>';
    item.append(media, caption, rail);
    list.appendChild(item);
    return { item, video, caption };
  };
  const first = make(CAPTION);
  const second = make('a calm video about bread');
  document.body.appendChild(list);
  // The first card is the one on screen.
  const h = window.innerHeight;
  first.item.getBoundingClientRect = () => ({ top: 0, bottom: h, height: h, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  (second.item as unknown as { scrollIntoView: unknown }).scrollIntoView = vi.fn();
  return { ...first, next: second.item };
}

function postFor(card: Card): PostContent {
  return {
    id: 'tk1', text: CAPTION, author: '@seller', timestamp: '2026-09-26T04:00:00Z',
    platform: 'tiktok', domRef: new WeakRef(card.item), kind: 'video',
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
  _setActiveAdapterForTesting({ platform: 'tiktok' } as unknown as PlatformAdapter);
  vi.mocked(sendHighStakesForensicLog).mockClear();
  useMode('teen');
});

describe('the writers, handed a whole video card', () => {
  // The words are routed to the caption before the writer runs, and the writer itself refuses a card
  // as a second line: the video stays even when a caller hands over the item.
  it('a rewrite or a fold given the card refuses and leaves its video', () => {
    const a = tiktokCard();
    expect(injectIntoElement(a.item, rewrite(), 'teen', true, CAPTION)).toBe(false);
    expect(a.item.contains(a.video)).toBe(true);
    const b = tiktokCard();
    injectCollapseOrHide(b.item, judged(), 'collapse', true, CAPTION);
    expect(b.item.contains(b.video)).toBe(true);
  });
});

describe('a marked TikTok video, by mode', () => {
  it('Teen: the caption is rewritten, the video stays, the record says soften', async () => {
    const card = tiktokCard();
    onProcessingResult(postFor(card), {
      action: 'neutralize', neutralized: rewrite(), detectionMode: 'combined-detect-neutralize',
      aiMeta: { model: 'openai/gpt-oss-120b', provider: 'deepinfra' },
    } as PipelineResult);
    await settle();

    expect(card.item.contains(card.video)).toBe(true);
    expect(card.caption.textContent).toContain(REWRITE);
    expect(card.item.style.getPropertyValue('display')).toBe('');
    const [rec] = records();
    expect(rec.neutralizedText).toBe(REWRITE);
    expect((rec.decision as { applied: string }).applied).toBe('soften');
  });

  it('Adult: the caption keeps its words in yellow, the video stays, the record says mark', async () => {
    useMode('adult');
    const card = tiktokCard();
    onProcessingResult(postFor(card), {
      action: 'neutralize', neutralized: rewrite(), detectionMode: 'combined-detect-neutralize',
      aiMeta: { model: 'openai/gpt-oss-120b', provider: 'deepinfra' },
    } as PipelineResult);
    await settle();

    expect(card.item.contains(card.video)).toBe(true);
    expect(card.caption.textContent).toContain(CAPTION);
    expect(card.caption.textContent).not.toContain(REWRITE);
    expect(card.caption.getAttribute(YELLOW_ATTR)).toBe('true');
    expect(card.caption.style.getPropertyValue('background-color')).not.toBe('');
    const [rec] = records();
    expect(rec.neutralizedText).toBe('');
    const decision = rec.decision as { applied: string; rewrite: unknown };
    expect(decision.applied).toBe('mark');
    expect(decision.rewrite).toEqual({ attempted: false, outcome: 'off' });
  });

  it('Child: the video is skipped, the next one comes up, no rewrite is tried', () => {
    useMode('child');
    const card = tiktokCard();
    const post = postFor(card);
    _mountProtectionForTesting(post, performance.now());
    const terminal = applyNeutralizedRewriteTerminal(
      post, card.item, rewrite(), { mode: 'child', uiLanguage: 'en', features: {} } as unknown as FWSettings,
    );
    expect(terminal).toBe('skipped');
    expect(card.item.style.getPropertyValue('visibility')).toBe('hidden');
    expect(card.item.style.getPropertyValue('display'), 'the card keeps its box').toBe('');
    expect(card.item.contains(card.video)).toBe(true);
    expect(card.caption.textContent).toBe(CAPTION);
    expect(card.next.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('Child: the record of a skipped video says hide, with no rewrite shown', async () => {
    useMode('child');
    const card = tiktokCard();
    const post = postFor(card);
    // Child's cover puts its "checking" line inside the card; the same-post check reads the
    // caption on a video card, so the cover does not turn the verdict away.
    _mountProtectionForTesting(post, performance.now());
    onProcessingResult(post, {
      action: 'neutralize', neutralized: rewrite(), detectionMode: 'combined-detect-neutralize',
      aiMeta: { model: 'openai/gpt-oss-120b', provider: 'deepinfra' },
    } as PipelineResult);
    await settle();

    expect(card.item.style.getPropertyValue('visibility')).toBe('hidden');
    const [rec] = records();
    expect(rec.neutralizedText).toBe('');
    const decision = rec.decision as { applied: string; rewrite: unknown };
    expect(decision.applied).toBe('hide');
    expect(decision.rewrite).toEqual({ attempted: false, outcome: 'off' });
  });

  it('a fold on a video is a hide in every mode; the video element is kept, only hidden', () => {
    const card = tiktokCard();
    expect(kindOnVideo(card.item, 'collapse')).toBe('hide');
    expect(kindOnVideo(card.item, 'hide')).toBe('hide');
    const x = document.createElement('article');
    document.body.appendChild(x);
    expect(kindOnVideo(x, 'collapse')).toBe('collapse');
  });

  it('the caption is found from the card or from inside it, and a card with none gives null', () => {
    const card = tiktokCard();
    expect(videoWordsOf(card.item)?.caption).toBe(card.caption);
    expect(videoWordsOf(card.caption.querySelector('span')!)?.caption).toBe(card.caption);
    card.caption.remove();
    expect(videoWordsOf(card.item)?.caption).toBeNull();
    expect(videoWordsOf(document.body)).toBeNull();
  });
});

// The words each reader sees on a hidden post (marker-strings.ts), from the path that picks them.
describe('the notice on a hidden post speaks to its reader', () => {
  function xPost(): { post: PostContent; body: HTMLElement } {
    const article = document.createElement('article');
    article.setAttribute('role', 'article');
    const body = document.createElement('div');
    body.setAttribute('data-testid', 'tweetText');
    body.textContent = 'a threat aimed at someone';
    article.appendChild(body);
    document.body.appendChild(article);
    const post = {
      id: 'x1', text: 'a threat aimed at someone', author: '@loud', timestamp: '2026-09-26T05:00:00Z',
      platform: 'twitter', domRef: new WeakRef(body), kind: 'post',
    } as unknown as PostContent;
    return { post, body };
  }
  const hideResult = { action: 'hide', analysis: judged(), detectionMode: 'combined-detect-neutralize' } as unknown as PipelineResult;

  for (const [mode, expected] of [['teen', 'A post by @loud is hidden here'], ['adult', 'A post by @loud is hidden']] as const) {
    it(`${mode}: the notice reads "${expected}", with no product name`, async () => {
      useMode(mode);
      _setActiveAdapterForTesting({ platform: 'twitter' } as unknown as PlatformAdapter);
      const { post } = xPost();
      onProcessingResult(post, hideResult);
      await settle();
      const text = document.body.textContent ?? '';
      expect(text).toContain(expected);
      if (mode === 'adult') expect(text).not.toContain('hidden here');
      expect(text).not.toContain('FeelingWise');
    });
  }

  it('Child: a fold that cannot become a hide reads the one kind line, no reason', () => {
    const el = document.createElement('div');
    el.textContent = 'some post';
    document.body.appendChild(el);
    injectCollapseOrHide(el, judged(), 'collapse', false, 'some post', 'en', 'child');
    expect(el.textContent).toContain('Skipped at your Silent level. Keep scrolling.');
  });
});

// A fold has no meaning on a video, so the video rule hides it in every mode. The record then holds
// action collapse (the row's) and applied hide; the note says the video rule did it, not an older path.
describe('the record of a fold on a video', () => {
  const FOLD_NOTE = 'a fold has no meaning on a video, so the video rule for this mode hid it; applied is what it did';
  const foldResult = { action: 'collapse', analysis: judged(), detectionMode: 'combined-detect-neutralize' } as unknown as PipelineResult;

  it('Adult: a fold on a video is a hide, and the note says the video rule hid it', async () => {
    useMode('adult');
    const card = tiktokCard();
    onProcessingResult(postFor(card), foldResult);
    await settle();

    expect(card.item.style.getPropertyValue('visibility')).toBe('hidden');
    const [rec] = records();
    const decision = rec.decision as { action: string; applied: string; note: string | null };
    expect(decision.action).toBe('collapse');
    expect(decision.applied).toBe('hide');
    expect(decision.note).toBe(FOLD_NOTE);
  });

  it('a fold on a post that is not a video keeps the fold and carries no video-rule note', async () => {
    useMode('adult');
    _setActiveAdapterForTesting({ platform: 'twitter' } as unknown as PlatformAdapter);
    const article = document.createElement('article');
    article.setAttribute('role', 'article');
    const body = document.createElement('div');
    body.setAttribute('data-testid', 'tweetText');
    body.textContent = 'a post that is not a video, long enough to read';
    article.appendChild(body);
    document.body.appendChild(article);
    const post = {
      id: 'x2', text: 'a post that is not a video, long enough to read', author: '@loud', timestamp: '2026-09-26T05:00:00Z',
      platform: 'twitter', domRef: new WeakRef(body), kind: 'post',
    } as unknown as PostContent;
    onProcessingResult(post, foldResult);
    await settle();

    const [rec] = records();
    const decision = rec.decision as { applied: string; note: string | null };
    expect(decision.applied).toBe('collapse');
    expect(decision.note).not.toBe(FOLD_NOTE);
  });
});
