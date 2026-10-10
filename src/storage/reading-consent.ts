// The person's request to start the paid reading now, one per licence key.
//
// Each reading is paid to the provider as it runs, so starting it ends the 14-day refund right for
// the period paid. That needs a fact, not a guess: the screen's text version, the hash of the words
// the person saw, and the time, kept here and sent with every paid call so the proxy can store the
// first one it sees (worker/src/proxy.ts consentGate).

import { sha256 } from '../forensics/hasher';
import type { LicenseInfo } from './license';

/** Moves whenever the screen's words change, so a stored consent names the text it was given to. */
export const READING_CONSENT_TEXT_VERSION = 'reading-consent-2';

const STORAGE_KEY = 'readingConsent';

export interface ReadingConsent {
  textVersion: string;
  /** SHA-256 of the words shown, in the language they were shown in. */
  textHash: string;
  /** ISO 8601, when the button was pressed. */
  at: string;
  /** The company's name as the screen showed it, as the proxy served it. */
  provider: string;
}

/** The credential the proxy sees, as client.ts builds it. */
export function bearerOf(license: LicenseInfo): string {
  return `fw-${license.tier}-${license.secret}`;
}

// Stored under a digest of the key, never the key itself: the key already lives in its own slot and
// a second plaintext copy would outlive a removal of the licence.
async function slotFor(bearer: string): Promise<string> {
  return (await sha256(bearer)).slice(0, 32);
}

async function readAll(): Promise<Record<string, ReadingConsent>> {
  try {
    const got = await chrome.storage.local.get(STORAGE_KEY);
    const all = got[STORAGE_KEY];
    return all && typeof all === 'object' ? (all as Record<string, ReadingConsent>) : {};
  } catch {
    return {};
  }
}

export async function getReadingConsent(bearer: string): Promise<ReadingConsent | null> {
  const all = await readAll();
  // Every paid call asks, and most installs hold no consent at all: no digest is worth computing then.
  if (Object.keys(all).length === 0) return null;
  return all[await slotFor(bearer)] ?? null;
}

export async function recordReadingConsent(bearer: string, shownText: string, provider: string, now = new Date()): Promise<ReadingConsent> {
  const consent: ReadingConsent = {
    textVersion: READING_CONSENT_TEXT_VERSION,
    textHash: await sha256(shownText),
    at: now.toISOString(),
    provider,
  };
  const all = await readAll();
  all[await slotFor(bearer)] = consent;
  await chrome.storage.local.set({ [STORAGE_KEY]: all });
  return consent;
}

/** The header value the proxy reads; its four fields and nothing else. */
export function consentHeaderValue(c: ReadingConsent): string {
  return JSON.stringify({ v: c.textVersion, h: c.textHash, at: c.at, p: c.provider });
}

export const READING_CONSENT_HEADER = 'X-FW-Consent';
