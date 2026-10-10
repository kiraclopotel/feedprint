import { hideElement } from './mark-hidden';
import { observeAddedRoots } from './added-roots';
import { isInPrivateChatSubtree } from '../platforms/adapter';

// FeelingWise — DOM Section Model (POC, 2026-05-24)
//
// Platform-agnostic classifier for the two engagement primitives the
// engagement-hider actually needs:
//
//   1. CountChip — an atomic element whose accessible name OR direct text
//      reads like "<digit><K|M|B?> <metric noun>" or a pure numeric leaf
//      ("108", "1.5K", "1.3M"). What `hide-engagement-metrics` targets.
//
//   2. ActionBar — a flex/grid row of 2-8 same-shape interactive children
//      (Like / Comment / Share). What `hide-action-buttons` targets.
//
// The structural-finder cross-cut these two concepts in an earlier
// iteration: a single 5-tier scorer tagged both bars and chips and a
// post-hoc predicate (`isCountLike`) disambiguated after the fact. The
// disambiguation was where regressions lived — FB Reels over-hid action
// buttons because the inner count wrapper qualified; FB feed under-hid
// counts because the `<div role="button"><span>4 comments</span></div>`
// wrapper had empty direct text and only matched via a small-wrapper
// fallback. Splitting the two jobs eliminates the disambiguation cost.
//
// This module separates the two jobs. Each finder runs against a root
// element with NO per-platform branching — the signals it uses are
// stable across Meta / X / IG / FB:
//
//   - aria-label + accessible name (ARIA spec)
//   - direct text-node content (not recursed textContent)
//   - sibling/parent shape (flex/grid + child count)
//
// It does NOT use any platform-specific class names, data-pagelet
// values, data-e2e attributes, or ytd-* element names. Adding a new
// platform requires NO change to this module — only adding a root
// selector to the calling engagement controller.
//
// The engagement controllers call `findCountChips` via
// `startCountChipScan` when only `hide-engagement-metrics` is on; when
// `hide-action-buttons` is also on they fall back to the structural-
// finder for action-bar hide (FB+IG) or per-platform hardcoded selectors
// (TT+YT+X).

const ESSENTIAL_SKIP_ATTR = '[data-fw-essential]';

// ─── Metric-noun regex (multi-language, digit-anchored) ───────────────────
//
// Mirrors the structural-finder's regex but kept module-local so this
// file has zero internal dependency on structural-finder. The two will
// diverge: this regex governs CHIP detection only (digit + noun); the
// structural-finder regex covers ACTION-BAR text too.
//
// Languages currently covered: EN, RO, ES, FR, DE, PT, IT.

const METRIC_NOUN_DIGIT = /\d[\d.,]*\s*[KMBkmb]?\s*(reaction|comment|share|like|view|repl(?:y|ies)|repost|bookmark|reacti|comentari|distribui|aprecier|vizualiz|kommentar|partage|commentair|comentario|comentário|reazion|condivision|risposta|risposte|réponse|antwort)/i;

const PURE_NUMERIC_LEAF = /^[\d.,]+\s*[KMBkmb]?$/;

// ─── Accessible-name extraction (axe-core-inspired, scoped) ───────────────
//
// Computes a label for `el` per ARIA precedence rules: aria-labelledby
// > aria-label > textContent fallback. Bounded to <= 200 chars so a
// labelledby pointing at a paragraph doesn't yield a huge string.
//
// Not a full spec port — we don't honor hidden text suppression, role
// inheritance, or display:none ancestors. Those edge cases don't change
// chip detection in practice (chips have explicit aria-label or visible
// text).

function accessibleName(el: Element): string {
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const ids = labelledBy.split(/\s+/).filter(Boolean);
    const parts: string[] = [];
    for (const id of ids) {
      const ref = el.ownerDocument?.getElementById(id);
      if (ref) parts.push((ref.textContent || '').trim());
    }
    const joined = parts.join(' ').replace(/\s+/g, ' ').trim();
    if (joined) return joined.slice(0, 200);
  }
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.replace(/\s+/g, ' ').trim().slice(0, 200);
  return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

function directText(el: Element): string {
  let s = '';
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) s += child.textContent ?? '';
  }
  return s.trim();
}

