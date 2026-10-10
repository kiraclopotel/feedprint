// @vitest-environment jsdom
//
// The text writer swaps a record's words. What it is handed is whatever each adapter put in the
// record's domRef, so the class "a swap wipes the box" is settled per site, on the shapes each
// adapter really reads. Two sides on every site: the element the adapter names for a post is
// rewritten in place while the card's own pictures, video and buttons stay; and when the adapter
// names a whole card (a wrapper, a side panel, the article) the writer refuses and the card is
// untouched. A refusal is what makes the caller's "did not land" path run (Child hides the post).

import { describe, it, expect, beforeEach } from 'vitest';
import { injectIntoElement, injectCollapseOrHide } from '../../../../src/content/injector';
import { TwitterAdapter } from '../../../../src/content/platforms/twitter';
import { FacebookAdapter } from '../../../../src/content/platforms/facebook';
import { InstagramAdapter } from '../../../../src/content/platforms/instagram';
import { YoutubeAdapter, extractYoutubeHomeTile } from '../../../../src/content/platforms/youtube';
import type { PostContent } from '../../../../src/types/post';
import type { AnalysisResult, TechniqueName } from '../../../../src/types/analysis';
import { buildReelContainer } from './instagram-page-fixtures';

function analysisWith(technique: TechniqueName): AnalysisResult {
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

const REWRITE = 'a calm replacement';
const neutralized = { rewrittenText: REWRITE, analysis: analysisWith('fear-appeal'), aiSource: 'cloud' } as never;

function setLocation(href: string): void {
  const url = new URL(href);
  Object.defineProperty(window, 'location', {
    value: { hostname: url.hostname, pathname: url.pathname, search: url.search, href },
    writable: true,
    configurable: true,
  });
}

function domRefOf(post: PostContent | undefined): HTMLElement {
  const el = post?.domRef.deref();
  if (!el) throw new Error('the record has no live element');
  return el;
}

/** What a rewrite and a fold each do with the element, on a fresh copy of the page. */
function rewriteAndFold(mount: () => { target: HTMLElement; root: HTMLElement }) {
  const a = mount();
  const before = a.root.innerHTML;
  const rewritten = injectIntoElement(a.target, neutralized, 'teen');
  const rewriteLanded = rewritten && (a.target.textContent ?? '').includes(REWRITE);
  const rewriteChangedNothing = a.root.innerHTML === before;
  const b = mount();
  const beforeFold = b.root.innerHTML;
  const folded = injectCollapseOrHide(b.target, analysisWith('fear-appeal'), 'collapse');
  return {
    a, b, rewritten, rewriteLanded, rewriteChangedNothing,
    folded, foldChangedNothing: b.root.innerHTML === beforeFold,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

// ─── X ───

const X_BODY = 'a tweet body with enough words in it to be read';

function mountTweet(): { target: HTMLElement; root: HTMLElement; article: HTMLElement } {
  document.body.innerHTML = `
    <div data-testid="cellInnerDiv">
      <article role="article" data-testid="tweet">
        <a data-testid="User-Name" href="/somebody" role="link"><span>somebody</span></a>
        <a href="/somebody/status/100" role="link">5h</a>
        <div data-testid="tweetText" lang="en" dir="ltr"><span>${X_BODY} </span><a href="/hashtag/x" role="link">#x</a><img alt="😀" draggable="false" src="e.svg" style="height:1.2em"></div>
        <div data-testid="tweetPhoto"><img src="photo.jpg" alt="Image"></div>
        <div data-testid="videoPlayer"><video src="v.mp4"></video></div>
        <div role="group"><button aria-label="Reply" type="button"></button><button aria-label="Repost" type="button"></button></div>
      </article>
    </div>`;
  const article = document.querySelector<HTMLElement>('article')!;
  const post = new TwitterAdapter().extractPosts(document.querySelectorAll('article[role="article"]'))[0];
  return { target: domRefOf(post), root: article, article };
}

describe('X', () => {
  beforeEach(() => setLocation('https://x.com/home'));

  it('the record points at the tweet text, which is rewritten while the photo, video and buttons stay', () => {
    const t = mountTweet();
    expect(t.target.getAttribute('data-testid')).toBe('tweetText');

    expect(injectIntoElement(t.target, neutralized, 'teen')).toBe(true);

    expect(t.target.textContent).toContain(REWRITE);
    expect(t.article.querySelector('[data-testid="tweetPhoto"] img')).not.toBeNull();
    expect(t.article.querySelector('video')).not.toBeNull();
    expect(t.article.querySelectorAll('button')).toHaveLength(2);
  });

  it('with the marker on, the site writing its own words back is answered by the guard, and the photo stays', async () => {
    const t = mountTweet();
    expect(injectIntoElement(t.target, neutralized, 'teen', true, X_BODY)).toBe(true);
    expect(t.target.querySelector('.fw-teen-marker')).not.toBeNull();

    t.target.querySelector('span')!.textContent = `${X_BODY} `;
    await new Promise((r) => setTimeout(r, 20));

    expect(t.target.textContent).toContain(REWRITE);
    expect(t.target.querySelectorAll('.fw-teen-marker')).toHaveLength(1);
    expect(t.article.querySelector('[data-testid="tweetPhoto"] img')).not.toBeNull();
    expect(t.article.querySelector('video')).not.toBeNull();
  });

  it('the whole article, if a caller ever handed it over, is refused for a rewrite and for a fold', () => {
    const r = rewriteAndFold(() => { const t = mountTweet(); return { target: t.article, root: t.article }; });
    expect(r.rewritten).toBe(false);
    expect(r.rewriteChangedNothing).toBe(true);
    expect(r.folded).toBe(false);
    expect(r.foldChangedNothing).toBe(true);
  });
});

// ─── Facebook ───

function mountFbPost(body: string): { target: HTMLElement; root: HTMLElement } {
  document.body.innerHTML = `
    <div role="article" aria-posinset="1">
      <div data-ad-rendering-role="profile_name"><a role="link" href="/somebody">Somebody</a></div>
      ${body}
      <div><div role="button" aria-label="Like" tabindex="0">Like</div><div role="button" aria-label="Share" tabindex="0">Share</div></div>
    </div>`;
  const root = document.querySelector<HTMLElement>('[role="article"]')!;
  const post = new FacebookAdapter().extractPosts(document.querySelectorAll('[role="article"]')).find((p) => p.kind === 'post');
  return { target: domRefOf(post), root };
}

describe('Facebook', () => {
  beforeEach(() => setLocation('https://www.facebook.com/'));

  it('a post whose words sit in the story message is rewritten while its photo and buttons stay', () => {
    const t = mountFbPost(`
      <div data-ad-rendering-role="story_message"><div dir="auto">A hostile original post with plenty of words in it.</div></div>
      <div><img src="photo.jpg" alt="A photo"></div>`);
    expect(t.target.getAttribute('data-ad-rendering-role')).toBe('story_message');

    expect(injectIntoElement(t.target, neutralized, 'teen')).toBe(true);

    expect(t.target.textContent).toContain(REWRITE);
    expect(t.root.querySelector('img[alt="A photo"]')).not.toBeNull();
    expect(t.root.querySelectorAll('[role="button"]')).toHaveLength(2);
  });

  it('a wrapper the fallback picker keeps, holding the words directly beside a link card with a picture, is refused', () => {
    // No story message and no text box inside the wrapper: the reader still takes the wrapper as the
    // body, so the post is read; the writer then leaves the card's picture alone.
    const r = rewriteAndFold(() => mountFbPost(`
      <div dir="auto">
        A hostile original post with plenty of words in it.
        <a href="https://example.test/story"><img src="preview.jpg" alt="Preview"><div>Story headline that adds more words to the wrapper</div></a>
      </div>`));
    expect(r.a.target.querySelector('img')).not.toBeNull();
    expect(r.rewritten).toBe(false);
    expect(r.rewriteChangedNothing).toBe(true);
    expect(r.folded).toBe(false);
    expect(r.foldChangedNothing).toBe(true);
  });

  it('a Reel record points at the whole side panel, which is refused: its comments and buttons stay', () => {
    setLocation('https://www.facebook.com/reel/555');
    const mount = () => {
      document.body.innerHTML = `
        <div role="main"><div data-ad-rendering-role="profile_name">Reel Author</div></div>
        <div role="complementary" aria-label="Comments">
          <button type="button" aria-label="Like"></button>
          <div role="article" aria-label="Comment by Someone"><div dir="auto">a comment under the reel</div></div>
        </div>`;
      const post = new FacebookAdapter().extractPosts(document.body.childNodes).find((p) => p.kind === 'video');
      return { target: domRefOf(post), root: document.body };
    };
    const r = rewriteAndFold(mount);
    expect(r.a.target.getAttribute('role')).toBe('complementary');
    expect(r.rewritten).toBe(false);
    expect(r.rewriteChangedNothing).toBe(true);
    expect(r.folded).toBe(false);
    expect(r.foldChangedNothing).toBe(true);
  });
});

// ─── Instagram ───

function mountIgPost(): { target: HTMLElement; root: HTMLElement } {
  setLocation('https://www.instagram.com/');
  document.body.innerHTML = `
    <article>
      <header><a href="/somebody/">somebody</a></header>
      <div><img src="photo.jpg" alt="Photo by somebody"></div>
      <section><button type="button" aria-label="Like"></button><button type="button" aria-label="Share"></button></section>
      <div><span dir="auto"><span>A hostile original caption with plenty of words in it.</span></span></div>
      <ul><li><span dir="auto">a comment that is not the caption of this post</span></li></ul>
    </article>`;
  const root = document.querySelector<HTMLElement>('article')!;
  const post = new InstagramAdapter().extractPosts(document.querySelectorAll('article'))[0];
  return { target: domRefOf(post), root };
}

describe('Instagram', () => {
  it('a feed post: the caption is rewritten while the photo, buttons and comments stay', () => {
    const t = mountIgPost();
    expect(t.target.tagName).toBe('SPAN');

    expect(injectIntoElement(t.target, neutralized, 'teen')).toBe(true);

    expect(t.target.textContent).toContain(REWRITE);
    expect(t.root.querySelector('img')).not.toBeNull();
    expect(t.root.querySelectorAll('button')).toHaveLength(2);
    expect(t.root.querySelector('ul li')).not.toBeNull();
  });

  it('a Reel: the caption is rewritten while the video stays', () => {
    setLocation('https://www.instagram.com/reels/DREEL0001/');
    document.body.innerHTML = '<main></main>';
    const container = buildReelContainer();
    document.querySelector('main')!.appendChild(container);
    const post = new InstagramAdapter().extractPosts(document.querySelectorAll('article')).find((p) => p.kind === 'video');
    const caption = domRefOf(post);
    expect(caption.tagName).toBe('SPAN');

    expect(injectIntoElement(caption, neutralized, 'teen')).toBe(true);

    expect(caption.textContent).toContain(REWRITE);
    expect(container.querySelector('video')).not.toBeNull();
  });

  it('the article, or the Reel container, if a caller ever handed it over, is refused', () => {
    const post = mountIgPost();
    const r = rewriteAndFold(() => { const t = mountIgPost(); return { target: t.root, root: t.root }; });
    expect(post.root.querySelector('img')).not.toBeNull();
    expect(r.rewritten).toBe(false);
    expect(r.rewriteChangedNothing).toBe(true);
    expect(r.folded).toBe(false);
    expect(r.foldChangedNothing).toBe(true);

    document.body.innerHTML = '<main></main>';
    const container = buildReelContainer();
    document.querySelector('main')!.appendChild(container);
    const before = container.innerHTML;
    expect(injectIntoElement(container, neutralized, 'teen')).toBe(false);
    expect(container.innerHTML).toBe(before);
  });
});

// ─── YouTube ───

function mountHomeTile(): { target: HTMLElement; tile: HTMLElement } {
  setLocation('https://www.youtube.com/');
  const tile = document.createElement('ytd-rich-item-renderer');
  tile.innerHTML = `
    <div id="content">
      <yt-lockup-view-model>
        <a href="/watch?v=abcdefghijk" class="ytLockupViewModelContentImage"><yt-thumbnail-view-model><img src="t.jpg"></yt-thumbnail-view-model></a>
        <div class="ytLockupViewModelMetadata">
          <yt-lockup-metadata-view-model>
            <h3 title="A hostile original title" aria-label="A hostile original title">A hostile original title</h3>
            <yt-content-metadata-view-model><span>Some Channel</span><span>1.2M views</span></yt-content-metadata-view-model>
          </yt-lockup-metadata-view-model>
        </div>
      </yt-lockup-view-model>
    </div>`;
  document.body.appendChild(tile);
  const post = extractYoutubeHomeTile(tile, 'home' as never);
  return { target: domRefOf(post ?? undefined), tile };
}

function mountCommunityPost(): { target: HTMLElement; root: HTMLElement } {
  setLocation('https://www.youtube.com/@somebody/community');
  document.body.innerHTML = `
    <ytd-backstage-post-renderer>
      <div id="author"><a id="author-text" href="/@somebody">somebody</a></div>
      <div id="content-text"><yt-attributed-string>A hostile original community post with plenty of words.</yt-attributed-string></div>
      <div id="attachment"><img src="poll.jpg" alt="Attachment"></div>
      <div id="toolbar"><button type="button" aria-label="Like"></button></div>
    </ytd-backstage-post-renderer>`;
  const root = document.querySelector<HTMLElement>('ytd-backstage-post-renderer')!;
  const post = new YoutubeAdapter().extractPosts(document.querySelectorAll('ytd-backstage-post-renderer'))
    .find((p) => p.platform === 'youtube');
  return { target: domRefOf(post), root };
}

describe('YouTube', () => {
  it('a home tile: the title is rewritten while the thumbnail stays', () => {
    const t = mountHomeTile();
    expect(t.target.tagName).toBe('H3');

    expect(injectIntoElement(t.target, neutralized, 'teen')).toBe(true);

    expect(t.target.textContent).toContain(REWRITE);
    expect(t.tile.querySelector('img')).not.toBeNull();
  });

  it('the whole home tile, if a caller ever handed it over, is refused', () => {
    const r = rewriteAndFold(() => { const t = mountHomeTile(); return { target: t.tile, root: t.tile }; });
    expect(r.rewritten).toBe(false);
    expect(r.rewriteChangedNothing).toBe(true);
    expect(r.folded).toBe(false);
    expect(r.foldChangedNothing).toBe(true);
  });

  it('a community post: the text is rewritten while the attachment and the buttons stay', () => {
    const t = mountCommunityPost();
    expect(injectIntoElement(t.target, neutralized, 'teen')).toBe(true);

    expect(t.target.textContent).toContain(REWRITE);
    expect(t.root.querySelector('#attachment img')).not.toBeNull();
    expect(t.root.querySelector('button')).not.toBeNull();
  });

  it('the whole community post, if a caller ever handed it over, is refused', () => {
    const r = rewriteAndFold(() => { const t = mountCommunityPost(); return { target: t.root, root: t.root }; });
    expect(r.rewritten).toBe(false);
    expect(r.rewriteChangedNothing).toBe(true);
    expect(r.folded).toBe(false);
    expect(r.foldChangedNothing).toBe(true);
  });
});
