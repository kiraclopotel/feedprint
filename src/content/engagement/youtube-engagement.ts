// FeelingWise - YouTube engagement control
// Routes by feature toggles per-platform: metric counts, action buttons, and
// comment-posting are independently gated. Covers both /watch pages and the
// /shorts surface; element-name selectors are stable across both, so no
// surface-aware branching is needed (selectors that don't match on a given
// surface are no-ops).

import type { FWSettings } from '../../storage/settings';
import { isFeatureEnabled } from '../../storage/settings';
import { markHidden, unmarkHidden } from './mark-hidden';
import { noteSelectorFamilySweep } from './selector-family-miss';
import { createRafBodyObserver, trailingThrottle } from '../post-path/raf-observer';
import { ensureStyleTag, removeStyleTag } from './style-tag';

const YOUTUBE_PLATFORM = 'youtube' as const;

// ─── Style tag IDs ───

const METRICS_CSS_ID = 'fw-youtube-metrics-css';
const ACTIONS_CSS_ID = 'fw-youtube-actions-css';
const COMMENT_BLOCK_CSS_ID = 'fw-youtube-comment-block-css';

// ─── Helpers ───

// ─── Selectors ───
//
// Element names and IDs are YT's stable surface (CSS classes rotate). The
// design-system text-content class has TWO live forms — pre-2026-05-24 YT
// shipped kebab-with-underscore (`.yt-spec-button-shape-next__button-text-content`)
// and the current rollout (verified live 2026-05-24 on /watch) ships camelCase
// (`.ytSpecButtonShapeNextButtonTextContent`). Both are kept here: kebab as
// backward-compat for any subset of users still on the old build, camelCase
// as forward-compat for the current rotation. The previous absence of the
// camelCase form left the "19M" like-count visible on /watch despite the
// metrics toggle being ON (found 2026-05-24).

const COUNT_SELECTORS = [
  // Watch page: like / dislike button text (kebab + camelCase variants)
  'like-button-view-model .yt-spec-button-shape-next__button-text-content',
  'like-button-view-model .ytSpecButtonShapeNextButtonTextContent',
  'dislike-button-view-model .yt-spec-button-shape-next__button-text-content',
  'dislike-button-view-model .ytSpecButtonShapeNextButtonTextContent',
  // Watch page: view count + comment-count header
  'ytd-watch-info-text',
  'ytd-video-view-count-renderer',
  '#info-container > span',
  '#info-container .ytd-watch-info-text',
  'ytd-comments-header-renderer',
  'ytd-comments-header-renderer #count',
  'ytd-comments-header-renderer h2 yt-formatted-string',
  // Per-comment likes
  'ytd-comment-view-model #vote-count-middle',
  // Subscribe count. The subscribe-button form is legacy (0 matches on live
  // /watch, verified via Chrome MCP 2026-08-18); current DOM renders it as
  // #owner-sub-count inside the video-owner block (verified on two /watch
  // pages same day). Both kept: legacy as no-op back-compat.
  'ytd-subscribe-button-renderer #subscriber-count',
  'ytd-video-owner-renderer #owner-sub-count',
  // Shorts action rail counts (kebab + camelCase + older shapes)
  'ytd-reel-video-renderer .yt-spec-button-shape-next__button-text-content',
  'ytd-reel-video-renderer .ytSpecButtonShapeNextButtonTextContent',
  'ytd-reel-video-renderer #like-button #text',
  'ytd-reel-video-renderer #dislike-button #text',
  'ytd-reel-video-renderer #comments-button #text',
  // `reel-action-bar-view-model` numeric chips (post-2026-05-24 DOM) are
  // now handled by section-model's Pass 2 — span elements containing
  // pure-numeric text get tagged + display:none'd, while sibling spans
  // with non-numeric text ("Share" / "Remix" / "Dislike") are skipped.
  // The previous selector here matched the entire label subtree and hid
  // the action buttons whole; the programmatic /\d/.test() filter the
  // earlier note flagged as the right fix IS section-model.findCountChips.
];

