// FeelingWise - Engagement control entry point
// Single controller that reads settings, decides what should happen,
// and delegates to platform-specific engagement modules.
// Handles runtime mode/settings changes with full teardown → reset → restart.
//
// / routes by FeatureToggles (per-platform overrides
// honored), not by `mode`. The legacy `videoControls` blob (removed at v12) is no longer
// consulted here; feature toggles + per-platform precedence give parents
// per-feature, per-platform control.

import type { Platform } from '../../types/post';
import type { FWSettings } from '../../storage/settings';
import { getSettings, isFeatureEnabled } from '../../storage/settings';
import { isContextAlive } from '../../storage/context-guard';
import { loadRepairs, REPAIRS_STORAGE_KEY } from '../../core/repairs/store';
import { setRepairEventSink } from '../../core/repairs/families';
import { recordFinderEvent } from '../../diagnostics/finder-ledger';
import { bumpCounter } from '../../diagnostics/diagnostics';
import { startTikTokEngagementControl } from './tiktok-engagement';
import { startTwitterEngagementControl } from './twitter-engagement';
import { startInstagramEngagementControl } from './instagram-engagement';
import { startFacebookEngagementControl } from './facebook-engagement';
import { startYouTubeEngagementControl } from './youtube-engagement';
import {
  startEmojiStripper,
  EMOJI_STRIPPER_STYLE_TAG_ID,
  EMOJI_STRIPPER_HIDDEN_MARKER,
} from './emoji-stripper';
import {
  startEmptyCommentHider,
  EMPTY_COMMENT_STYLE_TAG_ID,
  EMPTY_COMMENT_MARKER,
} from './empty-comment-hide';
import {
  startAiContentBlocker,
  AI_CONTENT_BLOCKER_STYLE_TAG_ID,
  AI_CONTENT_BLOCKED_MARKER,
  AI_CONTENT_BLOCK_REASON_MARKER,
} from './ai-content-blocker';
import {
  startReelsBlocker,
  REELS_BLOCKER_STYLE_TAG_ID,
  REELS_BLOCKED_MARKER,
  REELS_BLOCK_REASON_MARKER,
  REELS_BLOCKED_VALUE,
  REELS_COVER_NOTE_ID,
} from './reels-blocker';
import {
  startMediaTimeout,
  mediaTimeoutHasWork,
  MEDIA_TIMEOUT_OVERLAY_ID,
  MEDIA_TIMEOUT_STYLE_TAG_ID,
  MEDIA_TIMEOUT_BODY_MARKER,
} from './media-timeout';
import { startSidebarAdBlocker } from './sidebar-ad-blocker';
import { startMediaOnlyAdBlocker } from './media-only-ad-blocker';
import { startFeedAdBlocker } from './feed-ad-blocker';
import { startWordFilter, resetWordFilterDOM, WORD_FILTER_STYLE_TAG_ID } from './word-filter';
import { startPickedBlocks, startPicker } from './picker';
import { startSurfaceSwitches, resetSurfaceDOM } from './surface-switches';
import { startYouTubeFeeds, resetYouTubeFeedsDOM, YOUTUBE_FEED_FEATURES, YT_FEEDS_STYLE_ID } from './youtube-feeds';
import { PLAYER_AD_STYLE_ID } from './youtube-player-ad';
import { SURFACE_FEATURE_IDS } from '../../storage/settings';
import { isOffProduct } from '../../product';
import { withFeedprintScope } from '../../storage/switch-scope';
import { stopWhenFeedprintGoes, type RecorderFamily } from './recorder-runs';

// ─── Style tag IDs (must match platform modules) ───

