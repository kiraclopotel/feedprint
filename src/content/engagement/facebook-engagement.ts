// FeelingWise — Facebook engagement control
//
// (post-pivot family ship): mirror of tiktok-engagement.ts pattern,
// scoped to Facebook (feed + Reels + watch). Honors per-platform feature
// toggles (/ ). Pre-fix, the controller's switch fell through
// to a no-op `default`, so child-mode metric hiding silently failed on FB.
//
// SELECTOR STRATEGY (per platform-capabilities `extractionStability: 'medium'`):
// Facebook's class names are obfuscated and rotate on deploy. We anchor on
// `aria-label`, `role`, and `data-testid` patterns that Meta has historically
// kept stable for accessibility. CSS hides are scoped under `div[role="article"]`
// so the chrome (header, sidebar, navigation) is untouched.

import type { FWSettings } from '../../storage/settings';
import { isFeatureEnabled } from '../../storage/settings';
import { startStructuralEngagementScan } from './structural-finder';
import { startCountChipScan } from './section-model';
import { hideElement } from './mark-hidden';
import { noteSelectorFamilySweep } from './selector-family-miss';
import { ensureStyleTag, removeStyleTag } from './style-tag';
import { observeAddedRoots } from './added-roots';
import { isFacebookCommentArticle } from '../platforms/facebook-comment-signal';
import { privateChatSubtreeCss, isInPrivateChatSubtree } from '../platforms/adapter';

const FACEBOOK_PLATFORM = 'facebook' as const;

const METRICS_CSS_ID = 'fw-facebook-metrics-css';
const ACTIONS_CSS_ID = 'fw-facebook-actions-css';
const COMMENT_BLOCK_CSS_ID = 'fw-facebook-comment-block-css';
// structural-finder CSS. See same docblock
// in instagram-engagement.ts: rotates Meta-class-rotation-proof by
// stamping the engagement bars / count rows with our own data attribute.
const STRUCTURAL_CSS_ID = 'fw-facebook-structural-css';

// ─── Block comment posting ───
//
// toggle semantics expanded after a live test:
// `block-comment-posting` was only hiding the composer (form / textbox)
// but the existing comment THREADS stayed visible — which contradicts
// the user's mental model of "block comments" (= no comments at all).
// Now hides BOTH the composer AND every <div role="article"
// aria-label="Comentariu adăugat de…"> comment thread element. Multi-
// language stems mirror _extractComments / _isCommentArticle in
// platforms/facebook.ts. Form-level hide stays as a universal-language
// catch-all for the composer.

/**
 * Stamped on a [role="article"] the comment signal accepts, so the block CSS
 * can reach a comment thread whose label is in a language the stem list does
 * not carry. An attribute and not a class: Meta rewrites className on its own
 * nodes, and data attributes have survived every rotation so far, which is the
 * same reason the structural finder uses one.
 */
const COMMENT_MARK_ATTRIBUTE = 'data-fw-fb-comment';

/**
 * Mark the comment articles in `root` for the block CSS above.
 *
 * Runs on the same three triggers as the expand-replies hider: once at start,
 * on every inserted subtree, and on a 2 second interval. Idempotent, and it
 * only ever adds the attribute the CSS reads; nothing is hidden from here, so
 * a wrong mark is undone by removing an attribute.
 */
function markCommentArticles(root: ParentNode = document): void {
  const articles: HTMLElement[] = [];
  if (root instanceof HTMLElement && root.matches('[role="article"]')) articles.push(root);
  root.querySelectorAll<HTMLElement>('[role="article"]').forEach(el => articles.push(el));
  for (const el of articles) {
    if (el.getAttribute(COMMENT_MARK_ATTRIBUTE) === '1') continue;
    if (!isFacebookCommentArticle(el)) continue;
    el.setAttribute(COMMENT_MARK_ATTRIBUTE, '1');
  }
}

