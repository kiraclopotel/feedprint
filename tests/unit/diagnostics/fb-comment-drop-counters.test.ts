// @vitest-environment jsdom
//
// Facebook comment counters count elements, not passes (2026-09-02).
//
// The 2026-09-01 diagnostics read 2705 candidates, 1145 dropped on label and
// 296 extracted, and that 11% could not be read as an extraction rate.
// `_extractComments` re-runs on every DOM mutation. An extracted comment is
// stamped `fwCommentSeen` and leaves the candidate set for good; a REJECTED
// element is deliberately not stamped, so it was re-examined AND re-counted on
// every pass. The numerator counted each comment once, the denominator counted
// each reject once per pass, and the things this walker correctly rejects
// (nested and shared posts, ad wrappers) are permanent fixtures in the article.
//
// These tests pin both halves of the fix: the counting is deduplicated per
// element and reason, and the READING is not — a rejected element is still
// re-evaluated every pass, because a comment body that has not rendered yet
// reads as no-text and going blind to it would be the wrong trade.

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../src/diagnostics/diagnostics', () => ({
  bumpCounter: vi.fn(),
}));

import { FacebookAdapter } from '../../../src/content/platforms/facebook';
import { bumpCounter } from '../../../src/diagnostics/diagnostics';

const mockBump = bumpCounter as unknown as ReturnType<typeof vi.fn>;

function total(name: string): number {
  return mockBump.mock.calls
    .filter((c) => c[0] === name)
    .reduce((sum, c) => sum + (c[1] as number), 0);
}

function toNodeList(elements: HTMLElement[]): NodeList {
  const container = document.createElement('div');
  for (const el of elements) container.appendChild(el);
  return container.querySelectorAll('div[role="article"]');
}

/** A post article carrying one real comment and one non-comment wrapper. */
function makeArticle(): HTMLElement {
  const article = document.createElement('div');
  article.setAttribute('role', 'article');
  article.innerHTML = `
    <a href="/u/posts/postId001">post</a>
    <div dir="auto">Main post body that is long enough to extract per the 20-char floor.</div>
  `;

  const comment = document.createElement('div');
  comment.setAttribute('role', 'article');
  comment.setAttribute('aria-label', 'Comentariu adăugat de Maria Popescu');
  comment.innerHTML = `
    <a role="link" href="/cu1"><span>Maria Popescu</span></a>
    <div dir="auto">A real comment body, long enough to clear the five character floor.</div>
  `;
  article.appendChild(comment);

  // A shared post embedded in the article: matches the same selector shape,
  // carries body text, and is CORRECTLY rejected on its label. It never goes
  // away, so it is re-examined on every pass.
  const shared = document.createElement('div');
  shared.setAttribute('role', 'article');
  shared.setAttribute('aria-label', 'Postare distribuită de cineva');
  shared.innerHTML = '<div dir="auto">The shared post body text goes here.</div>';
  article.appendChild(shared);

  return article;
}

let adapter: FacebookAdapter;

beforeEach(() => {
  mockBump.mockReset();
  document.body.replaceChildren();
  adapter = new FacebookAdapter();
  Object.defineProperty(window, 'location', {
    value: { hostname: 'www.facebook.com', pathname: '/somepath/posts/abc123' },
    writable: true,
    configurable: true,
  });
});

