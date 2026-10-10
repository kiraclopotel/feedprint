/** @vitest-environment jsdom */
// G1.7 — TikTok extractTikTokBundle caption-extraction tests.
//
// Per .brain/PHASE7_PLATFORM_RECON.md + Phase 7 MCP recon: the For You feed
// container (`[data-e2e="recommend-list-item-container"]`) renders the
// caption as multiple `data-e2e="desc-span-{group}_{idx}"` children INSIDE
// `data-e2e="video-desc"`. On initial container mount the outer video-desc
// element may not be queryable yet (React lazy-hydrate). Pre-G1.7 the
// extractor returned null in that window and never re-tried, so 5 of 8
// containers per scroll tick produced 0 posts.
//
// Fix added at src/content/platforms/tiktok-bundle.ts:120-162: when
// video-desc isn't queryable, aggregate the desc-span-* children directly.
// These tests verify each branch of the fallback chain and the back-compat
// branch (canonical video-desc still works for detail pages and for
// fully-hydrated For You containers).

import { describe, it, expect, beforeEach } from 'vitest';
import {
  extractTikTokBundle,
  resolveTikTokCommentSearchScope,
} from '../../../../src/content/platforms/tiktok-bundle';

function buildContainerWithVideoDesc(captionText: string, author = 'sebasxcapcut'): HTMLElement {
  const container = document.createElement('div');
  container.setAttribute('data-e2e', 'recommend-list-item-container');
  // Author link — extractAuthor falls back to a[href^="/@"].
  const authorLink = document.createElement('a');
  authorLink.setAttribute('href', `/@${author}`);
  authorLink.textContent = author;
  container.appendChild(authorLink);
  // Canonical video-desc (fully-hydrated state).
  const videoDesc = document.createElement('div');
  videoDesc.setAttribute('data-e2e', 'video-desc');
  videoDesc.textContent = captionText;
  container.appendChild(videoDesc);
  return container;
}

function buildContainerWithDescSpansOnly(captionParts: string[], author = 'sebasxcapcut'): HTMLElement {
  // Reproduces the lazy-hydrate window where video-desc is NOT queryable
  // yet but the desc-span-* children already are. Phase 7 recon observed
  // this exact shape on /foryou containers above the fold.
  const container = document.createElement('div');
  container.setAttribute('data-e2e', 'recommend-list-item-container');
  const authorLink = document.createElement('a');
  authorLink.setAttribute('href', `/@${author}`);
  authorLink.textContent = author;
  container.appendChild(authorLink);
  // No outer video-desc. Just the desc-span-* siblings inside a parent div.
  const descParent = document.createElement('div');
  captionParts.forEach((part, idx) => {
    const span = document.createElement('span');
    span.setAttribute('data-e2e', `desc-span-0_${idx}`);
    span.textContent = part;
    descParent.appendChild(span);
  });
  container.appendChild(descParent);
  return container;
}

function buildContainerEmpty(): HTMLElement {
  // Pre-hydrate placeholder — only feed-video child, no caption surface.
  // Phase 7 recon: this was the dominant shape for above-the-fold
  // containers ("childKeys": ["feed-video"]).
  const container = document.createElement('div');
  container.setAttribute('data-e2e', 'recommend-list-item-container');
  const feedVideo = document.createElement('div');
  feedVideo.setAttribute('data-e2e', 'feed-video');
  container.appendChild(feedVideo);
  return container;
}

