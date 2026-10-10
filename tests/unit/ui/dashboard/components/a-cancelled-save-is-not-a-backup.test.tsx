// @vitest-environment jsdom
//
// "Back up now" recorded a backup it had not taken.
//
// The button built an object URL, clicked a hidden anchor, and called
// `recordManualBackupSuccess` on the next line. A click is a request, not a
// result. With Chrome set to ask where to save each file, a parent who pressed
// Escape on that dialog was recorded as having taken a backup.
//
// Why that is worse than one missing file: `lastPassphraseBackupAt` is a
// HIGH-WATER MARK and is never cleared, by design, because durability past
// uninstall is a property of whether such an export has EVER been taken. So one
// cancelled dialog suppressed the `install-locked-only` warning permanently.
// That warning exists for exactly one reader: somebody whose only copies are
// sealed to this install and would not open after a reinstall. It is the
// warning that stops the dashboard showing green to a person who has nothing.
//
// Found 2026-09-19. The two other Downloads writers in backup.ts already knew:
// the pre-restore safety copy waits for 'complete' before it lets a
// destructive replace go ahead, and `downloadQuietly`'s own docblock records
// this same mistake costing pruned backups.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const saveManualBackupFile = vi.fn<(json: string, filename: string) => Promise<string>>();
const recordManualBackupSuccess = vi.fn(async () => undefined);
const recordManualBackupNotSaved = vi.fn(async () => undefined);

vi.mock('../../../../../src/forensics/backup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/forensics/backup')>();
  return {
    ...actual,
    getBackupHealth: vi.fn(async () => ({})),
    mirrorBackupToWiredFolder: vi.fn(async () => 'skipped'),
    buildBackupBlob: vi.fn(async () => ({ records: [{ id: 'r1' }] })),
    saveManualBackupFile: (json: string, filename: string) => saveManualBackupFile(json, filename),
    recordManualBackupSuccess: () => recordManualBackupSuccess(),
    recordManualBackupNotSaved: (reason: string) => { void reason; return recordManualBackupNotSaved(); },
  };
});
vi.mock('../../../../../src/forensics/backup-folder-wire', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/forensics/backup-folder-wire')>();
  return { ...actual, getBackupFolderWireStatus: vi.fn(async () => ({ state: 'none' as const })) };
});

import { ExportTab } from '../../../../../src/ui/dashboard/components/ExportTab';
import { I18nProvider } from '../../../../../src/i18n/react';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const settle = async (): Promise<void> => {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

async function pressBackUpNow(): Promise<void> {
  const btn = host.querySelector<HTMLButtonElement>('[data-testid="backup-now"]');
  expect(btn, 'the Back up now control is on the page').toBeTruthy();
  await act(async () => { btn!.click(); });
  await settle();
}

beforeEach(async () => {
  saveManualBackupFile.mockReset();
  recordManualBackupSuccess.mockReset();
  recordManualBackupNotSaved.mockReset();
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async () => undefined) } });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(I18nProvider, { lang: 'en', children: createElement(ExportTab, { records: [], archivedCount: 0 }) }));
  });
  await settle();
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  vi.unstubAllGlobals();
});

describe('a cancelled save is not a backup (2026-09-19)', () => {
  it('records nothing when the parent cancels the save dialog', async () => {
    saveManualBackupFile.mockResolvedValue('interrupted');
    await pressBackUpNow();
    expect(recordManualBackupSuccess, 'a cancelled dialog is not a backup taken').not.toHaveBeenCalled();
    expect(recordManualBackupNotSaved, 'the attempt is still recorded').toHaveBeenCalled();
  });

  it('tells the parent, rather than leaving a pressed button and no file', async () => {
    saveManualBackupFile.mockResolvedValue('interrupted');
    await pressBackUpNow();
    expect(host.textContent, 'the page says no file was saved')
      .toContain('No backup file was saved');
  });

  it('records nothing when the write is accepted but never confirmed', async () => {
    // Not a failure and not a success. The file may yet appear; what must not
    // happen is the warning going quiet on the strength of a maybe.
    saveManualBackupFile.mockResolvedValue('unconfirmed');
    await pressBackUpNow();
    expect(recordManualBackupSuccess).not.toHaveBeenCalled();
  });

  it('records nothing when there is no downloads API to write through', async () => {
    saveManualBackupFile.mockResolvedValue('no-downloads-api');
    await pressBackUpNow();
    expect(recordManualBackupSuccess).not.toHaveBeenCalled();
  });

  it('records the backup when the file really is on disk', async () => {
    // The control. A fix that stopped recording real backups would make the
    // banner nag for ever, which is the same defect pointing the other way.
    saveManualBackupFile.mockResolvedValue('complete');
    await pressBackUpNow();
    expect(recordManualBackupSuccess, 'a confirmed file is a backup taken').toHaveBeenCalled();
    expect(recordManualBackupNotSaved).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain('No backup file was saved');
  });
});
