// FeelingWise — shared hide-marking helper (wiring Q33 / Q11).
//
// Before this helper, 15 of the 17 engagement hide sites stamped only their
// own boolean marker (data-fw-action-rail="hidden", data-fw-count-chip, ...)
// and no reason, so a vanished element could not name the circuit that hid
// it from the DOM alone; debugging a "post disappeared" report meant
// guessing across a dozen modules. Every hide now also stamps
// data-fw-block-reason with a stable `<feature>:<detail>` string.
//
// Deliberately NOT a rewrite of the marker scheme: each site keeps its own
// attribute because the injected CSS rules and the controller's reset pass
// select on them. This helper only centralizes the idempotency check, the
// reason stamp, and the parent-facing hidden counter.

import { incrementMetricsHidden } from '../../storage/settings';
import { isInPrivateChatSubtree } from '../platforms/adapter';
import { protectedRegionReason } from '../../core/protected-regions';
import { hideSanityProblem } from '../../core/hide-sanity';
import { recordFinderEvent } from '../../diagnostics/finder-ledger';

export const BLOCK_REASON_ATTR = 'data-fw-block-reason';

// The parent-facing hidden counter is one chrome.storage read-modify-write
// per call. A Facebook page load marks a few hundred elements in its first
// second, which was a few hundred serialised storage round trips and as many
// onChanged broadcasts to every realm. Hides are batched here and written
// once per second; the counter is cosmetic, so at most one second of hides
// is lost on a tab closed mid-window.
const COUNTER_FLUSH_MS = 1000;
let pendingHidden = 0;
let pendingByFeature: Record<string, number> = {};
let flushTimer: ReturnType<typeof setTimeout> | 0 = 0;

function flushHiddenCount(): void {
  flushTimer = 0;
  const n = pendingHidden;
  const byFeature = pendingByFeature;
  pendingHidden = 0;
  pendingByFeature = {};
  if (n > 0 || Object.keys(byFeature).length > 0) void incrementMetricsHidden(n, byFeature);
}

function countHidden(feature: string, n: number, hides: boolean): void {
  if (hides) pendingHidden += n;
  pendingByFeature[feature] = (pendingByFeature[feature] ?? 0) + n;
  if (!flushTimer) flushTimer = setTimeout(flushHiddenCount, COUNTER_FLUSH_MS);
}

/**
 * Count n firings of a switch that does not go through markHidden: a
 * blocker with its own marker scheme, or a rewrite that hides nothing (the
 * starred swear words). `hides` says whether the total hidden counter moves
 * too; the per-switch tally always does.
 */
export function countHiddenFor(feature: string, n = 1, hides = true): void {
  if (n > 0) countHidden(feature, n, hides);
}

/** Test hook: write any pending count now. */
export function __flushHiddenCountForTest(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushHiddenCount();
}

export interface MarkHiddenOptions {
  /** The site's own marker attribute, e.g. 'data-fw-action-rail'. */
  marker: string;
  /** Value written to the marker attribute (most sites use 'hidden' or 'true'). */
  value: string;
  /**
   * Why this element was hidden: '<feature>:<detail>', e.g.
   * 'hide-action-buttons:tiktok-rail', 'strip-emojis:sticker'.
   */
  reason: string;
  /**
   * Parent-facing hidden-counter increment. Defaults to 1; pass 0 for
   * markings that are counted elsewhere (or not user-visible hides), pass N
   * for one marking that hides N elements.
   */
  count?: number;
  /**
   * The switch this hide is tallied under in the popup. Defaults to the
   * reason's `<feature>` prefix; pass it when the prefix is not the switch
   * (the word filter's slur rule is its own line, not the word list's).
   */
  feature?: string;
  /**
   * How `hideElement` takes the element away. 'display' (the default) closes
   * the gap; 'visibility' keeps the layout box and also stops pointer events,
   * which is what a filter wants when collapsing the box makes the platform
   * misbehave.
   */
  mode?: 'display' | 'visibility';
}

