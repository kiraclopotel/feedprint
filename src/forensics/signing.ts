// FeelingWise — Forensic chain-of-custody signing (per VISION §9)
//
// Generates a local ECDSA P-256 keypair on first use, persists the JWK form
// to chrome.storage.local, and signs each forensic record's integrityHash
// at write time. The public key + per-record signature accompany every
// export so an external verifier (lawyer, journalist, DV worker) can confirm
// the record wasn't fabricated or tampered with after capture.
//
// The private key never leaves the device. We intentionally use Web Crypto
// (SubtleCrypto) rather than a third-party library to stay dependency-free
// and to keep the key material inside the browser's own key store semantics.
//
// Threat model — what a signature adds:
//   • Proves any record in the export was signed by the specific keypair on
//     this install. Exporting the public key lets the verifier anchor every
//     record to that identity.
//   • Tampering with any record field breaks the integrityHash → signature
//     stops verifying → evidence is visibly damaged, not silently altered.
//
// What it does NOT do (acknowledged, deferred to V1.5):
//   • Remote timestamping (RFC 3161). A local signature cannot prove WHEN
//     it was created. An adversary on the same device could backdate. For
//     court-grade timestamping we'd hit an RFC 3161 TSA; out of V1 scope.

import { wrapPrivateKeyJwk, type WrappedKey } from './key-wrap';

const STORAGE_KEY_PRIVATE = 'fw_signing_private_jwk';
const STORAGE_KEY_PUBLIC = 'fw_signing_public_jwk';
const STORAGE_KEY_CREATED_AT = 'fw_signing_created_at';
/**
 * Why each signing key this install has held came to exist. Append-only,
 * best-effort, off the chain (capability audit 2026-09-06, P1 item 5: the
 * record never said why a key changed). A reset keeps the key; a key changes
 * only here, when storage is empty and a key is generated, or when a backup's
 * key is restored. The export reads this ledger and prints it per epoch.
 */
const STORAGE_KEY_ORIGINS = 'fw_signing_key_origins';
type SigningKeyOrigin = 'generated-storage-empty' | 'restored-from-backup';
export interface SigningKeyOriginEntry {
  fingerprint: string;
  origin: SigningKeyOrigin;
  /** Local clock at the moment the key was persisted. */
  at: string;
  /** The key this install held just before, when one was readable. */
  previousFingerprint?: string;
}

// Signature algorithm parameters. P-256 gives 64-byte raw signatures,
// base64url ≈ 86 chars — short enough to embed in a single table cell.
const KEY_ALGO: EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN_ALGO: EcdsaParams = { name: 'ECDSA', hash: { name: 'SHA-256' } };

let _privateKey: CryptoKey | null = null;
let _publicKey: CryptoKey | null = null;
// Singleton promise that serializes concurrent ensureSigningKey calls.
// Without this, parallel signHash invocations (which fire when a
// content script emits multiple FORENSIC_LOG messages back-to-back)
// could all race past the cache check, all see empty storage, and all
// call `crypto.subtle.generateKey` independently — producing N
// keypairs of which only the last persisted one survives in storage.
// Records signed with the transient keypairs would become
// unverifiable on next dashboard open. The Reset Everything flow
// clears the cache mid-session, exposing this race on every Reset →
// scroll cycle. The singleton promise eliminates it.
let _ensurePromise: Promise<void> | null = null;

// Told once each time this module makes a new key. The worker uses it to have the key dated by
// independent authorities at birth rather than at the next six-hourly alarm. It is a hook, not an
// import, because the dating module reads the key through this one.
let _keyBornListener: (() => void) | null = null;

/** Set (or clear, with null) the one listener told when a new key has been made and stored. */
export function onSigningKeyBorn(listener: (() => void) | null): void {
  _keyBornListener = listener;
}

/**
 * Read both JWKs + the creation timestamp from chrome.storage. Returns null
 * if any piece is missing — callers treat that as "not yet generated."
 */