function hasInteractiveAncestorWithNonMetricLabel(el: Element, maxDepth: number = 5): boolean {
  let anc: Element | null = el.parentElement;
  for (let i = 0; anc && i < maxDepth; i++) {
    const role = anc.getAttribute('role');
    const isInteractive =
      role === 'button' ||
      role === 'link' ||
      anc.tagName === 'BUTTON' ||
      anc.tagName === 'A';
    if (isInteractive) {
      const ancAria = (anc.getAttribute('aria-label') || '').trim();
      if (ancAria.length > 0 && !METRIC_NOUN_DIGIT.test(ancAria)) {
        return true;
      }
    }
    anc = anc.parentElement;
  }
  return false;
}

// ─── CountChip finder ──────────────────────────────────────────────────────
//
// Two passes, both platform-agnostic:
//
//   Pass 1 — Accessible-name pass: walk every element carrying
//            aria-label / aria-labelledby; if its accessible name
//            matches the digit-anchored metric-noun regex, it's a chip.
//            Catches reaction-toolbars with aria-label="View all 1.2K
//            reactions" + the standalone "4 comments" anchor whose
//            label IS its text.
//
//   Pass 2 — Numeric-leaf pass: walk small elements (textLength <= 60,
//            <= 1 element child, no media/SVG descendants) whose direct
//            text is a pure numeric leaf ("108", "1.5K") OR matches
//            digit + metric noun. Catches the bare "4 comments" span and
//            the "108" count next to a Like icon.
//
//            Iterates span/a/strong/b/bdi AND button/role=button. For
//            buttons, only pure-numeric text qualifies — handles IG's
//            bare-count-button pattern (`<button>209</button>` between
//            Comment and Repost) while avoiding X's action-button pattern
//            where the button's accessible name is "642 Likes. Like".
//
//            Guarded by an ancestor-walk — if the element sits inside an
//            interactive ancestor whose own aria-label is a non-metric
//            phrase ("Like", "Comentează", "Distribuie"), it's that
//            button's interior, not a standalone chip. Skip.
//
// Excludes: anything under [data-fw-essential] (FW's own UI).

const NON_LEAF_MEDIA_SELECTOR = 'video, img, canvas, audio, iframe, embed, object, svg';

export interface FindOptions {
  /** Max chip text length to consider in Pass 2. Defaults to 60. */
  readonly maxLeafTextLength?: number;
  /** Max children a Pass-2 candidate may have. Defaults to 1 (true leaf or label-wrapping span). */
  readonly maxLeafChildren?: number;
}

