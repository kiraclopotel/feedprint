// FeelingWise — TikTok platform adapter (per-video bundle)
//
// Per DESIGN.md §5 the unit of analysis on TikTok is the video, not the
// caption-or-comment text fragment. The pre-implementation produced
// one PostContent per caption AND one per comment, treating each fragment as
// an independent post — that defeated comments-as-context and produced almost
// no flags in production (the LLM saw caption-only short text and correctly
// PASSed via "when in doubt PASS").
//
// reshape:
//   • Selector targets the per-video container (`recommend-list-item-container`
//     for the For-You / browse feed, `video-detail` for permalinked videos).
//   • Each container produces ONE PostContent. The `text` field carries a
//     bundle string (caption + top-N comments) built by
//     `formatBundleForCombinedPrompt` (src/content/extractors/tiktok-bundle-formatter.ts).
//     The bundle string flows through the v2 pipeline (calibrated COMBINED prompt) unchanged.
//   • Per-post discipline preserved: one container = one bundle = one LLM
//     call = one forensic record. Cross-post comment pooling is structurally
//     impossible because the formatter is invoked on one snapshot at a time.
//   • Teen-panel UX is preserved because we stay on the v2 path.
//     v3 flag remains off; flipping it is a separate decision.
//     (adult-panel UX removed.)
//   • DOM dedup: ContentInterceptor marks `domRef.deref()` with
//     `dataset.fwProcessed = "true"` after extraction. The adapter no longer
//     short-circuits on container-level `fwProcessed` — it gates per-record:
//     the caption uses `dataset.fwCaptionEmitted` on the container, and each
//     comment uses `dataset.fwCommentSeen` on its row element (the
//     `[class*="DivCommentItemWrapper"]` shell — mirrors the facebook.ts
//     pattern). Lazy-loaded comments inside an already-processed container
//     DO re-trigger and reach the batch.
//
// Selector contract:
//   The current TikTok build wraps each comment row in a styled-components
//   class whose unhashed segment is stable across hash rotations (only the
//   leading `css-XXXXX-...` and the trailing `eNNN` suffix change). Substring
//   matching on those unhashed segments is the selector surface. The
//   historical `[data-e2e="comment-level-1"]` / `comment-level-2` markers
//   were stripped from the comment panel and no longer match — see the
//   constants block below.

import { PostContent, FeedSource, PostKind, PlatformSpecificMeta } from '../../types/post';
import { cardForRecord } from '../record/card-context';
import { currentPageAddress } from '../record/post-url';
import { findChatOverlayAncestor, PlatformAdapter } from './adapter';
import { fwDebug } from '../fw-log';
import { probeMetricsScope } from '../probes/metrics-probe';
import {
  extractTikTokBundle,
  TT_COMMENT_PANEL_SELECTOR,
  TT_COMMENT_LIST_SELECTOR,
  TT_COMMENT_ROW_SELECTOR,
  TT_COMMENT_REPLY_WRAPPER_NAME_RE,
  findTikTokRowBodyEl,
  parseEngagementNumber,
  DEFAULT_BUNDLE_COMMENT_CAP,
} from './tiktok-bundle';
// fallback comment extractor for music-only / no-caption videos
// where extractTikTokBundle returns snapshot=null because it requires a
// caption. Comments still need to be scanned independently.
import { extractComments as extractCommentsFlat } from './comment-extractors';
// Universal DOM Master: shared row extractor (tier fallback + structural-
// shape detection + content-aware rotation diagnostic). See
// `src/content/platforms/dom-master/types.ts` for the architecture overview.
import { extractCommentRows, type DomMasterAdapter } from './dom-master';
import { readTikTokVideoIdFromXgWrapper } from './tiktok-video-id';
import { bumpCounter } from '../../diagnostics/diagnostics';
import {
  claimTikTokAdRemount,
  claimTikTokLateAdMarker,
  rememberTikTokOrganicCaption,
} from './tiktok-ad-remount';

// PostContent.platform_specific.surfaceKind enum — only 'tiktok-feed' or
// 'tiktok-permalink' ever reach a record because tile surfaces (Option B)
// don't emit records. Internal routing uses TikTokRoutingSurface below for
// 8-way URL discrimination; toPostSurfaceKind() maps it down to this enum.
type TikTokSurfaceKind = NonNullable<
  Extract<PlatformSpecificMeta, { platform: 'tiktok' }>['surfaceKind']
>;

// Internal URL-based routing across all 8 TikTok surfaces, derived from a
// live MCP probe of every surface (see docs/history/archive/surfaces-2026-05-28/tiktok-refresh.md).
// Feed surfaces (foryou / following / permalink) all use the modern
// recommend-list-item-container shell. Tile surfaces (explore / profile /
// search / hashtag) each have their own data-e2e namespace; the per-tile
// caption is too thin for useful BATCH classification (profile tiles expose
// only view count; hashtag tiles only a creator handle), so they short-
// circuit extractPosts → [] and rely on the platform-agnostic engagement-
// hider (src/content/engagement/section-model.ts) for the visible UX win.
// Per-tile classification is deferred to V1.5 once a tile-aware corpus
// exists.
type TikTokRoutingSurface =
  | 'foryou'
  | 'following'
  | 'permalink'
  | 'explore'
  | 'profile'
  | 'search'
  | 'hashtag'
  | 'unknown';

const TT_TILE_SURFACES: ReadonlySet<TikTokRoutingSurface> = new Set([
  'explore', 'profile', 'search', 'hashtag',
]);

