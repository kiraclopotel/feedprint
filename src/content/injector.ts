// FeelingWise - DOM injection
// V1 surfaces:
//   child  — invisible replacement (zero UI)
//   teen   — neutralized text only (no panel, no dot, no in-feed UI)
//
// The reframe happens silently (text replaced via injectTeen → replaceText)
// and the forensic record carries the model's `primaryTechnique` +
// `explanation`; per-post analysis lives in the dashboard / forensic
// export, not in the feed. Video-platform flagging surfaces
// (flagVideoContainer + flagComment below) are unrelated and untouched.
import { NeutralizedContent } from '../types/neutralization';
import { AnalysisResult } from '../types/analysis';
import type { Platform } from '../types/post';
import { Mode } from '../types/mode';
import { renderTeenMarker, resyncMarkerToGreen } from './markers/teen-marker';
import { renderSeenALotPill } from './markers/seen-a-lot-pill';
import { clearRewriteMarks, markAiText, writerOfRewrite } from './markers/ai-mark';
import type { ResolvedUiLanguage } from '../i18n';
import { MARKER_STRINGS } from '../i18n/marker-strings';
import type { Why } from '../core/policy/why';
import { whyFragment } from './markers/hide-why';
import { rememberTikTokAdHide } from './platforms/tiktok-ad-remount';
import {
  videoFeedItemOf,
  silenceVideoItem,
  releaseVideoItem,
  snapshotCommentPanel,
  snapshotWatched,
  afterFeedItemHidden,
  keepsItemBox,
} from './protection/video-feed-hide';
import { isInspectionTab } from './post-path/inspection-mode';
import { bumpCounter } from '../diagnostics/diagnostics';
import { noteHideChipMounted } from './probes/hide-chip-probe';
import { muteAndPauseMedia, noteAdSlot } from './hide-primitives';
import { stripEmojis } from '../core/text-sanitize';
import { holdsMoreThanWords } from './text-box';
// ─── MutationObserver guards ───

const guards = new WeakMap<HTMLElement, MutationObserver>();
const guardOrder: HTMLElement[] = [];
// bumped 50 → 500 (live X-feed report). At 50,
// scrolling the X main feed evicts older guards while their tweet elements
// are STILL in the DOM. X's React layer re-renders virtualized tweets on
// scroll-back; without a guard, the rewrite vanishes silently. Refresh
// "fixes" it because it resets scroll to top with all-fresh-guards;
// direct status URL "works" because the conversation tree has <50 elements.
// 500 is generous headroom for typical session scrolls; the disconnected-
// element pruning below keeps memory bounded for actually-detached nodes.
const MAX_GUARDS = 500;

/** Put-backs one element may take inside the window before its guard stands down. */
const GUARD_CHURN_MAX = 20;
const GUARD_CHURN_WINDOW_MS = 2_000;
const guardPutBacks = new WeakMap<HTMLElement, number[]>();

function guardChurnTripped(el: HTMLElement, now: number = Date.now()): boolean {
  const times = (guardPutBacks.get(el) ?? []).filter((t) => now - t < GUARD_CHURN_WINDOW_MS);
  times.push(now);
  guardPutBacks.set(el, times);
  return times.length > GUARD_CHURN_MAX;
}

// The guard defends one post. When the element holds words that are neither that post's original nor
// its rewrite, the page has put another post in it and the guard must not write over it. Compared on
// the first characters only, since a page may draw more words after the original ("Show more") or cut
// it short after a few words ("... See more"), which leaves too little to hold the whole probe.
const OTHER_POST_PROBE_CHARS = 40;
const CUT_FORM_MIN_SHARED_CHARS = 8;
// A cut form's own trailing control is short (text-fold.ts's fold labels top out at 32 characters
// across every language it lists); a real post that happens to open the same way as another one is
// not bounded that way, so the length after the last ellipsis tells the two apart.
const CUT_FORM_MAX_TRAILING_CHARS = 40;

function sharedStartLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
}

/**
 * Whether the text ends the way a cut form does: the words before the last ellipsis are the start of
 * the original (`shared` is the length of the prefix the two texts have in common), and only a short
 * see-more label follows it.
 */
function endsLikeACutForm(text: string, shared: number): boolean {
  const i = Math.max(text.lastIndexOf('…'), text.lastIndexOf('...'));
  return i >= 0 && text.length - i <= CUT_FORM_MAX_TRAILING_CHARS && shared >= text.slice(0, i).trimEnd().length;
}

function wordsOf(text: string): string {
  return normalizedText(stripEmojis(text));
}

function holdsAnotherPost(el: HTMLElement, expectedText: string, originalText: string): boolean {
  const original = wordsOf(originalText);
  const now = wordsOf(el.textContent ?? '');
  if (original === '' || now === '') return false;
  if (now.includes(original.slice(0, OTHER_POST_PROBE_CHARS))) return false;
  if (now.includes(wordsOf(expectedText).slice(0, OTHER_POST_PROBE_CHARS))) return false;
  const shared = sharedStartLength(now, original);
  if (shared < Math.min(CUT_FORM_MIN_SHARED_CHARS, original.length)) return true;
  if (shared >= original.length) return false;
  // Some but not all of the original is shared, and neither full probe matched above: only a real
  // cut form ends in a see-more mark after words that are the original's own. Two different posts that
  // happen to open the same way do not, and sharing an opening is not enough on its own to call them
  // the same post.
  return !endsLikeACutForm(now, shared);
}

let standDownHandler: ((el: HTMLElement) => void) | null = null;

/**
 * Who reads an element again once its guard has left it. The stamps that say "already read" sit on
 * the element the guard held, so without this a post the page drew into it stays unread. The words
 * are read as a new post, which also covers a translation of the same post: it gets its own verdict.
 */
export function setGuardStandDownHandler(handler: ((el: HTMLElement) => void) | null): void {
  standDownHandler = handler;
}

function standDownFromAnotherPost(el: HTMLElement): void {
  el.removeAttribute('data-fw-neutralized');
  el.removeAttribute('data-fw-action');
  el.querySelectorAll('.fw-teen-marker').forEach((m) => m.remove());
  delete el.dataset.fwMarkerState;
  clearRewriteMarks(el);
  try { standDownHandler?.(el); } catch { /* the guard has already left; a failed re-read must not throw into the page */ }
}

/**
 * The page has given this element to another post, and told us so (YouTube's
 * title element is one: the same node carries every video the user switches
 * to, F65). Everything our mark left on it goes: the guard, so it never puts
 * the old words back; the dot and the state stamp, so the old explanation and
 * the old title cannot be shown again; the "already handled" stamps, so the
 * new words are read as their own post. The words themselves are not touched:
 * the page has already written the new ones, or is about to.
 */
export function releaseMarkedElement(el: HTMLElement): void {
  const obs = guards.get(el);
  if (obs) {
    obs.disconnect();
    guards.delete(el);
  }
  el.removeAttribute('data-fw-neutralized');
  el.removeAttribute('data-fw-action');
  el.querySelectorAll('.fw-teen-marker').forEach((m) => m.remove());
  delete el.dataset.fwMarkerState;
  clearRewriteMarks(el);
  // The colour a pressed dot pinned on the words (writeHolderText) would outlive the mark.
  el.style.removeProperty('color');
  el.querySelectorAll<HTMLElement>('[style*="color"]').forEach((c) => c.style.removeProperty('color'));
}

