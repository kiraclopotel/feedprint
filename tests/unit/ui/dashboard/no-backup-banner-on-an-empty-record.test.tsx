/** @vitest-environment jsdom */
// A new install with 0 entries has nothing to back up, and the daily copy skips
// an empty chain on purpose, so "no copy yet" is not news there. The banner
// belongs to a record that has something to back up and no copy: entries,
// archived entries, or a stored row that will not decode. It stays for those,
// and for a copy that failed. It stays hidden when a wired folder copy exists
// (the daily copy is skipped while that one is current). A store that could
// not be read reads 0 entries, which says nothing, so it does not hide it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { ForensicRecord } from '../../../../src/types/forensic';

let LIVE: ForensicRecord[] = [];
let BACKUP_HEALTH: Record<string, unknown> = {};
let UNREADABLE: Array<{ chainPosition: number; recordsBefore: number }> = [];
let ARCHIVED_COUNT = 0;
let WIRE_STATE: 'none' | 'ready' = 'none';
let READ_FAILS = false;

vi.mock('../../../../src/forensics/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/forensics/store')>();
  return {
    ...actual,
    getRecordsFirstPage: vi.fn(async () => LIVE),
    getRecordsDetailed: vi.fn(async () => {
      if (READ_FAILS) throw new Error('the store will not open');
      return { records: LIVE, unreadable: UNREADABLE };
    }),
    lastRecordReadFailed: vi.fn(() => READ_FAILS),
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
    countArchivedRecords: vi.fn(async () => ({ count: ARCHIVED_COUNT, complete: true, unreadableMonths: [] })),
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
    getBackupHealth: vi.fn(async () => BACKUP_HEALTH),
    mirrorBackupToWiredFolder: vi.fn(async () => 'skipped'),
  };
});
vi.mock('../../../../src/forensics/backup-folder-wire', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/forensics/backup-folder-wire')>();
  return { ...actual, getBackupFolderWireStatus: vi.fn(async () => (WIRE_STATE === 'ready' ? { state: 'ready' as const, folderName: 'Backups' } : { state: 'none' as const })) };
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
    getSettings: vi.fn(async () => ({ dashboardTheme: 'dark', uiLanguage: 'en', features: {} }) as unknown as Awaited<ReturnType<typeof actual.getSettings>>),
    saveSettings: vi.fn(async () => undefined),
  };
});

import { DASHBOARD_STRINGS } from '../../../../src/i18n/dashboard-strings';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = DASHBOARD_STRINGS.en;

function record(id: string, chainPosition: number): ForensicRecord {
  return {
    id,
    timestamp: `2026-09-20T10:0${chainPosition}:00.000Z`,
    platform: 'twitter',
    originalText: `post ${id}`,
    originalHash: `h-${id}`,
    originalLength: 6,
    neutralizedText: '',
    author: 'someone',
    postUrl: `https://x.com/someone/status/${chainPosition + 1}`,
    techniques: [],
    overallScore: 0,
    verdict: 'pass',
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'foryou',
    prevRecordHash: '0'.repeat(64),
    chainPosition,
    chainAnchor: 'genesis-v1',
    kind: 'post',
    integrityHash: `ih-${id}`,
  } as unknown as ForensicRecord;
}

class FakeResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let host: HTMLElement;

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
};

/** Mount a fresh dashboard: the module mounts itself into #root when it loads. */
async function openDashboard(): Promise<void> {
  vi.resetModules();
  host = document.createElement('div');
  host.id = 'root';
  document.body.appendChild(host);
  await act(async () => { await import('../../../../src/ui/dashboard/Dashboard'); });
  await settle();
}

// The first-backup reminder sits inside the Overview and Export panels, not over every tab (readers named it noise
// there), so the cases that expect it open the Overview first.
async function openOverview(): Promise<void> {
  const tab = host.querySelector('#dash-tab-overview') as HTMLElement | null;
  await act(async () => { tab?.click(); });
  await settle();
}

