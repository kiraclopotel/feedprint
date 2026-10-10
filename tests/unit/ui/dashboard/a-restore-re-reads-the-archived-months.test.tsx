/** @vitest-environment jsdom */
// A restore retires the outgoing chain into the month archives before it writes
// the backup's records. The dashboard's re-read after it has to read those
// months again: counted against the archive set it read before the restore, a
// record now in both lists is added to itself and every all-time figure grows.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { ForensicRecord } from '../../../../src/types/forensic';

vi.mock('../../../../src/forensics/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/forensics/store')>();
  return {
    ...actual,
    getRecordsFirstPage: vi.fn(async () => state.live),
    getRecordsDetailed: vi.fn(async () => ({ records: state.live, unreadable: [] })),
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
    listArchiveMonths: vi.fn(async () => (state.archived.length > 0 ? [MONTH] : [])),
    countArchivedRecords: vi.fn(async () => ({ count: state.archived.length, complete: true, unreadableMonths: [] })),
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
    loadArchiveMonths: vi.fn(async (keys: readonly string[]) => ({
      months: keys.includes(MONTH) ? [{ monthKey: MONTH, records: state.archived }] : [],
      unreadableMonths: [],
    })),
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

import { loadArchiveMonths } from '../../../../src/forensics/archive-window';
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

// Before the restore: a live chain of two and no archived month.
const state: { live: ForensicRecord[]; archived: ForensicRecord[] } = {
  live: [record('a', 0), record('d', 1)],
  archived: [],
};

const restoreAnswers: unknown[] = [];
const sendMessage = vi.fn(async (msg: { type: string }) => {
  switch (msg.type) {
    case 'GET_SIGNING_METADATA': return { ok: true, metadata: { fingerprint: 'fp', createdAt: null } };
    case 'RESTORE_FORENSIC_BACKUP': return restoreAnswers.shift();
    default: return undefined;
  }
});

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

function button(text: string): HTMLButtonElement {
  const btn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);
  if (!btn) throw new Error(`no button "${text}"`);
  return btn;
}

function tab(label: string): HTMLElement {
  const el = Array.from(host.querySelectorAll('[role="tab"]')).find((b) => b.textContent?.trim().startsWith(label));
  if (!el) throw new Error(`no tab "${label}"`);
  return el as HTMLElement;
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => { el.click(); });
  await settle();
}

beforeAll(async () => {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.stubGlobal('chrome', {
    runtime: { sendMessage, lastError: null },
    storage: {
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) },
      onChanged: { addListener: () => undefined, removeListener: () => undefined },
    },
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
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

describe('a restore re-reads the archived months', () => {
  it('counts each record once after the outgoing chain was filed into a month', async () => {
    await click(tab(t.tabStatistics));
    expect(host.textContent).toContain(t.statsAllTime('2'));
    const readsBefore = vi.mocked(loadArchiveMonths).mock.calls.length;

    await click(tab(t.tabExport));
    restoreAnswers.push(
      {
        ok: true,
        result: {
          ok: false, needsConfirm: true, existingRealCount: 2,
          recordsAdded: 0, recordsSkipped: 0, anchorsAdded: 0, feedbackRestored: 0,
          chainVerified: false, keyRestored: false,
        },
      },
      {
        ok: true,
        result: {
          ok: true, recordsAdded: 3, recordsSkipped: 0, existingRealCount: 2,
          anchorsAdded: 0, feedbackRestored: 0, chainVerified: true, keyRestored: true,
        },
      },
    );
    const input = host.querySelector('input[type="file"][accept*="json"]') as HTMLInputElement;
    const file = new File(['{"schemaVersion":1,"records":[]}'], 'backup.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await settle();
    // What the worker leaves behind: the outgoing chain filed into its month, the backup's three records live.
    state.archived = [record('a', 0), record('d', 1)];
    state.live = [record('a', 0), record('d', 1), record('e', 2)];

    await click(button(t.restoreAnyway));
    await click(tab(t.tabStatistics));

    expect(vi.mocked(loadArchiveMonths).mock.calls.length, 'the archived months were read again').toBeGreaterThan(readsBefore);
    expect(host.textContent).toContain(t.statsAllTime('3'));
  });
});
