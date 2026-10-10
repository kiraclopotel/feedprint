// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { FacebookAdapter, isFacebookCommentLabel } from '../../../src/content/platforms/facebook';
import { buildPostUrl } from '../../../src/content/record/post-url';

function makeArticle(innerHTML: string): HTMLElement {
  const article = document.createElement('div');
  article.setAttribute('role', 'article');
  article.innerHTML = innerHTML;
  return article;
}

function toNodeList(elements: HTMLElement[]): NodeList {
  const container = document.createElement('div');
  for (const el of elements) {
    container.appendChild(el);
  }
  return container.querySelectorAll('div[role="article"]');
}

describe('FacebookAdapter', () => {
  let adapter: FacebookAdapter;

  beforeEach(() => {
    adapter = new FacebookAdapter();
    // Default location to facebook.com home
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.facebook.com', pathname: '/' },
      writable: true,
      configurable: true,
    });
  });

  it('extracts text from ad preview div', () => {
    const article = makeArticle(`
      <div data-ad-preview="message">This is a sponsored ad post with enough text to pass the minimum length filter.</div>
      <div dir="auto">Some other text that should not be picked because ad preview takes priority.</div>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));

    expect(posts).toHaveLength(1);
    expect(posts[0].text).toContain('sponsored ad post');
  });

  it('extracts text from dir="auto" when no ad preview', () => {
    const article = makeArticle(`
      <a role="link" href="/johndoe"><strong>John Doe</strong></a>
      <div dir="auto">This is a regular Facebook post that has enough text to be extracted by the adapter.</div>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));

    expect(posts).toHaveLength(1);
    expect(posts[0].text).toContain('regular Facebook post');
  });

  it('skips text elements inside UL (comments)', () => {
    const article = makeArticle(`
      <div dir="auto">Main post text that should be extracted because it is the actual post content here.</div>
      <ul>
        <div dir="auto">This is a comment text that is even longer than the main post content and should be skipped entirely by the adapter.</div>
      </ul>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));

    expect(posts).toHaveLength(1);
    expect(posts[0].text).toContain('Main post text');
    expect(posts[0].text).not.toContain('comment text');
  });

  it('skips text inside nested articles (shared posts)', () => {
    const article = makeArticle(`
      <div dir="auto">Outer post text with enough characters to meet the minimum length requirement.</div>
      <div role="article">
        <div dir="auto">Shared post text inside a nested article that should be completely ignored by the adapter extraction logic.</div>
      </div>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));

    // Should extract the outer post only (the nested article is collected separately but its text is the nested one)
    const outerPost = posts.find(p => p.text.includes('Outer post text'));
    expect(outerPost).toBeDefined();
  });

  it('skips Messenger chat-log articles (private-DM leak fix)', () => {
    // Each Messenger chat-message bubble on facebook.com is a
    // <div role="article" aria-label=""> nested inside a
    // <div role="log" aria-label="Messages in conversation with …">.
    // Without the chat-log gate in _collectArticles, message bubbles
    // flow through the legacy [role="article"] branch (they have no
    // [aria-posinset] ancestor) and get extracted as feed posts,
    // leaking private DMs into the forensic chain.
    const log = document.createElement('div');
    log.setAttribute('role', 'log');
    log.setAttribute('aria-label', 'Messages in conversation with Example Contact');
    const chatArticle = document.createElement('div');
    chatArticle.setAttribute('role', 'article');
    const inner = document.createElement('div');
    inner.setAttribute('dir', 'auto');
    inner.textContent =
      'This is a synthetic private conversation that must not be extracted.';
    chatArticle.appendChild(inner);
    log.appendChild(chatArticle);
    document.body.appendChild(log);
    try {
      const nodes = document.querySelectorAll('div[role="article"]');
      const posts = adapter.extractPosts(nodes);
      expect(posts).toHaveLength(0);
    } finally {
      document.body.removeChild(log);
    }
  });

  it('extracts author from strong tag inside link', () => {
    const article = makeArticle(`
      <a role="link" href="/janedoe"><strong>Jane Doe</strong></a>
      <div dir="auto">A post with enough text to be extracted as valid content by the adapter logic.</div>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));

    expect(posts).toHaveLength(1);
    expect(posts[0].author).toBe('Jane Doe');
  });

  it('group feed post: author is the human poster, not the group name', () => {
    // Live DOM (2026-06-23, "Example Hobby Group" home-feed group post):
    // [data-ad-rendering-role="profile_name"] holds the GROUP name, and the
    // human poster ("Robin Sample") appears only in the "/groups/<g>/user/<u>/"
    // link (first such link is the avatar — no text; second carries the name).
    // Before the fix the group name was stored as the author -> dashboard
    // printed "@Example Hobby Group" as if the group were a user.
    const article = makeArticle(`
      <div data-ad-rendering-role="profile_name">
        <a role="link" href="/groups/1190000000000000/">Example Hobby Group</a>
      </div>
      <a role="link" href="/groups/1190000000000000/user/1000000001/"><img alt=""></a>
      <a role="link" href="/groups/1190000000000000/user/1000000001/">Robin Sample</a>
      <div dir="auto">A group post with enough text to be extracted as valid content by the adapter.</div>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));

    expect(posts).toHaveLength(1);
    expect(posts[0].author).toBe('Robin Sample');
    expect(posts[0].author).not.toBe('Example Hobby Group');
    // Source label: the group name is lifted onto sourceContainer (the GROUP is
    // the container the post lived in), driving accountType:'group' downstream.
    expect(posts[0].sourceContainer).toBe('Example Hobby Group');
  });

  it('non-group page post: profile_name still wins (no regression)', () => {
    // Page posts have no "/user/" link, so Strategy 0 is skipped and the
    // page name remains the author (correct — the Page IS the poster).
    const article = makeArticle(`
      <div data-ad-rendering-role="profile_name">
        <a role="link" href="/samplecasino.test">Sample Casino \u00b7 Follow</a>
      </div>
      <div dir="auto">A page post with enough text to be extracted as valid content by the adapter.</div>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));

    expect(posts).toHaveLength(1);
    expect(posts[0].author).toBe('Sample Casino');
    // No /user/ link → not a group post → no source container leaks in.
    expect(posts[0].sourceContainer).toBeUndefined();
  });

  it('extracts post ID from /posts/ URL into parentVideoId', () => {
    const article = makeArticle(`
      <a href="/someuser/posts/abc123def">View Post</a>
      <div dir="auto">Post content that is long enough to be extracted by the adapter properly.</div>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));

    expect(posts).toHaveLength(1);
    // 2026-04-25 split — record id is prefixed; the underlying post id lives
    // on parentVideoId (used to group records across the article).
    expect(posts[0].parentVideoId).toBe('abc123def');
    expect(posts[0].id).toBe('fb-post-abc123def');
  });

  it('extracts post ID from story_fbid parameter into parentVideoId', () => {
    const article = makeArticle(`
      <a href="/permalink.php?story_fbid=9876543210&id=12345">View</a>
      <div dir="auto">Another post with content that satisfies the minimum length requirement for extraction.</div>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));

    expect(posts).toHaveLength(1);
    expect(posts[0].parentVideoId).toBe('9876543210');
  });

  it('skips already-processed articles', () => {
    const article = makeArticle(`
      <div dir="auto">This post has enough text but should be skipped because it is already processed.</div>
    `);
    article.dataset.fwProcessed = 'true';
    const posts = adapter.extractPosts(toNodeList([article]));

    expect(posts).toHaveLength(0);
  });

  // ─── M3: page-URL fallback for the home-feed UUID-id case ───────────────
  //
  // Modern home-feed posts expose no in-article post anchor (the timestamp
  // href stays '#' / '/'), so _extractPostId(article) returned null and the
  // record id fell to a fresh crypto.randomUUID() each tick. When FW landed
  // on a single-post permalink the id lives in location.pathname; derive it
  // so the chain id is stable across re-entry instead of a random UUID.
  const UUID_RE = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i;

  it('M3: post with no in-article anchor on a /share/p/<id> URL gets a deterministic id (not a UUID)', () => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.facebook.com', pathname: '/share/p/19abcXYZ_7/', search: '' },
      writable: true,
      configurable: true,
    });
    const article = makeArticle(`
      <a role="link" href="#"><strong>Some Poster</strong></a>
      <div dir="auto">A modern home-feed post with no static post anchor in its DOM at all.</div>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));

    expect(posts).toHaveLength(1);
    expect(posts[0].parentVideoId).toBe('19abcXYZ_7');
    expect(posts[0].id).toBe('fb-post-19abcXYZ_7');
    expect(posts[0].parentVideoId ?? '').not.toMatch(UUID_RE);
  });

  it('M3: post with no in-article anchor on a /groups/<g>/posts/<id> URL gets the post id from the path', () => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.facebook.com', pathname: '/groups/12345/posts/67890/', search: '' },
      writable: true,
      configurable: true,
    });
    const article = makeArticle(`
      <a role="link" href="/"><strong>Group Member</strong></a>
      <div dir="auto">A group post body with no static post anchor inside the article element.</div>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));

    expect(posts).toHaveLength(1);
    // Group POST id (67890), not the group id (12345).
    expect(posts[0].parentVideoId).toBe('67890');
    expect(posts[0].parentVideoId ?? '').not.toMatch(UUID_RE);
  });

  it('M3: an in-article /share/p/<id> anchor is read directly (no page-URL needed)', () => {
    const article = makeArticle(`
      <a href="/share/p/0Pq8rStuv/">View Post</a>
      <div dir="auto">A post whose share permalink is present as an in-article anchor element.</div>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));

    expect(posts).toHaveLength(1);
    expect(posts[0].parentVideoId).toBe('0Pq8rStuv');
  });

  it('M3 (over-flag safety): a bare home-feed URL with no anchor still falls to a UUID (no cross-post collision)', () => {
    // The page-URL fallback must NEVER mint a deterministic id from a bare
    // feed path — that would collide every post on the page into one chain id.
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.facebook.com', pathname: '/', search: '' },
      writable: true,
      configurable: true,
    });
    const article = makeArticle(`
      <a role="link" href="#"><strong>Feed Poster</strong></a>
      <div dir="auto">A plain home-feed post with no anchor and a bare slash page path here.</div>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));

    expect(posts).toHaveLength(1);
    expect(posts[0].parentVideoId ?? '').toMatch(UUID_RE);
  });

  it('skips text shorter than 20 characters', () => {
    const article = makeArticle(`
      <div dir="auto">Too short</div>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));

    expect(posts).toHaveLength(0);
  });

  it('returns feedSource based on URL path', () => {
    // Groups => following
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.facebook.com', pathname: '/groups/mygroup' },
      writable: true,
      configurable: true,
    });

    const article1 = makeArticle(`
      <div dir="auto">Group post text that is long enough to be extracted by the adapter properly.</div>
    `);
    let posts = adapter.extractPosts(toNodeList([article1]));
    expect(posts[0].feedSource).toBe('following');

    // Watch => for-you
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.facebook.com', pathname: '/watch' },
      writable: true,
      configurable: true,
    });

    const article2 = makeArticle(`
      <div dir="auto">Watch post text that is long enough to be extracted by the adapter properly.</div>
    `);
    posts = adapter.extractPosts(toNodeList([article2]));
    expect(posts[0].feedSource).toBe('for-you');

    // 2026-04-25 (FACEBOOK_CRITERIA F5-1, post-DEC-015): home feed is the
    // algorithmic News Feed, semantically `for-you`. Pre-pivot tag was
    // `unknown` as a conservative call when V1 didn't ship Facebook; with
    // V1=Family Facebook is a primary surface and home dominates parent
    // usage, so the accurate tag matters for analytics + calibration.
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.facebook.com', pathname: '/' },
      writable: true,
      configurable: true,
    });

    const article3 = makeArticle(`
      <div dir="auto">Home feed post text that is long enough to be extracted by the adapter properly.</div>
    `);
    posts = adapter.extractPosts(toNodeList([article3]));
    expect(posts[0].feedSource).toBe('for-you');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// §CT-26a — comment-stem regression lock
