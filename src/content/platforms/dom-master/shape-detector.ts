// FeelingWise — Universal DOM Master: structural-shape detector.
//
// Platform-agnostic row detection: find author markers, walk up to the
// first ancestor containing a text marker descendant — that ancestor IS
// the row's bounding box.
//
// The key insight: selectors rotate (platforms tweak class names and data
// attributes frequently to combat scrapers + extensions), but SHAPE is
// stable. Every social-media comment has an author element + a body text
// element. As long as the platform keeps that concept, the shape detector
// finds rows regardless of how the surrounding classes / attributes are
// named.
//
// MCP live verification 2026-05-15 on TikTok confirmed:
//   • Comment panel `DivCommentListContainer` contains 20 rows with
//     `DivCommentItemWrapper` class (unchanged across rotations).
//   • Author element: `<a class="link-a11y-focus" href="/@username">`.
//     The `href="/@..."` pattern is dictated by TikTok's URL structure;
//     they cannot rotate it without breaking the site itself.
//   • Text element: `<p>` inside `DivCommentContentWrapper`.
// → Anchors `a[href^="/@"]` + `p` shape-detect every row even when all
//   data-e2e attributes are stripped from the panel.

import type { ShapeAnchors } from './types';

/**
 * Safety bounds on the structural shape walk. Both protect against
 * misconfigured anchors that would otherwise scan the whole page.
 *
 * MAX_AUTHOR_MARKERS — if a single author selector matches more than this
 * many elements, the selector is too generic for the current scope (e.g.
 * `a[href^="/@"]` against a whole YT watch page matches every channel
 * link on the surface). Bail rather than walk-up from each one; this
 * scenario means the anchors need narrowing on the platform-adapter side
 * and the shape-detector should refuse to do O(N×depth×subtree) work.
 *
 * MAX_WALK_UP_DEPTH — every author marker walks up at most this many
 * ancestors looking for a text marker descendant. Comment rows are
 * typically nested 3-8 levels deep from the author element across all 5
 * platforms; 15 is the broad ceiling. A walk reaching this depth without
 * matching means the text-marker anchors don't fit the current row shape
 * and we'd otherwise drift up into the page body running expensive
 * querySelector on each ancestor.
 */
const MAX_AUTHOR_MARKERS = 200;
const MAX_WALK_UP_DEPTH = 15;

/**
 * Detect comment / post rows by structural shape.
 *
 * Algorithm:
 *   1. For each author-marker selector (tried in order):
 *      a. Find all matching elements inside the container.
 *      b. If the count exceeds MAX_AUTHOR_MARKERS, skip this selector —
 *         it's too generic for the current scope.
 *      c. For each match: walk up the parent chain (up to MAX_WALK_UP_DEPTH
 *         ancestors). Stop at the first ancestor that contains a
 *         text-marker descendant. That ancestor is the row's bounding box.
 *      d. Dedupe via Set.
 *      e. If ≥1 row found, return.
 *   2. If no author marker matched anywhere (or all selectors over-matched),
 *      return [].
 *
 * Stops at the `container` boundary to avoid walking out of scope (e.g.
 * walking from a comment author up to the page <body>). The container
 * itself is never returned as a row.
 *
 * @param container Scope element. The author markers must be inside
 *                  this element; the walk-up stops at this element.
 * @param anchors   Author + text marker selectors. Tried in order.
 * @returns         Row elements in DOM order, deduplicated.
 */
export function detectRowsByShape(
  container: HTMLElement,
  anchors: ShapeAnchors,
): HTMLElement[] {
  for (const authorSelector of anchors.authorMarkers) {
    const markers = container.querySelectorAll<HTMLElement>(authorSelector);
    if (markers.length === 0) continue;
    if (markers.length > MAX_AUTHOR_MARKERS) {
      // Over-broad selector. Skip — refusing the work is correct here;
      // the platform adapter's tier-1 selectors should be carrying this
      // scope, and falling into a multi-thousand walk-up freezes the
      // main thread.
      continue;
    }

    const rows = new Set<HTMLElement>();
    for (const marker of markers) {
      let row: HTMLElement | null = marker.parentElement;
      let depth = 0;
      while (row && row !== container && depth < MAX_WALK_UP_DEPTH) {
        if (rowHasTextMarker(row, anchors.textMarkers)) {
          rows.add(row);
          break;
        }
        row = row.parentElement;
        depth++;
      }
    }
    if (rows.size > 0) {
      // Preserve DOM order: querySelectorAll returns document order, the
      // walk-up assigns each marker to an ancestor row, the Set preserves
      // insertion order. Result is DOM-ordered rows (first marker's row
      // before second marker's row, etc.).
      return Array.from(rows);
    }
  }
  return [];
}

/**
 * Does `row` contain a descendant matching any of the text-marker
 * selectors? First match wins; we don't validate further.
 *
 * Cheap querySelector calls — the row scope is typically small (≤50
 * elements) so this is O(N_markers * N_descendants) per row and N_markers
 * is small (≤5 usually).
 */
function rowHasTextMarker(row: HTMLElement, textMarkers: readonly string[]): boolean {
  for (const textSelector of textMarkers) {
    if (row.querySelector(textSelector)) return true;
  }
  return false;
}