async function readStoredKeys(): Promise<{
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
  createdAt: string;
} | null> {
  // A failed read is not the same state as a successful read of an empty
  // store. Treating both as null can generate and persist a replacement
  // keypair after a transient chrome.storage failure, making earlier records
  // unverifiable under the silently changed identity. Let access failures
  // surface so the caller can retry without mutating key continuity.
  const raw = await chrome.storage.local.get([
    STORAGE_KEY_PRIVATE, STORAGE_KEY_PUBLIC, STORAGE_KEY_CREATED_AT,
  ]);
  const priv = raw[STORAGE_KEY_PRIVATE];
  const pub = raw[STORAGE_KEY_PUBLIC];
  const createdAt = raw[STORAGE_KEY_CREATED_AT];
  const hasPrivate = priv !== undefined && priv !== null;
  const hasPublic = pub !== undefined && pub !== null;
  const hasCreatedAt = createdAt !== undefined && createdAt !== null;
  if (!hasPrivate && !hasPublic && !hasCreatedAt) return null;
  if (!hasPrivate || !hasPublic || typeof createdAt !== 'string') {
    throw new Error('Stored signing key is incomplete; refusing to replace it.');
  }
  return { privateJwk: priv, publicJwk: pub, createdAt };
}

/** Read the origin ledger. Never throws: an unreadable ledger is an empty one. */
export async function getSigningKeyOrigins(): Promise<SigningKeyOriginEntry[]> {
  try {
    const raw = await chrome.storage.local.get([STORAGE_KEY_ORIGINS]);
    const list = raw[STORAGE_KEY_ORIGINS];
    return Array.isArray(list) ? (list as SigningKeyOriginEntry[]) : [];
  } catch {
    return [];
  }
}

/** Append one entry. Never throws: a ledger write must not block signing. */
async function appendSigningKeyOrigin(entry: SigningKeyOriginEntry): Promise<void> {
  try {
    const list = await getSigningKeyOrigins();
    list.push(entry);
    await chrome.storage.local.set({ [STORAGE_KEY_ORIGINS]: list });
  } catch (err) {
    console.warn('[FW signing] key origin not recorded:', err);
  }
}

async function persistKeys(privateJwk: JsonWebKey, publicJwk: JsonWebKey): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEY_PRIVATE]: privateJwk,
    [STORAGE_KEY_PUBLIC]: publicJwk,
    [STORAGE_KEY_CREATED_AT]: new Date().toISOString(),
  });
}

/**
 * Lazily generate + persist a keypair on first use; on subsequent calls
 * reuse the imported CryptoKey objects cached in module-scope.
 *
 * Generation is idempotent across callers — a concurrent first-call double
 * race would produce two keypairs but only the first persisted one wins.
 * In practice the SW funnels all writes through a single ensure-call so
 * this is a latent concern, not a live one.
 */
export async function ensureSigningKey(): Promise<void> {
  if (_privateKey && _publicKey) return;
  // Concurrency guard: only ONE ensureSigningKey body runs at a time.
  // Subsequent callers await the in-flight promise.
  if (!_ensurePromise) {
    _ensurePromise = (async () => {
      try {
        const stored = await readStoredKeys();
        if (stored) {
          _privateKey = await crypto.subtle.importKey(
            'jwk', stored.privateJwk, KEY_ALGO, true, ['sign'],
          );
          _publicKey = await crypto.subtle.importKey(
            'jwk', stored.publicJwk, KEY_ALGO, true, ['verify'],
          );
          // Diagnostic: log fingerprint when key is established in this realm.
          // Helps correlate sign-time vs verify-time fingerprints if a
          // key-mismatch banner fires unexpectedly. Console.debug = quiet by
          // default; visible in DevTools when "Verbose" is enabled.
          try {
            const fp = await getPublicKeyFingerprint();
            console.debug(`[FW signing] Imported keypair from storage. Fingerprint: ${fp}`);
          } catch { /* fingerprint compute is diagnostic-only; never throw */ }
          return;
        }

        const keyPair = await crypto.subtle.generateKey(KEY_ALGO, true, ['sign', 'verify']);
        const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
        const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
        await persistKeys(privateJwk, publicJwk);
        _privateKey = keyPair.privateKey;
        _publicKey = keyPair.publicKey;
        await appendSigningKeyOrigin({
          fingerprint: await fingerprintPublicJwk(publicJwk),
          origin: 'generated-storage-empty',
          at: new Date().toISOString(),
        });
        // The listener goes to the network; signing never waits on it and never fails with it.
        try { _keyBornListener?.(); } catch { /* the dating retries on the next alarm */ }
        try {
          const fp = await getPublicKeyFingerprint();
          console.debug(`[FW signing] Generated NEW keypair (storage was empty). Fingerprint: ${fp}`);
        } catch { /* diagnostic-only */ }
      } finally {
        _ensurePromise = null;
      }
    })();
  }
  await _ensurePromise;
}