const STYLE_TAG_IDS = [
  'fw-tiktok-action-rail-css',
  'fw-tiktok-comment-section-css',
  'fw-tiktok-post-block-css',
  'fw-tiktok-sticker-comment-css',
  'fw-twitter-engagement-css',
  // (post-pivot): Instagram + Facebook engagement modules.
  'fw-instagram-metrics-css',
  'fw-instagram-actions-css',
  'fw-instagram-comment-block-css',
  'fw-facebook-metrics-css',
  'fw-facebook-actions-css',
  'fw-facebook-comment-block-css',
  'fw-youtube-metrics-css',
  'fw-youtube-actions-css',
  'fw-youtube-comment-block-css',
  // emoji stripper (cross-platform).
  EMOJI_STRIPPER_STYLE_TAG_ID,
  // empty-comment hider (cross-platform; runs after
  // upstream sanitization to drop wrappers whose body text was reduced
  // to nothing).
  EMPTY_COMMENT_STYLE_TAG_ID,
  // AI-content blocker (cross-platform; rule-based
  // pre-empt for the AI-fruit / #fruitdrama trend).
  AI_CONTENT_BLOCKER_STYLE_TAG_ID,
  // Reels blocker (cross-platform; URL-gated hide for reel / shorts
  // surfaces on Instagram, Facebook, YouTube).
  REELS_BLOCKER_STYLE_TAG_ID,
  // Media timeout (cross-platform; parent-triggered overlay covering the
  // entire viewport on every supported platform until the parent toggles
  // off).
  MEDIA_TIMEOUT_STYLE_TAG_ID,
  // Word filter (Off only): the user's list, slurs, swearing.
  WORD_FILTER_STYLE_TAG_ID,
  // YouTube's home feed and recommended videos.
  YT_FEEDS_STYLE_ID,
  // The video ad in YouTube's player (Off, Block ads).
  PLAYER_AD_STYLE_ID,
];

// ─── Settings → Active Decision ───
//
// Engagement control runs whenever ANY of the engagement-shaped features is
// on for this platform. Educational replacement also needs the controller to
// keep the comment section discoverable so the video pipeline can inject;
// it's included in the activation check.
//
// Exported for unit test coverage — the activation predicate IS the policy
// surface and deserves direct boolean tests independent of DOM scaffolding.
export function shouldControlEngagement(
  platform: Platform,
  settings: FWSettings,
): boolean {
  // In Off the word filter's slur rule is always on, so the controller
  // always has work; the per-feature gates below decide the rest.
  if (isOffProduct()) return true;
  return (
    isFeatureEnabled(settings, 'hide-engagement-metrics', platform) ||
    isFeatureEnabled(settings, 'hide-action-buttons', platform) ||
    isFeatureEnabled(settings, 'block-comment-posting', platform) ||
    // `replace-toxic-with-educational` removed.
    isFeatureEnabled(settings, 'rewritten-comments-first', platform) ||
    // strip-emojis is a parallel cosmetic mutation;
    // the controller activates if it's the only thing on so the stripper
    // still runs even when no other engagement feature is active.
    isFeatureEnabled(settings, 'strip-emojis', platform) ||
    // block-ai-content also activates the controller
    // unconditionally per-platform. Without this gate, parents who turn off
    // every other engagement feature would silently lose AI blocking.
    isFeatureEnabled(settings, 'block-ai-content', platform) ||
    // block-reels activates the controller per-platform on the same
    // standalone basis — without this gate, parents who only want the
    // reel-surface block would not get the engagement controller started.
    isFeatureEnabled(settings, 'block-reels', platform) ||
    // media-timeout is a parent-triggered platform-wide block; activates
    // the controller per-platform on the same standalone basis. A toggle
    // that is OFF but carries a quiet-hours schedule still counts as work,
    // or the schedule would never get a tick to run on.
    mediaTimeoutHasWork(settings, platform) ||
    // block-ads activates the controller so the sidebar/banner ad remover runs
    // (feed ads are handled by the pipeline, not the controller).
    isFeatureEnabled(settings, 'block-ads', platform) ||
    SURFACE_FEATURE_IDS.some(id => isFeatureEnabled(settings, id, platform)) ||
    YOUTUBE_FEED_FEATURES.some(id => isFeatureEnabled(settings, id, platform)) ||
    // A box the person picked on this site is hidden whatever the switches say.
    (settings.pickedBlocks ?? []).some(p => p.platform === platform)
  );
}

// ─── DOM Reset ───

