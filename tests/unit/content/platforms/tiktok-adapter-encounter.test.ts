// @vitest-environment jsdom
//
// §CT-26g.3.1 — TikTok adapter Encounter-signal regression.
//
// Locks the §CT-26f-equivalent gaps closed for TikTok:
//   - kind: 'top-comment' (was 'comment') for level-1 bundle comments
//   - depth: 1, parent_id: videoId, parentVideoId: videoId
//   - platform_specific.tiktok.surfaceKind populated
//   - platform_specific.tiktok.metrics carried from bundle's likes
//   - encounter-builder routes TT to rich Encounter via assembleTikTokEncounter

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TiktokAdapter } from '../../../../src/content/platforms/tiktok';
import { buildEncounterForFlushBatch } from '../../../../src/content/record/encounter-builder';
import type { PostContent } from '../../../../src/types/post';

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

/** Append a TikTok comment row matching the current DOM into `parent`.
 *  The row carries a `DivCommentItemWrapper` class-substring; body lives in
 *  a `.TUXText.TUXText--tiktok-sans` span; username link is a sibling of
 *  the body inside the wrapper.  Mutates `parent` and returns the row. */
function appendTikTokRow(parent: Element, author: string, text: string): HTMLElement {
  const obj = document.createElement('div');
  obj.className = 'css-X-7937d88b--DivCommentObjectWrapper epprvxn10';
  const item = document.createElement('div');
  item.className = 'css-Y-7937d88b--DivCommentItemWrapper epprvxn0';
  const content = document.createElement('div');
  content.className = 'css-Z-7937d88b--DivCommentContentWrapper epprvxn2';
  const avatar = document.createElement('a');
  avatar.setAttribute('href', `/@${author}`);
  content.appendChild(avatar);
  const username = document.createElement('a');
  username.setAttribute('href', `/@${author}`);
  username.textContent = `@${author}`;
  content.appendChild(username);
  const wrap = document.createElement('span');
  const inner = document.createElement('span');
  inner.className = 'TUXText TUXText--tiktok-sans';
  inner.textContent = text;
  wrap.appendChild(inner);
  content.appendChild(wrap);
  item.appendChild(content);
  obj.appendChild(item);
  parent.appendChild(obj);
  return item;
}

/** Append a `DivCommentListContainer`-classed panel + return it. */
function appendCommentPanel(parent: Element): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'css-W-7937d88b--DivCommentListContainer epprvxn5';
  parent.appendChild(panel);
  return panel;
}

describe('§CT-26g.3.1 — detectTikTokSurface (via adapter behavior)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('feed surface for /foryou', () => {
    setLocation('https://www.tiktok.com/foryou');
    const root = mount(`
      <div data-e2e="recommend-list-item-container">
        <div data-e2e="video-desc">caption text here</div>
      </div>
    `);
    const videoCard = root.querySelector('[data-e2e="recommend-list-item-container"]')!;
    const panel = appendCommentPanel(videoCard);
    appendTikTokRow(panel, 'alice', 'nice video lmao');

    const adapter = new TiktokAdapter();
    const posts = adapter.extractPosts(root.childNodes);
    // First emitted = caption (kind='video'), then comments (kind='top-comment')
    const comments = posts.filter((p) => p.kind === 'top-comment');
    expect(comments.length).toBeGreaterThan(0);
    expect(comments[0].platform_specific?.platform).toBe('tiktok');
    if (comments[0].platform_specific?.platform === 'tiktok') {
      expect(comments[0].platform_specific.surfaceKind).toBe('tiktok-feed');
    }
  });

  it('permalink surface for /@user/video/123', () => {
    setLocation('https://www.tiktok.com/@somebody/video/7012345678901234567');
    // Modern TT permalink DOM uses recommend-list-item-container with
    // data-scroll-index="0" for the focused video. Per live MCP probe
    // 2026-05-28, [data-e2e="video-detail"] returns 0 matches and was
    // retired from the adapter selector dispatch.
    const root = mount(`
      <div data-e2e="recommend-list-item-container" data-scroll-index="0">
        <div data-e2e="video-desc">a permalink video</div>
      </div>
    `);
    const detail = root.querySelector('[data-e2e="recommend-list-item-container"]')!;
    const panel = appendCommentPanel(detail);
    appendTikTokRow(panel, 'bob', 'this is funny haha');

    const adapter = new TiktokAdapter();
    const posts = adapter.extractPosts(root.childNodes);
    const comments = posts.filter((p) => p.kind === 'top-comment');
    expect(comments.length).toBeGreaterThan(0);
    if (comments[0].platform_specific?.platform === 'tiktok') {
      expect(comments[0].platform_specific.surfaceKind).toBe('tiktok-permalink');
    }
  });
});

