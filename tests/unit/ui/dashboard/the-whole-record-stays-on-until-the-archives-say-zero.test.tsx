/** @vitest-environment jsdom */
// The head's HOLD on the empty-export fix (9 Oct 2026): the whole-record card went off when the active chain was empty
// and the archive count read 0, but the dashboard starts that count at 0 and fills it in later, and leaves it at 0 when
// the count throws or a month will not open. A person whose records are all in the archives saw "Nothing is recorded
// yet" over a disabled card, for a moment or for good. This mounts the real dashboard with an empty active chain and
// drives the archive count through each answer: the card goes off only on a sure, complete zero.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';

type Count = { count: number; complete: boolean; unreadableMonths: string[] };
const archive = vi.hoisted(() => ({ answer: (): Promise<Count> => Promise.resolve({ count: 0, complete: true, unreadableMonths: [] }) }));

vi.mock('../../../../src/forensics/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/forensics/store')>();
  return {
    ...actual,
    getRecordsFirstPage: vi.fn(async () => []),
    getRecordsDetailed: vi.fn(async () => ({ records: [], unreadable: [] })),
    lastRecordReadFailed: vi.fn(() => false),
    getAllParentFeedback: vi.fn(async () => new Map()),
  };
});
vi.mock('../../../../src/forensics/auto-heal', () => ({ repairRelegatedPositions: vi.fn(async () => undefined) }));
vi.mock('../../../../src/forensics/repair-marker', () => ({ discloseRepairsOnChain: vi.fn(async () => undefined) }));
vi.mock('../../../../src/forensics/chain-integrity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/forensics/chain-integrity')>();
  return { ...actual, verifyChainIntegrity: vi.fn(async () => { throw new Error('not walked in this test'); }) };
});
vi.mock('../../../../src/forensics/archive-reader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/forensics/archive-reader')>();
  return {
    ...actual,
    listArchiveMonths: vi.fn(async () => []),
    countArchivedRecords: vi.fn(() => archive.answer()),
    loadArchivesOldestFirst: vi.fn(async () => []),
  };
});
vi.mock('../../../../src/forensics/archive-summary-store', () => ({
  readMonthSummaries: vi.fn(async () => ({ summaries: [], complete: true })),
}));
vi.mock('../../../../src/forensics/archive-window', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/forensics/archive-window')>();
  return { ...actual, loadArchiveMonths: vi.fn(async () => ({ months: [], unreadableMonths: [] })) };
});
vi.mock('../../../../src/forensics/chain-height-witness', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/forensics/chain-height-witness')>();
  return { ...actual, readChainHeightWitness: vi.fn(async () => null) };
});
vi.mock('../../../../src/forensics/maintenance-health', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/forensics/maintenance-health')>();
  return { ...actual, readMaintenanceHealth: vi.fn(async () => { throw new Error('no storage in this test'); }) };
});
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
vi.mock('../../../../src/forensics/author-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/forensics/author-store')>();
  return { ...actual, getAllAuthorProfiles: vi.fn(async () => []) };
});
vi.mock('../../../../src/storage/license', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/license')>();
  return { ...actual, getLicense: vi.fn(async () => actual.FREE_LICENSE) };
});
vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    getSettings: vi.fn(async () => ({ parentPin: undefined, dashboardTheme: 'dark', uiLanguage: 'en', features: {} }) as unknown as Awaited<ReturnType<typeof actual.getSettings>>),
    saveSettings: vi.fn(async () => undefined),
  };
});
vi.mock('../../../../src/storage/setup-draft', () => ({ clearSetupDraft: vi.fn(async () => undefined) }));

import { DASHBOARD_STRINGS } from '../../../../src/i18n/dashboard-strings';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const t = DASHBOARD_STRINGS.en;

class FakeResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

let host: HTMLElement | null = null;

/** Mounts a fresh dashboard (it mounts itself into #root when its module loads) and opens the Export tab. */
async function exportTab(): Promise<HTMLElement> {
  vi.resetModules();
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: vi.fn(async (msg: { type: string }) => (msg.type === 'GET_SIGNING_METADATA' ? { ok: true, metadata: { fingerprint: 'fp', createdAt: null } } : undefined)),
      lastError: null,
    },
    storage: {
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) },
      onChanged: { addListener: () => undefined, removeListener: () => undefined },
    },
  });
  host = document.createElement('div');
  host.id = 'root';
  document.body.appendChild(host);
  await act(async () => { await import('../../../../src/ui/dashboard/Dashboard'); });
  await settle();
  const tab = Array.from(host.querySelectorAll('[role="tab"]')).find((b) => b.textContent?.trim().startsWith(t.tabExport));
  if (!tab) throw new Error('no Export tab');
  await act(async () => { (tab as HTMLElement).click(); });
  await settle();
  return host;
}
function wholeRecordCard(root: HTMLElement): HTMLButtonElement {
  const card = root.querySelector<HTMLButtonElement>('button[data-export="everything"]');
  if (!card) throw new Error('no whole-record card');
  return card;
}

afterEach(() => {
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
});

describe('the whole-record card on a dashboard with no active record', () => {
  it('goes off, and says nothing is recorded, when the archives were counted completely and hold none', async () => {
    archive.answer = () => Promise.resolve({ count: 0, complete: true, unreadableMonths: [] });
    const root = await exportTab();
    expect(wholeRecordCard(root).disabled).toBe(true);
    expect(wholeRecordCard(root).textContent).toContain(t.exportNothingRecorded);
  });

  it('stays on while the archives are still being counted', async () => {
    archive.answer = () => new Promise<Count>(() => {});
    const root = await exportTab();
    expect(wholeRecordCard(root).disabled).toBe(false);
    expect(root.textContent).not.toContain(t.exportNothingRecorded);
  });

  it('stays on when the count throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    archive.answer = () => Promise.reject(new Error('the archive store would not open'));
    const root = await exportTab();
    expect(wholeRecordCard(root).disabled).toBe(false);
    expect(root.textContent).not.toContain(t.exportNothingRecorded);
  });

  it('stays on when a month would not open, so the zero is only a floor', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    archive.answer = () => Promise.resolve({ count: 0, complete: false, unreadableMonths: ['2026-08'] });
    const root = await exportTab();
    expect(wholeRecordCard(root).disabled).toBe(false);
    expect(root.textContent).not.toContain(t.exportNothingRecorded);
  });

  it('stays on when the archives hold records', async () => {
    archive.answer = () => Promise.resolve({ count: 250, complete: true, unreadableMonths: [] });
    const root = await exportTab();
    expect(wholeRecordCard(root).disabled).toBe(false);
  });
});
