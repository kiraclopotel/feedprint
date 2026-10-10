// @vitest-environment jsdom
//
// Instagram read a comment's own words as metadata about itself.
//
// `extractInstagramCommentSignals` was handed the comment's row and scanned
// `row.textContent`, which is the comment body plus everything drawn around it
// plus, for a parent comment, every reply underneath it. Three of its four
// signals are text scans, so:
//
//   "got 12 likes on my last post"      set likes: 12
//   "view 3 replies from my lawyer"     set reply_count: 3
//   a comment mentioning being edited   set isEdited
//
// All three ride into the signed record, and all three are the person's own
// sentence being read back as a fact about them.
//
// Facebook had exactly this shape and it was closed there on 2026-09-19 with
// `commentChromeText`. Instagram was not carried, which is the thing worth
// keeping: a fix applied to one platform and not to the platform beside it
// leaves the defect live and the register reading closed.
//
// Instagram needs one step Facebook did not. A parent comment's row CONTAINS
// its replies as nested rows, so subtracting the body alone would leave
// somebody else's sentence in the string.
//
// Every body below is deliberately clean of the words being searched for,
// except where the case is about a body that is not.

import { describe, it, expect, beforeEach } from 'vitest';
import { InstagramAdapter } from '../../../../src/content/platforms/instagram';
import type { PostContent } from '../../../../src/types/post';

function setLocation(pathname: string): void {
  Object.defineProperty(window, 'location', {
    value: { hostname: 'www.instagram.com', pathname },
    writable: true,
    configurable: true,
  });
}

/**
 * One reel with one comment. `chrome` is markup the platform draws beside the
 * body; `replies` are nested rows, in the nested `<ul>` Instagram uses.
 */
function mount(body: string, chrome = '', replies: string[] = []): void {
  document.body.innerHTML = '';
  const main = document.createElement('main');
  const reel = document.createElement('div');
  reel.innerHTML = `
    <video></video>
    <a href="/creator_handle/"><span>creator_handle</span></a>
    <span dir="auto">A reel caption that is long enough to be picked up as caption text.</span>
  `;
  main.appendChild(reel);

  const overlay = document.createElement('div');
  const ul = document.createElement('ul');
  ul.innerHTML = `
    <li>
      <a href="/creator_handle/"><span>creator_handle</span></a>
      <span dir="auto">A reel caption that is long enough to be picked up as caption text.</span>
    </li>
    <li>
      <a href="/viewer_one/"><span>viewer_one</span></a>
      <div><span dir="auto">${body}</span></div>
      ${chrome}
      ${replies.length ? `<ul>${replies.map((r) => `<li><a href="/viewer_two/"><span>viewer_two</span></a><div><span dir="auto">${r}</span></div></li>`).join('')}</ul>` : ''}
    </li>
  `;
  overlay.appendChild(ul);
  main.appendChild(overlay);
  document.body.appendChild(main);
}

/** Reels have no <article>, so the article loop is a no-op and the reel path runs. */
function noArticles(): NodeList {
  return document.createElement('div').querySelectorAll('article');
}

type Metrics = { likes?: number; reply_count?: number };

function firstComment(): PostContent {
  const posts = new InstagramAdapter().extractPosts(noArticles());
  const comments = posts.filter((p) => p.kind === 'top-comment');
  expect(comments.length, 'the comment was extracted at all').toBeGreaterThan(0);
  return comments[0];
}

/** The counters ride under platform_specific, which is where the record reads them. */
const metricsOf = (p: PostContent): Metrics =>
  ((p.platform_specific as unknown as { metrics?: Metrics } | undefined)?.metrics ?? {});

beforeEach(() => {
  setLocation('/reels/AbCdEf123/');
  document.body.innerHTML = '';
});

describe('Instagram comment signals read the chrome (2026-09-19)', () => {
  it('a comment that talks about likes does not get a like count', () => {
    mount('honestly I got 12 likes on my last post and that was my best week');
    expect(metricsOf(firstComment()).likes, "the person's own sentence is not a counter").toBeUndefined();
  });

  it('a comment that talks about replies does not get a reply count', () => {
    mount('I had to view 3 replies from my lawyer before I understood any of it');
    expect(metricsOf(firstComment()).reply_count).toBeUndefined();
  });

  it('the real like counter, drawn beside the comment, is still read', () => {
    // The control. A fix that read nothing would be the same defect pointing
    // the other way, and nothing on the page would say so.
    mount('a perfectly ordinary sentence with no numbers in it at all', '<span>41 likes</span>');
    expect(metricsOf(firstComment()).likes, 'the chrome is still read').toBe(41);
  });

  it('the real reply counter is still read', () => {
    mount('another ordinary sentence with nothing countable in it', '<button>View 5 replies</button>');
    expect(metricsOf(firstComment()).reply_count).toBe(5);
  });

  it("a reply's words are not counted as the parent's chrome", () => {
    // The step Facebook did not need. The parent's row contains the reply, so
    // subtracting only the body would leave somebody else's sentence behind.
    mount(
      'the parent comment, saying nothing about counts',
      '',
      ['for what it is worth I got 99 likes on that one and 7 replies'],
    );
    const m = metricsOf(firstComment());
    expect(m.likes, "a reply is a different person's sentence").toBeUndefined();
    expect(m.reply_count).toBeUndefined();
  });

  it('a real counter still wins when a reply is present beside it', () => {
    mount(
      'the parent comment, saying nothing about counts',
      '<span>8 likes</span>',
      ['for what it is worth I got 99 likes on that one'],
    );
    expect(metricsOf(firstComment()).likes, 'the parent row keeps its own counter').toBe(8);
  });

  it('a comment with neither gets neither', () => {
    mount('just a sentence, long enough to be extracted, and entirely unremarkable');
    const m = metricsOf(firstComment());
    expect(m.likes).toBeUndefined();
    expect(m.reply_count).toBeUndefined();
  });
});