describe('Facebook comment counters across repeated passes', () => {
  it('counts a rejected wrapper once, not once per pass', () => {
    const article = makeArticle();
    const nodes = toNodeList([article]);

    adapter.extractPosts(nodes);
    adapter.extractPosts(nodes);
    adapter.extractPosts(nodes);

    // One real comment + one shared-post wrapper, seen three times.
    expect(total('fbCommentCandidates')).toBe(2);
    expect(total('fbCommentDroppedLabel')).toBe(1);
    // Documented, not endorsed: the "still looks like a comment" discriminator
    // is a body element with text, and a shared post carries one, so it counts
    // this correct rejection as suspicious. Once per element rather than once
    // per pass, at least. Sharpening it waits for the real split.
    expect(total('fbCommentDroppedLabelWithText')).toBe(1);
    expect(total('fbCommentExtracted')).toBe(1);
  });

  it('still re-reads a rejected element every pass, so a late body is not lost', () => {
    const article = makeArticle();
    const nodes = toNodeList([article]);

    // A comment whose body has not rendered yet: correct label, no dir-auto.
    const pending = document.createElement('div');
    pending.setAttribute('role', 'article');
    pending.setAttribute('aria-label', 'Comentariu adăugat de Bob');
    pending.innerHTML = '<a role="link" href="/cu2"><span>Bob</span></a>';
    article.appendChild(pending);

    adapter.extractPosts(nodes);
    expect(total('fbCommentDroppedNoText')).toBe(1);
    expect(total('fbCommentExtracted')).toBe(1);

    // The body arrives. The element was never marked seen, so it is read again.
    const body = document.createElement('div');
    body.setAttribute('dir', 'auto');
    body.textContent = 'The comment body that arrived on the second render pass.';
    pending.appendChild(body);

    mockBump.mockReset();
    adapter.extractPosts(nodes);

    expect(total('fbCommentExtracted')).toBe(1);
    // Counted once as a candidate on the first pass, not again here.
    expect(total('fbCommentCandidates')).toBe(0);
    expect(total('fbCommentDroppedNoText')).toBe(0);
  });

  it('counts a comment under the five character floor once, and still re-reads it', () => {
    const article = makeArticle();

    // A real comment whose body is too short: correct label, a body element,
    // four characters. The walker drops it at the floor and counts the drop
    // per element, not per pass; the element is left unstamped so a body that
    // grows (an edit, a late paragraph) is read again.
    const short = document.createElement('div');
    short.setAttribute('role', 'article');
    short.setAttribute('aria-label', 'Comentariu adăugat de Eve');
    short.innerHTML = `
      <a role="link" href="/cu-eve"><span>Eve</span></a>
      <div dir="auto">nice</div>
    `;
    article.appendChild(short);
    const nodes = toNodeList([article]);

    adapter.extractPosts(nodes);
    adapter.extractPosts(nodes);

    expect(total('fbCommentDroppedShort')).toBe(1);
    expect(total('fbCommentExtracted')).toBe(1);
    expect(short.dataset.fwCommentSeen).toBeUndefined();

    // The body grows past the floor: the same element is extracted now.
    short.querySelector('div[dir="auto"]')!.textContent = 'nice, and now long enough to count';
    mockBump.mockReset();
    adapter.extractPosts(nodes);

    expect(total('fbCommentDroppedShort')).toBe(0);
    expect(total('fbCommentExtracted')).toBe(1);
    expect(short.dataset.fwCommentSeen).toBe('true');
  });

  it('counts the duplicate drop that used to be silent, and no longer counts two people as one', () => {
    // CHANGED 2026-09-17, deliberately. This case used to assert that two
    // different people writing the same short reply produced one record and
    // one duplicate drop, which is what the walker did: the seen-set was keyed
    // on the exact text. That is the defect, not the contract. The key is now
    // the comment's own permalink id, or the commenter's name beside the
    // words, so both are recorded and nothing is dropped.
    const article = makeArticle();
    for (const who of ['Carol', 'Dan']) {
      const cmt = document.createElement('div');
      cmt.setAttribute('role', 'article');
      cmt.setAttribute('aria-label', `Comentariu adăugat de ${who}`);
      cmt.innerHTML = `
        <a role="link" href="/cu-${who}"><span>${who}</span></a>
        <div dir="auto">exactly the same thing</div>
      `;
      article.appendChild(cmt);
    }

    adapter.extractPosts(toNodeList([article]));

    expect(total('fbCommentDroppedDuplicate')).toBe(0);
    expect(total('fbCommentExtracted')).toBe(3);
  });

  it('still counts a drop when one comment is drawn twice in the same article', () => {
    // The guard the drop exists for: one person, one body, rendered twice.
    const article = makeArticle();
    for (let i = 0; i < 2; i++) {
      const cmt = document.createElement('div');
      cmt.setAttribute('role', 'article');
      cmt.setAttribute('aria-label', 'Comentariu adăugat de Carol');
      cmt.innerHTML = `
        <a role="link" href="/cu-carol"><span>Carol</span></a>
        <div dir="auto">exactly the same thing</div>
      `;
      article.appendChild(cmt);
    }

    adapter.extractPosts(toNodeList([article]));

    expect(total('fbCommentDroppedDuplicate')).toBe(1);
    expect(total('fbCommentExtracted')).toBe(2);
  });
});
