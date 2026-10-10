// @vitest-environment jsdom
//
// 2026-04-25 (the record-split decision): TiktokAdapter produces 1 record for the caption
// (kind='video') + N records for visible comments (kind='comment'), all sharing
// `parentVideoId`. Replaces LOOP-025's single-bundle approach so the dashboard
// can show "1 video + N checks" instead of one merged record per video.
// Tests below assert the new contract: per-video record count, kind tags,
// parentVideoId linkage.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TiktokAdapter,
  _resetTikTokVideoDedupForTesting,
  resetTikTokVideoDedup,
} from '../../../../src/content/platforms/tiktok';
import { makeFeedItem, buildModernCommentRow, makeDetailPage, makeOrphanComment, toNodeList } from './tiktok-page-fixtures';

describe('TiktokAdapter (2026-04-25 per-comment split)', () => {
  let adapter: TiktokAdapter;

  beforeEach(() => {
    adapter = new TiktokAdapter();
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.tiktok.com', pathname: '/' },
      writable: true,
      configurable: true,
    });
    document.body.innerHTML = '';
  });

  it('produces one caption record per feed video (no comments visible)', () => {
    const item = makeFeedItem({
      caption: 'This is a TikTok caption that is long enough to pass the minimum length filter',
      author: 'creator1',
    });
    const posts = adapter.extractPosts(toNodeList([item]));

    expect(posts).toHaveLength(1);
    expect(posts[0].platform).toBe('tiktok');
    expect(posts[0].kind).toBe('video');
    expect(posts[0].text).toContain('TikTok caption');
    expect(posts[0].author).toBe('@creator1');
  });

  it('produces one caption record per detail-page video', () => {
    // Permalink URL so detectTikTokRoutingSurface returns 'permalink'
    // and selects the recommend-list-item-container selector.
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.tiktok.com', pathname: '/@detailuser/video/7234567890123456789' },
      writable: true,
      configurable: true,
    });
    const detail = makeDetailPage({
      caption: 'This is a detail page caption that is definitely long enough to be extracted',
      author: 'detailuser',
      videoId: '7234567890123456789',
    });
    const posts = adapter.extractPosts(toNodeList([detail]));

    expect(posts).toHaveLength(1);
    expect(posts[0].kind).toBe('video');
    expect(posts[0].text).toContain('detail page caption');
    expect(posts[0].parentVideoId).toBe('7234567890123456789');
  });

  it('emits N+1 records per video: 1 caption + N comments, sharing parentVideoId', () => {
    const item = makeFeedItem({
      caption: 'A caption with enough characters to pass the thirty character minimum threshold',
      author: 'creator1',
      videoId: '999',
      comments: [
        { author: 'viewer1', text: 'First reaction comment to this video' },
        { author: 'viewer2', text: 'Second reaction comment from another viewer' },
        { author: 'viewer3', text: 'A third reaction comment for context' },
      ],
    });
    const posts = adapter.extractPosts(toNodeList([item]));

    // 1 caption + 3 comments
    expect(posts).toHaveLength(4);
    const captions = posts.filter(p => p.kind === 'video');
    const comments = posts.filter(p => p.kind === 'top-comment');
    expect(captions).toHaveLength(1);
    expect(comments).toHaveLength(3);

    // All share the same parentVideoId
    const pid = captions[0].parentVideoId;
    expect(pid).toBeTruthy();
    for (const c of comments) expect(c.parentVideoId).toBe(pid);

    // Each comment record carries its own text (NOT bundled together)
    const cmtTexts = comments.map(c => c.text);
    expect(cmtTexts).toContain('First reaction comment to this video');
    expect(cmtTexts).toContain('Second reaction comment from another viewer');
    expect(cmtTexts).toContain('A third reaction comment for context');

    // Caption record is caption-only (no comment text leaked in)
    expect(captions[0].text).not.toContain('First reaction comment');
  });

  it('separates comment pools across two videos via parentVideoId', () => {
    // 2026-04-26 fix: prod `extractVideoId` only matches `/video/(\d+)/`, so
    // string fixtures like 'vid-a' fell through to a synth ID and the
    // assertion-by-literal-string never passed. Use numeric IDs to mirror
    // the actual TikTok URL shape, then assert pool separation by the
    // captions' resulting parentVideoIds rather than hard-coded strings.
    const a = makeFeedItem({
      caption: 'First video caption that satisfies the length floor for analysis to fire',
      author: 'creator_a',
      videoId: '1000000000000000001',
      comments: [{ author: 'fan_a', text: 'Comment under video A only' }],
    });
    const b = makeFeedItem({
      caption: 'Second video caption that satisfies the length floor for analysis to fire',
      author: 'creator_b',
      videoId: '1000000000000000002',
      comments: [{ author: 'fan_b', text: 'Comment under video B only' }],
    });
    const posts = adapter.extractPosts(toNodeList([a, b]));

    // 2 captions + 2 comments
    expect(posts).toHaveLength(4);

    const captions = posts.filter(p => p.kind === 'video');
    expect(captions).toHaveLength(2);
    const pidA = captions[0].parentVideoId;
    const pidB = captions[1].parentVideoId;
    expect(pidA).toBeTruthy();
    expect(pidB).toBeTruthy();
    expect(pidA).not.toBe(pidB);

    const groupA = posts.filter(p => p.parentVideoId === pidA);
    const groupB = posts.filter(p => p.parentVideoId === pidB);
    expect(groupA).toHaveLength(2);
    expect(groupB).toHaveLength(2);

    const aComment = groupA.find(p => p.kind === 'top-comment');
    const bComment = groupB.find(p => p.kind === 'top-comment');
    // The captions are emitted in extraction order; whichever caption is in
    // groupA gets the matching comment.
    const aCaption = groupA.find(p => p.kind === 'video');
    const bCaption = groupB.find(p => p.kind === 'video');
    if (aCaption?.text.startsWith('First video')) {
      expect(aComment?.text).toBe('Comment under video A only');
      expect(bComment?.text).toBe('Comment under video B only');
    } else {
      expect(aComment?.text).toBe('Comment under video B only');
      expect(bComment?.text).toBe('Comment under video A only');
    }
  });

  it('extracts author from browse-username for the caption record', () => {
    const item = makeFeedItem({
      caption: 'A caption with enough characters to pass the thirty character minimum threshold',
      author: 'coolcreator',
    });
    const posts = adapter.extractPosts(toNodeList([item]));

    expect(posts).toHaveLength(1);
    expect(posts[0].kind).toBe('video');
    expect(posts[0].author).toBe('@coolcreator');
  });

  it('does NOT treat orphan comments (no surrounding video container) as posts', () => {
    // Pre-LOOP-025 behavior: a comment-level-1 alone produced a PostContent.
    // Post-LOOP-025: comments only surface as context INSIDE a video container.
    const orphan = makeOrphanComment({
      text: 'A standalone comment that used to scan as its own post pre-LOOP-025',
      author: 'commenter1',
    });
    const posts = adapter.extractPosts(toNodeList([orphan]));

    expect(posts).toHaveLength(0);
  });

  it('skips caption when container.dataset.fwCaptionEmitted is already true', () => {
    // Per-record dedup replaced the container-level fwProcessed gate so
    // lazy-loaded comments inside an already-processed container still
    // reach the batch path. The caption stays gated by its own dataset
    // flag — fwCaptionEmitted — set after the caption record is pushed.
    const item = makeFeedItem({
      caption: 'A caption with enough characters to pass the thirty character minimum threshold',
      author: 'creator1',
    });
    item.dataset.fwCaptionEmitted = 'true';

    const posts = adapter.extractPosts(toNodeList([item]));
    // No caption record; comments would still flow if any were attached.
    expect(posts.filter(p => p.kind === 'video')).toHaveLength(0);
  });

  it('re-extracts only the newly-added comment on a second extract pass (Bug C lazy-load)', () => {
    // Bug C regression cover: pre-fix the TikTok adapter short-circuited
    // any container that had been processed once (via container.dataset.
    // fwProcessed), so lazy-loaded comments appended after the first scan
    // were permanently invisible to the batch. The fix moves the gate from
    // container-level to per-comment-level (cmtEl.dataset.fwCommentSeen +
    // container.dataset.fwCaptionEmitted), mirroring the §CT-30 facebook.ts
    // pattern.
    const item = makeFeedItem({
      caption: 'A caption with enough characters to pass the thirty character minimum threshold',
      author: 'creator1',
      videoId: '888',
      comments: [
        { author: 'viewer1', text: 'First reaction comment seen on initial extract' },
      ],
    });
    document.body.appendChild(item);

    const first = adapter.extractPosts(toNodeList([item]));
    // First pass: 1 caption + 1 comment.
    expect(first.filter(p => p.kind === 'video')).toHaveLength(1);
    expect(first.filter(p => p.kind === 'top-comment')).toHaveLength(1);

    // Simulate TikTok lazy-loading a new comment under the SAME container
    // after the user scrolls. The container itself still carries any stamps
    // the interceptor / adapter wrote on the first pass.
    const list = item.querySelector<HTMLElement>('[class*="DivCommentListContainer"]');
    expect(list).not.toBeNull();
    list?.appendChild(buildModernCommentRow({
      author: 'viewer2',
      text: 'Second reaction comment lazy-loaded after the first scan completed',
    }));

    const second = adapter.extractPosts(toNodeList([item]));
    // Caption already emitted → not re-emitted. The first comment was
    // stamped fwCommentSeen on its own element → not re-emitted. Only the
    // newly-added comment surfaces on this pass.
    expect(second.filter(p => p.kind === 'video')).toHaveLength(0);
    const newComments = second.filter(p => p.kind === 'top-comment');
    expect(newComments).toHaveLength(1);
    expect(newComments[0].text).toContain('lazy-loaded after the first scan');
  });

  it('Bug A — slides the comment-cap window past already-seen rows on scroll (no freeze at the cap)', () => {
    // Regression cover for the "frozen at 14" TikTok scanning freeze.
    // The bundle extractor caps comments at DEFAULT_BUNDLE_COMMENT_CAP (15).
    // Pre-fix: querySelectorAll returns rows in DOM order, so the cap always
    // re-examined the SAME first 15 rows — all stamped fwCommentSeen on the
    // first pass — and the adapter skipped every one, surfacing 0 new
    // comments on every subsequent scroll. Rows 16+ were never iterated.
    // Fix: the cap window slides past rows already carrying fwCommentSeen.
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.tiktok.com', pathname: '/@user/video/7777777777777777777' },
      writable: true,
      configurable: true,
    });
    // 25 comments — well past the 15-comment cap.
    const allComments = Array.from({ length: 25 }, (_, i) => ({
      author: `viewer${i}`,
      text: `Reaction comment number ${i} with enough characters to pass the floor`,
    }));
    const item = makeDetailPage({
      caption: 'A permalink caption that is definitely long enough to be extracted by the bundle',
      author: 'creator1',
      videoId: '7777777777777777777',
      comments: allComments,
    });
    document.body.appendChild(item);

    // Pass 1: caption + the first cap-window of comments.
    const first = adapter.extractPosts(toNodeList([item]));
    const firstComments = first.filter((p) => p.kind === 'top-comment');
    expect(firstComments.length).toBe(15);
    const firstTexts = new Set(firstComments.map((p) => p.text));

    // Pass 2 (simulates a scroll re-extract — the rows are still in the DOM,
    // the first 15 carry fwCommentSeen from pass 1). The window must SLIDE:
    // the next batch of unseen comments surfaces, NOT a re-emit of pass 1.
    const second = adapter.extractPosts(toNodeList([item]));
    const secondComments = second.filter((p) => p.kind === 'top-comment');
    expect(secondComments.length).toBeGreaterThan(0); // not frozen at 0
    // No caption re-emit (fwCaptionEmitted gate).
    expect(second.filter((p) => p.kind === 'video')).toHaveLength(0);
    // The second batch is DISJOINT from the first — no comment scanned twice.
    for (const c of secondComments) {
      expect(firstTexts.has(c.text)).toBe(false);
    }

    // Across both passes the adapter has now surfaced all 25 comments
    // (15 + 10), proving the tail past the cap is no longer permanently
    // skipped.
    const seenAcrossBoth = new Set([
      ...firstComments.map((p) => p.text),
      ...secondComments.map((p) => p.text),
    ]);
    expect(seenAcrossBoth.size).toBe(25);
  });

  it('feedSource returns for-you on home', () => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.tiktok.com', pathname: '/' },
      writable: true,
      configurable: true,
    });
    const item = makeFeedItem({
      caption: 'A caption with enough characters to pass the thirty character minimum threshold',
      author: 'creator1',
    });
    const posts = adapter.extractPosts(toNodeList([item]));
    expect(posts[0].feedSource).toBe('for-you');
  });

  it('feedSource returns following on /following', () => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.tiktok.com', pathname: '/following' },
      writable: true,
      configurable: true,
    });
    const item = makeFeedItem({
      caption: 'A caption with enough characters to pass the thirty character minimum threshold',
      author: 'creator1',
    });
    const posts = adapter.extractPosts(toNodeList([item]));
    expect(posts[0].feedSource).toBe('following');
  });

  it('profile surface returns zero posts (Option B tile-surface short-circuit)', () => {
    // Per docs/history/archive/surfaces-2026-05-28/tiktok-refresh.md Option B: /@user is a
    // tile-grid surface (user-post-item × N, no inline captions in tiles)
    // and the adapter short-circuits extractPosts → [] for tile surfaces.
    // The destination permalink — reached when a kid clicks a tile — still
    // gets full extraction. Engagement-hider on the profile grid runs via
    // the platform-agnostic section-model finder (independent of adapter).
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.tiktok.com', pathname: '/@dancequeen' },
      writable: true,
      configurable: true,
    });
    const item = makeFeedItem({
      caption: 'A caption with enough characters to pass the thirty character minimum threshold',
      author: 'dancequeen',
    });
    const posts = adapter.extractPosts(toNodeList([item]));
    expect(posts).toHaveLength(0);
  });

  it('detectPlatform returns true on tiktok.com', () => {
    expect(adapter.detectPlatform()).toBe(true);
  });

  it('getPostSelector targets per-video containers', () => {
    // The post-selector dispatch routes the surface to its specific
    // selector (per docs/history/archive/surfaces-2026-05-28/tiktok-refresh.md). The
    // default test URL is /, so the foryou selector is returned. The
    // legacy [data-e2e="video-detail"] union element was retired (live
    // MCP probe 2026-05-28 confirmed 0 matches on modern permalinks).
    expect(adapter.getPostSelector()).toContain('recommend-list-item-container');
    expect(adapter.getPostSelector()).not.toContain('video-detail');
  });
});

// TT-2 (docs/audits/swarm-2026-07-13/03-platform-tiktok.md): extractIsTikTokSponsored
// used an unanchored `[data-e2e*="ad-"]` substring match plus a free-text
// language regex over the WHOLE container (which can include comments). Both
// halves can false-positive on organic content, and pipeline.ts:426 gates on
// is_sponsored with no mode check and no AI corroboration, so a false positive
// silently full-removes an organic video via display:none in every mode.
// These tests lock in exact-marker-only detection: the two documented real
// TikTok ad markers (`ad-tag`, `ad-link`) plus the live-mapped outbound-CTA
// marker (`ttam-ads-cta`, docs/spec/surfaces/tiktok.md:70) must still fire,
// while substring collisions and incidental vocabulary must not.
