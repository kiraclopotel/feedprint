/** @vitest-environment jsdom */
// Text an AI model wrote carries a mark software can read, on the element that holds it, naming the
// model that wrote it (src/content/markers/ai-mark.ts). The EU AI Act, Article 50(2), asks for that
// mark on text an AI system writes or rewrites. Nothing else carries it: not the original words, a
// swear mask, a rewrite that changed nothing, a rewrite the platform refused to show, a fold
// placeholder, a hidden post or comment, a hide notice. A post's record names the writer when the
// page showed its rewrite.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    getSettings: vi.fn(async () => ({ mode: 'adult', uiLanguage: 'en', dailyCap: 2000, features: {} })),
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
  AI_MODEL_ATTR,
  AI_TEXT_ATTR,
  clearRewriteMarks,
  markAiText,
  rewriteChangesText,
  writerOfRewrite,
} from '../../../../src/content/markers/ai-mark';
import {
  injectAdHide,
  injectCollapseOrHide,
  injectHardHide,
  injectIntoElement,
} from '../../../../src/content/injector';
import { renderTeenMarker } from '../../../../src/content/markers/teen-marker';
import { swapCommentTextInPlace } from '../../../../src/content/protection/comment-overlay';
import { rewriteStage } from '../../../../src/content/record/decision';
import {
  _applyCommentRewriteTerminalForTesting as applyCommentRewriteTerminal,
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
import type { AnalysisResult } from '../../../../src/types/analysis';
import type { NeutralizedContent } from '../../../../src/types/neutralization';
import type { PipelineResult } from '../../../../src/analysis/pipeline';
import type { PostContent } from '../../../../src/types/post';
import type { PlatformAdapter } from '../../../../src/content/platforms/adapter';
import type { CommentEntry } from '../../../../src/content/protection/comment-overlay';
import type { FWSettings } from '../../../../src/storage/settings';

const ORIGINAL = 'Everyone who believes this is an idiot and should be ashamed of themselves.';
const REWRITE = 'I strongly disagree with people who believe this, and it frustrates me.';
const WRITER = 'openai/gpt-oss-20b';

function analysis(): AnalysisResult {
  return {
    postId: 'p1',
    techniques: [{ technique: 'shame-attack', present: true, confidence: 0.9, severity: 7, evidence: [] }],
    overallScore: 7,
    overallConfidence: 0.9,
    isManipulative: true,
    processingTimeMs: 1,
    primaryTechnique: 'shame-attack',
    explanation: 'it shames the reader for a belief',
  };
}

function neutralized(over: Partial<NeutralizedContent> = {}): NeutralizedContent {
  return {
    postId: 'p1',
    originalHash: 'h',
    rewrittenText: REWRITE,
    analysis: analysis(),
    aiSource: 'cloud',
    processingTimeMs: 1,
    writerModel: WRITER,
    ...over,
  };
}

/** An X-shaped post: article > tweetText, the text element holding the original. */
function xPost(text = ORIGINAL): { article: HTMLElement; body: HTMLElement } {
  const cell = document.createElement('div');
  cell.setAttribute('data-testid', 'cellInnerDiv');
  const article = document.createElement('article');
  article.setAttribute('role', 'article');
  const body = document.createElement('div');
  body.setAttribute('data-testid', 'tweetText');
  const span = document.createElement('span');
  span.textContent = text;
  body.appendChild(span);
  article.appendChild(body);
  cell.appendChild(article);
  document.body.appendChild(cell);
  return { article, body };
}

/** The post as the pipeline hands it over, for the page's text element. */
function postOn(body: HTMLElement, text = ORIGINAL): PostContent {
  return {
    id: 'p1', text, author: '@someone', timestamp: '2026-09-23T08:00:00Z',
    platform: 'twitter', domRef: new WeakRef(body), kind: 'post',
  } as unknown as PostContent;
}

/** A platform text setter that drops every write, so the element keeps what it had. */
function dropTextWrites(el: HTMLElement): void {
  const kept = el.textContent;
  Object.defineProperty(el, 'textContent', { get: () => kept, set: () => {}, configurable: true });
}

function comment(text = ORIGINAL): CommentEntry {
  const row = document.createElement('div');
  const textEl = document.createElement('span');
  textEl.textContent = text;
  row.appendChild(textEl);
  document.body.appendChild(row);
  return { rootEl: row, textEl, author: '@someone', text };
}

/** Every element on the page that names its text as a model's. */
function marked(): Element[] {
  return Array.from(document.querySelectorAll(`[${AI_TEXT_ATTR}]`));
}

beforeEach(() => {
  document.body.innerHTML = '';
  _setChildProtectionModeForTesting('adult');
});

describe('the mark itself', () => {
  it('names the text as a model\'s and names the model; with no model named, only the first', () => {
    const el = document.createElement('p');
    markAiText(el, 'rewrite', { model: WRITER });
    expect(el.getAttribute(AI_TEXT_ATTR)).toBe('rewrite');
    expect(el.getAttribute(AI_MODEL_ATTR)).toBe(WRITER);
    markAiText(el, 'rewrite', {});
    expect(el.getAttribute(AI_TEXT_ATTR)).toBe('rewrite');
    expect(el.hasAttribute(AI_MODEL_ATTR)).toBe(false);
  });

  it('clearing a rewrite mark reaches inside and leaves a reading card alone', () => {
    const root = document.createElement('div');
    const inner = document.createElement('span');
    const card = document.createElement('div');
    root.append(inner, card);
    markAiText(root, 'rewrite', { model: WRITER });
    markAiText(inner, 'rewrite', { model: WRITER });
    markAiText(card, 'reading', { model: WRITER });
    clearRewriteMarks(root);
    expect(root.hasAttribute(AI_TEXT_ATTR)).toBe(false);
    expect(root.hasAttribute(AI_MODEL_ATTR)).toBe(false);
    expect(inner.hasAttribute(AI_TEXT_ATTR)).toBe(false);
    expect(card.getAttribute(AI_TEXT_ATTR)).toBe('reading');
  });

  it('a rewrite that leaves the words as the reader sees them is not a change', () => {
    expect(rewriteChangesText(REWRITE, ORIGINAL)).toBe(true);
    expect(rewriteChangesText(`  ${ORIGINAL}\n`, ORIGINAL)).toBe(false);
    expect(rewriteChangesText('', ORIGINAL)).toBe(false);
  });

  it('a post rewrite has a writer only when a model wrote new words', () => {
    expect(writerOfRewrite(neutralized(), ORIGINAL)).toEqual({ model: WRITER });
    expect(writerOfRewrite(neutralized({ writerModel: undefined }), ORIGINAL)).toEqual({});
    expect(writerOfRewrite(neutralized({ aiSource: 'rules' }), ORIGINAL)).toBeNull();
    expect(writerOfRewrite(neutralized({ rewrittenText: ORIGINAL }), ORIGINAL)).toBeNull();
  });
});

describe('a post rewrite', () => {
  it('carries the mark with the writer\'s name once the rewrite is on the page', () => {
    const { body } = xPost();
    expect(injectIntoElement(body, neutralized(), 'adult', false, ORIGINAL)).toBe(true);
    expect(body.textContent).toBe(REWRITE);
    expect(body.getAttribute(AI_TEXT_ATTR)).toBe('rewrite');
    expect(body.getAttribute(AI_MODEL_ATTR)).toBe(WRITER);
    expect(marked()).toEqual([body]);
  });

  it('a swear mask is the filter\'s stars, not a model\'s words, and is not marked', () => {
    const { body } = xPost('what the hell is this');
    const mask = neutralized({ rewrittenText: 'what the **** is this', aiSource: 'rules', writerModel: undefined });
    expect(injectIntoElement(body, mask, 'adult', false, 'what the hell is this')).toBe(true);
    expect(marked()).toEqual([]);
  });

  it('a rewrite held back to the original words is not marked', () => {
    const { body } = xPost();
    expect(injectIntoElement(body, neutralized({ rewrittenText: ORIGINAL }), 'adult', false, ORIGINAL)).toBe(true);
    expect(body.textContent).toBe(ORIGINAL);
    expect(marked()).toEqual([]);
  });

  it('a rewrite the platform\'s text setter dropped is not marked, and a mark already there goes', () => {
    const { body } = xPost();
    dropTextWrites(body.querySelector('span')!);
    expect(injectIntoElement(body, neutralized(), 'adult', false, ORIGINAL)).toBe(false);
    expect(body.textContent).toBe(ORIGINAL);
    expect(marked()).toEqual([]);

    // A mark left from an earlier pass names the author's words as a model's just the same.
    markAiText(body, 'rewrite', { model: WRITER });
    expect(injectIntoElement(body, neutralized(), 'adult', true, ORIGINAL)).toBe(false);
    expect(marked()).toEqual([]);
  });

  it('a Child post whose rewrite did not land is hidden, and the hidden post is not marked', () => {
    _setChildProtectionModeForTesting('child');
    const { body } = xPost();
    const post = postOn(body);
    dropTextWrites(body.querySelector('span')!);
    _mountProtectionForTesting(post, performance.now());

    const terminal = applyNeutralizedRewriteTerminal(
      post, body, neutralized(), { mode: 'child', uiLanguage: 'en', features: {} } as unknown as FWSettings,
    );

    expect(terminal).toBe('committed');
    expect(document.querySelector('[data-fw-hard-hidden="true"]')).not.toBeNull();
    expect(body.textContent).toBe(ORIGINAL);
    expect(marked()).toEqual([]);
  });

  it('a post rewritten and then folded shows the placeholder, and the mark goes with the rewrite', () => {
    const { body } = xPost();
    injectIntoElement(body, neutralized(), 'adult', false, ORIGINAL);
    expect(marked()).toEqual([body]);
    expect(injectCollapseOrHide(body, analysis(), 'collapse', false, ORIGINAL)).toBe(true);
    expect(body.textContent).not.toBe(REWRITE);
    expect(marked()).toEqual([]);
  });

  it('a hidden post, an ad hide and a fold carry no mark', () => {
    const hidden = xPost();
    expect(injectHardHide(hidden.body, 'twitter')).toBe(true);
    const ad = xPost('Buy this now, limited offer, only today for you.');
    expect(injectAdHide(ad.body, 'twitter')).toBe(true);
    const folded = xPost('Another post the judge folded for its reader.');
    expect(injectCollapseOrHide(folded.body, analysis(), 'hide', true, 'Another post the judge folded for its reader.')).toBe(true);
    expect(marked()).toEqual([]);
  });

  it('the marker keeps the mark on the rewrite and off the reason and the original', () => {
    const { body } = xPost();
    injectIntoElement(body, neutralized(), 'adult', true, ORIGINAL);
    const dot = body.querySelector<HTMLButtonElement>('.fw-teen-marker')!;
    expect(dot).not.toBeNull();
    expect(body.getAttribute(AI_TEXT_ATTR)).toBe('rewrite');

    dot.click(); // the reason
    expect(body.dataset.fwMarkerState).toBe('yellow');
    expect(marked()).toEqual([]);

    dot.click(); // the original
    expect(body.dataset.fwMarkerState).toBe('red');
    expect(body.textContent).toContain(ORIGINAL);
    expect(marked()).toEqual([]);

    dot.click(); // the rewrite again
    expect(body.dataset.fwMarkerState).toBe('green');
    expect(body.textContent).toContain(REWRITE);
    expect(body.getAttribute(AI_TEXT_ATTR)).toBe('rewrite');
    expect(body.getAttribute(AI_MODEL_ATTR)).toBe(WRITER);
  });

  it('rendering a marker over text the page has not swapped yet marks nothing', () => {
    // The comment path mounts the marker first and swaps after, so the marker alone must not
    // name the original as a model's.
    const { body } = xPost();
    renderTeenMarker({
      el: body, analysis: analysis(), originalText: ORIGINAL, kind: 'rewrite',
      rewriteText: REWRITE, aiRewrite: { model: WRITER },
    });
    expect(body.textContent).toContain(ORIGINAL);
    expect(marked()).toEqual([]);
  });

  it('a marker over a mask never marks, in any state', () => {
    const { body } = xPost('what the hell is this');
    const mask = neutralized({ rewrittenText: 'what the **** is this', aiSource: 'rules', writerModel: undefined });
    injectIntoElement(body, mask, 'adult', true, 'what the hell is this');
    const dot = body.querySelector<HTMLButtonElement>('.fw-teen-marker')!;
    for (let i = 0; i < 3; i++) {
      dot.click();
      expect(marked()).toEqual([]);
    }
  });
});

describe('a comment rewrite', () => {
  it('carries the mark with the writer\'s name when the swap lands', () => {
    const entry = comment();
    expect(applyCommentRewriteTerminal(entry, REWRITE, 'teen', true, { model: WRITER })).toBe('rewritten');
    expect(entry.textEl.textContent).toBe(REWRITE);
    expect(entry.textEl.getAttribute(AI_TEXT_ATTR)).toBe('rewrite');
    expect(entry.textEl.getAttribute(AI_MODEL_ATTR)).toBe(WRITER);
    expect(marked()).toEqual([entry.textEl]);
  });

  it('a comment swear mask is not marked', () => {
    const entry = comment('what the hell is this');
    expect(applyCommentRewriteTerminal(entry, 'what the **** is this', 'teen', false)).toBe('rewritten');
    expect(marked()).toEqual([]);
  });

  it('a Child comment whose swap did not land is hidden, and the hidden comment is not marked', () => {
    const entry = comment();
    Object.defineProperty(entry.textEl, 'textContent', { get: () => ORIGINAL, set: () => {}, configurable: true });
    expect(applyCommentRewriteTerminal(entry, REWRITE, 'child', true, { model: WRITER })).toBe('hidden');
    expect(entry.rootEl.style.getPropertyValue('display')).toBe('none');
    expect(marked()).toEqual([]);
  });

  it('a hide notice or the original written over a marked rewrite takes the mark away', () => {
    const entry = comment();
    applyCommentRewriteTerminal(entry, REWRITE, 'teen', true, { model: WRITER });
    expect(marked()).toEqual([entry.textEl]);
    swapCommentTextInPlace(entry, 'FeelingWise hid this comment: an identity slur');
    expect(marked()).toEqual([]);
  });
});

describe('the record says who wrote what the page showed', () => {
  it('the rewrite stage names the model only when the rewrite landed and a model is named', () => {
    expect(rewriteStage(true, { model: WRITER })).toEqual({ attempted: true, outcome: 'applied', model: WRITER });
    expect(rewriteStage(true, {})).toEqual({ attempted: true, outcome: 'applied' });
    expect(rewriteStage(true, null)).toEqual({ attempted: true, outcome: 'applied' });
    expect(rewriteStage(false, { model: WRITER })).toEqual({ attempted: true, outcome: 'failed' });
  });

  describe('an adult post the judge read and a model rewrote', () => {
    beforeEach(() => {
      _resetForensicDedupForTesting();
      _clearSessionVerdictCachesOnModeChangeForTesting();
      _resetDiagnosticsForTesting();
      _setActiveAdapterForTesting({ platform: 'twitter' } as unknown as PlatformAdapter);
      vi.mocked(sendHighStakesForensicLog).mockClear();
    });

    async function settle(): Promise<void> {
      for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 5));
    }

    function judgedResult(text: string, over: Partial<NeutralizedContent> = {}): PipelineResult {
      const judged: AnalysisResult = {
        ...analysis(),
        judge: {
          id: 'judge-v1', hash: 'judge-hash', model: 'openai/gpt-oss-120b',
          charged: true, family: 'hostile', severity: 7, effect: 'recruit', intent: 'react',
        },
      } as AnalysisResult;
      return {
        action: 'neutralize',
        neutralized: { ...neutralized({ analysis: judged, ...over }), postId: 'j1' },
        aiMeta: { model: 'openai/gpt-oss-120b', provider: 'deepinfra' },
        detectionMode: 'combined-detect-neutralize',
      } as PipelineResult;
    }

    function postOnPage(text: string): { post: PostContent; body: HTMLElement } {
      const { body } = xPost(text);
      const post = {
        id: 'j1', text, author: '@someone', timestamp: '2026-09-23T08:00:00Z',
        platform: 'twitter', domRef: new WeakRef(body), kind: 'post',
      } as unknown as PostContent;
      return { post, body };
    }

    function rewriteRecords(): Record<string, unknown>[] {
      return vi.mocked(sendHighStakesForensicLog).mock.calls
        .map(c => c[0] as { type: string; payload: Record<string, unknown> })
        .filter(m => m.type === 'FORENSIC_LOG')
        .map(m => m.payload);
    }

    it('the page marks the rewrite with the rewriter, and the record names the same model, not the judge', async () => {
      const { post, body } = postOnPage(ORIGINAL);
      onProcessingResult(post, judgedResult(ORIGINAL));
      await settle();

      expect(body.getAttribute(AI_TEXT_ATTR)).toBe('rewrite');
      expect(body.getAttribute(AI_MODEL_ATTR)).toBe(WRITER);
      const records = rewriteRecords();
      expect(records).toHaveLength(1);
      expect(records[0].neutralizedText).toBe(REWRITE);
      const decision = records[0].decision as { applied: string; rewrite: unknown };
      expect(decision.applied).toBe('soften');
      expect(decision.rewrite).toEqual({ attempted: true, outcome: 'applied', model: WRITER });
    });

    it('a rewrite the page refused to show names no writer, on the page or in the record', async () => {
      const { post, body } = postOnPage(ORIGINAL);
      dropTextWrites(body.querySelector('span')!);
      onProcessingResult(post, judgedResult(ORIGINAL));
      await settle();

      expect(body.textContent).toBe(ORIGINAL);
      expect(marked()).toEqual([]);
      const records = rewriteRecords();
      expect(records).toHaveLength(1);
      expect(records[0].neutralizedText).toBe('');
      const decision = records[0].decision as { rewrite: unknown };
      expect(decision.rewrite).toEqual({ attempted: true, outcome: 'failed' });
    });

    it('a rewrite that kept the original words names no writer, on the page or in the record', async () => {
      const { post, body } = postOnPage(ORIGINAL);
      onProcessingResult(post, judgedResult(ORIGINAL, { rewrittenText: ORIGINAL }));
      await settle();

      expect(body.hasAttribute(AI_TEXT_ATTR)).toBe(false);
      const decision = rewriteRecords()[0].decision as { rewrite: Record<string, unknown> };
      expect(decision.rewrite.model).toBeUndefined();
    });
  });
});
