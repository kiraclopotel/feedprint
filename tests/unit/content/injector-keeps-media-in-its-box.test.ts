// @vitest-environment jsdom
//
// The text writer replaces a box's text. When a platform hands it a box that is
// really a card (text beside a video, a picture or a control), a plain
// `textContent =` would delete those too. It must refuse and leave the box
// untouched, and stay quiet about boxes that hold only words, links and emoji.

import { describe, it, expect, beforeEach } from 'vitest';
import { injectIntoElement, injectCollapseOrHide } from '../../../src/content/injector';
import type { AnalysisResult, TechniqueName } from '../../../src/types/analysis';

function analysisWith(technique: TechniqueName, score = 6): AnalysisResult {
  return {
    postId: 'p1',
    techniques: [{ technique, present: true, confidence: 0.9, severity: score, evidence: [] }],
    overallScore: score,
    overallConfidence: 0.9,
    isManipulative: true,
    processingTimeMs: 0,
    primaryTechnique: technique,
    explanation: 'x',
  };
}

const neutralized = {
  rewrittenText: 'calm replacement',
  analysis: analysisWith('fear-appeal'),
  aiSource: 'cloud',
} as const;

function box(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('a box that holds more than words is left as it is', () => {
  const cards: Array<[string, string]> = [
    ['a video', '<span>hostile original words</span><video src="v.mp4"></video>'],
    ['a picture', '<div>hostile original words</div><picture><img src="p.jpg" alt="Photo of a road"></picture>'],
    ['an ordinary image', '<div>hostile original words</div><img src="p.jpg" alt="Photo of a road">'],
    ['an image with no alt text', '<div>hostile original words</div><img src="p.jpg">'],
    ['a frame', '<div>hostile original words</div><iframe src="about:blank"></iframe>'],
    ['a canvas', '<div>hostile original words</div><canvas></canvas>'],
    ['a button', '<div>hostile original words</div><button type="button">Share</button>'],
    ['a form field', '<div>hostile original words</div><input type="text">'],
  ];

  for (const [name, html] of cards) {
    it(`rewrite refuses a box with ${name} and changes nothing`, () => {
      const el = box(html);
      const before = el.innerHTML;

      expect(injectIntoElement(el, neutralized as never, 'teen')).toBe(false);

      expect(el.innerHTML).toBe(before);
      expect(el.hasAttribute('data-fw-neutralized')).toBe(false);
    });

    it(`fold refuses a box with ${name} and changes nothing`, () => {
      const el = box(html);
      const before = el.innerHTML;

      expect(injectCollapseOrHide(el, analysisWith('fear-appeal'), 'collapse')).toBe(false);

      expect(el.innerHTML).toBe(before);
      expect(el.hasAttribute('data-fw-action')).toBe(false);
    });
  }
});

describe('a box that holds only words is still rewritten', () => {
  const texts: Array<[string, string]> = [
    ['plain text', 'hostile original words'],
    ['spans, a mention and a hashtag link', '<span>hostile </span><a href="/u">@someone</a><span> original words</span><a href="/h">#tag</a>'],
    ['an emoji picture with its alt text', '<span>hostile original words </span><img alt="😀" src="e.svg">'],
    ['a small emoji picture with no alt text', '<span>hostile original words </span><img width="16" height="16" src="e.svg">'],
    ['a see-more control made from a div', '<div>hostile original words</div><div role="button" tabindex="0">See more</div>'],
  ];

  for (const [name, html] of texts) {
    it(`rewrites a box with ${name}`, () => {
      const el = box(html);

      expect(injectIntoElement(el, neutralized as never, 'teen')).toBe(true);

      expect(el.textContent).toContain('calm replacement');
    });
  }
});

describe("FeelingWise's own marker inside a rewritten box does not count as media", () => {
  const flush = () => new Promise((r) => setTimeout(r, 20));
  const ORIGINAL = 'hostile original words';

  function markedPost(): HTMLElement {
    const el = box(`<span>${ORIGINAL}</span>`);
    expect(injectIntoElement(el, neutralized as never, 'teen', true, ORIGINAL)).toBe(true);
    expect(el.querySelectorAll('.fw-teen-marker')).toHaveLength(1);
    return el;
  }

  it('the guard puts the rewrite back after the site writes its own words again', async () => {
    const el = markedPost();

    el.querySelector('span')!.textContent = ORIGINAL;
    await flush();

    expect(el.textContent).toContain('calm replacement');
    expect(el.textContent).not.toContain(ORIGINAL);
    expect(el.querySelectorAll('.fw-teen-marker')).toHaveLength(1);
  });

  it('a replay onto the post that already carries its marker rewrites it once more, with one marker', () => {
    const el = markedPost();
    el.querySelector('span')!.textContent = ORIGINAL;

    expect(injectIntoElement(el, neutralized as never, 'teen', true, ORIGINAL)).toBe(true);

    expect(el.textContent).toContain('calm replacement');
    expect(el.querySelectorAll('.fw-teen-marker')).toHaveLength(1);
  });

  it('a fold over a rewritten, marked post lands, and its guard puts the placeholder back', async () => {
    const el = markedPost();

    expect(injectCollapseOrHide(el, analysisWith('fear-appeal'), 'collapse', true, ORIGINAL)).toBe(true);
    expect(el.getAttribute('data-fw-action')).toBe('collapse');
    expect(el.querySelectorAll('.fw-teen-marker')).toHaveLength(1);
    const placeholder = el.textContent;

    el.querySelector('span')!.textContent = ORIGINAL;
    await flush();

    expect(el.textContent).toBe(placeholder);
  });

  it('a video beside the marker still refuses the box', () => {
    const el = box('<span>hostile original words</span><video src="v.mp4"></video>');
    el.appendChild(Object.assign(document.createElement('button'), { className: 'fw-teen-marker' }));
    const before = el.innerHTML;

    expect(injectIntoElement(el, neutralized as never, 'teen')).toBe(false);

    expect(el.innerHTML).toBe(before);
  });

  it("a site's own button that merely has a class starting with fw- still refuses the box", () => {
    const el = box('<span>hostile original words</span><button type="button" class="fw-bold">Share</button>');
    const before = el.innerHTML;

    expect(injectIntoElement(el, neutralized as never, 'teen')).toBe(false);

    expect(el.innerHTML).toBe(before);
  });
});

describe('the rewrite guard, after the platform puts media into a rewritten box', () => {
  const flush = () => new Promise((r) => setTimeout(r, 20));

  it('refuses without looping and without wiping', async () => {
    const el = box('<span>hostile original words</span>');
    expect(injectIntoElement(el, neutralized as never, 'teen')).toBe(true);

    let records = 0;
    const watcher = new MutationObserver((batch) => { records += batch.length; });
    watcher.observe(el, { childList: true, characterData: true, subtree: true, attributes: true });
    const video = document.createElement('video');
    el.appendChild(video);
    el.querySelector('span')!.textContent = 'the platform put its own words back';
    await flush();
    watcher.disconnect();

    expect(el.contains(video)).toBe(true);
    expect(el.textContent).toContain('the platform put its own words back');
    // Only the two edits above: the guard woke, was refused, and wrote nothing.
    expect(records).toBe(2);
  });

  it('still puts the rewrite back when the box holds only words', async () => {
    const el = box('<span>hostile original words</span>');
    expect(injectIntoElement(el, neutralized as never, 'teen')).toBe(true);

    el.querySelector('span')!.textContent = 'the platform put its own words back';
    await flush();

    expect(el.textContent).toContain('calm replacement');
    expect(el.textContent).not.toContain('the platform put its own words back');
  });
});
