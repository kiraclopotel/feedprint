// FeelingWise - what the stored licence key turns on, as the proxy signed it.
//
// The proxy answers GET /v1/entitlements with { payload, sig }: payload is the JSON text
// { v, key_fp, features, issued_at, valid_until }, sig its Ed25519 signature (worker/src/entitlements.ts).
// This module fetches that answer, checks the signature against the public key the extension
// carries, checks it names the key in storage, and keeps it in chrome.storage.local until
// valid_until, so the settings a key covers can show while the machine is offline for up to 7 days.
//
// Until the extension carries a public key (ENTITLEMENTS_PUBLIC_KEY_JWK below is null), nothing can
// be verified, and a paid key holds the reading as it always has: every key sold so far is a
// reading key. The proxy refuses the reading to a key that does not hold it whatever this module
// says (worker/src/proxy.ts, feature_missing), so a forged cache shows rows and buys nothing.

import { getLicense, type LicenseInfo } from './license';
import { getSettings } from './settings';
import { makesNoOutsideCall } from '../types/mode';

/** The public half of the proxy's signing key, as a JWK. Null until the owner makes the pair. */
export const ENTITLEMENTS_PUBLIC_KEY_JWK: JsonWebKey | null = null;

const ENTITLEMENTS_URL = 'https://api.feelingwise.org/v1/entitlements';
export const ENTITLEMENTS_STORAGE_KEY = 'fw_entitlements';
const ENTITLEMENTS_VERSION = 1;
const FETCH_TIMEOUT_MS = 5000;
/** A paid key held before features existed: the reading. */
const LEGACY_FEATURES: readonly string[] = ['reading'];
const ALL_FEATURES = '*';

interface StoredEntitlements {
  payload: string;
  sig: string;
}

interface EntitlementsPayload {
  v: number;
  key_fp: string;
  features: string[];
  issued_at: string;
  valid_until: string;
}

/**
 * What the key turns on now.
 * - free: no paid key.
 * - legacy: a paid key, and no public key to verify with: the reading, as before features existed.
 * - signed: a verified answer for this key, still inside its valid_until.
 * - unchecked: a paid key with no verified answer in hand (never fetched, expired, or for another
 *   key). Nothing paid shows until the next fetch succeeds.
 */
export type EntitlementsState =
  | { kind: 'free'; features: [] }
  | { kind: 'legacy'; features: string[] }
  | { kind: 'signed'; features: string[]; validUntil: string }
  | { kind: 'unchecked'; features: [] };

/**
 * Whether two stored answers differ in what they turn on or which key they name. A refresh that only renews
 * issued_at and valid_until writes a new value with the same meaning, and a page must not throw away its verdicts
 * for that. The signature is not checked here: this says only whether the meaning moved, and the reading's own gate
 * still verifies before it trusts either.
 */
export function entitlementsMeaningChanged(oldValue: unknown, newValue: unknown): boolean {
  return meaningOf(oldValue) !== meaningOf(newValue);
}

function meaningOf(stored: unknown): string {
  if (stored === undefined || stored === null) return 'none';
  const payload = (stored as Partial<StoredEntitlements>).payload;
  if (typeof payload !== 'string') return 'unreadable';
  try {
    const p = JSON.parse(payload) as Partial<EntitlementsPayload>;
    const features = Array.isArray(p.features) ? [...p.features].map(String).sort() : null;
    return JSON.stringify([p.v ?? null, p.key_fp ?? null, features]);
  } catch {
    return 'unreadable';
  }
}

/** The fingerprint the proxy puts in key_fp: tier and six hex characters of the key's SHA-256. */
export async function keyFingerprint(license: LicenseInfo): Promise<string> {
  const key = `fw-${license.tier}-${license.secret}`.toLowerCase();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const hex = Array.from(new Uint8Array(digest).slice(0, 3), b => b.toString(16).padStart(2, '0')).join('');
  return `fw-${license.tier}-sha256:${hex}`;
}

