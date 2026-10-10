// @vitest-environment jsdom
// InstagramAdapter — /p/ permalink rotation-alert suppression (post-2026-05-23)
//
// Cut out of instagram-adapter.test.ts on 2026-09-16 (PLAN-2026-09-16 item 11.3).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InstagramAdapter } from '../../../../src/content/platforms/instagram';
import { _resetRotationDiagnosticGuards } from '../../../../src/content/platforms/dom-master';
import { makeArticle, toNodeList, addAuthorLink, buildPermalinkRow } from './instagram-page-fixtures';

describe('InstagramAdapter — /p/ permalink rotation-alert suppression (post-2026-05-23)', () => {
  let adapter: InstagramAdapter;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    document.body.innerHTML = '';
    _resetRotationDiagnosticGuards();
    adapter = new InstagramAdapter();
    Object.defineProperty(window, 'location', {
      value: {
        hostname: 'www.instagram.com',
        pathname: '/p/CxYz123_Ab/',
        href: 'https://www.instagram.com/p/CxYz123_Ab/',
      },
      writable: true,
      configurable: true,
    });
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('article-path comment walker skipped on /p/ when <ul> has no direct <li> children (no rotation alert)', () => {
    // IG permalink chain regression: article.querySelector('ul')
    // grabs a non-comment <ul> on the new permalink layout (children are
    // <div> wrappers with rotated Meta atomic classes, not <li>),
    // triggering the dom-master rotation alert on every visit because
    // tier-1 (`:scope > li`) and shape-detector both correctly returned
    // zero. Comments live outside the article — _extractPermalinkSurface
    // handles them.
    const article = document.createElement('article');
    const viewLink = document.createElement('a');
    viewLink.href = '/p/CxYz123_Ab/';
    viewLink.setAttribute('role', 'link');
    viewLink.textContent = 'View';
    article.appendChild(viewLink);
    addAuthorLink(article, 'janedoe');
    const ul = document.createElement('ul');
    for (let i = 1; i <= 3; i++) {
      // Non-<li> children — matches the chain-evidence shape
      // (`ul/3children` with div._a9zj wrappers).
      const div = document.createElement('div');
      div.className = '_a9zj';
      const inner = document.createElement('span');
      inner.textContent = `Suggested follower row ${i}`;
      div.appendChild(inner);
      ul.appendChild(div);
    }
    article.appendChild(ul);
    const container = document.createElement('div');
    container.appendChild(article);
    document.body.appendChild(container);

    adapter.extractPosts(container.querySelectorAll('article'));

    const rotationCalls = warnSpy.mock.calls.filter((args: unknown[]) =>
      typeof args[0] === 'string' && args[0].includes('[FW dom-master:instagram]'),
    );
    expect(rotationCalls).toHaveLength(0);
  });

  it('article-path comment walker still runs on /p/ when <ul> has direct <li> children (legacy layout)', () => {
    // Regression cover for pre-rotation /p/ layouts that still expose
    // comments as `<ul><li>...</li></ul>` inside the article. The
    // conditional skip must let these through.
    const article = document.createElement('article');
    const viewLink = document.createElement('a');
    viewLink.href = '/p/CxYz123_Ab/';
    viewLink.setAttribute('role', 'link');
    viewLink.textContent = 'View';
    article.appendChild(viewLink);
    addAuthorLink(article, 'poster');
    const ul = document.createElement('ul');
    // Caption-placeholder li (skipped by walker)
    const captionLi = document.createElement('li');
    const captionSpan = document.createElement('span');
    captionSpan.textContent = 'Caption row placeholder ignored';
    captionLi.appendChild(captionSpan);
    ul.appendChild(captionLi);
    // Real comment li
    const commentLi = document.createElement('li');
    addAuthorLink(commentLi, 'commenter1');
    const bodySpan = document.createElement('span');
    bodySpan.textContent = 'A genuine comment that the walker should pick up.';
    commentLi.appendChild(bodySpan);
    ul.appendChild(commentLi);
    article.appendChild(ul);
    const container = document.createElement('div');
    container.appendChild(article);

    const posts = adapter.extractPosts(container.querySelectorAll('article'));

    // Article path successfully extracted the comment.
    const comments = posts.filter(p => p.kind === 'top-comment');
    expect(comments).toHaveLength(1);
    expect(comments[0].text).toContain('genuine comment');
  });

  it('home feed (non-/p/) still walks article comments normally', () => {
    // Regression cover: the /p/ skip must not affect home-feed extraction.
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.instagram.com', pathname: '/' },
      writable: true,
      configurable: true,
    });
    const article = makeArticle(`
      <a href="/p/CxYz123_Ab/" role="link">View</a>
      <a href="/janedoe/" role="link"><span>janedoe</span></a>
      <span dir="auto">Main caption text that is long enough to be extracted by the adapter properly.</span>
      <ul>
        <li><span>Caption row placeholder ignored by walker</span></li>
        <li>
          <a href="/viewer1/"><span>viewer1</span></a>
          <span>First reaction comment that needs flagging</span>
        </li>
      </ul>
    `);

    const posts = adapter.extractPosts(toNodeList([article]));

    expect(posts.filter(p => p.kind === 'post')).toHaveLength(1);
    expect(posts.filter(p => p.kind === 'top-comment')).toHaveLength(1);
  });
});

