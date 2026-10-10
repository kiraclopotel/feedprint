// FeelingWise — sealed backup envelope (G1, 2026-08-04). The whole backup
// payload ships as AES-256-GCM ciphertext (same PBKDF2 idiom as key-wrap.ts)
// so verbatim feed history never sits in Downloads readable. Pure Web Crypto
// (available in the Node test env, as key-wrap relies on crypto.subtle too).
// Locks: round-trip under both key sources, wrong-secret rejection, tamper
// rejection, randomized salt/iv, the format sniff, and version gating.

import { describe, it, expect } from 'vitest';
import {
  sealBackupJson,
  openBackupJson,
  isSealedBackupEnvelope,
  generateDeviceSealSecret,
  SEALED_BACKUP_VERSION,
} from '../../../src/forensics/backup-envelope';

const PAYLOAD = JSON.stringify({
  schemaVersion: 1,
  records: [{ id: 'r1', originalText: 'a verbatim post the file must not leak' }],
});

describe('sealBackupJson / openBackupJson', () => {
  it('round-trips the exact JSON under a parent passphrase', async () => {
    const sealed = await sealBackupJson(PAYLOAD, 'correct horse battery staple', 'passphrase');
    expect(sealed.keySource).toBe('passphrase');
    await expect(openBackupJson(sealed, 'correct horse battery staple')).resolves.toBe(PAYLOAD);
  });

  it('round-trips under a generated device secret', async () => {
    const secret = generateDeviceSealSecret();
    const sealed = await sealBackupJson(PAYLOAD, secret, 'device-key');
    expect(sealed.keySource).toBe('device-key');
    await expect(openBackupJson(sealed, secret)).resolves.toBe(PAYLOAD);
  });

  it('never leaks the plaintext into the envelope itself', async () => {
    const sealed = await sealBackupJson(PAYLOAD, 'pass-word-1', 'passphrase');
    expect(JSON.stringify(sealed)).not.toContain('verbatim post');
  });

  it('rejects a wrong secret (AES-GCM auth fails)', async () => {
    const sealed = await sealBackupJson(PAYLOAD, 'right-pass', 'passphrase');
    await expect(openBackupJson(sealed, 'wrong-pass')).rejects.toThrow(/wrong passphrase|corrupted/i);
  });

  it('rejects a tampered ciphertext', async () => {
    const sealed = await sealBackupJson(PAYLOAD, 'pass-word-1', 'passphrase');
    const c0 = sealed.ciphertext[0];
    const tampered = { ...sealed, ciphertext: (c0 === 'A' ? 'B' : 'A') + sealed.ciphertext.slice(1) };
    await expect(openBackupJson(tampered, 'pass-word-1')).rejects.toThrow(/wrong passphrase|corrupted/i);
  });

  it('refuses an empty secret on seal', async () => {
    await expect(sealBackupJson(PAYLOAD, '', 'device-key')).rejects.toThrow(/secret is required/i);
  });

  it('refuses a newer envelope version rather than mis-decrypting', async () => {
    const sealed = await sealBackupJson(PAYLOAD, 'pass-word-1', 'passphrase');
    const newer = { ...sealed, fwSealedBackup: SEALED_BACKUP_VERSION + 1 };
    await expect(openBackupJson(newer, 'pass-word-1')).rejects.toThrow(/unsupported/i);
  });

  it('uses a fresh salt + iv each call (no deterministic reuse)', async () => {
    const a = await sealBackupJson(PAYLOAD, 'same-same-1', 'passphrase');
    const b = await sealBackupJson(PAYLOAD, 'same-same-1', 'passphrase');
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext); // GCM with distinct iv → distinct ct
  });

  it('records the KDF parameters for transparency (same floor as key-wrap)', async () => {
    const sealed = await sealBackupJson(PAYLOAD, 'pass-word-1', 'device-key');
    expect(sealed.kdf).toBe('PBKDF2');
    expect(sealed.hash).toBe('SHA-256');
    expect(sealed.iterations).toBeGreaterThanOrEqual(300_000);
  });
});

describe('generateDeviceSealSecret', () => {
  it('yields a base64 256-bit secret, fresh each call', () => {
    const a = generateDeviceSealSecret();
    const b = generateDeviceSealSecret();
    expect(a).toHaveLength(44); // base64(32 bytes)
    expect(a).not.toBe(b);
  });
});

describe('isSealedBackupEnvelope (restore format sniff)', () => {
  it('recognizes a sealed envelope, current or future version', async () => {
    const sealed = await sealBackupJson(PAYLOAD, 'pass-word-1', 'passphrase');
    expect(isSealedBackupEnvelope(sealed)).toBe(true);
    expect(isSealedBackupEnvelope({ ...sealed, fwSealedBackup: SEALED_BACKUP_VERSION + 3 })).toBe(true);
  });

  it('does NOT flag a legacy plaintext backup (or junk) as sealed', () => {
    expect(isSealedBackupEnvelope({ schemaVersion: 1, records: [] })).toBe(false);
    expect(isSealedBackupEnvelope(null)).toBe(false);
    expect(isSealedBackupEnvelope('a string')).toBe(false);
    expect(isSealedBackupEnvelope({ fwSealedBackup: 1 })).toBe(false); // missing crypto fields
    expect(isSealedBackupEnvelope({ fwSealedBackup: 1, salt: 's', iv: 'i', ciphertext: 'c', keySource: 'other' })).toBe(false);
  });
});

// The THIRD place a file the product did not write hands an iteration count to
// deriveKey, missed when the two in key-wrap.ts were bounded. A sealed envelope
// naming an enormous count hangs whatever opens it just as a wrapped key does.
describe('a sealed envelope cannot choose how long it takes to open', () => {
  it('is rejected structurally when iterations is not a number', () => {
    expect(isSealedBackupEnvelope({
      fwSealedBackup: 1, salt: 's', iv: 'i', ciphertext: 'c',
      keySource: 'passphrase', iterations: '310000',
    })).toBe(false);
    expect(isSealedBackupEnvelope({
      fwSealedBackup: 1, salt: 's', iv: 'i', ciphertext: 'c',
      keySource: 'passphrase', iterations: 310000,
    })).toBe(true);
  });

  it('refuses to open one naming a count outside the bound', async () => {
    await expect(openBackupJson({
      fwSealedBackup: 1, salt: 'AAAA', iv: 'AAAA', ciphertext: 'AAAA',
      keySource: 'passphrase', iterations: 1e12,
    } as never, 'a passphrase that is long enough')).rejects.toThrow(/outside/);
  });
});