describe('G1.7 — extractTikTokBundle fallback chain', () => {
  it('uses the verified FYP xgplayer wrapper suffix as the video id', () => {
    const container = buildContainerWithVideoDesc(
      'A caption long enough to produce a complete TikTok bundle snapshot',
      'example_creator',
    );
    const wrapper = document.createElement('div');
    wrapper.id = 'xgwrapper-0-7900000000000000014';
    container.appendChild(wrapper);

    const result = extractTikTokBundle(container);
    expect(result.snapshot?.post.id).toBe('7900000000000000014');
    expect(result.snapshot?.post.source_url).toContain('/video/7900000000000000014');
  });

  it('does not bind a snapshot to malformed or conflicting xgplayer wrappers', () => {
    const container = buildContainerWithVideoDesc(
      'A caption long enough to produce a complete TikTok bundle snapshot',
      'example_creator',
    );
    for (const id of [
      'xgwrapper-0-123',
      'xgwrapper-1-7900000000000000014',
      'xgwrapper-2-7900000000000000015',
    ]) {
      const wrapper = document.createElement('div');
      wrapper.id = id;
      container.appendChild(wrapper);
    }

    const result = extractTikTokBundle(container);
    expect(result.snapshot?.post.id).not.toBe('7900000000000000014');
    expect(result.snapshot?.post.id).not.toBe('7900000000000000015');
  });

  it('keeps a same-card video permalink authoritative over the wrapper fallback', () => {
    const container = buildContainerWithVideoDesc(
      'A caption long enough to produce a complete TikTok bundle snapshot',
      'example_creator',
    );
    const link = document.createElement('a');
    link.href = '/@example_creator/video/7900000000000000014';
    const wrapper = document.createElement('div');
    wrapper.id = 'xgwrapper-0-7900000000000000015';
    container.append(link, wrapper);

    expect(extractTikTokBundle(container).snapshot?.post.id).toBe('7900000000000000014');
  });

  it('canonical video-desc path still works (back-compat)', () => {
    const container = buildContainerWithVideoDesc(
      '#CapCut #pioneertemplate Nueva Plantilla :)',
    );
    const result = extractTikTokBundle(container);
    expect(result.snapshot).not.toBeNull();
    expect(result.snapshot?.post.text).toContain('CapCut');
    expect(result.snapshot?.post.text).toContain('Nueva Plantilla');
  });

  it('desc-span-* fallback fires when video-desc is not queryable (lazy-hydrate window)', () => {
    // The G1.7 scenario: container hydrated to the point of having desc-span-*
    // children but the outer video-desc element isn't queryable yet.
    const container = buildContainerWithDescSpansOnly([
      'Bananita este înșelată și revine cu un glow up',
      '#fyp',
      '#romania',
    ]);
    const result = extractTikTokBundle(container);
    expect(result.snapshot).not.toBeNull();
    expect(result.snapshot?.post.text).toContain('Bananita');
    expect(result.snapshot?.post.text).toContain('#fyp');
    expect(result.snapshot?.post.text).toContain('#romania');
  });

  it('falls back to the URL path owner for author on a profile page (no trailing slash)', () => {
    // Regression: with no author element in the container, the only author
    // source is the URL. A bare profile path (`/@handle`, no trailing slash)
    // must resolve — pre-fix it didn't, and every profile-feed video stamped
    // author='unknown', denormalizing roomAuthor='unknown' onto its comments.
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.tiktok.com', pathname: '/@example_profile' },
      writable: true,
      configurable: true,
    });
    // Bare container: caption only, deliberately NO author anchor — a DOM
    // author must keep winning over the URL (see the back-compat test above).
    const container = document.createElement('div');
    const desc = document.createElement('div');
    desc.setAttribute('data-e2e', 'video-desc');
    desc.textContent = 'A caption long enough to extract from a profile video';
    container.appendChild(desc);
    const result = extractTikTokBundle(container);
    expect(result.snapshot).not.toBeNull();
    expect(result.snapshot?.post.author).toBe('example_profile');
  });

  it('returns null with `post-desc:not-found` warning when no caption surface present', () => {
    // Pre-hydrate placeholder. Periodic rescan should re-try this container
    // on the next interceptor tick once it populates.
    const container = buildContainerEmpty();
    const result = extractTikTokBundle(container);
    expect(result.snapshot).toBeNull();
    expect(result.warnings).toContain('post-desc:not-found');
  });

  it('canonical video-desc with empty text logs `post-desc:empty` (distinct from not-found)', () => {
    // Distinguishes "we found the desc element but it had no text" from
    // "we couldn't even find a desc surface". Useful for telemetry.
    const container = buildContainerWithVideoDesc('');
    const result = extractTikTokBundle(container);
    expect(result.snapshot).toBeNull();
    expect(result.warnings).toContain('post-desc:empty');
  });

  it('desc-span-* aggregation joins parts with single spaces', () => {
    // The fix joins parts with ' '. Verifies no double-spaces, no trailing
    // whitespace, no missing spaces between parts.
    const container = buildContainerWithDescSpansOnly(['hello', 'world', '#tag']);
    const result = extractTikTokBundle(container);
    expect(result.snapshot?.post.text).toBe('hello world #tag');
  });

  it('desc-span-* with empty children is treated as no caption (post-desc:not-found)', () => {
    // Edge case: spans exist but are all empty strings. Should NOT emit a
    // record with empty text — that would feed empty text to the LLM.
    const container = buildContainerWithDescSpansOnly(['', '', '']);
    const result = extractTikTokBundle(container);
    expect(result.snapshot).toBeNull();
    expect(result.warnings).toContain('post-desc:not-found');
  });

  it('Romanian caption via desc-span-* is preserved (no transcoding regression)', () => {
    // Bilingual sanity. Romanian diacritics (ă, î, ș, ț, â) must round-trip
    // through aggregation unchanged so the language detector + RO few-shots
    // path can fire on the LLM side.
    const container = buildContainerWithDescSpansOnly([
      'Să fii iubitul meu e ca și cum ai fi cumpărat Bitcoin în 2016',
      '#romania',
    ]);
    const result = extractTikTokBundle(container);
    expect(result.snapshot?.post.text).toContain('Să');
    expect(result.snapshot?.post.text).toContain('cumpărat');
    expect(result.snapshot?.post.text).toContain('în 2016');
  });
});

