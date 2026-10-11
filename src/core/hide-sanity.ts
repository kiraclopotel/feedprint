// How much a hide may take (11 Oct 2026).
//
// Every finder in Off is a guess about a page: a selector, a word, a climb to a parent. protected-regions.ts refuses
// what must never be hidden whatever its size (a menu, a way to block someone). This file refuses by size and kind: a
// hide that would take far more than the thing the switch is about. An action bar, a count or an emoji is a small
// thing inside a post; an ad or a filtered post is one unit. When a climb goes one level too far on a redesigned page,
// the right answer is a stray button left on screen, not a missing page. Only these two kinds of switch are judged; a
// switch that hides a whole surface on purpose (Reels, Shorts, Marketplace, the comment box) is not.
//
// DOM facts only, so the answer is the same in a test and in a browser. The box on screen is read when there is one.

export type HideSanityProblem = 'landmark' | 'text-input' | 'post-sized' | 'many-posts' | 'whole-page';

/** Switches that hide a small thing inside a post. */
const SMALL_THING_FEATURES: ReadonlySet<string> = new Set(['hide-action-buttons', 'hide-engagement-metrics', 'strip-emojis']);

/** Switches that hide one unit: an ad, or a post or comment the person's words matched. */
const ONE_UNIT_FEATURES: ReadonlySet<string> = new Set(['block-ads', 'word-filter']);

/** Hides done under a small-thing switch's name that take a whole unit (an empty comment is hidden as a unit). */
const UNIT_REASONS: ReadonlySet<string> = new Set(['strip-emojis:empty-comment']);

/** The parts of a page that are never a post's own. */
export const LANDMARK_SELECTOR = 'main, [role="main"], nav, [role="navigation"], [role="banner"], [role="feed"], [role="complementary"]';

/** Where a person types. */
const TEXT_INPUT_SELECTOR =
  'input:not([type="hidden"]), textarea, [contenteditable="true"], [contenteditable=""], [role="textbox"], [role="searchbox"], [role="combobox"]';

/** What marks one post, comment or tile across the five sites. */
const POST_UNIT_SELECTOR = '[role="article"], article, [aria-posinset], [data-testid="tweet"]';

/** A box that covers this share of the window in both directions is the page, not a part of it. */
const PAGE_SHARE = 0.7;

function isPostUnit(el: Element): boolean {
  return el.matches(POST_UNIT_SELECTOR);
}

/** Units inside `el` that no other unit inside `el` holds. A post with its comments inside counts once. */
function topLevelUnits(el: HTMLElement): number {
  if (isPostUnit(el)) return 0;
  let n = 0;
  for (const unit of Array.from(el.querySelectorAll(POST_UNIT_SELECTOR))) {
    let holder = unit.parentElement;
    let nested = false;
    while (holder && holder !== el) {
      if (isPostUnit(holder)) { nested = true; break; }
      holder = holder.parentElement;
    }
    if (!nested) n += 1;
  }
  return n;
}

function holdsLandmark(el: HTMLElement): boolean {
  return el.matches(LANDMARK_SELECTOR) || el.querySelector(LANDMARK_SELECTOR) !== null;
}

function fillsWindow(el: HTMLElement): boolean {
  const box = el.getBoundingClientRect();
  if (!(box.width > 0 && box.height > 0)) return false;
  return box.width >= window.innerWidth * PAGE_SHARE && box.height >= window.innerHeight * PAGE_SHARE;
}

/**
 * Why a hide of `el` under `feature` would take too much, or null when it is the right size. `landmark`: it is or holds
 * a main area, a navigation, a banner or the feed. `text-input`: it holds a place where the person types (small things
 * only). `post-sized`: it is a post or holds one (small things only). `many-posts`: it holds two or more posts (units
 * only). `whole-page`: its box fills the window (small things only). `reason` is the door's `<feature>:<detail>`; it
 * only matters for the few hides that take a unit under a small-thing switch's name.
 */
export function hideSanityProblem(el: HTMLElement, feature: string, reason = ''): HideSanityProblem | null {
  const small = SMALL_THING_FEATURES.has(feature) && !UNIT_REASONS.has(reason);
  if (!small && !ONE_UNIT_FEATURES.has(feature) && !UNIT_REASONS.has(reason)) return null;

  if (holdsLandmark(el)) return 'landmark';
  if (small) {
    if (el.querySelector(TEXT_INPUT_SELECTOR) !== null || el.matches(TEXT_INPUT_SELECTOR)) return 'text-input';
    if (isPostUnit(el) || el.querySelector(POST_UNIT_SELECTOR) !== null) return 'post-sized';
    if (fillsWindow(el)) return 'whole-page';
    return null;
  }
  return topLevelUnits(el) >= 2 ? 'many-posts' : null;
}
