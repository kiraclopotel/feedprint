// FeelingWise - TikTok engagement control
// / routes by feature toggles (per-platform overrides
// honored), not by `mode`. Action-rail / metric-counts / comment-section /
// comment-posting are independently gated. The legacy `vc` (videoControls)
// blob is no longer consulted.

import type { AnchorSet, ContainerConstraints } from './container-discovery';
import { discoverContainer, discoverAllContainers } from './container-discovery';
import type { FWSettings } from '../../storage/settings';
import { isFeatureEnabled } from '../../storage/settings';
import { markHidden, hideElement, unmarkHidden } from './mark-hidden';
import { noteSelectorFamilySweep } from './selector-family-miss';
import { selectorFamily } from '../../core/repairs/families';
import { startCountChipScan } from './section-model';
import { createRafBodyObserver, trailingThrottle } from '../post-path/raf-observer';
import { TT_COMMENT_ROW_SELECTOR, findTikTokRowBodyEl } from '../platforms/tiktok-bundle';
import { isInPrivateChatSubtree } from '../platforms/adapter';
import { ensureStyleTag, removeStyleTag } from './style-tag';

const TIKTOK_PLATFORM = 'tiktok' as const;

// ─── Action Rail (vertical strip: like, comment, share, bookmark) ───

const ACTION_RAIL_ANCHORS: AnchorSet = {
  required: [
    '[data-e2e="like-icon"]',
    '[data-e2e="comment-icon"]',
    '[data-e2e="share-icon"]',
  ],
  optional: [
    '[data-e2e="like-count"]',
    '[data-e2e="comment-count"]',
    '[data-e2e="share-count"]',
    '[data-e2e="undefined-count"]',
  ],
};

const ACTION_RAIL_CONSTRAINTS: ContainerConstraints = {
  minRequiredAnchors: 2,
  size: {
    minWidth: 30,
    maxWidth: 120,
    minHeight: 100,
    maxHeight: 600,
  },
  maxChildCount: 100,
  rejectIfContains: [
    '[data-e2e="feed-video"]',
    '[data-e2e="video-desc"]',
    '[data-e2e="browse-video-desc"]',
    'video',
  ],
  maxWalkDepth: 8,
};

// ─── Comment Section ───
//
// TT-3 (2026-07-13 swarm audit): `[data-e2e^="comment-level-"]` was TikTok's
// pre-rotation row marker and was STRIPPED from the current comment panel —
// see `tiktok-bundle.ts`'s selector-contract header, which documents the
// removal as established fact and moved to the `DivCommentItemWrapper`
// substring-class anchor (`TT_COMMENT_ROW_SELECTOR`). This file kept only
// the stale selector as its SOLE required anchor, so `discoverContainer`
// never found a candidate on current TikTok DOM and `controlCommentSection`
// silently no-opped (block-comment-posting / rewritten-comments-first never
// applied to the section). Fix: list the current selector alongside the old
// one. `COMMENT_SECTION_CONSTRAINTS.minRequiredAnchors` is 1, so
// `discoverAllContainers`'s per-selector anchor walk treats multiple
// `required` entries as OR (either marker alone is enough) — this restores
// current-DOM detection while keeping the old selector as a harmless
// fallback for any TikTok surface that still emits it.
const COMMENT_SECTION_ANCHORS: AnchorSet = {
  required: [
    '[data-e2e^="comment-level-"]',
    TT_COMMENT_ROW_SELECTOR,
  ],
  optional: [
    '[data-e2e="comment-username-1"]',
    '[data-e2e="comment-input"]',
    '[data-e2e="comment-post"]',
    '[data-e2e="comment-text-1"]',
  ],
};

const COMMENT_SECTION_CONSTRAINTS: ContainerConstraints = {
  minRequiredAnchors: 1,
  size: {
    minHeight: 80,
  },
  rejectIfContains: [
    'video',
    '[data-e2e="feed-video"]',
  ],
  maxWalkDepth: 10,
};

// ─── CSS style tag IDs ───