function addGuard(el: HTMLElement, expectedText: string, originalText: string = ''): void {
  // Remove existing guard if any
  const existing = guards.get(el);
  if (existing) existing.disconnect();

  const observer = new MutationObserver(() => {
    // when the v3 marker semaphore is in non-green
    // state, the user has explicitly toggled to YELLOW (reason) or RED
    // (original). The guard's job is to defend the rewrite against the
    // platform's React re-render layer, NOT to fight the user's toggle.
    // Without this skip, the guard re-applies the rewrite immediately
    // after the toggle's `holder.textContent = newText` mutation —
    // making the YELLOW/RED states unreachable on guarded post bodies
    // (the post path adds a guard via `injectTeen`/`injectCollapseOrHide`;
    // the comment-batch path doesn't, which is why toggle worked
    // on comments but stuck on posts (screenshot, 2026-05-05).
    // Q66 (W62): skip ONLY the explicit user states. 'green' and 'base'
    // both mean "FW-chosen content should be visible" (rewrite / calm
    // placeholder), and the guard defends them; 'yellow'/'red' mean the
    // user pressed for the explanation or the original, and the guard
    // must not fight them. The old `!== 'green'` skip treated the
    // collapse toggle's resting stamp as a user action and disarmed the
    // guard on every folded post.
    if (el.dataset.fwMarkerState === 'yellow' || el.dataset.fwMarkerState === 'red') {
      return;
    }
    // What the reader sees decides. The original's extra spans stay in the element, hidden, so the
    // whole text never equals the rewrite; and with emoji stripping on, the stripper takes the
    // rewrite's own emoji. Putting the rewrite back in either case restarted the stripper, which
    // woke this guard again, without end (a test counted the fight past 300 changes).
    if (el.textContent === expectedText
      || replacementIsVisible(el, expectedText)
      || replacementIsVisible(el, stripEmojis(expectedText))) {
      return;
    }
    if (holdsAnotherPost(el, expectedText, originalText)) {
      observer.disconnect();
      guards.delete(el);
      standDownFromAnotherPost(el);
      bumpCounter('rewriteGuardLeftAnotherPost');
      return;
    }
    // A platform that keeps rewriting the element is not fought forever.
    if (guardChurnTripped(el)) {
      observer.disconnect();
      guards.delete(el);
      bumpCounter('rewriteGuardChurnStopped');
      return;
    }
    replaceText(el, expectedText);
  });

  observer.observe(el, { characterData: true, childList: true, subtree: true });
  guards.set(el, observer);
  guardOrder.push(el);

  // Prune disconnected elements (virtual scrolling cleanup). Walk the list
  // every add so memory stays bounded even with MAX_GUARDS at 500 — the
  // same loop ran before, just at a different cap.
  for (let i = guardOrder.length - 1; i >= 0; i--) {
    if (!guardOrder[i].isConnected) {
      const removed = guardOrder.splice(i, 1)[0];
      const obs = guards.get(removed);
      if (obs) {
        obs.disconnect();
        guards.delete(removed);
      }
    }
  }

  // Enforce max guard limit. Now an emergency cap, not the routine path:
  // healthy sessions never hit this because the connected-pruning loop
  // above keeps the active set close to the visible-DOM size.
  while (guardOrder.length > MAX_GUARDS) {
    const oldest = guardOrder.shift()!;
    const oldObserver = guards.get(oldest);
    if (oldObserver) {
      oldObserver.disconnect();
      guards.delete(oldest);
    }
  }
}

/**
 * Q72 (W64): release every rewrite guard (disconnect observers, drop the
 * strong element refs). Called from interceptor.stop(); NOT called on a
 * markers toggle-off, because the guards defend the rewrites themselves
 * and the rewrite protection outlives the marker UI.
 */
export function releaseAllGuards(): void {
  for (const el of guardOrder) {
    const obs = guards.get(el);
    if (obs) {
      obs.disconnect();
      guards.delete(el);
    }
  }
  guardOrder.length = 0;
}

// ─── Span-aware text replacement ───
// Twitter tweets use [data-testid="tweetText"] which contains multiple
// <span> elements for text segments, plus <a> for links/mentions and
// <img> for emoji. We preserve the DOM structure by placing text in the
// first text-bearing span and hiding extra spans, while keeping non-text
// nodes (emoji images, etc.) in place to avoid breaking layout.

function replaceText(el: HTMLElement, text: string): boolean {
  if (holdsMoreThanWords(el)) return false;
  // Pause guard during our own mutation to avoid re-entry
  const existingGuard = guards.get(el);
  if (existingGuard) existingGuard.disconnect();

  // + preserve text color AND font properties
  // across the mutation. Color preservation lands the FB story_message
  // visibility fix (per the screenshot bug on a news post); font preservation lands
  // a screenshot report (the font looked different and needed to match);
  // when `replaceText`'s fallback path strips
  // X tweetText's nested spans, the visible text inherits the outer
  // article's font-family/size/weight which can differ from the tweetText's
  // own resolved font. Snapshot the deepest text-bearing element's computed
  // styles BEFORE mutating; apply them as inline style after. Idempotent
  // for platforms that already match (the inline values equal what the
  // browser already computed). Cheap (single getComputedStyle).
  const preservedStyle = (() => {
    try {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const firstText = walker.nextNode();
      const parent = firstText?.parentElement;
      if (parent) {
        const cs = window.getComputedStyle(parent);
        return {
          color: cs.color,
          fontFamily: cs.fontFamily,
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
          lineHeight: cs.lineHeight,
        };
      }
    } catch { /* defensive: jsdom or weird DOM */ }
    return null;
  })();
  // Back-compat alias for the single-color local that the rest of
  // this function reads.
  const preservedColor = preservedStyle?.color ?? null;

  try {
    const children = Array.from(el.childNodes);
    if (children.length === 0) {
      el.textContent = text;
      if (preservedColor) el.style.color = preservedColor;
      return true;
    }

    // Find all direct child spans and text nodes (Twitter's structure)
    let placed = false;
    for (const child of children) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (!placed) {
          child.textContent = text;
          placed = true;
        } else {
          child.textContent = '';
        }
      } else if (child instanceof HTMLElement) {
        if (child.tagName === 'SPAN') {
          if (!placed) {
            child.textContent = text;
            child.style.display = '';
            placed = true;
          } else {
            // Hide extra spans rather than emptying, to preserve layout space
            child.style.display = 'none';
          }
        } else if (child.tagName === 'A') {
          // Hide link spans (mentions, hashtags, urls) from original
          child.style.display = 'none';
        } else if (child.tagName === 'IMG') {
          // Hide emoji images from original text
          child.style.display = 'none';
        }
      }
    }

    // If no suitable child was found, fall back to textContent
    if (!placed) {
      el.textContent = text;
    }

    // apply preserved color via inline style. For platforms where
    // `placed === true` (Twitter span-aware path), this still wins specificity
    // safely because we apply the SAME color the span already had — idempotent.
    // For the fallback path (FB story_message), this rescues visibility.
    if (preservedColor) el.style.color = preservedColor;
    // apply preserved font properties so the rewrite text matches
    // the platform's native typography. Same idempotency story as color.
    if (preservedStyle) {
      el.style.fontFamily = preservedStyle.fontFamily;
      el.style.fontSize = preservedStyle.fontSize;
      el.style.fontWeight = preservedStyle.fontWeight;
      el.style.lineHeight = preservedStyle.lineHeight;
    }
    return true;
  } finally {
    // Re-observe if we had a guard
    if (existingGuard) {
      existingGuard.observe(el, { characterData: true, childList: true, subtree: true });
    }
  }
}

// ─── Viewport detection ───

