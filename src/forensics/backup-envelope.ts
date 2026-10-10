// FeelingWise — sealed (encrypted) envelope for the WHOLE backup payload.
//
// Defect G1, closed 2026-08-04: the daily auto-backup wrote the child's entire
// feed history (verbatim posts/comments, URLs, transcripts, metrics) as
// PLAINTEXT JSON into Downloads — world-readable locally and frequently
// cloud-synced (OneDrive on Windows). Only the private signing key was
// passphrase-protected (key-wrap.ts); the payload itself was not. This module
// applies the SAME envelope idiom (PBKDF2-HMAC-SHA256 310k → AES-256-GCM,
// derivation shared with key-wrap.ts) to the whole serialized ForensicBackup,
// so what lands in Downloads is authenticated ciphertext. AES-GCM means a
// wrong secret or a tampered file fails to open rather than yielding garbage.
//
// Two key sources, stamped in the envelope so restore knows what to ask for:
//   • 'passphrase' — parent-typed at manual export ("Back up now"). Never
//     stored (same contract as key-wrap.ts); lives in the parent's head, so
//     these backups survive an uninstall.
//   • 'device-key' — random 256-bit secret generated once per install and
//     kept in chrome.storage.local (backup.ts), used by the AUTOMATIC daily
//     path where no parent passphrase exists when the alarm fires.
//
// PURE: only Web Crypto. No DOM, no storage. Unit-testable round-trip.

import { checkedIterations, deriveAesKey, PASSPHRASE_MIN_LENGTH, PBKDF2_ITERATIONS, unwrapSecretString, type WrappedKey } from './key-wrap';

const SALT_BYTES = 16; // same parameters as key-wrap.ts
const IV_BYTES = 12;

/** Current envelope format version (the `fwSealedBackup` discriminator value). */
export const SEALED_BACKUP_VERSION = 1;

export type SealKeySource = 'passphrase' | 'device-key';

export interface SealedBackupEnvelope {
  /**
   * Discriminator + format version. Restore format-sniffs on this field
   * (isSealedBackupEnvelope) to tell a sealed file from a legacy plaintext
   * backup; a value above SEALED_BACKUP_VERSION is refused rather than
   * mis-decrypted (forward-safe, mirroring parseBackup's schemaVersion gate).
   */
  fwSealedBackup: number;
  kdf: 'PBKDF2';
  hash: 'SHA-256';
  iterations: number;
  /** What keyed this envelope — decides what restore asks the parent for. */
  keySource: SealKeySource;
  /** When the payload was sealed. Deliberately the ONLY plaintext metadata. */
  sealedAt: string;
  /** base64 PBKDF2 salt. */
  salt: string;
  /** base64 AES-GCM IV. */
  iv: string;
  /** base64 AES-GCM ciphertext of the UTF-8 serialized ForensicBackup JSON. */
  ciphertext: string;
  /**
   * The device seal secret, wrapped under a passphrase the parent set.
   *
   * A 'device-key' envelope is readable only by the install that wrote it,
   * which is correct for keeping a child's verbatim feed history out of a
   * plaintext Downloads file, and is also why a folder of automatic backups
   * turns into landfill the moment the extension is reinstalled: the secret
   * dies with the profile and takes every prior backup with it.
   *
   * When present, this field carries the same secret encrypted under a
   * passphrase, so the FILE carries its own means of recovery and no longer
   * depends on a profile that may not exist any more. Absent unless the parent
   * set a recovery passphrase; the passphrase itself is never stored anywhere.
   */
  recoveryWrappedSecret?: WrappedKey;
}

// Chunked base64 (vs key-wrap's byte-at-a-time concat, which is fine for a
// small JWK): a sealed payload is the whole serialized chain — megabytes —
// and per-byte string concatenation does not scale to that.
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Random 256-bit secret for the automatic path's 'device-key' envelopes,
 * base64 so it stores/derives as a plain string. Generation is here (pure
 * crypto); persistence is backup.ts's job.
 */
export function generateDeviceSealSecret(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(32)));
}