const ACTION_RAIL_CSS_ID = 'fw-tiktok-action-rail-css';
const COMMENT_SECTION_CSS_ID = 'fw-tiktok-comment-section-css';
const POST_BLOCK_CSS_ID = 'fw-tiktok-post-block-css';
const STICKER_COMMENT_CSS_ID = 'fw-tiktok-sticker-comment-css';

// ─── Helpers ───

const COUNT_SELECTORS = [
  '[data-e2e="like-count"]',
  '[data-e2e="comment-count"]',
  '[data-e2e="share-count"]',
  '[data-e2e="undefined-count"]',
  // Wildcard catches rotated count selectors inside the already-bounded
  // action rail (e.g. bookmark/favorite count surfacing as
  // `data-e2e="favorite-count"` when TikTok rotates from the historic
  // `undefined-count` placeholder). Action-rail discovery already restricts
  // scope via size + anchor constraints, so this stays inside the strip.
  '[data-e2e$="-count"]',
];

// ─── Action Rail Control ───

function controlActionRail(settings: FWSettings): void {
  const containers = discoverAllContainers(document, ACTION_RAIL_ANCHORS, ACTION_RAIL_CONSTRAINTS);

  // feature toggles drive behavior — applied uniformly across
  // every preset (bug (a) fix: action-button hide now works on
  // every mode that turns the toggle ON, not just child).
  const hideActions = isFeatureEnabled(settings, 'hide-action-buttons', TIKTOK_PLATFORM);
  const hideMetrics = isFeatureEnabled(settings, 'hide-engagement-metrics', TIKTOK_PLATFORM);

  // Q31: with either toggle on, zero discovered rails on a page that is
  // playing video means the anchor constraints rotated. Throttled per path.
  if ((hideActions || hideMetrics) && document.querySelector('video')) {
    noteSelectorFamilySweep('tiktok.action-rail', containers.length);
  }

  for (const { element } of containers) {
    const current = element.dataset.fwActionRail;

    if (hideActions) {
      if (current === 'hidden') continue;
      if (!hideElement(element, {
        marker: 'data-fw-action-rail', value: 'hidden',
        reason: 'hide-action-buttons:tiktok-rail',
      })) continue;
      ensureStyleTag(ACTION_RAIL_CSS_ID, `
        [data-fw-action-rail="hidden"] {
          display: none !important;
          visibility: hidden !important;
        }
      `);
    } else if (hideMetrics) {
      if (current === 'neutralized') continue;
      // count per-element metric hides (likes/views/comments etc. each).
      let countThisRail = 0;
      for (const sel of selectorFamily('finder.tiktok.counts', COUNT_SELECTORS)) {
        element.querySelectorAll<HTMLElement>(sel).forEach(el => {
          // Through the door (2026-09-20). These chips were the last hide in
          // the folder with no marker, no reason stamp and no privacy check:
          // the rail around them is marked below, they were not. A chip the
          // door refuses is not counted either, so the tally keeps matching
          // what actually went.
          if (!hideElement(el, {
            marker: 'data-fw-tt-count', value: 'hidden',
            reason: 'hide-engagement-metrics:tiktok-count',
            count: 0,
            mode: 'visibility',
          })) return;
          countThisRail += 1;
        });
      }
      markHidden(element, {
        marker: 'data-fw-action-rail', value: 'neutralized',
        reason: 'hide-engagement-metrics:tiktok-rail', count: countThisRail,
      });
    } else {
      if (current === 'pass') continue;
      element.dataset.fwActionRail = 'pass';
    }
  }
}

// ─── Comment Section Control ───