function bytesFromBase64url(s: string): Uint8Array<ArrayBuffer> | null {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
    const bin = atob(b64);
    const out = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/**
 * The payload of a stored answer, if its signature verifies under `publicKey`, it names this
 * licence, and `now` is before its valid_until. Null otherwise.
 */
async function verifiedPayload(
  stored: unknown,
  license: LicenseInfo,
  publicKey: JsonWebKey,
  now: number,
): Promise<EntitlementsPayload | null> {
  if (!stored || typeof stored !== 'object') return null;
  const { payload, sig } = stored as Partial<StoredEntitlements>;
  if (typeof payload !== 'string' || typeof sig !== 'string') return null;
  const sigBytes = bytesFromBase64url(sig);
  if (!sigBytes) return null;
  let ok = false;
  try {
    const key = await crypto.subtle.importKey('jwk', publicKey, { name: 'Ed25519' }, false, ['verify']);
    ok = await crypto.subtle.verify({ name: 'Ed25519' }, key, sigBytes, new TextEncoder().encode(payload));
  } catch {
    ok = false;
  }
  if (!ok) return null;
  let parsed: EntitlementsPayload;
  try {
    parsed = JSON.parse(payload) as EntitlementsPayload;
  } catch {
    return null;
  }
  if (parsed.v !== ENTITLEMENTS_VERSION || !Array.isArray(parsed.features)) return null;
  if (parsed.key_fp !== await keyFingerprint(license)) return null;
  const until = Date.parse(parsed.valid_until);
  if (!Number.isFinite(until) || now >= until) return null;
  return { ...parsed, features: parsed.features.filter((f): f is string => typeof f === 'string') };
}

/** What the stored key turns on now, from storage alone; never calls out. */
export async function readEntitlements(
  publicKey: JsonWebKey | null = ENTITLEMENTS_PUBLIC_KEY_JWK,
  now: number = Date.now(),
): Promise<EntitlementsState> {
  return entitlementsFor(await getLicense(), publicKey, now);
}

/** What `license` turns on now, for a caller that has already read the licence. */
async function entitlementsFor(
  license: LicenseInfo,
  publicKey: JsonWebKey | null = ENTITLEMENTS_PUBLIC_KEY_JWK,
  now: number = Date.now(),
): Promise<EntitlementsState> {
  if (license.tier === 'free') return { kind: 'free', features: [] };
  if (license.tier === 'dev') return { kind: 'legacy', features: [ALL_FEATURES] };
  if (!publicKey) return { kind: 'legacy', features: [...LEGACY_FEATURES] };
  let stored: unknown;
  try {
    stored = (await chrome.storage.local.get(ENTITLEMENTS_STORAGE_KEY))[ENTITLEMENTS_STORAGE_KEY];
  } catch {
    stored = undefined;
  }
  const payload = await verifiedPayload(stored, license, publicKey, now);
  if (!payload) return { kind: 'unchecked', features: [] };
  return { kind: 'signed', features: payload.features, validUntil: payload.valid_until };
}

/** Whether the stored key turns on `feature` now ("*" covers everything). */
export async function hasFeature(
  feature: string,
  publicKey: JsonWebKey | null = ENTITLEMENTS_PUBLIC_KEY_JWK,
  now: number = Date.now(),
): Promise<boolean> {
  return holds((await readEntitlements(publicKey, now)).features, feature);
}

/** Whether `license` turns on `feature` now, for a caller that has already read the licence. */
export async function licenseHoldsFeature(
  license: LicenseInfo,
  feature: string,
  publicKey: JsonWebKey | null = ENTITLEMENTS_PUBLIC_KEY_JWK,
  now: number = Date.now(),
): Promise<boolean> {
  return holds((await entitlementsFor(license, publicKey, now)).features, feature);
}

function holds(held: readonly string[], feature: string): boolean {
  return held.includes(ALL_FEATURES) || held.includes(feature);
}

/** The feature the AI reading needs. */
export const READING_FEATURE = 'reading';

type RefreshResult = 'stored' | 'cleared' | 'kept' | 'skipped';

/**
 * Ask the proxy what the stored key turns on, and keep a verified answer. Call it when a key is
 * entered and once a day. A 401 (the key is refused) clears what was kept at once; a network
 * failure, a 503 or an answer that does not verify keeps what was kept, which lapses by itself at
 * its valid_until. Strict makes no outside call, so it asks nothing there.
 */
export async function refreshEntitlements(
  publicKey: JsonWebKey | null = ENTITLEMENTS_PUBLIC_KEY_JWK,
  now: number = Date.now(),
): Promise<RefreshResult> {
  const license = await getLicense();
  if (license.tier === 'free') {
    await chrome.storage.local.remove(ENTITLEMENTS_STORAGE_KEY);
    return 'cleared';
  }
  if (!publicKey || license.tier === 'dev') return 'skipped';
  if (makesNoOutsideCall(await getSettings())) return 'skipped';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(ENTITLEMENTS_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer fw-${license.tier}-${license.secret}` },
      signal: controller.signal,
    });
  } catch {
    return 'kept';
  } finally {
    clearTimeout(timeout);
  }
  if (resp.status === 401) {
    await chrome.storage.local.remove(ENTITLEMENTS_STORAGE_KEY);
    return 'cleared';
  }
  if (resp.status !== 200) return 'kept';
  let body: unknown;
  try {
    body = await resp.json();
  } catch {
    return 'kept';
  }
  if (!await verifiedPayload(body, license, publicKey, now)) return 'kept';
  const { payload, sig } = body as StoredEntitlements;
  await chrome.storage.local.set({ [ENTITLEMENTS_STORAGE_KEY]: { payload, sig } });
  return 'stored';
}
