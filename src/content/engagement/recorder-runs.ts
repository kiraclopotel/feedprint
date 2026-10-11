// What the recorder runs on a page, read by Off so the two never run the same switch twice.
//
// Both extensions carry the same engagement code with the same style-tag ids and markers, and two
// copies of one module on a page undo each other's hides. So each switch has one owner on a page both
// run: Feedprint stamps the root element with the families it runs, and Off leaves exactly those to it
// and keeps running the rest. A recorder whose stamp names no family runs every switch (Feedprint up to
// 2.5.17), and beside it Off stands down whole, as it always did.
//
// Feedprint names a family only where its own settings act on it and its reader covers every surface Off's
// does, so a switch that is on in either product is acted on, and by Feedprint whenever it can (the item is
// then also recorded). Off's own list is never named: it holds words only Off knows.

import { isFeatureEnabled, type FWSettings } from '../../storage/settings';
import { isContextAlive, markContextInvalidated, onContextInvalidated } from '../../storage/context-guard';
import type { Platform } from '../../types/post';

/**
 * The families of switches the recorder can run in place of Off. 'words' is every word rule at once,
 * as Feedprint 2.5.18 wrote it; later stamps name 'slurs' and 'swearing' one by one.
 */
export type RecorderFamily = 'ads' | 'words' | 'slurs' | 'swearing';

/** Set by the recorder before its stamp, so whoever sees the stamp also sees this. */
export const RECORDER_RUNS_ATTR = 'data-fw-recorder-runs';
const RECORDER_STAMP_ATTR = 'data-fw-recorder';

/** What Feedprint 2.5.18 runs whatever its settings: the ads, and the language and own rules in its pipeline. */
export const RECEIPTS_RUNS: readonly RecorderFamily[] = ['ads', 'words'];

const FAMILIES: readonly RecorderFamily[] = ['ads', 'words', 'slurs', 'swearing'];

/**
 * null when no recorder is on the page; 'all' when one is and names nothing (it runs every switch);
 * otherwise the families it runs.
 */
export function recorderRuns(root: Element = document.documentElement): ReadonlySet<RecorderFamily> | 'all' | null {
  if (!root.hasAttribute(RECORDER_STAMP_ATTR)) return null;
  const named = root.getAttribute(RECORDER_RUNS_ATTR);
  if (named === null) return 'all';
  return new Set(named.split(/\s+/).filter((w): w is RecorderFamily => (FAMILIES as readonly string[]).includes(w)));
}

/**
 * The families Feedprint takes over from Off on this site: the ads where its Block ads is on. Swearing and
 * slurs stay with Off. Feedprint stars comments only when its paid reading of them succeeds (comment-batch/flush.ts),
 * and its readers skip YouTube's search, sidebar and grid tiles (content/platforms/youtube.ts) and Facebook bodies
 * under 12 characters (content/platforms/facebook.ts), so leaving either to it would let some through. A post
 * both hide carries both hides, and Off's reset never undoes Feedprint's (engagement/controller.ts).
 */
export function receiptsRunsOn(settings: FWSettings, platform: Platform): RecorderFamily[] {
  return isFeatureEnabled(settings, 'block-ads', platform) ? ['ads'] : [];
}

const STAMP_KEYS = ['features', 'strictLanguage', 'mode'];

/** The listener of the last stamp: Feedprint's init runs again on the same page, and one listener is enough. */
let stopLastStamp: (() => void) | null = null;
/** What takes the last stamp off the page when Feedprint goes away; one invalidation listener serves every stamp. */
let clearLastStamp: (() => void) | null = null;
let clearArmed = false;
/** Feedprint's engagement filters, stopped with the stamp: left running, they and Off would both act on the same ad. */
let engagementStop: (() => void) | null = null;
/** Set once Feedprint has gone: the filters start after an await, so their stop can arrive after the end. */
let receiptsGone = false;

/**
 * Hands the stamp the stop of Feedprint's engagement filters, run when Feedprint goes away under the open tab, or at
 * once when it already has. Returns the release, for a stop that ran the normal way: it only keeps that stop from
 * running a second time when Feedprint goes later. It leaves the stamp, so Off still leaves the ads to Feedprint; Off
 * takes them back only when the stamp stops naming them: it leaves with Feedprint, or Feedprint's Block ads is off. Feedprint's own start
 * (content/index.ts) keeps no stop today, so only a caller that stops the filters and starts them again needs this.
 */