function controlCommentSection(settings: FWSettings): void {
  const result = discoverContainer(document, COMMENT_SECTION_ANCHORS, COMMENT_SECTION_CONSTRAINTS);
  if (!result) return;

  const { element } = result;
  const current = element.dataset.fwCommentSection;

  // replace-toxic-with-educational removed; the
  // educational-comment branch is gone. Precedence: block-comment-posting
  // hides the whole section via CSS cascade; else rewritten-comments-first
  // marks for the rewrite path; else pass.
  const blockSection = isFeatureEnabled(
    settings, 'block-comment-posting', TIKTOK_PLATFORM,
  );
  const rewriteComments = isFeatureEnabled(
    settings, 'rewritten-comments-first', TIKTOK_PLATFORM,
  );

  if (blockSection) {
    if (current === 'hidden') return;
    if (!hideElement(element, {
      marker: 'data-fw-comment-section', value: 'hidden',
      reason: 'block-comment-posting:tiktok-section',
    })) return;
    ensureStyleTag(COMMENT_SECTION_CSS_ID, `
      [data-fw-comment-section="hidden"] {
        display: none !important;
        visibility: hidden !important;
      }
    `);
    return;
  }

  if (rewriteComments) {
    if (current === 'rewrite-discovered') return;
    element.dataset.fwCommentSection = 'rewrite-discovered';
    return;
  }

  if (current === 'pass') return;
  element.dataset.fwCommentSection = 'pass';
}

// ─── Sticker Comment Hiding ───
//
// Product requirement: TikTok users can post stickers, which render in the
// comment stream as placeholder text like '[Sticker]'; remove those too.
// TikTok's comment system lets
// users post animated GIF stickers; on web, the DOM still emits a comment
// node but its visible text is just the localized placeholder
// `[Sticker]` / `[Autocolant]` / `[Pegatina]` / etc. There is no actual
// content for the LLM or the user — it's pure noise. Hide the wrapping
// comment node DOM-side. Independent of the engagement features (it isn't
// a "metric" or "action"), but cheap to colocate here so the controller's
// reset path catches it.
//
// Match strategy: walk every `[data-e2e^="comment-level-"]` node and check
// whether its text content (after trim) matches the placeholder pattern.
// Multiple locales emit different bracketed labels — tolerated by the
// alternation list. If the comment contains anything beyond the bracket
// pair, leave it alone.

const STICKER_PLACEHOLDER_RE =
  /^\s*\[\s*(?:Sticker|Autocolant|Autocollant|Aufkleber|Pegatina|Adesivo|Стикер|Naklejka|ステッカー|貼り紙|贴纸|貼圖|동영상\s*스티커|이모티콘)\s*\]\s*$/i;

function hideStickerComments(): void {
  // TT-3: same stale-selector gap as COMMENT_SECTION_ANCHORS above, but with
  // no fallback at all — `comment-level-` was this function's ONLY row
  // query, so on current TikTok DOM `commentNodes.length` was always 0 and
  // the explicitly-requested sticker-hider never ran. Query both the old
  // and current row markers (comma-separated selector — a single query,
  // still returns each row once even if a row happened to match both).
  const commentNodes = document.querySelectorAll<HTMLElement>(
    `[data-e2e^="comment-level-"], ${TT_COMMENT_ROW_SELECTOR}`,
  );
  if (commentNodes.length === 0) return;

  let touched = false;
  for (const node of commentNodes) {
    if (node.dataset.fwStickerHidden === 'true') continue;

    // Find the comment body sub-element. TikTok used to mark it as
    // `comment-text-1` (or `comment-text-N` for nested replies) — tried
    // first since it's an exact, unambiguous anchor. Current TikTok DOM may
    // not expose it, so fall back to the same longest-TUXText-span heuristic
    // the bundle extractor / adapter already use to locate a row's body
    // (`findTikTokRowBodyEl`, `tiktok-bundle.ts`) — reused here rather than
    // re-derived, per the single-source-of-truth selector contract.
    const textEl =
      node.querySelector<HTMLElement>('[data-e2e^="comment-text-"]') ??
      findTikTokRowBodyEl(node);
    const text = (textEl?.textContent ?? node.textContent ?? '').trim();
    if (!text) continue;
    if (!STICKER_PLACEHOLDER_RE.test(text)) continue;

    // runAll() calls this pass under no feature toggle (explicitly requested
    // outright), so the reason must not point a triage at
    // strip-emojis, which can be off while this still hides (M116). Whether
    // it should be gated is an open product decision, recorded in known-issues.
    hideElement(node, {
      marker: 'data-fw-sticker-hidden', value: 'true',
      reason: 'always-on:tiktok-sticker',
    });
    touched = true;
  }

  if (touched) {
    ensureStyleTag(STICKER_COMMENT_CSS_ID, `
      [data-fw-sticker-hidden="true"] {
        display: none !important;
        visibility: hidden !important;
      }
    `);
  }
}