export function findCountChips(
  root: ParentNode,
  options: FindOptions = {},
): HTMLElement[] {
  const maxLeafText = options.maxLeafTextLength ?? 60;
  const maxLeafChildren = options.maxLeafChildren ?? 1;
  const out = new Set<HTMLElement>();

  // Pass 1 — accessible-name match on aria-labeled NON-button elements
  // that are LEAF-ISH (<=1 element child).
  //
  // Buttons are excluded because X (twitter) labels its action buttons
  // with the full count: "642 Likes. Like". The digit + "Like" matches the
  // metric-noun regex, but tagging the button hides the Like action
  // entirely. The inner span containing "642" is what we actually want
  // hidden — Pass 2 catches it via the leaf-numeric path.
  //
  // Element-children cap (<=1) is mandatory because X also wraps its
  // engagement-row in a container that aggregates every count into one
  // aria-label: <div role="group" aria-label="1.8K replies, 2.7K reposts,
  // 23K likes, 1234 bookmarks, 10M views"> with 6 button children. The
  // compound label matches the metric-noun regex, so without this gate
  // Pass 1 would tag the wrapper and hide the entire engagement row
  // (which is what was found live on x.com, 2026-05-24). Real chip elements are
  // leaves (0 children) or near-leaves (1 child carrying icon/text); a
  // multi-button wrapper is a container, not a chip.
  //
  // Other aria-labeled interactive types (links, toolbars) stay allowed
  // when leaf-ish: X view-count link `<a aria-label="381953 views...">`
  // wraps count+affordance as one element, no children.
  // querySelectorAll never returns the root itself; the incremental path
  // hands over the parent of an inserted text node, which may be the chip.
  const self = root instanceof HTMLElement ? root : null;
  const labelled = [
    ...(self && self.matches('[aria-label], [aria-labelledby]') ? [self] : []),
    ...root.querySelectorAll<HTMLElement>('[aria-label], [aria-labelledby]'),
  ];
  for (const el of labelled) {
    // Hidden on an earlier pass: still a found chip (the selector-family
    // sweep reads `found`), not re-evaluated.
    if (el.dataset.fwCountChip === 'true') { out.add(el); continue; }
    if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') continue;
    if (el.children.length > 1) continue;
    if (el.closest(ESSENTIAL_SKIP_ATTR)) continue;
    const name = accessibleName(el);
    if (!name) continue;
    if (METRIC_NOUN_DIGIT.test(name)) {
      out.add(el);
    }
  }

  // Pass 2 — leaf-numeric match with ancestor guard.
  //
  // Iterates small text-bearing elements + buttons + leaf divs. For non-
  // button leaves (span / a / strong / b / bdi / div), accepts either
  // pure-numeric text ("108") or digit + metric noun ("194 comentarii").
  // For buttons, accepts ONLY pure-numeric text AND only when the button
  // has no aria-label — bare-numeric, aria-less buttons are the IG
  // count-chip pattern (`<button>209</button>` between Comment and Repost)
  // and the chip IS the button. Aria-labeled buttons are X-style action
  // buttons ("42 Replies. Reply") where the count is rendered as direct
  // text or an inner span; tagging the button itself hides the entire
  // action (over-hide that collapses the row). Inner span/div gets caught
  // separately via this same loop's iteration, leaving the button visible.
  //
  // `div` is added with the strictest gate: only pure leaves (0 element
  // children) qualify. X's repost button on small counts renders the count
  // as `<button aria-label="42 reposts. Repost"><div>...<div>42</div>...
  // </div></button>` — the inner `<div>42</div>` is a true leaf div that
  // the a11y tree hides behind the button's accessible name, so Pass 2
  // span iteration missed it. Restricting div to 0 children keeps FB's
  // div-heavy DOM cheap (containers always have children).
  const LEAF_SELECTOR = 'span, a, strong, b, bdi, button, [role="button"], div';
  const leafCandidates = [
    ...(self && self.matches(LEAF_SELECTOR) ? [self] : []),
    ...root.querySelectorAll<HTMLElement>(LEAF_SELECTOR),
  ];
  // This loop visits nearly every element on the page; the cheap rejections
  // (child count, direct text) run before any ancestor walk.
  for (const el of leafCandidates) {
    if (out.has(el)) continue;
    if (el.dataset.fwCountChip === 'true') { out.add(el); continue; }
    const isDiv = el.tagName === 'DIV';
    const childCap = isDiv ? 0 : maxLeafChildren;
    if (el.children.length > childCap) continue;
    const text = directText(el);
    if (!text) continue;
    if (text.length > maxLeafText) continue;

    const isButton = el.tagName === 'BUTTON' || el.getAttribute('role') === 'button';
    if (isButton && (el.getAttribute('aria-label') || '').trim().length > 0) continue;
    const isPureNumeric = text.length < 16 && PURE_NUMERIC_LEAF.test(text);
    const isMetricCount = !isButton && METRIC_NOUN_DIGIT.test(text);
    if (!isPureNumeric && !isMetricCount) continue;

    if (el.querySelector(NON_LEAF_MEDIA_SELECTOR)) continue;
    if (el.closest(ESSENTIAL_SKIP_ATTR)) continue;
    // A private conversation is out of scope for every filter, not only the
    // emoji stripper, and the gate is by DOM region rather than by URL
    // (2026-09-19). structural-finder, ai-content-blocker and
    // empty-comment-hide all check this; this scan did not, and unlike them it
    // walks document.body whole, every two seconds, with no root to scope it.
    //
    // So an unread badge or a message that is just a number, inside an open
    // Messenger dock or a DM panel sitting on top of the feed, read as a count
    // chip and was hidden. It sits with the other ancestor walks rather than
    // above them: the comment on this loop says the cheap rejections come
    // first because it visits nearly every element on the page.
    if (isInPrivateChatSubtree(el)) continue;
    if (hasInteractiveAncestorWithNonMetricLabel(el)) continue;

    out.add(el);
  }

  return Array.from(out);
}

// ─── Scan loop ─────────────────────────────────────────────────────────────
//
// Throttled MutationObserver + periodic safety-net rescan, mirroring the
// shape of structural-finder.startStructuralEngagementScan so engagement
// controllers can swap in this finder for `counts-only` mode without
// changing their lifecycle.

const CHIP_MARKER = 'data-fw-count-chip';

interface ChipScanResult {
  /** Newly-tagged chips on this pass. Cumulative tagging is idempotent. */
  readonly newlyTagged: number;
  /**
   * Chips the finder matched on this pass, newly tagged or already tagged.
   * `newlyTagged` falls to zero once a page is fully processed, so it cannot
   * distinguish a rotated selector family from a settled page; this can.
   * Selector-family sweep reporting reads this (RECON F3a, 2026-08-18).
   */
  readonly found: number;
  /** Number of distinct root containers iterated. */
  readonly rootsScanned: number;
}