function normalizedText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Read only text that can still paint inside the replacement host. */
function visibleReplacementText(el: HTMLElement): string {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    let hidden = !parent;
    let cursor: HTMLElement | null = parent;
    while (!hidden && cursor) {
      if (
        cursor.classList.contains('fw-provisional-shield')
        || cursor.classList.contains('fw-teen-marker')
        || cursor.hidden
        || cursor.getAttribute('aria-hidden') === 'true'
      ) {
        hidden = true;
        break;
      }
      try {
        const style = window.getComputedStyle(cursor);
        if (style.display === 'none' || style.visibility === 'hidden') hidden = true;
      } catch { /* detached/jsdom node */ }
      if (cursor === el) break;
      cursor = cursor.parentElement;
    }
    if (!hidden && node.nodeValue) parts.push(node.nodeValue);
    node = walker.nextNode();
  }
  return normalizedText(parts.join(' '));
}

function replacementIsVisible(el: HTMLElement, expectedText: string): boolean {
  const expected = normalizedText(expectedText);
  return expected.length > 0 && visibleReplacementText(el) === expected;
}

function isInViewport(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  return (
    rect.top < window.innerHeight &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.right > 0
  );
}

// ─── Public API ───

export function injectIntoElement(
  el: HTMLElement,
  neutralized: NeutralizedContent,
  mode: Mode,
  showMarkers: boolean = false,
  originalText: string = '',
  lang: ResolvedUiLanguage = 'en',
): boolean {
  // Inspection pass (dashboard-opened tab): observe only, never mutate.
  if (isInspectionTab()) return false;
  try {
    // Q75 (W65): the data-fw-original / data-fw-original-text attribute
    // writes were deleted - written on three paths, read by nothing (the
    // marker's RED state restores from its closure-bound originalText, and
    // the forensic chain holds the original). The spec's "fold is
    // reversible via the attribute" line went with them.
    const visible = isInViewport(el);

    // Marker render is now driven solely by the `show-reframe-markers`
    // toggle, regardless of mode (per a standing directive, 2026-05-10: "small
    // dot on every post FeelingWise rewrote or folded"). When the toggle
    // is OFF the call still rewrites + arms the guard but renders nothing
    // — equivalent to the previous child-mode silent behavior.
    return injectTeen(el, neutralized, visible, showMarkers, originalText, lang);
  } catch {
    return false;
  }
}

/**
 * The Open level's first view: the author's own words stay on the page and a red dot offers the rest: a tap shows the
 * reason, a second the calm version, a third the original again. Nothing is swapped here, so the page is as the platform
 * drew it until the first tap (no guard, no stamp, no AI mark: no model's words are on the page yet).
 *   'offered'            the three-state walk is in place;
 *   'offered-unwritable' the body holds more than words (a picture, a control), so the calm version cannot be written in
 *                        place and the dot opens the reason alone;
 *   false                no dot could be placed; the original stays as served.
 */
export function offerRewriteBehindMark(
  el: HTMLElement,
  neutralized: NeutralizedContent,
  originalText: string,
  lang: ResolvedUiLanguage = 'en',
): 'offered' | 'offered-unwritable' | false {
  // Inspection pass (dashboard-opened tab): observe only, never mutate.
  if (isInspectionTab()) return false;
  try {
    const writable = !holdsMoreThanWords(el);
    const writer = writerOfRewrite(neutralized, originalText);
    const mounted = renderTeenMarker({
      el,
      analysis: neutralized.analysis,
      originalText,
      kind: 'rewrite',
      rewriteText: writable ? neutralized.rewrittenText : '',
      lang,
      ...(writable ? { entry: 'original' as const, flatten: () => replaceText(el, originalText) } : {}),
      ...(writable && writer ? { aiRewrite: writer } : {}),
    });
    // A marker that is already there (a replay on the same element) renders nothing and is still the dot.
    const present = mounted !== null || el.querySelector('.fw-teen-marker') !== null;
    if (!present) return false;
    return writable ? 'offered' : 'offered-unwritable';
  } catch {
    return false;
  }
}

/**
 * MARK-ONLY render: the detector confirmed a flag but no usable rewrite was
 * produced (validator rejected it, came back empty, etc.). Render the severity
 * dot on the ORIGINAL text — no swap — so the flag is still visible and the
 * tap-to-reveal "why" is available. `renderTeenMarker` enters mark-only mode
 * automatically when `kind:'rewrite'` is paired with an empty `rewriteText`.
 * No-op when the `show-reframe-markers` toggle is OFF (matches the rewrite
 * path's silent behavior).
 */
export function markOnlyElement(
  el: HTMLElement,
  analysis: AnalysisResult,
  showMarkers: boolean,
  originalText: string = '',
  lang: ResolvedUiLanguage = 'en',
): void {
  // Inspection pass (dashboard-opened tab): observe only, never mutate.
  if (isInspectionTab()) return;
  try {
    if (showMarkers) {
      // The "seen a lot" count is a pill with its sentence, not the severity dot.
      if (analysis.primaryTechnique === 'repeat-exposure' && analysis.exposure) {
        renderSeenALotPill({ el, analysis, lang });
      } else {
        renderTeenMarker({ el, analysis, originalText, kind: 'rewrite', rewriteText: '', lang });
      }
    }
  } catch {
    // Consistency rule 13: failure = original stays
  }
}

// ─── REWRITE INJECTION ───
// Single path: rewrite the post text in place, arm the mutation guard,
// and (when showMarkers is ON) render the severity dot + tap-to-reveal
// popover. Driven solely by the `show-reframe-markers` toggle regardless
// of mode (per a standing cycle directive, 2026-05-10).
function injectTeen(
  el: HTMLElement,
  neutralized: NeutralizedContent,
  _visible: boolean,
  showMarkers: boolean,
  originalText: string,
  lang: ResolvedUiLanguage,
): boolean {
  if (!replaceText(el, neutralized.rewrittenText)) return false;
  el.setAttribute('data-fw-neutralized', 'true');
  addGuard(el, neutralized.rewrittenText, originalText);

  // Attribute stamps alone cannot prove that a platform-owned text setter
  // accepted the rewrite. Child callers settle only after this postcondition.
  // The AI mark waits for the same proof: when the setter dropped the write,
  // the reader sees the author's words, the record says the rewrite failed,
  // and a mark (this pass's or an earlier one's) would name those words as a
  // model's. Child's hide fallback then hides an unmarked post.
  if (!replacementIsVisible(el, neutralized.rewrittenText)) {
    clearRewriteMarks(el);
    return false;
  }
  const writer = writerOfRewrite(neutralized, originalText);
  if (writer) markAiText(el, 'rewrite', writer);
  else clearRewriteMarks(el);

  // teaching layer. When the parent has the
  // `show-reframe-markers` toggle ON for this platform, render a small
  // severity dot inline; tap opens a compact popover with a tailored
  // explanation grounded in this specific post + an optional reveal of
  // the original. When the toggle is OFF, the rewrite stays silent
  // (matches child-mode background-protection UX).
  if (showMarkers) {
    // pass the rewrite text explicitly so the v3 toggle's GREEN
    // state restores from the verified rewrite (closure-bound), not from a
    // post-swap DOM snapshot that could be wrong if the platform re-renders
    // mid-cycle.
    const mounted = renderTeenMarker({
      el,
      analysis: neutralized.analysis,
      originalText,
      kind: 'rewrite',
      rewriteText: neutralized.rewrittenText,
      lang,
      ...(writer ? { aiRewrite: writer } : {}),
    });
    // Q67 (W62): on a cache replay the marker already exists (render
    // returns null) but the replaceText above just put the REWRITE in the
    // body; a marker left on RED/YELLOW would keep asserting the original
    // is visible. Re-align state, dot, and aria with the actual content.
    if (mounted === null) resyncMarkerToGreen(el, lang);
  }
  return true;
}