export function stopWhenFeedprintGoes(stop: () => void): () => void {
  if (receiptsGone) {
    try { stop(); } catch { /* the extension is already gone; what is left of the filters stays still */ }
    return () => {};
  }
  engagementStop = stop;
  return () => { if (engagementStop === stop) engagementStop = null; };
}

/**
 * How often the stamp checks that Feedprint is still there. Feedprint notices it is gone on its next call to
 * the extension, which on a quiet page may never come; until then Off leaves the ads to nobody.
 */
const ALIVE_CHECK_MS = 3000;
function receiptsStillThere(): boolean {
  try {
    return typeof chrome !== 'undefined' && typeof chrome.runtime?.id === 'string';
  } catch {
    return false;
  }
}

/**
 * Feedprint's stamp, kept true: what it runs is written before the stamp itself, and written again when
 * its settings change, so Off takes back a switch Feedprint turned off. When Feedprint is updated or
 * switched off under an open tab, its script here stops working but the page keeps the stamp; so the
 * stamp goes when Feedprint notices, on its next call to the extension or the check every few seconds,
 * and Off takes back what it had left to Feedprint. Returns the stop.
 */
export function keepRecorderStamp(
  platform: Platform,
  settings: FWSettings,
  readSettings: () => Promise<FWSettings>,
  version: string,
  root: Element = document.documentElement,
): () => void {
  const write = (s: FWSettings) => root.setAttribute(RECORDER_RUNS_ATTR, receiptsRunsOn(s, platform).join(' '));
  write(settings);
  root.setAttribute(RECORDER_STAMP_ATTR, version);
  const onChanged = (changes: Record<string, unknown>, area?: string): void => {
    if (area !== undefined && area !== 'local') return;
    if (!STAMP_KEYS.some((k) => k in changes)) return;
    readSettings().then(write).catch(() => { /* the stamp stays as it was */ });
  };
  stopLastStamp?.();
  // A script whose extension was reloaded under the tab has no storage events left; the stamp is still written once.
  if (isContextAlive()) chrome.storage.onChanged.addListener(onChanged);
  // Only an id that was there can go away; a page with no extension id to begin with has nothing to watch.
  const aliveCheck = receiptsStillThere()
    ? setInterval(() => { if (!receiptsStillThere()) markContextInvalidated(); }, ALIVE_CHECK_MS)
    : undefined;
  const stop = () => {
    if (aliveCheck !== undefined) clearInterval(aliveCheck);
    try { chrome.storage.onChanged.removeListener(onChanged); } catch { /* the extension is already gone */ }
    if (stopLastStamp === stop) stopLastStamp = null;
    if (clearLastStamp === clear) clearLastStamp = null;
  };
  // The stamp first: a list without a stamp means no recorder, while a stamp without a list would
  // tell Off the recorder runs everything.
  const clear = () => {
    stop();
    root.removeAttribute(RECORDER_STAMP_ATTR);
    root.removeAttribute(RECORDER_RUNS_ATTR);
    const filters = engagementStop;
    engagementStop = null;
    try { filters?.(); } catch { /* the extension is already gone; what is left of the filters stays still */ }
  };
  stopLastStamp = stop;
  clearLastStamp = clear;
  if (receiptsGone) {
    // A stamp written after the end has nothing left to keep it true.
    clear();
  } else if (!clearArmed) {
    clearArmed = true;
    onContextInvalidated(() => {
      receiptsGone = true;
      clearLastStamp?.();
    });
  }
  return stop;
}

/** Calls `onChange` each time the recorder rewrites what it runs; returns the stop. */
export function watchRecorderRuns(onChange: () => void, root: Element = document.documentElement): () => void {
  let last = root.getAttribute(RECORDER_RUNS_ATTR);
  const observer = new MutationObserver(() => {
    const now = root.getAttribute(RECORDER_RUNS_ATTR);
    if (now === last) return;
    last = now;
    onChange();
  });
  observer.observe(root, { attributes: true, attributeFilter: [RECORDER_RUNS_ATTR] });
  return () => observer.disconnect();
}