export type ChipScanCallback = (result: ChipScanResult) => void;

function tagChip(el: HTMLElement): boolean {
  if (el.dataset.fwCountChip === 'true') return false;
  // Inline display:none defeats Meta's StyleX !important specificity, the
  // same trick the structural-finder uses, applied only to chips. It moved
  // into the door on 2026-09-20 so the privacy rule and the hide cannot part.
  if (!hideElement(el, {
    marker: CHIP_MARKER, value: 'true',
    reason: 'hide-engagement-metrics:count-chip',
    // Chip hides were previously uncounted (callers only log); the helper
    // now counts them like every other engagement hide.
  })) return false;
  return true;
}

/**
 * Start the count-chip scan over document.body. Returns a teardown function
 * that disconnects observers + restores tagged chips.
 *
 * Scheduling (2026-09-03): inserted subtrees are scanned at mutation time
 * through the shared added-roots observer, so a chip is hidden before its
 * first paint; a 2 s full pass is the safety net for counts the platform
 * swaps into an existing element. The earlier shape coalesced a full-body
 * walk to every 250 ms on any mutation.
 */
export function startCountChipScan(
  onScan?: ChipScanCallback,
  shouldRun?: () => boolean,
): () => void {
  let teardown = false;

  // M79 suspect-1 measurement counter (docs/spec/known-issues.md): cheap
  // always-on sampling of the full-body chip scan. One console line per
  // ~15s window, only while scans run; the verify harness reads it from its
  // console capture and a live DevTools session sees the same line.
  // walk = findCountChips only (the two whole-document querySelectorAll
  // passes M79 names); scan = walk + tagging.
  let perfWindowStart = 0;
  let perfCount = 0;
  let perfWalkMs = 0;
  let perfScanMs = 0;
  let perfMaxScanMs = 0;

  const scan = (root: ParentNode): void => {
    if (teardown) return;
    // Optional dynamic guard, re-checked every scan (survives SPA navigation).
    // YouTube passes a guard that skips the full-body chip walk on /watch —
    // the heaviest DOM on the web, scanned every tick, drove the renderer to
    // OOM. The observer/interval keep ticking cheaply; only the expensive
    // walk is skipped.
    if (shouldRun && !shouldRun()) return;
    try {
      const t0 = performance.now();
      const chips = findCountChips(root);
      const t1 = performance.now();
      let newlyTagged = 0;
      for (const chip of chips) {
        if (tagChip(chip)) newlyTagged++;
      }
      const t2 = performance.now();
      perfCount++;
      perfWalkMs += t1 - t0;
      perfScanMs += t2 - t0;
      if (t2 - t0 > perfMaxScanMs) perfMaxScanMs = t2 - t0;
      if (perfWindowStart === 0) {
        perfWindowStart = Date.now();
      } else if (Date.now() - perfWindowStart >= 15_000) {
        const secs = Math.round((Date.now() - perfWindowStart) / 1000);
        console.log(
          `[FW perf] chip-scan ${secs}s window: n=${perfCount} (${(perfCount / secs).toFixed(1)}/s) ` +
          `walk total=${perfWalkMs.toFixed(1)}ms mean=${(perfWalkMs / perfCount).toFixed(2)}ms; ` +
          `scan total=${perfScanMs.toFixed(1)}ms mean=${(perfScanMs / perfCount).toFixed(2)}ms max=${perfMaxScanMs.toFixed(1)}ms`,
        );
        perfWindowStart = Date.now();
        perfCount = 0;
        perfWalkMs = 0;
        perfScanMs = 0;
        perfMaxScanMs = 0;
      }
      if (onScan) onScan({ newlyTagged, found: chips.length, rootsScanned: 1 });
    } catch (err) {
      console.warn('[FW section-model] chip scan threw:', err);
    }
  };

  setTimeout(() => scan(document.body), 50);

  // A chip is a leaf; a node inserted inside one arrives as a text node
  // whose parent the added-roots observer hands over, so scanning each root
  // (and its subtree) covers both the new post and the count filled later.
  const stopAdded = observeAddedRoots((roots) => {
    for (const root of roots) scan(root);
  });

  const periodicScanId = window.setInterval(() => scan(document.body), 2000);

  return () => {
    teardown = true;
    stopAdded();
    clearInterval(periodicScanId);
    document.querySelectorAll<HTMLElement>(`[${CHIP_MARKER}="true"]`).forEach((el) => {
      delete el.dataset.fwCountChip;
      el.style.removeProperty('display');
    });
  };
}
