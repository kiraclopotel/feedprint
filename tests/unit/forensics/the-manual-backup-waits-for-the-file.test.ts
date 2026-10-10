// The writer half of "a cancelled save is not a backup" (2026-09-19).
//
// tests/unit/ui/dashboard/components/a-cancelled-save-is-not-a-backup.test.tsx
// holds the decision: the dashboard records a success only when the file is on
// disk. This file holds the thing that answers that question, and it is the
// half a mock cannot check.
//
// Every outcome here is a real one a parent produces: pressing Escape on the
// Save-As dialog (Chrome rejects the call), a write that fails on the way
// (state 'interrupted'), a write still going when the wait runs out, and a
// realm with no downloads API at all. None of them is a backup.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveManualBackupFile } from '../../../src/forensics/backup';

type DownloadItem = { id: number; state: 'in_progress' | 'complete' | 'interrupted' };

function installDownloads(opts: {
  download?: (o: unknown) => Promise<number>;
  items?: DownloadItem[];
}): { calls: unknown[] } {
  const calls: unknown[] = [];
  (globalThis as unknown as { chrome?: unknown }).chrome = {
    downloads: {
      download: opts.download ?? (async (o: unknown) => { calls.push(o); return 7; }),
      search: async ({ id }: { id: number }) => (opts.items ?? [{ id, state: 'complete' as const }]).filter((i) => i.id === id),
    },
  };
  return { calls };
}

beforeEach(() => {
  vi.useFakeTimers();
  // Object URLs are not part of what is being measured; a data URL is the
  // fallback the function already takes when they are missing.
  (globalThis as unknown as { URL: unknown }).URL = {};
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

/** Runs the promise with the poll timers driven, so a wait does not hang the test. */
async function drive<T>(p: Promise<T>): Promise<T> {
  const done = p.then((v) => v);
  await vi.runAllTimersAsync();
  return done;
}

describe('the manual backup waits for the file (2026-09-19)', () => {
  it('reports complete when the file reaches the disk', async () => {
    const { calls } = installDownloads({ items: [{ id: 7, state: 'complete' }] });
    await expect(drive(saveManualBackupFile('{}', 'b.json'))).resolves.toBe('complete');
    // saveAs is what makes a cancel legible: an anchor click reports nothing,
    // and Chrome rejects a cancelled picker.
    expect(calls[0]).toMatchObject({ filename: 'b.json', saveAs: true, conflictAction: 'uniquify' });
  });

  it('reports interrupted when the parent cancels the save dialog', async () => {
    installDownloads({ download: async () => { throw new Error('User canceled'); } });
    await expect(drive(saveManualBackupFile('{}', 'b.json'))).resolves.toBe('interrupted');
  });

  it('reports interrupted when the write fails on the way', async () => {
    installDownloads({ items: [{ id: 7, state: 'interrupted' }] });
    await expect(drive(saveManualBackupFile('{}', 'b.json'))).resolves.toBe('interrupted');
  });

  it('reports unconfirmed when the write is still going when the wait runs out', async () => {
    installDownloads({ items: [{ id: 7, state: 'in_progress' }] });
    await expect(drive(saveManualBackupFile('{}', 'b.json'))).resolves.toBe('unconfirmed');
  });

  it('reports no-downloads-api rather than pretending, when there is nothing to write through', async () => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
    await expect(saveManualBackupFile('{}', 'b.json')).resolves.toBe('no-downloads-api');
  });

  it('never answers complete for anything but a file on disk', async () => {
    // The one sentence this whole pair exists to hold. Written as a sweep so a
    // future state added to the search result has to be classified on purpose.
    for (const state of ['in_progress', 'interrupted'] as const) {
      installDownloads({ items: [{ id: 7, state }] });
      await expect(drive(saveManualBackupFile('{}', 'b.json'))).resolves.not.toBe('complete');
    }
  });
});