/**
 * Every selector the comment-block switch hides, one per line so the private
 * gate below can be appended to each of them.
 *
 * It used to be one template string of selectors ending in a single
 * `display:none !important`, with nothing excluding private surfaces. A read of
 * this file on 2026-09-19 put it beside its six siblings (word-filter,
 * empty-comment-hide, ai-content-blocker, feed-ad-blocker, section-model,
 * structural-finder) and it was the only one with no gate, because a stylesheet
 * cannot call `isInPrivateChatSubtree`. It did not need to call it: the same
 * rule, built from the same marker list, is available as a selector.
 *
 * What was at stake is not theoretical. `form[role="presentation"]` is a bare
 * match on a form wrapper, the reply stems match "Reply to" and "Răspuns", and
 * the Messenger dock renders replies and a composer inside a chat dialog on the
 * same page as the feed. The standing rule is that private surfaces are out of
 * scope for every filter, gated by DOM region and never by URL alone.
 */
const COMMENT_BLOCK_SELECTORS: ReadonlyArray<string> = [
  /* Composer — form[role="presentation"] is FB's stable composer
     wrapper across feed + modal + photo viewer. */
  'form[role="presentation"]',
  '[aria-label*="Write a comment" i]',
  '[aria-label*="Scrie un comentariu" i]',
  '[contenteditable="true"][role="textbox"][aria-label*="comment" i]',
  '[contenteditable="true"][role="textbox"][aria-label*="coment" i]',
  /* Comment threads + replies (top-level + nested). dropped [role="article"] / article ancestor requirement after a
     diagnostic showed [role="article"] divs with aria-label starting
     "Răspuns de la X la răspunsul adăugat de Y" (deep replies) NOT
     getting hit by the role-prefixed selector despite the aria-label
     containing "Răspuns". Cause unclear (possibly FB inline-style
     specificity beat). The bare [aria-label*=...] selector is broader
     but our stems are specific enough (Comentariu, Răspuns, Comment
     by, Reply by, etc.) that the false-positive surface stays small. */
  '[aria-label*="Comentariu" i]',
  '[aria-label*="Comment by" i]',
  '[aria-label*="Comment from" i]',
  '[aria-label*="Commentaire" i]',
  '[aria-label*="Comentario" i]',
  '[aria-label*="Comentário" i]',
  '[aria-label*="Kommentar" i]',
  '[aria-label*="Commento" i]',
  '[aria-label*="Răspuns" i]',
  '[aria-label*="Raspuns" i]',
  '[aria-label*="Reply by" i]',
  '[aria-label*="Reply from" i]',
  /* Reply prompts — "Răspunde-i X..." / "Reply to X" inline buttons. */
  '[aria-label*="Răspunde-i" i]',
  '[aria-label*="Raspunde-i" i]',
  '[aria-label*="Reply to" i]',
  /* "Vezi N răspunsuri" / "View N replies" expand links. */
  '[aria-label*="Vezi" i][aria-label*="răspuns" i]',
  '[aria-label*="View" i][aria-label*="repl" i]',
  /* :has() parent-of-comment selector. After live
     testing on a tree-view modal, hiding the comment article alone
     left orphaned avatar wrappers (FB renders avatars in a sibling
     column wrapper, not inside the article). Hiding the direct parent
     that contains the comment article removes both the avatar column
     and the text column at once. Chrome 105+ supports :has().
     The :not([role="article"]) on each parent rule is the guard a comment
     that IS a direct child of the post article needs: without it the parent
     matched is the post, and the switch would take the post down with the
     comment. Meta renders the avatar column wrapper between the two today,
     so the guard changes nothing on the shape seen live and answers the one
     shape that would be a disaster. */
  '*:not([role="article"]):has(> [aria-label*="Comentariu" i])',
  '*:not([role="article"]):has(> [aria-label*="Răspuns" i])',
  '*:not([role="article"]):has(> [aria-label*="Comment by" i])',
  '*:not([role="article"]):has(> [aria-label*="Reply by" i])',
  /* The stems above are eight European languages; Facebook is read in
     about a hundred, and in the rest a comment thread stayed on screen
     with the switch on. markCommentArticles below stamps every article
     that owns a comment permalink, which is language-free, and this pair
     hides it and its avatar column the same way. */
  `[${COMMENT_MARK_ATTRIBUTE}="1"]`,
  `*:not([role="article"]):has(> [${COMMENT_MARK_ATTRIBUTE}="1"])`,
];

/**
 * The gate, appended to every selector above: nothing inside a chat log or a
 * chat dialog is touched. `privateChatSubtreeCss` is the CSS form of
 * `isInPrivateChatSubtree`, built from the one marker list in adapter.ts, so
 * the two cannot drift apart.
 */
