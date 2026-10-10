/** @vitest-environment jsdom */
// The re-read after a reset, restore or withhold must leave that action's own
// result on the screen, because it is the one sentence that tells a parent what
// the action did. This mounts the real dashboard and drives each action through
// its own controls.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { ForensicRecord } from '../../../../src/types/forensic';
import type { ResetChainResult } from '../../../../src/types/chain-reset';

vi.mock('../../../../src/forensics/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/forensics/store')>();
  return {
    ...actual,
    getRecordsFirstPage: vi.fn(async () => [RECORD]),
    getRecordsDetailed: vi.fn(async () => ({ records: [RECORD], unreadable: [] })),
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
    countArchivedRecords: vi.fn(async () => ({ count: 0, complete: true, unreadableMonths: [] })),
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
  // No PIN: the reset is confirmed by typing the word.
  return {
    ...actual,
    getSettings: vi.fn(async () => ({ parentPin: undefined, dashboardTheme: 'dark', uiLanguage: 'en', features: {} }) as unknown as Awaited<ReturnType<typeof actual.getSettings>>),
    saveSettings: vi.fn(async () => undefined),
  };
});
vi.mock('../../../../src/storage/setup-draft', () => ({ clearSetupDraft: vi.fn(async () => undefined) }));

import { getRecordsDetailed } from '../../../../src/forensics/store';
import { DASHBOARD_STRINGS } from '../../../../src/i18n/dashboard-strings';
import { dashboardWords } from '../../../../src/ui/dashboard/dashboard-words';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = DASHBOARD_STRINGS.en;

const RECORD = {
  id: 'fr-1',
  timestamp: '2026-09-20T10:00:00.000Z',
  platform: 'twitter',
  originalText: 'a post the parent reviews',
  originalHash: 'h',
  originalLength: 25,
  neutralizedText: '',
  author: 'someone',
  postUrl: 'https://x.com/someone/status/1',
  techniques: [],
  overallScore: 0,
  verdict: 'pass',
  userAgeCategory: 'teen',
  aiSource: 'cloud',
  feedSource: 'foryou',
  prevRecordHash: '0'.repeat(64),
  chainPosition: 0,
  chainAnchor: 'genesis-v1',
  kind: 'post',
  integrityHash: 'ih-1',
} as unknown as ForensicRecord;

/** The chain was reset; the scan log could not be emptied. */
const PARTIAL_RESET: ResetChainResult = {
  recordsCleared: 1,
  recordsArchived: 1,
  signingIdentityRetained: true,
  scanLogCleared: false,
  authorProfilesCleared: true,
  verdictsCleared: true,
  diagnosticsCleared: true,
  usageStatsCleared: true,
  resetMarkerWritten: true,
  parentFeedbackCleared: true,
  chainAnchorsCleared: true,
};

const restoreAnswers: unknown[] = [];
const sendMessage = vi.fn(async (msg: { type: string }) => {
  switch (msg.type) {
    case 'GET_SIGNING_METADATA': return { ok: true, metadata: { fingerprint: 'fp', createdAt: null } };
    case 'REDACTION_MARKER': return { ok: true };
    case 'RESTORE_FORENSIC_BACKUP': return restoreAnswers.shift();
    case 'RESET_FORENSIC_CHAIN': return { ok: true, result: PARTIAL_RESET };
    default: return undefined;
  }
});

class FakeResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let host: HTMLElement;

/** Let every pending promise and zero-delay timer run, including the re-read an action starts. */
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

/** How many times the dashboard has read the whole record so far. */
const reads = (): number => vi.mocked(getRecordsDetailed).mock.calls.length;

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
  expect(host.textContent).toContain(t.tabExport);
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a reload after an action keeps what the action said', () => {
  it('keeps the withheld confirmation under the row it was set from', async () => {
    // The rows and their withhold moved from the Record tab to the Feed log on 10 Oct 2026.
    await click(tab(t.tabFeedLog));
    await click(host.querySelector('[data-testid="feed-log-window-all"]') as HTMLElement);
    await click(host.querySelector('[data-testid="feed-log-row"]') as HTMLElement);
    vi.stubGlobal('prompt', () => 'a reason');
    const before = reads();

    await click(button(t.withholdBtn));

    expect(reads(), 'the record was read again').toBeGreaterThan(before);
    expect(host.textContent).toContain(t.withholdDone);
  });

  it('keeps the restore details on the export tab', async () => {
    await click(tab(t.tabExport));
    restoreAnswers.push(
      {
        ok: true,
        result: {
          ok: false, needsConfirm: true, existingRealCount: 1,
          recordsAdded: 0, recordsSkipped: 0, anchorsAdded: 0, feedbackRestored: 0,
          chainVerified: false, keyRestored: false,
        },
      },
      {
        ok: true,
        result: {
          ok: true, recordsAdded: 6, recordsSkipped: 0, existingRealCount: 1,
          anchorsAdded: 0, feedbackRestored: 0, chainVerified: true, keyRestored: true,
        },
      },
    );
    const input = host.querySelector('input[type="file"][accept*="json"]') as HTMLInputElement;
    const file = new File(['{"schemaVersion":1,"records":[]}'], 'backup.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await settle();
    const before = reads();

    await click(button(t.restoreAnyway));

    expect(reads(), 'the record was read again').toBeGreaterThan(before);
    expect(host.textContent).toContain(t.restoredMsg(6, 0, 0, t.restoreChainIntact, t.restoreKeyRestored));
  });

  it('keeps the partial reset warning and does not ask for the reset again', async () => {
    await click(button(dashboardWords('en').resetLabel));
    const word = host.querySelector('[data-testid="reset-confirm-word"]') as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(word, 'reset');
      word.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const before = reads();

    await click(host.querySelector('[data-testid="reset-confirm-word-btn"]') as HTMLElement);

    expect(reads(), 'the record was read again').toBeGreaterThan(before);
    expect(host.textContent).toContain(`${t.resetPartial} (${t.resetPartScanLog})`);
    expect(host.querySelector('[data-testid="reset-confirm-word-btn"]'), 'no second confirmation is asked for').toBeNull();
    expect(sendMessage.mock.calls.filter(([m]) => m.type === 'RESET_FORENSIC_CHAIN')).toHaveLength(1);
  });
});