// ─── Comment Posting Block ───

/** Exported so a test can drive the fallback scan against a real DOM. */
export function blockTikTokCommentPosting(): void {
  const directSelectors = [
    '[data-e2e="comment-input"]',
    '[data-e2e="comment-post"]',
  ];

  let found = false;

  for (const sel of directSelectors) {
    document.querySelectorAll<HTMLElement>(sel).forEach(el => {
      if (!markHidden(el, {
        marker: 'data-fw-post-blocked', value: 'true',
        reason: 'block-comment-posting:tiktok-input',
      })) return;
      el.style.setProperty('display', 'none', 'important');
      found = true;
    });
  }

  // Find contenteditable elements near comment context
  const commentSection = document.querySelector('[data-fw-comment-section]');
  if (commentSection) {
    commentSection.querySelectorAll<HTMLElement>('[contenteditable="true"]').forEach(el => {
      if (!markHidden(el, {
        marker: 'data-fw-post-blocked', value: 'true',
        reason: 'block-comment-posting:tiktok-editable',
      })) return;
      el.style.setProperty('display', 'none', 'important');
      found = true;
    });
  }

  // Structural fallback: find any contenteditable/textarea with comment-related placeholder
  if (!found) {
    const editables = document.querySelectorAll<HTMLElement>(
      '[contenteditable="true"], textarea',
    );
    for (const el of editables) {
      if (el.dataset.fwPostBlocked === 'true') continue;
      // This is the widest scan in the file: every editable on the page, kept
      // or dropped on a word in a placeholder, an aria-label or the typed text
      // itself, and then a climb to whatever ancestor happens to be wide and
      // short. A message composer is an editable like any other, and what the
      // person has typed into it is part of the haystack. Added 2026-09-19.
      if (isInPrivateChatSubtree(el)) continue;
      const text = (
        el.getAttribute('placeholder') ??
        el.getAttribute('aria-label') ??
        el.getAttribute('data-placeholder') ??
        el.textContent ?? ''
      ).toLowerCase();

      if (!/comment|comentariu|reply|adaugă/.test(text)) continue;

      // Walk up to find the input bar container (full-width, short height)
      let target: HTMLElement = el;
      let parent = el.parentElement;
      while (parent && parent !== document.body) {
        const rect = parent.getBoundingClientRect();
        if (rect.width > window.innerWidth * 0.6 && rect.height < 80) {
          target = parent;
          break;
        }
        parent = parent.parentElement;
      }

      hideElement(target, {
        marker: 'data-fw-post-blocked', value: 'true',
        reason: 'block-comment-posting:tiktok-input-bar',
      });
      found = true;
      break;
    }
  }

  if (found) {
    ensureStyleTag(POST_BLOCK_CSS_ID, `
      [data-fw-post-blocked="true"] {
        display: none !important;
      }
    `);
  }
}

// ─── Cleanup helpers ───

function resetDataAttributes(): void {
  document.querySelectorAll<HTMLElement>('[data-fw-action-rail]').forEach(el => {
    unmarkHidden(el, 'data-fw-action-rail');
    el.style.removeProperty('display');
    el.style.removeProperty('visibility');
    for (const sel of selectorFamily('finder.tiktok.counts', COUNT_SELECTORS)) {
      el.querySelectorAll<HTMLElement>(sel).forEach(count => {
        count.style.removeProperty('visibility');
      });
    }
  });
  document.querySelectorAll<HTMLElement>('[data-fw-comment-section]').forEach(el => {
    unmarkHidden(el, 'data-fw-comment-section');
    el.style.removeProperty('display');
    el.style.removeProperty('visibility');
  });
  document.querySelectorAll<HTMLElement>('[data-fw-post-blocked]').forEach(el => {
    unmarkHidden(el, 'data-fw-post-blocked');
    el.style.removeProperty('display');
  });
  document.querySelectorAll<HTMLElement>('[data-fw-sticker-hidden]').forEach(el => {
    unmarkHidden(el, 'data-fw-sticker-hidden');
    el.style.removeProperty('display');
  });
}