function outsidePrivateSurfaces(): string {
  return `:not(:is(${privateChatSubtreeCss()}))`;
}

/** Exported so a test can drive the real selectors against a real DOM. */
export function blockCommentInputCSS(): string {
  const gate = outsidePrivateSurfaces();
  return `
    ${COMMENT_BLOCK_SELECTORS.map((sel) => sel + gate).join(',\n    ')} {
      display: none !important;
    }
  `;
}

// ── Q27 diagnostic: counting-only probe of the comment-block selector
// surface. The bare `[aria-label*="Comentariu" i]` family and the
// `*:has(> ...)` parent hides are suspected of occasionally matching a
// post's own action button or content wrapper and hiding the whole post.
// Per project law (instrument before you patch), this probe REPORTS what
// those rules match on the live page and changes nothing. Read the
// numbers from the console on a real FB session before touching the
// selectors. A match is counted RISKY when the hidden element would carry
// post content: it contains media, or more than 500 chars of text.
//
// The probe reads the selectors as they SHIP. When the parent rules gained
// their :not([role="article"]) guard the probe copy gained it too, or the
// numbers would describe a risk the switch no longer takes.
const PROBE_BARE_SELECTORS: readonly string[] = [
  '[aria-label*="Comentariu" i]',
  '[aria-label*="Răspuns" i]',
  '[aria-label*="Comment by" i]',
  '[aria-label*="Reply by" i]',
  '[aria-label*="Reply to" i]',
  `[${COMMENT_MARK_ATTRIBUTE}="1"]`,
];
const PROBE_HAS_SELECTORS: readonly string[] = [
  '*:not([role="article"]):has(> [aria-label*="Comentariu" i])',
  '*:not([role="article"]):has(> [aria-label*="Răspuns" i])',
  '*:not([role="article"]):has(> [aria-label*="Comment by" i])',
  '*:not([role="article"]):has(> [aria-label*="Reply by" i])',
  `*:not([role="article"]):has(> [${COMMENT_MARK_ATTRIBUTE}="1"])`,
];

function isRiskyMatch(el: HTMLElement): boolean {
  if (el.querySelector('video, img:not([alt=""])')) return true;
  return (el.textContent ?? '').length > 500;
}

export function probeCommentBlockMatches(): {
  bare: number; bareRisky: number; hasParents: number; hasParentsRisky: number;
} {
  let bare = 0, bareRisky = 0, hasParents = 0, hasParentsRisky = 0;
  for (const sel of PROBE_BARE_SELECTORS) {
    document.querySelectorAll<HTMLElement>(sel).forEach(el => {
      bare += 1;
      if (isRiskyMatch(el)) bareRisky += 1;
    });
  }
  for (const sel of PROBE_HAS_SELECTORS) {
    try {
      document.querySelectorAll<HTMLElement>(sel).forEach(el => {
        hasParents += 1;
        if (isRiskyMatch(el)) hasParentsRisky += 1;
      });
    } catch {
      // :has() unsupported in this environment (old jsdom) — skip.
    }
  }
  return { bare, bareRisky, hasParents, hasParentsRisky };
}

function logCommentBlockProbe(): void {
  const r = probeCommentBlockMatches();
  // One line, greppable. Risky counts above zero are the signal that the
  // selector surface is hiding post content, not just comment chrome.
  console.log(
    `[FW fb-comment-block probe] bare=${r.bare} bareRisky=${r.bareRisky} ` +
    `hasParents=${r.hasParents} hasParentsRisky=${r.hasParentsRisky} path=${location.pathname}`,
  );
}

// Structural CSS — paired with the inline `display:none` that
// `structural-finder.tagAsEngagement` stamps on tagged elements. The CSS
// rule alone loses the specificity battle vs Meta's StyleX `!important`
// declarations, so the inline form is the actual hiding mechanism.
//
// Per a 2026-05-24 finding, the rule is now GATED on `hideActions`. In
// counts-only mode (metrics-hide ON, action-hide OFF) the rule would
// otherwise sometimes win the specificity battle and hide buttons that
// the structural-finder TAGGED but deliberately DID NOT inline-style —
// which collapsed the two toggles into the same visual effect. With the
// rule emitted only when `hideActions` is on, counts-only mode is
// guaranteed not to hide action buttons regardless of Meta's CSS state:
// no CSS rule exists for them, and they have no inline style stamped.
// The CSS rule stays as belt-and-suspenders in action mode (where the
// inline display:none is already the load-bearing mechanism).
function structuralCSS(hideMetrics: boolean, hideActions: boolean): string {
  if (!hideActions) return '';
  return `
    [data-fw-engagement-bar="true"] { display: none !important; }
  `;
}

