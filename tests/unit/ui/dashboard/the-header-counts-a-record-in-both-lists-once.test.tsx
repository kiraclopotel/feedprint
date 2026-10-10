/** @vitest-environment jsdom */
// After a restore the outgoing chain sits in the month archives while the
// backup's copies of the same records sit in the live chain. The Statistics and
// Record tabs count such a record once; the header's Records chip has to give
// the same total, or one screen shows two sizes for one record.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { ForensicRecord } from '../../../../src/types/forensic';

vi.mock('../../../../src/forensics/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/forensics/store')>();
  return {
    ...actual,
    getRecordsFirstPage: vi.fn(async () => LIVE),
    getRecordsDetailed: vi.fn(async () => ({ records: LIVE, unreadable: [] })),
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
    listArchiveMonths: vi.fn(async () => [MONTH]),
    countArchivedRecords: vi.fn(async () => ({ count: ARCHIVED.length, complete: true, unreadableMonths: [] })),
    loadArchivesOldestFirst: vi.fn(async () => []),
  };
});
vi.mock('../../../../src/forensics/archive-summary-store', () => ({
  readMonthSummaries: vi.fn(async () => ({ summaries: [], complete: true })),
}));
vi.mock('../../../../src/forensics/archive-window', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/forensics/archive-window')>();
  return {
    ...actual,
    loadArchiveMonths: vi.fn(async () => ({ months: [{ monthKey: MONTH, records: ARCHIVED }], unreadableMonths: [] })),
  };
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
    getSettings: vi.fn(async () => ({ dashboardTheme: 'dark', uiLanguage: 'en', features: {} }) as unknown as Awaited<ReturnType<typeof actual.getSettings>>),
    saveSettings: vi.fn(async () => undefined),
  };
});

import { DASHBOARD_STRINGS } from '../../../../src/i18n/dashboard-strings';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = DASHBOARD_STRINGS.en;
// The current month, so it always falls inside the window of months the dashboard reads.
const MONTH = new Date().toISOString().slice(0, 7);

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

// The restored live chain holds a and d; the archive holds the retired copy of a.
const LIVE = [record('a', 0), record('d', 1)];
const ARCHIVED = [record('a', 0)];

class FakeResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let host: HTMLElement;

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
};

function tab(label: string): HTMLElement {
  const el = Array.from(host.querySelectorAll('[role="tab"]')).find((b) => b.textContent?.trim().startsWith(label));
  if (!el) throw new Error(`no tab "${label}"`);
  return el as HTMLElement;
}

const headerCount = (): string | null | undefined =>
  host.querySelector('.pg-records-chip .pg-trust-chip-count')?.textContent;

beforeAll(async () => {
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
  host = document.createElement('div');
  host.id = 'root';
  document.body.appendChild(host);
  // The dashboard mounts itself into #root when its module loads.
  await act(async () => { await import('../../../../src/ui/dashboard/Dashboard'); });
  await settle();
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the header counts a record held in both lists once', () => {
  it('gives the same total as the Statistics tab once the archived months are read', async () => {
    await act(async () => { tab(t.tabStatistics).click(); });
    await settle();

    expect(host.textContent).toContain(t.statsAllTime('2'));
    expect(headerCount()).toBe('2');
  });
});