function resetEngagementDOM(): void {
  // Remove all injected style tags
  for (const id of STYLE_TAG_IDS) {
    document.getElementById(id)?.remove();
  }

  // Clean action rail markers (TikTok)
  document.querySelectorAll<HTMLElement>('[data-fw-action-rail]').forEach(el => {
    delete el.dataset.fwActionRail;
    el.style.removeProperty('display');
    el.style.removeProperty('visibility');
    // Restore count element visibility inside the rail
    const countSelectors = [
      '[data-e2e="like-count"]',
      '[data-e2e="comment-count"]',
      '[data-e2e="share-count"]',
      '[data-e2e="undefined-count"]',
    ];
    for (const sel of countSelectors) {
      el.querySelectorAll<HTMLElement>(sel).forEach(count => {
        count.style.removeProperty('visibility');
      });
    }
  });

  // Clean action row markers (Twitter)
  document.querySelectorAll<HTMLElement>('[data-fw-action-row]').forEach(el => {
    delete el.dataset.fwActionRow;
    el.style.removeProperty('display');
    el.style.removeProperty('visibility');
    el.style.removeProperty('height');
    el.style.removeProperty('overflow');
    // Restore count spans inside buttons
    el.querySelectorAll<HTMLElement>('span').forEach(span => {
      span.style.removeProperty('visibility');
    });
    // Restore analytics links
    el.querySelectorAll<HTMLElement>('a[href*="/analytics"]').forEach(link => {
      link.style.removeProperty('display');
    });
  });

  // Clean comment section markers (TikTok)
  document.querySelectorAll<HTMLElement>('[data-fw-comment-section]').forEach(el => {
    delete el.dataset.fwCommentSection;
    el.style.removeProperty('display');
    el.style.removeProperty('visibility');
  });

  // Clean post-blocked markers (TikTok)
  document.querySelectorAll<HTMLElement>('[data-fw-post-blocked]').forEach(el => {
    delete el.dataset.fwPostBlocked;
    el.style.removeProperty('display');
  });

  // Clean sticker-hidden markers (TikTok)
  document.querySelectorAll<HTMLElement>('[data-fw-sticker-hidden]').forEach(el => {
    delete el.dataset.fwStickerHidden;
    el.style.removeProperty('display');
  });

  // Clean YouTube markers (metrics / actions / comment-block).
  document.querySelectorAll<HTMLElement>('[data-fw-yt-metric]').forEach(el => {
    delete el.dataset.fwYtMetric;
    el.style.removeProperty('visibility');
  });
  document.querySelectorAll<HTMLElement>('[data-fw-yt-action]').forEach(el => {
    delete el.dataset.fwYtAction;
    el.style.removeProperty('display');
    el.style.removeProperty('visibility');
  });
  document.querySelectorAll<HTMLElement>('[data-fw-yt-comment-block]').forEach(el => {
    delete el.dataset.fwYtCommentBlock;
    el.style.removeProperty('display');
    el.style.removeProperty('visibility');
  });

  // un-hide emoji <img> elements the stripper hid.
  // Text-node mutations cannot be reversed (we don't store originals); a
  // page reload restores text emoji on toggle-off. Same trade-off as the
  // engagement modules' irreversible text mutations.
  document.querySelectorAll<HTMLElement>(`[${EMOJI_STRIPPER_HIDDEN_MARKER}]`).forEach(el => {
    el.removeAttribute(EMOJI_STRIPPER_HIDDEN_MARKER);
  });

  // un-hide comment wrappers the empty-comment hider
  // collapsed. Removes the marker + clears the inline display style so the
  // wrapper renders again (it isn't in our hidden-list otherwise; the
  // CSS rule above only matches via the marker attribute).
  document.querySelectorAll<HTMLElement>(`[${EMPTY_COMMENT_MARKER}="true"]`).forEach(el => {
    el.removeAttribute(EMPTY_COMMENT_MARKER);
    el.style.removeProperty('display');
  });

  // un-hide containers the AI-content blocker hid +
  // clear the block-reason marker. We deliberately do NOT clear
  // dataset.fwProcessed (see ai-content-blocker.ts:resetDOM rationale).
  document.querySelectorAll<HTMLElement>(`[${AI_CONTENT_BLOCKED_MARKER}="ai-content"]`).forEach(el => {
    el.removeAttribute(AI_CONTENT_BLOCKED_MARKER);
    el.removeAttribute(AI_CONTENT_BLOCK_REASON_MARKER);
    el.style.removeProperty('display');
  });

  // un-hide page-level containers the reels blocker hid + clear the
  // block-reason marker. The blocker uses display:none on the inline
  // override (CSS rule is on the marker selector + cleared with the style
  // tag in the module's own resetDOM). dataset.fwProcessed is left in
  // place for the same reason as ai-content-blocker — a clean toggle-off
  // would otherwise re-fire the platform pipeline against an
  // already-resolved surface.
  document.querySelectorAll<HTMLElement>(`[${REELS_BLOCKED_MARKER}="${REELS_BLOCKED_VALUE}"]`).forEach(el => {
    el.removeAttribute(REELS_BLOCKED_MARKER);
    el.removeAttribute(REELS_BLOCK_REASON_MARKER);
    el.style.removeProperty('display');
  });
  document.getElementById(REELS_COVER_NOTE_ID)?.remove();

  // un-hide the posts and comments the word filter hid (Off). Starred
  // swearing is a text mutation and comes back on reload only.
  resetWordFilterDOM();
  resetSurfaceDOM();
  resetYouTubeFeedsDOM();

  // un-mount media-timeout overlay + clear the body-marker that disabled
  // page scrolling. The overlay style-tag is removed by the STYLE_TAG_IDS
  // loop above; this pass cleans the dynamic DOM additions only.
  document.getElementById(MEDIA_TIMEOUT_OVERLAY_ID)?.remove();
  if (document.body.hasAttribute(MEDIA_TIMEOUT_BODY_MARKER)) {
    document.body.removeAttribute(MEDIA_TIMEOUT_BODY_MARKER);
  }

  // un-tag elements the structural-finder marked +
  // clear the inline display:none. tagAsEngagement now sets the inline
  // style directly (rather than relying on the style-tag CSS rule alone)
  // because Meta's StyleX classes carry their own !important declarations
  // that beat our attribute-selector rule on specificity. Inline styles
  // win regardless of specificity, but require explicit cleanup here.
  document.querySelectorAll<HTMLElement>('[data-fw-engagement-bar="true"]').forEach(el => {
    delete el.dataset.fwEngagementBar;
    el.style.removeProperty('display');
  });

  // POC 2026-05-24 — clear section-model count-chip markers + restore
  // display. Mirrors the structural-finder cleanup pattern above; section-
  // model uses inline display:none for the same Meta-StyleX-defeating
  // reason. Without this clear, toggling hide-engagement-metrics off
  // would leave chips hidden until page reload.
  document.querySelectorAll<HTMLElement>('[data-fw-count-chip="true"]').forEach(el => {
    delete el.dataset.fwCountChip;
    el.style.removeProperty('display');
  });

  // IG session — un-tag orphan label hides (IG-specific
  // but cleaned up here defensively in case the IG module's teardown is
  // bypassed). Same inline display:none + marker pattern as the
  // structural-finder cleanup above.
  document.querySelectorAll<HTMLElement>('[data-fw-orphan-label="true"]').forEach(el => {
    delete el.dataset.fwOrphanLabel;
    el.style.removeProperty('display');
  });
}