const TT_SURFACE_SELECTORS: Record<TikTokRoutingSurface, string> = {
  foryou:    '[data-e2e="recommend-list-item-container"]',
  following: '[data-e2e="recommend-list-item-container"]',
  permalink: '[data-e2e="recommend-list-item-container"]',
  explore:   '[data-e2e="explore-item"]',
  profile:   '[data-e2e="user-post-item"]',
  search:    '[data-e2e="search_top-item"]',
  hashtag:   '[data-e2e="challenge-item"]',
  unknown:   '[data-e2e="recommend-list-item-container"]',
};

// TT-2 (docs/audits/swarm-2026-07-13/03-platform-tiktok.md): the exact set of
// TikTok `data-e2e` values that mark a card as an ad. `ad-tag` is the
// authoritative badge (live-mapped 2026-07-13, docs/spec/surfaces/tiktok.md:69,
// visible text "Ad"); `ad-link` is the documented historical variant; the
// outbound CTA `ttam-ads-cta` (docs/spec/surfaces/tiktok.md:70, "Contact us")
// is a second real marker TikTok exposes on the same card. All three are
// exact `data-e2e` attribute VALUES, matched only via `getAttribute('data-e2e')
// === marker` — never a substring/wildcard selector — because an unanchored
// `[data-e2e*="ad-"]` also matches unrelated controls whose value merely
// contains "ad-" as a substring (e.g. a `download-video` icon).
const TT_SPONSORED_MARKERS: ReadonlySet<string> = new Set([
  'ad-tag',
  'ad-link',
  'ttam-ads-cta',
]);

/**
 * True when the TikTok video container is a sponsored / ad post.
 * Matches only the exact documented `data-e2e` ad markers TikTok exposes on
 * the card (see `TT_SPONSORED_MARKERS`). A prior version additionally ran a
 * plain-language regex (`Sponsored`/`Anuncio`/`Werbung`/...) over the WHOLE
 * container's `textContent`, including comments — "Anuncio" and "Werbung" are
 * ordinary vocabulary, not ad-exclusive tokens, so an organic caption or
 * comment merely mentioning advertising would flip `is_sponsored=true` for a
 * genuine organic video. `pipeline.ts`'s sponsored gate has no mode check and
 * no AI corroboration, and `injectAdHide` removes the container with no
 * on-screen trace, so that false positive was silent and unrecoverable. The
 * free-text regex is dropped rather than re-scoped to the caption element
 * only, because the exact DOM markers above are TikTok's actual authoritative
 * ad signal (confirmed live) and a scoped regex would still risk an organic
 * caption that happens to use the word "sponsored"/"advertisement" in its
 * ordinary sense (same failure class documented for Instagram, META-3).
 */
export function extractIsTikTokSponsored(container: Element): boolean {
  for (const el of container.querySelectorAll('[data-e2e]')) {
    const value = el.getAttribute('data-e2e');
    if (value !== null && TT_SPONSORED_MARKERS.has(value)) return true;
  }
  return false;
}

/** Detect the TikTok routing surface from the URL pathname. */
function detectTikTokRoutingSurface(): TikTokRoutingSurface {
  const path = typeof window !== 'undefined' && window.location?.pathname || '/';
  if (/^\/@[^/]+\/video\/\d+/.test(path)) return 'permalink';
  if (path === '/' || path === '/foryou' || path.startsWith('/for-you')) return 'foryou';
  if (path.startsWith('/following')) return 'following';
  if (path.startsWith('/explore')) return 'explore';
  if (path.startsWith('/search')) return 'search';
  if (path.startsWith('/tag/')) return 'hashtag';
  if (path.startsWith('/@')) return 'profile';
  return 'unknown';
}

/** Map internal routing → PostContent surfaceKind enum (2-value union). */
function toPostSurfaceKind(routing: TikTokRoutingSurface): TikTokSurfaceKind {
  return routing === 'permalink' ? 'tiktok-permalink' : 'tiktok-feed';
}

/**
 * Video-caption engagement metrics from the For-You action rail. TikTok exposes
 * EXACT counts via stable `data-e2e` hooks (`like-count` / `comment-count` /
 * `share-count`) on a `<strong>` per video, scoped inside the video's own
 * `recommend-list-item-container` (verified live 2026-06-15: each container
 * holds its own counts, so this never cross-reads a neighbouring video). Large
 * counts compress to "1.2K"/"3M" — `parseEngagementNumber` handles that.
 * Pre-fix the caption record carried NO metrics at all (only comments did), so
 * TikTok posts always showed blank engagement in the dashboard + export.
 * Returns undefined when the rail hasn't rendered (off-screen / lazy video).
 */
export function extractTikTokVideoMetrics(
  container: HTMLElement,
): { likes?: number; reply_count?: number; shares?: number } | undefined {
  const read = (sel: string): number | undefined => {
    const el = container.querySelector(sel);
    probeMetricsScope('tiktok', sel, container, el);
    return el ? parseEngagementNumber(el.textContent?.trim() ?? '') : undefined;
  };
  const likes = read('[data-e2e="like-count"]');
  const reply_count = read('[data-e2e="comment-count"]');
  const shares = read('[data-e2e="share-count"]');
  if (likes === undefined && reply_count === undefined && shares === undefined) {
    return undefined;
  }
  const m: { likes?: number; reply_count?: number; shares?: number } = {};
  if (likes !== undefined) m.likes = likes;
  if (reply_count !== undefined) m.reply_count = reply_count;
  if (shares !== undefined) m.shares = shares;
  return m;
}

/**
 * Per-comment signals (creator / pinned / hearted) for a TikTok comment row.
 *
 * Likes + reply_count come from the bundle extractor (via the snapshot); these
 * flags require a fresh DOM walk because the bundle extractor doesn't surface
 * them. Per PER_PLATFORM_V1_SPEC §5.2 + the tiktok bundle extractor's
 * existing label-stem language scan.
 */
