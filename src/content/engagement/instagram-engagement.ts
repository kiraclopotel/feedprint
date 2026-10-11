// FeelingWise — Instagram engagement control
//
// (post-pivot family ship): mirror of tiktok-engagement.ts pattern,
// scoped to Instagram (Reels + feed). Honors per-platform feature toggles
// (/ ). Pre-fix, the controller's switch fell through to a
// no-op `default`, so child-mode metric hiding silently failed on Reels.
//
// SELECTOR STRATEGY (per platform-capabilities `extractionStability: 'low'`):
// Instagram's class names rotate every deploy, so we anchor on `aria-label`
// and stable role attributes whenever possible. Selectors here are
// *intentionally over-broad* (CSS hides via display:none with !important)
// because the cost of "hides one extra element" is far lower than "metrics
// stay visible to a child who's been told they wouldn't see them".

import type { FWSettings } from '../../storage/settings';
import { isFeatureEnabled } from '../../storage/settings';
import { startStructuralEngagementScan } from './structural-finder';
import { startCountChipScan } from './section-model';
import { hideElement } from './mark-hidden';
import { ensureStyleTag, removeStyleTag } from './style-tag';
import { privateChatSubtreeCss } from '../platforms/adapter';
import { selectorFamily } from '../../core/repairs/families';

const INSTAGRAM_PLATFORM = 'instagram' as const;

// CSS style tag IDs (must match controller's STYLE_TAG_IDS roster — keep in
// sync if the controller's reset list ever changes).
const METRICS_CSS_ID = 'fw-instagram-metrics-css';
const ACTIONS_CSS_ID = 'fw-instagram-actions-css';
const COMMENT_BLOCK_CSS_ID = 'fw-instagram-comment-block-css';
// structural-finder CSS. Targets the data
// attributes that `structural-finder.ts` stamps on engagement bars +
// reaction-count rows. Resilient to Meta's class rotation and language
// switches — neither affects our own data attribute.
const STRUCTURAL_CSS_ID = 'fw-instagram-structural-css';

// ─── Block comment posting (input field + post button) ───
//
// Anchored on `<form method="POST">` (universal across IG layouts) and
// language-specific aria-labels for the comment input. Romanian + English
// covered explicitly; other locales fall through to the structural form
// hide via `<form method="POST">`. Pending the deep-research output for a
// fully language-agnostic comment-input identifier.

/**
 * The composer selectors, one per line, so the private-surface gate can be
 * appended to each. They were a single CSS string until 2026-09-19; a
 * stylesheet cannot call a predicate, which is how the sibling sheet in
 * facebook-engagement.ts reached a private conversation (M286).
 */
const COMMENT_BLOCK_SELECTORS: readonly string[] = [
  /* Composer textarea / contenteditable — match by role+aria-label, not form */
  'textarea[aria-label*="comment" i]',
  'textarea[aria-label*="coment" i]',
  '[contenteditable="true"][aria-label*="comment" i]',
  '[contenteditable="true"][aria-label*="coment" i]',
  '[role="textbox"][aria-label*="comment" i]',
  '[role="textbox"][aria-label*="coment" i]',
  /* Floating "Add a comment..." entry button on reels — opens the modal */
  'button[aria-label*="Add a comment" i]',
  'button[aria-label*="comentariu" i]',
  'button[aria-label*="comentario" i]',
  'button[aria-label*="commentaire" i]',
  'button[aria-label*="commento" i]',
  /* Post / Submit button next to the composer (multi-language stems) */
  'div[role="button"][aria-label*="Post" i][aria-label*="comment" i]',
  'div[role="button"][aria-label*="Publicar" i]',
  'div[role="button"][aria-label*="Publica" i]',
  /* Legacy form wrapper — kept as defense layer; cheap no-op when absent */
  'article form[method="POST"]',
  'article form textarea[aria-label*="comment" i]',
  'article form textarea[aria-label*="coment" i]',
  'article form button[type="submit"]',
];