// ─── Feedprint's hides on a page both run ───
//
// Feedprint hides an ad or a harmful post in the same inline style Off's resets clear, so Off taking back its own
// hide on that post would show what Feedprint hid (docs/spec/TWO-PRODUCTS.md). Off's stops and resets run inside
// this: what Feedprint wrote on its posts is read first and written back after.

const RECORDER_HIDDEN = '[data-fw-ad-hidden="true"], [data-fw-hard-hidden="true"]';
const RECORDER_HIDE_ATTRS = ['data-fw-hide-mode', 'data-fw-block-reason'] as const;
const RECORDER_HIDE_STYLES = ['display', 'visibility'] as const;

function keepingRecorderHides(run: () => void): void {
  const kept = [...document.querySelectorAll<HTMLElement>(RECORDER_HIDDEN)].map((el) => ({
    el,
    styles: RECORDER_HIDE_STYLES.map((p) => [p, el.style.getPropertyValue(p), el.style.getPropertyPriority(p)] as const),
    attrs: RECORDER_HIDE_ATTRS.map((a) => [a, el.getAttribute(a)] as const),
  }));
  try {
    run();
  } finally {
    for (const { el, styles, attrs } of kept) {
      for (const [p, value, priority] of styles) {
        if (value) el.style.setProperty(p, value, priority);
        else el.style.removeProperty(p);
      }
      for (const [a, value] of attrs) {
        if (value === null) el.removeAttribute(a);
        else el.setAttribute(a, value);
      }
    }
  }
}