function extractTikTokCommentFlags(commentEl: Element): {
  isCreator: boolean;
  isPinned: boolean;
  isCreatorHearted: boolean;
} {
  const text = commentEl.textContent ?? '';
  // "• Creator" suffix on the username block
  const isCreator = /[•·]\s*(Creator|Creador|Créateur|Ersteller)/i.test(text);
  // "Fixat" (RO) / "Pinned" (EN) / "Anclado" (ES) / "Épinglé" (FR) / "Angeheftet" (DE)
  const isPinned = /\b(Fixat|Pinned|Anclado|[ÉE]pingl[ée]|Angeheftet|Закрепл[её]н)\b/i.test(text);
  // Creator-heart icon — TikTok uses a small heart-with-creator-avatar SVG
  const isCreatorHearted =
    !!commentEl.querySelector('[data-e2e*="creator-heart"], [class*="creatorHeart"], [class*="CreatorHeart"]');
  return { isCreator, isPinned, isCreatorHearted };
}

/**
 * Resolve the per-comment ROW element in surface_order.
 *
 * Uses the Universal DOM Master pattern. Tiers and shape anchors are
 * declared as DATA below (TIKTOK_DOM_MASTER); the shared
 * `extractCommentRows` runner handles tier fallback, structural-shape
 * detection, and the content-aware rotation diagnostic.
 *
 * MCP-verified anchors:
 *   • Comment-panel container: TT_COMMENT_PANEL_SELECTOR
 *   • Row class: TT_COMMENT_ROW_SELECTOR (the unhashed
 *     `DivCommentItemWrapper` segment of the styled-components class
 *     is preserved across hash rotations)
 *   • Author element: `<a href="/@username">` — URL-pattern based,
 *     cannot rotate without breaking TT's own URL routing
 *   • Text element: `<p>` inside the row
 *
 * Action-bar icons (comment-icon / like-icon / share-icon) sit OUTSIDE
 * the comment panel and the content-aware diagnostic gate distinguishes
 * content from chrome so the rotation warning does not fire on every
 * video card during feed scroll.
 */
function findTikTokCommentRows(container: HTMLElement): HTMLElement[] {
  // Use the same scope-resolution as the bundle extractor so
  // `bundle.comments[i]` and `rows[i]` index against the same DOM nodes.
  // On TikTok's current permalink layout the comment panel is a sibling
  // of the video container, so a raw `container.querySelectorAll` returns
  // zero rows even when the panel is open and populated.
  const scope = resolvePublicTikTokCommentSearchScope(container);
  const rows = extractCommentRows(scope, TIKTOK_DOM_MASTER);
  // Mirror the bundle extractor's skip-already-seen filter so the post-
  // filter row list stays index-aligned with `snapshot.comments`
  // (surface_order). Without this, the bundle's surface_order — computed
  // against the UNSEEN-rows list — would index into a list that still
  // contains the seen rows, mis-anchoring the marker onto the wrong row.
  return rows.filter((row) => !findChatOverlayAncestor(row) && !isCommentRowSeen(row));
}

/** Resolve TikTok's sibling comment panel without ever choosing a chat dialog. */
function resolvePublicTikTokCommentSearchScope(container: HTMLElement): HTMLElement {
  if (container.querySelector(TT_COMMENT_ROW_SELECTOR)) return container;
  if (typeof document === 'undefined') return container;
  return Array.from(document.querySelectorAll<HTMLElement>(TT_COMMENT_PANEL_SELECTOR))
    .find(panel => !findChatOverlayAncestor(panel)) ?? container;
}

/**
 * True when this comment row (or its DivCommentItemWrapper shell) has
 * already been emitted on a prior extraction pass. The stamp lives on the
 * row element; the bundle extractor's `skipRow` predicate and this helper
 * share the same definition so the two row lists stay aligned.
 */
function isCommentRowSeen(row: HTMLElement): boolean {
  if (row.dataset.fwCommentSeen === 'true') return true;
  const shell = row.closest<HTMLElement>(TT_COMMENT_ROW_SELECTOR);
  return shell?.dataset.fwCommentSeen === 'true';
}

// Session-scoped dedup of TikTok VIDEO records by video identity (the URL
// video id), independent of caption text. Two distinct videos that both
// have an empty caption must each emit one record; the same video re-mounted
// on a new container by the feed virtualizer must NOT emit a second. The
// `dataset.fwCaptionEmitted` container stamp guards the common
// same-container re-extraction; this set guards the cross-container remount
// where a fresh element loses the stamp. Synthetic ids (synthId / tk-music)
// are deliberately NOT added: they have no stable cross-container identity,
// so the container stamp alone is their guard.
const emittedVideoIds = new Set<string>();

// Per-container cache for the synthetic fallback video id (music-only /
// empty-caption feed videos with no URL video id). The id is built from
// `Date.now()` + a random suffix, so re-deriving it on every extraction pass
// minted a NEW id each scroll over the SAME container — the lazy-loaded
// comments then carried a fresh parentVideoId and split off into a separate
// dashboard card / chain group. Caching by container element keeps one stable
// id for the lifetime of that DOM node. WeakMap so detached containers are GC'd.
const containerSyntheticVideoId = new WeakMap<HTMLElement, string>();

function hasRealVideoId(id: string): boolean {
  return /^\d+$/.test(id);
}

/**
 * The container stamp, keyed by the video it was written for (M72). TikTok's
 * virtualizer reuses positional roots: an empty shell keeps its dataset while
 * a different video rehydrates into it. A stamp written for one real id must
 * not suppress another real id's video record; a stamp with no id (synthetic
 * id at emission) or a current synthetic id keeps the old container-only rule.
 */
function containerEmittedThisVideo(container: HTMLElement, videoId: string): boolean {
  if (container.dataset.fwCaptionEmitted !== 'true') return false;
  const emittedFor = container.dataset.fwCaptionEmittedFor;
  if (!hasRealVideoId(videoId) || emittedFor === undefined) return true;
  return emittedFor === videoId;
}

