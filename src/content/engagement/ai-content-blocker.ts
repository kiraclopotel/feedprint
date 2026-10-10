// FeelingWise — rule-based AI-content blocker.
//
// Source finding: a dangerous trend was found on TikTok, hyperreal AI
// fruits shown in scary / vulgar scenarios, tagged with hashtags like
// '#fruitdrama #ai #aifruit'. The feature request that followed: block
// '#Ai'-style hashtags, let parents add their own blocked hashtags, and
// when a video's poster has those hashtags, block the video and record
// the channel; also block anything carrying the marker 'Conține materiale
// generate de IA', regardless of language.
//
// What this module does:
//   1. Walks every per-platform video container.
//   2. Extracts the caption text, then checks two independent rules:
//      a. Hashtag match — caption contains a `#hashtag` (case-insensitive)
//         that appears in the parent's blocklist.
//      b. AI-label match — anywhere in the container's textContent there
//         is a multi-language "AI-generated content" marker (TikTok, IG,
//         YouTube, etc. all surface a UI badge with a localized variant).
//   3. On match: hide the container + stamp `data-fw-blocked="ai-content"`
//      + `data-fw-block-reason=...` + `dataset.fwProcessed = "true"` so
//      the platform adapter (and pipeline) skip it. Tokens NOT spent on
//      a video the parent has already said no to.
//   4. Logs a forensic record via `logBlockedEvent` so the parent
//      dashboard captures: which channel, which trigger, which token,
//      what caption, when. Same chain as detection records.
//
// Scope (all platforms, to be verified in practice):
//   tiktok, instagram, youtube, twitter, facebook. Each platform has
//   its own descriptor below — selectors are best-effort and can drift
//   when the platform rotates DOM, but the cost of a miss is the parent
//   sees one un-blocked AI video, not a feed-wide failure.
//
// Discipline:
//   • Pure DOM mutations. No LLM call, no network, no chrome.storage
//     write per-tick (settings + blocklist are read once at start).
//   • Re-init on settings change is handled by the engagement controller's
//     storage listener; we don't subscribe ourselves.
//   • The hide is silent. No placeholder card, per a standing decision to
//     keep curiosity-bait off the feed. The blocked video simply vanishes.

import type { FWSettings, BlockAiContentValue } from '../../storage/settings';
import { isFeatureEnabled, getFeatureValue } from '../../storage/settings';
import { countHiddenFor, hideElement } from './mark-hidden';
import { registerHeapGauge } from '../../diagnostics/diagnostics';
import type { Platform } from '../../types/post';
import { sharedSurfaceDetector, type SurfaceDescriptor } from '../post-path/surface-detector';
import {
  afterFeedItemHidden,
  snapshotCommentPanel,
  snapshotWatched,
  videoFeedItemOf,
} from '../protection/video-feed-hide';
import { resolveUiLanguage } from '../../i18n';
// logBlockedEvent moved to SW realm via the
// BLOCKED_LOG message handler. Direct in-realm call would bypass the SW
// chain-write lock and race with logForensicEvent / logPassEvent /
// logEnvironmentEvent (which all run in the SW). The content-script realm
// instantiated its own separate lock, so cross-realm parallel writes still
// produced duplicate chainPositions. Routing through SW puts every chain
// write under the same lock.
import type { BlockedEventInput } from '../../types/logger-events';
import { decisionForBlock } from '../record/decision';
import { buildConfigSnapshot } from '../record/config-snapshot';
import { currentPageAddress } from '../record/post-url';
import { MANIPULATION_SEVERITY_THRESHOLD } from '../../core/severity-floor';
// Route BLOCKED_LOG through the high-stakes retry helper, which uses the
// context guard internally. The prior per-call try/catch around sendMessage
// emitted a console.warn for every failed dispatch, which surfaced as N
// repeated entries in the chrome://extensions Errors panel each time the
// extension was reloaded with old TikTok tabs still alive. The context guard
// flips a single contextValid flag on first context death and becomes a
// silent no-op afterwards, so the Errors panel sees one notice instead of N.
import { recordBlocked } from './recorder-sink';
import { createRafBodyObserver, trailingThrottle } from '../post-path/raf-observer';
import { ensureStyleTag, removeStyleTag } from './style-tag';
import { isInPrivateChatSubtree } from '../platforms/adapter';

const BLOCKED_MARKER = 'data-fw-blocked';
const BLOCK_REASON_MARKER = 'data-fw-block-reason';
const STYLE_TAG_ID = 'fw-ai-content-blocker-css';
const NAV_POLL_MS = 1000;
const RESCAN_DEBOUNCE_MS = 300;

// ─── Multi-language "AI-generated" markers ────────────────────────────────
//
// Platforms display a small label / badge near the post when content was
// AI-generated. TikTok, Instagram, YouTube all do this in the user's UI
// language. We match against the lowercased container.textContent. False-
// positive risk is acceptable — the parent has explicitly opted into rule-
// based blocking and the trade is "occasional over-block of a benign post
// discussing AI" vs "letting the trend through". Same trade-off the
// existing sticker-placeholder hider makes ([tiktok-engagement.ts:198]).
//
// Tokens are LOWERCASE. Compared against haystack.toLowerCase().
const AI_LABEL_TOKENS: { lang: string; token: string }[] = [
  // English (TikTok / IG / YouTube canonical strings)
  // Instagram's actual permalink label is "Contains AI-generated media"
  // (hyphenated, noun=media). Without these variants the IG /p/ + /reels/
  // surface, confirmed in a screenshot of a live creator account, 2026-05-22,
  // showed AI fruits despite the blocker setting being ON.
  { lang: 'en', token: 'contains ai-generated' },
  { lang: 'en', token: 'contains ai generated' },
  { lang: 'en', token: 'ai-generated media' },
  { lang: 'en', token: 'ai-generated content' },
  { lang: 'en', token: 'ai-generated audio' },
  { lang: 'en', token: 'ai generated content' },
  { lang: 'en', token: 'generated by ai' },
  { lang: 'en', token: 'created with ai' },
  { lang: 'en', token: 'created using ai' },
  { lang: 'en', token: 'made with ai' },
  { lang: 'en', token: 'ai generated' },
  // IG's AI-persona account badge, rendered under the username in the actor
  // row ("AI creator", live-attested 2026-08-11 on a creator account
  // via MCP inspection). An AI persona's posts are AI content by
  // definition, so the badge is a valid block signal.
  { lang: 'en', token: 'ai creator' },
  // Romanian, the primary userbase for this feature. The exact TikTok string found in the trend.
  { lang: 'ro', token: 'conține materiale generate de ia' },
  { lang: 'ro', token: 'materiale generate de ia' },
  { lang: 'ro', token: 'generat de ia' },
  { lang: 'ro', token: 'conținut generat de ia' },
  // Spanish
  { lang: 'es', token: 'contenido generado por ia' },
  { lang: 'es', token: 'generado por ia' },
  { lang: 'es', token: 'generado con ia' },
  // French
  { lang: 'fr', token: 'contenu généré par ia' },
  { lang: 'fr', token: 'généré par ia' },
  // Portuguese
  { lang: 'pt', token: 'conteúdo gerado por ia' },
  { lang: 'pt', token: 'gerado por ia' },
  // Italian
  { lang: 'it', token: 'contenuto generato da ia' },
  { lang: 'it', token: 'generato da ia' },
  // German (KI = Künstliche Intelligenz)
  { lang: 'de', token: 'ki-generierter inhalt' },
  { lang: 'de', token: 'mit ki erstellt' },
  { lang: 'de', token: 'generiert von ki' },
  // Polish
  { lang: 'pl', token: 'treść wygenerowana przez ai' },
  { lang: 'pl', token: 'wygenerowane przez ai' },
  // Russian (cyrillic — already lowercase form)
  { lang: 'ru', token: 'сгенерировано ии' },
  { lang: 'ru', token: 'создано ии' },
  // Japanese / Korean / Chinese — these scripts have no upper/lower so
  // .toLowerCase() is a no-op. Tokens kept as-is.
  { lang: 'ja', token: 'ai生成コンテンツ' },
  { lang: 'ja', token: 'aiで生成' },
  { lang: 'ko', token: 'ai 생성 콘텐츠' },
  { lang: 'ko', token: 'ai로 생성' },
  { lang: 'zh', token: 'ai生成内容' },
  { lang: 'zh', token: 'ai生成' },
];

