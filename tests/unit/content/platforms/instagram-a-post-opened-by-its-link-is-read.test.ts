// @vitest-environment jsdom
//
// An Instagram post opened by its link is read (11 Oct 2026, the night walk: two public posts opened signed out showed
// the post and about ten comments for over a minute and nothing entered the record; the popup said "recording").
// The pages are the Tester's two saved element trees (tests/fixtures/instagram/post-by-link-*.html: the structure
// and attributes of the page, the words filled in; the Tester's own marks name the caption and its words). Three
// things were wrong on them (a fourth: a comment with a second line or a mention in it was passed over). The address was /<user>/p/<code>/, and every check looked for /p/<code>/ at the start of
// the path. The caption is a span that holds its words, line breaks and hashtag links, which the reader's "text only"
// test did not accept, so it took the longest plain span on the page, a line of the sign-in wall. And the post's
// author was the first profile link under <main>, not the one beside the caption.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { InstagramAdapter } from '../../../../src/content/platforms/instagram';
import type { PostContent } from '../../../../src/types/post';

const CODE = 'ExampleP0st';
/** Comment rows that carry their own /c/ link in each saved page, counted in the fixture. */
const PERMALINKS: Record<number, number> = { 1: 12, 2: 11 };

function setLocation(pathname: string): void {
  Object.defineProperty(window, 'location', {
    value: { hostname: 'www.instagram.com', pathname, href: `https://www.instagram.com${pathname}` },
    writable: true,
    configurable: true,
  });
}
const loadPage = (n: number): void => {
  document.body.innerHTML = readFileSync(`tests/fixtures/instagram/post-by-link-${n}.html`, 'utf8');
};
const read = (adapter: InstagramAdapter): PostContent[] => adapter.extractPosts(document.body.childNodes);

beforeEach(() => {
  document.body.innerHTML = '';
});

for (const n of [1, 2]) {
  for (const path of [`/p/${CODE}/`, `/nasa/p/${CODE}/`]) {
    describe(`saved page ${n}, opened at ${path}`, () => {
      it('the post is read, with its own caption and its own author', () => {
        setLocation(path);
        loadPage(n);
        const posts = read(new InstagramAdapter()).filter((p) => p.kind === 'post');
        expect(posts).toHaveLength(1);
        const caption = document.querySelector<HTMLElement>('[data-tester-caption-text]')!;
        const author = document.querySelector('[data-tester-caption] a[href^="/"]')!.textContent!.trim();
        expect(posts[0].id).toBe(CODE);
        expect(posts[0].text, 'the caption, not a line of the sign-in wall').toBe(caption.textContent!.trim());
        expect(posts[0].text.length).toBeGreaterThan(100);
        expect(posts[0].author).toBe(author);
        expect(posts[0].domRef.deref(), 'the marker mounts on the caption itself').toBe(caption);
        expect(posts[0].sourceUrl).toBe(`https://www.instagram.com/p/${CODE}/`);
      });

      it('every comment that has its own link is read, once, with its words and its author', () => {
        setLocation(path);
        loadPage(n);
        const comments = read(new InstagramAdapter()).filter((p) => p.kind !== 'post');
        expect(document.querySelectorAll('a[href*="/c/"]'), 'the saved page has the comment links counted above').toHaveLength(PERMALINKS[n]);
        expect(comments).toHaveLength(PERMALINKS[n]);
        expect(new Set(comments.map((c) => c.id)).size, 'a distinct id each').toBe(comments.length);
        for (const c of comments) {
          expect(c.id).toMatch(/^ig-cmt-1\d{16}$/);
          expect(c.kind).toBe('top-comment');
          expect(c.parentVideoId).toBe(CODE);
          expect(c.text, 'the words of the comment, not its Reply control, its age or its author').toContain('bod');
          expect(c.text).not.toMatch(/^(Reply|Like|1w|12h)$/);
          expect(c.text).not.toBe(c.author);
          expect(c.author).toMatch(/^h[0-9a-z]+/);
        }
      });

      it('a second pass over the same page adds nothing', () => {
        setLocation(path);
        loadPage(n);
        const adapter = new InstagramAdapter();
        expect(read(adapter).length).toBeGreaterThan(10);
        expect(read(adapter)).toHaveLength(0);
      });
    });
  }
}

describe('what the caption is', () => {
  it('a short caption is still the caption, not a longer line of the sign-in wall', () => {
    setLocation(`/nasa/p/${CODE}/`);
    loadPage(1);
    document.querySelector('[data-tester-caption-text]')!.innerHTML = 'Happy day <a href="/explore/tags/space/">#space</a>';
    const post = read(new InstagramAdapter()).find((p) => p.kind === 'post')!;
    expect(post.text).toBe('Happy day #space');
  });

  it('a page that is not a post address reads as it did: the profile of a user is not a post', () => {
    setLocation('/nasa/');
    loadPage(1);
    const posts = read(new InstagramAdapter());
    expect(posts.filter((p) => p.kind === 'post' && p.id === CODE)).toHaveLength(0);
  });
});
