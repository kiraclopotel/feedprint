// FeelingWise — Universal DOM Master: rotation diagnostic.
//
// Content-aware one-shot warning that fires when ALL platform tiers AND
// the structural-shape detector return zero AND the container actually
// has content-shaped DOM (i.e., the rotation is real, not a scope mis-
// match like the TT 2026-05-15 false positive where action-bar icons
// matched the old over-permissive gate).
//
// One-shot per session per platform. Reset on full content-script reload
// (page refresh / extension reload).
//
// Captures BOTH class samples AND data-attr samples so the next adapter
// iteration knows which dimension(s) rotated. Pre-dom-master the
// diagnostic only captured class samples and only fired on TT — making
// rotation incidents on other platforms invisible. Now all 5 platforms
// share this format.

import type { ContentSignals } from './types';
import { fwDebug } from '../../../core/fw-log';

/** Session-scoped one-shot guards per platform. */
const _firedPlatforms = new Set<string>();

/**
 * Decide whether to fire + emit. Returns true when the rotation
 * diagnostic actually warned (caller writes a forensic event); false
 * when the container has no content to extract (no warning needed).
 *
 * Conditions for firing:
 *   1. All tiers + shape-detector returned zero (caller's responsibility
 *      to check before invoking this).
 *   2. Container has at least one content-shaped element per
 *      `signals.contentSelectors`. This is the CONTENT vs CHROME
 *      distinction that the old TT-only diagnostic missed.
 *   3. One-shot for this platform hasn't already fired this session.
 *
 * @returns Whether the diagnostic fired (true = warned, false = quietly
 *          accepted the empty result).
 */
export function maybeFireRotationDiagnostic(
  platform: string,
  container: HTMLElement,
  signals: ContentSignals,
): boolean {
  if (_firedPlatforms.has(platform)) return false;

  // Content-aware gate. The TT 2026-05-15 incident: old gate matched
  // `[data-e2e^="comment-"]` which caught action-bar icons (comment-icon
  // / comment-count on every video card in the feed), warning even
  // though no comment rows existed at that scope. New gate: only fire
  // when CONTENT-shaped DOM is present.
  let hasContent = false;
  for (const selector of signals.contentSelectors) {
    if (container.querySelector(selector)) {
      hasContent = true;
      break;
    }
  }
  if (!hasContent) return false;

  _firedPlatforms.add(platform);

  const classSamples = sampleClasses(container);
  const dataAttrSamples = sampleDataAttrs(container);
  const containerShape = describeContainerShape(container);

  // The warning and the container's shape (tags, child counts) always; the samples read off the page (class names,
  // attribute values) only behind the debug switch.
  console.warn(
    `[FW dom-master:${platform}] rotation detected — all tiers + shape-detector returned zero; ` +
    `container: ${containerShape}`,
  );
  fwDebug(`[FW dom-master:${platform}] class samples: ${classSamples}; data-attr samples: ${dataAttrSamples}`);

  return true;
}

/** Reset the one-shot guards. Used by tests + on extension reload. */
export function _resetRotationDiagnosticGuards(): void {
  _firedPlatforms.clear();
}

/** Up to 3 unique class-list samples from elements with content-looking classes. */
function sampleClasses(container: HTMLElement): string {
  const seen = new Set<string>();
  const candidates = container.querySelectorAll<HTMLElement>('[class]');
  for (const el of Array.from(candidates).slice(0, 30)) {
    const cls = (el.className || '').toString().slice(0, 100);
    if (cls && !seen.has(cls)) seen.add(cls);
    if (seen.size >= 3) break;
  }
  return seen.size > 0 ? Array.from(seen).join(' | ') : '(none)';
}

/** Up to 3 unique data-* attribute samples from descendants. */
function sampleDataAttrs(container: HTMLElement): string {
  const seen = new Set<string>();
  const candidates = container.querySelectorAll<HTMLElement>('[data-testid], [data-e2e], [data-ad-rendering-role]');
  for (const el of Array.from(candidates).slice(0, 30)) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('data-')) {
        const sample = `${attr.name}="${attr.value.slice(0, 40)}"`;
        if (!seen.has(sample)) seen.add(sample);
        if (seen.size >= 3) break;
      }
    }
    if (seen.size >= 3) break;
  }
  return seen.size > 0 ? Array.from(seen).join(' | ') : '(none)';
}

/** Brief shape description: tag, child count, plus up to 3 direct-child
 * shape descriptors (tag.firstClass/grandchildCount). The child shapes
 * reveal what the wrapping element actually contains — a critical hint
 * during DOM rotations where the container tag stays the same (e.g.
 * `<ul>`) but its children swap shape (`<li>` → `<div>`). Pre-2026-05-23
 * the shape was just `ul/3children`, which left "rotation detected"
 * alerts with no structural signal beyond the bare container.
 */
function describeContainerShape(container: HTMLElement): string {
  const tag = container.tagName.toLowerCase();
  const total = container.children.length;
  const childShapes: string[] = [];
  const directChildren = Array.from(container.children).slice(0, 3);
  for (const child of directChildren) {
    const childTag = child.tagName.toLowerCase();
    const cls = (child.className || '').toString();
    const firstClass = cls.split(/\s+/).find(Boolean)?.slice(0, 12) ?? '';
    const grandchildCount = child.children.length;
    childShapes.push(
      firstClass
        ? `${childTag}.${firstClass}/${grandchildCount}`
        : `${childTag}/${grandchildCount}`,
    );
  }
  const childPart = childShapes.length > 0 ? ` [${childShapes.join(',')}]` : '';
  return `${tag}/${total}children${childPart}`;
}