// (per .brain/COMMENT_BURST_MEASUREMENT_FB_2026-05-04.md §2.1 BUG #1)
// ─────────────────────────────────────────────────────────────────────────
//
// A live MCP capture on a RO-locale FB permalink showed reply articles
// use aria-label="Răspuns de la X" (NOT "Comentariu adăugat de X" like top-
// level comments). Pre-§CT-26a, facebook.ts COMMENT_LABEL_STEMS had no
// reply stem → all RO replies were silently skipped → zero chain records.
// These tests pin the fix in place.

describe('§CT-26a — FB _extractComments stem coverage', () => {
  let adapter: FacebookAdapter;

  beforeEach(() => {
    adapter = new FacebookAdapter();
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.facebook.com', pathname: '/somepath/posts/abc123' },
      writable: true,
      configurable: true,
    });
  });

  // Helper: build an article with a /posts/<id> link + body + nested comment articles.
  // Each comment gets UNIQUE body text per index so the seen-set dedup at
  // facebook.ts:212-213 doesn't collapse the test comments into one.
  function makePostWithComments(commentLabels: string[]): HTMLElement {
    const article = document.createElement('div');
    article.setAttribute('role', 'article');
    article.innerHTML = `
      <a href="/u/posts/postId001">post</a>
      <div dir="auto">Main post body that is long enough to extract per the 20-char floor.</div>
    `;
    commentLabels.forEach((label, i) => {
      const cmt = document.createElement('div');
      cmt.setAttribute('role', 'article');
      cmt.setAttribute('aria-label', label);
      cmt.innerHTML = `
        <a role="link" href="/cu${i}"><span>Commenter ${i}</span></a>
        <div dir="auto">Unique comment body number ${i} long enough to clear the 5-char floor.</div>
      `;
      article.appendChild(cmt);
    });
    return article;
  }

  it('extracts a top-level RO comment (existing behavior, regression lock)', () => {
    const article = makePostWithComments(['Comentariu adăugat de Maria Popescu']);
    const posts = adapter.extractPosts(toNodeList([article]));
    const comments = posts.filter(p => p.kind === 'top-comment');
    expect(comments).toHaveLength(1);
  });

  it('extracts a RO reply via "Răspuns de la X" stem (§CT-26a fix)', () => {
    const article = makePostWithComments(['Răspuns de la Maria Popescu']);
    const posts = adapter.extractPosts(toNodeList([article]));
    const comments = posts.filter(p => p.kind === 'top-comment');
    // Pre-§CT-26a: 0 — silently skipped because no stem matched.
    // Post-§CT-26a: 1 — extracted same as a top-level comment.
    expect(comments).toHaveLength(1);
  });

  // The English reply labels the engagement layer's LIVE diagnostic recorded
  // ('Reply by X', 'Reply from X') matched no stem in this list, which carried
  // only two forms its own comment marked '(presumed)'. Every English reply was
  // dropped here or misfiled as a top-level post — on a locale that is the
  // majority of weekly users. The RO string that IS verified, "Răspuns de la
  // X", is literally "Reply from X".
  it.each([
    'Reply by Jane Doe',
    'Reply from Jane Doe',
    'Reply to Jane Doe',
    'Jane Doe replied to comment by John Smith',
  ])('extracts an EN reply labelled "%s"', (label) => {
    const article = makePostWithComments([label]);
    const posts = adapter.extractPosts(toNodeList([article]));
    expect(posts.filter(p => p.kind === 'top-comment')).toHaveLength(1);
    // and never as a top-level post of its own, which is what an unmatched
    // label produced instead of a drop.
    expect(posts.filter(p => p.kind === 'post')).toHaveLength(1);
  });

  // Facebook renders Romanian with and without diacritics.
  it('extracts a RO reply written without diacritics', () => {
    const article = makePostWithComments(['Raspuns de la Maria Popescu']);
    const posts = adapter.extractPosts(toNodeList([article]));
    expect(posts.filter(p => p.kind === 'top-comment')).toHaveLength(1);
  });

  // The two predicates in facebook.ts read ONE list now. They had diverged on
  // which English reply forms they carried, so the same aria-label was a
  // comment to the extractor and a post to isFacebookCommentLabel.
  it.each([
    'Comentariu adăugat de Maria',
    'Răspuns de la Maria',
    'Raspuns de la Maria',
    'Reply by Jane Doe',
    'Reply from Jane Doe',
    'Reply to Jane Doe',
    'Jane Doe replied to comment by John Smith',
    '(Jane Doe) replied to comment by John Smith',
  ])('isFacebookCommentLabel agrees the extractor on "%s"', (label) => {
    expect(isFacebookCommentLabel(label)).toBe(true);
    const posts = adapter.extractPosts(toNodeList([makePostWithComments([label])]));
    expect(posts.filter(p => p.kind === 'top-comment')).toHaveLength(1);
  });

  it.each(['Pinned post by John', 'See translation', 'Photo by Jane'])(
    'isFacebookCommentLabel still says no to "%s"', (label) => {
      expect(isFacebookCommentLabel(label)).toBe(false);
    });

  it('extracts BOTH top-level + reply siblings under one post', () => {
    const article = makePostWithComments([
      'Comentariu adăugat de Maria',
      'Comentariu adăugat de Bob',
      'Răspuns de la Carol',
      'Răspuns de la Dan',
    ]);
    const posts = adapter.extractPosts(toNodeList([article]));
    const comments = posts.filter(p => p.kind === 'top-comment');
    expect(comments).toHaveLength(4);
  });

  it('extracts EN replies via "Reply to" / "replied to" stems', () => {
    const article = makePostWithComments([
      'Comment by Alice',
      'Reply to Alice',
      'Bob replied to comment by Alice',
    ]);
    const posts = adapter.extractPosts(toNodeList([article]));
    const comments = posts.filter(p => p.kind === 'top-comment');
    expect(comments).toHaveLength(3);
  });

  it('still skips articles whose label matches no stem (e.g. UI chrome)', () => {
    const article = makePostWithComments([
      'Photo viewer',
      'Reaction summary',
      'Some other unrelated label',
    ]);
    const posts = adapter.extractPosts(toNodeList([article]));
    const comments = posts.filter(p => p.kind === 'top-comment');
    expect(comments).toHaveLength(0);
  });

  it('extracts comment regardless of aria-label CASING (case-insensitive stem match)', () => {
    const article = makePostWithComments([
      'COMENTARIU ADĂUGAT DE Maria',
      'RĂSPUNS DE LA Bob',
    ]);
    const posts = adapter.extractPosts(toNodeList([article]));
    const comments = posts.filter(p => p.kind === 'top-comment');
    expect(comments).toHaveLength(2);
  });
});