function stampContainerEmitted(container: HTMLElement, videoId: string): void {
  container.dataset.fwCaptionEmitted = 'true';
  if (hasRealVideoId(videoId)) container.dataset.fwCaptionEmittedFor = videoId;
  else delete container.dataset.fwCaptionEmittedFor;
}

/**
 * Stable synthetic video id for an empty-caption feed container with no URL
 * video id. Cached per container element so re-extractions of the SAME
 * container reuse the same id (otherwise each scroll minted a fresh
 * `tk-music-...` token, splitting that video's comments across dashboard
 * cards). Not a real id, so it never enters `emittedVideoIds`.
 */
function getSyntheticVideoId(container: HTMLElement): string {
  const cached = containerSyntheticVideoId.get(container);
  if (cached) return cached;
  const id = `tk-music-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  containerSyntheticVideoId.set(container, id);
  return id;
}

/**
 * Production reset of the session-scoped TikTok video-record dedup state.
 * Called on SPA navigation (video-pipeline.ts onNavigate) so a back-nav to a
 * previously-seen video re-records its caption for the new visit (the chain is
 * per-visit; suppressing the caption left a chain-mirror gap, VISION §1.1).
 * The per-container synthetic-id cache is NOT cleared here: it is keyed on DOM
 * identity (WeakMap) and self-prunes when the feed virtualizer drops the node.
 */
export function resetTikTokVideoDedup(): void {
  emittedVideoIds.clear();
}

/** Test-only alias for {@link resetTikTokVideoDedup}. */
export function _resetTikTokVideoDedupForTesting(): void {
  resetTikTokVideoDedup();
}

const TIKTOK_DOM_MASTER: DomMasterAdapter = {
  platform: 'tiktok',
  commentRowTiers: [
    {
      // Class-substring match on the unhashed DivCommentItemWrapper
      // segment. Filter excludes reply-tier wrappers (the substring
      // would otherwise also capture them).
      name: 'class-DivCommentItemWrapper',
      selector: TT_COMMENT_ROW_SELECTOR,
      filter: (el) => !TT_COMMENT_REPLY_WRAPPER_NAME_RE.test(el.className || ''),
    },
  ],
  commentShapeAnchors: {
    // URL-pattern based — `/@handle` is dictated by TT's URL routing,
    // they cannot rotate this without breaking their own site.
    authorMarkers: [
      'a[href^="/@"]',
    ],
    // Comment text bodies are `<p>` inside the row. Fallback to
    // span[lang] for variants that wrap the body in a lang-tagged span.
    textMarkers: [
      'p',
      'span[lang]',
    ],
  },
  commentContentSignals: {
    // Content-shaped DOM: row + list + panel substring-class anchors.
    // Crucially does NOT include action-bar `data-e2e` icons — those
    // sit outside the comment panel and would otherwise fire the
    // rotation diagnostic on every video card during feed scroll.
    contentSelectors: [
      TT_COMMENT_ROW_SELECTOR,
      TT_COMMENT_LIST_SELECTOR,
      TT_COMMENT_PANEL_SELECTOR,
    ],
  },
};

// (legacy warnRotationOnce removed — diagnostic moved to the shared
// dom-master/rotation-diagnostic.ts module, which fires content-aware
// warnings consistently across all 5 platforms.)

export class TiktokAdapter implements PlatformAdapter {
  readonly platform = 'tiktok' as const;

  detectPlatform(): boolean {
    return window.location.hostname.includes('tiktok.com');
  }

  getPostSelector(): string {
    return TT_SURFACE_SELECTORS[detectTikTokRoutingSurface()];
  }

  extractPosts(nodes: NodeList): PostContent[] {
    // Tile-surface short-circuit (per Option B in
    // docs/history/archive/surfaces-2026-05-28/tiktok-refresh.md). /explore, /@<user>,
    // /search, /tag/ render tile grids with caption text too thin for
    // useful BATCH classification; emitting per-tile records would
    // produce mostly false-positives at our current corpus baseline.
    // Engagement-hider on these grids still runs via the platform-
    // agnostic section-model finder. V1.5 unlocks per-tile extraction
    // once a tile-aware corpus is calibrated.
    const routing = detectTikTokRoutingSurface();
    if (TT_TILE_SURFACES.has(routing)) return [];

    const postSelector = TT_SURFACE_SELECTORS[routing];
    const posts: PostContent[] = [];
    const feedSource = this._detectFeedSource();
    const seenContainers = new Set<HTMLElement>();
    let containersFoundTotal = 0;
    let containersEmptySplit = 0;

    nodes.forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      const containers = this._collectVideoContainers(node, postSelector);
      containersFoundTotal += containers.length;

      for (const container of containers) {
        // Keep private chat overlays outside the public-feed extractor. This
        // must precede caption/comment reads and per-record dedup stamps.
        if (findChatOverlayAncestor(container)) continue;
        if (seenContainers.has(container)) continue;
        seenContainers.add(container);

        // Per-record dedup runs INSIDE _buildSplitPosts (caption gated by
        // dataset.fwCaptionEmitted on the container; each comment gated by
        // dataset.fwCommentSeen on its row element — the
        // DivCommentItemWrapper shell). The container is never short-
        // circuited here so lazy-loaded comments surfaced after first
        // processing still reach the batch path — closing the "FW stops
        // processing after scroll" regression where the container was
        // permanently locked after first extraction.
        const split = this._buildSplitPosts(container, feedSource);
        if (split.length === 0) containersEmptySplit++;
        for (const p of split) posts.push(p);
      }
    });

    // Diagnostic: when scrolling produces no posts, the cause is one of:
    //   • no containers in the mutated nodes (selector mismatch with TikTok DOM)
    //   • bundle extractor returns null (snapshot extraction failed)
    //   • per-record dedup skipped everything (caption already emitted, all
    //     visible comments already stamped fwCommentSeen)
    // Log only when something interesting happens to avoid spam during normal scrolls.
    if (containersFoundTotal > 0 || posts.length > 0) {
      fwDebug(
        `[FW tiktok-adapter] mutated=${nodes.length} containers=${containersFoundTotal} (empty-split=${containersEmptySplit}) posts=${posts.length}`,
      );
    }

    return posts;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private _collectVideoContainers(root: HTMLElement, selector: string): HTMLElement[] {
    const out: HTMLElement[] = [];
    if (root.matches?.(selector)) out.push(root);
    root.querySelectorAll<HTMLElement>(selector).forEach((el) => out.push(el));
    return out;
  }

  /**
   * produce up to N+1 PostContent per video container:
   *   1 record for the caption (kind='video')
   *   N records for the visible comments (kind='comment')
   * All share the same `parentVideoId` so the dashboard can group them.
   *
   * Each piece scored independently by the pipeline → independent forensic
   * record. Replaces the single-bundle approach (which produced
   * one record per video; lost per-comment visibility).
   *
   * Edge cases:
   *   • Caption-only video (no comments visible): returns 1 record. The
   *     snapshot path emits one video record per distinct video regardless of
   *     comment count — a served video is itself part of the feed sequence
   *     worth recording (VISION §1.1 chain-mirror), and it anchors any
   *     comments that load later.
   *   • Music-only video (empty caption) WITH comments: one video record
   *     (empty caption text) + the comment records. The FALLBACK path (used
   *     when the bundle extractor returns null on an empty caption) emits the
   *     video record only when it has comments to anchor — a bare off-screen
   *     container it never inspected for comments produces no orphan node.
   *   • Comment with author but no text: skipped.
   *   • Trivially-short comment (<5 chars): skipped (signal-to-noise).
   */
  private _buildSplitPosts(
    container: HTMLElement,
    feedSource: FeedSource,
  ): PostContent[] {
    // Pass the skip-already-seen predicate so the bundle's maxComments cap
    // slides past comments emitted on prior passes. On a virtualized
    // permalink the first DEFAULT_BUNDLE_COMMENT_CAP rows are stamped
    // fwCommentSeen after the first extraction; without sliding the window
    // every subsequent scroll re-examines those same stamped rows, the
    // adapter skips all of them, and FW freezes after the first batch
    // (the "frozen at 14" regression). The same predicate runs in
    // findTikTokCommentRows so surface_order stays aligned.
    const result = extractTikTokBundle(container, {
      maxComments: DEFAULT_BUNDLE_COMMENT_CAP,
      // The bundle extractor applies this predicate before reading a row.
      skipRow: row => !!findChatOverlayAncestor(row) || isCommentRowSeen(row),
    });
    const snapshot = result.snapshot;

    // fallback path. extractTikTokBundle returns null when the
    // caption is missing/empty (music-only videos, "♬ original sound", etc.)
    // OR when the caption-bearing element rotated DOM and is no longer
    // queryable inside the container scope. The comments under those videos
    // still matter — emit comment-only records using the v2 extractor.
    //
    // Scope guard differs by surface:
    //   • Feed (`tiktok-feed`): extractCommentsFlat is page-scoped (reads the
    //     visible comment panel), so on /foryou we must only fire for the
    //     container that actually CONTAINS the visible comment list as a
    //     descendant — otherwise we'd attribute the same comments to many
    //     off-screen containers in the virtualized feed.
    //   • Permalink (`tiktok-permalink`): the page renders ONE focused video
    //     (`[data-e2e="video-detail"]`) plus a carousel of suggestion
    //     thumbnails (`[data-e2e="recommend-list-item-container"]`). The
    //     visible comment panel is a sibling of `video-detail`, not a
    //     descendant — modern TikTok 2026 builds wrap it in
    //     `[class*="DivCommentListContainer"]` virtualized DOM (per
    //     comment-extractors.ts:166-189). Restrict the fallback to the
    //     focused `video-detail` container so suggestion thumbnails don't
    //     re-emit the same comments, and detect the comment list at
    //     document scope to match the modern layout.
    if (!snapshot) {
      const surfaceKind = toPostSurfaceKind(detectTikTokRoutingSurface());

      let hasVisibleCommentList = false;
      if (surfaceKind === 'tiktok-permalink') {
        // Live MCP confirmed modern TikTok permalink DOM has NO
        // `[data-e2e="video-detail"]` element — all 15 containers carry
        // `[data-e2e="recommend-list-item-container"]` AND
        // `[data-scroll-index="N"]`. The URL-target focused video sits at
        // `data-scroll-index="0"`; the carousel suggestions are 1..N.
        // Scope the fallback to scroll-index 0 so suggestion thumbnails
        // don't re-emit the same comments. Comment-list detection stays
        // document-scoped because the panel is a sibling of the focused
        // article, not a descendant.
        if (!container.matches('[data-scroll-index="0"]')) return [];
        hasVisibleCommentList =
          document.querySelector(TT_COMMENT_PANEL_SELECTOR) !== null
          || document.querySelector(TT_COMMENT_ROW_SELECTOR) !== null
          || document.querySelector('[data-e2e="comment-list"]') !== null;
      } else {
        hasVisibleCommentList =
          container.querySelector(TT_COMMENT_ROW_SELECTOR) !== null
          || container.querySelector('[data-e2e="comment-list"]') !== null;
      }
      if (!hasVisibleCommentList) return [];

      // Resolve the comment scope once — the fallback's persisted comment
      // counter lives on it (fwCommentNextIdx below), so on the permalink
      // layout (panel is a document-scope SIBLING of the container) the
      // counter shares a lifetime with the stamped rows, not with the
      // video container.
      const fallbackCommentScope =
        surfaceKind === 'tiktok-permalink'
          ? resolvePublicTikTokCommentSearchScope(container)
          : container;
      const flatComments = extractCommentsFlat('tiktok', fallbackCommentScope);
      if (flatComments.length === 0) return [];
      // On a permalink the page URL exposes the actual video ID — prefer it
      // over a synthetic "tk-music-..." token so the forensic chain can
      // correlate comment records with the focused video. Fall through to
      // synth when the URL doesn't expose an ID (e.g. caption-empty feed
      // container that nonetheless has a visible comment panel descendant).
      const cardVideoIdMatch = container
        .querySelector<HTMLAnchorElement>('a[href*="/video/"]')
        ?.getAttribute('href')
        ?.match(/\/video\/(\d+)/) ?? null;
      const urlVideoIdMatch = window.location?.pathname?.match(/\/video\/(\d+)/) ?? null;
      const fallbackVideoId =
        cardVideoIdMatch?.[1]
        ?? readTikTokVideoIdFromXgWrapper(container)
        ?? (surfaceKind === 'tiktok-permalink' && urlVideoIdMatch
          ? urlVideoIdMatch[1]
          : getSyntheticVideoId(container));
      const ts = new Date().toISOString();
      const fallbackOut: PostContent[] = [];
      // Filter to UNSEEN comments BEFORE applying the cap — same window-
      // sliding fix as the bundle path. Slicing first would cap to the first
      // N flat comments, all of which carry fwCommentSeen after the first
      // pass, leaving the unseen tail permanently unprocessed (freeze).
      const flatSlice = flatComments
        .filter((c) => {
          const el = c.domRef?.deref() ?? null;
          return el?.dataset.fwCommentSeen !== 'true';
        })
        .slice(0, DEFAULT_BUNDLE_COMMENT_CAP);
      // sourceUrl for fallback-path comment records. On a permalink
      // window.location.href IS the video URL; on the For-You feed it's
      // the generic /foryou path so leave empty and let the bucket's
      // roomUrl carry the per-video context.
      const fallbackVideoUrl =
        surfaceKind === 'tiktok-permalink'
          ? currentPageAddress()
          : '';

      // Empty-caption video record. The bundle extractor returns null when
      // the caption is empty (music-only videos / "original sound"), so this
      // fallback path is the ONLY place such a video can be recorded. Every
      // distinct video whose comments enter the chain must also carry its own
      // video node (VISION §1.1 chain-mirror) — emit exactly one here, with
      // empty caption text. Dedup by identity: `dataset.fwCaptionEmitted`
      // guards same-container re-extraction; `emittedVideoIds` guards
      // cross-container remounts on a permalink (real URL id). Feed-path synth
      // ids have no stable cross-container identity, so the container stamp is
      // their sole guard. Only emit when there are unseen comments — a bare
      // off-screen container with no recorded comments produces no orphan
      // video node.
      const captionAlreadyEmitted =
        containerEmittedThisVideo(container, fallbackVideoId)
        || (hasRealVideoId(fallbackVideoId) && emittedVideoIds.has(fallbackVideoId));
      if (flatSlice.length > 0 && !captionAlreadyEmitted) {
        const authorPath = window.location?.pathname ?? '';
        // No trailing-slash requirement: a profile page is bare `/@handle`
        // (every video on it belongs to that handle). Requiring the slash
        // made all profile-feed videos stamp author='unknown', which then
        // denormalized roomAuthor='unknown' onto every comment under them.
        const fallbackAuthorMatch = authorPath.match(/^\/@([^/?#]+)/);
        const fallbackMetrics = extractTikTokVideoMetrics(container);
        fallbackOut.push({
          id: `tk-vid-${fallbackVideoId}`,
          text: '',
          author: fallbackAuthorMatch ? `@${fallbackAuthorMatch[1]}` : 'unknown',
          timestamp: ts,
          platform: 'tiktok' as const,
          domRef: new WeakRef(container),
          // Q53 (W56): parity with the bundle-path caption record. A
          // music-only sponsored TikTok was recorded organic because this
          // fallback skipped the same proven marker scan; recovery scope
          // and rail metrics ride along for the same parity reason.
          recoveryScopeRef: container.parentElement ? new WeakRef(container.parentElement) : undefined,
          feedSource,
          sourceUrl: fallbackVideoUrl,
          kind: 'video' as PostKind,
          parentVideoId: fallbackVideoId,
          // The card beyond the caption: the sound line and a duet or stitch line.
          card: cardForRecord(container, 'tiktok'),
          is_sponsored: extractIsTikTokSponsored(container) || undefined,
          platform_specific: {
            platform: 'tiktok' as const,
            surfaceKind,
            ...(fallbackMetrics ? { metrics: fallbackMetrics } : {}),
          },
        });
        stampContainerEmitted(container, fallbackVideoId);
        if (hasRealVideoId(fallbackVideoId)) emittedVideoIds.add(fallbackVideoId);
      }

      // Persistent counter across fallback re-entries (mirrors the
      // facebook.ts fwCommentNextIdx fix): `flatSlice` re-filters to UNSEEN
      // rows every pass, so a per-pass index restarts at 0 while the per-row
      // `fwCommentSeen` stamps persist — a comment lazy-loaded after the
      // first pass re-minted `tk-cmt-<videoId>-0`, the id of a DIFFERENT
      // first-pass comment, and id-level dedup downstream silently dropped
      // or overwrote one of the two forensic records. The counter only
      // advances on NEW pushes.
      let fallbackCmtIdx = parseInt(
        fallbackCommentScope.dataset.fwCommentNextIdx ?? '0',
        10,
      );
      for (const c of flatSlice) {
        // Per-comment dedup so lazy-loaded comments under an already-
        // processed container are surfaced exactly once. Mirrors the // facebook.ts pattern: stamp on the comment element AFTER push.
        const cmtDomEl = c.domRef?.deref() ?? null;
        if (cmtDomEl?.dataset.fwCommentSeen === 'true') continue;
        fallbackOut.push({
          id: `tk-cmt-${fallbackVideoId}-${fallbackCmtIdx++}`,
          text: c.text,
          // RawComment (from extractCommentsFlat / comment-extractors.ts) exposes
          // `authorHandle`, not `author`. The bundle path's snapshot.comments
          // shape uses `author`; these are different types — don't unify here.
          author: c.authorHandle && c.authorHandle !== 'unknown' ? `@${c.authorHandle.replace(/^@/, '')}` : 'unknown',
          timestamp: ts,
          platform: 'tiktok' as const,
          // prefer per-comment DOM
          // WeakRef when the extractor captured it; fall back to container-
          // level WeakRef on extractors that haven't been updated.
          domRef: c.domRef ?? new WeakRef(container),
          feedSource,
          sourceUrl: fallbackVideoUrl,
          // new kind values + Encounter signals. The fallback path
          // covers music-only videos where the bundle extractor returned null;
          // all surfaced comments are top-level (no level-2 traversal in fallback).
          kind: 'top-comment' as PostKind,
          depth: 1 as 1,
          parent_id: fallbackVideoId,
          parentVideoId: fallbackVideoId,
          platform_specific: {
            platform: 'tiktok' as const,
            surfaceKind,
            commentLevel: 1 as 1,
          },
        });
        if (cmtDomEl) cmtDomEl.dataset.fwCommentSeen = 'true';
      }
      // Persist the counter so the next fallback pass continues from where
      // this one left off, keeping `tk-cmt-<videoId>-<idx>` chain IDs unique.
      fallbackCommentScope.dataset.fwCommentNextIdx = String(fallbackCmtIdx);
      return fallbackOut;
    }

    const out: PostContent[] = [];
    const videoId = snapshot.post.id;
    const captionAuthor = snapshot.post.author && snapshot.post.author !== 'unknown'
      ? `@${snapshot.post.author.replace(/^@/, '')}`
      : 'unknown';
    const ts = new Date().toISOString();

    // 1. Video record — one per distinct video, even when the caption is
    //    empty (music-only TikToks / "original sound"). Every distinct video
    //    for which the chain records at least one comment must also carry its
    //    own signed video node (VISION §1.1 chain-mirror) — an empty caption
    //    is still a recorded video, not a missing one. Dedup is by video
    //    IDENTITY: `dataset.fwCaptionEmitted` guards same-container
    //    re-extraction, `emittedVideoIds` guards cross-container virtualizer
    //    remounts (keyed on the real URL video id; synthetic ids skip the set
    //    and rely on the container stamp alone). A root that previously reached
    //    a full sponsored-card hide may claim one reprocessing pass when TikTok
    //    removes that hide state during rehydration.
    const isSponsored = extractIsTikTokSponsored(container);
    // Two one-shot sponsored reprocess claims: a previously HIDDEN ad whose
    // root remounted (M70), and a previously ORGANIC caption whose exact ad
    // marker hydrated late (M94). Both require the same real video id.
    const reprocessSponsoredAd = claimTikTokAdRemount(container, videoId, isSponsored)
      || claimTikTokLateAdMarker(container, videoId, isSponsored);
    const captionAlreadyEmitted = !reprocessSponsoredAd && (
      containerEmittedThisVideo(container, videoId)
      || (hasRealVideoId(videoId) && emittedVideoIds.has(videoId))
    );
    if (!captionAlreadyEmitted) {
      // ( Day 7) — populate `context` on the caption
      // record with up to 3 sibling comments so the LLM sees discourse
      // when scoring the caption. Convention matches
      // `formatBundleForCombinedPrompt`'s "Top reactions" block (one
      // `• @author: text` per line). Per-comment cap mirrors the formatter.
      // Comment records themselves do NOT carry context this turn —
      // sibling-comment context for individual comments is a separate
      // (larger-scope) gate; the caption is the highest-leverage surface
      // for discourse-aware detection.
      const ctxSamples = snapshot.comments
        .filter(c => c.text && c.text.trim().length > 0)
        .slice(0, 3)
        .map(c => {
          const handle = c.author && c.author !== 'unknown'
            ? (c.author.startsWith('@') ? c.author : `@${c.author}`)
            : '';
          const body = c.text.trim().slice(0, 280);
          return handle ? `• ${handle}: ${body}` : `• ${body}`;
        });
      const captionContext = ctxSamples.length > 0 ? ctxSamples.join('\n') : undefined;

      // Video engagement metrics from the action rail (likes/comments/shares).
      const videoMetrics = extractTikTokVideoMetrics(container);

      out.push({
        id: `tk-vid-${videoId}`,
        text: snapshot.post.text,
        author: captionAuthor,
        timestamp: ts,
        platform: 'tiktok',
        domRef: new WeakRef(container),
        recoveryScopeRef: container.parentElement ? new WeakRef(container.parentElement) : undefined,
        feedSource,
        sourceUrl: snapshot.post.source_url,
        kind: 'video',
        parentVideoId: videoId,
        context: captionContext,
        // The card beyond the caption: the sound line and a duet or stitch line.
        card: cardForRecord(container, 'tiktok'),
        is_sponsored: isSponsored || undefined,
        // Q52 (W55): the caption record carries surfaceKind like its three
        // sibling record shapes; without it the chain payload lost the
        // permalink-vs-feed provenance.
        platform_specific: {
          platform: 'tiktok',
          surfaceKind: toPostSurfaceKind(detectTikTokRoutingSurface()),
          ...(videoMetrics ? { metrics: videoMetrics } : {}),
        },
      });
      stampContainerEmitted(container, videoId);
      if (hasRealVideoId(videoId)) {
        emittedVideoIds.add(videoId);
        // M94: an organic emission may still become an ad — TikTok can
        // hydrate the exact marker after this pass. Remember it so the
        // periodic rescan can claim one sponsored reprocess.
        if (!isSponsored) rememberTikTokOrganicCaption(container, videoId);
      }
    }

    // 2. Comment records — one per visible comment with substantive text.
    //
    // Encounter signals per PER_PLATFORM_V1_SPEC §5.2. The bundle extractor
    // (extractTikTokBundle) mines top-level comments only, so all
    // snapshot.comments are L1 / depth=1 / kind='top-comment'. Per-comment
    // likes come from the bundle's readLikeCount; per-comment flags
    // (creator/pinned/hearted) require a fresh DOM walk because the bundle
    // doesn't surface them. Match by surface_order index against the page's
    // comment ROW elements — both walks visit the same DOM ranges in the
    // same order, so row[i] is the row holding comment[i].
    const surfaceKind = toPostSurfaceKind(detectTikTokRoutingSurface());
    const commentRows = findTikTokCommentRows(container);
    // sourceUrl for comment records — use the snapshot's video URL
    // (built from caption author + video id) so the dashboard's "View
    // original" lands on the parent video. Per-comment deep-link via
    // `?comment_id=<cid>` is structurally unavailable: live MCP DOM
    // probe 2026-05-22 confirmed TikTok only exposes the cid inside
    // the share-popover, never on the row DOM itself. The parent
    // video URL is strictly better than the prior `undefined` which
    // forced buildPostUrl through the synthetic-UUID / location.href
    // fallback (wrong on the For-You feed).
    const commentVideoUrl =
      snapshot.post.source_url
      || (typeof window !== 'undefined'
          && /\/@[^/]+\/video\/\d+/.test(window.location?.pathname ?? '')
            ? currentPageAddress()
            : '');
    for (const c of snapshot.comments) {
      const text = (c.text ?? '').trim();
      if (text.length < 5) {
        // Silent until 2026-09-19. Facebook's modern walker drops on the same
        // floor and records it; this one did not, so a real short comment left
        // no trace in the record and none in a counter either. Counted on the
        // same terms; the floor is unchanged, because picking a new number by
        // feel is how the old ones got here.
        if (text.length > 0) bumpCounter('shortDrop.tiktok.comment');
        continue;
      }
      const cmtAuthor = c.author && c.author !== 'unknown'
        ? `@${c.author.replace(/^@/, '')}`
        : 'unknown';

      // Recover the per-comment ROW element by surface_order. The bundle's
      // `surface_order` matches the row index because both walks iterate
      // top-level comments in DOM order. Fall back to undefined when
      // out-of-bounds (defensive — shouldn't happen on current TikTok DOM).
      const commentEl = commentRows[c.surface_order];
      // Per-comment dedup so lazy-loaded comments inside an already-emitted
      // container surface exactly once across re-extractions. Mirrors the
      // facebook.ts pattern. Comments with no recoverable row
      // (out-of-bounds against commentRows) fall back to single-emit per
      // the legacy container-domRef path. Stamping on the row (not the
      // inner text-wrapper SPAN) keeps dedup state at the right granularity
      // so a future row-rotation that re-uses inner text-wrappers can't
      // collide.
      if (commentEl?.dataset.fwCommentSeen === 'true') continue;
      const flags = commentEl
        ? extractTikTokCommentFlags(commentEl)
        : { isCreator: false, isPinned: false, isCreatorHearted: false };
      // Anchor domRef on the body text element so the marker (rendered as
      // a child of `el` in `renderTeenMarker`) mounts inline next to the
      // visible text — matching the X / FB pattern. Anchoring on the row
      // results in a marker that React reconciliation removes within a
      // tick because the row is a styled-components composite and accepts
      // only its declared children. The row is still recovered for stamp
      // clearing via the SHELL_SELECTOR `[class*="DivCommentItemWrapper"]`
      // walk in `viewport-tracker.ts`.
      const bodyEl = commentEl ? findTikTokRowBodyEl(commentEl) : null;
      const domRefTarget = bodyEl ?? commentEl ?? container;

      out.push({
        id: `tk-cmt-${videoId}-${c.id}`,
        text,
        author: cmtAuthor,
        timestamp: ts,
        platform: 'tiktok',
        domRef: new WeakRef(domRefTarget),
        feedSource,
        sourceUrl: commentVideoUrl,
        // new kind values + Encounter signals.
        kind: 'top-comment',
        depth: 1,
        parent_id: videoId,
        parentVideoId: videoId,
        platform_specific: {
          platform: 'tiktok',
          surfaceKind,
          commentLevel: 1,
          metrics: {
            likes: c.likes,
            reply_count: c.replies_count,
          },
          isCreator: flags.isCreator,
          isPinned: flags.isPinned,
          isCreatorHearted: flags.isCreatorHearted,
        },
      });
      if (commentEl) commentEl.dataset.fwCommentSeen = 'true';
    }

    return out;
  }

  private _detectFeedSource(): FeedSource {
    const path = window.location.pathname;
    if (path === '/' || path === '/foryou' || path.startsWith('/for-you')) return 'for-you';
    if (path.startsWith('/following')) return 'following';
    if (path.startsWith('/@')) return 'profile';
    if (path.startsWith('/search') || path.startsWith('/tag/')) return 'search';
    return 'unknown';
  }
}