// ─── Main entry point ───

// Minimum gap between full-page sweeps. runAll scans the whole TikTok DOM
// (action-rail discovery + comment-section discovery + sticker walk); the rAF
// body observer below fires on TikTok's near-constant mutations (auto-advancing
// feed video, lazy-loaded comments) — effectively ~60x/sec during playback.
// Unthrottled, that sustained full-page work is the same renderer-OOM pressure
// pattern that crashed YouTube (2026-06-06 youtube-crash-hunt). 750ms keeps the
// rail/counts hiding within ~1s of a tile loading (cosmetic) while cutting the
// sweep rate ~45x. Mirrors youtube-engagement.ts RUN_THROTTLE_MS.
const RUN_THROTTLE_MS = 750;

export function startTikTokEngagementControl(settings: FWSettings): () => void {
  // posting-block is a separate feature toggle; gate at entry
  // and let runAll re-evaluate the others on every observer tick (DOM
  // changes don't change the toggle, but the controller's outer reset
  // restarts us when toggles do change).
  const shouldBlockPosting = isFeatureEnabled(
    settings, 'block-comment-posting', TIKTOK_PLATFORM,
  );

  function runAll(): void {
    controlActionRail(settings);
    controlCommentSection(settings);
    if (shouldBlockPosting) {
      blockTikTokCommentPosting();
    }
    // sticker placeholder hiding runs unconditionally.
    // Has no parent-facing toggle: the placeholder is pure DOM noise with
    // no actual user content, so there's nothing to gate.
    hideStickerComments();
  }
  // Trailing throttle: a burst inside the window schedules one sweep for the
  // end of the window instead of dropping it (a dropped call left a fresh
  // video's rail visible until the 2 s poll). Bursty callers still cannot
  // drive the sweep faster than RUN_THROTTLE_MS.
  const sweep = trailingThrottle(runAll, RUN_THROTTLE_MS);
  sweep.call();

  // rAF-debounced + throttled body observer — TikTok's constant DOM churn
  // (auto-advance feed) can't drive a ~60x/sec full-page sweep (the OOM
  // pattern). See src/content/post-path/raf-observer.ts header.
  const { cleanup: cleanupObserver } = createRafBodyObserver(sweep.call);

  // Polling fallback every 2 seconds. Independent of rAF so it still ticks when
  // the tab is backgrounded (the 2s cadence is above the throttle window, so
  // this always sweeps).
  const interval = setInterval(sweep.call, 2000);

  // Section-model overlay (2026-05-24). controlActionRail's COUNT_SELECTORS
  // (`[data-e2e$="-count"]`) only fire inside the discovered action-rail
  // container — main video like/comment/share/save counts. Section-model
  // adds coverage for surfaces the action-rail discovery doesn't reach:
  // comment-level heart counts inside the comment panel, explore tile
  // view-count overlays, surfaces (/explore, /search, /tag) where the
  // action-rail anchors don't bind. Platform-agnostic numeric-chip finder.
  const hideMetrics = isFeatureEnabled(settings, 'hide-engagement-metrics', TIKTOK_PLATFORM);
  const stopChipScan = hideMetrics ? startCountChipScan() : () => {};

  // Return cleanup function
  return () => {
    cleanupObserver();
    sweep.cancel();
    clearInterval(interval);
    stopChipScan();
    removeStyleTag(ACTION_RAIL_CSS_ID);
    removeStyleTag(COMMENT_SECTION_CSS_ID);
    removeStyleTag(POST_BLOCK_CSS_ID);
    removeStyleTag(STICKER_COMMENT_CSS_ID);
    resetDataAttributes();
  };
}
