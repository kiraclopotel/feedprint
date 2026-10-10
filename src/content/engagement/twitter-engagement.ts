// FeelingWise - Twitter/X engagement control
// / routes by feature toggles (per-platform overrides
// honored), not by `mode`. Hide-action-buttons / hide-engagement-metrics
// are independently gated and apply uniformly across every preset
// (bug (a) fix: action-button hide now works on every mode that
// turns the toggle ON, not just child).

import type { AnchorSet, ContainerConstraints, DiscoveredContainer } from './container-discovery';
import { discoverAllContainers } from './container-discovery';
import type { FWSettings } from '../../storage/settings';
import { isFeatureEnabled } from '../../storage/settings';
import { fwDebug } from '../fw-log';
import { ensureStyleTag, removeStyleTag } from './style-tag';
import { startCountChipScan } from './section-model';
import { createRafBodyObserver, trailingThrottle } from '../post-path/raf-observer';
import { hideElement } from './mark-hidden';
import { noteSelectorFamilySweep } from './selector-family-miss';

const TWITTER_PLATFORM = 'twitter' as const;

// ─── Action Row (horizontal bar: reply, retweet, like, bookmark) ───

const ACTION_ROW_ANCHORS: AnchorSet = {
  required: [
    'button[data-testid="reply"]',
    'button[data-testid="retweet"]',
    'button[data-testid="like"]',
  ],
  optional: [
    'button[data-testid="bookmark"]',
  ],
};

const ACTION_ROW_CONSTRAINTS: ContainerConstraints = {
  minRequiredAnchors: 2,
  size: {
    minWidth: 150,
    maxHeight: 100,
    maxViewportWidthRatio: 0.95,
  },
  maxChildCount: 30,
  rejectIfContains: [
    '[data-testid="tweetText"]',
    '[data-testid="tweetPhoto"]',
    '[data-testid="videoPlayer"]',
    '[data-testid="User-Name"]',
    'article',
  ],
  maxWalkDepth: 6,
};

const REQUIRED_BUTTON_SELECTORS = ACTION_ROW_ANCHORS.required;

// ─── CSS style tag IDs ───

const ACTION_ROW_CSS_ID = 'fw-twitter-engagement-css';
const COMMENT_BLOCK_CSS_ID = 'fw-twitter-comment-block-css';

// ─── Helpers ───

// ─── Surface Detection ───

function detectSurface(): 'feed' | 'detail' {
  if (/^\/[^/]+\/status\/\d+/.test(window.location.pathname)) {
    return 'detail';
  }
  return 'feed';
}

// ─── Primary Discovery: role="group" fast path ───

function discoverActionRowsByGroup(): DiscoveredContainer[] {
  const groups = document.querySelectorAll<HTMLElement>('[role="group"]');
  const results: DiscoveredContainer[] = [];

  for (const group of groups) {
    let anchorCount = 0;
    for (const sel of REQUIRED_BUTTON_SELECTORS) {
      if (group.querySelector(sel)) anchorCount++;
    }
    if (anchorCount < ACTION_ROW_CONSTRAINTS.minRequiredAnchors) continue;

    let rejected = false;
    for (const sel of ACTION_ROW_CONSTRAINTS.rejectIfContains) {
      if (group.querySelector(sel)) {
        rejected = true;
        break;
      }
    }
    if (rejected) continue;

    const rect = group.getBoundingClientRect();
    const { size } = ACTION_ROW_CONSTRAINTS;
    if (size.minWidth != null && rect.width < size.minWidth) continue;
    if (size.maxHeight != null && rect.height > size.maxHeight) continue;
    if (
      size.maxViewportWidthRatio != null &&
      window.innerWidth > 0 &&
      rect.width / window.innerWidth > size.maxViewportWidthRatio
    ) continue;

    if (
      ACTION_ROW_CONSTRAINTS.maxChildCount != null &&
      group.childElementCount > ACTION_ROW_CONSTRAINTS.maxChildCount
    ) continue;

    results.push({
      element: group,
      anchorsFound: anchorCount,
      depth: 0,
      confidence: anchorCount >= REQUIRED_BUTTON_SELECTORS.length ? 'high' : 'medium',
    });
  }

  return results;
}

// ─── Discovery with fallback ───

function discoverActionRows(): DiscoveredContainer[] {
  const byGroup = discoverActionRowsByGroup();
  if (byGroup.length > 0) return byGroup;
  return discoverAllContainers(document, ACTION_ROW_ANCHORS, ACTION_ROW_CONSTRAINTS);
}

// ─── Action Row Control ───
//
// Single concern after 2026-05-24 refactor: hide-action-buttons. Counts-
// only hiding (hide-engagement-metrics) is owned by section-model via the
// startCountChipScan overlay started in the main entry below. The prior
// hideMetrics branch here iterated `btn.querySelectorAll('span')` and
// applied visibility:hidden when textContent (which recurses through
// descendants) started with a digit — a wrapping span containing both
// the icon and the count had textContent="42" and matched, cascading
// visibility:hidden to the icon child and leaving the button visually
// blank. Removed in favor of section-model's leaf-direct-text scan.