// The view count on a video tile: the home grid, the list beside a video, search results. Hidden by
// the stylesheet alone, never by a walk: the count-chip walk of the whole page is what crashed
// YouTube tabs (see startYouTubeEngagementControl). A tile's metadata has no element names below its
// rows, so the design-system classes are the handle. YouTube draws its view icon right before the
// count, wherever the count sits: in a row of its own, or after the channel names on a channel's
// Videos tab, or first on a playlist page whose tiles have no channel row (read on those pages
// signed out). The icon, the count and the dot after it go; the channel names and the date stay.
// The row rule keeps a count drawn without the icon: what comes before the first dot of a row after
// the channel row, so a playlist's own "Channel • Playlist" row stays. The older tile body puts the
// count first of two parts.
export const TILE_COUNT_SELECTORS = [
  'yt-content-metadata-view-model .ytContentMetadataViewModelLeadingIcon',
  'yt-content-metadata-view-model .ytContentMetadataViewModelLeadingIcon + .ytContentMetadataViewModelMetadataText',
  'yt-content-metadata-view-model .ytContentMetadataViewModelLeadingIcon + .ytContentMetadataViewModelMetadataText + .ytContentMetadataViewModelDelimiter',
  'yt-content-metadata-view-model > .ytContentMetadataViewModelMetadataRow:nth-child(n+2):has(> .ytContentMetadataViewModelDelimiter) > :not(.ytContentMetadataViewModelDelimiter ~ *)',
  'ytd-video-meta-block #metadata-line:has(> .inline-metadata-item ~ .inline-metadata-item) > .inline-metadata-item:not(.inline-metadata-item ~ *)',
];

const ACTION_SELECTORS = [
  // Watch page: action row buttons + overflow menu
  'like-button-view-model',
  'dislike-button-view-model',
  'share-button-view-model',
  'ytd-menu-renderer.ytd-watch-metadata',
  // Subscribe, and Join (the paid channel membership, read signed out
  // 2026-10-09 beside Subscribe on a watch page; the tester's finding 6)
  'ytd-subscribe-button-renderer',
  '#subscribe-button',
  '#sponsor-button',
  // Shorts action rail
  'ytd-reel-video-renderer #like-button',
  'ytd-reel-video-renderer #dislike-button',
  'ytd-reel-video-renderer #comments-button',
  'ytd-reel-video-renderer #share-button',
  'ytd-reel-player-overlay-renderer #actions',
];

const COMMENT_BLOCK_SELECTORS = [
  // /watch header + composer entry row (rendered EAGERLY before ytd-comments
  // appears below the player). Pre-2026-05-24 these were missing → /watch
  // showed "239 Comments" header + composer even with block-posting ON.
  // /shorts worked because the engagement-panel selector below caught it.
  'ytd-comments-header-renderer',
  'ytd-comments-entry-point-header-renderer',
  'ytd-comment-dialog-renderer',
  // /watch threads pane (lazy-loaded after scroll).
  'ytd-comments#comments',
  // Scoped under the comments pane (Q31/A14): the bare id-anchored form hid
  // whatever renderer happened to carry id="sections" on the current
  // surface, a whole-section hide with no comment relationship.
  'ytd-comments#comments ytd-item-section-renderer#sections',
  'ytd-comment-thread-renderer',
  // Legacy composer shells. Modern YT replaced with the dialog/header
  // pattern above; these stay as dead no-ops for older Polymer-2 builds
  // still in the wild on outdated Chrome installs.
  'ytd-comment-simplebox-renderer',
  '#simple-box',
  '#placeholder-area',
  // /shorts side-panel — confirmed working pre-#34, kept.
  'ytd-engagement-panel-section-list-renderer[target-id*="comments"]',
];

// ─── Control functions ───

