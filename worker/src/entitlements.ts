// FeelingWise - what a key turns on, signed so the extension can trust a cached copy offline.
//
// A key record may carry `features`: names like "reading" (the AI reading) or, later, "sites:<name>".
// A record without the field is a reading key: every key sold so far was sold for the reading, so no
// stored record needs a migration. The dev tier holds every feature, written "*".
//
// The answer is { payload, sig }: `payload` is the JSON text the extension parses, `sig` the Ed25519
// signature over exactly those bytes, base64url. Signing the text rather than a re-serialised object
// means the two sides never have to agree on key order. The private key is the worker secret
// ENTITLEMENTS_SIGNING_KEY (a JWK); the extension carries the public half. Without the secret, or
// with one that does not import, the route answers 503 rather than an unsigned list.

export const ENTITLEMENTS_VERSION = 1;
/** How long a signed answer stays good on a machine that cannot reach the proxy. */
export const ENTITLEMENTS_VALID_MS = 7 * 24 * 60 * 60 * 1000;
/** What a record without a feature list holds. */
export const LEGACY_FEATURES: readonly string[] = ['reading'];
export const ALL_FEATURES = '*';

const FEATURE_NAME = /^[a-z][a-z0-9:_-]{0,63}$/;

export interface EntitlementsPayload {
  v: number;
  key_fp: string;
  features: string[];
  issued_at: string;
  valid_until: string;
}

/** The feature names in a list, in order, once each; anything else is dropped. */
function cleanFeatures(list: unknown[]): string[] {
  const out: string[] = [];
  for (const f of list) {
    if (typeof f === 'string' && FEATURE_NAME.test(f) && !out.includes(f)) out.push(f);
  }
  return out;
}

/** The features a key holds, from its tier and its stored list. Unreadable entries are dropped. */
export function featuresOf(tier: string, stored: unknown): string[] {
  if (tier === 'dev') return [ALL_FEATURES];
  if (!Array.isArray(stored)) return [...LEGACY_FEATURES];
  return cleanFeatures(stored);
}

/**
 * The features a shop variant sells, from PLAN_FEATURES (JSON: variant id -> feature list).
 * `null` when the event names no variant, so a caller can tell "no plan named" from "a plan with
 * the default list". An unmapped variant or an unreadable map gives ["reading"]: every product sold
 * so far is the reading, and a purchase must never fail on the map.
 */
export function featuresForVariant(planFeatures: string | undefined, variantId: unknown): string[] | null {
  if (variantId === undefined || variantId === null || variantId === '') return null;
  let map: unknown = null;
  try { map = planFeatures ? JSON.parse(planFeatures) : null; } catch { map = null; }
  const listed = map && typeof map === 'object' ? (map as Record<string, unknown>)[String(variantId)] : undefined;
  if (!Array.isArray(listed)) return [...LEGACY_FEATURES];
  return cleanFeatures(listed);
}

/** Whether a list of held features covers `name`; "*" covers everything. */
export function holdsFeature(held: readonly string[], name: string): boolean {
  return held.includes(ALL_FEATURES) || held.includes(name);
}

/** The feature a paid AI call needs. */
export const READING_FEATURE = 'reading';

export function entitlementsPayload(keyFp: string, features: string[], now: number): EntitlementsPayload {
  return {
    v: ENTITLEMENTS_VERSION,
    key_fp: keyFp,
    features,
    issued_at: new Date(now).toISOString(),
    valid_until: new Date(now + ENTITLEMENTS_VALID_MS).toISOString(),
  };
}

let cachedKey: { source: string; key: CryptoKey } | null = null;

async function signingKey(secret: string | undefined): Promise<CryptoKey | null> {
  if (!secret) return null;
  if (cachedKey && cachedKey.source === secret) return cachedKey.key;
  try {
    const jwk = JSON.parse(secret) as JsonWebKey;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['sign']);
    cachedKey = { source: secret, key };
    return key;
  } catch {
    return null;
  }
}

function base64url(bytes: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The signed answer, or null when the secret is missing or does not import. */
export async function signEntitlements(
  payload: EntitlementsPayload,
  secret: string | undefined,
): Promise<{ payload: string; sig: string } | null> {
  const key = await signingKey(secret);
  if (!key) return null;
  const text = JSON.stringify(payload);
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(text));
  return { payload: text, sig: base64url(sig) };
}
