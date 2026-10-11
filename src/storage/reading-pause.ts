// The relay said "the reading has not been started from the extension yet" (403 consent_required): the person never gave
// the go-ahead the relay now asks for with every key (from 12 Oct 2026 00:00 UTC no key is let through without it).
//
// Until now that answer was read as "our request was refused", the reading stopped, and nothing on screen said so: every
// post stayed as written, with no dot, while the popup showed the licence as fine. This marker is what makes it visible and
// stops the asking:
//   - while it holds, the key sends nothing for a few minutes (each post's words stay on the device; asking again only
//     meets the same answer), then one call tries again;
//   - the dashboard's Issues tab reads it and says what to do (open the popup and start the reading), and the toolbar icon
//     shows a "!" while it stands;
//   - it is cleared the moment the person gives the go-ahead (recordReadingConsent), when the key changes (setLicense and
//     clearLicense), and by the first reading the relay answers (the relay may have been told by another page).
//
// Kept in storage so every page and the service worker honour it; bound to the key that was refused (its fingerprint).

/** Storage key. Value: { fingerprint, code, at } with `at` in epoch milliseconds. */
export const READING_PAUSED_STORAGE_KEY = 'readingPaused';

/** How long the key sends nothing after the relay asks for the go-ahead; then one call tries again. */
export const READING_PAUSE_MS = 10 * 60 * 1000;

export interface ReadingPauseMarker {
  fingerprint: string;
  code: 'consent_required';
  at: number;
}

let latch: ReadingPauseMarker | null = null;
let hydrating: Promise<void> | null = null;

function isMarker(value: unknown): value is ReadingPauseMarker {
  const v = value as Partial<ReadingPauseMarker> | null | undefined;
  return !!v && typeof v.fingerprint === 'string' && v.code === 'consent_required' && typeof v.at === 'number';
}

function storageArea(): chrome.storage.LocalStorageArea | null {
  try {
    return typeof chrome !== 'undefined' && chrome?.storage?.local ? chrome.storage.local : null;
  } catch {
    return null;
  }
}

function hydrate(): Promise<void> {
  hydrating ??= readMarker();
  return hydrating;
}

async function readMarker(): Promise<void> {
  const area = storageArea();
  if (!area) return;
  try {
    chrome.storage.onChanged?.addListener((changes, areaName) => {
      if (areaName !== 'local' || !(READING_PAUSED_STORAGE_KEY in changes)) return;
      const next = changes[READING_PAUSED_STORAGE_KEY]?.newValue;
      latch = isMarker(next) ? next : null;
    });
  } catch { /* no change events here: the marker read below still holds */ }
  try {
    const stored = await area.get(READING_PAUSED_STORAGE_KEY);
    const marker = stored?.[READING_PAUSED_STORAGE_KEY];
    // A pause noted in this realm while the read was in flight is newer than what storage held.
    if (latch === null && isMarker(marker)) latch = marker;
  } catch { /* the marker is best-effort */ }
}

/** Note that the relay asked this key for the go-ahead. */
export function noteReadingPaused(fingerprint: string, now: number = Date.now()): void {
  latch = { fingerprint, code: 'consent_required', at: now };
  const area = storageArea();
  if (!area) return;
  try {
    void Promise.resolve(area.set({ [READING_PAUSED_STORAGE_KEY]: latch })).catch(() => undefined);
  } catch { /* the marker is best-effort */ }
  console.warn('[FeelingWise] the relay asked for the reading go-ahead (consent_required); the reading is paused until it is given');
}

/** True while the pause of this key still holds: the caller sends nothing with it. */
export async function readingPauseHolds(fingerprint: string, now: number = Date.now()): Promise<boolean> {
  await hydrate();
  if (!latch || latch.fingerprint !== fingerprint) return false;
  return now >= latch.at && now - latch.at < READING_PAUSE_MS;
}

/** Drop the marker everywhere: the go-ahead was given, the key changed, or the relay answered a reading. */
export async function clearReadingPause(): Promise<void> {
  await hydrate();
  if (latch === null) return;
  latch = null;
  const area = storageArea();
  if (!area) return;
  try {
    await area.remove(READING_PAUSED_STORAGE_KEY);
  } catch { /* the marker is best-effort */ }
}

/** Drop this realm's copy only; setLicense and clearLicense remove the stored marker with the other markers. */
export function forgetReadingPause(): void {
  latch = null;
}