/**
 * THE DOOR (2026-09-20).
 *
 * "Private surfaces are out of scope for every filter, and the gate is by DOM
 * region, not by URL alone" is a standing rule, and until now every filter
 * carried its own copy of it: 33 hand-written checks across 12 files. Six of
 * them were missing on 2026-09-19 and each was shown to take something, the
 * sidebar ad remover taking a whole chat log. Three more had no check at all.
 *
 * A rule written in 12 places is a rule that 12 authors can forget. Written
 * here it cannot be forgotten, including by a filter added next year, because
 * nothing reaches the page without passing through this function: a filter
 * either keys its stylesheet off the marker below, in which case refusing to
 * mark refuses to hide, or it calls `hideElement`, which refuses outright.
 *
 * This is the owner's point of 2026-09-20 about structure, in its correct
 * shape. The fix for one rule living in many places is not to partition the
 * tree so the copies cannot see each other; it is a door they all go through.
 */
function refusedForPrivacy(el: HTMLElement): boolean {
  return isInPrivateChatSubtree(el);
}

/**
 * The door's second duty (11 Oct 2026, the owner's report that Off took the choices to unfollow and block out of
 * the card that opens over an account name on Facebook). Whatever a rule decided, the door will not hide a menu, a
 * tooltip or a list of choices, nor the controls for blocking, unfollowing, unfriending and reporting
 * (protected-regions.ts). Refusing to mark refuses to hide, as for a private conversation.
 *
 * Its third duty is the size of a hide (hide-sanity.ts): an action bar that has become a wrapper holding a text box,
 * an ad that has become the feed. A refusal for either reason is counted once per element in the finder ledger, so a
 * rule that starts to reach too far shows as a number before anyone has to notice a missing page.
 */
const refusalCounted = new WeakSet<HTMLElement>();

function refusedByTheDoor(el: HTMLElement, opts: MarkHiddenOptions): boolean {
  if (refusedForPrivacy(el)) return true;
  const feature = opts.feature ?? opts.reason.split(':')[0];
  const why = protectedRegionReason(el) ?? hideSanityProblem(el, feature, opts.reason);
  if (why === null) return false;
  if (!refusalCounted.has(el)) {
    refusalCounted.add(el);
    recordFinderEvent(`refused.${feature}.${why}`);
  }
  return true;
}

/**
 * Idempotently mark an element hidden. Returns false when the element
 * already carries the marker value (nothing done, nothing counted), or when
 * the element is inside a private conversation, and true when this call
 * performed the first marking.
 *
 * A caller that keys its stylesheet off `opts.marker` gets the privacy rule
 * for free: an unmarked element matches no rule and stays visible.
 */
export function markHidden(el: HTMLElement, opts: MarkHiddenOptions): boolean {
  if (refusedByTheDoor(el, opts)) return false;
  if (el.getAttribute(opts.marker) === opts.value) return false;
  el.setAttribute(opts.marker, opts.value);
  el.setAttribute(BLOCK_REASON_ATTR, opts.reason);
  const count = opts.count ?? 1;
  if (count > 0) countHidden(opts.feature ?? opts.reason.split(':')[0], count, true);
  return true;
}

/**
 * Mark an element and hide it with an inline style, refusing both inside a
 * private conversation. Returns false when it refused.
 *
 * The eight filters that hid with `style.setProperty('display','none')` did it
 * immediately after `markHidden` and did NOT read its answer, so moving the
 * rule into `markHidden` alone would have stamped nothing while the element
 * went on disappearing. Rather than add a ninth and tenth hand-written check,
 * the hiding moved in here beside the rule.
 *
 * The style is applied even when the marking was a repeat, which is what those
 * eight did before: a platform re-render can strip an inline style while
 * leaving the attribute, and re-applying is how the hide survives that.
 */
export function hideElement(el: HTMLElement, opts: MarkHiddenOptions): boolean {
  if (refusedByTheDoor(el, opts)) return false;
  markHidden(el, opts);
  if (opts.mode === 'visibility') {
    // Keeps the layout box, which several filters need on purpose: TikTok's
    // own IntersectionObserver auto-advances when a container collapses, and
    // a surface switch inside the main column leaves a gap the platform
    // re-flows badly. Their reasons are kept; only the rule moved.
    el.style.setProperty('visibility', 'hidden', 'important');
    el.style.setProperty('pointer-events', 'none', 'important');
  } else {
    el.style.setProperty('display', 'none', 'important');
  }
  return true;
}

/** Reverse of markHidden for reset paths: clears marker + reason. */
export function unmarkHidden(el: HTMLElement, marker: string): void {
  el.removeAttribute(marker);
  el.removeAttribute(BLOCK_REASON_ATTR);
}
