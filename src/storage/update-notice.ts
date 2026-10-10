// The one line after an update: "Updated to 2.5.10: what changed" (PLAN-2026-09-17 item 8a,
// his ask of 17 Sep 2026).
//
// What it is: after the store installs a new version, the next open of the popup shows one line
// linking to feelingwise.org/updates, and the line stays until it is opened or dismissed once.
// Nothing opens on its own: no tab, no window, no system notification. Both products show it;
// Off has no service worker, so the popup itself is what notices the version, by comparing the
// manifest's version with the version this profile last acknowledged.
//
// The two edges that decide it:
//
//   • A fresh install is not an update. Nothing is stored yet, so the first open writes the
//     version it was born with and shows nothing.
//   • The version key does not exist before 2.5.10 and Off 1.0.6, so a profile that ran an older
//     build has no stored version either. It is told apart from a fresh install by the settings
//     it already wrote (the recorder's setup, or a mode picked in Off). That profile sees the line
//     on its first open after the update, which is the case the line was built for.
//
// The key is its own, apart from every settings key, so the settings migrations never touch it.

import { sitePageUrl } from '../core/site-links';

/** The version this profile last acknowledged, as the manifest prints it ("2.5.10"). */
export const SEEN_VERSION_KEY = 'fw_seen_version';

export interface UpdateNoticeState {
  /** True when the line is to be shown. */
  show: boolean;
  /** The running version, for the line's text and the page anchor. Empty when unknown. */
  version: string;
}

/**
 * The decision, pure so a test can hold every case.
 *
 * @param current   the manifest's version; empty when it cannot be read
 * @param seen      the stored acknowledged version; undefined when none is stored
 * @param ranBefore true when this profile holds settings written by an earlier open
 */
export function decideUpdateNotice(
  current: string,
  seen: string | undefined,
  ranBefore: boolean,
): 'show' | 'none' | 'fresh' {
  if (!current) return 'none';
  if (seen === current) return 'none';
  if (seen === undefined && !ranBefore) return 'fresh';
  return 'show';
}

/** The manifest's version, or empty when there is no runtime to ask. */
function runningVersion(): string {
  try {
    return String(chrome?.runtime?.getManifest?.()?.version ?? '');
  } catch {
    return '';
  }
}

/**
 * The keys whose presence says an earlier open wrote settings on this profile. The recorder's
 * setup writes `setupDone` and `parentPin`; Off writes `mode`, `features` and `presets` on the
 * first switch or mode touched. None is written by a plain read on a fresh install
 * (storage/settings.ts getSettings persists only what a migration changed, and a fresh profile
 * has nothing to migrate).
 */
const RAN_BEFORE_KEYS = ['setupDone', 'parentPin', 'mode', 'features', 'presets'] as const;

/**
 * Read the state for this open. A fresh install is stamped with the running version here, so it
 * never sees a line for the version it was installed with.
 */
export async function readUpdateNotice(): Promise<UpdateNoticeState> {
  const version = runningVersion();
  if (!version) return { show: false, version };
  let stored: Record<string, unknown>;
  try {
    stored = await chrome.storage.local.get([SEEN_VERSION_KEY, ...RAN_BEFORE_KEYS]);
  } catch {
    return { show: false, version };
  }
  const seenRaw = stored[SEEN_VERSION_KEY];
  const seen = typeof seenRaw === 'string' ? seenRaw : undefined;
  const ranBefore = RAN_BEFORE_KEYS.some((k) => stored[k] !== undefined && stored[k] !== null && stored[k] !== false && stored[k] !== '');
  const decision = decideUpdateNotice(version, seen, ranBefore);
  if (decision === 'fresh') {
    try {
      await chrome.storage.local.set({ [SEEN_VERSION_KEY]: version });
    } catch {
      // A failed stamp costs one line on the next open, nothing else.
    }
  }
  return { show: decision === 'show', version };
}

/** The line was opened or dismissed: the running version is acknowledged and the line is gone. */
export async function acknowledgeUpdate(version: string): Promise<void> {
  if (!version) return;
  try {
    await chrome.storage.local.set({ [SEEN_VERSION_KEY]: version });
  } catch {
    // Same as above: the line comes back once, it never blocks the popup.
  }
}

/**
 * The Updates page for the interface language, at the band for this version. The site has an
 * English and a Romanian page; Spanish and Portuguese readers get the English one, which is
 * what the rest of the popup's links do.
 */
export function updatesPageUrl(lang: string, version: string): string {
  const anchor = version ? `#v${version.replace(/[^0-9A-Za-z]+/g, '-')}` : '';
  return sitePageUrl(lang, 'updates', anchor);
}