// ─── Per-platform extractors (consumer-specific selectors) ─────────────────
//
// SurfaceDescriptor (shared registry) carries platform / surface / URL /
// container selectors. The blocker also needs caption / author / url
// selectors for forensic-record extraction — those are blocker-specific
// and live in this table, keyed by platform. One entry per platform; a
// platform's surfaces share extraction selectors because the AI-label rule
// scans full container.textContent and the hashtag rule has a full-text
// fallback, so the same caption/author selectors work across surfaces.

interface PlatformExtractors {
  /** Selector(s) for the caption text within the container. First match wins. */
  caption: string[];
  /** Selector(s) for the author handle within the container. First match wins. */
  author: string[];
  /** Selector for the canonical permalink anchor (best-effort). */
  url?: string;
}

const PLATFORM_EXTRACTORS: Partial<Record<Platform, PlatformExtractors>> = {
  tiktok: {
    caption: ['[data-e2e="video-desc"]', '[data-e2e="browse-video-desc"]'],
    author: ['[data-e2e="video-author-uniqueid"]', '[data-e2e="browse-username"]'],
    url: 'a[href*="/video/"]',
  },
  instagram: {
    // Instagram reels + feed posts both render as `article`. The caption
    // lives in a sibling of the media; we walk every `[dir="auto"]` and
    // pick the longest as the caption (mirrors the platform adapter's
    // structural-pattern approach, since IG class names are obfuscated).
    caption: ['h1', '[dir="auto"]'],
    author: ['header a[role="link"]', 'header a[href^="/"]'],
    url: 'a[href*="/reel/"], a[href*="/p/"]',
  },
  youtube: {
    caption: [
      '#title yt-formatted-string',
      'h2 yt-formatted-string',
      '#description-inline-expander',
      'yt-formatted-string#content',
    ],
    author: [
      'ytd-channel-name a',
      '#channel-name a',
      '#text.ytd-channel-name a',
    ],
    url: 'a#thumbnail, a[href*="/shorts/"], a[href*="/watch?"]',
  },
  twitter: {
    caption: ['[data-testid="tweetText"]'],
    author: ['[data-testid="User-Name"] a', '[data-testid="User-Names"] a'],
    url: 'a[href*="/status/"]',
  },
  facebook: {
    caption: [
      '[data-ad-comet-preview="message"]',
      '[data-ad-preview="message"]',
      '[dir="auto"]',
    ],
    author: ['h3 a[role="link"]', 'h4 a[role="link"]', 'strong a[role="link"]'],
    url: 'a[role="link"][href*="/posts/"], a[role="link"][href*="/videos/"], a[role="link"][href*="/reel/"]',
  },
};

// ─── Shared SurfaceDescriptor registrations ────────────────────────────────
//
// Always-on surface (pathnamePattern: null) per platform — covers the
// existing per-platform container walk. Plus URL-gated surfaces for
// YT-Shorts overlay, FB search wrappers, IG explore tiles where the
// always-on selectors leave gaps. Registration is module-load idempotent:
// the `try` block tolerates re-imports (HMR / test rebuilds) where the same
// id has already been registered.

const AI_BLOCKER_SURFACES: SurfaceDescriptor[] = [
  // Always-on per platform.
  {
    id: 'ai-content-blocker:tiktok:any',
    platform: 'tiktok',
    surfaceKind: 'feed',
    pathnamePattern: null,
    containerSelectors: [
      '[data-e2e="recommend-list-item-container"]',
      '[data-e2e="video-detail"]',
    ],
    dynamicContentRescan: false,
  },
  {
    id: 'ai-content-blocker:instagram:any',
    platform: 'instagram',
    surfaceKind: 'post',
    pathnamePattern: null,
    containerSelectors: ['article'],
    dynamicContentRescan: false,
  },
  // IG dropped <article> on /p/<id>/ + /reels/<id>/ permalinks. Without
  // this surface registration the blocker had no container to evaluate
  // on the permalink (a screenshot of a live creator account, 2026-05-22: AI
  // broccoli/pineapple video visible despite blocker on).
  // Pathname-gated so the broad `main` selector doesn't fire on home /
  // explore / profile feeds (which are covered by the article surface).
  {
    id: 'ai-content-blocker:instagram:permalink',
    platform: 'instagram',
    surfaceKind: 'post',
    pathnamePattern: /^\/(p|reel|reels)\//,
    containerSelectors: ['main'],
    dynamicContentRescan: true,
  },
  {
    id: 'ai-content-blocker:youtube:any',
    platform: 'youtube',
    surfaceKind: 'feed',
    pathnamePattern: null,
    containerSelectors: [
      'ytd-reel-video-renderer',
      'ytd-watch-flexy',
      'ytd-rich-item-renderer',
      'ytd-video-renderer',
    ],
    dynamicContentRescan: false,
  },
  {
    id: 'ai-content-blocker:twitter:any',
    platform: 'twitter',
    surfaceKind: 'tweet',
    pathnamePattern: null,
    containerSelectors: ['article[data-testid="tweet"]'],
    dynamicContentRescan: false,
  },
  {
    id: 'ai-content-blocker:facebook:any',
    platform: 'facebook',
    surfaceKind: 'post',
    pathnamePattern: null,
    containerSelectors: ['div[role="article"]'],
    dynamicContentRescan: false,
  },
  // URL-gated surfaces — additive coverage for surfaces where the always-on
  // walks leave gaps (overlay / search-result / explore-tile DOM topologies).
  {
    id: 'ai-content-blocker:youtube:shorts-overlay',
    platform: 'youtube',
    surfaceKind: 'shorts-overlay',
    pathnamePattern: /^\/shorts\//,
    containerSelectors: ['ytd-reel-video-renderer'],
    dynamicContentRescan: true,
  },
  {
    id: 'ai-content-blocker:facebook:search-results',
    platform: 'facebook',
    surfaceKind: 'search-results',
    pathnamePattern: /^\/search\//,
    containerSelectors: ['div[role="article"]'],
    dynamicContentRescan: true,
  },
  {
    id: 'ai-content-blocker:instagram:explore-tile',
    platform: 'instagram',
    surfaceKind: 'explore-tile',
    pathnamePattern: /^\/explore\//,
    containerSelectors: ['article'],
    dynamicContentRescan: true,
  },
];

