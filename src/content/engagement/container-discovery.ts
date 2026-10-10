// FeelingWise - Generic container discovery utility
// Walks up the DOM from anchor selectors to find the smallest
// ancestor satisfying size, structure, and content constraints.
// Platform-agnostic: no TikTok/Twitter knowledge.

export interface AnchorSet {
  required: string[];
  optional: string[];
}

export interface ContainerConstraints {
  minRequiredAnchors: number;
  size: {
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
    maxViewportWidthRatio?: number;
  };
  maxChildCount?: number;
  rejectIfContains: string[];
  maxWalkDepth: number;
}

export interface DiscoveredContainer {
  element: HTMLElement;
  anchorsFound: number;
  depth: number;
  confidence: 'high' | 'medium' | 'low';
}

function countAnchorsInside(
  container: Element,
  anchors: AnchorSet,
): { required: number; optional: number } {
  let required = 0;
  let optional = 0;
  for (const sel of anchors.required) {
    if (container.querySelector(sel)) required++;
  }
  for (const sel of anchors.optional) {
    if (container.querySelector(sel)) optional++;
  }
  return { required, optional };
}

function checkSizeConstraints(
  rect: DOMRect,
  size: ContainerConstraints['size'],
): boolean {
  if (size.minWidth != null && rect.width < size.minWidth) return false;
  if (size.maxWidth != null && rect.width > size.maxWidth) return false;
  if (size.minHeight != null && rect.height < size.minHeight) return false;
  if (size.maxHeight != null && rect.height > size.maxHeight) return false;
  if (size.maxViewportWidthRatio != null) {
    const viewportWidth = window.innerWidth;
    if (viewportWidth > 0 && rect.width / viewportWidth > size.maxViewportWidthRatio) {
      return false;
    }
  }
  return true;
}

function computeConfidence(
  anchorsFound: number,
  totalRequired: number,
  totalOptional: number,
  optionalFound: number,
): 'high' | 'medium' | 'low' {
  const requiredRatio = totalRequired > 0 ? anchorsFound / totalRequired : 0;
  const optionalRatio = totalOptional > 0 ? optionalFound / totalOptional : 0;
  if (requiredRatio >= 1 && optionalRatio >= 0.5) return 'high';
  if (requiredRatio >= 0.75) return 'medium';
  return 'low';
}

function evaluateCandidate(
  candidate: Element,
  anchors: AnchorSet,
  constraints: ContainerConstraints,
  depth: number,
): DiscoveredContainer | null {
  if (candidate === document.body || candidate === document.documentElement) {
    return null;
  }

  if (!(candidate instanceof HTMLElement)) return null;

  const { required, optional } = countAnchorsInside(candidate, anchors);
  if (required < constraints.minRequiredAnchors) return null;

  const rect = candidate.getBoundingClientRect();
  if (!checkSizeConstraints(rect, constraints.size)) return null;

  for (const sel of constraints.rejectIfContains) {
    if (candidate.querySelector(sel)) return null;
  }

  if (constraints.maxChildCount != null && candidate.childElementCount > constraints.maxChildCount) {
    return null;
  }

  return {
    element: candidate,
    anchorsFound: required,
    depth,
    confidence: computeConfidence(required, anchors.required.length, anchors.optional.length, optional),
  };
}

/** Compare two candidates: higher anchorsFound wins, then shallower depth. */
function isBetter(a: DiscoveredContainer, b: DiscoveredContainer): boolean {
  if (a.anchorsFound !== b.anchorsFound) return a.anchorsFound > b.anchorsFound;
  return a.depth < b.depth;
}

/**
 * Discover the single best container element by walking up from anchor elements.
 */
export function discoverContainer(
  root: Document | Element,
  anchors: AnchorSet,
  constraints: ContainerConstraints,
): DiscoveredContainer | null {
  const all = discoverAllContainers(root, anchors, constraints);
  if (all.length === 0) return null;

  let best = all[0];
  for (let i = 1; i < all.length; i++) {
    if (isBetter(all[i], best)) best = all[i];
  }
  return best;
}

/**
 * Discover all qualifying container elements, one per unique ancestor.
 * If two anchors walk up to the same container, it is returned only once.
 */
export function discoverAllContainers(
  root: Document | Element,
  anchors: AnchorSet,
  constraints: ContainerConstraints,
): DiscoveredContainer[] {
  const anchorElements: Element[] = [];
  for (const sel of anchors.required) {
    const matches = root.querySelectorAll(sel);
    for (let i = 0; i < matches.length; i++) {
      anchorElements.push(matches[i]);
    }
  }

  const seen = new Set<Element>();
  const results: DiscoveredContainer[] = [];

  for (const anchor of anchorElements) {
    let current: Element | null = anchor.parentElement;
    let depth = 1;

    while (current && depth <= constraints.maxWalkDepth) {
      if (!seen.has(current)) {
        const result = evaluateCandidate(current, anchors, constraints, depth);
        if (result) {
          seen.add(current);
          results.push(result);
          break; // found the best (smallest) container for this anchor
        }
      } else {
        // Already discovered this container from another anchor — skip
        break;
      }

      current = current.parentElement;
      depth++;
    }
  }

  return results;
}