/**
 * The settings Off's word filter runs on beside a recorder that stars swearing itself: no starring, so a
 * swear word is starred by one product. The own list always runs; it holds words only Off knows.
 */
function wordFilterSettings(settings: FWSettings, leaveToRecorder: ReadonlySet<RecorderFamily>): FWSettings {
  if (!leaveToRecorder.has('swearing')) return settings;
  return { ...settings, strictLanguage: false, mode: settings.mode === 'child' ? 'teen' : settings.mode };
}

// ─── Platform Routing ───

/**
 * Run every stop, each in its own try, so one that throws does not leave the ones after it running. The first error is
 * rethrown once all have run, so a caller that counts or retries on a throw still sees it (S4, site 2b).
 */
function stopAll(stops: ReadonlyArray<() => void>): void {
  let failed = false;
  let firstError: unknown;
  for (const stop of stops) {
    try {
      stop();
    } catch (error) {
      if (!failed) { failed = true; firstError = error; }
    }
  }
  if (failed) throw firstError;
}

/** The counters one start's throws move: the page-load start and the rebuild after a settings change each have their own. */
interface StartCounters { threw: string; retryThrew: string }
const PAGE_LOAD_COUNTERS: StartCounters = { threw: 'engagementFirstStartThrew', retryThrew: 'engagementFirstStartRetryThrew' };
const REBUILD_COUNTERS: StartCounters = { threw: 'engagementRebuildThrew', retryThrew: 'engagementRebuildRetryThrew' };