// ── L0-A sticker placeholder handling ───────────────────────────────────────
// Build a permalink-shaped container with a video-desc post + a comment panel
// (DivCommentListContainer) whose rows are DivCommentItemWrapper divs holding
// a profile link + a TUXText body span — the shape extractCommentsFromRowNodes
// keys on (findTikTokRowBodyEl picks the longest TUXText span).
function buildContainerWithComments(
  caption: string,
  comments: { author: string; text: string }[],
): HTMLElement {
  const container = document.createElement('div');
  container.setAttribute('data-e2e', 'recommend-list-item-container');
  const authorLink = document.createElement('a');
  authorLink.setAttribute('href', '/@videocreator');
  authorLink.textContent = 'videocreator';
  container.appendChild(authorLink);
  const videoDesc = document.createElement('div');
  videoDesc.setAttribute('data-e2e', 'video-desc');
  videoDesc.textContent = caption;
  container.appendChild(videoDesc);

  const panel = document.createElement('div');
  panel.className = 'css-1-DivCommentListContainer e1';
  for (const c of comments) {
    const row = document.createElement('div');
    row.className = 'css-2-DivCommentItemWrapper e2';
    const cAuthor = document.createElement('a');
    cAuthor.setAttribute('href', `/@${c.author}`);
    cAuthor.textContent = c.author;
    row.appendChild(cAuthor);
    const body = document.createElement('span');
    body.className = 'TUXText TUXText--weight-normal';
    body.textContent = c.text;
    row.appendChild(body);
    panel.appendChild(row);
  }
  container.appendChild(panel);
  return container;
}

describe('extractTikTokBundle — sticker placeholder handling (L0-A)', () => {
  it('drops a sticker-only comment from the snapshot', () => {
    const c = buildContainerWithComments('a real caption with several words', [
      { author: 'aa', text: '[Sticker]' },
      { author: 'bb', text: 'this is a genuine comment with words' },
    ]);
    const { snapshot } = extractTikTokBundle(c);
    expect(snapshot).not.toBeNull();
    const texts = snapshot!.comments.map((x) => x.text);
    expect(texts).toContain('this is a genuine comment with words');
    expect(texts).not.toContain('[Sticker]');
  });

  it('strips the placeholder but keeps trailing text (found: "[Sticker] Pentru voi")', () => {
    const c = buildContainerWithComments('a real caption with several words', [
      { author: 'aa', text: '[Sticker] Pentru voi acest mesaj frumos' },
    ]);
    const { snapshot } = extractTikTokBundle(c);
    const match = snapshot!.comments.find((x) => x.text.includes('Pentru voi'));
    expect(match).toBeDefined();
    expect(match!.text).toBe('Pentru voi acest mesaj frumos');
  });

  it('reads the comment author from the profile link\'s href, not its visible text: a real record\'s row showed a display name there, not a handle', () => {
    const c = buildContainerWithComments('a real caption with several words', []);
    const panel = c.querySelector('.css-1-DivCommentListContainer')!;
    const row = document.createElement('div');
    row.className = 'css-2-DivCommentItemWrapper e2';
    const cAuthor = document.createElement('a');
    cAuthor.setAttribute('href', '/@samplechannelname');
    cAuthor.textContent = 'Sample Channel Name';
    row.appendChild(cAuthor);
    const body = document.createElement('span');
    body.className = 'TUXText TUXText--weight-normal';
    body.textContent = 'a genuine comment under a display-name row';
    row.appendChild(body);
    panel.appendChild(row);
    const { snapshot } = extractTikTokBundle(c);
    const match = snapshot!.comments.find((x) => x.text.includes('a genuine comment'));
    expect(match).toBeDefined();
    expect(match!.author).toBe('samplechannelname');
    expect(match!.author).not.toContain(' ');
  });

  it('strips a non-Latin sticker token (zh) and keeps the real words', () => {
    const c = buildContainerWithComments('a real caption with several words', [
      { author: 'aa', text: '[贴纸] keep these words please' },
    ]);
    const { snapshot } = extractTikTokBundle(c);
    const match = snapshot!.comments.find((x) => x.text.includes('keep these words'));
    expect(match).toBeDefined();
    expect(match!.text).toBe('keep these words please');
  });
});