// ─── COLLAPSE / HIDE PATHS () ───
//
// When the detector returns action='collapse' or action='hide' (see
// AnalysisResult.action docblock + COMBINED prompt's ACTION block), we
// replace the post body with a calm one-line placeholder rather than
// running the rewrite path. Rationale:
//   • Generic-group claims ("all X are Y") cannot be safely softened —
//     a milder version reads as reasoned concern and is MORE persuasive
//     than overt slurs (propaganda-laundering literature).
//   • Hyperreal-trauma-bait videos are ARTIFACTS where the entire post
//     IS the manipulation; there is no underlying claim to preserve.
//   • Direct threats / doxxing have no rewrite path that doesn't
//     re-deliver the harm.
//
// Foundation Brief contract: the original content still exists. The fold
// is visual and the forensic chain holds the original text for parent
// audit (Q75/W65: the unread data-fw-original attribute copies are gone).

const OFF_HIDDEN = '[data-fw-word-filter="hidden"]';
/** Posts waiting for Off to let them go, by hide, so a rescan does not stack a second watch on one post. */
const waitingForOff = new WeakMap<HTMLElement, Set<string>>();

/**
 * Off already hides this post by its own word rule (both products installed). The caller still records the
 * verdict; a second hide or fold here would leave a Show button that cannot bring the post back. When Off lets
 * the post go (the person took the word off Off's list, or switched Off off), Feedprint's own hide is applied
 * then, or the post Feedprint recorded as hidden would stand on the page. True when Off holds the post.
 */
function leftToOff(hide: string, el: HTMLElement, box: HTMLElement, applyOwn: () => void): boolean {
  const offBox = box.closest<HTMLElement>(OFF_HIDDEN) ?? el.closest<HTMLElement>(OFF_HIDDEN);
  if (!offBox) return false;
  const waiting = waitingForOff.get(el) ?? new Set<string>();
  if (waiting.has(hide)) return true;
  waiting.add(hide);
  waitingForOff.set(el, waiting);
  const watch = new MutationObserver(() => {
    if (offBox.matches(OFF_HIDDEN)) return;
    watch.disconnect();
    waiting.delete(hide);
    if (el.isConnected && !leftToOff(hide, el, box, applyOwn)) applyOwn();
  });
  watch.observe(offBox, { attributes: true, attributeFilter: ['data-fw-word-filter'] });
  return true;
}

/** Public entry: routes by action type. Called from content/index.ts on
 *  pipeline result with action = 'collapse' or 'hide'. */
export function injectCollapseOrHide(
  el: HTMLElement,
  analysis: AnalysisResult,
  kind: 'collapse' | 'hide',
  showMarkers: boolean = false,
  originalText: string = '',
  lang: ResolvedUiLanguage = 'en',
  mode?: Mode,
  why?: Why | null,
): boolean {
  // Inspection pass (dashboard-opened tab): observe only, never mutate.
  if (isInspectionTab()) return false;
  try {
    if (leftToOff(kind, el, el, () => injectCollapseOrHide(el, analysis, kind, showMarkers, originalText, lang, mode, why))) return true;
    // De-conflict a stale marker from a prior pass. A post can be
    // mark-processed first (AI path → mark-only marker) and THEN folded on a
    // later rescan once X's promoted-ad card hydrates (placementTracking
    // appears late → sponsored gate → collapse). The old mark-only marker's
    // click closure still references the original/explanation text, so it
    // fights the fold placeholder. Remove it before the collapse marker mounts.
    el.querySelectorAll('.fw-teen-marker').forEach((m) => m.remove());
    delete el.dataset.fwMarkerState;

    const reason = reasonTextFor(kind, analysis, lang, mode, why);
    applyActionPlaceholder(el, reason, kind, originalText);
    if (!replacementIsVisible(el, reason)) return false;

    // teaching layer on the collapse/hide
    // path. Same toggle as the rewrite path: ON = mount marker on the
    // post-text element so the teen can tap to see what FW intervened on;
    // OFF = placeholder stays silent. The marker's popover surfaces the
    // original via the "What was in the original" reveal — closed by
    // default to honor the protection contract; opt-in for inoculation.
    //
    // Mount the marker on `el` (the post text element) directly, matching
    // the rewrite path. The previous iteration mounted on a separate
    // styled placeholder div; that's gone now (per feedback calling for
    // seamless integration; placeholder text now lives inside the
    // platform's native span structure).
    if (showMarkers) {
      renderTeenMarker({
        el,
        analysis,
        originalText,
        kind: 'collapse',
        lang,
      });
    }
    return true;
  } catch {
    return false;
  }
}

// Per-platform post-container selectors for the FULL ad hide. Walking up from
// the caption element to the whole feed unit lets us drop the entire ad out of
// layout (display:none), not just fold its caption.
// X caveat, measured live 2026-08-04 (M96): the home timeline is a
// virtualizer — every cellInnerDiv is position:absolute inside a relative
// rail whose height and per-cell translateY are X's own React state, and a
// foreign display/height change moves NO neighbor, static or after scroll.
// Hiding a cell therefore leaves a post-sized hole; the feed does NOT close
// the gap. The others use their post root and close the gap in normal flow.
// YouTube's ad slots are a distinct element.
const AD_CONTAINER_SELECTORS: Partial<Record<Platform, string[]>> = {
  twitter:   ['[data-testid="cellInnerDiv"]', 'article[role="article"]'],
  // The home feed's unit is [aria-posinset]; the role=article inside it is an
  // empty shell beside the body, so closest('[role=article]') from the
  // caption found nothing and the ad was folded, picture and button left
  // (observed 2026-09-03, an "Explee AI · Ad" post). Permalinks and the
  // photo viewer still carry the article.
  facebook:  ['[aria-posinset]', '[role="article"]'],
  instagram: ['article', '[role="article"]'],
  tiktok:    ['[data-e2e="recommend-list-item-container"]'],
  youtube:   ['ytd-ad-slot-renderer', 'ytd-promoted-video-renderer', 'ytd-rich-item-renderer'],
};

function resolveAdContainer(textEl: HTMLElement, platform?: Platform): HTMLElement | null {
  const sels = (platform && AD_CONTAINER_SELECTORS[platform]) ?? ['[role="article"]', 'article'];
  for (const sel of sels) {
    const c = textEl.closest(sel) as HTMLElement | null;
    if (c) return c;
  }
  return null;
}

/**
 * Fully remove a sponsored ad from the live feed — no placeholder, no marker,
 * no trace. Walks from the caption element to the per-platform post container
 * and sets `display:none` so the feed list closes the gap. EXCEPTION (Q87):
 * Instagram gets `visibility:hidden` instead — its windowed feed positions and
 * loads from its own height bookkeeping, and removing the box truncated the
 * whole feed below the ad (measured live 2026-08-11); the blank slot is the
 * price of a working feed there. The forensic record is written separately
 * (the ad is still tracked); the node is never removed (reversible via
 * `data-fw-prev-display` / `data-fw-prev-visibility` per `data-fw-hide-mode`).
 * Returns true when an ad container was resolved and hidden; false → the
 * caller degrades to the fold so the ad is never left fully visible.
 *
 * TikTok: a For-You card keeps its box like Instagram's (13 Oct 2026). With
 * `display:none` the feed snapped back up to the post before two or three times
 * while the person scrolled down, and the same card was hidden nine times in
 * the console (video-feed-hide.ts keepsItemBox). The card is hidden by
 * visibility, its video is paused, and one quiet line stands in the middle of it.
 */
