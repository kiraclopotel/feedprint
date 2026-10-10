/** @vitest-environment jsdom */
// Board line c2, 14 Sep 2026: "the record goes back exactly as the backup holds
// it ... but the screen never says so: after the confirmation the only words it
// showed were the question it asked first ... the restore's own refresh takes
// the export screen away and brings it back with the message gone".
//
// So the test reproduces the refresh, not just the restore: the export tab is
// unmounted and mounted again between the restore and the read, exactly as the
// dashboard does while it re-reads the record (Dashboard.tsx renders the tab
// under `!archiveLoading`). A sentence that lives in the export tab's own state
// cannot survive that; the one the dashboard holds does.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('../../../../src/forensics/backup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/forensics/backup')>();
  return {
    ...actual,
    getBackupHealth: vi.fn(async () => { throw new Error('no storage in this test'); }),
    mirrorBackupToWiredFolder: vi.fn(async () => 'skipped'),
  };
});
vi.mock('../../../../src/forensics/backup-folder-wire', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/forensics/backup-folder-wire')>();
  return { ...actual, getBackupFolderWireStatus: vi.fn(async () => ({ state: 'none' as const })) };
});

import { ExportTab } from '../../../../src/ui/dashboard/components/ExportTab';
import { useRestoreNotice, RESTORE_NOTICE_MS } from '../../../../src/ui/dashboard/restore-notice';
import { I18nProvider } from '../../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../../src/i18n/dashboard-strings';
import type { RestoreForensicBackupResponse } from '../../../../src/types/messages';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = DASHBOARD_STRINGS.en;
const sendMessage = vi.fn<(msg: unknown) => Promise<RestoreForensicBackupResponse | undefined>>();
let host: HTMLDivElement;
let root: Root;
/** Set by the harness: fires the refresh the restore starts. */
let refresh: () => void = () => {};

