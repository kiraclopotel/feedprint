// @vitest-environment jsdom
//
// The guard that keeps a rewrite in place puts it back whenever the element's text changes, which is
// right when the page redraws the same post (it restores the original words) and wrong when the page
// reuses the element for another post: the old post's rewrite would then be written over the new post.
// The guard defends one post. When the element holds words that are neither that post's original nor
// its rewrite, it stands down and leaves the new post as the page drew it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { repoPath } from '../../helpers/repo-root';
import {
  injectCollapseOrHide,
  injectIntoElement,
  releaseAllGuards,
  setGuardStandDownHandler,
} from '../../../src/content/injector';
import type { AnalysisResult, TechniqueName } from '../../../src/types/analysis';
import type { NeutralizedContent } from '../../../src/types/neutralization';

const ORIGINAL = 'you will never be enough unless you buy this today';
const REWRITE = 'this product is being promoted here';
const OTHER = 'a calm video about baking bread on a sunday morning';

function analysis(technique: TechniqueName = 'shame-attack'): AnalysisResult {
  return {
    postId: 'p1',
    techniques: [{ technique, present: true, confidence: 0.9, severity: 6, evidence: [] }],
    overallScore: 6,
    overallConfidence: 0.9,
    isManipulative: true,
    processingTimeMs: 0,
    primaryTechnique: technique,
    explanation: 'x',
  };
}

function rewrite(text: string = REWRITE): NeutralizedContent {
  return { postId: 'p1', originalHash: 'h', rewrittenText: text, analysis: analysis(), aiSource: 'cloud', processingTimeMs: 1 };
}

/** The text element as X draws it: a body with several spans. */
function spans(text: string): HTMLElement {
  const body = document.createElement('div');
  const a = document.createElement('span');
  a.textContent = text.slice(0, 20);
  const b = document.createElement('span');
  b.textContent = text.slice(20);
  body.append(a, b);
  document.body.appendChild(body);
  return body;
}

function plain(text: string): HTMLElement {
  const body = document.createElement('div');
  body.textContent = text;
  document.body.appendChild(body);
  return body;
}

/** The page redraws the element: everything inside goes, new words come. */
function redraw(el: HTMLElement, text: string): void {
  el.replaceChildren(document.createTextNode(text));
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
}

const shapes: Array<[string, (t: string) => HTMLElement]> = [
  ['spans', spans],
  ['a plain box', plain],
];

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  releaseAllGuards();
  setGuardStandDownHandler(null);
});

describe('the guard leaves another post alone', () => {
  for (const [shape, make] of shapes) {
    it(`a rewritten post's element refilled with another post keeps the new post's words (${shape})`, async () => {
      const el = make(ORIGINAL);
      expect(injectIntoElement(el, rewrite(), 'teen', false, ORIGINAL)).toBe(true);
      expect(el.textContent).toContain(REWRITE);

      redraw(el, OTHER);
      await settle();

      expect(el.textContent).toBe(OTHER);
      expect(el.hasAttribute('data-fw-neutralized')).toBe(false);
    });

    it(`a folded post's element refilled with another post keeps the new post's words (${shape})`, async () => {
      const el = make(ORIGINAL);
      expect(injectCollapseOrHide(el, analysis(), 'collapse', false, ORIGINAL)).toBe(true);
      const placeholder = el.textContent;
      expect(placeholder).not.toContain(OTHER);

      redraw(el, OTHER);
      await settle();

      expect(el.textContent).toBe(OTHER);
      expect(el.hasAttribute('data-fw-action')).toBe(false);
    });
  }

  it('the new post can be rewritten on its own after the guard stood down', async () => {
    const el = plain(ORIGINAL);
    injectIntoElement(el, rewrite(), 'teen', false, ORIGINAL);
    redraw(el, OTHER);
    await settle();

    expect(injectIntoElement(el, rewrite('a softer line for the bread post'), 'teen', false, OTHER)).toBe(true);
    expect(el.textContent).toBe('a softer line for the bread post');
  });
});