// JS-based "Vezi N răspunsuri" / "View N replies"
// expand-link hider. Per a live-captured outerHTML: the link has NO aria-label,
// just nested <span dir="auto">Vezi 1 răspuns</span>. CSS can't text-
// match. This walks role=button elements, regex-matches their
// textContent, then climbs to the wrapper (button.parentElement) and
// hides it inline. Wrapper-hide vs button-hide because the wrapper
// also contains the tree-connector decoration div that would otherwise
// stay visible.
// patterns covering all reply-prompt shapes reported
// from live installs:
//   1. "Vezi 1 răspuns" / "View 5 replies" (direct expand link)
//   2. "Vezi toate cele 9 răspunsuri" / "View all 9 replies" (filler phrase)
//   3. "Ilinca Model a răspuns · 1 răspuns" / "X replied · 1 reply"
//      (named-author thread reply prompt with avatar)
// Two checks, both must pass: bounded length (< 80 chars — real
// comments are longer; prompts are short) AND contains a reply-related
// trigger phrase. AND-combination keeps the false-positive surface
// minimal vs. matching every short button.
// flexible "Vezi" pattern. Variants seen in the wild:
//   "Vezi 1 răspuns"
//   "Vezi toate cele 9 răspunsuri"
//   "Vezi toate cele 72 de răspunsuri"  ← Romanian inserts "de" between
//                                          digit and noun on counts ≥20
//   "View 5 replies"
//   "View all 5 replies"
// .*? is non-greedy; the noun anchor ensures we don't run away. Length-
// bounding (80 chars) in the caller keeps the surface small.
const EXPAND_VEZI_PATTERN = /^\s*(?:vezi|view|afișează|afiseaza)\b.*?\d+.*?\b(?:răspuns|raspuns|repl)/i;
const REPLY_AUTHOR_PATTERN = /\ba\s+r[ăa]spuns\b|\breplied\b|\bhas\s+replied\b/i;

function hideExpandRepliesPrompts(root: ParentNode = document): void {
  // The incremental path passes an inserted subtree; the root itself may
  // be the button (querySelectorAll never returns the root).
  const buttons: HTMLElement[] = [];
  if (root instanceof HTMLElement && root.matches('[role="button"]')) buttons.push(root);
  root.querySelectorAll<HTMLElement>('[role="button"]').forEach((b) => buttons.push(b));
  for (const btn of buttons) {
    if (btn.dataset.fwExpandRepliesHidden === 'true') continue;
    // Two gates this scan had neither of, both found 2026-09-19.
    //
    // FIRST, where it is. The scan is started for the whole document and
    // REPLY_AUTHOR_PATTERN matches the bare word "replied" anywhere in any
    // short button, then hides that button's PARENT. Facebook puts "Ana
    // replied to your story" on a notification row and "Ana replied" in the
    // Messenger dock, and neither is a thread expander. A reply expander
    // always sits under the post it belongs to, so the button has to be inside
    // a `[role="article"]`; the notification list and the dock are not.
    //
    // SECOND, whose it is. The standing rule of this codebase is that private
    // surfaces are out of scope for every filter, gated by DOM region and never
    // by URL alone. This scan is the second filter in this file found without
    // it on the same day, after the comment-block sheet (M286), and it is the
    // one that can hide a row of somebody's conversation.
    if (!btn.closest('[role="article"]')) continue;
    if (isInPrivateChatSubtree(btn)) continue;
    const text = (btn.textContent || '').trim();
    if (text.length === 0 || text.length > 80) continue;
    const isPrompt = EXPAND_VEZI_PATTERN.test(text) || REPLY_AUTHOR_PATTERN.test(text);
    if (!isPrompt) continue;
    const wrapper = btn.parentElement || btn;
    // Runs under block-comment-posting (see the interval wiring below), not
    // under hide-engagement-metrics as the old reason claimed (M116).
    hideElement(wrapper, {
      marker: 'data-fw-expand-replies-hidden', value: 'true',
      reason: 'block-comment-posting:fb-expand-replies',
    });
    btn.dataset.fwExpandRepliesHidden = 'true';
  }
}