function startPlatformEngagement(
  platform: Platform,
  settings: FWSettings,
  counters: StartCounters,
  leaveToRecorder: ReadonlySet<RecorderFamily>,
): () => void {
  // Each module starts in a guard of its own. A start that throws is counted and tried once more right away; if it throws again
  // it is skipped alone, with a warning naming it, and every other module starts and stays live: undoing the set for one failure
  // would take ads, Reels and the rest off the page, and a filter that is not live is a protection removed. The returned cleanup
  // stops every module that did start.
  const keepStart = (name: string, start: () => () => void): (() => void) => {
    try {
      return start();
    } catch (error) {
      // An extension reloaded under the tab is not a filter fault: the context guard says so once, and a retry would
      // only throw again.
      if (!isContextAlive()) return () => {};
      bumpCounter(counters.threw);
      console.warn(`[FW engagement] ${name} did not start; trying it once more`, error);
    }
    try {
      return start();
    } catch (retryError) {
      if (!isContextAlive()) return () => {};
      bumpCounter(counters.retryThrew);
      console.warn(`[FW engagement] ${name} did not start the second time; the other filters stay live`, retryError);
      return () => {};
    }
  };
  const none = () => () => {};
  const runsAds = !leaveToRecorder.has('ads');
  const sidebarAdCleanup = runsAds ? keepStart('sidebarAdBlocker', () => startSidebarAdBlocker(platform, settings)) : none();
  // Media-only feed ads (image/video promo with no tweetText) never enter
  // the extraction pipeline, so the pipeline's Block Ads hide can't reach
  // them — this DOM-tier scan closes that gap (F1; X only).
  const mediaOnlyAdCleanup = runsAds ? keepStart('mediaOnlyAdBlocker', () => startMediaOnlyAdBlocker(platform, settings)) : none();
  // Feed ads on every platform by the platform's own label. In Feedprint the
  // pipeline hides and records them, and this rule takes only the ad slots the
  // pipeline does not read (feed-ad-blocker.ts).
  const feedAdCleanup = runsAds ? keepStart('feedAdBlocker', () => startFeedAdBlocker(platform, settings)) : none();
  // Feedprint runs the ads and nothing else here: every other module is Off's (storage/switch-scope.ts),
  // and a copy started in Feedprint would fight Off's on a page both run, since their passes and stops
  // remove the same style tags and markers.
  if (!isOffProduct()) return () => stopAll([sidebarAdCleanup, mediaOnlyAdCleanup, feedAdCleanup]);
  // The recorder does the same three text rules inside the pipeline, where
  // each one also becomes a record; Off runs the ones it does not name.
  const wordFilterCleanup = leaveToRecorder.has('words')
    ? none()
    : keepStart('wordFilter', () => startWordFilter(
      platform,
      wordFilterSettings(settings, leaveToRecorder),
      { slurs: !leaveToRecorder.has('slurs') },
    ));
  // The emoji stripper, empty-comment hider, and AI-content blocker are
  // parallel cross-platform mutations that run alongside the platform-
  // specific engagement module. The platform module is not a prerequisite
  // for the cross-platform mutators.
  const stripperCleanup = keepStart('emojiStripper', () => startEmojiStripper(platform, settings));
  const emptyCommentCleanup = keepStart('emptyCommentHider', () => startEmptyCommentHider(platform, settings));
  const aiBlockerCleanup = keepStart('aiContentBlocker', () => startAiContentBlocker(platform, settings));
  const reelsBlockerCleanup = keepStart('reelsBlocker', () => startReelsBlocker(platform, settings));
  const mediaTimeoutCleanup = keepStart('mediaTimeout', () => startMediaTimeout(platform, settings));
  // The user's own "block this" picks. The picker itself is started once in
  // initEngagementControl, because a pick writes settings and this whole set
  // restarts on a settings write.
  const pickedCleanup = keepStart('pickedBlocks', () => startPickedBlocks(platform, settings));
  // The surface switches (trays, suggestions, Marketplace, Groups, the right
  // column); block-reels' trays live here too.
  const surfaceCleanup = keepStart('surfaceSwitches', () => startSurfaceSwitches(platform, settings));
  // YouTube's home feed and recommended videos, hidden by one stylesheet (youtube-feeds.ts).
  const youtubeFeedsCleanup = keepStart('youtubeFeeds', () => (platform === 'youtube' ? startYouTubeFeeds(settings) : () => {}));

  let platformCleanup: () => void;
  switch (platform) {
    case 'tiktok':
      platformCleanup = keepStart('tiktok engagement', () => startTikTokEngagementControl(settings));
      break;
    case 'twitter':
      platformCleanup = keepStart('twitter engagement', () => startTwitterEngagementControl(settings));
      break;
    case 'instagram':
      platformCleanup = keepStart('instagram engagement', () => startInstagramEngagementControl(settings));
      break;
    case 'facebook':
      platformCleanup = keepStart('facebook engagement', () => startFacebookEngagementControl(settings));
      break;
    case 'youtube':
      platformCleanup = keepStart('youtube engagement', () => startYouTubeEngagementControl(settings));
      break;
    default:
      console.log(
        `[FeelingWise] Engagement control: not yet implemented for ${platform}`,
      );
      platformCleanup = () => {};
  }

  return () => stopAll([
    platformCleanup,
    stripperCleanup,
    emptyCommentCleanup,
    aiBlockerCleanup,
    reelsBlockerCleanup,
    mediaTimeoutCleanup,
    sidebarAdCleanup,
    mediaOnlyAdCleanup,
    feedAdCleanup,
    wordFilterCleanup,
    pickedCleanup,
    surfaceCleanup,
    youtubeFeedsCleanup,
  ]);
}

