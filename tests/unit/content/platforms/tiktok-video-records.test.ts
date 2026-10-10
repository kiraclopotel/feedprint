// @vitest-environment jsdom
// TiktokAdapter — empty-caption video records (chain-mirror)
//
// Cut out of tiktok-adapter.test.ts on 2026-09-16 (PLAN-2026-09-16 item 11.3).

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TiktokAdapter,
  _resetTikTokVideoDedupForTesting,
  resetTikTokVideoDedup,
} from '../../../../src/content/platforms/tiktok';
import { makeFeedItem, buildModernCommentRow, makeDetailPage, toNodeList, makeRotatedFeedItem } from './tiktok-page-fixtures';

describe('TiktokAdapter — empty-caption video records (chain-mirror)', () => {
  let adapter: TiktokAdapter;

  beforeEach(() => {
    adapter = new TiktokAdapter();
    _resetTikTokVideoDedupForTesting();
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.tiktok.com', pathname: '/@detailuser/video/7234567890123456789' },
      writable: true,
      configurable: true,
    });
    document.body.innerHTML = '';
  });

  it('emits one video record for an EMPTY-caption permalink video that has comments', () => {
    // Pre-fix: bundle extractor returns null (empty caption), fallback path
    // emitted only the comments → zero video records → orphan comments.
    const detail = makeDetailPage({
      caption: '',
      author: 'detailuser',
      videoId: '7234567890123456789',
      comments: [
        { author: 'viewer1', text: 'A reaction comment under a music-only video' },
        { author: 'viewer2', text: 'Another reaction comment under the same video' },
      ],
    });
    document.body.appendChild(detail);

    // Pass the live document node (NOT a detached clone): the fallback path
    // resolves the comment panel at document scope, so the container must stay
    // attached to the document — matching how the MutationObserver delivers it.
    const posts = adapter.extractPosts(document.body.childNodes);

    const videos = posts.filter((p) => p.kind === 'video');
    const comments = posts.filter((p) => p.kind === 'top-comment');
    expect(videos).toHaveLength(1);
    expect(comments.length).toBeGreaterThanOrEqual(2);

    // The video record links to the same parentVideoId the comments carry.
    expect(videos[0].parentVideoId).toBe('7234567890123456789');
    for (const c of comments) {
      expect(c.parentVideoId).toBe('7234567890123456789');
    }
    // Empty caption preserved as empty text (not synthesized).
    expect(videos[0].text).toBe('');
  });

  it('does NOT re-emit the video record for the SAME video on a second pass (no spam)', () => {
    const detail = makeDetailPage({
      caption: '',
      author: 'detailuser',
      videoId: '7234567890123456789',
      comments: [{ author: 'viewer1', text: 'A reaction comment under a music-only video' }],
    });
    document.body.appendChild(detail);

    const first = adapter.extractPosts(document.body.childNodes);
    expect(first.filter((p) => p.kind === 'video')).toHaveLength(1);

    // Re-extract the same container (virtualizer / MO re-fire on scroll).
    const second = adapter.extractPosts(document.body.childNodes);
    expect(second.filter((p) => p.kind === 'video')).toHaveLength(0);
  });

  it('does NOT collapse two DISTINCT empty-caption videos into one record', () => {
    // Two different permalink videos, each empty-caption, each with comments.
    // Dedup is by video identity — distinct ids must NOT collapse.
    const a = makeDetailPage({
      caption: '',
      author: 'creator_a',
      videoId: '7000000000000000001',
      comments: [{ author: 'fan_a', text: 'Comment under video A only here' }],
    });
    document.body.appendChild(a);

    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.tiktok.com', pathname: '/@creator_a/video/7000000000000000001' },
      writable: true,
      configurable: true,
    });
    const postsA = adapter.extractPosts(document.body.childNodes);
    document.body.innerHTML = '';

    const b = makeDetailPage({
      caption: '',
      author: 'creator_b',
      videoId: '7000000000000000002',
      comments: [{ author: 'fan_b', text: 'Comment under video B only here' }],
    });
    document.body.appendChild(b);

    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.tiktok.com', pathname: '/@creator_b/video/7000000000000000002' },
      writable: true,
      configurable: true,
    });
    const postsB = adapter.extractPosts(document.body.childNodes);

    const videoA = postsA.filter((p) => p.kind === 'video');
    const videoB = postsB.filter((p) => p.kind === 'video');
    expect(videoA).toHaveLength(1);
    expect(videoB).toHaveLength(1);
    expect(videoA[0].parentVideoId).toBe('7000000000000000001');
    expect(videoB[0].parentVideoId).toBe('7000000000000000002');
    expect(videoA[0].parentVideoId).not.toBe(videoB[0].parentVideoId);
  });

  it('a lazy-loaded comment on a second fallback pass never reuses a first-pass comment id', () => {
    // Pre-fix the fallback path minted `tk-cmt-<videoId>-<i>` from the index
    // of the PER-PASS unseen-filtered slice, which restarts at 0 every pass
    // while the per-row `fwCommentSeen` stamps persist. A comment lazy-loaded
    // after the first pass re-minted `tk-cmt-<videoId>-0` — the id of a
    // DIFFERENT first-pass comment — and the id-level dedup downstream
    // silently dropped or overwrote one of the two forensic records. Mirrors
    // the facebook.ts fwCommentNextIdx fix.
    const detail = makeDetailPage({
      caption: '',
      author: 'detailuser',
      videoId: '7234567890123456789',
      comments: [
        { author: 'viewer1', text: 'A reaction comment under a music-only video' },
        { author: 'viewer2', text: 'Another reaction comment under the same video' },
      ],
    });
    document.body.appendChild(detail);

    const first = adapter.extractPosts(document.body.childNodes);
    const firstIds = first.filter((p) => p.kind === 'top-comment').map((p) => p.id);
    expect(firstIds).toHaveLength(2);

    // Lazy-load: TikTok appends a new row to the same comment panel; the
    // first two rows keep their stamps and are skipped on the next pass.
    const panel = detail.querySelector('[class*="DivCommentListContainer"]')!;
    panel.appendChild(
      buildModernCommentRow({ author: 'viewer3', text: 'A third comment lazy-loaded after the first scan' }),
    );

    const second = adapter.extractPosts(document.body.childNodes);
    const secondComments = second.filter((p) => p.kind === 'top-comment');
    expect(secondComments).toHaveLength(1);
    expect(secondComments[0].text).toContain('lazy-loaded after the first scan');
    expect(firstIds).not.toContain(secondComments[0].id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M4 — synthetic fallback video id is stable per container.
//
// Empty-caption FEED videos with no URL video id mint a synthetic
// `tk-music-<ts>-<rand>` id. Pre-fix the id was re-derived on every extraction
// pass, so each scroll over the SAME container produced a NEW id — the
// lazy-loaded comments then carried a fresh parentVideoId and split off into a
// separate dashboard card / chain group. The fix caches the id per container
// element in a WeakMap so re-extractions reuse it.
// ─────────────────────────────────────────────────────────────────────────────

describe('TiktokAdapter — synthetic fallback video id stability (M4)', () => {
  let adapter: TiktokAdapter;

  beforeEach(() => {
    adapter = new TiktokAdapter();
    _resetTikTokVideoDedupForTesting();
    // Feed surface (no /video/<id> in the URL → synthetic id path).
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.tiktok.com', pathname: '/', href: 'https://www.tiktok.com/' },
      writable: true,
      configurable: true,
    });
    document.body.innerHTML = '';
  });

  it('uses the verified FYP wrapper id for an empty-caption video', () => {
    const item = makeRotatedFeedItem({
      caption: '',
      author: 'creator1',
      comments: [{ author: 'viewer1', text: 'a reaction under an empty-caption feed video' }],
    });
    const wrapper = document.createElement('div');
    wrapper.id = 'xgwrapper-0-7900000000000000014';
    item.appendChild(wrapper);
    document.body.appendChild(item);

    const posts = adapter.extractPosts(document.body.childNodes);
    expect(posts.find((post) => post.kind === 'video')?.parentVideoId).toBe(
      '7900000000000000014',
    );
    expect(posts.find((post) => post.kind === 'top-comment')?.parentVideoId).toBe(
      '7900000000000000014',
    );
  });

  it('does not use a numeric music anchor as an empty-caption video id', () => {
    const item = makeRotatedFeedItem({
      caption: '',
      author: 'creator1',
      comments: [{ author: 'viewer1', text: 'a reaction under a LIVE-like feed card' }],
    });
    const music = document.createElement('a');
    music.href = '/music/original-sound-7900000000000001678';
    item.appendChild(music);
    document.body.appendChild(item);

    const posts = adapter.extractPosts(document.body.childNodes);
    expect(posts.find((post) => post.kind === 'video')?.parentVideoId).toMatch(/^tk-music-/);
  });

  it('keeps a same-card permalink authoritative for an empty-caption video', () => {
    const item = makeRotatedFeedItem({
      caption: '',
      author: 'creator1',
      videoId: '7900000000000000014',
      comments: [{ author: 'viewer1', text: 'a reaction under an empty-caption feed video' }],
    });
    const wrapper = document.createElement('div');
    wrapper.id = 'xgwrapper-0-7900000000000000015';
    item.appendChild(wrapper);
    document.body.appendChild(item);

    const posts = adapter.extractPosts(document.body.childNodes);
    expect(posts.find((post) => post.kind === 'video')?.parentVideoId).toBe(
      '7900000000000000014',
    );
  });

  it('does not attach another feed video\'s comments to the current empty-caption video', () => {
    const videoA = makeRotatedFeedItem({
      caption: '',
      author: 'creatorA',
      comments: [{ author: 'viewerA', text: 'comment belonging only to video A' }],
    });
    const videoB = makeRotatedFeedItem({
      caption: '',
      author: 'creatorB',
      comments: [{ author: 'viewerB', text: 'comment belonging only to video B' }],
    });
    document.body.append(videoA, videoB);

    const posts = adapter.extractPosts(toNodeList([videoB]));
    const comments = posts.filter((post) => post.kind === 'top-comment');

    expect(comments.map((comment) => comment.text)).toEqual([
      'comment belonging only to video B',
    ]);
  });

  it('reuses the same synthetic parentVideoId across two extractions of the same container', () => {
    // Empty caption → bundle extractor returns null → fallback (synthetic-id)
    // path. Rotated fixture carries `comment-username-N` markers so the
    // document-scoped flat extractor finds the rows.
    const item = makeRotatedFeedItem({
      caption: '',
      author: 'creator1',
      comments: [{ author: 'viewer1', text: 'a reaction comment under a music-only feed video' }],
    });
    document.body.appendChild(item);

    const first = adapter.extractPosts(document.body.childNodes);
    const firstVideo = first.find((p) => p.kind === 'video');
    expect(firstVideo).toBeDefined();
    const firstId = firstVideo!.parentVideoId;
    expect(firstId).toMatch(/^tk-music-/);

    // Lazy-load a NEW comment under the same container, then re-extract. The
    // caption is gated by fwCaptionEmitted (no second video record), so assert
    // the new comment's parentVideoId equals the first pass's synthetic id —
    // proving the cached id was reused rather than re-minted.
    const list = item.querySelector<HTMLElement>('.DivCommentListContainer');
    expect(list).not.toBeNull();
    const wrapper = document.createElement('div');
    wrapper.className = 'css-DivCommentObjectWrapper epprvxn10';
    const inner = document.createElement('div');
    inner.className = 'css-DivCommentItemWrapper epprvxn0';
    const content = document.createElement('div');
    content.className = 'css-DivCommentContentWrapper epprvxn2';
    const avatar = document.createElement('a');
    avatar.setAttribute('href', '/@viewer2');
    avatar.textContent = '';
    content.appendChild(avatar);
    const username = document.createElement('a');
    username.setAttribute('href', '/@viewer2');
    username.setAttribute('data-e2e', 'comment-username-1');
    username.textContent = '@viewer2';
    content.appendChild(username);
    const textWrap = document.createElement('span');
    textWrap.setAttribute('data-e2e', 'comment-level-1');
    const innerText = document.createElement('span');
    innerText.className = 'TUXText TUXText--tiktok-sans';
    innerText.textContent = 'a second reaction comment lazy-loaded after the first scan';
    textWrap.appendChild(innerText);
    content.appendChild(textWrap);
    inner.appendChild(content);
    wrapper.appendChild(inner);
    list?.appendChild(wrapper);

    const second = adapter.extractPosts(document.body.childNodes);
    const secondComments = second.filter((p) => p.kind === 'top-comment');
    expect(secondComments.length).toBeGreaterThan(0);
    for (const c of secondComments) {
      expect(c.parentVideoId).toBe(firstId);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M5 — resetTikTokVideoDedup re-allows a previously-emitted video.
//
// `emittedVideoIds` is a session-scoped Set keyed on the URL video id. SPA
// back-nav re-mounts a previously-seen video on a FRESH container (no
// fwCaptionEmitted stamp) but the Set still held the id and suppressed the
// caption — leaving a chain-mirror gap for the new visit. onNavigate now calls
// resetTikTokVideoDedup so the re-visited video re-records.
// ─────────────────────────────────────────────────────────────────────────────

describe('TiktokAdapter — resetTikTokVideoDedup re-allows emit after nav (M5)', () => {
  let adapter: TiktokAdapter;

  beforeEach(() => {
    adapter = new TiktokAdapter();
    _resetTikTokVideoDedupForTesting();
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.tiktok.com', pathname: '/@detailuser/video/7234567890123456789' },
      writable: true,
      configurable: true,
    });
    document.body.innerHTML = '';
  });

  it('re-emits a previously-emitted video id on a fresh container after reset', () => {
    const make = () => makeDetailPage({
      caption: 'A permalink caption that is definitely long enough to be extracted by the bundle',
      author: 'detailuser',
      videoId: '7234567890123456789',
      comments: [{ author: 'viewer1', text: 'A reaction comment under the focused video' }],
    });

    const first = make();
    document.body.appendChild(first);
    const firstPosts = adapter.extractPosts(document.body.childNodes);
    expect(firstPosts.filter((p) => p.kind === 'video')).toHaveLength(1);

    // Simulate SPA nav away + back: a FRESH container (no fwCaptionEmitted
    // stamp) for the same video id. Without a reset the emittedVideoIds Set
    // still suppresses the caption.
    document.body.innerHTML = '';
    const suppressed = make();
    document.body.appendChild(suppressed);
    const suppressedPosts = adapter.extractPosts(document.body.childNodes);
    expect(suppressedPosts.filter((p) => p.kind === 'video')).toHaveLength(0);

    // onNavigate's production reset clears the Set → the re-visited video
    // re-records its caption.
    resetTikTokVideoDedup();
    document.body.innerHTML = '';
    const revisited = make();
    document.body.appendChild(revisited);
    const revisitedPosts = adapter.extractPosts(document.body.childNodes);
    const videos = revisitedPosts.filter((p) => p.kind === 'video');
    expect(videos).toHaveLength(1);
    expect(videos[0].parentVideoId).toBe('7234567890123456789');
  });
});

describe('M72: a recycled feed root does not suppress a different video', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    _resetTikTokVideoDedupForTesting();
  });

  it('emits the second video record when a stamped root rehydrates with a new real id', () => {
    const adapter = new TiktokAdapter();
    const item = makeFeedItem({
      caption: 'First video caption, long enough to be a real caption',
      author: 'creator_one',
      videoId: '7234567890123456701',
      comments: [{ author: 'viewer1', text: 'First reaction comment with enough text' }],
    });
    document.body.appendChild(item);

    const first = adapter.extractPosts(toNodeList([item]));
    expect(first.filter(p => p.kind === 'video').map(p => p.parentVideoId)).toEqual(['7234567890123456701']);
    expect(item.dataset.fwCaptionEmitted).toBe('true');

    // TikTok recycles the positional root: dataset stamps survive, children
    // are replaced by a different video's caption, link and comments.
    item.querySelector('[data-e2e="browse-video-desc"] span')!.textContent =
      'Second video caption, a different video in the same root';
    item.querySelector('a[href*="/video/"]')!.setAttribute('href', '/@someone/video/7234567890123456702');
    const list = item.querySelector<HTMLElement>('[class*="DivCommentListContainer"]')!;
    list.replaceChildren(buildModernCommentRow({ author: 'viewer2', text: 'Second video reaction comment with enough text' }));

    const second = adapter.extractPosts(toNodeList([item]));
    expect(second.filter(p => p.kind === 'video').map(p => p.parentVideoId)).toEqual(['7234567890123456702']);
    // The comment under the second video is not left without its video node.
    expect(second.filter(p => p.kind === 'top-comment').map(p => p.parentVideoId)).toEqual(['7234567890123456702']);

    // The same root, the same video, re-scanned: still one caption record.
    const third = adapter.extractPosts(toNodeList([item]));
    expect(third.filter(p => p.kind === 'video')).toHaveLength(0);
  });
});