for (const desc of AI_BLOCKER_SURFACES) {
  try {
    sharedSurfaceDetector.register(desc);
  } catch {
    // Already registered (re-import / HMR / test rebuild). The shared
    // detector enforces id-uniqueness by throwing; tolerated here because
    // the registry is module-load idempotent for our purposes.
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// : switched from `display: none` to `visibility: hidden` +
// `pointer-events: none`. The previous `display: none` removed the
// container from layout, which made TikTok's IntersectionObserver decide
// the current FY-feed item was no longer in view. TikTok's auto-advance
// logic then navigated to the next video — which was ALSO blocked → hidden
// → IntersectionObserver fired again → URL-flip loop. The console showed
// the symptom verbatim: dozens of `[controller] AbortError: The play()
// request was interrupted by a call to pause()` errors as TikTok's player
// fought the hide.
//
// `visibility: hidden` keeps the container in layout (preserves the
// bounding box IntersectionObserver reads) so TikTok's auto-advance is
// quiet, but renders all descendants invisible. `pointer-events: none`
// ensures interaction is suppressed. Audio is paused + muted in
// blockContainer() because visibility:hidden alone doesn't stop media.
const BLOCKED_CSS = `
    [${BLOCKED_MARKER}="ai-content"] {
      visibility: hidden !important;
      pointer-events: none !important;
    }
  `;

/**
 * Normalize a parent-supplied hashtag to the canonical lowercase no-prefix
 * form used for matching. `#AiFruit` → `aifruit`. Used by the blocklist
 * loader and by the chip-list editor in the settings UI.
 */
function normalizeHashtag(raw: string): string {
  return raw.trim().replace(/^#+/, '').toLowerCase();
}

/**
 * Extract every `#hashtag` from a caption, lowercased and stripped of `#`.
 *
 * Unicode letters since 2026-09-19. This was `/#\w+/g`, and `\w` without the
 * `u` flag is `[A-Za-z0-9_]`, so `#geração` was read as `gera` and
 * `#înșelătorie` as an empty match: no hashtag carrying an accent could ever be
 * matched, on a product that ships in Romanian, Spanish and Brazilian
 * Portuguese and is used in those languages. A parent typing the tag they
 * actually see on the page got nothing, twice over, because the popup refused
 * to store it either (KeysTab.tsx).
 *
 * The old comment said this mirrored `linguistic-features.ts:285` "so detection
 * and blocking agree on what counts as a hashtag". They no longer share a
 * pattern and the reason is worth writing down: that one COUNTS hashtags as a
 * feature the judge reads, so widening it changes scored behaviour and is a
 * measurement question, not a bug fix. This one MATCHES a tag a parent chose,
 * where missing their language is the defect itself.
 */
function captionHashtags(caption: string): string[] {
  const matches = caption.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  return matches.map(normalizeHashtag);
}

interface BlockMatch {
  reason: string;
  token: string;
}

function evaluateContainer(
  container: HTMLElement,
  extractors: PlatformExtractors,
  blocklist: Set<string>,
): BlockMatch | null {
  // Hashtag rule — try caption selectors first (cheap, narrow scope),
  // then fall through to full container.textContent. Search-result surfaces
  // (TikTok video-detail-via-search, YouTube Shorts overlay,
  // Facebook /search/posts wrappers, Instagram explore tiles) often render
  // the description in modern DOM nodes the descriptor.caption selectors
  // were not authored against. Container-wide hashtag scan closes that gap;
  // false-positive risk stays bounded because the parent has explicitly
  // opted into blocking these specific tags.
  // Both rules read the comment-stripped haystack. The hashtag fallback used
  // to read raw container.textContent, which on Instagram includes the
  // comment preview under the same <article>: a viewer comment containing
  // #ai (or any blocklisted tag) hid the whole post, and only after the
  // comments hydrated — the intermittent "post disappears later" symptom.
  // Same false-positive class the AI-label rule already strips for.
  const haystack = buildAiLabelHaystack(container);

  if (blocklist.size > 0) {
    const captionText = pickFirstText(container, extractors.caption);
    for (const tag of captionHashtags(captionText)) {
      if (blocklist.has(tag)) {
        return { reason: 'hashtag', token: `#${tag}` };
      }
    }
    if (haystack.length > captionText.length) {
      for (const tag of captionHashtags(haystack)) {
        if (blocklist.has(tag)) {
          return { reason: 'hashtag', token: `#${tag}` };
        }
      }
    }
  }

  // AI-label rule — scan container text EXCLUDING the comment region.
  // Pre-fix the haystack was the full container.textContent which on
  // TikTok included viewer comments when the comment panel was open;
  // any comment mentioning "ai generated" triggered the blocker on a
  // non-AI video (live test, 2026-05-21: opening comments on a
  // TikTok caused the whole video to disappear). The label still must
  // sit OUTSIDE the caption (TikTok renders it as a small badge near
  // the music attribution) — but COMMENT-region text is now excluded
  // from the haystack via a cheap clone+strip.
  if (haystack.length > 0) {
    for (const { lang, token } of AI_LABEL_TOKENS) {
      if (haystack.includes(token)) {
        return { reason: `ai-label:${lang}`, token };
      }
    }
  }

  return null;
}

/**
 * Build the AI-label haystack by reading container.textContent with the
 * comment-region descendants removed. Avoids the "viewer comment mentions
 * 'ai generated' → blocker hides a non-AI video" false positive.
 *
 * Cost: one shallow clone of the video container (~50-200 elements on TT)
 * + N querySelectorAll calls (one per selector in COMMENT_REGION_SELECTORS).
 * Cheap relative to the original full-textContent read.
 */
const COMMENT_REGION_SELECTORS = [
  // TikTok comment panel
  '[data-e2e^="comment-"]',
  '[data-e2e="comment-list"]',
  '[class*="DivCommentListContainer"]',
  '[class*="DivCommentItemWrapper"]',
  // YouTube comments
  'ytd-comments',
  'ytd-comment-view-model',
  // Facebook + Instagram nested comment articles (aria-label stems used by adapters)
  '[role="article"][aria-label*="omment" i]',
  '[role="article"][aria-label*="răspuns" i]',
];

// Defensive cap on per-container textContent reads. Typical video cards
// have ~500-5,000 chars; an AI-label badge always sits near the caption,
// not buried in a 100KB+ blob. If we hit a container this large it means
// the surface-descriptor selector matched a wrapper we don't actually want
// to inspect (e.g. the whole YT watch-page tree). Returning empty here
// declines to evaluate the container — the parent loses an AI-label match
// in that one edge case, but the alternative is multi-megabyte string
// allocations on every MutationObserver tick which drove YT to OOM.
const MAX_HAYSTACK_LENGTH = 50_000;

// Page-level containers only (the IG permalink surface registers `main`):
// one blocklist hit anywhere under `main` used to blank the whole permalink
// view. Nested <article> tiles ("More posts from …" rail) are each evaluated
// individually by the always-on article surface, so a hit inside one must
// hide THAT tile, not the page; <ul> holds the permalink comment list, and
// comments must never hide the post (same rule as COMMENT_REGION_SELECTORS).
// The post's own caption on modern IG permalinks renders in heading nodes
// outside both, and the caption selectors scan it directly either way.
const PAGE_LEVEL_STRIP_SELECTORS = ['article', 'ul'];

function buildAiLabelHaystack(container: HTMLElement): string {
  const fullText = container.textContent ?? '';
  if (fullText.length === 0) return '';
  if (fullText.length > MAX_HAYSTACK_LENGTH) return '';
  // Page-level detection by shape, not tag name: a future descriptor using
  // [role="main"] or body would otherwise silently skip the strip and
  // reintroduce the one-hit-blanks-the-page bug (survey A10 second half).
  const isPageLevel = container.tagName === 'MAIN'
    || container.tagName === 'BODY'
    || container.getAttribute('role') === 'main';
  const stripSelectors = isPageLevel
    ? [...COMMENT_REGION_SELECTORS, ...PAGE_LEVEL_STRIP_SELECTORS]
    : COMMENT_REGION_SELECTORS;
  let hasCommentRegion = false;
  for (const sel of stripSelectors) {
    if (container.querySelector(sel)) {
      hasCommentRegion = true;
      break;
    }
  }
  // Fast path: no strippable region present → use original textContent.
  // Avoids the clone cost on the dominant case (typical feed scrolling).
  if (!hasCommentRegion) return fullText.toLowerCase();
  // Slow path: strip the regions from a clone before reading text.
  try {
    const clone = container.cloneNode(true) as HTMLElement;
    for (const sel of stripSelectors) {
      clone.querySelectorAll(sel).forEach((el) => el.remove());
    }
    return (clone.textContent ?? '').toLowerCase();
  } catch {
    // Defensive: cloneNode failures (DOM detach race etc.) fall back to
    // the original behavior. Preserves block on legitimate AI-labeled
    // content; accepts the false positive on this single tick.
    return fullText.toLowerCase();
  }
}

function pickFirstText(container: HTMLElement, selectors: string[]): string {
  // For the caption, we want the LONGEST matching text — selectors like
  // `[dir="auto"]` (Facebook / Instagram fallback) match many small UI
  // labels alongside the actual caption; the longest wins.
  let longest = '';
  for (const sel of selectors) {
    container.querySelectorAll<HTMLElement>(sel).forEach(el => {
      const t = el.textContent?.trim() ?? '';
      if (t.length > longest.length) longest = t;
    });
  }
  return longest;
}

function pickFirstAuthor(container: HTMLElement, selectors: string[]): string {
  for (const sel of selectors) {
    const el = container.querySelector<HTMLElement>(sel);
    const t = el?.textContent?.trim();
    if (t) {
      // Normalize to `@handle` form for consistency with the platform
      // adapter's author shape ([tiktok.ts:181, 219]).
      return t.startsWith('@') ? t : `@${t.replace(/^@/, '')}`;
    }
  }
  return 'unknown';
}

function pickPostUrl(container: HTMLElement, extractors: PlatformExtractors): string {
  if (extractors.url) {
    const anchor = container.querySelector<HTMLAnchorElement>(extractors.url);
    const href = anchor?.getAttribute('href') ?? '';
    if (href) {
      return href.startsWith('http') ? href : `${window.location.origin}${href}`;
    }
  }
  //:
  // when in-container extraction fails (TikTok FY-feed renders author/url
  // sibling-rail elements that may not be inside the recommend-list-item-
  // container at block-time), fall back to location.href. Worst case: parent
  // gets the page URL the child was on, not a per-post permalink — still
  // useful, never a dead synthetic URL. Pre-returned '' here, leaving
  // the dashboard with no clickable target.
  return currentPageAddress();
}

// author-fallback chain for AI-blocker. When in-container
// selectors miss (TikTok DOM rotates; selectors stale; FY-feed author lives in
// sibling rail outside the container), walk up to 2 parent levels then check
// the URL pathname for a TikTok @username pattern. Per a forensic-export
// review showing 13/14 blocked TikTok records with author='unknown'.
function pickAuthorWithFallback(container: HTMLElement, selectors: string[], platform: Platform): string {
  // 1. Try the descriptor's selectors inside the container (existing behavior).
  const inContainer = pickFirstAuthor(container, selectors);
  if (inContainer && inContainer !== 'unknown') return inContainer;

  // 2. Walk up to 2 ancestor levels — TikTok's video-author-rail often sits
  //    as a sibling of the recommend-list-item-container, not inside it.
  let parent: HTMLElement | null = container.parentElement;
  for (let depth = 0; depth < 2 && parent; depth++) {
    const inAncestor = pickFirstAuthor(parent, selectors);
    if (inAncestor && inAncestor !== 'unknown') return inAncestor;
    parent = parent.parentElement;
  }

  // 3. Platform-specific URL pattern fallback (TikTok permalink convention).
  if (platform === 'tiktok' && typeof location !== 'undefined') {
    const m = location.pathname.match(/^\/@([^/]+)\/video\//);
    if (m) return `@${m[1]}`;
  }

  return '';
}

/**
 * best-effort mute + pause for every media element inside
 * a blocked container. Used by both the initial block path AND the
 * MutationObserver re-mute path that catches TikTok's late-loaded videos.
 */
function muteAllMediaIn(container: HTMLElement): void {
  container.querySelectorAll<HTMLMediaElement>('video, audio').forEach(media => {
    try {
      media.muted = true;
      media.pause();
    } catch {
      // Ignore — media element may be in a transitional state.
    }
  });
}

/**
 * Inverse of muteAllMediaIn: restore audio on every media element inside a
 * container the blocker had muted. Used by resetDOM on toggle-off so an
 * on-screen video isn't left silent. Does NOT call play() — autoplay is the
 * platform's concern; we only undo the mute we imposed.
 */
function unmuteAllMediaIn(container: HTMLElement): void {
  container.querySelectorAll<HTMLMediaElement>('video, audio').forEach(media => {
    try {
      media.muted = false;
    } catch {
      // Ignore — media element may be in a transitional state.
    }
  });
}

function blockContainer(
  container: HTMLElement,
  extractors: PlatformExtractors,
  match: BlockMatch,
  platform: Platform,
  settings: FWSettings,
): (() => void) | null {
  const mode = settings.mode;
  if (container.getAttribute(BLOCKED_MARKER) === 'ai-content') return null;

  // Capture context BEFORE we hide — author / caption / url all live inside
  // the container we're about to set display:none on. The lookups still
  // work post-hide (display:none doesn't unmount), but stay defensive in
  // case a future MutationObserver tick removes the container entirely.
  // : use pickAuthorWithFallback (sibling-walk + URL pattern)
  // and pickPostUrl with location.href fallback — pre-13/14 blocked
  // TikTok records had author='unknown' + empty postUrl per a forensic-export review.
  const author = pickAuthorWithFallback(container, extractors.author, platform);
  const caption = pickFirstText(container, extractors.caption);
  const postUrl = pickPostUrl(container, extractors);

  // A card hidden on a single-player video feed leaves the person on a black screen, so the feed moves on (F47, site C).
  // Both snapshots are read while the card still holds its box, as the ad hide does (injector.ts injectAdHide): the comment
  // panel state, and which card is on screen. The move itself waits until the whole sweep has marked its cards.
  const feed = videoFeedItemOf(container);
  const commentSnapshot = feed ? snapshotCommentPanel(feed.surface) : { open: false };
  const watch = feed && feed.item === container ? snapshotWatched(container, feed.surface) : null;

  container.setAttribute(BLOCKED_MARKER, 'ai-content');
  container.setAttribute(BLOCK_REASON_MARKER, `${match.reason}:${match.token}`);
  // Count this AI-content block in the metricsHidden counter so the popup
  // ASCUNSE column reflects whole-container hides alongside engagement-bar
  // / action-rail / comment-section hides. The duplicate-block guard above
  // ensures one call per first-block, so re-evaluations don't double-count.
  // visibility:hidden + pointer-events:none preserves the container's layout
  // box so TikTok's IntersectionObserver doesn't trigger auto-advance. See the
  // BLOCKED_CSS rationale. Through the door since 2026-09-20, which applies
  // both properties and asks the privacy rule first.
  if (!hideElement(container, {
    marker: BLOCK_REASON_MARKER, value: `${match.reason}:${match.token}`,
    reason: `block-ai-content:${match.reason}`,
    feature: 'block-ai-content',
    count: 0,
    mode: 'visibility',
  })) return null;
  countHiddenFor('block-ai-content');
  // : visibility:hidden alone doesn't stop media playback — the audio
  // would still play through the hidden container. Pause + mute any
  // <video>/<audio> elements inside so the kid doesn't hear the blocked
  // content. Best-effort try/catch — autoplay-policy quirks on some
  // platforms make pause() throw; never propagate.
  muteAllMediaIn(container);
  // Track for resetDOM's unmute-on-toggle-off pass. Also sweeps detached
  // entries + hard-caps the live count (PERF-5, 2026-07-13 perf audit) —
  // same leak class + same fix shape as trackMediaObserver below.
  trackBlockedContainer(container);
  // Bug report: TikTok video blocked but audio still
  // played (cartoon audio audible while screen was black).
  //
  // PLAUSIBLE root cause (NOT verified against TikTok's actual DOM-mutation
  // timing): TikTok lazy-loads the <video> element AFTER blockContainer
  // fires, so the initial querySelectorAll('video, audio') returns empty.
  // ALTERNATIVE root causes the team did NOT rule out:
  //   (a) TikTok's player code re-calls play() after our pause()
  //   (b) the video exists from start but autoplay-policy quirks override
  //   (c) audio comes from a sibling/parent node outside our container scope
  //
  // This MutationObserver fix addresses (a partially) and the lazy-load
  // hypothesis specifically — re-mutes any media element added or modified
  // in the subtree. If audio still plays after this fix, the actual root
  // cause is (b) or (c) and a different approach is needed (e.g., observe
  // the entire body, or override the media element's play() method).
  //
  // Memory-leak note: MutationObserver holds a strong ref to its observed
  // node per spec. When a virtualizer (TikTok, YouTube home feed) removes the
  // container from the DOM, the observer keeps the detached subtree rooted
  // until disconnect(). On an INFINITE feed this is unbounded — it drove the
  // YouTube renderer OOM (2026-06-07). Cleanup is now handled: trackMediaObserver
  // (below) sweeps detached-container observers + hard-caps the live count, and
  // disconnectAllMediaObservers runs on resetDOM/teardown.
  const mediaObserver = new MutationObserver(() => muteAllMediaIn(container));
  mediaObserver.observe(container, { childList: true, subtree: true });
  // Register for cleanup — detached-container sweep + hard cap prevent the
  // unbounded accumulation that drove the YouTube renderer OOM (see registry).
  trackMediaObserver(mediaObserver, container);
  // tell the platform adapter to skip this container.
  // The TikTok adapter checks `dataset.fwProcessed === 'true'` ([tiktok.ts:73])
  // and the same convention is used elsewhere; setting it here pre-empts the
  // pipeline so no Groq tokens are spent on a video the parent has already
  // said no to.
  container.dataset.fwProcessed = 'true';

  ensureStyleTag(STYLE_TAG_ID, BLOCKED_CSS);

  // Fire-and-forget forensic write. SW handler routes through the chain-
  // write lock so this can't race with parallel logForensicEvent calls
  // happening in the SW realm.
  //
  // configSnapshot: this rule fires synchronously from a DOM scan (no async
  // settings/threshold read on this hot path), so it uses the same
  // MANIPULATION_SEVERITY_THRESHOLD stand-in comment-batch/flush.ts's own
  // rules-only branch uses for the same reason (`threshold` describes an
  // LLM gate this deterministic hashtag/AI-label match never consults).
  // Before this, blocked records never carried a configSnapshot at all
  // (BlockedEventInput never had the field) — the export's "no
  // configSnapshot" gap traced here, not to a media-understanding gate race.
  const payload: BlockedEventInput = {
    platform,
    mode,
    author,
    postUrl,
    blockReason: match.reason,
    matchedToken: match.token,
    caption,
    // The blocker hides a video container (docblock of logBlockedEvent).
    kind: 'video',
    // The household's own hashtag is the blocklist rail; the AI label has no
    // row and gets no block (C14).
    decision: decisionForBlock({ mode, blockReason: match.reason, matchedToken: match.token, applied: 'hide', mask: false }),
    configSnapshot: buildConfigSnapshot(
      mode,
      MANIPULATION_SEVERITY_THRESHOLD,
      settings.dailyCap,
      settings.features,
      settings.readFailedFallback,
    ),
  };
  // fire-and-forget via safeSendMessage. Handles both sync throws
  // (SW mid-eviction) and async rejects (context invalidated after extension
  // reload) without per-call console.warn — the warn fired N times per
  // session and filled the Errors panel with benign reload artifacts.
  recordBlocked(payload);

  // The hide stays visibility:hidden (display:none made TikTok's observer auto-advance in a loop, BLOCKED_CSS). The move is
  // one scrollIntoView of the next card the filter has not hidden, only when this card was the one on screen, and bounded by
  // the advance breaker (video-feed-hide.ts MAX_ADVANCES_PER_WINDOW).
  return () => {
    if (feed && watch) {
      afterFeedItemHidden(container, feed.surface, commentSnapshot, watch, resolveUiLanguage(settings.uiLanguage));
    }
  };
}

function evaluateTikTokPermalinkPage(blocklist: Set<string>): BlockMatch | null {
  // TikTok permalink (`/@<user>/video/<id>`) renders the focused video at
  // `[data-scroll-index="0"]` with caption + music + AI-label badge in a
  // sibling info panel, NOT a descendant. The container-scoped descriptor
  // misses both signals because the hashtag text and the AI-label are
  // outside the container's DOM subtree (sibling, per platforms/tiktok.ts
  // §242-249). Query the page-level caption + label and block the focused
  // container when matched.
  if (blocklist.size > 0) {
    const captionEl =
      document.querySelector<HTMLElement>('[data-e2e="browse-video-desc"]') ??
      document.querySelector<HTMLElement>('[data-e2e="video-desc"]');
    const captionText = captionEl?.textContent ?? '';
    for (const tag of captionHashtags(captionText)) {
      if (blocklist.has(tag)) {
        return { reason: 'hashtag', token: `#${tag}` };
      }
    }
  }
  // AI-label rule — scan document-wide BUT exclude the comment region.
  // The pre-2026-05-21 assumption that "specific multi-word phrases only
  // appear in the platform's AI-disclosure surface" was wrong: viewer
  // comments routinely contain phrases like "ai generated" / "generat de
  // ia" in casual conversation about AI content. On a permalink page
  // those comments live in the document body alongside the AI badge,
  // and the prior body-wide scan matched them — hiding non-AI videos
  // whenever any commenter mentioned AI (live test, 2026-05-21).
  const haystack = buildAiLabelHaystack(document.body);
  for (const { lang, token } of AI_LABEL_TOKENS) {
    if (haystack.includes(token)) {
      return { reason: `ai-label:${lang}`, token };
    }
  }
  return null;
}

function runOnce(
  extractors: PlatformExtractors,
  blocklist: Set<string>,
  platform: Platform,
  settings: FWSettings,
): void {
  const mode = settings.mode;
  const pathname = typeof location !== 'undefined' ? location.pathname : '';

  // YT /watch gate — the ai-content-blocker walks the document looking
  // for AI-labeled video containers to hide. On YT's player page the
  // matched "container" can encompass the recommendations sidebar (a
  // massive subtree); reading container.textContent + querySelectorAll
  // on every DOM mutation drove the renderer to OOM in live testing.
  // The feature is useful at FEED level (home, search) where new videos
  // appear, not on a single watch page where the parent already chose
  // to watch the video. Gate is dynamic — startAiContentBlocker can be
  // invoked before the SPA navigates to /watch, and we need to no-op
  // once navigation lands there.
  if (platform === 'youtube' && pathname.startsWith('/watch')) {
    // Even while the /watch evaluation gate holds, page-level blocks carried
    // in by the SPA must still release (Q30): with no descriptors active
    // here, none of them are covered.
    releaseUncoveredPageLevelBlocks([]);
    return;
  }

  // Shared surface-detector walk replaces the inline descriptor.container
  // querySelectorAll. One pass per surface descriptor that matches the
  // current platform + URL — the BLOCKED_MARKER early-out below idempotently
  // skips containers that overlap multiple descriptors (e.g. a Shorts video
  // hit by both `youtube:any` and `youtube:shorts-overlay`).
  const surfaceMatches = sharedSurfaceDetector.matchAndWalk(platform, pathname);

  // Page-level un-hide by MARKER, not by hand-coupled selector (Q30,
  // generalizes the earlier IG-permalink release). The SPA reuses page-level
  // elements (main / body / role=main) across routes, so a block applied on
  // a URL-gated surface used to survive navigation and leave the whole feed
  // invisible until reload. Any page-level blocked element no longer
  // selected by a currently-matched descriptor releases here; a future
  // descriptor addition is covered automatically. Per-post blocks are
  // content-based and correctly persist.
  releaseUncoveredPageLevelBlocks(
    surfaceMatches.flatMap(m => m.descriptor.containerSelectors),
  );

  // The feed moves on after the sweep, not card by card: a card marked later in the same sweep must not be the one it lands on.
  const afterHides: Array<() => void> = [];
  for (const surfaceMatch of surfaceMatches) {
    for (const containerNode of surfaceMatch.containers) {
      const container = containerNode as HTMLElement;
      if (container.getAttribute(BLOCKED_MARKER) === 'ai-content') continue;
      // Private conversations are outside every filter's scope (item 3a, 2026-09-13).
      if (isInPrivateChatSubtree(container)) continue;
      const match = evaluateContainer(container, extractors, blocklist);
      if (match) {
        const after = blockContainer(container, extractors, match, platform, settings);
        if (after) afterHides.push(after);
      }
    }
  }

  // TikTok permalink surface needs document-scoped evaluation because the
  // caption + AI-label badge are siblings of the focused video container,
  // not descendants. Block the URL-target focused video at
  // `[data-scroll-index="0"]` when matched; carousel suggestions
  // (data-scroll-index 1..N) still get the standard container walk above.
  if (
    platform === 'tiktok' &&
    typeof location !== 'undefined' &&
    /^\/@[^/]+\/video\/\d+/.test(location.pathname)
  ) {
    const focused = document.querySelector<HTMLElement>('[data-scroll-index="0"]');
    if (focused && focused.getAttribute(BLOCKED_MARKER) !== 'ai-content') {
      const pageMatch = evaluateTikTokPermalinkPage(blocklist);
      if (pageMatch) {
        const after = blockContainer(focused, extractors, pageMatch, platform, settings);
        if (after) afterHides.push(after);
      }
    }
  }

  for (const after of afterHides) {
    try { after(); } catch { /* a failed move leaves the hide in place and must not stop the others */ }
  }
}

// ─── Media-mute observer registry (OOM fix, 2026-06-07) ─────────────────────
//
// blockContainer creates one MutationObserver per blocked container to re-mute
// lazily-loaded media. They were NEVER disconnected (the old comment accepted
// the leak as "bounded by feed length") — but YouTube's home feed is INFINITE,
// so on a long session they accumulate without bound and each pins its
// container's detached subtree → renderer heap climbs unbounded (live evidence
// 2026-06-07: youtube.com 132MB → 2450MB). Track them, sweep ones whose
// container the page has detached (virtualizer removed it), and hard-cap the
// live count.
const mediaObservers = new Set<{ observer: MutationObserver; container: HTMLElement }>();
const MAX_MEDIA_OBSERVERS = 200;
registerHeapGauge('aiBlock.mediaObservers', () => mediaObservers.size);

// Every container we muted, tracked in parallel to mediaObservers so resetDOM
// can UNMUTE them on toggle-off. Without this, toggle-off restored visibility +
// pointer-events but left media muted, so a video already on screen stayed
// silent after the parent disabled the AI-content blocker until the next swipe
// re-attached fresh (unmuted) media elements.
const blockedContainers = new Set<HTMLElement>();

/**
 * Reverse one container's block: markers, style overrides, media, observer.
 * Mirrors resetDOM's per-element cleanup but scoped to a single container.
 * Used by the runOnce permalink un-hide when a page-level block outlived its
 * URL gate via SPA element reuse.
 */
/**
 * Release every PAGE-LEVEL blocked element that no currently-active
 * descriptor selector still covers. Page-level = main / body / role=main,
 * the elements the SPA reuses across routes. See runOnce for rationale.
 */
function releaseUncoveredPageLevelBlocks(activeSelectors: readonly string[]): void {
  document.querySelectorAll<HTMLElement>(`[${BLOCKED_MARKER}="ai-content"]`).forEach(el => {
    const pageLevel = el.tagName === 'MAIN'
      || el.tagName === 'BODY'
      || el.getAttribute('role') === 'main';
    if (!pageLevel) return;
    const stillCovered = activeSelectors.some(sel => {
      try { return el.matches(sel); } catch { return false; }
    });
    if (!stillCovered) unblockContainer(el);
  });
}

function unblockContainer(container: HTMLElement): void {
  if (container.getAttribute(BLOCKED_MARKER) !== 'ai-content') return;
  container.removeAttribute(BLOCKED_MARKER);
  container.removeAttribute(BLOCK_REASON_MARKER);
  container.style.removeProperty('visibility');
  container.style.removeProperty('pointer-events');
  // This helper only ever runs on page-level containers (the permalink
  // MAIN); clearing fwProcessed there is required, or one permalink visit
  // would permanently short-circuit fwProcessed-deduping consumers for the
  // whole tab. Per-post containers keep it via resetDOM as before.
  delete container.dataset.fwProcessed;
  for (const entry of mediaObservers) {
    if (entry.container === container) {
      try { entry.observer.disconnect(); } catch { /* already gone */ }
      mediaObservers.delete(entry);
    }
  }
  blockedContainers.delete(container);
  unmuteAllMediaIn(container);
}

function trackMediaObserver(observer: MutationObserver, container: HTMLElement): void {
  mediaObservers.add({ observer, container });
  sweepMediaObservers();
}

function sweepMediaObservers(): void {
  // Drop observers whose container is no longer in the document — the observer
  // is useless once detached and only serves to pin the removed subtree.
  for (const entry of mediaObservers) {
    if (!entry.container.isConnected) {
      entry.observer.disconnect();
      mediaObservers.delete(entry);
    }
  }
  // Defense in depth: never keep more than the cap alive, even if every
  // container is still connected. Set iteration is insertion-order, so the
  // first entries are the oldest (LRU eviction).
  while (mediaObservers.size > MAX_MEDIA_OBSERVERS) {
    const oldest = mediaObservers.values().next().value;
    if (!oldest) break;
    oldest.observer.disconnect();
    mediaObservers.delete(oldest);
  }
}

function disconnectAllMediaObservers(): void {
  for (const entry of mediaObservers) entry.observer.disconnect();
  mediaObservers.clear();
}

// blockedContainers gets the identical sweep + cap treatment as
// mediaObservers above (PERF-5, 2026-07-13 perf audit): before this fix the
// Set was only ever cleared by resetDOM() on full toggle-off, so every
// distinct blocked post/video on a long TikTok/IG scroll session accumulated
// here indefinitely, pinning detached <video>/<div> subtrees the platform's
// own virtualizer had already removed from the live tree — the same
// incident class as the 2026-06-07 YouTube OOM this file's header describes.
const MAX_BLOCKED_CONTAINERS = 200;
registerHeapGauge('aiBlock.blockedContainers', () => blockedContainers.size);

function trackBlockedContainer(container: HTMLElement): void {
  blockedContainers.add(container);
  sweepBlockedContainers();
}

function sweepBlockedContainers(): void {
  // Drop containers no longer connected to the document — sweeping a
  // detached container cannot affect currently-visible blocked content
  // (unmute-on-toggle-off for a detached container is already a no-op since
  // it's not in the document).
  for (const container of blockedContainers) {
    if (!container.isConnected) {
      blockedContainers.delete(container);
    }
  }
  // Defense in depth: never keep more than the cap alive, even if every
  // container is still connected. Set iteration is insertion-order, so the
  // first entries are the oldest (LRU eviction) — mirrors sweepMediaObservers.
  while (blockedContainers.size > MAX_BLOCKED_CONTAINERS) {
    const oldest = blockedContainers.values().next().value;
    if (!oldest) break;
    blockedContainers.delete(oldest);
  }
}

function resetDOM(): void {
  disconnectAllMediaObservers();
  // Restore audio on every container we muted BEFORE clearing the tracking
  // set. A video already on screen at toggle-off would otherwise stay silent
  // until the platform re-attached fresh media on the next interaction.
  for (const container of blockedContainers) unmuteAllMediaIn(container);
  blockedContainers.clear();
  document.querySelectorAll<HTMLElement>(`[${BLOCKED_MARKER}="ai-content"]`).forEach(el => {
    el.removeAttribute(BLOCKED_MARKER);
    el.removeAttribute(BLOCK_REASON_MARKER);
    // clear the new visibility/pointer-events overrides.
    // (Pre- cleared `display`; that property is no longer set here.)
    el.style.removeProperty('visibility');
    el.style.removeProperty('pointer-events');
    // We do NOT clear `dataset.fwProcessed` here — that marker is shared
    // with the platform adapter's normal dedup path and clearing it would
    // cause every previously-processed post to be re-extracted on the
    // next observer tick (LLM-call storm). Toggle-off accepts that
    // already-blocked posts stay processed-and-skipped until reload.
  });
  removeStyleTag(STYLE_TAG_ID);
}

// ─── Public API ─────────────────────────────────────────────────────────────

// Minimum gap between full-surface runOnce sweeps driven by the rAF body
// observer. runOnce walks surface descriptors + per-container evaluation; on
// YouTube's home feed the observer fires it on every DOM mutation (~60x/sec),
// the same per-frame pressure pattern as youtube-engagement runAll. Throttle it
// (2026-06-07 YouTube OOM). The 2s polling fallback + SPA-nav rescans still run
// unthrottled — they're already infrequent.
const AI_BLOCK_THROTTLE_MS = 750;

export function startAiContentBlocker(
  platform: Platform,
  settings: FWSettings,
): () => void {
  if (!isFeatureEnabled(settings, 'block-ai-content', platform)) {
    return () => {};
  }
  const extractors = PLATFORM_EXTRACTORS[platform];
  if (!extractors) return () => {};

  const value = getFeatureValue<BlockAiContentValue>(settings, 'block-ai-content', platform);
  const rawHashtags = value?.hashtags ?? [];
  const blocklist = new Set(rawHashtags.map(normalizeHashtag).filter(t => t.length > 0));

  // Even if the blocklist is empty, the AI-label rule still runs: the
  // feature request was explicitly two-pronged (block these hashtags AND
  // anything marked as AI-generated). Empty blocklist + AI labels still earns a
  // hide.

  runOnce(extractors, blocklist, platform, settings);

  // rAF-debounced body observer — now THROTTLED so YouTube's constant DOM churn
  // can't drive a ~60x/sec full-surface sweep (2026-06-07 OOM). See
  // src/content/post-path/raf-observer.ts header for the YT-SPA-nav story.
  // Trailing: a burst inside the window schedules one run for the end of the
  // window instead of dropping it, so a container inserted right after a
  // sweep does not wait for the 2 s poll.
  const sweep = trailingThrottle(() => runOnce(extractors, blocklist, platform, settings), AI_BLOCK_THROTTLE_MS);
  const { cleanup: cleanupObserver } = createRafBodyObserver(sweep.call);

  // Polling fallback for SPAs that update text in place via state without
  // emitting useful childList records — same fallback the emoji-stripper
  // uses ([emoji-stripper.ts:179]).
  const interval = setInterval(() => runOnce(extractors, blocklist, platform, settings), 2000);

  // SPA-navigation re-scan. Mirrors reels-blocker.ts pattern + adds YT's
  // yt-navigate-finish (the cleanest YT signal). URL-poll catches programmatic
  // pushState. Each platform's SPA router fires different signals; we attach
  // all that apply and let the union cover them. Calls debounced via
  // scheduleRescan so a burst of pushState + popstate + URL-poll-tick collapses
  // to a single runOnce.
  let lastPath = typeof location !== 'undefined' ? location.pathname + location.search : '';
  let rescanTimeoutId: number | null = null;

  const scheduleRescan = (): void => {
    if (rescanTimeoutId !== null) {
      window.clearTimeout(rescanTimeoutId);
    }
    rescanTimeoutId = window.setTimeout(() => {
      rescanTimeoutId = null;
      runOnce(extractors, blocklist, platform, settings);
    }, RESCAN_DEBOUNCE_MS);
  };

  const onUrlMaybeChanged = (): void => {
    const next = typeof location !== 'undefined' ? location.pathname + location.search : '';
    if (next !== lastPath) {
      lastPath = next;
      scheduleRescan();
    }
  };

  window.addEventListener('popstate', onUrlMaybeChanged);
  const navPollIntervalId = window.setInterval(onUrlMaybeChanged, NAV_POLL_MS);

  const onYtNav = (): void => scheduleRescan();
  if (platform === 'youtube') {
    document.addEventListener('yt-navigate-finish', onYtNav);
  }

  return () => {
    cleanupObserver();
    sweep.cancel();
    clearInterval(interval);
    window.removeEventListener('popstate', onUrlMaybeChanged);
    window.clearInterval(navPollIntervalId);
    if (platform === 'youtube') {
      document.removeEventListener('yt-navigate-finish', onYtNav);
    }
    if (rescanTimeoutId !== null) {
      window.clearTimeout(rescanTimeoutId);
    }
    resetDOM();
  };
}

// Exports for the engagement controller's master DOM-reset path.
export const AI_CONTENT_BLOCKER_STYLE_TAG_ID = STYLE_TAG_ID;
export const AI_CONTENT_BLOCKED_MARKER = BLOCKED_MARKER;
export const AI_CONTENT_BLOCK_REASON_MARKER = BLOCK_REASON_MARKER;

// Test hooks for the media-observer registry bounding (OOM fix). Not used in
// production — they exercise the sweep + cap that prevent unbounded growth.
export function __trackMediaObserverForTest(observer: MutationObserver, container: HTMLElement): void {
  trackMediaObserver(observer, container);
}
export function __mediaObserverCountForTest(): number {
  return mediaObservers.size;
}
export function __resetMediaObserversForTest(): void {
  disconnectAllMediaObservers();
}

// Test hooks for the toggle-off unmute path (M27). Register a muted container,
// then drive resetDOM and assert media was unmuted. Routes through
// trackBlockedContainer so the sweep + cap behavior (PERF-5) is exercised
// the same way production blockContainer calls exercise it.
export function __trackBlockedContainerForTest(container: HTMLElement): void {
  trackBlockedContainer(container);
}
export function __blockedContainerCountForTest(): number {
  return blockedContainers.size;
}
export function __resetDOMForTest(): void {
  resetDOM();
}