// What a repair does to a finder is counted in the finder ledger.
setRepairEventSink(recordFinderEvent);

// ─── Main Entry Point ───

export async function initEngagementControl(
  platform: Platform,
  options: { leaveToRecorder?: ReadonlySet<RecorderFamily> } = {},
): Promise<() => void> {
  if (!isContextAlive()) {
    return () => {};
  }

  const offRuns = isOffProduct();
  const leaveToRecorder: ReadonlySet<RecorderFamily> = options.leaveToRecorder ?? new Set();
  // Feedprint keeps an "on" stored for a switch it no longer has, and acts as if it were off.
  const readSettings = async (): Promise<FWSettings> => {
    const stored = await getSettings();
    return offRuns ? stored : withFeedprintScope(stored);
  };
  // Feedprint's ad modules undo their own hides when they stop; the page-wide reset would also strip
  // what Off hid on a page both run.
  const resetDOM = offRuns ? resetEngagementDOM : () => {};
  const keepHides = offRuns ? keepingRecorderHides : (run: () => void) => run();

  // The repair file in force (the packaged one, or a newer one Feedprint fetched) is read before any finder starts. It is
  // started first and awaited with the settings, so the settings read begins in the same turn as it always did.
  const repairsLoaded = loadRepairs();
  const settings = await readSettings();
  await repairsLoaded;
  // The extension can be reloaded while settings are read; an orphaned script has nothing left to start.
  if (!isContextAlive()) return () => {};

  let activeCleanup: () => void = () => {};
  /** Ticks once per restart, so a slow run can tell it has been overtaken. */
  let restartSeq = 0;

  // Whether the module set is running. While it runs, startPickedBlocks follows the picks itself;
  // while it does not (Feedprint with every switch off), the first pick has to start it.
  let controlling = shouldControlEngagement(platform, settings);
  if (controlling) {
    // Each module's start is guarded inside startPlatformEngagement, so a throw there does not reach this line.
    activeCleanup = startPlatformEngagement(platform, settings, PAGE_LOAD_COUNTERS, leaveToRecorder);
  }
  // Started once: an account pick writes the features and the restart below
  // must not disarm a "pick several" run. Block this is Off's.
  // A throw here used to reject the whole call after the filters had started, so the master cleanup was never returned, no
  // settings listener was attached and Off (which keeps no stop) started a second set on its next run (S4, site 2c).
  let pickerCleanup: () => void = () => {};
  try {
    if (offRuns) pickerCleanup = startPicker(platform, settings);
  } catch (error) {
    if (!isContextAlive()) return () => keepHides(() => stopAll([activeCleanup, resetDOM]));
    bumpCounter('engagementPickerStartThrew');
    console.warn('[FW engagement] the picker start threw; the filters go on without it', error);
  }

  // Listen for runtime settings changes. also re-run when
  // `features` or `presets` change (preset-apply, individual toggle).
  // `mode` stays in the trigger list because a mode switch rewrites the grid.
  const storageListener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName?: string,
  ): void => {
    if (!isContextAlive()) {
      chrome.storage?.onChanged?.removeListener(storageListener);
      return;
    }
    // Settings live in chrome.storage.local. A session or sync write that
    // happens to carry a key named mode or features is not a settings change,
    // and it tore down and rebuilt every engagement module (wiring audit
    // 13 Sep, P15).
    if (areaName !== undefined && areaName !== 'local') return;

    if (
      !(changes.pickedBlocks && !controlling) &&
      !changes.mode &&
      !changes.features &&
      !changes.presets &&
      // "No swearing" is a top-level key, not a square of the feature grid, and
      // it was missing from this list until 2026-09-19. The word filter reads
      // it directly (word-filter.ts starSwearing), so turning it on in the free
      // popup changed nothing on the open page: the swearing stayed visible
      // until the person reloaded, with no sign that anything was pending. The
      // recorder's own runtime has watched this key all along
      // (protection-runtime-startup.ts), which is why it was only wrong here.
      !changes.strictLanguage &&
      // A new repair file changes what the finders look for, so they start again from it.
      !changes[REPAIRS_STORAGE_KEY]
    ) {
      return;
    }

    // Each run claims a number, and only the newest run may install its
    // cleanup. Two writes close together (applying a preset writes `features`
    // and `mode`; the popup's own switches can land within a frame of each
    // other) each stopped the modules and then awaited getSettings, so the
    // slower one overwrote `activeCleanup` with its own and the other run's
    // scanners and observers went on working with nothing left holding them.
    // Found 2026-09-19, and adding the key above makes the pairing likelier.
    const run = ++restartSeq;

    void (async () => {
      // 1. Read the new settings FIRST. The order used to be stop, reset, read,
      // so every write to one of the keys above took the media-timeout overlay
      // off the page, removed every style tag, every hide marker and every
      // inline hide, and only then awaited a storage round trip before putting
      // anything back. In between, a child's page was fully visible with no
      // blockers on it. The write that triggers this also invalidates the
      // settings cache, so the read is a real round trip, not a cache hit.
      // Reading first costs nothing and closes the gap (2026-09-19).
      //
      // Nobody waits for this block, so a throw in it was an unhandled
      // rejection and, after the teardown below, a page left unfiltered until
      // reload (S4, P32). A failed read tears nothing down: the old filters
      // keep running. A failed start is tried once more from the settings just
      // read, and each failure moves a counter.
      let newSettings: FWSettings;
      try {
        if (changes[REPAIRS_STORAGE_KEY]) await loadRepairs();
        newSettings = await readSettings();
      } catch (error) {
        bumpCounter('engagementRebuildThrew');
        console.warn('[FW engagement] the settings read threw; the filters stay as they were', error);
        return;
      }

      // A newer change arrived while this one was reading settings. It will
      // stop and restart from fresher settings, so this run stops here rather
      // than tearing the page down for a snapshot already out of date.
      if (run !== restartSeq) return;

      const startFresh = (): () => void => {
        controlling = shouldControlEngagement(platform, newSettings);
        return controlling ? startPlatformEngagement(platform, newSettings, REBUILD_COUNTERS, leaveToRecorder) : () => {};
      };

      try {
        keepHides(() => {
          // 2. Stop current engagement control
          activeCleanup();

          // 3. Full DOM reset — removes style tags, data attrs, inline styles
          resetDOM();
        });

        // 4. Start new mode (or no-op)
        activeCleanup = startFresh();
      } catch (error) {
        bumpCounter('engagementRebuildThrew');
        console.warn('[FW engagement] the rebuild threw; starting the filters again', error);
        if (run !== restartSeq) return;
        try {
          activeCleanup = startFresh();
        } catch (retryError) {
          bumpCounter('engagementRebuildRetryThrew');
          console.warn('[FW engagement] the second start threw too', retryError);
          activeCleanup = () => {};
          controlling = false;
        }
      }
    })();
  };

  // An orphaned script has no storage events to listen to; the stop below still clears what did start.
  if (isContextAlive()) chrome.storage.onChanged.addListener(storageListener);

  // Master cleanup
  // Every step runs even if an earlier one throws (a picker that throws on stop used to leave the filters, the page reset and
  // the listener in place); the first error is rethrown after all have run (S4, site 2c).
  let release = (): void => {};
  const stop = (): void => {
    // A restart still reading settings would otherwise start the filters again after this stop, with nothing left to
    // stop them.
    restartSeq += 1;
    release();
    stopAll([
      () => pickerCleanup(),
      () => keepHides(() => stopAll([activeCleanup, resetDOM])),
      () => chrome.storage?.onChanged?.removeListener(storageListener),
    ]);
  };
  // A Feedprint updated or switched off under an open tab leaves this script running with its ad watchers. Its stamp
  // leaves then, and Off, seeing no stamp, takes the ads back: both would act on the same ad.
  if (!offRuns) release = stopWhenFeedprintGoes(stop);
  return stop;
}
