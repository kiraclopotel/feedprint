// The automatic backup could not survive the disaster it existed for.
//
// Every automatic copy is sealed under a per-install device secret. That is
// the right default: it keeps a child's verbatim feed history out of a
// plaintext file sitting in Downloads. It also means the secret dies with the
// profile, so a reinstall turns the whole backup folder into landfill. On
// a real machine that folder is named `_unopenable-pre-reinstall/` and holds
// about 150 MB of files nothing can ever open again, several of which were
// taken specifically to survive a reinstall.
//
// Escrow fixes the direction without weakening the seal: the same device
// secret is also stored encrypted under a passphrase the parent chose, inside
// the file. A second door to the same key, not a weaker lock. The passphrase
// is never persisted anywhere.

import { describe, expect, it } from 'vitest';
import {
  sealBackupJson,
  openBackupJson,
  openBackupJsonWithRecoveryPassphrase,
  generateDeviceSealSecret,
} from '../../../src/forensics/backup-envelope';
import { wrapSecretString } from '../../../src/forensics/key-wrap';

const PAYLOAD = JSON.stringify({ schemaVersion: 2, records: [{ id: 'r0' }] });

describe('backup recovery passphrase', () => {
  it('opens an automatic backup on a machine that never had the device secret', async () => {
    const deviceSecret = generateDeviceSealSecret();
    const escrow = await wrapSecretString(deviceSecret, 'correct horse battery');
    const sealed = await sealBackupJson(PAYLOAD, deviceSecret, 'device-key', escrow);

    // The reinstall: the device secret is gone. Only the file and the
    // passphrase survive, which is exactly the situation that produced
    // `_unopenable-pre-reinstall/`.
    const recovered = await openBackupJsonWithRecoveryPassphrase(sealed, 'correct horse battery');

    expect(recovered).toBe(PAYLOAD);
  });

  it('still opens with the device secret, so the original install needs no passphrase', async () => {
    const deviceSecret = generateDeviceSealSecret();
    const escrow = await wrapSecretString(deviceSecret, 'correct horse battery');
    const sealed = await sealBackupJson(PAYLOAD, deviceSecret, 'device-key', escrow);

    expect(await openBackupJson(sealed, deviceSecret)).toBe(PAYLOAD);
  });

  it('rejects a wrong passphrase instead of returning anything', async () => {
    const deviceSecret = generateDeviceSealSecret();
    const escrow = await wrapSecretString(deviceSecret, 'correct horse battery');
    const sealed = await sealBackupJson(PAYLOAD, deviceSecret, 'device-key', escrow);

    await expect(openBackupJsonWithRecoveryPassphrase(sealed, 'wrong')).rejects.toThrow();
  });

  it('does not weaken the payload seal: the passphrase alone cannot open an envelope without escrow', async () => {
    const deviceSecret = generateDeviceSealSecret();
    const sealed = await sealBackupJson(PAYLOAD, deviceSecret, 'device-key');

    expect(sealed.recoveryWrappedSecret).toBeUndefined();
    await expect(openBackupJsonWithRecoveryPassphrase(sealed, 'anything')).rejects.toThrow(
      /cannot be opened with a backup passphrase/i,
    );
  });

  it('leaves no plaintext secret in the file', async () => {
    const deviceSecret = generateDeviceSealSecret();
    const escrow = await wrapSecretString(deviceSecret, 'correct horse battery');
    const sealed = await sealBackupJson(PAYLOAD, deviceSecret, 'device-key', escrow);

    const serialized = JSON.stringify(sealed);
    expect(serialized).not.toContain(deviceSecret);
    expect(serialized).not.toContain('correct horse battery');
  });
});