function controlTwitterActionRows(settings: FWSettings): void {
  const containers = discoverActionRows();
  const hideActions = isFeatureEnabled(settings, 'hide-action-buttons', TWITTER_PLATFORM);
  // Q31: with the toggle on, zero discovered rows on a page that shows
  // tweets means the discovery selectors rotated. Throttled per pathname.
  if (hideActions && document.querySelector('article[data-testid="tweet"]')) {
    noteSelectorFamilySweep('twitter.action-rows', containers.length);
  }

  for (const { element } of containers) {
    const current = element.dataset.fwActionRow;

    if (hideActions) {
      if (current === 'hidden') continue;
      if (!hideElement(element, {
        marker: 'data-fw-action-row', value: 'hidden',
        reason: 'hide-action-buttons:twitter-row',
      })) continue;
      ensureStyleTag(ACTION_ROW_CSS_ID, `
        [data-fw-action-row="hidden"] {
          display: none !important;
          height: 0 !important;
          overflow: hidden !important;
        }
      `);
    } else {
      if (current === 'pass') continue;
      element.dataset.fwActionRow = 'pass';
    }
  }
}

// ─── Comment-posting block (block-comment-posting toggle) ───
//
// Pre-N+13 this toggle was silently dead on X — the controller activated but
// twitter-engagement.ts had no `block-comment-posting` handling. Per a
// 2026-05-10 ALPHA bug report that a reply could still be posted, wire a CSS-only
// hide for the reply composer on every X surface (tweet detail page inline
// reply, full-page reply modal, in-feed inline composer). The compose-tweet
// path stays untouched — parents can still post their own tweets if they
// share the session.
//
// Selectors target `data-testid` attributes which X holds stable across DOM
// rotations. The `_0` suffix on `tweetTextarea_0` marks the reply slot; the
// label sibling and the inline post button accompany it on every reply
// surface.

function controlTwitterCommentPosting(settings: FWSettings): void {
  const blockPosting = isFeatureEnabled(settings, 'block-comment-posting', TWITTER_PLATFORM);
  if (!blockPosting) {
    document.getElementById(COMMENT_BLOCK_CSS_ID)?.remove();
    return;
  }
  ensureStyleTag(COMMENT_BLOCK_CSS_ID, `
    [data-testid="tweetTextarea_0"],
    [data-testid="tweetTextarea_0_label"],
    [data-testid="tweetTextarea_0RichTextInputContainer"],
    [data-testid="tweetButtonInline"] {
      display: none !important;
      visibility: hidden !important;
      pointer-events: none !important;
    }
  `);
}

// ─── Cleanup helpers ───

function resetActionRowMarkers(): void {
  document.querySelectorAll<HTMLElement>('[data-fw-action-row]').forEach(el => {
    delete el.dataset.fwActionRow;
    el.style.removeProperty('display');
    el.style.removeProperty('height');
    el.style.removeProperty('overflow');
  });
}

// ─── Main entry point ───

// Minimum gap between full-page sweeps. checkUrlAndControl scans for X's action
// rows + reply composer on every call; the rAF body observer below fires on X's
// near-constant SPA mutations — effectively ~60x/sec during scroll. Unthrottled,
// that sustained full-page work is the same renderer-OOM pressure pattern that
// crashed YouTube (2026-06-06 youtube-crash-hunt). 750ms keeps the action rows
// hiding within ~1s of a tweet loading (cosmetic) while cutting the sweep rate
// ~45x. URL-change detection still fires within the throttle window — the 2s
// setInterval guarantees a marker reset even if every rAF tick is throttled.
// Mirrors youtube-engagement.ts RUN_THROTTLE_MS.
const RUN_THROTTLE_MS = 750;

export function startTwitterEngagementControl(settings: FWSettings): () => void {
  const surface = detectSurface();
  fwDebug(`[FW] Twitter engagement control started — surface: ${surface}`);

  let lastUrl = window.location.href;

  function checkUrlAndControl(): void {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      const newSurface = detectSurface();
      fwDebug(`[FW] Twitter URL changed — surface: ${newSurface}, resetting markers`);
      lastUrl = currentUrl;
      resetActionRowMarkers();
    }
    controlTwitterActionRows(settings);
    controlTwitterCommentPosting(settings);
  }
  // Trailing throttle: a burst inside the window schedules one sweep for the
  // end of the window instead of dropping it (the dropped call left a fresh
  // tweet visible until the 2 s poll). Bursty callers still cannot drive the
  // sweep faster than RUN_THROTTLE_MS.
  const sweep = trailingThrottle(checkUrlAndControl, RUN_THROTTLE_MS);
  sweep.call();

  // rAF-debounced + throttled body observer — X's constant SPA DOM churn can't
  // drive a ~60x/sec full-page sweep (the OOM pattern). See
  // src/content/post-path/raf-observer.ts header.
  const { cleanup: cleanupObserver } = createRafBodyObserver(sweep.call);

  // Polling fallback every 2 seconds. Independent of rAF so it still ticks when
  // the tab is backgrounded (the 2s cadence is above the throttle window, so
  // this always sweeps + checks the URL).
  const interval = setInterval(sweep.call, 2000);

  // Section-model overlay (2026-05-24). The existing visibility:hidden on
  // numeric spans inside data-testid="reply|retweet|like|bookmark" buttons
  // covers X's main action bar; the section-model adds coverage for
  // surfaces the data-testid sweep misses (quote-reply chips, side-rail
  // engagement counts, surfaces where data-testid attrs rotated). Platform-
  // agnostic — same finder runs across all 5 platforms.
  const hideMetrics = isFeatureEnabled(settings, 'hide-engagement-metrics', TWITTER_PLATFORM);
  const stopChipScan = hideMetrics ? startCountChipScan() : () => {};

  return () => {
    cleanupObserver();
    sweep.cancel();
    clearInterval(interval);
    stopChipScan();
    removeStyleTag(ACTION_ROW_CSS_ID);
    removeStyleTag(COMMENT_BLOCK_CSS_ID);
    resetActionRowMarkers();
  };
}