describe('§CT-30 — FB lazy-loaded comment pickup (extractPosts re-entry)', () => {
  let adapter: FacebookAdapter;

  beforeEach(() => {
    adapter = new FacebookAdapter();
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.facebook.com', pathname: '/ExamplePerson/posts/abc123' },
      writable: true,
      configurable: true,
    });
  });

  function makePostWithComments(commentLabels: string[]): HTMLElement {
    const article = document.createElement('div');
    article.setAttribute('role', 'article');
    article.innerHTML = `
      <a href="/u/posts/postId001">post</a>
      <div dir="auto">Main post body that is long enough to extract per the 20-char floor.</div>
    `;
    commentLabels.forEach((label, i) => {
      const cmt = document.createElement('div');
      cmt.setAttribute('role', 'article');
      cmt.setAttribute('aria-label', label);
      cmt.innerHTML = `
        <a role="link" href="/cu${i}"><span>Commenter ${i}</span></a>
        <div dir="auto">Unique comment body number ${i} long enough to clear the 5-char floor.</div>
      `;
      article.appendChild(cmt);
    });
    return article;
  }

  function appendCommentsToArticle(article: HTMLElement, commentLabels: string[], offset: number): void {
    commentLabels.forEach((label, i) => {
      const cmt = document.createElement('div');
      cmt.setAttribute('role', 'article');
      cmt.setAttribute('aria-label', label);
      cmt.innerHTML = `
        <a role="link" href="/cu${offset + i}"><span>Commenter ${offset + i}</span></a>
        <div dir="auto">Unique comment body number ${offset + i} long enough to clear the 5-char floor.</div>
      `;
      article.appendChild(cmt);
    });
  }

  it('first entry pushes 1 post + N comments; second entry with same DOM pushes 0 (per-element dedup)', () => {
    const article = makePostWithComments(['Comentariu adăugat de Maria', 'Comentariu adăugat de Bob']);

    const firstRun = adapter.extractPosts(toNodeList([article]));
    expect(firstRun.filter(p => p.kind === 'post')).toHaveLength(1);
    expect(firstRun.filter(p => p.kind === 'top-comment')).toHaveLength(2);

    // Mutation observer fires again on the same DOM (no new comments yet).
    const secondRun = adapter.extractPosts(toNodeList([article]));
    // No post push (already fwProcessed). No comment push (all fwCommentSeen).
    expect(secondRun).toHaveLength(0);
  });

  it('second entry with NEW comments pushes only the delta (chain IDs do not collide with first run)', () => {
    const article = makePostWithComments(['Comentariu adăugat de Maria', 'Comentariu adăugat de Bob']);

    const firstRun = adapter.extractPosts(toNodeList([article]));
    const firstCommentIds = firstRun.filter(p => p.kind === 'top-comment').map(p => p.id);
    expect(firstCommentIds).toHaveLength(2);

    // Lazy-load: 3 new comments arrive in the same article (FB scroll behavior).
    appendCommentsToArticle(article, [
      'Răspuns de la Carol',
      'Comentariu adăugat de Dan',
      'Comentariu adăugat de Eve',
    ], 2);

    const secondRun = adapter.extractPosts(toNodeList([article]));
    const secondCommentIds = secondRun.filter(p => p.kind === 'top-comment').map(p => p.id);
    expect(secondRun.filter(p => p.kind === 'post')).toHaveLength(0); // no re-push of post body
    expect(secondCommentIds).toHaveLength(3); // only the NEW 3

    // Critical: chain ID space stays unique across calls. Pre-§CT-30 cmtIdx
    // reset to 0 each call → second-run "fb-cmt-{postId}-c0" would collide
    // with first-run "fb-cmt-{postId}-c0" in the forensic chain.
    const allIds = new Set([...firstCommentIds, ...secondCommentIds]);
    expect(allIds.size).toBe(5); // 2 + 3, no collisions
  });

  it('post.author + post.id stay stable across re-entries (parentVideoId cohesion)', () => {
    const article = makePostWithComments(['Comentariu adăugat de Maria']);
    const firstRun = adapter.extractPosts(toNodeList([article]));
    const firstPost = firstRun.find(p => p.kind === 'post');
    const firstComment = firstRun.find(p => p.kind === 'top-comment');
    expect(firstPost).toBeDefined();
    expect(firstComment).toBeDefined();

    appendCommentsToArticle(article, ['Comentariu adăugat de Bob'], 1);
    const secondRun = adapter.extractPosts(toNodeList([article]));
    const secondComment = secondRun.find(p => p.kind === 'top-comment');
    expect(secondComment).toBeDefined();

    // Both comments must point to the same parent post via parentVideoId.
    expect(firstComment!.parentVideoId).toBe(secondComment!.parentVideoId);
    expect(secondComment!.parentVideoId).toBe(firstPost!.parentVideoId);
  });

  // §CT-26h.FB-cap — caption-level engagement metrics. Fixture updated to the
  // current FB engagement-row structure (verified live 2026-06-15): separate
  // leaf spans — a "Toate reacţiile:" label + the numeric reaction total, then
  // "N comentarii" / "N distribuiri" — NOT the old combined-text span. FB
  // dropped the reaction count from the toolbar aria-label and now glues the
  // reaction + comment numbers in the row's combined textContent, so the
  // extractor reads the individual leaves. The "1.234" total also exercises RO
  // thousands-grouping parsing (→ 1234).
  it('populates caption-level postReactions/postCommentsCount/postShares from FB engagement row', () => {
    const article = makeArticle(`
      <a role="link" href="/page1"><strong>Some Page</strong></a>
      <div dir="auto">A regular Facebook post body that has enough text to be extracted by the adapter.</div>
      <div>
        <div role="button" aria-label="See who reacted to this"></div>
        <div>Toate reacţiile:</div><span>1.234</span><span>1.234</span>
        <span>271 comentarii</span><span>8 distribuiri</span>
      </div>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));
    const caption = posts.find(p => p.kind === 'post');
    expect(caption).toBeDefined();
    const ps = caption!.platform_specific;
    expect(ps?.platform).toBe('facebook');
    if (ps?.platform === 'facebook') {
      expect(ps.postReactions).toBe(1234);
      expect(ps.postCommentsCount).toBe(271);
      expect(ps.postShares).toBe(8);
    }
  });

  it('leaves caption metrics undefined (not 0) when engagement row is absent', () => {
    const article = makeArticle(`
      <a role="link" href="/page2"><strong>Other Page</strong></a>
      <div dir="auto">A bare Facebook post with no engagement row at all in this DOM snippet.</div>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));
    const caption = posts.find(p => p.kind === 'post');
    expect(caption).toBeDefined();
    const ps = caption!.platform_specific;
    expect(ps?.platform).toBe('facebook');
    if (ps?.platform === 'facebook') {
      expect(ps.postReactions).toBeUndefined();
      expect(ps.postCommentsCount).toBeUndefined();
      expect(ps.postShares).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// M36 — postUrl captured SYNCHRONOUSLY at mount (no log-time homepage race)
// ─────────────────────────────────────────────────────────────────────────
//
// The 2026-06-26 chain export had 148/438 (34%) of FB post/video records with
// postUrl = the bare facebook.com homepage. Root cause: `_extractPostUrl`
// returned '' at mount for modern posts (timestamp permalink is a hover-only
// '#'), so the record carried no sourceUrl; then at LOG time (async, after the
// SPA navigated back to the feed root) `buildPostUrl` fell back to
// `location.href` = the homepage. Fix: capture a real URL at mount (in-article
// permalink anchor → derived `<actor>/posts/<id>` permalink → mount-time
// surface URL) so `buildPostUrl`'s `if (post.sourceUrl) return post.sourceUrl`
// short-circuit always fires and the stale log-time read never happens.
describe('M36 — FB postUrl captured at mount', () => {
  let adapter: FacebookAdapter;

  function setLocation(pathname: string, search: string, href: string): void {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.facebook.com', pathname, search, href },
      writable: true,
      configurable: true,
    });
  }

  beforeEach(() => {
    adapter = new FacebookAdapter();
    setLocation('/', '', 'https://www.facebook.com/');
  });

  it('captures an in-article /posts/ anchor as sourceUrl (regression lock)', () => {
    const article = makeArticle(`
      <a href="/someuser/posts/abc123def">2h</a>
      <div dir="auto">A post whose permalink anchor is present in the article DOM here.</div>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));
    expect(posts[0].sourceUrl).toBe('https://www.facebook.com/someuser/posts/abc123def');
  });

  it('home-feed post with no permalink anchor captures the surface URL at mount (never empty)', () => {
    const article = makeArticle(`
      <a role="link" href="#"><strong>Feed Poster</strong></a>
      <div dir="auto">A plain home-feed post with no permalink anchor in its DOM at all.</div>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));
    // Before M36: '' → buildPostUrl re-read location.href at LOG time.
    expect(posts[0].sourceUrl).toBe('https://www.facebook.com/');
    expect(posts[0].sourceUrl).not.toBe('');
  });

  it('derives a clean canonical permalink from author slug + path id when the timestamp href is "#"', () => {
    setLocation(
      '/ExamplePerson/posts/abc123',
      '?comment_id=999',
      'https://www.facebook.com/ExamplePerson/posts/abc123?comment_id=999&__cft__=junk',
    );
    const article = makeArticle(`
      <a role="link" href="/ExamplePerson"><strong>Example Person</strong></a>
      <a role="link" href="#">2h</a>
      <div dir="auto">A permalink-page post body with only the author anchor present here.</div>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));
    // Canonical post URL, not the comment-deep-linked / tracking-laden href.
    expect(posts[0].sourceUrl).toBe('https://www.facebook.com/ExamplePerson/posts/abc123/');
  });

  it('derives a /groups/<gid>/posts/<id> permalink for a group post with no in-article post anchor', () => {
    setLocation(
      '/groups/12345/posts/67890',
      '',
      'https://www.facebook.com/groups/12345/posts/67890',
    );
    const article = makeArticle(`
      <div data-ad-rendering-role="profile_name"><a role="link" href="/groups/12345/">My Group</a></div>
      <a role="link" href="/groups/12345/user/777/"><img alt=""></a>
      <a role="link" href="/groups/12345/user/777/">Group Poster</a>
      <a role="link" href="#">3h</a>
      <div dir="auto">A group post body with only the group + user anchors present in DOM.</div>
    `);
    const posts = adapter.extractPosts(toNodeList([article]));
    expect(posts[0].sourceUrl).toBe('https://www.facebook.com/groups/12345/posts/67890/');
  });

  it('comment records inherit the post sourceUrl captured at mount', () => {
    const article = document.createElement('div');
    article.setAttribute('role', 'article');
    article.innerHTML = `
      <a href="/someuser/posts/abc123def">2h</a>
      <div dir="auto">A post with a permalink anchor and one nested comment article below.</div>
    `;
    const cmt = document.createElement('div');
    cmt.setAttribute('role', 'article');
    cmt.setAttribute('aria-label', 'Comment by Alice');
    cmt.innerHTML = `
      <a role="link" href="/alice"><span>Alice</span></a>
      <div dir="auto">A nested comment body long enough to clear the 5-char floor here.</div>
    `;
    article.appendChild(cmt);
    const container = document.createElement('div');
    container.appendChild(article);
    const posts = adapter.extractPosts(container.querySelectorAll('div[role="article"]'));
    const comment = posts.find(p => p.kind === 'top-comment');
    expect(comment).toBeDefined();
    expect(comment!.sourceUrl).toBe('https://www.facebook.com/someuser/posts/abc123def');
  });

  it('buildPostUrl uses the mount-captured sourceUrl even after the SPA navigates away (the race)', () => {
    setLocation('/u/posts/abc123', '', 'https://www.facebook.com/u/posts/abc123');
    const article = makeArticle(`
      <a href="/u/posts/abc123">2h</a>
      <div dir="auto">A post extracted while FW was on its permalink page surface here.</div>
    `);
    const [post] = adapter.extractPosts(toNodeList([article]));

    // SPA navigates back to the feed root before the async log fires.
    setLocation('/', '', 'https://www.facebook.com/');

    expect(buildPostUrl(post)).toBe('https://www.facebook.com/u/posts/abc123');
    expect(buildPostUrl(post)).not.toBe('https://www.facebook.com/');
  });
});

// Q58 (live-attested 2026-08-11): FB comment rows render their timestamp as
// an anchor carrying ?comment_id=<id> plus click-tracking params. The adapter
// wires it to PostContent.anchorUrl with tracking stripped, comment_id kept.
describe('Q58 — FB comment anchorUrl from the timestamp anchor', () => {
  let adapter: FacebookAdapter;

  beforeEach(() => {
    adapter = new FacebookAdapter();
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.facebook.com', pathname: '/somepath/posts/abc123', origin: 'https://www.facebook.com', href: 'https://www.facebook.com/somepath/posts/abc123' },
      writable: true,
      configurable: true,
    });
  });

  function makePostWithAnchoredComment(anchorHref: string | null): HTMLElement {
    const article = document.createElement('div');
    article.setAttribute('role', 'article');
    article.innerHTML = `
      <a href="/u/posts/postId001">post</a>
      <div dir="auto">Main post body that is long enough to extract per the 20-char floor.</div>
    `;
    const cmt = document.createElement('div');
    cmt.setAttribute('role', 'article');
    cmt.setAttribute('aria-label', 'Comentariu adăugat de Maria Popescu');
    cmt.innerHTML = `
      <a role="link" href="/cu0"><span>Commenter 0</span></a>
      ${anchorHref ? `<a href="${anchorHref}">1h</a>` : ''}
      <div dir="auto">Unique anchored comment body long enough to clear the floor.</div>
    `;
    article.appendChild(cmt);
    return article;
  }

  it('keeps origin + path + comment_id, strips the tracking params', () => {
    const article = makePostWithAnchoredComment(
      'https://www.facebook.com/groups/g1/posts/p1/?comment_id=C42&__cft__[0]=track&__tn__=R',
    );
    const posts = adapter.extractPosts(toNodeList([article]));
    const comment = posts.find(p => p.kind === 'top-comment');
    expect(comment?.anchorUrl).toBe('https://www.facebook.com/groups/g1/posts/p1/?comment_id=C42');
  });

  it('no comment_id anchor in the row leaves anchorUrl undefined (pre-Q58 behavior)', () => {
    const article = makePostWithAnchoredComment(null);
    const posts = adapter.extractPosts(toNodeList([article]));
    const comment = posts.find(p => p.kind === 'top-comment');
    expect(comment).toBeTruthy();
    expect(comment?.anchorUrl).toBeUndefined();
  });
});

// The label-drop split. `fbCommentDroppedLabel` counts every
// [role="article"][aria-label] the stem list rejects, and that single number
// answers two opposite questions at once: a shared post or ad wrapper rejected
// CORRECTLY, and a real comment in an unlisted language rejected because
// FeelingWise cannot read its label. A 2026-08-20 capture read 346
// candidates / 100 extracted / 246 dropped here, and nothing on disk could say
// which of those two it was. `fbCommentDroppedLabelWithText` splits them by
// the one clue that is free and carries no personal data: whether the rejected
// element has a comment-shaped body. The aria-label text itself is NOT
// recorded — it holds the commenter's name.
describe('facebook comment label-drop attribution', () => {
  let adapter: FacebookAdapter;

  beforeEach(async () => {
    const { _resetDiagnosticsForTesting } = await import('../../../src/diagnostics/diagnostics');
    _resetDiagnosticsForTesting();
    adapter = new FacebookAdapter();
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.facebook.com', pathname: '/SomePage/posts/xyz789' },
      writable: true,
      configurable: true,
    });
  });

  function articleWith(children: Array<{ label: string; body: string | null }>): HTMLElement {
    const article = document.createElement('div');
    article.setAttribute('role', 'article');
    article.innerHTML = `
      <a href="/u/posts/postId777">post</a>
      <div dir="auto">Main post body that is long enough to extract per the 20-char floor.</div>
    `;
    children.forEach((c, i) => {
      const el = document.createElement('div');
      el.setAttribute('role', 'article');
      el.setAttribute('aria-label', c.label);
      el.innerHTML = c.body === null
        ? `<a role="link" href="/cu${i}"><span>Someone ${i}</span></a>`
        : `<a role="link" href="/cu${i}"><span>Someone ${i}</span></a><div dir="auto">${c.body}</div>`;
      article.appendChild(el);
    });
    return article;
  }

  it('separates an unreadable comment from a correctly-rejected wrapper', async () => {
    const { _getDiagnosticCountersForTesting } = await import('../../../src/diagnostics/diagnostics');
    adapter.extractPosts(toNodeList([articleWith([
      // Greek is not in COMMENT_LABEL_STEMS: a real comment FW cannot read.
      { label: 'Σχόλιο από Nikos', body: 'A real comment body, well past the five-character floor.' },
      // No body at this depth — the shape of a wrapper, correctly rejected.
      { label: 'Shared post from Someone', body: null },
    ])]));
    const c = _getDiagnosticCountersForTesting();
    expect(c.fbCommentDroppedLabel).toBe(2);
    expect(c.fbCommentDroppedLabelWithText).toBe(1);
  });

  it('stays at zero when every comment label is recognised', async () => {
    const { _getDiagnosticCountersForTesting } = await import('../../../src/diagnostics/diagnostics');
    adapter.extractPosts(toNodeList([articleWith([
      { label: 'Comentariu adăugat de Maria', body: 'Un comentariu adevărat, suficient de lung.' },
      { label: 'Comment by Bob', body: 'Another real comment body, long enough to extract.' },
    ])]));
    const c = _getDiagnosticCountersForTesting();
    expect(c.fbCommentDroppedLabel).toBeUndefined();
    expect(c.fbCommentDroppedLabelWithText).toBeUndefined();
  });
});
