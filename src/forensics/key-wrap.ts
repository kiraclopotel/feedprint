// FeelingWise — passphrase-wrapping of the forensic signing key (Option A).
//
// To let a parent keep ONE continuous forensic chain across an uninstall +
// reinstall, the backup can optionally carry the ECDSA private signing key —
// but never in the clear. This module encrypts the private-key JWK under a
// parent-chosen passphrase (PBKDF2-HMAC-SHA256 → AES-256-GCM) and decrypts it
// back. AES-GCM is authenticated, so a wrong passphrase or a tampered blob
// fails to decrypt rather than yielding garbage.
//
// Threat note: the live signing key already sits as plaintext JWK in
// chrome.storage.local (signing.ts), so a passphrase-wrapped backup is STRICTLY
// more protected at rest than the key already is on the device. The passphrase
// is never stored — losing it means the wrapped key can't be recovered (the
// records in the same backup still verify against the public key either way).
//
// PURE: only Web Crypto. No DOM, no storage. Unit-testable round-trip.

export const PBKDF2_ITERATIONS = 310_000; // OWASP-recommended floor for PBKDF2-HMAC-SHA256

/**
 * The iteration counts a backup file is allowed to ask for.
 *
 * The count travels IN the file and went straight into crypto.subtle.deriveKey
 * with no check. A backup naming 10^12 iterations does not fail — it runs, on
 * the main thread of whatever opened it, and the extension stops responding.
 * A person restoring a backup someone sent them is exactly the person who
 * cannot tell that apart from a crash.
 *
 * The ceiling is what a slow machine can still finish in a few seconds; the
 * floor is low enough that no backup this product has ever written is refused
 * (it has only ever written PBKDF2_ITERATIONS) while still rejecting a file
 * that asks for a trivially weak derivation.
 */
export const PBKDF2_MIN_ITERATIONS = 10_000;
export const PBKDF2_MAX_ITERATIONS = 5_000_000;

/** The count a wrapped key may use, or a refusal naming what was asked for. */
export function checkedIterations(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < PBKDF2_MIN_ITERATIONS || value > PBKDF2_MAX_ITERATIONS) {
    throw new Error(
      `Unsupported key-backup format: iteration count ${String(value)} is outside `
      + `${PBKDF2_MIN_ITERATIONS}-${PBKDF2_MAX_ITERATIONS}.`,
    );
  }
  return value;
}
const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface WrappedKey {
  /** Format version, so a future change can refuse/migrate rather than mis-decrypt. */
  v: 1;
  kdf: 'PBKDF2';
  hash: 'SHA-256';
  iterations: number;
  /** base64 PBKDF2 salt. */
  salt: string;
  /** base64 AES-GCM IV. */
  iv: string;
  /** base64 AES-GCM ciphertext of the UTF-8 JSON private-key JWK. */
  ciphertext: string;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// Exported 2026-08-04 (G1): backup-envelope.ts seals the WHOLE backup payload
// under the same derivation, so the KDF contract (PBKDF2-HMAC-SHA256 → AES-256
// -GCM) lives in exactly one place. Tuning iterations here tunes both.
export async function deriveAesKey(passphrase: string, salt: BufferSource, iterations: number): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * The floor on every passphrase that seals a key or a backup (evidence-gap
 * audit rank 5, stopgap B): eight characters. Enforced here, the one choke
 * point, and mirrored by the Export tab so the reader sees the rule before
 * the refusal.
 */
export const PASSPHRASE_MIN_LENGTH = 8;

/** Encrypt a private-key JWK under a passphrase. Throws on an empty or too-short passphrase. */
export async function wrapPrivateKeyJwk(jwk: JsonWebKey, passphrase: string): Promise<WrappedKey> {
  if (!passphrase) throw new Error('A passphrase is required to protect the key.');
  if (passphrase.length < PASSPHRASE_MIN_LENGTH) throw new Error(`The passphrase must be at least ${PASSPHRASE_MIN_LENGTH} characters.`);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveAesKey(passphrase, salt, PBKDF2_ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify(jwk));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    v: 1,
    kdf: 'PBKDF2',
    hash: 'SHA-256',
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ct)),
  };
}

/**
 * Decrypt a wrapped private-key JWK. Throws "Wrong passphrase or corrupted
 * backup." on any authentication/parse failure (AES-GCM rejects a wrong key or
 * tampered ciphertext) — never returns garbage.
 */
export async function unwrapPrivateKeyJwk(wrapped: WrappedKey, passphrase: string): Promise<JsonWebKey> {
  if (!wrapped || wrapped.v !== 1) throw new Error('Unsupported key-backup format.');
  const salt = fromBase64(wrapped.salt);
  const iv = fromBase64(wrapped.iv);
  const ct = fromBase64(wrapped.ciphertext);
  const key = await deriveAesKey(passphrase, salt, checkedIterations(wrapped.iterations));
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  } catch {
    throw new Error('Wrong passphrase or corrupted backup.');
  }
  try {
    return JSON.parse(new TextDecoder().decode(plaintext)) as JsonWebKey;
  } catch {
    throw new Error('Wrong passphrase or corrupted backup.');
  }
}

/**
 * Wrap an opaque secret STRING under a passphrase, using the same derivation
 * as the private-key path.
 *
 * Added for backup-key escrow. The automatic backup is sealed under a
 * per-install device secret, which is the right default (the child's verbatim
 * feed history must not sit in Downloads as plaintext) and is also the reason
 * `_unopenable-pre-reinstall/` exists: the device secret dies with the profile,
 * so every automatic backup taken before a reinstall becomes permanently
 * unreadable — including the ones taken to survive exactly that event.
 *
 * Escrowing the device secret under a passphrase the parent knows breaks that
 * without weakening the default. The passphrase is never stored; only this
 * wrapped form is, and it rides inside the backup file so the file carries its
 * own means of recovery.
 */
export async function wrapSecretString(secret: string, passphrase: string): Promise<WrappedKey> {
  if (!passphrase) throw new Error('A passphrase is required to protect the key.');
  if (passphrase.length < PASSPHRASE_MIN_LENGTH) throw new Error(`The passphrase must be at least ${PASSPHRASE_MIN_LENGTH} characters.`);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveAesKey(passphrase, salt, PBKDF2_ITERATIONS);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(secret),
  );
  return {
    v: 1,
    kdf: 'PBKDF2',
    hash: 'SHA-256',
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ct)),
  };
}

/**
 * Recover a secret string wrapped by `wrapSecretString`. Throws on a wrong
 * passphrase or tampered ciphertext rather than returning anything, matching
 * `unwrapPrivateKeyJwk`: AES-GCM authenticates, so a wrong key is a rejection,
 * never plausible garbage.
 */
export async function unwrapSecretString(wrapped: WrappedKey, passphrase: string): Promise<string> {
  if (!wrapped || wrapped.v !== 1) throw new Error('Unsupported key-backup format.');
  const key = await deriveAesKey(passphrase, fromBase64(wrapped.salt), checkedIterations(wrapped.iterations));
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(wrapped.iv) },
      key,
      fromBase64(wrapped.ciphertext),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error('Wrong passphrase or corrupted backup.');
  }
}
