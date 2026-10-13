// @vitest-environment jsdom
//
// The Open level opens on the author's own words (his word, 12 Oct 2026, the Leader's plan of 21:4x). One marker, one walk,
// three entry points: Silent shows the rewrite with no mark; Calm opens on the rewrite, green, and walks green, yellow,
// red; Open opens on the original, red, and walks red, yellow, green, red. Nothing is written to the page until the first
// tap, so until then the post is exactly what the platform drew.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderTeenMarker } from '../../../../src/content/markers/teen-marker';
import { offerRewriteBehindMark } from '../../../../src/content/injector';
import { opensOnOriginal } from '../../../../src/content/markers/entry-view';
import { AI_MODEL_ATTR, AI_TEXT_ATTR } from '../../../../src/content/markers/ai-mark';
import { MARKER_STRINGS } from '../../../../src/i18n/marker-strings';
import type { AnalysisResult } from '../../../../src/types/analysis';
import type { NeutralizedContent } from '../../../../src/types/neutralization';

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
  } as AnalysisResult;
}

function neutralized(): NeutralizedContent {
  return {
    postId: 'p1', originalHash: 'h', rewrittenText: REWRITE, analysis: analysis(), aiSource: 'cloud', processingTimeMs: 1, writerModel: WRITER,
  } as NeutralizedContent;
}

/** A post body as a platform draws it: words, a link and a hashtag, each in its own node. */
function richBody(): HTMLElement {
  const body = document.createElement('div');
  body.setAttribute('data-testid', 'tweetText');
  body.innerHTML = `<span>Everyone who believes </span><a href="https://example.org/x">this</a><span> is an idiot and should be ashamed of themselves.</span>`;
  document.body.appendChild(body);
  return body;
}

/** The injector's own flatten, as the post path passes it: the body becomes one plain text of the original. */
const flattenInto = (body: HTMLElement) => (): boolean => { body.textContent = ORIGINAL; return true; };

const state = (el: HTMLElement): string | undefined => el.dataset.fwMarkerState;
const dot = (el: HTMLElement): HTMLButtonElement => el.querySelector<HTMLButtonElement>('.fw-teen-marker')!;

beforeEach(() => { document.body.innerHTML = ''; });

describe('which levels open on the original', () => {
  it('only Open, and only where there is a mark to press', () => {
    expect(opensOnOriginal('adult', true)).toBe(true);
    expect(opensOnOriginal('adult', false)).toBe(false);
    expect(opensOnOriginal('teen', true)).toBe(false);
    expect(opensOnOriginal('child', true)).toBe(false);
  });
});