function applyEngagementStyles(settings: FWSettings): void {
  const hideActions = isFeatureEnabled(settings, 'hide-action-buttons', FACEBOOK_PLATFORM);
  const hideMetrics = isFeatureEnabled(settings, 'hide-engagement-metrics', FACEBOOK_PLATFORM);
  const blockPosting = isFeatureEnabled(settings, 'block-comment-posting', FACEBOOK_PLATFORM);

  if (blockPosting) {
    ensureStyleTag(COMMENT_BLOCK_CSS_ID, blockCommentInputCSS());
  } else {
    removeStyleTag(COMMENT_BLOCK_CSS_ID);
  }

  // evening — engagement-bar / counts hiding now lives
  // entirely in the structural finder + multi-language aria-label keyword
  // pass (see structural-finder.ts). The legacy English-only CSS rules
  // (hideMetricsCSS / hideActionsCSS) and per-bucket diagnostic
  // (logSelectorDiagnostics) were removed: live test on Romanian FB
  // confirmed 0 matches across every English bucket. The METRICS_CSS_ID
  // and ACTIONS_CSS_ID style tags are intentionally untouched here so
  // the controller's reset list keeps removing any stale tags from a
  // prior install/build that may still be in the page.
  removeStyleTag(METRICS_CSS_ID);
  removeStyleTag(ACTIONS_CSS_ID);
  if (hideActions || hideMetrics) {
    ensureStyleTag(STRUCTURAL_CSS_ID, structuralCSS(hideMetrics, hideActions));
  } else {
    removeStyleTag(STRUCTURAL_CSS_ID);
  }
}

// ─── Main entry ───

