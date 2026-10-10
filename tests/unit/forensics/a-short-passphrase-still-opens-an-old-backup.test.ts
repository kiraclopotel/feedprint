// The eight-character floor is on saving only. A passphrase-sealed backup carries the signing key, and a short
// passphrase can be guessed by anyone who has the file, so nothing new is sealed under one. A file sealed before the
// floor existed, under "1234", must still open: refusing it would lose the person's record to protect a key that is
// already in that file.

import { describe, expect, it } from 'vitest';
import {
  deriveAesKey, PBKDF2_ITERATIONS, PASSPHRASE_MIN_LENGTH, unwrapPrivateKeyJwk, wrapPrivateKeyJwk, wrapSecretString,
  type WrappedKey,
} from '../../../src/forensics/key-wrap';
import {
  openBackupJson, openBackupJsonWithRecoveryPassphrase, sealBackupJson, SEALED_BACKUP_VERSION, type SealedBackupEnvelope,
} from '../../../src/forensics/backup-envelope';

const SHORT = '1234';
const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

/** What a wrap made before the floor looked like: the same format, under a short passphrase. */
async function wrapUnderShortPassphrase(plaintext: string, passphrase: string): Promise<WrappedKey> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(passphrase, salt, PBKDF2_ITERATIONS);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return { v: 1, kdf: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, salt: b64(salt), iv: b64(iv), ciphertext: b64(new Uint8Array(ct)) };
}

/** What a whole file sealed before the floor looked like: the envelope around the same wrap. */
async function sealUnderShortPassphrase(json: string, passphrase: string): Promise<SealedBackupEnvelope> {
  const { salt, iv, ciphertext } = await wrapUnderShortPassphrase(json, passphrase);
  return { fwSealedBackup: SEALED_BACKUP_VERSION, kdf: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, keySource: 'passphrase', sealedAt: '2026-09-01T00:00:00.000Z', salt, iv, ciphertext };
}

describe('a backup sealed under a passphrase shorter than the floor', () => {
  it('the floor is still eight characters, and saving under a shorter one is refused', async () => {
    expect(PASSPHRASE_MIN_LENGTH).toBe(8);
    await expect(wrapPrivateKeyJwk({ kty: 'EC' }, SHORT)).rejects.toThrow(/at least 8/);
    await expect(wrapSecretString('device secret', SHORT)).rejects.toThrow(/at least 8/);
    await expect(sealBackupJson('{}', SHORT, 'passphrase'), 'the seal itself refuses, not only the box').rejects.toThrow(/at least 8/);
    await expect(sealBackupJson('{}', 'eight-ok', 'passphrase')).resolves.toBeTruthy();
  });

  it('the floor holds for a person passphrase, not for the install key', async () => {
    await expect(sealBackupJson('{}', 'short', 'device-key')).resolves.toBeTruthy();
  });

  it('opens a whole sealed file', async () => {
    const json = JSON.stringify({ records: [{ id: 'r1' }] });
    const envelope = await sealUnderShortPassphrase(json, SHORT);
    await expect(openBackupJson(envelope, SHORT)).resolves.toBe(json);
  });

  it('unwraps the signing key inside it', async () => {
    const jwk = { kty: 'EC', crv: 'P-256', d: 'private-part', x: 'x', y: 'y' };
    const wrapped = await wrapUnderShortPassphrase(JSON.stringify(jwk), SHORT);
    await expect(unwrapPrivateKeyJwk(wrapped, SHORT)).resolves.toEqual(jwk);
  });

  it('opens a daily copy whose recovery passphrase was short', async () => {
    const json = JSON.stringify({ records: [] });
    const deviceSecret = 'the install secret';
    const envelope = await sealBackupJson(json, deviceSecret, 'device-key', await wrapUnderShortPassphrase(deviceSecret, SHORT));
    await expect(openBackupJsonWithRecoveryPassphrase(envelope, SHORT)).resolves.toBe(json);
  });
});