function controlMetrics(settings: FWSettings): void {
  const hideMetrics = isFeatureEnabled(settings, 'hide-engagement-metrics', YOUTUBE_PLATFORM);
  if (!hideMetrics) return;

  // Pre-2026-05-24 there was an `if (hideActions || !hideMetrics) return;`
  // precedence rule: "if actions are hidden, counts inside them are already
  // gone via parent display:none — no need to also stamp them." That
  // assumption was WRONG. Many YT metrics live outside action buttons:
  //   • View count (ytd-watch-info-text / ytd-video-view-count-renderer)
  //   • Comments header ("123 Comments" via ytd-comments-header-renderer)
  //   • Subscriber count (ytd-subscribe-button-renderer #subscriber-count)
  // Skipping controlMetrics whenever hideActions was on left ALL of those
  // visible. A live report, 2026-05-24: "hide action buttons → comment
  // metrics reappear". Fix: always run when hideMetrics is on; rely on
  // per-element dataset.fwYtMetric dedup to keep already-hidden elements
  // from being re-stamped, and the inline visibility:hidden inside an
  // already-display:none parent is a free no-op.

  ensureStyleTag(METRICS_CSS_ID, `
    [data-fw-yt-metric="hidden"] {
      visibility: hidden !important;
    }
    ${TILE_COUNT_SELECTORS.join(',\n    ')} {
      display: none !important;
    }
  `);

  let matched = 0;
  for (const sel of COUNT_SELECTORS) {
    document.querySelectorAll<HTMLElement>(sel).forEach(el => {
      matched += 1;
      if (!markHidden(el, {
        marker: 'data-fw-yt-metric', value: 'hidden',
        reason: 'hide-engagement-metrics:youtube',
      })) return;
      el.style.setProperty('visibility', 'hidden', 'important');
    });
  }
  // W88: report only on /watch + /shorts, mirroring the comment-block guard
  // below. The family's selectors target watch/shorts renderers; on the home
  // feed, search and channel routes a zero-match sweep is the normal outcome,
  // and reporting there flooded the health surface with structural misses
  // (the selector-health LABELING RULE failure mode) — the owner's 2026-08-18
  // "100% miss" diagnostics read for this family.
  if (/^\/(watch|shorts)/.test(location.pathname)) {
    noteSelectorFamilySweep('youtube.engagement-metrics', matched);
  }
}

function controlActions(settings: FWSettings): void {
  const hideActions = isFeatureEnabled(settings, 'hide-action-buttons', YOUTUBE_PLATFORM);
  if (!hideActions) return;

  ensureStyleTag(ACTIONS_CSS_ID, `
    [data-fw-yt-action="hidden"] {
      display: none !important;
      visibility: hidden !important;
    }
  `);

  let matched = 0;
  for (const sel of ACTION_SELECTORS) {
    document.querySelectorAll<HTMLElement>(sel).forEach(el => {
      matched += 1;
      if (!markHidden(el, {
        marker: 'data-fw-yt-action', value: 'hidden',
        reason: 'hide-action-buttons:youtube',
      })) return;
      el.style.setProperty('display', 'none', 'important');
    });
  }
  // W88: same /watch + /shorts guard as the metrics family above — action
  // buttons only exist on those surfaces.
  if (/^\/(watch|shorts)/.test(location.pathname)) {
    noteSelectorFamilySweep('youtube.action-buttons', matched);
  }
}

function controlCommentPosting(settings: FWSettings): void {
  const blockPosting = isFeatureEnabled(settings, 'block-comment-posting', YOUTUBE_PLATFORM);
  if (!blockPosting) return;

  ensureStyleTag(COMMENT_BLOCK_CSS_ID, `
    [data-fw-yt-comment-block="hidden"] {
      display: none !important;
      visibility: hidden !important;
    }
  `);

  let matched = 0;
  for (const sel of COMMENT_BLOCK_SELECTORS) {
    document.querySelectorAll<HTMLElement>(sel).forEach(el => {
      matched += 1;
      if (!markHidden(el, {
        marker: 'data-fw-yt-comment-block', value: 'hidden',
        reason: 'block-comment-posting:youtube',
      })) return;
      el.style.setProperty('display', 'none', 'important');
    });
  }
  // Comment surfaces only exist on /watch and /shorts; other routes finding
  // nothing is normal, and reporting there would be pure noise.
  if (/^\/(watch|shorts)/.test(location.pathname)) {
    noteSelectorFamilySweep('youtube.comment-block', matched);
  }
}

// ─── Cleanup ───