export function startFacebookEngagementControl(settings: FWSettings): () => void {
  applyEngagementStyles(settings);

  // IG session — toggle wiring fix (mirrored on FB).
  // The structural scan must be GATED on the engagement-hide toggles.
  // Earlier, the scan ran unconditionally whenever the platform module
  // started (= whenever ANY engagement-shaped feature was on per
  // shouldControlEngagement). Because tagAsEngagement applies inline
  // `display:none !important` directly to beat Meta's StyleX !important
  // specificity, so engagement icons stayed hidden even
  // when the user toggled hide-engagement-metrics + hide-action-buttons
  // OFF but kept e.g. block-comment-posting on. Inline style beat the
  // toggled-off CSS rule. Fix: gate the scan on the actual hide toggles.
  const hideMetrics = isFeatureEnabled(settings, 'hide-engagement-metrics', FACEBOOK_PLATFORM);
  const hideActions = isFeatureEnabled(settings, 'hide-action-buttons', FACEBOOK_PLATFORM);
  const wantStructuralScan = hideMetrics || hideActions;

  // evening — diagnostic only logs through the structural
  // scan now (see callback below). The per-bucket aria-label diagnostic
  // was removed — every bucket reported NO MATCHES on live Romanian FB,
  // confirming dead code; the structural scan's running-or-not log is
  // the authoritative diagnostic going forward.
  // Logs on bars > 0 OR (containers > 0 AND not-yet-logged), so the
  // running-but-not-matching state is observable.
  let firstScanLogged = false;
  let stopStructural: () => void = () => {};
  let stopChips: () => void = () => {};
  if (wantStructuralScan) {
    // Two scanners, each on its own toggle (2026-09-03). They used to be
    // either/or: with hide-action-buttons on, only the structural finder
    // ran, and its count tier needs a noun ("194 comentarii"), so a bare
    // "2.4K" chip beside a reaction icon stayed visible with both toggles
    // on (owner's Facebook screenshot, Off, Adolescent preset). The
    // section-model chip finder is the one built for those chips; it now
    // runs whenever hide-engagement-metrics is on, beside the structural
    // scan when hide-action-buttons is on too. Both are idempotent.
    if (hideActions) {
      stopStructural = startStructuralEngagementScan((result) => {
        const t = result.tierHits;
        // RECON F3a: no Facebook path called this, so the dashboard's DOM-health
        // panel printed "no visit observed today" for Facebook on a day the user
        // had browsed it for hours. A surface FeelingWise cannot see must never
        // report clean. Gated on containers > 0 so a non-feed path (settings,
        // marketplace, a bare profile) is silence rather than a false miss.
        if (result.containers > 0) {
          noteSelectorFamilySweep('facebook.engagement-bars', result.matched);
        }
        if (result.tagged > 0) {
          console.log(
            `[FW FB-engagement] tagged ${result.tagged} across ${result.containers} container(s) — `
              + `tier hits: aria=${t.aria} svg=${t.svg} wrapper=${t.wrapper} structural=${t.structural} count=${t.count}`,
          );
        } else if (result.containers > 0 && !firstScanLogged) {
          firstScanLogged = true;
          console.log(
            `[FW FB-engagement] scan ran but tagged 0 across ${result.containers} container(s) — `
              + `tier hits: aria=${t.aria} svg=${t.svg} wrapper=${t.wrapper} structural=${t.structural} count=${t.count}`,
          );
        }
      });
    }
    if (hideMetrics) {
      stopChips = startCountChipScan((result) => {
        // Same blind spot as the actions path above. Gated on a feed article
        // being present so non-feed Facebook pages report nothing either way.
        if (document.querySelector('div[role="article"]')) {
          noteSelectorFamilySweep('facebook.count-chips', result.found);
        }
        if (result.newlyTagged > 0) {
          console.log(`[FW FB-engagement section-model] hid ${result.newlyTagged} chip(s)`);
        }
      });
    }
  }
  const stopScan = (): void => { stopStructural(); stopChips(); };

  // periodic JS-based "Vezi N răspunsuri" hider. Only
  // active when block-comment-posting is on (same toggle that drives the
  // CSS comment-thread hide). 2-second interval matches the structural-
  // finder cadence; idempotent via dataset.fwExpandRepliesHidden.
  const blockPosting = isFeatureEnabled(settings, 'block-comment-posting', FACEBOOK_PLATFORM);
  let expandRepliesIntervalId: number | null = null;
  let probeIntervalId: number | null = null;
  let stopExpandRepliesAdded: () => void = () => {};
  if (blockPosting) {
    hideExpandRepliesPrompts();
    markCommentArticles();
    // Inserted subtrees at mutation time: measured 2026-09-03 at p50 1.3 s,
    // max 2.0 s when only the interval below ran.
    stopExpandRepliesAdded = observeAddedRoots((roots) => {
      for (const root of roots) {
        hideExpandRepliesPrompts(root);
        markCommentArticles(root);
      }
    });
    expandRepliesIntervalId = window.setInterval(() => {
      hideExpandRepliesPrompts();
      markCommentArticles();
    }, 2000);
    // Q27 counting-only probe: 30 s cadence keeps the querySelectorAll cost
    // negligible while giving a live session enough samples to read.
    logCommentBlockProbe();
    probeIntervalId = window.setInterval(logCommentBlockProbe, 30_000);
  }

  return () => {
    removeStyleTag(METRICS_CSS_ID);
    removeStyleTag(ACTIONS_CSS_ID);
    removeStyleTag(COMMENT_BLOCK_CSS_ID);
    removeStyleTag(STRUCTURAL_CSS_ID);
    stopScan();
    stopExpandRepliesAdded();
    if (expandRepliesIntervalId !== null) {
      window.clearInterval(expandRepliesIntervalId);
    }
    if (probeIntervalId !== null) {
      window.clearInterval(probeIntervalId);
    }
    // Clear the inline display:none + marker on toggle-off so hidden
    // wrappers re-render. The cleanup mirrors structural-finder.ts +
    // controller.ts:resetEngagementDOM patterns.
    document.querySelectorAll<HTMLElement>('[data-fw-expand-replies-hidden="true"]').forEach(el => {
      delete el.dataset.fwExpandRepliesHidden;
      el.style.removeProperty('display');
    });
    document.querySelectorAll<HTMLElement>(`[${COMMENT_MARK_ATTRIBUTE}="1"]`).forEach(el => {
      el.removeAttribute(COMMENT_MARK_ATTRIBUTE);
    });
  };
}
