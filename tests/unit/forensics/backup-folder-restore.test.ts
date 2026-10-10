// The backup folder restores on its own (14 Sep 2026). The owner's report:
// after an uninstall and a reinstall, no automatic backup could be opened,
// the newest copy could not be told from the others, and the restore asked
// for a PIN a fresh install cannot have. This locks the folder half: the key
// file's shape, the fixed names, and a device-key copy opened by the key
// file's secret on an install that never held it.

import { describe, expect, it } from 'vitest';
import {
  LATEST_BACKUP_FILENAME,
  RESTORE_KEY_FILENAME,
  parseRestoreKeyFile,
  restoreKeyFileContents,
} from '../../../src/forensics/backup-folder-wire';
import { sealBackupJson, generateDeviceSealSecret } from '../../../src/forensics/backup-envelope';
import { decodeBackupPayload, LATEST_DOWNLOADS_BACKUP_PATH } from '../../../src/forensics/backup';

describe('the key file', () => {
  it('round-trips the seal secret and says what it is', () => {
    const secret = generateDeviceSealSecret();
    const text = restoreKeyFileContents(secret);
    expect(text).toContain('FeelingWise');
    expect(parseRestoreKeyFile(text)).toBe(secret);
  });

  it('refuses anything that is not a key file', () => {
    expect(parseRestoreKeyFile('not json')).toBeNull();
    expect(parseRestoreKeyFile('{"secret":"x"}')).toBeNull();
    expect(parseRestoreKeyFile('{"fwRestoreKey":1,"secret":""}')).toBeNull();
    expect(parseRestoreKeyFile('{"fwRestoreKey":2,"secret":"x"}')).toBeNull();
  });

  it('the fixed names are the ones the strings promise', () => {
    expect(LATEST_BACKUP_FILENAME).toBe('feelingwise-latest.json');
    expect(RESTORE_KEY_FILENAME).toBe('feelingwise-restore.key');
    expect(LATEST_DOWNLOADS_BACKUP_PATH).toBe('FeelingWise/feelingwise-latest.json');
  });
});

describe('a device-key copy on an install that never held the key', () => {
  const backup = {
    schemaVersion: 2,
    exportedAt: '2026-09-14T12:00:00.000Z',
    records: [],
    anchors: [],
  };

  it('opens with the key file secret, and not without it', async () => {
    const secret = generateDeviceSealSecret();
    const envelope = JSON.stringify(await sealBackupJson(JSON.stringify(backup), secret, 'device-key'));
    // The reinstalled extension has no device secret of its own.
    const without = await decodeBackupPayload(envelope, undefined, async () => undefined);
    expect(without.ok).toBe(false);
    if (!without.ok) expect(without.reason).toBe('device-key-missing');
    // The same call the service worker makes: the folder's secret first.
    const withKey = await decodeBackupPayload(envelope, undefined, async () => secret);
    expect(withKey.ok).toBe(true);
  });

  it('a wrong key file secret is named as a different install, never as an open file', async () => {
    const envelope = JSON.stringify(await sealBackupJson(JSON.stringify(backup), generateDeviceSealSecret(), 'device-key'));
    const wrong = await decodeBackupPayload(envelope, undefined, async () => generateDeviceSealSecret());
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.reason).toBe('device-key-mismatch');
  });
});