/** Exported so a test can drive the real selectors against a real DOM. */
export function blockCommentInputCSS(): string {
  // Pre-2026-05-24 the entire selector chain was scoped under `article form…`.
  // IG migrated the composer from `<form method="POST">` to a React-controlled
  // `<div role="presentation">` shape (mirroring Meta's earlier FB pattern,
  // finished on IG mid-2025). When the form wrapper went away, EVERY rule
  // here became unmatched and block-comment-posting silently no-op'd.
  //
  // Fix: anchor on role + contenteditable + aria-label keyword stems (which
  // are language-resilient — "coment" substring catches RO "comentariu",
  // ES "comentario", PT "comentário", FR "commentaire", IT "commento";
  // "comment" catches EN). Legacy form selector stays as defense-in-depth
  // for any older surface still rendering it.
  //
  // The gate on every line is the CSS form of isInPrivateChatSubtree, built
  // from the one marker list in adapter.ts so the two cannot drift. Added
  // 2026-09-19 with the Facebook sheet's: Instagram's send-message modal is a
  // chat dialog on the same page as the feed, and several of these lines match
  // on an aria-label substring alone.
  const gate = `:not(:is(${privateChatSubtreeCss()}))`;
  return `
    ${selectorFamily('finder.instagram.comment-block', COMMENT_BLOCK_SELECTORS).map((sel) => sel + gate).join(',\n    ')} {
      display: none !important;
    }
  `;
}

// Found 2026-05-24: gated on `hideActions` so counts-only mode does
// NOT emit the rule. The rule's selector occasionally wins the
// specificity battle vs Meta's StyleX !important and was hiding action
// buttons that the structural-finder deliberately tagged but did not
// inline-style in counts-only mode. With no CSS rule emitted in
// counts-only mode, action buttons remain visible regardless of Meta's
// CSS — only count-like elements (inline-styled by tagAsEngagement) get
// hidden. Matches facebook-engagement.ts:structuralCSS shape.
function structuralCSS(hideMetrics: boolean, hideActions: boolean): string {
  if (!hideActions) return '';
  return `
    [data-fw-engagement-bar="true"] { display: none !important; }
  `;
}

function applyEngagementStyles(settings: FWSettings): void {
  const hideActions = isFeatureEnabled(settings, 'hide-action-buttons', INSTAGRAM_PLATFORM);
  const hideMetrics = isFeatureEnabled(settings, 'hide-engagement-metrics', INSTAGRAM_PLATFORM);
  const blockPosting = isFeatureEnabled(settings, 'block-comment-posting', INSTAGRAM_PLATFORM);

  if (blockPosting) {
    ensureStyleTag(COMMENT_BLOCK_CSS_ID, blockCommentInputCSS());
  } else {
    removeStyleTag(COMMENT_BLOCK_CSS_ID);
  }

  // evening — engagement-bar / counts hiding now lives
  // entirely in the structural finder + multi-language aria-label keyword
  // pass (see structural-finder.ts). The legacy English-only CSS rules
  // (hideMetricsCSS / hideActionsCSS) and per-bucket diagnostic
  // (logSelectorDiagnostics) were removed: live test on Romanian IG
  // confirmed 0 matches across every English bucket while the structural
  // path was successfully tagging elements. The METRICS_CSS_ID and
  // ACTIONS_CSS_ID style tags are intentionally untouched here so the
  // controller's reset list (STYLE_TAG_IDS) keeps removing any stale
  // tags from a prior install/build that may still be in the page.
  removeStyleTag(METRICS_CSS_ID);
  removeStyleTag(ACTIONS_CSS_ID);
  if (hideActions || hideMetrics) {
    ensureStyleTag(STRUCTURAL_CSS_ID, structuralCSS(hideMetrics, hideActions));
  } else {
    removeStyleTag(STRUCTURAL_CSS_ID);
  }
}