/**
 * Sign `hash` (hex-encoded SHA-256 string from the record's integrityHash
 * field) with the install's ECDSA private key. Returns a base64url signature
 * string. Idempotent in the sense that the same input always produces a
 * valid signature — but ECDSA uses a random k each call so the bytes differ;
 * all such signatures verify against the same public key.
 */
export async function signHash(hash: string): Promise<string> {
  await ensureSigningKey();
  if (!_privateKey) throw new Error('signing key missing after ensure');
  const data = new TextEncoder().encode(hash);
  const sigBuf = await crypto.subtle.sign(SIGN_ALGO, _privateKey, data);
  return bufferToBase64Url(sigBuf);
}

/**
 * Verify a signature — used by tests and (future) a verification helper
 * bundled with the export so recipients can self-check without external
 * tooling.
 */
export async function verifyHash(hash: string, signatureB64Url: string): Promise<boolean> {
  await ensureSigningKey();
  if (!_publicKey) return false;
  const data = new TextEncoder().encode(hash);
  const sig = base64UrlToBuffer(signatureB64Url);
  return crypto.subtle.verify(SIGN_ALGO, _publicKey, sig, data);
}

/**
 * Verify a signature under a given public JWK, not the install's own key.
 * Used by the salvage import to check a record under the key its fingerprint
 * names when that key is held (register item 12, 2026-09-06).
 */
export async function verifyHashUnderJwk(jwk: JsonWebKey, hash: string, signatureB64Url: string): Promise<boolean> {
  const pub = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const data = new TextEncoder().encode(hash);
  const sig = base64UrlToBuffer(signatureB64Url);
  return crypto.subtle.verify(SIGN_ALGO, pub, sig, data);
}

/**
 * JWK for the public key — embedded in PDF / JSON / CSV exports so a
 * verifier can reconstruct the same public key and re-verify signatures.
 */
export async function getPublicKeyJWK(): Promise<JsonWebKey> {
  await ensureSigningKey();
  if (!_publicKey) throw new Error('public key missing after ensure');
  return crypto.subtle.exportKey('jwk', _publicKey);
}

/**
 * Short human-readable fingerprint (first 16 hex chars of SHA-256 over the
 * public-key coordinates). Printed in the PDF so a recipient can eyeball
 * whether two records came from the same install without comparing full
 * JWKs. NOT a security boundary — full public-key verification is.
 */
export async function getPublicKeyFingerprint(): Promise<string> {
  const jwk = await getPublicKeyJWK();
  return fingerprintPublicJwk(jwk);
}

/**
 * The full SHA-256 over the public key's coordinates, lowercase hex.
 *
 * The fingerprint is the first 16 characters of this. The whole digest exists
 * because it is what a time-stamp authority signs at key creation
 * (src/forensics/key-genesis.ts): 32 bytes is what RFC 3161 wants, and a
 * recipient can recompute it from the public key embedded in an export and
 * check the token against it with no network and no trust in us.
 */
