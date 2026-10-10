// @vitest-environment jsdom
//
// §CT-26g.3.5 — Cross-platform Sponsored/Ad detection.
//
// Each adapter detects via platform-specific markers; flag bubbles to
// Encounter.post.is_sponsored; prompt emits "Sponsored: yes" line + RULE 11
// guides classifier toward commercial_pitch register.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TwitterAdapter } from '../../../../src/content/platforms/twitter';
import { TiktokAdapter, _resetTikTokVideoDedupForTesting } from '../../../../src/content/platforms/tiktok';
import { InstagramAdapter } from '../../../../src/content/platforms/instagram';
import { FacebookAdapter } from '../../../../src/content/platforms/facebook';
import { buildBatchPromptV3 } from '../../../../src/ai/prompts-v2';
import type { Encounter, CommentNode } from '../../../../src/types/post';

function setLocation(href: string): void {
  Object.defineProperty(window, 'location', {
    value: new URL(href),
    writable: true,
    configurable: true,
  });
}

function mount(html: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  document.body.appendChild(wrap);
  return wrap;
}

describe('§CT-26g.3.5 — Sponsored/Ad detection per platform', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => { document.body.innerHTML = ''; });

  it('X: detects a real ad (bare "Ad" header label, no <time>)', () => {
    setLocation('https://x.com/home');
    const root = mount(`
      <article role="article" data-testid="tweet">
        <a href="/brand" role="link"><span>brand</span></a>
        <span>Ad</span>
        <div data-testid="tweetText" lang="en" dir="ltr">limited time only</div>
      </article>
    `);
    const posts = new TwitterAdapter().extractPosts(root.childNodes);
    const post = posts.find((p) => p.kind === 'post');
    expect(post?.is_sponsored).toBe(true);
  });

  it('X: placementTracking is the VIDEO wrapper, NOT an ad marker → organic video NOT sponsored', () => {
    // Regression found 2026-06-05, "show more → advertisement": an organic
    // video post (placementTracking wraps the player, has a <time>) must PASS.
    setLocation('https://x.com/home');
    const root = mount(`
      <article role="article" data-testid="tweet">
        <a href="/creator" role="link"><span>creator</span></a>
        <time datetime="2026-06-05">8h</time>
        <div data-testid="tweetText" lang="en" dir="ltr">a political video post</div>
        <div data-testid="placementTracking"><div data-testid="videoPlayer"></div></div>
      </article>
    `);
    const posts = new TwitterAdapter().extractPosts(root.childNodes);
    const post = posts.find((p) => p.kind === 'post');
    expect(post?.is_sponsored).toBeFalsy();
  });

  it('X: organic post → is_sponsored falsy', () => {
    setLocation('https://x.com/home');
    const root = mount(`
      <article role="article" data-testid="tweet">
        <a href="/regular" role="link"><span>regular</span></a>
        <div data-testid="tweetText" lang="en" dir="ltr">a regular tweet</div>
      </article>
    `);
    const posts = new TwitterAdapter().extractPosts(root.childNodes);
    const post = posts.find((p) => p.kind === 'post');
    expect(post?.is_sponsored).toBeFalsy();
  });

  it('TikTok: detects [data-e2e="ad-tag"] marker', () => {
    setLocation('https://www.tiktok.com/foryou');
    const root = mount(`
      <div data-e2e="recommend-list-item-container">
        <div data-e2e="video-desc">buy this product caption</div>
        <div data-e2e="ad-tag">Sponsored</div>
        <div data-e2e="comment-level-1">
          <span data-e2e="comment-username-1">@u</span>
          <div data-e2e="comment-text-1"><span>a comment text</span></div>
        </div>
      </div>
    `);
    const posts = new TiktokAdapter().extractPosts(root.childNodes);
    const caption = posts.find((p) => p.kind === 'video');
    expect(caption?.is_sponsored).toBe(true);
  });

  it('Instagram: detects "Sponsored" header text', () => {
    setLocation('https://www.instagram.com/p/ABC/');
    const root = mount(`
      <article>
        <header><span>Sponsored</span></header>
        <a href="/brand_ig/" role="link">brand_ig</a>
        <span dir="auto">a long enough sponsored caption text here</span>
      </article>
    `);
    const posts = new InstagramAdapter().extractPosts(root.childNodes);
    const captionPost = posts.find((p) => p.kind === 'post');
    expect(captionPost?.is_sponsored).toBe(true);
  });

  it('Instagram: detects RO "Sponsorizat" text', () => {
    setLocation('https://www.instagram.com/p/ABC/');
    const root = mount(`
      <article>
        <a href="/brand/" role="link">brand</a>
        <span dir="auto">caption ro brand caption text long enough</span>
        <span>Sponsorizat</span>
      </article>
    `);
    const posts = new InstagramAdapter().extractPosts(root.childNodes);
    const captionPost = posts.find((p) => p.kind === 'post');
    expect(captionPost?.is_sponsored).toBe(true);
  });

  it('Instagram: detects the CURRENT bare "Ad" badge (no header, no time — live-attested 2026-08-11)', () => {
    setLocation('https://www.instagram.com/p/ABC/');
    const root = mount(`
      <article>
        <div><div><a href="/atv_brand/" role="link">atv_brand</a>
          <span dir="auto"><div><div><div><span>Ad</span></div></div></div></span>
        </div></div>
        <span dir="auto">a long enough advertisement caption text here</span>
      </article>
    `);
    const posts = new InstagramAdapter().extractPosts(root.childNodes);
    const captionPost = posts.find((p) => p.kind === 'post');
    expect(captionPost?.is_sponsored).toBe(true);
  });

  it('Instagram: lowercase "ad" span is NOT flagged (the short badge matches case-sensitively)', () => {
    setLocation('https://www.instagram.com/p/ABC/');
    const root = mount(`
      <article>
        <a href="/creator/" role="link">creator</a>
        <span>ad</span>
        <span dir="auto">an organic caption long enough to emit a record</span>
      </article>
    `);
    const posts = new InstagramAdapter().extractPosts(root.childNodes);
    const captionPost = posts.find((p) => p.kind === 'post');
    expect(captionPost).toBeTruthy();
    expect(captionPost?.is_sponsored).toBeFalsy();
  });

  // META-3 (audit swarm 2026-07-13): extractIsInstagramSponsored must NOT
  // scan caption/comment prose for the word "sponsored". Only the structural
  // header/actor-row badge (an element whose ENTIRE text is exactly a
  // sponsored-label word, outside the comment list) may flag the post. An
  // incidental mention in the caption or any comment must not collapse an
  // organic post.
  it('Instagram: organic caption containing the word "sponsored" is NOT flagged (META-3)', () => {
    setLocation('https://www.instagram.com/p/ABC/');
    const root = mount(`
      <article>
        <a href="/creator/" role="link">creator</a>
        <span dir="auto">this collab is not sponsored, just my honest opinion today</span>
      </article>
    `);
    const posts = new InstagramAdapter().extractPosts(root.childNodes);
    const captionPost = posts.find((p) => p.kind === 'post');
    expect(captionPost).toBeTruthy();
    expect(captionPost?.is_sponsored).toBeFalsy();
  });

  it('Instagram: a comment asking "is this sponsored??" does NOT flag the post (META-3)', () => {
    setLocation('https://www.instagram.com/p/ABC/');
    const root = mount(`
      <article>
        <a href="/creator/" role="link">creator</a>
        <span dir="auto">just sharing my morning coffee routine, nothing fancy folks</span>
        <ul>
          <li><a href="/fan/" role="link">fan</a><span dir="auto">wait is this sponsored??</span></li>
        </ul>
      </article>
    `);
    const posts = new InstagramAdapter().extractPosts(root.childNodes);
    const captionPost = posts.find((p) => p.kind === 'post');
    expect(captionPost).toBeTruthy();
    expect(captionPost?.is_sponsored).toBeFalsy();
  });

  it('Instagram: RO organic caption mentioning "sponsorizat" is NOT flagged (META-3)', () => {
    setLocation('https://www.instagram.com/p/ABC/');
    const root = mount(`
      <article>
        <a href="/creator/" role="link">creator</a>
        <span dir="auto">acest clip nu este sponsorizat, e doar parerea mea sincera</span>
      </article>
    `);
    const posts = new InstagramAdapter().extractPosts(root.childNodes);
    const captionPost = posts.find((p) => p.kind === 'post');
    expect(captionPost).toBeTruthy();
    expect(captionPost?.is_sponsored).toBeFalsy();
  });

  it('Instagram: genuine header-badge ad is STILL detected after narrowing (META-3 regression)', () => {
    setLocation('https://www.instagram.com/p/ABC/');
    const root = mount(`
      <article>
        <header>
          <a href="/brand_ig/" role="link">brand_ig</a>
          <span>Sponsored</span>
        </header>
        <span dir="auto">check out our new product line available now everywhere</span>
      </article>
    `);
    const posts = new InstagramAdapter().extractPosts(root.childNodes);
    const captionPost = posts.find((p) => p.kind === 'post');
    expect(captionPost?.is_sponsored).toBe(true);
  });

  it('Facebook: detects [aria-label*="Sponsored"]', () => {
    setLocation('https://www.facebook.com/');
    const root = mount(`
      <div role="article">
        <span aria-label="Sponsored">S</span>
        <div data-ad-rendering-role="story_message">
          <div dir="auto">this is a sponsored facebook post body</div>
        </div>
      </div>
    `);
    const posts = new FacebookAdapter().extractPosts(root.childNodes);
    const captionPost = posts.find((p) => p.kind === 'post');
    expect(captionPost?.is_sponsored).toBe(true);
  });

  it('prompt builder emits "Sponsored: yes" line in [POST_ENVIRONMENT]', () => {
    const enc: Encounter = {
      platform: 'twitter',
      surface: { kind: 'twitter-home-feed' },
      observation_iso: '2026-05-05T00:00:00Z',
      encounter_id: 'enc-1',
      post: {
        id: 'p1',
        kind: 'post',
        text: 'sponsored ad copy',
        author: { handle: 'brand', verified: false, is_creator: false },
        metrics: {},
        is_sponsored: true,
      },
      ancestors: [],
      focused: {
        id: 'p1',
        kind: 'post',
        text: 'sponsored ad copy',
        author: { handle: 'brand', verified: false, is_creator: false },
        metrics: {},
        is_sponsored: true,
      },
      children: [
        {
          id: 'c1',
          kind: 'top-comment',
          depth: 1,
          parent_id: 'p1',
          text: 'a comment under the ad',
          author: { handle: 'u', verified: false, is_pinned_by_creator: false, is_creator_hearted: false },
          metrics: {},
          render_state: 'visible-now',
          fw_marker_present: false,
        },
      ],
      output_language: 'English',
    };
    const { user, system } = buildBatchPromptV3(enc);
    expect(user).toContain('Sponsored: yes');
    // V2 RULE 15 (SPONSORED detection) folded into V3 ROOM SIGNALS bullet:
    // "Sponsored: yes = commercial copy register; fear-appeal / false-
    // urgency drop to 'commercial-pitch' or 'none' severity 1-3." Same
    // invariant (sponsored content uses commercial-pitch register +
    // severity-floor concession for fear-appeal / false-urgency).
    expect(system).toMatch(/Sponsored: yes/);
    expect(system).toContain('commercial-pitch');
    expect(system).toMatch(/commercial copy register/);
  });

  it('prompt builder OMITS sponsored line when post.is_sponsored is falsy', () => {
    const enc: Encounter = {
      platform: 'twitter',
      surface: { kind: 'twitter-home-feed' },
      observation_iso: '2026-05-05T00:00:00Z',
      encounter_id: 'enc-2',
      post: {
        id: 'p1',
        kind: 'post',
        text: 'organic post',
        author: { handle: 'user', verified: false, is_creator: false },
        metrics: {},
      },
      ancestors: [],
      focused: {
        id: 'p1',
        kind: 'post',
        text: 'organic post',
        author: { handle: 'user', verified: false, is_creator: false },
        metrics: {},
      },
      children: [],
      output_language: 'English',
    };
    const { user } = buildBatchPromptV3(enc);
    expect(user).not.toContain('Sponsored: yes');
  });
});