// ─── Orphan label hider ───
//
// IG session — after the structural finder hides Like /
// Comment / Repost / Distribuie / Save icons in the IG Reels vertical
// rail, the "Aprecieri" label below the Like icon stays visible. The
// label is just a <span> with no role/aria/svg, so Pass A never iterates
// it as a candidate. The Like row .xieb3on is at depth 4 above the
// tagged Like button (button → [data-visualcompletion] → span → div →
// row), and the [data-visualcompletion] ancestor is a META_STABLE_HOOK
// boundary that blocks any walk-up promotion in the structural finder.
//
// This walks each tagged engagement BUTTON/SVG, finds the smallest
// ancestor with ≥2 children (the "row level"), and hides any sibling
// subtree of that row that is text-only (no media, no interactive, no
// SVG) and ≤30 chars. The Like row's "Aprecieri" container is exactly
// this shape: a div tree of nested wrappers ending at <span>Aprecieri</
// span>, no buttons/icons.
//
// Safeguards (avoid hiding video / post content):
//   - Stop walking up at ROW_BOUNDARY_SELECTOR (article / dialog / main
//     / [role="feed"] / [data-pagelet*="reels"]).
//   - Walk at most 6 levels.
//   - Sibling must be a div/span (not video/img/canvas/audio/iframe/
//     embed/object/svg).
//   - Sibling subtree must contain NO interactive elements ([role=
//     "button"], [role="toolbar"], button, a[href]) and NO media/SVG.
//   - Sibling text length 1-30 chars (label text is short).
//
// Marker: data-fw-orphan-label="true" so cleanup can revert.

const ROW_BOUNDARY_SELECTOR =
  '[role="main"], main, article, [role="article"], [role="dialog"], '
  + '[role="complementary"], [role="feed"], '
  + '[data-pagelet*="reels"], [data-pagelet*="Feed"]';

const NON_LABEL_SELECTOR =
  'video, img, canvas, audio, iframe, embed, object, svg, '
  + '[role="button"], [role="toolbar"], button, a[href]';

function hideOrphanLabels(): void {
  const tagged = document.querySelectorAll<HTMLElement>(
    '[data-fw-engagement-bar="true"][role="button"], '
    + 'svg[aria-label][data-fw-engagement-bar="true"]'
  );
  for (const btn of tagged) {
    let cur: HTMLElement | null = btn.parentElement;
    let walked = 0;
    while (cur && walked < 6) {
      if (cur === document.body || cur === document.documentElement) break;
      if (cur.matches(ROW_BOUNDARY_SELECTOR)) break;
      if (cur.children.length >= 2) {
        for (const sibling of Array.from(cur.children)) {
          if (sibling.contains(btn)) continue;
          if (!(sibling instanceof HTMLElement)) continue;
          if (sibling.dataset.fwEngagementBar === 'true') continue;
          if (sibling.dataset.fwOrphanLabel === 'true') continue;
          if (sibling.matches(NON_LABEL_SELECTOR)) continue;
          if (sibling.querySelector(NON_LABEL_SELECTOR)) continue;
          const text = (sibling.textContent || '').replace(/\s+/g, ' ').trim();
          if (text.length < 1 || text.length > 30) continue;
          hideElement(sibling, {
            marker: 'data-fw-orphan-label', value: 'true',
            reason: 'hide-engagement-metrics:ig-orphan-label',
          });
        }
        break;
      }
      cur = cur.parentElement;
      walked++;
    }
  }
}

// ─── Main entry ───

