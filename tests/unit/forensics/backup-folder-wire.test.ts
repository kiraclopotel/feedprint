// @vitest-environment jsdom
//
// Q36 — silent folder-wired backup. Real FileSystemDirectoryHandle objects
// only exist in a live browser (they serialize natively into IndexedDB;
// fakes with methods cannot), so these tests cover the reachable seams:
// status resolution without a stored handle, the mirror's honest fallback
// outcomes, and a source-lock on the quiet-download wrapper (layer 1).

import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getBackupFolderWireStatus,
  writeBackupToWiredFolder,
} from '../../../src/forensics/backup-folder-wire';

const BACKUP_PATH = 'src/forensics/backup.ts';

beforeEach(() => {
  delete (globalThis as any).showDirectoryPicker;
});

describe('folder-wire status', () => {
  it('no picker API and no stored handle reads as unsupported', async () => {
    const status = await getBackupFolderWireStatus();
    expect(status.state).toBe('unsupported');
  });

  it('picker available but nothing stored reads as none', async () => {
    (globalThis as any).showDirectoryPicker = () => Promise.reject(new Error('gesture required'));
    const status = await getBackupFolderWireStatus();
    expect(status.state).toBe('none');
  });
});

describe('writeBackupToWiredFolder honest fallbacks', () => {
  it('returns no-folder when nothing is wired, without throwing', async () => {
    const result = await writeBackupToWiredFolder('{}', 'x.json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no-folder');
  });
});

describe('layer 1 — quiet auto-backup download (source-lock)', () => {
  const source = readFileSync(join(process.cwd(), BACKUP_PATH), 'utf8');

  it('the AUTO backup routes through downloadQuietly', () => {
    const autoBlock = source.match(/export async function autoBackupToDownloads[\s\S]{0,9000}/)?.[0] ?? '';
    expect(autoBlock).toContain('await downloadQuietly({');
  });

  it('downloadQuietly disables UI, bounds the wait, and always re-enables', () => {
    const block = source.match(/async function downloadQuietly[\s\S]{0,1600}/)?.[0] ?? '';
    expect(block).toContain('setUi({ enabled: false })');
    expect(block).toContain('finally');
    expect(block).toContain('setUi({ enabled: true })');
    // The wait is bounded (20 polls of 250 ms) through the shared poller.
    expect(block).toContain('waitForDownloadState(id, 20)');
    const poller = source.match(/async function waitForDownloadState[\s\S]{0,800}/)?.[0] ?? '';
    expect(poller).toMatch(/for \(let i = 0; i < polls; i\+\+\)/);
  });

  it('Q79 (W67): only a confirmed completion earns saved / head / prune', () => {
    const dq = source.match(/async function downloadQuietly[\s\S]{0,2200}/)?.[0] ?? '';
    // Verdict-typed: interrupted and missing-item are named outcomes, not
    // silent completion. The outcomes come from the shared poller.
    expect(dq).toContain("Promise<'complete' | 'interrupted' | 'unconfirmed'>");
    const poller = source.match(/async function waitForDownloadState[\s\S]{0,800}/)?.[0] ?? '';
    expect(poller).toContain("if (item.state === 'interrupted') return 'interrupted';");
    expect(poller).toContain("if (!item) return 'unconfirmed';");
    const autoBlock = source.match(/export async function autoBackupToDownloads[\s\S]{0,12000}/)?.[0] ?? '';
    // The failure branch runs BEFORE the saved-health write, the dedup head
    // set, and the retention prune.
    const failAt = autoBlock.indexOf("if (outcome !== 'complete')");
    const savedAt = autoBlock.indexOf("lastStatus: 'saved'");
    const headAt = autoBlock.indexOf('LAST_BACKUP_HEAD_KEY]: head');
    const pruneAt = autoBlock.indexOf('pruneAutoBackupDownloads()');
    expect(failAt).toBeGreaterThan(-1);
    expect(failAt).toBeLessThan(savedAt);
    expect(failAt).toBeLessThan(headAt);
    expect(failAt).toBeLessThan(pruneAt);
  });

  it('the folder mirror keeps its own dedup head and reuses the seal path', () => {
    const block = source.match(/export async function mirrorBackupToWiredFolder[\s\S]{0,3500}/)?.[0] ?? '';
    expect(block).toContain('LAST_FOLDER_MIRROR_HEAD_KEY');
    expect(block).toContain('sealBackupJson');
    expect(block).toContain("'no-permission'");
  });

  // 14 Sep 2026: the folder restores on its own, so every mirror also writes
  // the fixed-name newest copy and the key file, after the dated copy, and
  // the Downloads auto-backup overwrites its own fixed-name newest copy.
  it('every mirror writes the newest copy and the key file beside the dated copy', () => {
    const block = source.match(/export async function mirrorBackupToWiredFolder[\s\S]{0,3500}/)?.[0] ?? '';
    const dated = block.indexOf('writeBackupToWiredFolder(json, filename)');
    const latest = block.indexOf('writeBackupToWiredFolder(json, LATEST_BACKUP_FILENAME)');
    const key = block.indexOf('writeBackupToWiredFolder(restoreKeyFileContents(sealSecret), RESTORE_KEY_FILENAME)');
    expect(dated).toBeGreaterThan(-1);
    expect(latest).toBeGreaterThan(dated);
    expect(key).toBeGreaterThan(latest);
    const autoBlock = source.match(/export async function autoBackupToDownloads[\s\S]{0,9000}/)?.[0] ?? '';
    expect(autoBlock).toContain("filename: LATEST_DOWNLOADS_BACKUP_PATH, conflictAction: 'overwrite'");
  });
});