const settle = async (): Promise<void> => {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

/**
 * The dashboard's half of the wiring, and only that half: it holds the notice
 * (useRestoreNotice, the module the dashboard itself uses) and it takes the
 * export tab off the screen and puts it back when the restore asks it to
 * re-read the record.
 */
function Shell(): ReactNode {
  const notice = useRestoreNotice();
  const [reloading, setReloading] = useState(false);
  refresh = () => {
    setReloading(true);
    setTimeout(() => setReloading(false), 0);
  };
  return createElement(I18nProvider, {
    lang: 'en',
    children: reloading ? null : createElement(ExportTab, {
      records: [],
      archivedCount: 0,
      restoreNotice: notice.notice,
      onDismissRestoreNotice: notice.dismiss,
      onRestored: (outcome: { restored: number; replaced: number }) => {
        notice.show(outcome);
        refresh();
      },
    }),
  });
}

async function chooseBackupFile(): Promise<void> {
  const input = host.querySelector('input[type="file"][accept*="json"]') as HTMLInputElement;
  const file = new File(['{"schemaVersion":1,"records":[]}'], 'backup.json', { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  await settle();
  await settle();
}

function button(text: string): HTMLButtonElement {
  const btn = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.trim() === text);
  if (!btn) throw new Error(`no button "${text}"`);
  return btn;
}

/** The restore the walk drives: a record with 8 entries in it, a backup holding
 *  6, the question, the confirmation, the swap. */
function stageRestore(): void {
  sendMessage.mockReset();
  sendMessage
    .mockResolvedValueOnce({
      ok: true,
      result: {
        ok: false, needsConfirm: true, existingRealCount: 8,
        recordsAdded: 0, recordsSkipped: 0, anchorsAdded: 0, feedbackRestored: 0,
        chainVerified: false, keyRestored: false,
      },
    } as unknown as RestoreForensicBackupResponse)
    .mockResolvedValueOnce({
      ok: true,
      result: {
        ok: true, recordsAdded: 6, recordsSkipped: 0, existingRealCount: 8,
        anchorsAdded: 0, feedbackRestored: 0, chainVerified: true, keyRestored: true,
      },
    } as unknown as RestoreForensicBackupResponse);
}

beforeEach(async () => {
  sendMessage.mockReset();
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(createElement(Shell)); });
  await settle();
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('a restore that worked says so, and keeps saying it through the refresh', () => {
  it('names the count restored and the count replaced, after the screen has been rebuilt', async () => {
    stageRestore();
    await chooseBackupFile();
    // What it asks first. The board's red line was this question being the
    // last thing on screen.
    expect(host.textContent).toContain(t.restoreReplaceConfirm(8));

    await act(async () => { button(t.restoreAnyway).click(); });
    await settle();
    await settle();
    await settle();

    const notice = host.querySelector('[data-fw-restore-done="1"]');
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain(t.restoreDoneNotice(6, 8));
    // In the card the parent just clicked in, not somewhere else on the page.
    expect((host.querySelector('input[type="file"][accept*="json"]') as Element)
      .closest('.stats-card')?.contains(notice)).toBe(true);
    // The export tab's own message did not survive the rebuild, which is the
    // whole reason the sentence is held above it.
    expect(host.textContent).not.toContain(t.restoreChainIntact);
  });

  it('after a restore into an empty record, says what came back and nothing about entries that were never there', async () => {
    // The restore after a reinstall: nothing in the record, so no question and nothing taken off it.
    sendMessage.mockReset();
    sendMessage.mockResolvedValueOnce({
      ok: true,
      result: {
        ok: true, recordsAdded: 50, recordsSkipped: 0, existingRealCount: 0,
        anchorsAdded: 0, feedbackRestored: 0, chainVerified: true, keyRestored: true,
      },
    } as unknown as RestoreForensicBackupResponse);
    await chooseBackupFile();
    await settle();
    await settle();

    const notice = host.querySelector('[data-fw-restore-done="1"]');
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain('Restore finished: 50 entries are back in the record.');
    expect(notice?.textContent).not.toContain('monthly archive');
    expect(notice?.textContent).not.toContain('PARTIALLY VERIFIED');
  });

  it('goes away when the parent dismisses it', async () => {
    stageRestore();
    await chooseBackupFile();
    await act(async () => { button(t.restoreAnyway).click(); });
    await settle();
    await settle();
    await settle();
    expect(host.querySelector('[data-fw-restore-done="1"]')).not.toBeNull();

    await act(async () => { button(t.restoreDoneDismiss).click(); });
    await settle();
    expect(host.querySelector('[data-fw-restore-done="1"]')).toBeNull();
  });
});

describe('the hold itself', () => {
  it('drops the sentence after ten seconds and not before', async () => {
    vi.useFakeTimers();
    let hold: ReturnType<typeof useRestoreNotice> | null = null;
    const Probe = (): ReactNode => { hold = useRestoreNotice(); return null; };
    const probeHost = document.createElement('div');
    document.body.appendChild(probeHost);
    const probeRoot = createRoot(probeHost);
    await act(async () => { probeRoot.render(createElement(Probe)); });

    await act(async () => { hold!.show({ restored: 6, replaced: 8 }); });
    expect(hold!.notice).toEqual({ restored: 6, replaced: 8, seq: 1 });

    await act(async () => { vi.advanceTimersByTime(RESTORE_NOTICE_MS - 1); });
    expect(hold!.notice).not.toBeNull();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(hold!.notice).toBeNull();

    // A second restore restarts the ten seconds rather than inheriting what is
    // left of the first one's.
    await act(async () => { hold!.show({ restored: 1, replaced: 2 }); });
    await act(async () => { vi.advanceTimersByTime(RESTORE_NOTICE_MS - 100); });
    await act(async () => { hold!.show({ restored: 3, replaced: 4 }); });
    await act(async () => { vi.advanceTimersByTime(RESTORE_NOTICE_MS - 100); });
    expect(hold!.notice).toEqual({ restored: 3, replaced: 4, seq: 3 });
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(hold!.notice).toBeNull();

    await act(async () => { probeRoot.unmount(); });
    probeHost.remove();
  });
});

describe('the sentence in every language', () => {
  it('names both numbers and carries no em dash', () => {
    for (const locale of Object.keys(DASHBOARD_STRINGS) as Array<keyof typeof DASHBOARD_STRINGS>) {
      const table = DASHBOARD_STRINGS[locale];
      const line = table.restoreDoneNotice(6, 8);
      expect(line, `${locale}`).toContain('6');
      expect(line, `${locale}`).toContain('8');
      expect(line, `${locale}`).not.toContain('—');
      expect(table.restoreDoneDismiss.length, `${locale}`).toBeGreaterThan(2);
      // The singular case must read as a sentence too, not "1 entries".
      expect(table.restoreDoneNotice(1, 1).length, `${locale}`).toBeGreaterThan(20);
    }
  });
});

describe('the dashboard is the one holding it', () => {
  it('keeps the notice outside the tab that unmounts, and hands it back down', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dash = readFileSync(join(process.cwd(), 'src/ui/dashboard/Dashboard.tsx'), 'utf8');
    expect(dash).toContain('const restoreNotice = useRestoreNotice();');
    expect(dash).toContain('restoreNotice={restoreNotice.notice}');
    expect(dash).toContain('onDismissRestoreNotice={restoreNotice.dismiss}');
    expect(dash).toContain('onRestored={(outcome) => { restoreNotice.show(outcome); void load({ quiet: true }); }}');
  });
});
