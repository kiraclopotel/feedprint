// FeelingWise — Universal DOM Master: types.
//
// Shared interfaces for platform adapters that use the dom-master tier-
// runner + shape-detector. The pattern: each platform declares its row
// detection as DATA (selector tiers + shape anchors) instead of
// imperative DOM walks. The shared infrastructure handles tier fallback,
// structural-shape detection, and rotation diagnostics uniformly.
//
// Why this exists:
//
// Before dom-master, each of the 5 platform adapters (twitter, facebook,
// instagram, tiktok, youtube) had its own DOM walk strategy with its own
// selector chains, its own fallback patterns, and its own diagnostic
// surface. When a platform rotated its class names or data attributes
// (the TikTok 2026-05-15 incident is the worked example: data-e2e attrs
// stripped from comment panels), only the affected platform's adapter
// would need fixing — but the fix would be ad-hoc, would not benefit the
// other platforms, and the diagnostic for "where did this go wrong" was
// inconsistent (TT had a console.warn, FB silently failed, etc).
//
// The dom-master pattern inverts this:
//   • Shared infrastructure for tier fallback + shape detection +
//     diagnostics (one place, one format, one playbook).
//   • Per-platform code becomes pure CONFIG: list of selector tiers, set
//     of shape-anchor selectors. No imperative walks.
//   • When ANY platform rotates, the structural-shape detector catches
//     it via shape signatures that are MORE STABLE than class names
//     (URL patterns like `a[href^="/@"]` on TikTok, role attributes on
//     X, anchor-tag-shape on Instagram).
//
// Stability hierarchy of DOM anchors (most → least stable):
//   1. URL patterns         (`a[href^="/@"]`, `a[href*="/status/"]`)
//   2. ARIA roles            (`[role="article"]`, `[role="link"]`)
//   3. Standard HTML semantics (`time[datetime]`, `lang` attributes)
//   4. Data attributes       (`data-testid`, `data-e2e`) — rotate occasionally
//   5. CSS class names       — rotate frequently
//
// The shape anchors below should prefer 1-3, fall back to 4, treat 5 as
// last resort. Class-name tiers stay as fast-path optimizations but the
// shape detector is the safety net.

/**
 * A single tier in a platform's selector chain. Tiers are tried in order;
 * the first one returning rows wins. If all tiers return zero, the
 * shape-detector runs as a final fallback.
 *
 * Two shapes:
 *   • Selector-based: `selector` is a CSS string. Optional `filter`
 *     callback drops false positives (e.g. reply-tier wrappers).
 *   • Function-based: `walk` runs custom traversal when shape doesn't
 *     fit a flat CSS selector (used for marker-up-walk patterns).
 */
// Read through a namespace import in tier-runner.ts, which is why knip does not see it.
export interface SelectorTier {
  /** Human-readable name for diagnostics. */
  readonly name: string;
  /** CSS selector applied via container.querySelectorAll. Mutually exclusive with `walk`. */
  readonly selector?: string;
  /** Optional filter applied to selector results before returning. */
  readonly filter?: (el: HTMLElement) => boolean;
  /** Imperative walk used when CSS-flat doesn't capture the shape. Mutually exclusive with `selector`. */
  readonly walk?: (container: HTMLElement) => HTMLElement[];
}

/**
 * Structural-shape anchors used by the shape-detector when ALL selector
 * tiers return zero. The detector finds rows by SHAPE: locate author
 * markers, walk up to the first ancestor containing a text marker
 * descendant — that ancestor is the row's bounding box.
 *
 * Each anchor list is tried in order. The first list that produces ≥1
 * row wins.
 *
 * Author markers should be URL-pattern based when possible (most stable).
 * Text markers should be semantic-HTML based when possible (`<p>`,
 * `span[lang]`, `[role="article"]`).
 */
export interface ShapeAnchors {
  /**
   * Selectors matching the smallest "username / author handle" element
   * inside a comment or post row. Tried in order; first non-empty match
   * is used. Stable-first: `a[href^="/@"]` (URL pattern) before
   * `[data-e2e^="comment-username-"]` (data attr) before class names.
   */
  readonly authorMarkers: readonly string[];
  /**
   * Selectors matching the smallest "body text" element inside a row.
   * Stable-first: `<p>`, `span[lang]`, then data attrs, then classes.
   */
  readonly textMarkers: readonly string[];
}

/**
 * Content-signal selectors used by the rotation diagnostic to decide
 * whether to fire a "rotation suspected" warning. Only fire when the
 * container has CONTENT-shaped DOM that the tiers + shape-detector
 * still couldn't extract — NOT when the container has merely action-bar
 * shaped DOM (like-icon / share-icon / comment-icon siblings without
 * any actual comment row content).
 *
 * The TikTok 2026-05-15 false-positive incident: the adapter scanned
 * video-card-level containers (which have `comment-icon` action-bar
 * data-e2e attrs but no comment rows because the panel hadn't been
 * opened) and the old gate `[data-e2e^="comment-"]` matched those
 * icons → rotation warning fired on every video card during normal
 * feed scroll. Content-shaped selectors below distinguish content from
 * chrome.
 */
export interface ContentSignals {
  /**
   * Selectors that ONLY appear when actual row CONTENT is in scope (not
   * action-bar icons / chrome). If any of these match the container, we
   * EXPECT to find rows; if tiers + shape-detector still return zero,
   * fire the rotation diagnostic. If NONE of these match, the container
   * simply has no rows to extract — no rotation, no warning.
   */
  readonly contentSelectors: readonly string[];
}

/**
 * A platform's DOM-master configuration. Each platform adapter exports
 * one of these and passes it to the shared tier-runner.
 */
export interface DomMasterAdapter {
  readonly platform: 'twitter' | 'facebook' | 'instagram' | 'tiktok' | 'youtube';
  /** Selector tiers for comment rows. Tried in order. */
  readonly commentRowTiers: readonly SelectorTier[];
  /** Shape anchors for the universal fallback. */
  readonly commentShapeAnchors: ShapeAnchors;
  /** Content-signal selectors for the diagnostic gate. */
  readonly commentContentSignals: ContentSignals;
}

/**
 * Result of an extraction attempt. Reports rows found + which tier
 * found them + whether shape-fallback or diagnostic fired. Used by the
 * caller for telemetry + by tests for assertions.
 */
export interface ExtractionResult {
  readonly rows: HTMLElement[];
  readonly tier: string | null;
  readonly shapeUsed: boolean;
  readonly rotationDiagnosticFired: boolean;
}