function resetDataAttributes(): void {
  document.querySelectorAll<HTMLElement>('[data-fw-yt-metric]').forEach(el => {
    unmarkHidden(el, 'data-fw-yt-metric');
    el.style.removeProperty('visibility');
  });
  document.querySelectorAll<HTMLElement>('[data-fw-yt-action]').forEach(el => {
    unmarkHidden(el, 'data-fw-yt-action');
    el.style.removeProperty('display');
    el.style.removeProperty('visibility');
  });
  document.querySelectorAll<HTMLElement>('[data-fw-yt-comment-block]').forEach(el => {
    unmarkHidden(el, 'data-fw-yt-comment-block');
    el.style.removeProperty('display');
    el.style.removeProperty('visibility');
  });
}

// ─── Main entry point ───

// Minimum gap between full-page sweeps. runAll scans the whole YouTube DOM
// (~40 querySelectorAll across metrics + actions + comment-posting); the rAF
// body observer below fires on YouTube's near-constant mutations — effectively
// ~60x/sec during playback/scroll. Unthrottled, that sustained full-page work
// is the renderer-OOM pressure source (the node queue was exonerated at peak
// 27 — this is constant work, not a pile-up; 2026-06-06 youtube-crash-hunt).
// 750ms keeps counts hiding within ~1s of a tile loading (cosmetic) while
// cutting the sweep rate ~45x.
const RUN_THROTTLE_MS = 750;

export function startYouTubeEngagementControl(settings: FWSettings): () => void {
  function runAll(): void {
    controlMetrics(settings);
    controlActions(settings);
    controlCommentPosting(settings);
  }
  // Trailing throttle: a burst inside the window schedules one sweep for the
  // end of the window instead of dropping it (a dropped call left a fresh
  // tile's counts visible until the 2 s poll). Bursty callers still cannot
  // drive the sweep faster than RUN_THROTTLE_MS.
  const sweep = trailingThrottle(runAll, RUN_THROTTLE_MS);
  sweep.call();

  // rAF-debounced body observer — now THROTTLED so YouTube's constant DOM churn
  // can't drive a ~60x/sec full-page sweep (the recurring renderer crash). The
  // sweep stays active on /watch (counts must keep hiding) — throttled, not
  // disabled. See src/content/post-path/raf-observer.ts header for the YT-SPA-nav story.
  const { cleanup: cleanupObserver } = createRafBodyObserver(sweep.call);

  // Polling fallback. Independent of rAF so it still ticks when the tab is
  // backgrounded (browsers throttle rAF when hidden, but setInterval keeps
  // running, just slowed). The 2s cadence is above the throttle window, so
  // this always sweeps.
  const interval = setInterval(sweep.call, 2000);

  // Section-model overlay (2026-05-24). controlMetrics targets specific
  // YT renderers (ytd-comments-header, view-count-renderer, subscribe
  // count). The section-model catches what those selectors miss — main-
  // page video-tile view counts ("1.5K views"), recommended-row metrics,
  // comment-thread numeric leaves. Idempotent + throttled; the inline
  // display:none stamps don't conflict with controlMetrics' visibility:
  // hidden stamps (different elements, additive coverage).
  // Count-chip body-walk DISABLED on ALL of YouTube (2026-06-06). It runs
  // document.body.querySelectorAll('span,a,strong,b,bdi,button,[role=button],div')
  // — nearly every element — every 250ms. The earlier /watch-only gate left it
  // active on the infinite-scroll HOME feed, where it kept driving the renderer
  // out of memory (the crash was on youtube.com home, not /watch). The hunt's
  // verdict: this body-walk is fundamentally wrong for YouTube's enormous,
  // constantly-growing DOM. controlMetrics' targeted COUNT_SELECTORS still hide
  // the primary counts (like/dislike/view/comment-header/subscriber), and the
  // tiles' view counts are hidden by TILE_COUNT_SELECTORS in the same
  // stylesheet, which costs no walk. Never bring back a scan of document.body.
  const stopChipScan = () => {};

  return () => {
    cleanupObserver();
    sweep.cancel();
    clearInterval(interval);
    stopChipScan();
    removeStyleTag(METRICS_CSS_ID);
    removeStyleTag(ACTIONS_CSS_ID);
    removeStyleTag(COMMENT_BLOCK_CSS_ID);
    resetDataAttributes();
  };
}