describe('the guard still defends the same post against a redraw', () => {
  for (const [shape, make] of shapes) {
    it(`puts the rewrite back when the page restores the original words (${shape})`, async () => {
      const el = make(ORIGINAL);
      injectIntoElement(el, rewrite(), 'teen', false, ORIGINAL);

      redraw(el, ORIGINAL);
      await settle();

      expect(el.textContent).toContain(REWRITE);
      expect(el.textContent).not.toContain('never be enough');
    });
  }

  it('puts the rewrite back when the page restores the original with more words after it', async () => {
    const el = plain(ORIGINAL);
    injectIntoElement(el, rewrite(), 'teen', false, ORIGINAL);

    redraw(el, `${ORIGINAL} Show more`);
    await settle();

    expect(el.textContent).toContain(REWRITE);
  });

  it('puts the rewrite back when the page empties the element while it hydrates', async () => {
    const el = plain(ORIGINAL);
    injectIntoElement(el, rewrite(), 'teen', false, ORIGINAL);

    redraw(el, '');
    await settle();

    expect(el.textContent).toContain(REWRITE);
  });

  it('puts the rewrite back when the original held emoji and the page draws it again', async () => {
    const original = 'you will never be enough unless you buy this 😡';
    const el = plain(original);
    injectIntoElement(el, rewrite(), 'teen', false, original);

    redraw(el, original);
    await settle();

    expect(el.textContent).toContain(REWRITE);
  });

  it('keeps putting the rewrite back when the original is not known to the caller', async () => {
    const el = plain(ORIGINAL);
    injectIntoElement(el, rewrite(), 'teen');

    redraw(el, OTHER);
    await settle();

    expect(el.textContent).toContain(REWRITE);
  });

  it('puts the fold back when the page restores the original words', async () => {
    const el = plain(ORIGINAL);
    injectCollapseOrHide(el, analysis(), 'collapse', false, ORIGINAL);
    const placeholder = el.textContent;

    redraw(el, ORIGINAL);
    await settle();

    expect(el.textContent).toBe(placeholder);
  });
});

describe('a post the page shows cut short is still the same post', () => {
  // Facebook cuts a long post to a few lines and adds "See more"; the cut can leave fewer words than
  // the guard compares. The words shown still begin as the original does.
  const LONG = 'Wow\n\nRead this before you scroll on, because nobody will ever tell you what really happened to us';

  it('puts the rewrite back when the page shows only the first words and a see-more line', async () => {
    const el = plain(LONG);
    injectIntoElement(el, rewrite(), 'teen', false, LONG);

    redraw(el, 'Wow Read this… See more');
    await settle();

    expect(el.textContent).toContain(REWRITE);
  });

  it('puts the rewrite back when the cut leaves more than the compared words', async () => {
    const el = plain(LONG);
    injectIntoElement(el, rewrite(), 'teen', false, LONG);

    redraw(el, 'Wow Read this before you scroll on, because nobody will ever tell… See more');
    await settle();

    expect(el.textContent).toContain(REWRITE);
  });

  it('still leaves another post alone when it happens to open with the same word', async () => {
    const el = plain(LONG);
    injectIntoElement(el, rewrite(), 'teen', false, LONG);

    redraw(el, 'Wow what a lovely morning for a long walk by the river');
    await settle();

    expect(el.textContent).toBe('Wow what a lovely morning for a long walk by the river');
  });

  // Two different posts that open with the same 8 or more characters ("Breaking news: ...") are not
  // one post: the guard leaves the new post its own words instead of pasting the old rewrite over it.
  it('still leaves another post alone when it opens with the same 8+ characters and is not a cut form', async () => {
    const original = 'Breaking news: the mayor resigned after weeks of pressure and protest downtown';
    const other = 'Breaking news: local team wins championship for the first time in decades';
    const el = plain(original);
    injectIntoElement(el, rewrite(), 'teen', false, original);

    redraw(el, other);
    await settle();

    expect(el.textContent).toBe(other);
  });

  const BREAKING = 'Breaking news: the mayor resigned after weeks of pressure and protest downtown';

  it.each([
    ['ends in an ellipsis of its own', 'Breaking news: local team wins the title, wait for it...'],
    ['has an ellipsis and a hashtag after the shared opening', 'Breaking news: he said it… and then left #wow'],
  ])('still leaves another post alone when it opens the same way and %s', async (_name, other) => {
    const el = plain(BREAKING);
    injectIntoElement(el, rewrite(), 'teen', false, BREAKING);

    redraw(el, other);
    await settle();

    expect(el.textContent).toBe(other);
  });

  it.each([
    ['Breaking news: the mayor resigned after… See more'],
    ['Breaking news: the mayor resigned after ... See more'],
  ])('still puts the rewrite back on the cut form of the same post: %s', async (cut) => {
    const el = plain(BREAKING);
    injectIntoElement(el, rewrite(), 'teen', false, BREAKING);

    redraw(el, cut);
    await settle();

    expect(el.textContent).toContain(REWRITE);
  });

  // A Romanian fold label after a three-dot ellipsis ("... Citește mai mult" is 20 characters,
  // "... Afișează mai mult" is 21) is longer than the English one. The shown text is compared from
  // the front, where a cut form still opens with the original's own words, so the label's length
  // cannot crowd them out. These are the labels' own cases, not a translation of the English one.
  const LONG_RO = 'Uau\n\nCitește asta înainte să dai mai departe, pentru că nimeni nu îți va spune ce s-a întâmplat cu adevărat';

  it('puts the rewrite back on a Romanian cut form ending in "… Citește mai mult"', async () => {
    const el = plain(LONG_RO);
    injectIntoElement(el, rewrite(), 'teen', false, LONG_RO);

    redraw(el, 'Uau Citește asta… Citește mai mult');
    await settle();

    expect(el.textContent).toContain(REWRITE);
  });

  it('puts the rewrite back on the longer sibling label "… Afișează mai mult"', async () => {
    const el = plain(LONG_RO);
    injectIntoElement(el, rewrite(), 'teen', false, LONG_RO);

    redraw(el, 'Uau Citește asta… Afișează mai mult');
    await settle();

    expect(el.textContent).toContain(REWRITE);
  });
});

