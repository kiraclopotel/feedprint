// @vitest-environment jsdom
//
// record-feed-study/C-NOTES.md fault, #8339: a real export had a comment
// whose originalText AND roomCaption both read "View all 4 replies". IG
// renders that reply-count control as a `div[role="button"]`, never a real
// `<button>` tag, so the walker's comment-body picker (which only excludes
// `s.closest('button')`) let the control's own span through as if it were
// someone's words. Once _walkCommentsContainer stopped treating it as a
// comment, nothing downstream had it left to adopt as a room caption either.

import { describe, it, expect, beforeEach } from 'vitest';
import { InstagramAdapter } from '../../../../src/content/platforms/instagram';
import { makeArticle, toNodeList } from './instagram-page-fixtures';

describe('the reply-count control is not a comment', () => {
  let adapter: InstagramAdapter;

  beforeEach(() => {
    document.body.innerHTML = '';
    adapter = new InstagramAdapter();
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.instagram.com', pathname: '/' },
      writable: true,
      configurable: true,
    });
  });

  it('drops a "View all N replies" row and still reads the genuine comment beside it', () => {
    const article = makeArticle(`
      <a href="/p/DExAmPle0c3/" role="link">View</a>
      <a href="/xx12345678/" role="link"><span>xx12345678</span></a>
      <span dir="auto">Main caption text that is long enough to be extracted by the adapter properly.</span>
      <ul>
        <li><span>Caption row placeholder ignored by walker</span></li>
        <li>
          <a href="/xx12345678/"><span>xx12345678</span></a>
          <span>A genuine comment that the walker should pick up.</span>
        </li>
        <li>
          <div role="button" tabindex="0"><span>View all 4 replies</span></div>
        </li>
      </ul>
    `);

    const posts = adapter.extractPosts(toNodeList([article]));
    const comments = posts.filter(p => p.kind === 'top-comment');

    expect(comments).toHaveLength(1);
    expect(comments[0].text).toContain('genuine comment');
    expect(comments.some(c => c.text === 'View all 4 replies')).toBe(false);
  });

  // Cold read finding 2 (COLD-READ-ee35374f-74c9ea6a-2026-09-28.md #2): the
  // first fix ran the exclusion on the row's already-picked longest span, so
  // a reply control sharing ITS OWN row with a genuine shorter comment could
  // still win the "longest span" comparison and the real comment was lost
  // ("so true" + "View all 4 replies" loses "so true"). The exclusion has to
  // run inside the span-selection loop, before a span is ever compared.
  it('keeps the genuine short comment when the reply control shares its own row', () => {
    const article = makeArticle(`
      <a href="/p/DExAmPle0c3/" role="link">View</a>
      <a href="/xx12345678/" role="link"><span>xx12345678</span></a>
      <span dir="auto">Main caption text that is long enough to be extracted by the adapter properly.</span>
      <ul>
        <li><span>Caption row placeholder ignored by walker</span></li>
        <li>
          <a href="/xx12345678/"><span>xx12345678</span></a>
          <span>so true</span>
          <div role="button" tabindex="0"><span>View all 4 replies</span></div>
        </li>
      </ul>
    `);

    const posts = adapter.extractPosts(toNodeList([article]));
    const comments = posts.filter(p => p.kind === 'top-comment');

    expect(comments).toHaveLength(1);
    expect(comments[0].text).toBe('so true');
  });

  it('drops a bare "View replies" row (no count) the same way', () => {
    const article = makeArticle(`
      <a href="/p/DExAmPle0c3/" role="link">View</a>
      <a href="/poster/" role="link"><span>poster</span></a>
      <span dir="auto">Main caption text that is long enough to be extracted by the adapter properly.</span>
      <ul>
        <li><span>Caption row placeholder ignored by walker</span></li>
        <li>
          <div role="button" tabindex="0"><span>View replies</span></div>
        </li>
      </ul>
    `);

    const posts = adapter.extractPosts(toNodeList([article]));
    const comments = posts.filter(p => p.kind === 'top-comment');

    expect(comments).toHaveLength(0);
  });

  // Cold read finding 2 also names the missing locales: the control's label
  // was only matched in Romanian, English and German.
  it.each([
    ['es', 'Ver todas las respuestas'],
    ['pt', 'Ver todas as respostas'],
    ['en hide', 'Hide replies'],
  ])('drops the %s reply control label too', (_locale, label) => {
    const article = makeArticle(`
      <a href="/p/DExAmPle0c3/" role="link">View</a>
      <a href="/poster/" role="link"><span>poster</span></a>
      <span dir="auto">Main caption text that is long enough to be extracted by the adapter properly.</span>
      <ul>
        <li><span>Caption row placeholder ignored by walker</span></li>
        <li>
          <div role="button" tabindex="0"><span>${label}</span></div>
        </li>
      </ul>
    `);

    const posts = adapter.extractPosts(toNodeList([article]));
    const comments = posts.filter(p => p.kind === 'top-comment');

    expect(comments).toHaveLength(0);
  });
});