export function startInstagramEngagementControl(settings: FWSettings): () => void {
  applyEngagementStyles(settings);

  // IG session — toggle wiring fix. Both the structural
  // scan and the orphan label hider must be GATED on the engagement-hide
  // toggles. Earlier, the scan ran unconditionally whenever the platform
  // module started (which is whenever ANY engagement-shaped feature is on
  // per shouldControlEngagement). Because tagAsEngagement applies inline
  // `display:none !important` directly to beat Meta's StyleX !important
  // specificity, so engagement icons stayed hidden even
  // when the user turned off hide-engagement-metrics + hide-action-
  // buttons but kept block-comment-posting on. Inline style beats
  // toggled-off CSS rule. Fix: gate scan + orphan-hider on the actual
  // hide toggles. If neither is on, no tagging happens, no inline style
  // is set, engagement stays visible.
  const hideMetrics = isFeatureEnabled(settings, 'hide-engagement-metrics', INSTAGRAM_PLATFORM);
  const hideActions = isFeatureEnabled(settings, 'hide-action-buttons', INSTAGRAM_PLATFORM);
  const wantStructuralScan = hideMetrics || hideActions;

  // structural-finder. Walks the DOM, finds
  // engagement bars + count rows by their structural fingerprint
  // (horizontal flex of 3-8 clickable children) + the multi-language
  // aria-label keyword pass, stamps them with our own data attribute.
  // The CSS rule attached above does the actual hiding. The scan is
  // throttled to one pass per 500ms so it doesn't stall the main thread
  // on a busy feed. Returns a teardown so the controller's reset path
  // can stop the scan when the platform changes.
  // diagnostic now reports per-tier hit counts so the
  // running-but-not-matching state shows WHICH signals fired. If aria
  // hits but svg/wrapper/structural don't, the icon paths need a refresh
  // (Meta rotated the icon library) or the post type doesn't sit inside
  // a Meta-stable wrapper. If structural hits but no others, we're
  // probably matching a non-engagement flex row (carousel dots, story
  // chip strip, etc.) and the fusion threshold correctly suppresses it.
  let firstScanLogged = false;
  let stopStructural: () => void = () => {};
  let stopChips: () => void = () => {};
  if (wantStructuralScan) {
    // Each scanner on its own toggle, both when both are on (2026-09-03,
    // same either/or gap as facebook-engagement.ts: the structural finder
    // does not catch a bare numeric chip).
    if (hideActions) {
      stopStructural = startStructuralEngagementScan((result) => {
        const t = result.tierHits;
        if (result.tagged > 0) {
          console.log(
            `[FW IG-engagement] tagged ${result.tagged} across ${result.containers} container(s) — `
              + `tier hits: aria=${t.aria} svg=${t.svg} wrapper=${t.wrapper} structural=${t.structural} count=${t.count}`,
          );
        } else if (result.containers > 0 && !firstScanLogged) {
          firstScanLogged = true;
          console.log(
            `[FW IG-engagement] scan ran but tagged 0 across ${result.containers} container(s) — `
              + `tier hits: aria=${t.aria} svg=${t.svg} wrapper=${t.wrapper} structural=${t.structural} count=${t.count}`,
          );
        }
      });
    }
    if (hideMetrics) {
      stopChips = startCountChipScan((result) => {
        if (result.newlyTagged > 0) {
          console.log(`[FW IG-engagement section-model] hid ${result.newlyTagged} chip(s)`);
        }
      });
    }
  }
  const stopScan = (): void => { stopStructural(); stopChips(); };

  // Orphan-label hider runs only when action buttons are being hidden —
  // it walks engagement buttons tagged by the structural-finder
  // (data-fw-engagement-bar="true" with role="button"), which only get
  // tagged in `hide-action-buttons` mode. In counts-only mode the chip
  // finder doesn't tag buttons, so the orphan-label pass would walk an
  // empty set every 2s; gating on hideActions skips the wasted cycles.
  let orphanLabelIntervalId: number | null = null;
  if (hideActions) {
    setTimeout(hideOrphanLabels, 600);
    orphanLabelIntervalId = window.setInterval(hideOrphanLabels, 2000);
  }

  return () => {
    removeStyleTag(METRICS_CSS_ID);
    removeStyleTag(ACTIONS_CSS_ID);
    removeStyleTag(COMMENT_BLOCK_CSS_ID);
    removeStyleTag(STRUCTURAL_CSS_ID);
    stopScan();
    if (orphanLabelIntervalId !== null) {
      window.clearInterval(orphanLabelIntervalId);
    }
    document.querySelectorAll<HTMLElement>('[data-fw-orphan-label="true"]').forEach(el => {
      delete el.dataset.fwOrphanLabel;
      el.style.removeProperty('display');
    });
  };
}