describe('InstagramAdapter — /p/ permalink body picker (post-2026-05-23 chain regression)', () => {
  let adapter: InstagramAdapter;

  beforeEach(() => {
    document.body.innerHTML = '';
    adapter = new InstagramAdapter();
    Object.defineProperty(window, 'location', {
      value: {
        hostname: 'www.instagram.com',
        pathname: '/p/SYNTHPOST04/',
        href: 'https://www.instagram.com/p/SYNTHPOST04/',
      },
      writable: true,
      configurable: true,
    });
  });

  it('body picker rejects leaf spans whose text equals the row author handle', () => {
    // Chain forensics found records on a public permalink with
    // originalText equal to the author handle exactly (synthetic examples)
    // raylang83 / etc.). New IG layout renders the username as a non-
    // <a>-wrapped leaf span alongside the clickable link; prior body
    // picker selected it as "longest qualifying leaf span" because
    // actual comment bodies are often non-leaf (contain inline @-mention
    // <a>, emoji <img>) and were filtered out by isLeafTextNode.
    const main = document.createElement('main');
    const captionH1 = document.createElement('h1');
    captionH1.textContent = 'Caption text that is long enough to be extracted as the post body on the permalink layout.';
    main.appendChild(captionH1);
    const commentList = document.createElement('div');
    main.appendChild(commentList);
    buildPermalinkRow(commentList, 'SYNTHPOST04', 'synthetic_commenter_a', true, 'Yes', '17900000000000001');
    buildPermalinkRow(commentList, 'SYNTHPOST04', 'synthetic_commenter_b', true, 'OK', '17900000000000002');
    document.body.appendChild(main);

    const posts = adapter.extractPosts(document.querySelectorAll('article'));

    const comments = posts.filter(p => p.kind === 'top-comment');
    expect(comments).toHaveLength(2);
    // Body picker selected "Yes" / "OK", NOT the author handles (15 / 8 chars long).
    expect(comments[0].text).toBe('Yes');
    expect(comments[0].author).toBe('synthetic_commenter_a');
    expect(comments[1].text).toBe('OK');
    expect(comments[1].author).toBe('synthetic_commenter_b');
  });

  it('permalink fallback id survives a lazy-load pass when the /c/ href has no numeric id', () => {
    // The /c/ href normally carries a numeric comment id; when it does not
    // (unseen to date), the fallback must NOT be the pass-relative
    // `out.length` — a row found on a later pass would restart the counter
    // at 0 and re-mint an earlier row's id, and id-level dedup would drop it
    // (the D3 collision class). The /c/ href path itself is the stable key.
    const main = document.createElement('main');
    const captionH1 = document.createElement('h1');
    captionH1.textContent = 'Caption text long enough for caption extraction on the permalink layout.';
    main.appendChild(captionH1);
    const commentList = document.createElement('div');
    main.appendChild(commentList);
    // Non-numeric /c/ ids → the numeric regex misses → fallback path. Two
    // rows so the walk-up finds an ancestor with more than one /c/ link.
    buildPermalinkRow(commentList, 'SYNTHPOST04', 'commenter_a', false,
      'First permalink comment body long enough to extract.', 'alpha');
    buildPermalinkRow(commentList, 'SYNTHPOST04', 'commenter_b', false,
      'Second permalink comment body long enough to extract.', 'beta');
    document.body.appendChild(main);

    const first = adapter.extractPosts(document.querySelectorAll('article'));
    const firstIds = first.filter(p => p.kind === 'top-comment').map(p => p.id);
    expect(firstIds).toHaveLength(2);
    expect(new Set(firstIds).size).toBe(2); // the two fallback ids are distinct

    // Lazy-load a third comment; the first two rows keep their fwCommentSeen
    // stamps. Pre-fix the fallback was `${postId}-${out.length}`, a
    // pass-relative counter — a later pass restarts it and re-mints an
    // earlier id whenever the non-comment record count matches. The fix keys
    // the fallback to the comment's own /c/ href, so its id encodes the href
    // ('gamma') and can never depend on scan position.
    buildPermalinkRow(commentList, 'SYNTHPOST04', 'commenter_c', false,
      'Third permalink comment lazy-loaded after the first scan.', 'gamma');

    const second = adapter.extractPosts(document.querySelectorAll('article'));
    const secondComments = second.filter(p => p.kind === 'top-comment');
    expect(secondComments).toHaveLength(1);
    expect(secondComments[0].text).toContain('lazy-loaded after the first scan');
    // href-derived, not position-derived: the id carries the /c/ slug and is
    // distinct from both first-pass ids. (Pre-fix this was `...-0`.)
    expect(secondComments[0].id).toContain('gamma');
    expect(firstIds).not.toContain(secondComments[0].id);
  });

  it('body picker still works when the username is not duplicated as a non-<a> span', () => {
    // Pre-rotation IG layout: username only inside <a> (filtered by
    // s.closest('a')). The new handle-skip filter must not regress
    // this case — body picker still selects the real body span.
    const main = document.createElement('main');
    const captionH1 = document.createElement('h1');
    captionH1.textContent = 'Caption text long enough for caption extraction on permalink.';
    main.appendChild(captionH1);
    const commentList = document.createElement('div');
    main.appendChild(commentList);
    buildPermalinkRow(
      commentList,
      'SYNTHPOST04',
      'synthetic_commenter_a',
      false,
      'This is the real comment body without any handle duplication outside the link.',
      '17912345678901234',
    );
    buildPermalinkRow(
      commentList,
      'SYNTHPOST04',
      'synthetic_commenter_b',
      false,
      'Another genuine comment text that the picker should select as the body.',
      '17912345678901235',
    );
    document.body.appendChild(main);

    const posts = adapter.extractPosts(document.querySelectorAll('article'));

    const comments = posts.filter(p => p.kind === 'top-comment');
    expect(comments).toHaveLength(2);
    expect(comments[0].text).toContain('real comment body');
    expect(comments[1].text).toContain('genuine comment text');
    // Permalink path: each row's /c/<id> timestamp link IS the comment's own
    // permalink, captured as anchorUrl (reuses the href already read for
    // sourceUrl). No new selector.
    expect(comments[0].anchorUrl).toContain('/c/17912345678901234');
    expect(comments[1].anchorUrl).toContain('/c/17912345678901235');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Lazy-load chain-ID collisions (mirrors the facebook.ts fwCommentNextIdx fix).
//
// Pre-fix, every IG comment walker reset its local index to 0 on each call
// while the per-row `fwCommentSeen` stamps persisted. A later extraction pass
// over the same container (lazy-loaded comments, remounted reel container,
// viewport re-entry un-stamping) skipped the stamped rows WITHOUT advancing
// the index, so new comments minted ids already used by earlier comments —
// downstream PostContent.id-level dedup then silently dropped or overwrote
// the earlier forensic record. These tests lock the corrected contract: a
// comment id, once minted under a container, is never re-minted for a
// DIFFERENT comment in a later pass.
// ─────────────────────────────────────────────────────────────────────────────
