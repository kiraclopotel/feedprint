// A key the proxy has refused sends nothing more for a while, so a post's words do not leave the
// device only to be refused after a subscription has ended.
//
// The key itself is never deleted here. A refusal can be a mistake that is put right on the server,
// so the pause ends by itself; pasting a key again (the same one renewed, or another) clears it at
// once through setLicense and clearLicense, which remove this marker with the cap markers.
//
// Only the proxy's own licence codes start a pause. A bare 401 with no code can come from anything
// on the way and pauses nothing. "Not found" and "bad format" pause briefly, because a key minted a
// moment ago can be missing from the proxy's store for a short while; revoked, expired and a tier
// that does not match pause for hours.
//
// The marker is bound to the key that was refused (its fingerprint), kept in storage so every page
// and the service worker honour it, and watched for changes so a cleared marker frees every realm.

/** Storage key. Value: { fingerprint, code, at } with `at` in epoch milliseconds. */
export const LICENSE_REFUSED_STORAGE_KEY = 'licenseRefused';

const LONG_PAUSE_MS = 6 * 60 * 60 * 1000;
const SHORT_PAUSE_MS = 15 * 60 * 1000;

/** The proxy's licence codes that start a pause, with how long it lasts. */
const PAUSE_BY_CODE: Readonly<Record<string, number>> = {
  license_revoked: LONG_PAUSE_MS,
  license_expired: LONG_PAUSE_MS,
  tier_mismatch: LONG_PAUSE_MS,
  license_not_found: SHORT_PAUSE_MS,
  invalid_license_format: SHORT_PAUSE_MS,
};

interface RefusalMarker {
  fingerprint: string;
  code: string;
  at: number;
}

let latch: RefusalMarker | null = null;
// Every caller waits on the one read: a burst of calls right after the service worker wakes must not
// slip past a pause that is still being read from storage.
let hydrating: Promise<void> | null = null;

function isMarker(value: unknown): value is RefusalMarker {
  const v = value as Partial<RefusalMarker> | null | undefined;
  return !!v && typeof v.fingerprint === 'string' && typeof v.code === 'string' && typeof v.at === 'number';
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
      if (areaName !== 'local' || !(LICENSE_REFUSED_STORAGE_KEY in changes)) return;
      const next = changes[LICENSE_REFUSED_STORAGE_KEY]?.newValue;
      latch = isMarker(next) ? next : null;
    });
  } catch { /* no change events here: the marker read below still holds */ }
  try {
    const stored = await area.get(LICENSE_REFUSED_STORAGE_KEY);
    const marker = stored?.[LICENSE_REFUSED_STORAGE_KEY];
    // A refusal noted in this realm while the read was in flight is newer than what storage held.
    if (latch === null && isMarker(marker)) latch = marker;
  } catch { /* the marker is best-effort */ }
}

/** True when the proxy's licence code is one that pauses the key. */
export function isPausingLicenseCode(code: string | undefined): boolean {
  return code !== undefined && Object.prototype.hasOwnProperty.call(PAUSE_BY_CODE, code);
}

/** Note that the proxy refused this key with this code. A code that does not pause is ignored. */
export function noteLicenseRefused(fingerprint: string, code: string, now: number = Date.now()): void {
  if (!isPausingLicenseCode(code)) return;
  latch = { fingerprint, code, at: now };
  const area = storageArea();
  if (!area) return;
  try {
    void Promise.resolve(area.set({ [LICENSE_REFUSED_STORAGE_KEY]: latch })).catch(() => undefined);
  } catch { /* the marker is best-effort */ }
  console.warn(`[FeelingWise] the proxy refused this key (${code}); nothing more is sent with it for a while`);
}

/** Drop this realm's pause; setLicense and clearLicense call it as they remove the stored marker. */
export function forgetLicenseRefusal(): void {
  latch = null;
}

/** True while a refusal of this key still holds: the caller sends nothing with it. */
export async function licenseRefusalHolds(fingerprint: string, now: number = Date.now()): Promise<boolean> {
  await hydrate();
  if (!latch || latch.fingerprint !== fingerprint) return false;
  const pause = PAUSE_BY_CODE[latch.code] ?? 0;
  if (now - latch.at < pause && now >= latch.at) return true;
  latch = null; // the pause ran out (or the clock went back): try the key again
  return false;
}