describe('the element is read again once its guard has left it', () => {
  it('hands the element to whoever re-reads posts, once, when the page puts another post in it', async () => {
    const reread = vi.fn();
    setGuardStandDownHandler(reread);
    const el = plain(ORIGINAL);
    injectIntoElement(el, rewrite(), 'teen', false, ORIGINAL);

    redraw(el, OTHER);
    await settle();

    expect(reread).toHaveBeenCalledTimes(1);
    expect(reread).toHaveBeenCalledWith(el);
  });

  it('does the same for a fold', async () => {
    const reread = vi.fn();
    setGuardStandDownHandler(reread);
    const el = plain(ORIGINAL);
    injectCollapseOrHide(el, analysis(), 'collapse', false, ORIGINAL);

    redraw(el, OTHER);
    await settle();

    expect(reread).toHaveBeenCalledTimes(1);
  });

  it('a translation of the same post is read as new words, not shown unchecked', async () => {
    const reread = vi.fn();
    setGuardStandDownHandler(reread);
    const el = plain(ORIGINAL);
    injectIntoElement(el, rewrite(), 'teen', false, ORIGINAL);

    redraw(el, 'nunca seras suficiente a menos que compres esto hoy');
    await settle();

    expect(reread).toHaveBeenCalledTimes(1);
  });

  it('does not re-read when the page only redraws the same post', async () => {
    const reread = vi.fn();
    setGuardStandDownHandler(reread);
    const el = plain(ORIGINAL);
    injectIntoElement(el, rewrite(), 'teen', false, ORIGINAL);

    redraw(el, ORIGINAL);
    await settle();

    expect(reread).not.toHaveBeenCalled();
  });

  it('leaves the element alone even if the re-reader throws', async () => {
    setGuardStandDownHandler(() => { throw new Error('re-read failed'); });
    const el = plain(ORIGINAL);
    injectIntoElement(el, rewrite(), 'teen', false, ORIGINAL);

    redraw(el, OTHER);
    await settle();

    expect(el.textContent).toBe(OTHER);
  });

  it('is wired to the interceptor that re-reads a row', () => {
    const entry = readFileSync(repoPath('src', 'content', 'index.ts'), 'utf8');
    expect(entry).toMatch(/setGuardStandDownHandler\(\(el\) => activeInterceptor\?\.rearmElement\(el\)\)/);
  });
});