describe('M94 — TikTok late ad-marker hydration on a processed card', () => {
  // Live drive 2026-07-14 11:47 (LIVE-FAILED, docs/spec/known-issues.md M94).
  // The ids below are invented on this tree's 19000... convention: the drive's
  // own id belonged to a real advertiser and this file is published.
  // the ad carried the exact data-e2e="ad-tag" but the marker
  // hydrated AFTER extraction emitted the caption as organic; nothing
  // re-examined the root and the ad stayed visible and playing 44s later.
  // The adapter must allow ONE sponsored reprocess when the exact marker
  // appears late on the same container with the same real video id. The
  // trigger in production is the interceptor's 3s periodic rescan re-walking
  // the container.

  beforeEach(() => {
    document.body.innerHTML = '';
    _resetTikTokVideoDedupForTesting();
  });
  afterEach(() => { document.body.innerHTML = ''; });

  function mountCard(videoId: string): HTMLElement {
    setLocation('https://www.tiktok.com/foryou');
    return mount(`
      <div data-e2e="recommend-list-item-container">
        <div id="xgwrapper-0-${videoId}"></div>
        <div data-e2e="video-desc">buy this product caption</div>
      </div>
    `);
  }

  function container(root: HTMLElement): HTMLElement {
    return root.querySelector<HTMLElement>('[data-e2e="recommend-list-item-container"]')!;
  }

  function hydrateAdTag(root: HTMLElement): void {
    const tag = document.createElement('div');
    tag.setAttribute('data-e2e', 'ad-tag');
    tag.textContent = 'Sponsored';
    container(root).appendChild(tag);
  }

  it('re-emits the caption as sponsored when the exact marker hydrates after the organic pass', () => {
    const adapter = new TiktokAdapter();
    const root = mountCard('1900000000000000966');
    const first = adapter.extractPosts(root.childNodes);
    const organic = first.find((p) => p.kind === 'video');
    expect(organic).toBeDefined();
    expect(organic?.is_sponsored).toBeFalsy();

    hydrateAdTag(root);
    const second = adapter.extractPosts(root.childNodes);
    const sponsored = second.find((p) => p.kind === 'video');
    expect(sponsored?.is_sponsored).toBe(true);
    expect(sponsored?.id).toBe('tk-vid-1900000000000000966');
  });

  it('claims exactly once — a third pass over the same marked card emits no further video record', () => {
    const adapter = new TiktokAdapter();
    const root = mountCard('1900000000000000967');
    adapter.extractPosts(root.childNodes);
    hydrateAdTag(root);
    const second = adapter.extractPosts(root.childNodes);
    expect(second.find((p) => p.kind === 'video')?.is_sponsored).toBe(true);

    const third = adapter.extractPosts(root.childNodes);
    expect(third.find((p) => p.kind === 'video')).toBeUndefined();
  });

  it('does not re-emit when the root already carries the applied ad-hide', () => {
    const adapter = new TiktokAdapter();
    const root = mountCard('1900000000000000968');
    adapter.extractPosts(root.childNodes);
    container(root).dataset.fwAdHidden = 'true';
    hydrateAdTag(root);
    const second = adapter.extractPosts(root.childNodes);
    expect(second.find((p) => p.kind === 'video')).toBeUndefined();
  });

  it('does not re-emit while no marker is present (existing same-container dedup preserved)', () => {
    const adapter = new TiktokAdapter();
    const root = mountCard('1900000000000000969');
    adapter.extractPosts(root.childNodes);
    const second = adapter.extractPosts(root.childNodes);
    expect(second.find((p) => p.kind === 'video')).toBeUndefined();
  });

  it('refuses the claim when the container was recycled to a different video id', () => {
    const adapter = new TiktokAdapter();
    const root = mountCard('1900000000000000970');
    adapter.extractPosts(root.childNodes);

    // Recycle: same container element, new video identity + late marker.
    const wrapper = container(root).querySelector<HTMLElement>('div[id^="xgwrapper-"]')!;
    wrapper.id = 'xgwrapper-0-1900000000000000971';
    hydrateAdTag(root);
    const second = adapter.extractPosts(root.childNodes);
    // The stale organic entry must not let the NEW id inherit a sponsored
    // reprocess (recycle identity belongs to the M70/M84 family, not M94).
    // Since 2026-09-06 (M72) a recycled root does emit the NEW video as a
    // fresh record; what this row forbids is the OLD id coming back, or the
    // new one arriving through the late-marker claim rather than extraction.
    const videos = second.filter((p) => p.kind === 'video');
    expect(videos.map((p) => p.parentVideoId)).not.toContain('1900000000000000970');
    expect(videos.length).toBeLessThanOrEqual(1);
    for (const v of videos) expect(v.parentVideoId).toBe('1900000000000000971');
  });
});

