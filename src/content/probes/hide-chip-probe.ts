// FeelingWise — M96 hide-chip anomaly instrument (2026-08-03).
//
// Live report: three overlapping "show anyway" chips on the X photo
// modal with post text readable beneath them. Four code-traced hypotheses
// (known-issues.md M96) need live discrimination, and the user must not have
// to arm anything: this instrument self-arms at the first chip mount, sweeps
// while at least one chip exists, and disarms when none remain. Everything it
// emits is content-free (opaque ordinals, href-path hashes, booleans, y
// offsets) per the M37/M90 privacy bar; the counters ride the existing Copy
// Diagnostics channel, so one browse plus one copy answers:
//   - m96ChipsCoexist            two or more chips on screen at once
//   - m96CoexistDistinctPosts    ...anchored to DIFFERENT statuses (H1: three
//                                real hidden posts, chips visually stacked)
//   - m96CoexistSharedPost       ...two+ chips for the SAME status (H2/H3:
//                                duplicate containers for one post)
//   - m96ChipAnchorMismatch      a chip whose next sibling is not a hard-
//                                hidden container (orphaned / swapped anchor)
//   - m96ChipOverVisibleUnrevealed  a chip standing over a VISIBLE container
//                                the user never revealed (a genuine hide loss)
// Console detail lines carry the per-chip tuples for the same sweep; they are
// emitted only when the observed state CHANGES, so a stable page stays quiet.

const ordinals = new WeakMap<Element, number>();
let nextOrdinal = 0;
let sweepTimer: ReturnType<typeof setInterval> | null = null;
let lastSignature = '';
const SWEEP_MS = 10_000;

import { bumpCounter } from '../../diagnostics/diagnostics';

function ordinalFor(el: Element): number {
  let o = ordinals.get(el);
  if (o === undefined) {
    o = ++nextOrdinal;
    ordinals.set(el, o);
  }
  return o;
}

/** djb2 over a string, 8 hex chars — identity comparison without content. */
export function contentFreeHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/** Hash of the first status-permalink PATH inside the container ('' query
 *  stripped). Same post in two containers → same hash; no id is emitted. */
function statusHrefHash(container: Element): string {
  const href = container.querySelector('a[href*="/status/"]')?.getAttribute('href') ?? '';
  const path = href.split('?')[0];
  return path ? contentFreeHash(path) : 'none';
}

interface ChipObservation {
  ord: number;
  anchorOrd: number | null;
  postHash: string;
  anchorHardHidden: boolean;
  anchorDisplayNone: boolean;
  anchorRevealed: boolean;
  y: number;
}

function observeChip(chip: Element): ChipObservation {
  const anchor = chip.nextElementSibling as HTMLElement | null;
  const rect = typeof chip.getBoundingClientRect === 'function'
    ? chip.getBoundingClientRect()
    : { top: 0 };
  return {
    ord: ordinalFor(chip),
    anchorOrd: anchor ? ordinalFor(anchor) : null,
    postHash: anchor ? statusHrefHash(anchor) : 'none',
    anchorHardHidden: anchor?.getAttribute('data-fw-hard-hidden') === 'true',
    anchorDisplayNone: anchor !== null
      && anchor.style.getPropertyValue('display') === 'none'
      && anchor.style.getPropertyPriority('display') === 'important',
    anchorRevealed: anchor?.getAttribute('data-fw-user-revealed') === 'true',
    y: Math.round(rect.top),
  };
}

/** One sweep over every mounted chip. Exported for tests; production runs it
 *  on the interval armed by noteHideChipMounted. */
export function sweepHideChips(): void {
  const chips = Array.from(document.querySelectorAll('[data-fw-hide-notice="true"]'));
  if (chips.length === 0) {
    if (sweepTimer !== null) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
    lastSignature = '';
    return;
  }
  const observed = chips.map(observeChip);
  const signature = JSON.stringify(observed);
  if (signature === lastSignature) return;
  lastSignature = signature;

  if (observed.length >= 2) {
    bumpCounter('m96ChipsCoexist');
    const hashes = observed.map((o) => o.postHash).filter((h) => h !== 'none');
    const distinct = new Set(hashes);
    if (hashes.length >= 2) {
      bumpCounter(distinct.size === hashes.length ? 'm96CoexistDistinctPosts' : 'm96CoexistSharedPost');
    }
  }
  for (const o of observed) {
    if (o.anchorOrd === null || !o.anchorHardHidden) bumpCounter('m96ChipAnchorMismatch');
    else if (!o.anchorDisplayNone && !o.anchorRevealed) bumpCounter('m96ChipOverVisibleUnrevealed');
  }
  console.info(
    '[FW probe] m96-chips '
      + observed
        .map((o) =>
          `ord=${o.ord} anchor=${o.anchorOrd ?? 'none'} post=${o.postHash}`
          + ` hidden=${o.anchorHardHidden && o.anchorDisplayNone} revealed=${o.anchorRevealed} y=${o.y}`)
        .join(' | '),
  );
}

/** Called by mountHideNotice on every chip mount. Arms the sweep; the sweep
 *  disarms itself when the last chip leaves the DOM. */
export function noteHideChipMounted(_container: HTMLElement): void {
  if (sweepTimer === null && typeof setInterval === 'function') {
    sweepTimer = setInterval(sweepHideChips, SWEEP_MS);
  }
  // Snapshot now rather than waiting a sweep period: the reported anomaly
  // is visible at mount time.
  queueMicrotask(sweepHideChips);
}

/** Test-only: the module keeps interval + dedup state across mounts. */
export function _resetHideChipProbeForTesting(): void {
  if (sweepTimer !== null) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
  lastSignature = '';
}
