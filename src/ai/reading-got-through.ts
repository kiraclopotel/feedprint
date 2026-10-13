// A reading call got an answer that carried a reading, lately, with this key: the key is accepted and the relay is there.
//
// The header's licence chip is worked out from one zero-token call, GET /v1/models (ai/client.ts probeProxy). The relay
// answers that call from its own provider's model list, so a slow or failing list, a rate limit, or a network that drops
// a 100 KB reply leaves the chip at "not checked" while reading calls with the same key go through. The owner saw exactly
// that on his own install (13 Oct 2026): the chip said NOT CHECKED, the posts were being read. A call that got through is a
// better check of the key than the list, so the chip takes it when the list gave no answer.
//
// Kept in storage so the popup, which is a different page from the one that made the call, can read it. Bound to the key
// by its fingerprint (the same one the cap and refusal markers use), so a pasted-over key does not inherit it.

import { licenseFingerprint } from '../storage/cap-markers';

const STORAGE_KEY = 'readingGotThrough';
/** A call that got through counts as a check of the key for this long. */
const FRESH_MS = 15 * 60 * 1000;
/** The stamp is rewritten at most this often, so a feed of calls is not a feed of writes. */
const WRITE_EVERY_MS = 60 * 1000;

let lastWriteAt = 0;
let lastWriteFingerprint = '';

/** A reading call with this key came back with a reading (a 2xx answer). */
export function noteReadingGotThrough(fingerprint: string, now: number = Date.now()): void {
  if (fingerprint === lastWriteFingerprint && now - lastWriteAt < WRITE_EVERY_MS) return;
  lastWriteAt = now;
  lastWriteFingerprint = fingerprint;
  try {
    const area = typeof chrome !== 'undefined' && chrome?.storage?.local ? chrome.storage.local : null;
    if (!area) return;
    void Promise.resolve(area.set({ [STORAGE_KEY]: { fingerprint, at: now } })).catch(() => undefined);
  } catch { /* the stamp is best-effort */ }
}

/** Whether a reading call with this install's key got through in the last fifteen minutes. A free install has no key. */
export async function readingGotThroughNow(license: { tier: string; secret: string }, now: number = Date.now()): Promise<boolean> {
  if (license.tier === 'free') return false;
  try {
    const stamp = (await chrome.storage.local.get(STORAGE_KEY))?.[STORAGE_KEY] as { fingerprint?: unknown; at?: unknown } | undefined;
    return !!stamp && stamp.fingerprint === licenseFingerprint(license.tier, license.secret)
      && typeof stamp.at === 'number' && now - stamp.at <= FRESH_MS && stamp.at <= now + 60_000;
  } catch {
    return false;
  }
}