describe('§CT-26g.3.1 — TikTok adapter stamps Encounter signals on comments', () => {
  beforeEach(() => {
    setLocation('https://www.tiktok.com/foryou');
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('comments carry kind=top-comment, depth=1, parent_id=videoId, parentVideoId=videoId', () => {
    const root = mount(`
      <div data-e2e="recommend-list-item-container">
        <div data-e2e="video-desc">my caption text</div>
      </div>
    `);
    const card = root.querySelector('[data-e2e="recommend-list-item-container"]')!;
    const panel = appendCommentPanel(card);
    appendTikTokRow(panel, 'alice', 'i love this video');
    appendTikTokRow(panel, 'bob', 'hilarious lmao');

    const posts = new TiktokAdapter().extractPosts(root.childNodes);
    const comments = posts.filter((p) => p.kind === 'top-comment');
    expect(comments.length).toBe(2);
    for (const c of comments) {
      expect(c.kind).toBe('top-comment');
      expect(c.depth).toBe(1);
      expect(c.parent_id).toBeDefined();
      expect(c.parentVideoId).toBeDefined();
      // parent_id and parentVideoId should match (both = videoId)
      expect(c.parent_id).toBe(c.parentVideoId);
    }
  });

  it('comment platform_specific carries surfaceKind, commentLevel, metrics, flags', () => {
    const root = mount(`
      <div data-e2e="recommend-list-item-container">
        <div data-e2e="video-desc">x</div>
      </div>
    `);
    const card = root.querySelector('[data-e2e="recommend-list-item-container"]')!;
    const panel = appendCommentPanel(card);
    appendTikTokRow(panel, 'u', 'plain comment text');

    const posts = new TiktokAdapter().extractPosts(root.childNodes);
    const comment = posts.find((p) => p.kind === 'top-comment');
    expect(comment).toBeDefined();
    expect(comment!.platform_specific?.platform).toBe('tiktok');
    if (comment!.platform_specific?.platform === 'tiktok') {
      expect(comment!.platform_specific.surfaceKind).toBe('tiktok-feed');
      expect(comment!.platform_specific.commentLevel).toBe(1);
      expect(comment!.platform_specific.isCreator).toBe(false);
      expect(comment!.platform_specific.isPinned).toBe(false);
      expect(comment!.platform_specific.isCreatorHearted).toBe(false);
    }
  });

  it('detects "Pinned" flag from comment text', () => {
    const root = mount(`
      <div data-e2e="recommend-list-item-container">
        <div data-e2e="video-desc">x</div>
      </div>
    `);
    const card = root.querySelector('[data-e2e="recommend-list-item-container"]')!;
    const panel = appendCommentPanel(card);
    const row = appendTikTokRow(panel, 'u', 'this is pinned text');
    const pinned = document.createElement('span');
    pinned.textContent = 'Pinned';
    row.appendChild(pinned);

    const posts = new TiktokAdapter().extractPosts(root.childNodes);
    const comment = posts.find((p) => p.kind === 'top-comment');
    if (comment?.platform_specific?.platform === 'tiktok') {
      expect(comment.platform_specific.isPinned).toBe(true);
    }
  });

  it('detects RO "Fixat" flag', () => {
    const root = mount(`
      <div data-e2e="recommend-list-item-container">
        <div data-e2e="video-desc">x</div>
      </div>
    `);
    const card = root.querySelector('[data-e2e="recommend-list-item-container"]')!;
    const panel = appendCommentPanel(card);
    const row = appendTikTokRow(panel, 'u', 'romanian pinned comment');
    const fixat = document.createElement('span');
    fixat.textContent = 'Fixat';
    row.appendChild(fixat);

    const posts = new TiktokAdapter().extractPosts(root.childNodes);
    const comment = posts.find((p) => p.kind === 'top-comment');
    if (comment?.platform_specific?.platform === 'tiktok') {
      expect(comment.platform_specific.isPinned).toBe(true);
    }
  });
});

describe('§CT-26g.3.1 — encounter-builder routes TikTok to assembleTikTokEncounter', () => {
  beforeEach(() => {
    setLocation('https://www.tiktok.com/foryou');
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  function makeTikTokChild(overrides: Partial<PostContent>): PostContent {
    return {
      id: 'tk-c1',
      text: 'sample comment',
      author: '@alice',
      timestamp: '2026-05-05T00:00:00.000Z',
      platform: 'tiktok',
      domRef: new WeakRef({} as HTMLElement),
      kind: 'top-comment',
      depth: 1,
      parent_id: 'video-1',
      parentVideoId: 'video-1',
      platform_specific: {
        platform: 'tiktok',
        surfaceKind: 'tiktok-feed',
        commentLevel: 1,
        metrics: { likes: 42, reply_count: 3 },
        isCreator: false,
        isPinned: false,
        isCreatorHearted: false,
      },
      ...overrides,
    };
  }

  it('builds rich TikTok Encounter with surface, post, children, metrics carried from platform_specific', () => {
    const child1 = makeTikTokChild({ id: 'tk-1', text: 'first comment' });
    const child2 = makeTikTokChild({
      id: 'tk-2',
      text: 'second comment',
      author: '@bob',
      platform_specific: {
        platform: 'tiktok',
        surfaceKind: 'tiktok-feed',
        commentLevel: 1,
        metrics: { likes: 100, reply_count: 12 },
        isCreator: true,
        isPinned: true,
        isCreatorHearted: false,
      },
    });

    const enc = buildEncounterForFlushBatch(
      [child1, child2],
      'this is the video caption',
      'English',
    );

    // Surface: tiktok-feed
    expect(enc.platform).toBe('tiktok');
    if (enc.surface.kind === 'tiktok-feed') {
      expect(enc.surface.video_id).toBe('video-1');
      expect(enc.surface.comment_panel_open).toBe(true);
    } else {
      throw new Error(`expected tiktok-feed surface, got ${enc.surface.kind}`);
    }

    // Post: caption text + video kind + creator flag
    expect(enc.post.kind).toBe('video');
    expect(enc.post.text).toBe('this is the video caption');
    expect(enc.post.author.is_creator).toBe(true);

    // Ancestors: empty for TikTok
    expect(enc.ancestors).toEqual([]);

    // Children: 2 comments with metrics + flags carried over
    expect(enc.children).toHaveLength(2);
    expect(enc.children[0].depth).toBe(1);
    expect(enc.children[0].kind).toBe('top-comment');
    expect(enc.children[0].text).toBe('first comment');
    expect(enc.children[0].metrics.likes).toBe(42);
    expect(enc.children[0].metrics.reply_count).toBe(3);
    expect(enc.children[0].author.is_pinned_by_creator).toBe(false);

    expect(enc.children[1].metrics.likes).toBe(100);
    expect(enc.children[1].author.is_pinned_by_creator).toBe(true);

    // Output language threaded through
    expect(enc.output_language).toBe('English');
  });

  it('routes tiktok-permalink surface correctly', () => {
    const child = makeTikTokChild({
      platform_specific: {
        platform: 'tiktok',
        surfaceKind: 'tiktok-permalink',
        commentLevel: 1,
      },
    });
    const enc = buildEncounterForFlushBatch([child], 'caption', 'Romanian');
    if (enc.surface.kind === 'tiktok-permalink') {
      expect(enc.surface.video_id).toBe('video-1');
    } else {
      throw new Error(`expected tiktok-permalink surface, got ${enc.surface.kind}`);
    }
  });

  it('falls back to legacy when surfaceKind is missing on platform_specific', () => {
    const child: PostContent = {
      id: 'tk-1',
      text: 'comment',
      author: '@a',
      timestamp: '2026-05-05T00:00:00.000Z',
      platform: 'tiktok',
      domRef: new WeakRef({} as HTMLElement),
      kind: 'comment',
    };
    const enc = buildEncounterForFlushBatch([child], 'caption', 'English');
    expect(enc.ancestors).toEqual([]);
    expect(enc.post.text).toBe('caption');
  });
});

describe('TT comment sourceUrl (reported comment regression)', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => { document.body.innerHTML = ''; });

  it('bundle path: comment sourceUrl = location.href on permalink', () => {
    setLocation('https://www.tiktok.com/@vlogger/video/7012345678901234567');
    const root = document.createElement('div');
    const detail = document.createElement('div');
    // Modern TT permalink: recommend-list-item-container at scroll-index 0.
    detail.setAttribute('data-e2e', 'recommend-list-item-container');
    detail.setAttribute('data-scroll-index', '0');
    const desc = document.createElement('div');
    desc.setAttribute('data-e2e', 'video-desc');
    desc.textContent = 'caption text here';
    detail.appendChild(desc);
    root.appendChild(detail);
    document.body.appendChild(root);
    const panel = appendCommentPanel(detail);
    appendTikTokRow(panel, 'bob', 'this is funny haha');

    const posts = new TiktokAdapter().extractPosts(root.childNodes);
    const comments = posts.filter((p) => p.kind === 'top-comment');
    expect(comments.length).toBeGreaterThan(0);
    expect(comments[0].sourceUrl).toBe(
      'https://www.tiktok.com/@vlogger/video/7012345678901234567',
    );
    // TikTok exposes no stable per-comment permalink (the cid lives only in
    // the share popover, never on the row DOM). anchorUrl stays undefined →
    // the export falls back to the parent video URL.
    expect(comments[0].anchorUrl).toBeUndefined();
  });

  it('bundle path: comment sourceUrl built from /video/ anchor on FYP', () => {
    setLocation('https://www.tiktok.com/foryou');
    const root = document.createElement('div');
    const card = document.createElement('div');
    card.setAttribute('data-e2e', 'recommend-list-item-container');
    const desc = document.createElement('div');
    desc.setAttribute('data-e2e', 'video-desc');
    desc.textContent = 'my caption text';
    card.appendChild(desc);
    const videoLink = document.createElement('a');
    videoLink.setAttribute('href', '/@creator/video/7099887766554433221');
    videoLink.textContent = 'view';
    card.appendChild(videoLink);
    root.appendChild(card);
    document.body.appendChild(root);
    const panel = appendCommentPanel(card);
    appendTikTokRow(panel, 'alice', 'i love this video');

    const posts = new TiktokAdapter().extractPosts(root.childNodes);
    const comments = posts.filter((p) => p.kind === 'top-comment');
    expect(comments.length).toBeGreaterThan(0);
    expect(comments[0].sourceUrl).toBe(
      'https://www.tiktok.com/@creator/video/7099887766554433221',
    );
  });

  it('all comments under one video share the same sourceUrl', () => {
    setLocation('https://www.tiktok.com/@vlogger/video/7012345678901234567');
    const root = document.createElement('div');
    const detail = document.createElement('div');
    // Modern TT permalink: recommend-list-item-container at scroll-index 0.
    detail.setAttribute('data-e2e', 'recommend-list-item-container');
    detail.setAttribute('data-scroll-index', '0');
    const desc = document.createElement('div');
    desc.setAttribute('data-e2e', 'video-desc');
    desc.textContent = 'caption text here';
    detail.appendChild(desc);
    root.appendChild(detail);
    document.body.appendChild(root);
    const panel = appendCommentPanel(detail);
    appendTikTokRow(panel, 'a', 'comment one body');
    appendTikTokRow(panel, 'b', 'comment two body');
    appendTikTokRow(panel, 'c', 'comment three body');

    const posts = new TiktokAdapter().extractPosts(root.childNodes);
    const comments = posts.filter((p) => p.kind === 'top-comment');
    expect(comments.length).toBe(3);
    const urls = new Set(comments.map((c) => c.sourceUrl));
    expect(urls.size).toBe(1);
    expect(urls.has('https://www.tiktok.com/@vlogger/video/7012345678901234567')).toBe(true);
  });
});
