// FeelingWise — Universal DOM Master: tier runner.
//
// Public entry point that all platform adapters call to extract rows
// from a container. Composes:
//   1. Platform's selector tiers (tried in order) — fast path
//   2. Structural-shape detector (shape-detector.ts) — universal fallback
//   3. Rotation diagnostic (rotation-diagnostic.ts) — content-aware
//      warning when both 1 and 2 fail AND the container actually has
//      content-shaped DOM
//
// The flow:
//   container ─→ tier 1 ─→ rows? return
//                 │
//                 ↓ none
//               tier 2 ─→ rows? return
//                 │
//                 ↓ none
//               tier N ─→ rows? return
//                 │
//                 ↓ none
//              shape-detector ─→ rows? return
//                 │
//                 ↓ none
//              rotation-diagnostic ─→ empty (with warn if content present)

import { detectRowsByShape } from './shape-detector';
import { maybeFireRotationDiagnostic } from './rotation-diagnostic';
import type { DomMasterAdapter, ExtractionResult } from './types';

/**
 * Extract comment / post rows from `container` using the adapter's
 * tier list, shape anchors, and content signals.
 *
 * Returns the rows + metadata about which strategy succeeded. Callers
 * that don't care about metadata can use `extractCommentRows()` below
 * which returns just the rows.
 */
function extractCommentRowsWithDiagnostics(
  container: HTMLElement,
  adapter: DomMasterAdapter,
): ExtractionResult {
  // Tier 1..N: try each platform selector tier in order.
  for (const tier of adapter.commentRowTiers) {
    const rows = runTier(container, tier);
    if (rows.length > 0) {
      return {
        rows,
        tier: tier.name,
        shapeUsed: false,
        rotationDiagnosticFired: false,
      };
    }
  }

  // Final fallback: structural-shape detector. Platform-agnostic
  // ancestor-walk from author markers to first text-marker-containing
  // ancestor.
  const shapeRows = detectRowsByShape(container, adapter.commentShapeAnchors);
  if (shapeRows.length > 0) {
    return {
      rows: shapeRows,
      tier: null,
      shapeUsed: true,
      rotationDiagnosticFired: false,
    };
  }

  // Nothing found. Fire content-aware diagnostic if the container
  // actually has content-shaped DOM (otherwise it's just a scope where
  // no rows exist — e.g. a video card without an opened comment panel).
  const diagnosticFired = maybeFireRotationDiagnostic(
    adapter.platform,
    container,
    adapter.commentContentSignals,
  );

  return {
    rows: [],
    tier: null,
    shapeUsed: false,
    rotationDiagnosticFired: diagnosticFired,
  };
}

/**
 * Convenience wrapper for callers that only need the rows.
 */
export function extractCommentRows(
  container: HTMLElement,
  adapter: DomMasterAdapter,
): HTMLElement[] {
  return extractCommentRowsWithDiagnostics(container, adapter).rows;
}

/** Run a single tier — selector or walk-based — and apply optional filter. */
function runTier(container: HTMLElement, tier: import('./types').SelectorTier): HTMLElement[] {
  if (tier.walk) {
    const rows = tier.walk(container);
    return tier.filter ? rows.filter(tier.filter) : rows;
  }
  if (tier.selector) {
    const rows = Array.from(container.querySelectorAll<HTMLElement>(tier.selector));
    // Self-match: when the container itself matches the tier selector, include
    // it at index 0. Mirrors the per-platform `_collectContainers` pattern
    // (matches?(selector) → push self → querySelectorAll). The MutationObserver
    // delivers row elements DIRECTLY as the mutation root when new rows lazy-
    // load (the addedNode IS the row, not a parent of it) — without this,
    // those mutations would skip the fast-path tier and fall through to the
    // shape detector. Safe for platforms whose "container" is a wrapper that
    // doesn't match the row selector (e.g. TikTok's video card never matches
    // the comment-row selector).
    if (container.matches?.(tier.selector)) {
      rows.unshift(container);
    }
    return tier.filter ? rows.filter(tier.filter) : rows;
  }
  // Defensive: a tier with neither selector nor walk is a config error.
  // Return empty so the chain continues to next tier.
  return [];
}
