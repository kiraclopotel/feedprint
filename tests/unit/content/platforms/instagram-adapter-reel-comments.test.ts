// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { InstagramAdapter } from '../../../../src/content/platforms/instagram';

function setLocation(pathname: string): void {
  Object.defineProperty(window, 'location', {
    value: { hostname: 'www.instagram.com', pathname },
    writable: true,
    configurable: true,
  });
}

/**
 * Reels overlay DOM shape — `main > div(reel-container with video) +
 * div > ul > li(caption-row) + li(comment) ...`. The `<ul>` is NOT inside
 * an `<article>` (Reels surface has no article wrapper).
 */
function buildReelDom(opts: {
  captionText: string;
  captionAuthor: string;
  comments: Array<{ handle: string; text: string }>;
  includeOverlay: boolean;
}): void {
  document.body.innerHTML = '';
  const main = document.createElement('main');

  const reelContainer = document.createElement('div');
  reelContainer.innerHTML = `
    <video></video>
    <a href="/${opts.captionAuthor}/"><span>${opts.captionAuthor}</span></a>
    <span dir="auto">${opts.captionText}</span>
  `;
  main.appendChild(reelContainer);

  if (opts.includeOverlay) {
    const overlay = document.createElement('div');
    const ul = document.createElement('ul');
    // First LI is the caption row (matches IG behavior in both article + reel shapes).
    const captionLi = document.createElement('li');
    captionLi.innerHTML = `
      <a href="/${opts.captionAuthor}/"><span>${opts.captionAuthor}</span></a>
      <span dir="auto">${opts.captionText}</span>
    `;
    ul.appendChild(captionLi);
    for (const c of opts.comments) {
      const li = document.createElement('li');
      li.innerHTML = `
        <a href="/${c.handle}/"><span>${c.handle}</span></a>
        <div><span dir="auto">${c.text}</span></div>
      `;
      ul.appendChild(li);
    }
    overlay.appendChild(ul);
    main.appendChild(overlay);
  }

  document.body.appendChild(main);
}

function captureMainAsNodeList(): NodeList {
  const wrapper = document.createElement('div');
  // Reel surface has no <article> — pass an empty article-shaped query result
  // so the article-loop is a no-op and the fallback `_extractReelSurface` fires.
  return wrapper.querySelectorAll('article');
}