// ── TT-1 (2026-07-13 swarm audit) — chat-overlay exclusion parity ──────────
// `resolveTikTokCommentSearchScope` (the snapshot/LLM/forensic-record path's
// panel resolver) previously picked whichever `DivCommentListContainer` was
// FIRST in document order with no exclusion for a private chat/DM overlay —
// unlike its sibling `resolvePublicTikTokCommentSearchScope` in
// `platforms/tiktok.ts`, which was written specifically to skip a chat
// dialog's panel. If a DM overlay's panel happened to sit earlier in the
// DOM than the real video's comment panel, the bundle extractor would read
// (and could ship to the LLM / forensic record) private chat text instead
// of public comments. Fixed by reusing the shared `findChatOverlayAncestor`
// primitive (`platforms/adapter.ts`) so both resolvers apply the identical
// exclusion.
function permalinkVideoContainer(caption: string, author = 'videocreator'): HTMLElement {
  const container = document.createElement('div');
  container.setAttribute('data-e2e', 'video-detail');
  const authorLink = document.createElement('a');
  authorLink.setAttribute('href', `/@${author}`);
  authorLink.textContent = author;
  container.appendChild(authorLink);
  const videoDesc = document.createElement('div');
  videoDesc.setAttribute('data-e2e', 'video-desc');
  videoDesc.textContent = caption;
  container.appendChild(videoDesc);
  return container;
}

function siblingCommentPanel(rows: { author: string; text: string }[]): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'css-1-DivCommentListContainer e1';
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'css-2-DivCommentItemWrapper e2';
    const a = document.createElement('a');
    a.setAttribute('href', `/@${r.author}`);
    a.textContent = r.author;
    row.appendChild(a);
    const body = document.createElement('span');
    body.className = 'TUXText TUXText--weight-normal';
    body.textContent = r.text;
    row.appendChild(body);
    panel.appendChild(row);
  }
  return panel;
}

function chatOverlayCommentPanel(rows: { author: string; text: string }[]): HTMLElement {
  // Same DivCommentListContainer/DivCommentItemWrapper shape as a real video
  // comment panel, but nested inside a [role="dialog"] chat-overlay dialog —
  // matches the aria-label markers `findChatOverlayAncestor` recognizes.
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'Chat with Example Contact');
  dialog.appendChild(siblingCommentPanel(rows));
  return dialog;
}

describe('TT-1 — resolveTikTokCommentSearchScope excludes chat overlays', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('never returns a chat-overlay panel, even when it precedes the real panel in DOM order', () => {
    const container = permalinkVideoContainer('a real caption with several words');
    const chat = chatOverlayCommentPanel([
      { author: 'dmfriend', text: 'a private DM that must never enter a public record' },
    ]);
    const real = siblingCommentPanel([
      { author: 'viewer1', text: 'a genuine public comment' },
    ]);
    // Chat overlay appended FIRST — an unguarded document.querySelector(s)
    // over TT_COMMENT_PANEL_SELECTOR would return the chat panel here.
    document.body.append(container, chat, real);

    const realPanel = real;
    expect(resolveTikTokCommentSearchScope(container)).toBe(realPanel);
  });

  it('extractTikTokBundle never surfaces chat-overlay comment text, even when the overlay is first in DOM order', () => {
    const container = permalinkVideoContainer('a real caption with several words');
    const chat = chatOverlayCommentPanel([
      { author: 'dmfriend', text: 'a private DM that must never enter a public record' },
    ]);
    const real = siblingCommentPanel([
      { author: 'viewer1', text: 'a genuine public comment' },
    ]);
    document.body.append(container, chat, real);

    const { snapshot } = extractTikTokBundle(container);
    const texts = snapshot!.comments.map((c) => c.text);
    expect(texts).toContain('a genuine public comment');
    expect(texts).not.toContain('a private DM that must never enter a public record');
  });

  it('still resolves the real panel when no chat overlay is present (no regression)', () => {
    const container = permalinkVideoContainer('a real caption with several words');
    const real = siblingCommentPanel([{ author: 'viewer1', text: 'a genuine public comment' }]);
    document.body.append(container, real);

    expect(resolveTikTokCommentSearchScope(container)).toBe(real);
  });
});