export function injectAdHide(textEl: HTMLElement, platform?: Platform, lang: ResolvedUiLanguage = 'en'): boolean {
  // Inspection pass (dashboard-opened tab): observe only, never mutate.
  if (isInspectionTab()) return false;
  try {
    const container = resolveAdContainer(textEl, platform);
    if (!container) return false;
    if (leftToOff('ad', textEl, container, () => injectAdHide(textEl, platform, lang))) return true;
    const keepBox = platform === 'instagram' || keepsItemBox(container);
    if (container.getAttribute('data-fw-ad-hidden') === 'true') {
      if (platform === 'tiktok') {
        rememberTikTokAdHide(container);
        // TikTok redraws a card it reuses; the line goes back with it (idempotent).
        if (keepBox) noteAdSlot(container, MARKER_STRINGS[lang].videoHiddenScrollOn, true);
      }
      return true;
    }
    container.setAttribute('data-fw-ad-hidden', 'true');
    // Q87: name the circuit on the element itself (W16 contract). The live
    // Instagram truncation took two probe rounds to attribute because this
    // path stamped only its own attribute.
    container.setAttribute('data-fw-block-reason', 'ad-hide');
    // Comment panel state before the hide, so a panel the hide closes can be
    // opened again on the item the user lands on (video-feed-hide.ts).
    const adFeed = videoFeedItemOf(container);
    const commentSnapshot = adFeed ? snapshotCommentPanel(adFeed.surface) : { open: false };
    // Which item is on screen, read while the ad still has its box.
    const watch = adFeed && adFeed.item === container ? snapshotWatched(container, adFeed.surface) : null;
    // Silence the ad's media before hiding it — display:none alone does not
    // reliably stop a playing video's audio.
    muteAndPauseMedia(container);
    if (keepBox) {
      // Q87 (measured live 2026-08-11): Instagram renders a WINDOW of
      // articles in normal flow inside one flex column whose padding-bottom
      // reserves space for unrendered posts, and positions/loads from its
      // own height bookkeeping. display:none removes the article's box,
      // shifting every later article up relative to IG's offsets — the user
      // ends up parked in the reserved padding staring at an empty feed
      // (probe: 7 articles at negative top, the hidden one at h=0 in the
      // viewport, wrapper padding-bottom 24700px). visibility:hidden keeps
      // the box so IG's measurements stay true; the blank slot is the
      // deliberate price of a working feed on this platform.
      container.setAttribute('data-fw-hide-mode', 'visibility');
      container.setAttribute('data-fw-prev-visibility', container.style.visibility);
      // TikTok's For-You column is the same case in another shape (keepsItemBox).
      container.style.setProperty('visibility', 'hidden', 'important');
      if (platform === 'instagram') noteAdSlot(container, MARKER_STRINGS[lang].adSlotNote);
      else noteAdSlot(container, MARKER_STRINGS[lang].videoHiddenScrollOn, true);
    } else {
      container.setAttribute('data-fw-prev-display', container.style.display);
      container.style.setProperty('display', 'none', 'important');
    }
    if (platform === 'tiktok') rememberTikTokAdHide(container);
    // A hidden item on a single-player feed leaves the player on nothing:
    // move to the next item the user can see, but only when the ad was the
    // item on screen (video-feed-hide.ts).
    if (adFeed && watch) {
      afterFeedItemHidden(container, adFeed.surface, commentSnapshot, watch, lang);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Hard hide — remove a severe, un-reframeable post (direct threat / harassment /
 * doxxing) from the live feed ENTIRELY and silently: no placeholder, no marker,
 * no leftover gap. Same mechanism as injectAdHide (resolve the per-platform feed
 * container → `display:none` so the feed closes the space — except Instagram,
 * where Q88 hides via `visibility:hidden` with the box preserved, see
 * `hardHideMode`; mute media, reversible via `data-fw-prev-display` /
 * `data-fw-prev-visibility`, node never removed) but stamped distinctly
 * (`data-fw-hard-hidden`) so a threat-hide is NEVER coupled to the Block-Ads
 * reveal logic. The forensic record is written separately by the caller. Returns
 * true when a container resolved + hid; false → caller degrades to the calm
 * placeholder so the post is never left fully visible. Per a standing rule, 2026-06-19: the
 * child must see nothing, and no empty box where the post was.
 */
/**
 * Optional reveal affordance for a hard-hidden post (Teen/Adult modes; Child
 * stays fully silent — SHIELD psychology). When provided, a one-line notice
 * mounts as a SIBLING before the hidden container: "FeelingWise hid this
 * post · show anyway". Reveal restores the stored display (media stays
 * muted); the notice flips to "hide again". `initiallyRevealed` replays a
 * user's earlier reveal onto a fresh platform remount of the same post.
 */
export interface HardHideRevealOpts {
  noticeText: string;
  showLabel: string;
  hideLabel: string;
  initiallyRevealed?: boolean;
  onRevealChange?: (revealed: boolean) => void;
}

const HIDE_NOTICE_ATTR = 'data-fw-hide-notice';
const USER_REVEALED_ATTR = 'data-fw-user-revealed';

/**
 * Hide mode for a hard-hidden container (Q88). 'visibility' is stamped only
 * on Instagram, whose windowed feed truncates below any removed box (the Q87
 * physics, measured live 2026-08-11); everywhere else the box collapses via
 * display:none as before — including X, whose M96 notice geometry is built
 * around the display path. Absence of the attribute = 'display'.
 */
function hardHideMode(container: HTMLElement): 'display' | 'visibility' {
  return container.getAttribute('data-fw-hide-mode') === 'visibility' ? 'visibility' : 'display';
}

function applyHiddenState(container: HTMLElement, hidden: boolean): void {
  const viaVisibility = hardHideMode(container) === 'visibility';
  if (hidden) {
    muteAndPauseMedia(container);
    if (viaVisibility) container.style.setProperty('visibility', 'hidden', 'important');
    else container.style.setProperty('display', 'none', 'important');
    container.removeAttribute(USER_REVEALED_ATTR);
  } else {
    container.setAttribute(USER_REVEALED_ATTR, 'true');
    if (viaVisibility) {
      const prev = container.getAttribute('data-fw-prev-visibility') ?? '';
      if (prev) container.style.setProperty('visibility', prev);
      else container.style.removeProperty('visibility');
    } else {
      const prev = container.getAttribute('data-fw-prev-display') ?? '';
      if (prev) container.style.setProperty('display', prev);
      else container.style.removeProperty('display');
    }
    // Deliberately NOT unmuting: a revealed threat post comes back silent.
    // On a single-player video feed the media is paused, never muted by us
    // (video-feed-hide.ts); the reveal ends the re-pause scope so the user
    // can play it, with their own sound setting.
    if (videoFeedItemOf(container)?.item === container) releaseVideoItem(container);
  }
}

/** True only for the exact hidden state `applyHiddenState` writes. */
function isContainerHardHidden(container: HTMLElement): boolean {
  const prop = hardHideMode(container) === 'visibility' ? 'visibility' : 'display';
  const val = prop === 'visibility' ? 'hidden' : 'none';
  return container.style.getPropertyValue(prop) === val
    && container.style.getPropertyPriority(prop) === 'important';
}

const noticeByContainer = new WeakMap<HTMLElement, HTMLElement>();
const hideNoticeGuards = new WeakMap<HTMLElement, MutationObserver>();
const hideReasserts = new WeakMap<HTMLElement, number>();
const hideReassertLast = new WeakMap<HTMLElement, number>();
/** Re-assert a defeated hide a few times, then stop claiming it happened. */
const MAX_HIDE_REASSERTS = 3;
/** Defeats must be RAPID to spend the budget (M97 residual, 2026-08-04): three
 *  losses inside this window is an unwinnable fight with the renderer; losses
 *  spread across a session are separate incidents, each won. The budget was
 *  cumulative for the element's whole lifetime before, so the 4th defeat EVER
 *  silently withdrew the chip and unprotected the post. */
const HIDE_REASSERT_WINDOW_MS = 10_000;

/**
 * Keep the notice's claim true, or take the claim away.
 *
 * The notice is a SIBLING of the container, so its lifetime was independent of
 * whether the post was actually hidden — and the hard-hide path is the only
 * injection path in this file with no MutationObserver guard, while the
 * rewrite path has had one since the X virtual-scroll fix. A platform
 * re-render that restored the post therefore left the notice behind, still
 * reading "FeelingWise hid this post" over a fully readable post (X post
 * detail view, 2026-08-02). On the trust surface that is not a cosmetic bug:
 * the product's whole claim is that it never says more than happened.
 *
 * Order of preference, and why: re-assert first, because FeelingWise decided
 * to hide this post and a re-render should not defeat protection. Bounded at
 * three, because fighting a renderer forever is its own defect. Then withdraw
 * the notice, because an unenforceable claim must not stay on screen.
 *
 * A user who pressed "show anyway" is the one case where a visible post under
 * a notice is CORRECT — the button reads "hide again" — so that state is left
 * strictly alone.
 */
function guardHideNotice(container: HTMLElement, notice: HTMLElement): void {
  hideNoticeGuards.get(container)?.disconnect();
  let observer: MutationObserver | null = null;
  const stop = (): void => {
    observer?.disconnect();
    hideNoticeGuards.delete(container);
    noticeByContainer.delete(container);
  };
  const check = (): void => {
    // Disconnection outranks the revealed state (M97, 2026-08-03): a chip
    // whose container left the DOM is anchorless whatever the user chose —
    // the old order returned early on revealed containers and leaked their
    // chips forever once the platform unmounted them.
    if (!container.isConnected) {
      notice.remove();
      stop();
      return;
    }
    if (container.getAttribute(USER_REVEALED_ATTR) === 'true') return;
    if (isContainerHardHidden(container)) return;
    const now = Date.now();
    const last = hideReassertLast.get(container) ?? 0;
    hideReassertLast.set(container, now);
    const tries = (now - last > HIDE_REASSERT_WINDOW_MS ? 0 : (hideReasserts.get(container) ?? 0)) + 1;
    hideReasserts.set(container, tries);
    if (tries <= MAX_HIDE_REASSERTS) {
      bumpCounter('hardHideReasserted');
      applyHiddenState(container, true);
      return;
    }
    bumpCounter('hardHideNoticeWithdrawn');
    notice.remove();
    stop();
  };
  observer = new MutationObserver(check);
  observer.observe(container, { attributes: true, attributeFilter: ['style', 'class'] });
  // The platform can also swap the node out entirely rather than restyle it,
  // which fires nothing on the container itself.
  if (container.parentElement) observer.observe(container.parentElement, { childList: true });
  hideNoticeGuards.set(container, observer);
  // A state that is already wrong at mount time mutates nothing afterwards.
  queueMicrotask(check);
}

/** The notice inside a kept TikTok card: it fills the hidden card, or, once the card is shown, is the button alone. */
const SLIDE_NOTICE_HIDDEN_CSS = 'visibility:visible;position:absolute;top:0;left:0;right:0;bottom:0;z-index:100;'
  + 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px;'
  + 'font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#8e8e8e;text-align:center;pointer-events:none;';
const SLIDE_NOTICE_REVEALED_CSS = 'visibility:visible;position:absolute;top:12px;left:12px;z-index:100;display:flex;'
  + 'align-items:center;padding:2px;background:rgba(0,0,0,.55);border-radius:8px;'
  + 'font:12px system-ui,sans-serif;color:#fff;pointer-events:none;';

function mountHideNotice(container: HTMLElement, opts: HardHideRevealOpts): void {
  // Identity, not adjacency: the previous check read
  // `container.previousElementSibling`, so anything the platform inserted
  // between the notice and the post let a SECOND notice mount.
  const existing = noticeByContainer.get(container);
  if (existing?.isConnected) return;
  const notice = document.createElement('div');
  notice.setAttribute(HIDE_NOTICE_ATTR, 'true');
  // Inside an X cell the chip stands where the hidden post was (see
  // syncGeometry); on sibling mounts the hidden post has zero height, so
  // this sits directly on top of whatever comes next. A dashed edge reads as
  // "something is missing here" rather than as a label belonging to the post
  // below, and the larger bottom margin keeps it from touching that post.
  // `position:relative` + a z-index are load-bearing, not decoration.
  //
  // Measured on a live X permalink (2026-08-02): the notice was
  // `position:static; z-index:auto` inside a `position:relative` parent, and
  // `document.elementFromPoint` at the centre of the "show anyway" button
  // returned X's Grok icon, not the button. The affordance rendered and could
  // not be pressed, which is worse than not offering it — the one post a
  // parent is told they may reveal was the one post they could not reach.
  //
  // 100 sits above X's in-flow chrome and far below the protection shield
  // (2147483647). A reveal control must never outrank a cover.
  notice.style.cssText = 'position:relative;z-index:100;'
    + 'display:flex;align-items:center;gap:8px;padding:10px 12px;'
    + 'font:12px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;'
    + 'color:#888;border:1px dashed rgba(136,136,136,.45);border-radius:8px;'
    + 'margin:4px 0 14px;';
  // OPAQUE on purpose (M96, 2026-08-03): the chip sits over whatever the
  // layout puts beneath it (its own anchor has zero height), and with no
  // background the underlying post's text read straight through it — which a
  // parent cannot distinguish from "the hidden post is visible". Match the
  // page's own background so the chip stays theme-correct on dark and light.
  const pageBg = typeof getComputedStyle === 'function'
    ? getComputedStyle(document.body).backgroundColor
    : '';
  notice.style.background =
    pageBg && pageBg !== 'transparent' && !/^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/.test(pageBg)
      ? pageBg
      : '#1b1b1b';
  const label = document.createElement('span');
  label.textContent = opts.noticeText;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.style.cssText = 'margin-left:auto;font:12px system-ui,sans-serif;color:inherit;'
    + 'background:none;border:1px solid rgba(136,136,136,.5);border-radius:5px;'
    + 'padding:2px 10px;cursor:pointer;white-space:nowrap;';
  // A card of TikTok's For-You column keeps its box (keepsItemBox), so its notice stands INSIDE the card: a sibling
  // would add a block of its own to the snapping column. Hidden, it fills the card; revealed, it shrinks to the button.
  const inSlide = keepsItemBox(container);
  if (inSlide) {
    btn.style.setProperty('margin-left', '0');
    btn.style.setProperty('pointer-events', 'auto');
  }
  const revealed = (): boolean => container.getAttribute(USER_REVEALED_ATTR) === 'true';
  const syncLabel = (): void => { btn.textContent = revealed() ? opts.hideLabel : opts.showLabel; };
  // X cell anatomy only (the notice's parent is the virtualizer cell): the
  // rail never reflows around foreign height (measured 2026-08-04, M96), so
  // the two states need different geometry. Hidden: in-flow — the chip IS
  // the cell's content, standing at the top of the hole X leaves for the
  // post. Revealed: out of flow — the cell's content height matches what X
  // measured for the post, and the chip overlays the post's top edge,
  // confining any layout error to the one post the user chose to reveal.
  // Synced at the same points as the button label.
  const inCell = (): boolean =>
    notice.parentElement?.matches?.('[data-testid="cellInnerDiv"]') === true;
  // Revealed geometry, corrected 2026-09-07 from live screenshots: the
  // full-width bar at top:0 covered the revealed post's header AND its first
  // line of text ("hide again" sat over the words the reader had just asked to
  // see). Once revealed, the sentence "FeelingWise hid this" is no longer true
  // and the only honest control is the button, so the chip shrinks to that
  // button alone, anchored top-right and pulled in from the corner so X's own
  // "more" menu stays reachable; the post's header and text are left whole.
  // Hidden again, the full sentence returns in flow.
  const syncGeometry = (): void => {
    if (inSlide) {
      notice.style.cssText = revealed() ? SLIDE_NOTICE_REVEALED_CSS : SLIDE_NOTICE_HIDDEN_CSS;
      label.hidden = revealed();
      return;
    }
    if (!inCell()) return;
    if (revealed()) {
      notice.style.setProperty('position', 'absolute');
      notice.style.setProperty('top', '6px');
      notice.style.removeProperty('left');
      notice.style.setProperty('right', '44px');
      notice.style.setProperty('margin', '0');
      notice.style.setProperty('padding', '2px 4px');
      notice.style.setProperty('border-color', 'transparent');
      label.hidden = true;
    } else {
      notice.style.setProperty('position', 'relative');
      notice.style.removeProperty('top');
      notice.style.removeProperty('left');
      notice.style.removeProperty('right');
      notice.style.setProperty('margin', '4px 0 14px');
      notice.style.setProperty('padding', '10px 12px');
      notice.style.removeProperty('border-color');
      label.hidden = false;
    }
  };
  btn.addEventListener('click', () => {
    const next = !revealed();
    applyHiddenState(container, !next);
    syncLabel();
    syncGeometry();
    opts.onRevealChange?.(next);
  });
  syncLabel();
  notice.append(label, btn);
  if (inSlide) container.prepend(notice);
  else container.before(notice);
  syncGeometry();
  noticeByContainer.set(container, notice);
  guardHideNotice(container, notice);
  noteHideChipMounted(container);
}

/**
 * The X hard hide targets the cell's CONTENT WRAPPER, not the cell (M96,
 * measured live 2026-08-04): with the cell itself display:none'd, the notice
 * mounted as the cell's in-flow sibling rendered at the virtualizer rail's
 * TOP — hundreds of px from the post it talks about — overlapping the first
 * viewport post's header and reading as a claim about THAT post (home
 * feed: the notice read "FeelingWise hid a post" over a readable unrelated
 * post). Hiding the wrapper instead keeps the cell as the notice's mount
 * host, so the chip stands exactly where the hidden post was, inside the
 * hole X leaves either way. Fallback to the cell when the anatomy is not
 * the expected single-wrapper shape.
 */
function resolveHardHideTarget(textEl: HTMLElement, platform?: Platform): HTMLElement | null {
  const container = resolveAdContainer(textEl, platform);
  if (!container) return null;
  if (platform === 'twitter' && container.matches('[data-testid="cellInnerDiv"]')) {
    const kids = Array.from(container.children).filter(
      (c): c is HTMLElement =>
        c instanceof HTMLElement && c.getAttribute(HIDE_NOTICE_ATTR) !== 'true',
    );
    if (kids.length === 1) return kids[0];
  }
  return container;
}

export function injectHardHide(
  textEl: HTMLElement,
  platform?: Platform,
  revealOpts?: HardHideRevealOpts,
  lang: ResolvedUiLanguage = 'en',
): boolean {
  // Inspection pass (dashboard-opened tab): observe only, never mutate.
  if (isInspectionTab()) return false;
  try {
    const container = resolveHardHideTarget(textEl, platform);
    if (!container) return false;
    if (leftToOff('hard', textEl, container, () => injectHardHide(textEl, platform, revealOpts, lang))) return true;
    // A card of TikTok's For-You column keeps its box, as Instagram's does (keepsItemBox).
    const keepBox = platform === 'instagram' || keepsItemBox(container);
    // The user's explicit reveal outranks every re-apply path (cache replay,
    // guard re-assert, rescan): never silently re-hide a revealed post.
    //
    // M97 (2026-08-04): but the reveal belongs to a POST, and this attribute
    // lives on a RECYCLABLE element. The post-identity truth is the session
    // reveal set, threaded in as `initiallyRevealed`. When the element says
    // revealed and the post's own record says the user never revealed IT,
    // the attribute is another post's leftovers: clear it and hide normally.
    // Callers with no revealOpts (Child mode) have no reveal affordance at
    // all, so any reveal attribute there is foreign by definition.
    if (container.getAttribute(USER_REVEALED_ATTR) === 'true') {
      if (revealOpts?.initiallyRevealed === true) {
        mountHideNotice(container, revealOpts);
        return true;
      }
      container.removeAttribute(USER_REVEALED_ATTR);
    }
    if (
      container.getAttribute('data-fw-hard-hidden') === 'true'
      && isContainerHardHidden(container)
    ) {
      if (revealOpts) mountHideNotice(container, revealOpts);
      else if (keepsItemBox(container)) noteAdSlot(container, MARKER_STRINGS[lang].hideNoticeChild, true);
      return true;
    }
    container.setAttribute('data-fw-hard-hidden', 'true');
    // Q87: name the circuit on the element itself (W16 contract).
    container.setAttribute('data-fw-block-reason', 'hard-hide');
    // Q88: on Instagram the hide must preserve the container's box (Q87
    // physics: removing it truncates the windowed feed). Stamp the mode
    // BEFORE applying so applyHiddenState / isContainerHardHidden and the
    // notice guard all agree on which property owns the hidden state.
    if (keepBox) {
      container.setAttribute('data-fw-hide-mode', 'visibility');
      container.setAttribute('data-fw-prev-visibility', container.style.visibility);
    } else {
      container.setAttribute('data-fw-prev-display', container.style.display);
    }
    // Single-player video feed (video-feed-hide.ts): remember the comment
    // panel before the hide; after it, advance past the hidden item.
    const feed = videoFeedItemOf(container);
    const feedItem = feed && feed.item === container ? feed : null;
    const commentSnapshot = feedItem ? snapshotCommentPanel(feedItem.surface) : { open: false };
    // Which item is on screen, read while the container still has its box.
    const watch = feedItem ? snapshotWatched(container, feedItem.surface) : null;
    applyHiddenState(container, true);
    if (revealOpts) {
      // Fresh remount of a post the user had revealed: honor the choice
      // BEFORE the notice mounts so its button label reads the true state.
      if (revealOpts.initiallyRevealed) applyHiddenState(container, false);
      mountHideNotice(container, revealOpts);
    } else if (keepsItemBox(container)) {
      // Child's card is not named: the one calm line that moves on stands in the kept box.
      noteAdSlot(container, MARKER_STRINGS[lang].hideNoticeChild, true);
    }
    if (feedItem && watch && !revealOpts?.initiallyRevealed) {
      afterFeedItemHidden(container, feedItem.surface, commentSnapshot, watch, lang);
    }
    if (container.getAttribute(USER_REVEALED_ATTR) === 'true') return true;
    return container.getAttribute('data-fw-hard-hidden') === 'true'
      && isContainerHardHidden(container);
  } catch {
    return false;
  }
}

function applyActionPlaceholder(
  el: HTMLElement,
  reasonText: string,
  kind: 'collapse' | 'hide',
  originalText: string = '',
): void {
  // (feedback) — use the same span-aware text
  // replacement as the rewrite path so the placeholder inherits the
  // platform's native font, color, weight, and line-height. Earlier
  // iteration mounted a styled <div> with italic font + teal left-border
  // + background tint; live testing read it as a "designed UI frame"
  // visually disconnected from the rest of the feed. The marker dot
  // carries the FW signal; the placeholder text reads as plain calm copy
  // in the platform's own voice.
  if (!replaceText(el, reasonText)) return;
  el.setAttribute('data-fw-action', kind);
  el.setAttribute('data-fw-neutralized', 'true');
  // A post rewritten on an earlier pass and folded now shows the placeholder,
  // which no model wrote.
  clearRewriteMarks(el);

  // Fold the post's MEDIA, not just its caption. The text swap above only
  // touches the caption element; the video / image / link-card lives in a
  // sibling subtree of the post container and kept playing under the
  // placeholder (live report: "hid this post: advertisement" with the
  // video still visible). Hide the media reversibly so the fold actually
  // removes the manipulative payload.
  hidePostMedia(el);

  // Re-arm the guard so platform re-renders (X virtual scroll, etc.) don't
  // restore the original. Match the rewrite path's MutationObserver contract.
  addGuard(el, reasonText, originalText);
}

// Post-container boundaries — one entry per platform. `closest()` from the
// caption element resolves the single-post wrapper so media-hiding never
// reaches a neighboring post. X first (the reference surface); the generic
// [role="article"] backstops Facebook and any platform that uses the ARIA
// article role. No match → degrade to today's text-only fold (safe).
const POST_CONTAINER_SELECTORS = [
  'article[role="article"]', // X / Twitter
  '[role="article"]',        // Facebook / generic ARIA
];

// Media element types to fold. Covers X video (videoPlayer / videoComponent /
// <video>), X photos (tweetPhoto), and link/media cards (card.wrapper,
// card.layoutLarge.media — both match the data-testid^="card" prefix), plus
// generic embeds. Verified against live x.com ad markup 2026-06-04.
const MEDIA_SELECTORS = [
  'video',
  '[data-testid="videoPlayer"]',
  '[data-testid="videoComponent"]',
  '[data-testid="tweetPhoto"]',
  '[data-testid^="card.wrapper"]',
  '[data-testid^="card.layout"]',
  '[aria-label="Image"]',
  'iframe',
];

/**
 * Reversibly hide a folded post's media. Walks from the caption element to the
 * single-post container, then sets `display:none` on known media descendants
 * (stamping `data-fw-hidden-media` + the prior inline display for audit /
 * reversibility). Never removes nodes — the original DOM stays in place,
 * hidden (W65: no attribute copy). Media inside the caption element itself
 * (emoji imgs) is left to `replaceText`. No-op when no known container is found
 * (degrades to the text-only fold rather than risking a wrong boundary).
 */
// Any single-post boundary, INCLUDING X's nested quote-tweet (`article
// role="link"`). Used to scope media-hiding to the folded post (or a quote
// nested inside it) and never a parent/host post — see the quote-tweet guard
// below.
const POST_BOUNDARY_SELECTOR = 'article[role="article"], article[role="link"], [role="article"]';

function hidePostMedia(textEl: HTMLElement): void {
  let container: HTMLElement | null = null;
  for (const sel of POST_CONTAINER_SELECTORS) {
    const c = textEl.closest(sel) as HTMLElement | null;
    if (c) { container = c; break; }
  }
  if (!container) {
    // No X/FB post boundary (TikTok/IG/YT use their own containers, so media
    // can't be display:none-folded here without risking the wrong boundary) —
    // but the placeholder claims "hidden", so at MINIMUM silence the video:
    // mute the media in the nearest enclosing post container. Muting never
    // changes layout, so it is safe even when display:none would not be.
    //
    // On a single-player video feed the scope is the ITEM, never the feed:
    // on Instagram Reels the fallback below resolved `main`, which holds
    // every reel, so one folded reel silenced the whole feed.
    const feed = videoFeedItemOf(textEl);
    if (feed) {
      silenceVideoItem(feed.item);
      return;
    }
    const near = textEl.closest(
      '[data-e2e="recommend-list-item-container"], [data-e2e="video-detail"], article, [role="article"], section, main',
    );
    if (near) muteAndPauseMedia(near);
    else console.debug('[FeelingWise] hidePostMedia: no container resolved — media left audible under the placeholder');
    return;
  }

  // The folded post's OWN boundary. On X a quote tweet is a nested
  // `article[role="link"]` with its own caption; when the detector folds the
  // INNER quoted tweet, `container` (closest article[role=article]) resolves
  // to the OUTER host article — hiding that host's media would be an over-hide
  // of a different post. Guard: only hide media whose nearest post boundary is
  // the folded post's boundary OR nested inside it, never a parent/host.
  const textBoundary = textEl.closest(POST_BOUNDARY_SELECTOR);

  for (const sel of MEDIA_SELECTORS) {
    for (const m of Array.from(container.querySelectorAll<HTMLElement>(sel))) {
      if (textEl.contains(m) || m.contains(textEl)) continue;
      if (m.dataset.fwHiddenMedia === 'true') continue;
      const mBoundary = m.closest(POST_BOUNDARY_SELECTOR);
      // Skip media that belongs to a host/parent post (its boundary is not
      // contained within the folded post's boundary).
      if (!textBoundary || !mBoundary || !textBoundary.contains(mBoundary)) continue;
      m.dataset.fwHiddenMedia = 'true';
      m.dataset.fwPrevDisplay = m.style.display;
      // Silence before hiding — a display:none'd video can keep playing audio.
      muteAndPauseMedia(m);
      m.style.setProperty('display', 'none', 'important');
    }
  }
}

/** The policy rows a rule fires: the household's word, a slur, coded harm, the platform's ad marker, a chosen topic. */
const RAIL_ROWS: ReadonlySet<string> = new Set(['R1', 'R2', 'R3', 'R4', 'R5']);

function reasonTextFor(
  kind: 'collapse' | 'hide',
  analysis: AnalysisResult,
  lang: ResolvedUiLanguage,
  mode?: Mode,
  why?: Why | null,
): string {
  const t = MARKER_STRINGS[lang];
  // A child reads one kind line and never the reason; a teen reads where the post went. Adult, and
  // a caller that does not say, gets the plain line.
  if (mode === 'child') return t.skipLineChild;
  const teen = mode === 'teen';
  const line = kind === 'hide'
    ? (teen ? t.hidLineTeen : t.hidLine)
    : (teen ? t.foldedLineTeen : t.foldedLine);
  // The rule's own why, in the words the hard-hide notice uses. A hide names its why whatever it is; a fold
  // only for a rail row (the household's word, a slur, coded harm, an ad), since the technique names below
  // cannot say a rule fired: an item nothing read has none, and a slur's technique is profanity.
  if (why && (kind === 'hide' || RAIL_ROWS.has(why.row))) return line(whyFragment(lang, why));
  // Read the actual confirmed techniques, not just primary — the same set the
  // code-side collapse/hide rules acted on. The reason line must name the REAL
  // technique: the prior `kind==='hide'` path returned a hardcoded "direct
  // threat or harassment" for EVERY hide (ads, violence, sexual all wrongly
  // said "direct threat", per a live report). The verb differs by kind ("hid"
  // for hard hide, "folded" for collapse); the reason is technique-driven.
  const presentNames = new Set(
    analysis.techniques.filter(t => t.present).map(t => t.technique),
  );
  if (presentNames.has('consumer-rapid-frame')) {
    return line(t.catAdvertisement);
  }
  if (presentNames.has('violence-graphic')) {
    return line(t.catGraphicViolence);
  }
  if (presentNames.has('sexual')) {
    return line(t.catSexual);
  }
  if (presentNames.has('self-harm')) {
    return line(t.catSelfHarm);
  }
  if (presentNames.has('drug-promotion')) {
    return line(t.catDrugPromotion);
  }
  if (presentNames.has('hyperreal-trauma-bait')) {
    return line(t.catAiSynthetic);
  }
  if (presentNames.has('scapegoating')) {
    return line(t.catGroupClaim);
  }
  if (presentNames.has('extreme-toxicity') || presentNames.has('combined-stack')) {
    return line(t.catExtremeHostility);
  }
  // Residual: a hard hide with no specific technique match is the
  // direct-threat / harassment case the hide path exists for.
  if (kind === 'hide') {
    return line(t.catDirectThreat);
  }
  return teen ? t.foldedLineNoReasonTeen : t.foldedLineNoReason;
}

