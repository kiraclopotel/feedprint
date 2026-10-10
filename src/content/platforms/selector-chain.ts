// FeelingWise - Selector chain utility
// Resilient DOM querying with fallback selectors.
// When platforms change their DOM structure, primary selectors fail.
// This utility tries selectors in priority order and logs when fallbacks
// are needed. wired in selector-health counter so drift is
// observable in Dashboard, not just in console.

import { recordSelectorHit, recordSelectorMiss } from '../../diagnostics/selector-health';
import { bumpCounter } from '../../diagnostics/diagnostics';

const KNOWN_PLATFORMS: ReadonlySet<string> = new Set(['twitter', 'facebook', 'instagram', 'tiktok', 'youtube']);

/** The platform a call belongs to: the label's first dotted segment ("twitter.post-text"), or the YouTube "yt-" labels. */
function platformOfLabel(label: string | undefined): string | undefined {
  if (!label) return undefined;
  const first = label.split('.')[0];
  if (KNOWN_PLATFORMS.has(first)) return first;
  if (first.startsWith('yt-')) return 'youtube';
  return undefined;
}

/**
 * A selector that throws (it no longer compiles) is skipped, and counted: a page change that
 * breaks a selector must show in the diagnostics, not only in a walker's report days later.
 * The counter name holds the platform and nothing else, never the selector text. A call whose
 * label names no platform takes the `platform` the call site passes (a call that must stay
 * unlabeled so it does not feed the selector-health drift verdict still says whose page it reads);
 * with neither, it moves the plain `selectorFailed`.
 */
function noteSelectorFailed(label: string | undefined, platform: string | undefined): void {
  const named = platformOfLabel(label) ?? (platform && KNOWN_PLATFORMS.has(platform) ? platform : undefined);
  bumpCounter(named ? `selectorFailed.${named}` : 'selectorFailed');
}

/**
 * Query a single element using a prioritized list of selectors.
 * Returns the first match, or null if all fail.
 *
 * When `label` is provided, outcome is recorded in the selector-health
 * counter so drift is observable across sessions without any
 * console scraping.
 */
export function queryWithFallback(
  root: Element | Document,
  selectors: string[],
  label?: string,
  platform?: string,
): Element | null {
  for (let i = 0; i < selectors.length; i++) {
    try {
      const result = root.querySelector(selectors[i]);
      if (result) {
        if (label) {
          if (i > 0) {
            // demoted from warn to info. A successful fallback
            // is healthy diagnostic, not an error: the dashboard's selector-
            // health surface already shows drift via
            // recordSelectorHit, no console-warn needed. The pre-// warn level surfaced under chrome://extensions Errors and made
            // every Twitter page look like the extension was breaking — it
            // isn't, fallback works as designed. Real misses (final-selector
            // failure) still warn via recordSelectorMiss below.
            console.info(
              `[FeelingWise] ${label}: primary selector failed, using fallback #${i}: "${selectors[i]}"`,
            );
          }
          recordSelectorHit(label, i);
        }
        return result;
      }
    } catch {
      // Invalid selector — skip, and count it.
      noteSelectorFailed(label, platform);
    }
  }
  if (label) recordSelectorMiss(label);
  return null;
}

/**
 * Query all matching elements using a prioritized list of selectors.
 * Uses the FIRST selector that returns any results.
 */
export function queryAllWithFallback(
  root: Element | Document,
  selectors: string[],
  label?: string,
  platform?: string,
): Element[] {
  for (let i = 0; i < selectors.length; i++) {
    try {
      const results = root.querySelectorAll(selectors[i]);
      if (results.length > 0) {
        if (label) {
          if (i > 0) {
            // demoted from warn to info. A successful fallback
            // is healthy diagnostic, not an error: the dashboard's selector-
            // health surface already shows drift via
            // recordSelectorHit, no console-warn needed. The pre-// warn level surfaced under chrome://extensions Errors and made
            // every Twitter page look like the extension was breaking — it
            // isn't, fallback works as designed. Real misses (final-selector
            // failure) still warn via recordSelectorMiss below.
            console.info(
              `[FeelingWise] ${label}: primary selector failed, using fallback #${i}: "${selectors[i]}"`,
            );
          }
          recordSelectorHit(label, i);
        }
        return Array.from(results);
      }
    } catch {
      // Invalid selector — skip, and count it.
      noteSelectorFailed(label, platform);
    }
  }
  if (label) recordSelectorMiss(label);
  return [];
}

/**
 * Extract text content from an element, trying child selectors in order.
 * Returns the trimmed text of the first match with substantial content (>minLength chars).
 */
export function extractTextWithFallback(
  root: Element,
  selectors: string[],
  minLength = 20,
  label?: string,
  platform?: string,
): { element: HTMLElement; text: string } | null {
  for (let i = 0; i < selectors.length; i++) {
    try {
      const candidates = root.querySelectorAll<HTMLElement>(selectors[i]);
      for (const el of candidates) {
        const text = el.textContent?.trim() ?? '';
        if (text.length >= minLength) {
          if (label) {
            if (i > 0) {
              console.warn(
                `[FeelingWise] ${label}: primary text selector failed, using fallback #${i}`,
              );
            }
            recordSelectorHit(label, i);
          }
          return { element: el, text };
        }
      }
    } catch {
      // Invalid selector — skip, and count it.
      noteSelectorFailed(label, platform);
    }
  }
  if (label) recordSelectorMiss(label);
  return null;
}