export async function publicKeyDigestHex(jwk: JsonWebKey): Promise<string> {
  // P-256 JWK exposes `x` and `y` as base64url-encoded coordinates.
  const material = `${jwk.x ?? ''}|${jwk.y ?? ''}`;
  const bytes = new TextEncoder().encode(material);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function fingerprintPublicJwk(jwk: JsonWebKey): Promise<string> {
  return (await publicKeyDigestHex(jwk)).slice(0, 16);
}

/**
 * ISO-8601 timestamp stamped when the keypair was first persisted. Lets the
 * PDF attestation page say "these records were signed by a key created at
 * <T>" — establishing a floor on the signature age (subject to device-clock
 * trust; court-grade timestamping is V1.5 scope).
 */
export async function getSigningKeyCreatedAt(): Promise<string | null> {
  await ensureSigningKey();
  const stored = await readStoredKeys();
  return stored?.createdAt ?? null;
}

/**
 * Clear this realm's in-memory CryptoKey cache after persisted key material is
 * deliberately restored or replaced. The next signing operation reloads the
 * new identity through `ensureSigningKey`.
 */
export function clearSigningKeyCache(): void {
  _privateKey = null;
  _publicKey = null;
  _ensurePromise = null;
}

// ─── Key continuity (Option A): wrap for backup / restore on reinstall ──────

/**
 * Derive the public-key JWK from a P-256 PRIVATE JWK. EC JWKs carry the public
 * coordinates (x, y) alongside the private scalar (d); the public key is just
 * those coordinates with `d` removed. Pure. Exported for testing.
 */
export function publicJwkFromPrivateJwk(priv: JsonWebKey): JsonWebKey {
  return { kty: priv.kty, crv: priv.crv, x: priv.x, y: priv.y, ext: true, key_ops: ['verify'] };
}

/**
 * Export the install's private signing key, encrypted under `passphrase`, for
 * inclusion in a backup (Option A). The raw private key never leaves this
 * module unencrypted. Throws if no key exists yet.
 */
export async function exportWrappedPrivateKey(passphrase: string): Promise<WrappedKey> {
  const stored = await readStoredKeys();
  if (!stored) throw new Error('No signing key to back up yet.');
  return wrapPrivateKeyJwk(stored.privateJwk, passphrase);
}

/**
 * Restore a signing key from a (decrypted) private JWK so the chain continues
 * under the original identity after a reinstall. Validates the key with a
 * sign→verify round-trip BEFORE persisting, so a corrupt/incompatible key can
 * never brick signing. Persists both JWKs (+ original createdAt when known),
 * refreshes the in-memory cache, and returns the public-key fingerprint.
 */
export interface StagedSigningKeyRestore {
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  createdAt: string;
  fingerprint: string;
}

/** Validate and import a backup key without changing persisted or cached identity. */
export async function prepareSigningKeyRestore(
  privateJwk: JsonWebKey,
  createdAt?: string,
): Promise<StagedSigningKeyRestore> {
  const priv = await crypto.subtle.importKey('jwk', privateJwk, KEY_ALGO, true, ['sign']);
  const publicJwk = publicJwkFromPrivateJwk(privateJwk);
  const pub = await crypto.subtle.importKey('jwk', publicJwk, KEY_ALGO, true, ['verify']);
  const probe = new TextEncoder().encode('fw-key-restore-probe');
  const sig = await crypto.subtle.sign(SIGN_ALGO, priv, probe);
  const ok = await crypto.subtle.verify(SIGN_ALGO, pub, sig, probe);
  if (!ok) throw new Error('Restored key failed self-verification — not importing.');

  const createdAtMs = createdAt === undefined ? NaN : Date.parse(createdAt);
  return {
    privateJwk,
    publicJwk,
    privateKey: priv,
    publicKey: pub,
    createdAt: Number.isFinite(createdAtMs)
      ? new Date(createdAtMs).toISOString()
      : new Date().toISOString(),
    fingerprint: await fingerprintPublicJwk(publicJwk),
  };
}

/** Persist a previously validated identity and switch this realm's cache. */
export async function commitSigningKeyRestore(staged: StagedSigningKeyRestore): Promise<string> {
  // The origin entry rides in the same write as the keys: a commit stays one
  // storage call, and the ledger can never say "restored" about a key that
  // was not persisted.
  let previousFingerprint: string | undefined;
  try {
    const before = await readStoredKeys();
    if (before) previousFingerprint = await fingerprintPublicJwk(before.publicJwk);
  } catch { /* an unreadable prior key is recorded as none */ }
  const origins = await getSigningKeyOrigins();
  origins.push({
    fingerprint: staged.fingerprint,
    origin: 'restored-from-backup',
    at: new Date().toISOString(),
    ...(previousFingerprint && previousFingerprint !== staged.fingerprint ? { previousFingerprint } : {}),
  });
  await chrome.storage.local.set({
    [STORAGE_KEY_PRIVATE]: staged.privateJwk,
    [STORAGE_KEY_PUBLIC]: staged.publicJwk,
    [STORAGE_KEY_CREATED_AT]: staged.createdAt,
    [STORAGE_KEY_ORIGINS]: origins,
  });
  _privateKey = staged.privateKey;
  _publicKey = staged.publicKey;
  _ensurePromise = null;
  return staged.fingerprint;
}

// ─── Base64URL helpers ───────────────────────────────────────────────────────

function bufferToBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBuffer(s: string): ArrayBuffer {
  const padding = '='.repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + padding).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  return buf.buffer;
}