beforeEach(() => {
  LIVE = [];
  BACKUP_HEALTH = {};
  UNREADABLE = [];
  ARCHIVED_COUNT = 0;
  WIRE_STATE = 'none';
  READ_FAILS = false;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: vi.fn(async (msg: { type: string }) => (msg.type === 'GET_SIGNING_METADATA'
        ? { ok: true, metadata: { fingerprint: 'fp', createdAt: null } }
        : undefined)),
      lastError: null,
    },
    storage: {
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) },
      onChanged: { addListener: () => undefined, removeListener: () => undefined },
    },
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  host.remove();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the backup banner waits for something to back up', () => {
  it('shows no banner while the record has 0 entries, though no copy has ever run', async () => {
    LIVE = [];
    BACKUP_HEALTH = {};
    await openDashboard();

    // The dashboard did load: its tabs are there. Only then does absence mean anything.
    expect(host.querySelectorAll('[role="tab"]').length).toBeGreaterThan(0);
    expect(host.querySelector('.dash-attention')).toBeNull();
    expect(host.textContent).not.toContain(t.attnBackupNeverTitle);
  });

  it('still shows the banner for a record with entries and no copy', async () => {
    LIVE = [record('a', 0)];
    BACKUP_HEALTH = {};
    await openDashboard();
    await openOverview();

    expect(host.querySelectorAll('[role="tab"]').length).toBeGreaterThan(0);
    expect(host.querySelector('.dash-attention')).not.toBeNull();
    expect(host.querySelector('.dash-attention-title')?.textContent).toBe(t.attnBackupNeverTitle);
  });

  it('still shows the banner at 0 live entries when a stored row will not decode', async () => {
    UNREADABLE = [{ chainPosition: 0, recordsBefore: 0 }];
    await openDashboard();
    await openOverview();

    expect(host.querySelectorAll('[role="tab"]').length).toBeGreaterThan(0);
    expect(host.querySelector('.dash-attention-title')?.textContent).toBe(t.attnBackupNeverTitle);
  });

  it('still shows the banner at 0 live entries when the archives hold 5', async () => {
    ARCHIVED_COUNT = 5;
    await openDashboard();
    await openOverview();

    expect(host.querySelectorAll('[role="tab"]').length).toBeGreaterThan(0);
    expect(host.querySelector('.dash-attention-title')?.textContent).toBe(t.attnBackupNeverTitle);
  });

  it('keeps the first-backup reminder off the timeline, where it was named as noise', async () => {
    LIVE = [record('a', 0)];
    BACKUP_HEALTH = {};
    await openDashboard();

    expect(host.querySelectorAll('[role="tab"]').length).toBeGreaterThan(0);
    expect(host.textContent).not.toContain(t.attnBackupNeverTitle);
  });

  it('shows no "not backed up" banner when a wired folder is ready, though the daily copy has not run', async () => {
    LIVE = [record('a', 0)];
    WIRE_STATE = 'ready';
    await openDashboard();

    expect(host.querySelectorAll('[role="tab"]').length).toBeGreaterThan(0);
    expect(host.textContent).not.toContain(t.attnBackupNeverTitle);
  });

  it('still shows the banner when the store could not be read, since the 0 counts say nothing then', async () => {
    READ_FAILS = true;
    await openDashboard();
    await openOverview();

    expect(host.querySelectorAll('[role="tab"]').length).toBeGreaterThan(0);
    expect(host.querySelector('.dash-attention-title')?.textContent).toBe(t.attnBackupNeverTitle);
  });

  it('still shows a copy that failed, even on a record with 0 entries', async () => {
    LIVE = [];
    BACKUP_HEALTH = { lastStatus: 'error', lastError: 'quota' };
    await openDashboard();

    expect(host.querySelector('.dash-attention-title')?.textContent).toBe(t.attnBackupFailingTitle);
  });
});
