// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InstagramAdapter } from '../../../../src/content/platforms/instagram';
import { makeArticle, toNodeList } from './instagram-page-fixtures';

describe('InstagramAdapter', () => {
  let adapter: InstagramAdapter;

  beforeEach(() => {
    adapter = new InstagramAdapter();
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.instagram.com', pathname: '/' },
      writable: true,
      configurable: true,
    });
  });

  it('extracts caption text from span[dir="auto"]', () => {
    const article = makeArticle(`
      <span dir="auto"><span>This is a long caption that should be extracted by the adapter properly.</span></span>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));

    expect(posts).toHaveLength(1);
    expect(posts[0].text).toContain('long caption that should be extracted');
  });

  it('skips articles inside [role="log"] (DM-leak defensive gate)', () => {
    // Defensive mirror of the FB Messenger chat-log exclusion. Live MCP
    // probe of IG /direct/inbox/ on 2026-05-28 found zero <article>
    // elements in IG's current DM UI, so the gate doesn't change today's
    // behavior. But the IG adapter's selector is the bare <article> tag,
    // so any future IG layout that nests <article> inside a chat-log
    // container would leak private DMs into the forensic chain. ARIA
    // role=log is the canonical live-region role for message logs;
    // platforms can't drop it without breaking screen-reader support.
    const log = document.createElement('div');
    log.setAttribute('role', 'log');
    log.setAttribute('aria-label', 'Messages with somebody');
    const chatArticle = document.createElement('article');
    const inner = document.createElement('span');
    inner.setAttribute('dir', 'auto');
    inner.textContent = 'A private DM that should never reach the extractor or the chain.';
    chatArticle.appendChild(inner);
    log.appendChild(chatArticle);
    document.body.appendChild(log);
    try {
      const nodes = document.querySelectorAll('article');
      const posts = adapter.extractPosts(nodes);
      expect(posts).toHaveLength(0);
    } finally {
      document.body.removeChild(log);
    }
  });

  it('skips spans inside ul (comments)', () => {
    const article = makeArticle(`
      <span dir="auto">Main caption text that is long enough to be extracted by the adapter.</span>
      <ul>
        <li>
          <span dir="auto">This is a comment that is even longer than the caption and should be skipped entirely.</span>
        </li>
      </ul>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));

    expect(posts).toHaveLength(1);
    expect(posts[0].text).toContain('Main caption text');
    expect(posts[0].text).not.toContain('comment');
  });

  it('skips spans inside buttons', () => {
    const article = makeArticle(`
      <span dir="auto">A real caption that has enough text to pass the minimum length filter easily.</span>
      <button>
        <span dir="auto">Like this post button text that is long enough to potentially match.</span>
      </button>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));

    expect(posts).toHaveLength(1);
    expect(posts[0].text).toContain('real caption');
    expect(posts[0].text).not.toContain('button text');
  });

  it('extracts author from a[role="link"] with /username/ href pattern', () => {
    const article = makeArticle(`
      <a href="/janedoe/" role="link"><span>janedoe</span></a>
      <span dir="auto">Caption text that is certainly long enough to pass the minimum length check.</span>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));

    expect(posts).toHaveLength(1);
    expect(posts[0].author).toBe('janedoe');
  });

  it('extracts post ID from /p/ URL pattern', () => {
    const article = makeArticle(`
      <a href="/p/CxYz123_Ab/">View</a>
      <span dir="auto">Caption text that is certainly long enough to pass the minimum length check.</span>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));

    expect(posts).toHaveLength(1);
    expect(posts[0].id).toBe('CxYz123_Ab');
  });

  it('extracts post ID from /reel/ URL pattern', () => {
    const article = makeArticle(`
      <a href="/reel/Abc789Def/">Watch</a>
      <span dir="auto">Caption text that is certainly long enough to pass the minimum length check.</span>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));

    expect(posts).toHaveLength(1);
    expect(posts[0].id).toBe('Abc789Def');
  });

  it('skips caption when fwCaptionEmitted is set (caption-level dedup, lazy-load safe)', () => {
    // Per-record dedup replaced the article-level fwProcessed gate so
    // lazy-loaded comments inside an already-captioned article still flow
    // through the comment-walker. The caption is gated by its own dataset
    // flag — fwCaptionEmitted — set after the caption record is pushed.
    const article = makeArticle(`
      <span dir="auto">This post has enough text but the caption record was already emitted on a prior pass.</span>
    `);
    article.dataset.fwCaptionEmitted = 'true';
    const posts = adapter.extractPosts(toNodeList([article]));

    // No caption record. (No comments in this fixture either.)
    expect(posts.filter(p => p.kind === 'post')).toHaveLength(0);
  });

  it('skips text shorter than 20 characters', () => {
    const article = makeArticle(`
      <span dir="auto">Too short</span>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));

    expect(posts).toHaveLength(0);
  });

  it('picks longest qualifying span as caption', () => {
    const article = makeArticle(`
      <span dir="auto">This is a shorter caption that passes the minimum length.</span>
      <span dir="auto">This is the longest caption in the article and it should be the one selected by the adapter logic.</span>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));

    expect(posts).toHaveLength(1);
    expect(posts[0].text).toContain('longest caption in the article');
  });

  it('feedSource returns for-you for home page', () => {
    const article = makeArticle(`
      <span dir="auto">Caption text that is long enough to be extracted by the adapter properly.</span>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));

    expect(posts).toHaveLength(1);
    expect(posts[0].feedSource).toBe('for-you');
  });

  it('feedSource returns profile for /username/ pages', () => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.instagram.com', pathname: '/janedoe/' },
      writable: true,
      configurable: true,
    });

    const article = makeArticle(`
      <span dir="auto">Caption text that is long enough to be extracted by the adapter properly.</span>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));

    expect(posts).toHaveLength(1);
    expect(posts[0].feedSource).toBe('profile');
  });

  it('refuses a foreign-host /p/ or /reel/ anchor as the post permalink (turn 91)', () => {
    // `/p/` and `/reel/` are not Instagram-exclusive: facebook.com uses both.
    // An embedded cross-platform link must never become this Instagram
    // record's permalink — that sends a parent to another platform's post and
    // makes the record say something untrue about where the child was.
    const article = makeArticle(`
      <a href="https://www.facebook.com/p/Some-Page-100064/" role="link">Page</a>
      <a href="https://www.facebook.com/reel/1234567890" role="link">Reel</a>
      <a href="/p/CxYz123_Ab/" role="link">View</a>
      <a href="/janedoe/" role="link"><span>janedoe</span></a>
      <span dir="auto">Main caption text that is long enough to be extracted by the adapter.</span>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));
    const caption = posts.find(p => p.kind === 'post');
    expect(caption).toBeDefined();
    expect(caption!.sourceUrl).toBe('https://www.instagram.com/p/CxYz123_Ab/');
  });

  it('keeps an absolute instagram.com /p/ anchor', () => {
    const article = makeArticle(`
      <a href="https://www.instagram.com/p/CxYz123_Ab/" role="link">View</a>
      <a href="/janedoe/" role="link"><span>janedoe</span></a>
      <span dir="auto">Main caption text that is long enough to be extracted by the adapter.</span>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));
    const caption = posts.find(p => p.kind === 'post');
    expect(caption!.sourceUrl).toBe('https://www.instagram.com/p/CxYz123_Ab/');
  });

  it('comment record sourceUrl falls back to /p/<pid>/ when pid is a real shortcode (reported comment regression)', () => {
    // Prior behavior left IG comment-record sourceUrl unset. buildPostUrl
    // then built `instagram.com/p/ig-cmt-<pid>-<idx>/` — a 404. Fix sets
    // sourceUrl directly: prefer the /c/ permalink (modal layouts); fall
    // back to parent post URL when pid is a real shortcode; otherwise
    // location.href.
    const article = makeArticle(`
      <a href="/p/CxYz123_Ab/" role="link">View</a>
      <a href="/janedoe/" role="link"><span>janedoe</span></a>
      <span dir="auto">Main caption text that is long enough to be extracted by the adapter.</span>
      <ul>
        <li><span>Caption row placeholder ignored by walker</span></li>
        <li>
          <a href="/viewer1/"><span>viewer1</span></a>
          <span>First reaction comment that needs flagging</span>
        </li>
      </ul>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));
    const comment = posts.find(p => p.kind === 'top-comment');
    expect(comment).toBeDefined();
    expect(comment!.sourceUrl).toBe('https://www.instagram.com/p/CxYz123_Ab/');
    // No /c/ link in the li → anchorUrl undefined (sourceUrl fell back to the
    // parent post URL; the export must not mislabel that as the exact comment).
    expect(comment!.anchorUrl).toBeUndefined();
  });

  it('comment record sourceUrl prefers /c/ link when li exposes one (modal layout)', () => {
    const article = makeArticle(`
      <a href="/p/CxYz123_Ab/" role="link">View</a>
      <a href="/janedoe/" role="link"><span>janedoe</span></a>
      <span dir="auto">Main caption text that is long enough to be extracted by the adapter.</span>
      <ul>
        <li><span>Caption row placeholder ignored by walker</span></li>
        <li>
          <a href="/viewer1/"><span>viewer1</span></a>
          <span>First reaction comment that needs flagging</span>
          <a href="/p/CxYz123_Ab/c/17912345678901234/">8h</a>
        </li>
      </ul>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));
    const comment = posts.find(p => p.kind === 'top-comment');
    expect(comment).toBeDefined();
    expect(comment!.sourceUrl).toContain('/c/17912345678901234');
    // The li exposed its own /c/<id> permalink → anchorUrl is that comment
    // deep-link (same href used for sourceUrl).
    expect(comment!.anchorUrl).toContain('/c/17912345678901234');
  });

  it('comment record sourceUrl falls back to location.href when pid is synthetic (no /p/ in article)', () => {
    // Without a /p/ anchor, _extractPostId(article) returns null and the
    // caption push generates a UUID v4 → isRealIgPostId rejects it →
    // sourceUrl falls back to window.location.href.
    Object.defineProperty(window, 'location', {
      value: new URL('https://www.instagram.com/some-surface/'),
      writable: true,
      configurable: true,
    });
    const article = makeArticle(`
      <a href="/janedoe/" role="link"><span>janedoe</span></a>
      <span dir="auto">Main caption text that is long enough to be extracted by the adapter.</span>
      <ul>
        <li><span>Caption row placeholder ignored by walker</span></li>
        <li>
          <a href="/viewer1/"><span>viewer1</span></a>
          <span>First reaction comment that needs flagging</span>
        </li>
      </ul>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));
    const comment = posts.find(p => p.kind === 'top-comment');
    expect(comment).toBeDefined();
    expect(comment!.sourceUrl).toBe('https://www.instagram.com/some-surface/');
    // No /c/ link → anchorUrl undefined even though sourceUrl fell back to
    // location.href.
    expect(comment!.anchorUrl).toBeUndefined();
  });

  // ─── M29: expanded L2 replies emit as depth-2 records tied to their parent ─
  //
  // Pre-fix _walkCommentsContainer emitted every direct <li> as a depth-1
  // top-comment; a nested reply <ul> rendered under an L1 comment was dropped.
  // Chain-mirror: emit replies only when actually expanded/rendered.
  it('M29: an expanded reply <ul> under an L1 comment emits a depth-2 reply tied to its parent', () => {
    const article = makeArticle(`
      <a href="/p/CxYz123_Ab/" role="link">View</a>
      <a href="/janedoe/" role="link"><span>janedoe</span></a>
      <span dir="auto">Main caption text that is long enough to be extracted by the adapter.</span>
      <ul>
        <li><span>Caption row placeholder ignored by walker</span></li>
        <li>
          <a href="/viewer1/"><span>viewer1</span></a>
          <span>Top-level comment that the parent should see flagged in the chain record output</span>
          <ul>
            <li>
              <a href="/replier1/"><span>replier1</span></a>
              <span>A nested reply that was expanded</span>
            </li>
          </ul>
        </li>
      </ul>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));

    const top = posts.find(p => p.kind === 'top-comment');
    const reply = posts.find(p => p.kind === 'reply');
    expect(top).toBeDefined();
    expect(reply).toBeDefined();

    expect(top!.depth).toBe(1);
    expect(reply!.depth).toBe(2);
    expect(reply!.text).toContain('nested reply that was expanded');
    expect(reply!.author).toBe('@replier1');
    // Reply is tied to its parent L1 comment id.
    expect(reply!.parent_id).toBe(top!.id);
  });

  it('M29 (chain-mirror): a comment with NO nested reply <ul> emits only the depth-1 record', () => {
    const article = makeArticle(`
      <a href="/p/CxYz123_Ab/" role="link">View</a>
      <a href="/janedoe/" role="link"><span>janedoe</span></a>
      <span dir="auto">Main caption text that is long enough to be extracted by the adapter.</span>
      <ul>
        <li><span>Caption row placeholder ignored by walker</span></li>
        <li>
          <a href="/viewer1/"><span>viewer1</span></a>
          <span>A standalone top-level comment with no expanded replies under it</span>
        </li>
      </ul>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));

    expect(posts.filter(p => p.kind === 'reply')).toHaveLength(0);
    expect(posts.filter(p => p.kind === 'top-comment')).toHaveLength(1);
  });

  it('re-extracts only the newly-appended comment on a second pass (Bug C lazy-load)', () => {
    // Lazy-load regression cover. The comment-walker dedup gate uses
    // `dataset.fwCommentSeen` on each <li>, kept disjoint from the article-
    // level `dataset.fwProcessed` namespace so cross-talk can't silently
    // swallow lazy-loaded comments. First pass extracts the visible
    // comment + caption; second pass with a newly-appended <li> emits only
    // the new comment.
    const article = makeArticle(`
      <a href="/p/Cxyz1234ABC/" role="link">View</a>
      <a href="/janedoe/" role="link"><span>janedoe</span></a>
      <span dir="auto">Main caption text that is long enough to be extracted by the adapter.</span>
      <ul>
        <li><span>Caption row placeholder ignored by walker</span></li>
        <li>
          <a href="/viewer1/"><span>viewer1</span></a>
          <span>First reaction comment seen on initial extract</span>
        </li>
      </ul>
    `);
    document.body.appendChild(article);

    const first = adapter.extractPosts(toNodeList([article]));
    const firstComments = first.filter(p => p.kind === 'top-comment');
    expect(first.filter(p => p.kind === 'post')).toHaveLength(1);
    expect(firstComments).toHaveLength(1);
    expect(firstComments[0].text).toContain('First reaction comment');

    // Append a new comment <li> to the same <ul>. Mirrors IG lazy-loading
    // when the user scrolls within an open comment modal.
    const ul = article.querySelector('ul');
    expect(ul).not.toBeNull();
    const newLi = document.createElement('li');
    newLi.innerHTML = `
      <a href="/viewer2/"><span>viewer2</span></a>
      <span>Second reaction comment lazy-loaded after the first scan</span>
    `;
    ul!.appendChild(newLi);

    const second = adapter.extractPosts(toNodeList([article]));
    // Caption already fwCaptionEmitted on article → not re-emitted.
    expect(second.filter(p => p.kind === 'post')).toHaveLength(0);
    // Only the new comment surfaces; first comment stays gated by
    // `fwCommentSeen` on its own <li>.
    const newComments = second.filter(p => p.kind === 'top-comment');
    expect(newComments).toHaveLength(1);
    expect(newComments[0].text).toContain('lazy-loaded after the first scan');
  });
});