/** Structural sniff: does this parsed JSON look like a sealed envelope (any version)? Pure. */
export function isSealedBackupEnvelope(obj: unknown): obj is SealedBackupEnvelope {
  if (typeof obj !== 'object' || obj === null) return false;
  const e = obj as Record<string, unknown>;
  return typeof e.fwSealedBackup === 'number'
    && typeof e.salt === 'string'
    && typeof e.iv === 'string'
    && typeof e.ciphertext === 'string'
    // The declared type says number and the sniff did not check it, so a file
    // carrying a string or an object here passed the shape test and reached
    // deriveKey. The value is bounded again at the unwrap; this rejects the
    // wrong TYPE at the boundary, where a shape check belongs.
    && typeof e.iterations === 'number'
    && (e.keySource === 'passphrase' || e.keySource === 'device-key');
}

/**
 * Seal a serialized backup under a secret. Throws on an empty secret, and on a person's passphrase under the floor: a
 * passphrase-sealed file carries the signing key, so the floor holds here and not only in the box that collects it.
 */
export async function sealBackupJson(
  json: string,
  secret: string,
  keySource: SealKeySource,
  /** Escrow copy of `secret`, wrapped under the parent's recovery passphrase. */
  recoveryWrappedSecret?: WrappedKey,
): Promise<SealedBackupEnvelope> {
  if (!secret) throw new Error('A secret is required to seal a backup.');
  if (keySource === 'passphrase' && secret.length < PASSPHRASE_MIN_LENGTH) {
    throw new Error(`The passphrase must be at least ${PASSPHRASE_MIN_LENGTH} characters.`);
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveAesKey(secret, salt, PBKDF2_ITERATIONS);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(json));
  return {
    fwSealedBackup: SEALED_BACKUP_VERSION,
    kdf: 'PBKDF2',
    hash: 'SHA-256',
    iterations: PBKDF2_ITERATIONS,
    keySource,
    sealedAt: new Date().toISOString(),
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ct)),
    ...(recoveryWrappedSecret ? { recoveryWrappedSecret } : {}),
  };
}

/**
 * Open a device-key envelope using the parent's recovery passphrase instead of
 * the install's device secret.
 *
 * This is the path that makes an automatic backup survive the reinstall it was
 * taken to protect against. It unwraps the escrowed device secret and then
 * opens the envelope with it, so the payload's encryption is untouched: the
 * passphrase is a second door to the same key, not a weaker one.
 */
export async function openBackupJsonWithRecoveryPassphrase(
  envelope: SealedBackupEnvelope,
  passphrase: string,
): Promise<string> {
  if (!envelope?.recoveryWrappedSecret) {
    throw new Error('This backup cannot be opened with a backup passphrase.');
  }
  const secret = await unwrapSecretString(envelope.recoveryWrappedSecret, passphrase);
  return openBackupJson(envelope, secret);
}

/**
 * Open a sealed envelope back into the serialized backup JSON. Throws
 * "Wrong passphrase or corrupted backup." on any authentication failure
 * (AES-GCM rejects a wrong secret or tampered ciphertext) — never returns
 * garbage. Refuses a newer envelope version rather than mis-decrypting.
 */
export async function openBackupJson(envelope: SealedBackupEnvelope, secret: string): Promise<string> {
  if (!envelope || envelope.fwSealedBackup !== SEALED_BACKUP_VERSION) {
    throw new Error('Unsupported sealed-backup format.');
  }
  // Bounded, like the two unwrap paths in key-wrap.ts. This is the third place
  // a file the product did not write hands an iteration count straight to
  // deriveKey, and it was missed when the other two were fixed — a sealed
  // backup envelope naming an enormous count hangs whatever opens it just as a
  // wrapped key does.
  const key = await deriveAesKey(secret, fromBase64(envelope.salt), checkedIterations(envelope.iterations));
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(envelope.iv) }, key, fromBase64(envelope.ciphertext),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error('Wrong passphrase or corrupted backup.');
  }
}