describe('E1 — X late ad-label hydration on a processed article', () => {
  // Owner live evidence 2026-08-04 (x.com/home, adult mode): a promoted
  // article carried fwProcessed=true + a stale pass while its header showed
  // the bare "Ad" leaf and no <time> — the exact extractIsXSponsored shape.
  // The header hydrated AFTER extraction: at extract time it had NEITHER a
  // <time> NOR an ad label, so the article was emitted organic and the
  // fwProcessed stamp blocked every re-look. Same failure family as TikTok
  // M94 above; same remedy shape: claim exactly ONE sponsored reprocess when
  // the ad label hydrates late on a stamped element. The production trigger
  // is the interceptor's 3s periodic rescan / scroll re-tickle re-walking the
  // article through extractPosts.

  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => { document.body.innerHTML = ''; });

  function mountUnhydrated(): HTMLElement {
    setLocation('https://x.com/home');
    // Unhydrated header: no <time>, no ad label yet — just author + text.
    return mount(`
      <article role="article" data-testid="tweet">
        <a href="/brand" role="link"><span>brand</span></a>
        <div data-testid="tweetText" lang="en" dir="ltr">limited time only, act now</div>
      </article>
    `);
  }

  function tweetEl(root: HTMLElement): HTMLElement {
    return root.querySelector<HTMLElement>('[data-testid="tweetText"]')!;
  }

  function hydrateAdLabel(root: HTMLElement): void {
    const label = document.createElement('span');
    label.textContent = 'Ad';
    root.querySelector('article')!.insertBefore(label, tweetEl(root));
  }

  it('re-emits the post as sponsored when the Ad label hydrates after the stamp', () => {
    const adapter = new TwitterAdapter();
    const root = mountUnhydrated();
    const first = adapter.extractPosts(root.childNodes);
    expect(first).toHaveLength(1);
    expect(first[0].is_sponsored).toBeFalsy();
    // The interceptor stamps the element after extraction (_processNodes).
    tweetEl(root).dataset.fwProcessed = 'true';

    hydrateAdLabel(root);
    const second = adapter.extractPosts(root.childNodes);
    expect(second).toHaveLength(1);
    expect(second[0].is_sponsored).toBe(true);
  });

  it('claims exactly once — a third pass over the stamped article emits nothing', () => {
    const adapter = new TwitterAdapter();
    const root = mountUnhydrated();
    adapter.extractPosts(root.childNodes);
    tweetEl(root).dataset.fwProcessed = 'true';
    hydrateAdLabel(root);
    expect(adapter.extractPosts(root.childNodes)).toHaveLength(1);
    // Re-stamped by the interceptor after the sponsored re-emission.
    tweetEl(root).dataset.fwProcessed = 'true';
    expect(adapter.extractPosts(root.childNodes)).toHaveLength(0);
  });

  it('never re-tickles a stamped ORGANIC article (has <time> — no unbounded loop)', () => {
    setLocation('https://x.com/home');
    const adapter = new TwitterAdapter();
    const root = mount(`
      <article role="article" data-testid="tweet">
        <a href="/creator" role="link"><span>creator</span></a>
        <time datetime="2026-08-04">2h</time>
        <div data-testid="tweetText" lang="en" dir="ltr">a normal organic tweet body</div>
      </article>
    `);
    adapter.extractPosts(root.childNodes);
    tweetEl(root).dataset.fwProcessed = 'true';
    expect(adapter.extractPosts(root.childNodes)).toHaveLength(0);
  });

  it('a stamped header-less article with no ad label stays skipped (still unhydrated)', () => {
    const adapter = new TwitterAdapter();
    const root = mountUnhydrated();
    adapter.extractPosts(root.childNodes);
    tweetEl(root).dataset.fwProcessed = 'true';
    // No hydration happened — the stamped element must not re-emit.
    expect(adapter.extractPosts(root.childNodes)).toHaveLength(0);
  });
});