describe('InstagramAdapter — Reels comment extraction', () => {
  let adapter: InstagramAdapter;

  beforeEach(() => {
    adapter = new InstagramAdapter();
    document.body.innerHTML = '';
  });

  it('emits top-comment records when overlay is open with comments present', () => {
    setLocation('/reels/AbCdEf123/');
    buildReelDom({
      captionText: 'A reel caption that is long enough to be picked up by the adapter as caption text.',
      captionAuthor: 'creator_handle',
      comments: [
        { handle: 'viewer_one', text: 'First comment text long enough to clear the minimum-length filter.' },
        { handle: 'viewer_two', text: 'Second comment text also long enough to clear the minimum-length filter.' },
        { handle: 'viewer_three', text: 'Third comment text also long enough to clear the minimum-length filter.' },
      ],
      includeOverlay: true,
    });

    const posts = adapter.extractPosts(captureMainAsNodeList());

    // 1 caption record + 3 comment records
    expect(posts).toHaveLength(4);

    const captionRecord = posts[0];
    expect(captionRecord.kind).toBe('video');
    expect(captionRecord.id).toBe('AbCdEf123');

    const comments = posts.slice(1);
    expect(comments).toHaveLength(3);
    for (const c of comments) {
      expect(c.kind).toBe('top-comment');
      expect(c.depth).toBe(1);
      expect(c.parent_id).toBe('AbCdEf123');
      expect(c.parentVideoId).toBe('AbCdEf123');
      expect(c.platform).toBe('instagram');
      expect(c.platform_specific).toBeDefined();
      if (c.platform_specific && c.platform_specific.platform === 'instagram') {
        expect(c.platform_specific.surfaceKind).toBe('instagram-reel');
        expect(c.platform_specific.commentLevel).toBe(1);
      }
    }
  });

  it('emits caption-only when overlay is closed (gold case)', () => {
    setLocation('/reels/XyZ789/');
    buildReelDom({
      captionText: 'A reel caption present without any open comment overlay rendered into the DOM.',
      captionAuthor: 'soloposter',
      comments: [],
      includeOverlay: false,
    });

    const posts = adapter.extractPosts(captureMainAsNodeList());

    expect(posts).toHaveLength(1);
    expect(posts[0].kind).toBe('video');
    expect(posts[0].id).toBe('XyZ789');
  });

  it('article-path comment extraction continues to work after Template Method extraction', () => {
    setLocation('/p/Abc123/');
    document.body.innerHTML = '';
    const article = document.createElement('article');
    article.innerHTML = `
      <a href="/articleauthor/" role="link"><span>articleauthor</span></a>
      <a href="/p/Abc123/">View</a>
      <span dir="auto">Article-path caption text long enough to be picked up by the caption extractor logic.</span>
      <ul>
        <li>
          <a href="/articleauthor/"><span>articleauthor</span></a>
          <span dir="auto">Article-path caption text long enough to be picked up by the caption extractor logic.</span>
        </li>
        <li>
          <a href="/commenter_one/"><span>commenter_one</span></a>
          <div><span dir="auto">Article-path comment one with text long enough to pass minimum-length filter.</span></div>
        </li>
        <li>
          <a href="/commenter_two/"><span>commenter_two</span></a>
          <div><span dir="auto">Article-path comment two with text long enough to pass minimum-length filter.</span></div>
        </li>
      </ul>
    `;
    const wrapper = document.createElement('div');
    wrapper.appendChild(article);
    document.body.appendChild(wrapper);

    const posts = adapter.extractPosts(wrapper.querySelectorAll('article'));

    // 1 caption + 2 comments
    expect(posts).toHaveLength(3);
    const captionRecord = posts[0];
    expect(captionRecord.id).toBe('Abc123');
    if (captionRecord.platform_specific && captionRecord.platform_specific.platform === 'instagram') {
      expect(captionRecord.platform_specific.surfaceKind).toBe('instagram-post');
    }
    const comments = posts.slice(1);
    expect(comments).toHaveLength(2);
    for (const c of comments) {
      expect(c.kind).toBe('top-comment');
      expect(c.depth).toBe(1);
      expect(c.parent_id).toBe('Abc123');
      if (c.platform_specific && c.platform_specific.platform === 'instagram') {
        expect(c.platform_specific.surfaceKind).toBe('instagram-post');
      }
    }
  });

  it('handles malformed reels DOM gracefully (empty ul, LI without comment substructure)', () => {
    setLocation('/reels/Mal123/');
    document.body.innerHTML = '';
    const main = document.createElement('main');
    const reelContainer = document.createElement('div');
    reelContainer.innerHTML = `
      <video></video>
      <a href="/malformed_creator/"><span>malformed_creator</span></a>
      <span dir="auto">A reel caption that meets the minimum length requirement for extraction.</span>
    `;
    main.appendChild(reelContainer);

    // Empty ul (no LIs)
    const emptyOverlay = document.createElement('div');
    emptyOverlay.appendChild(document.createElement('ul'));
    main.appendChild(emptyOverlay);

    // ul with LIs that have NO comment substructure (no anchor, no spans)
    const nonCommentOverlay = document.createElement('div');
    const nonUl = document.createElement('ul');
    const emptyLi = document.createElement('li');
    nonUl.appendChild(emptyLi);
    nonCommentOverlay.appendChild(nonUl);
    main.appendChild(nonCommentOverlay);

    document.body.appendChild(main);

    expect(() => {
      const posts = adapter.extractPosts(captureMainAsNodeList());
      // Caption-only — no comments emitted from malformed overlays.
      expect(posts).toHaveLength(1);
      expect(posts[0].kind).toBe('video');
    }).not.toThrow();
  });
});