describe('the marker opened on the original', () => {
  it('starts red and writes nothing: the platform\'s own nodes, link and all, are still there', () => {
    const body = richBody();
    const before = body.innerHTML;
    renderTeenMarker({
      el: body, analysis: analysis(), originalText: ORIGINAL, kind: 'rewrite', rewriteText: REWRITE,
      entry: 'original', flatten: flattenInto(body), aiRewrite: { model: WRITER },
    });
    expect(state(body)).toBe('red');
    expect(dot(body).getAttribute('aria-label')).toBe(MARKER_STRINGS.en.redAriaLabel);
    expect(dot(body).style.getPropertyValue('--fw-marker-color')).toBe('#e53935');
    expect(body.querySelector('a')?.getAttribute('href')).toBe('https://example.org/x');
    expect(body.textContent).toContain(ORIGINAL);
    expect(body.innerHTML.replace(dot(body).outerHTML, '')).toBe(before);
    expect(body.hasAttribute(AI_TEXT_ATTR), 'no model\'s words are on the page yet').toBe(false);
    expect(body.hasAttribute('data-fw-neutralized')).toBe(false);
  });

  it('walks red, yellow, green, red: the reason first, then the calm version, then the original again', () => {
    const body = richBody();
    renderTeenMarker({
      el: body, analysis: analysis(), originalText: ORIGINAL, kind: 'rewrite', rewriteText: REWRITE,
      entry: 'original', flatten: flattenInto(body), aiRewrite: { model: WRITER },
    });
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) { dot(body).click(); seen.push(state(body)!); }
    expect(seen).toEqual(['yellow', 'green', 'red', 'yellow', 'green']);
  });

  it('shows the reason on the first tap, the rewrite on the second, the original on the third', () => {
    const body = richBody();
    renderTeenMarker({
      el: body, analysis: analysis(), originalText: ORIGINAL, kind: 'rewrite', rewriteText: REWRITE,
      entry: 'original', flatten: flattenInto(body),
    });
    dot(body).click();
    expect(body.textContent).toContain('it shames the reader for a belief');
    expect(body.textContent).not.toContain(ORIGINAL);
    dot(body).click();
    expect(body.textContent).toContain(REWRITE);
    expect(dot(body).getAttribute('aria-label')).toBe(MARKER_STRINGS.en.greenAriaLabel);
    dot(body).click();
    expect(body.textContent).toContain(ORIGINAL);
    expect(dot(body).getAttribute('aria-label')).toBe(MARKER_STRINGS.en.redAriaLabel);
  });

  it('names the text as a model\'s only while the calm version is shown', () => {
    const body = richBody();
    renderTeenMarker({
      el: body, analysis: analysis(), originalText: ORIGINAL, kind: 'rewrite', rewriteText: REWRITE,
      entry: 'original', flatten: flattenInto(body), aiRewrite: { model: WRITER },
    });
    dot(body).click(); // reason
    expect(body.hasAttribute(AI_TEXT_ATTR)).toBe(false);
    dot(body).click(); // calm version
    expect(body.getAttribute(AI_TEXT_ATTR)).toBe('rewrite');
    expect(body.getAttribute(AI_MODEL_ATTR)).toBe(WRITER);
    dot(body).click(); // original again
    expect(body.hasAttribute(AI_TEXT_ATTR)).toBe(false);
  });

  it('stamps the body as FeelingWise\'s own text from the first tap, so the page scanner does not read it as a post', () => {
    const body = richBody();
    renderTeenMarker({
      el: body, analysis: analysis(), originalText: ORIGINAL, kind: 'rewrite', rewriteText: REWRITE,
      entry: 'original', flatten: flattenInto(body),
    });
    expect(body.hasAttribute('data-fw-neutralized')).toBe(false);
    dot(body).click();
    expect(body.getAttribute('data-fw-neutralized')).toBe('true');
  });

  it('keeps its dot when the flatten clears the body\'s children', () => {
    const body = richBody();
    renderTeenMarker({
      el: body, analysis: analysis(), originalText: ORIGINAL, kind: 'rewrite', rewriteText: REWRITE,
      entry: 'original', flatten: flattenInto(body),
    });
    const first = dot(body);
    first.click();
    expect(body.contains(first)).toBe(true);
    expect(body.querySelectorAll('.fw-teen-marker')).toHaveLength(1);
  });

  it('changes nothing when the flatten cannot write: still red, the platform\'s nodes untouched', () => {
    const body = richBody();
    const before = body.innerHTML;
    renderTeenMarker({
      el: body, analysis: analysis(), originalText: ORIGINAL, kind: 'rewrite', rewriteText: REWRITE,
      entry: 'original', flatten: () => false,
    });
    dot(body).click();
    expect(state(body)).toBe('red');
    expect(body.innerHTML.replace(dot(body).outerHTML, '')).toBe(before);
    expect(body.hasAttribute('data-fw-neutralized')).toBe(false);
  });

  it('without the means to write the rewrite in place, the dot opens the reason alone (red and yellow)', () => {
    const body = richBody();
    renderTeenMarker({
      el: body, analysis: analysis(), originalText: ORIGINAL, kind: 'rewrite', rewriteText: REWRITE, entry: 'original',
    });
    expect(state(body)).toBe('base');
    expect(dot(body).style.getPropertyValue('--fw-marker-color')).toBe('#e53935');
    dot(body).click();
    expect(state(body)).toBe('yellow');
    dot(body).click();
    expect(state(body)).toBe('base');
  });
});

describe('the Calm walk is as it was', () => {
  it('starts on the rewrite already in the body, green, and walks green, yellow, red', () => {
    const body = document.createElement('div');
    body.textContent = REWRITE;
    document.body.appendChild(body);
    renderTeenMarker({ el: body, analysis: analysis(), originalText: ORIGINAL, kind: 'rewrite', rewriteText: REWRITE });
    expect(state(body)).toBe('green');
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) { dot(body).click(); seen.push(state(body)!); }
    expect(seen).toEqual(['yellow', 'red', 'green']);
  });
});

describe('offerRewriteBehindMark (the post path\'s Open placement)', () => {
  it('leaves the words as the platform drew them and puts a red dot after them', () => {
    const body = richBody();
    const before = body.innerHTML;
    expect(offerRewriteBehindMark(body, neutralized(), ORIGINAL)).toBe('offered');
    expect(state(body)).toBe('red');
    expect(body.innerHTML.replace(dot(body).outerHTML, '')).toBe(before);
    expect(body.hasAttribute('data-fw-neutralized')).toBe(false);
    // The injector's own flatten writes the original on the first tap, then the reason shows.
    dot(body).click();
    expect(state(body)).toBe('yellow');
    expect(body.textContent).toContain('it shames the reader for a belief');
  });

  it('a body that holds a picture cannot take the rewrite in place: the dot opens the reason alone', () => {
    const body = richBody();
    body.appendChild(document.createElement('video'));
    expect(offerRewriteBehindMark(body, neutralized(), ORIGINAL)).toBe('offered-unwritable');
    dot(body).click();
    expect(state(body)).toBe('yellow');
    dot(body).click();
    expect(state(body)).toBe('base');
    expect(body.querySelector('video')).not.toBeNull();
  });

  it('a second offer on the same body adds no second dot', () => {
    const body = richBody();
    offerRewriteBehindMark(body, neutralized(), ORIGINAL);
    expect(offerRewriteBehindMark(body, neutralized(), ORIGINAL)).toBe('offered');
    expect(body.querySelectorAll('.fw-teen-marker')).toHaveLength(1);
  });
});

vi.restoreAllMocks();
