/** @vitest-environment jsdom */
// The nightly prune's two ways of reaching the attention line, as a person reads them. A refusal that repeats says how
// many runs failed and why. An entry that is only old, because the job did not run, says how many days and that
// nothing was lost; it said "the last 0 attempts ... failed (no-recent-prune)" while it shared the refusal's words.
// Both carry the button that runs the prune, because a backup does not clear either and the record check has no
// button for it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { ForensicRecord } from '../../../../src/types/forensic';

let LIVE: ForensicRecord[] = [];
let BACKUP_HEALTH: Record<string, unknown> = {};
let UNREADABLE: Array<{ chainPosition: number; recordsBefore: number }> = [];
let ARCHIVED_COUNT = 0;
let WIRE_STATE: 'none' | 'ready' = 'none';
let READ_FAILS = false;
let HEALTH: Record<string, unknown> = {};
let TIDY_ANSWER: { ok: boolean } | undefined = { ok: true };
const sent: string[] = [];

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
  return { ...actual, readMaintenanceHealth: vi.fn(async () => HEALTH) };
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


const daysAgo = (d: number): string => new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();
const topCard = (): HTMLElement | null => host.querySelector('.dash-attention');

beforeEach(() => {
  LIVE = [record('a', 0)];
  BACKUP_HEALTH = { lastStatus: 'ok', lastAt: new Date().toISOString(), lastCount: 1, lastAutoCoverage: 'full', everPassphrase: true };
  UNREADABLE = [];
  ARCHIVED_COUNT = 0;
  WIRE_STATE = 'ready';
  READ_FAILS = false;
  HEALTH = {};
  TIDY_ANSWER = { ok: true };
  sent.length = 0;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'fw-test',
      sendMessage: vi.fn(async (msg: { type: string }) => {
        sent.push(msg.type);
        if (msg.type === 'RUN_RECORD_TIDY') return TIDY_ANSWER;
        return msg.type === 'GET_SIGNING_METADATA' ? { ok: true, metadata: { fingerprint: 'fp', createdAt: null } } : undefined;
      }),
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

describe('the nightly prune on the attention line', () => {
  it('an entry four days old, with no refusal, says the days and that nothing was lost, not "0 attempts failed"', async () => {
    HEALTH = { prune: { at: daysAgo(4.2), ok: true, refusedInARow: 0 } };
    await openDashboard();
    const card = topCard();
    expect(card, 'the card is shown').not.toBeNull();
    expect(card?.querySelector('.dash-attention-title')?.textContent).toBe(t.attnPruneStaleTitle(4));
    expect(card?.querySelector('.dash-attention-body')?.textContent).toBe(t.attnPruneStaleBody);
    expect(card?.textContent).not.toContain('no-recent-prune');
    expect(card?.textContent).not.toMatch(/\b0 attempts\b/);
    expect(card?.querySelector('.dash-attention-cta')?.textContent).toBe(t.attnRunTidyNow);
  });

  it('a refusal that repeated twice says the runs in plain words, and no reason code', async () => {
    HEALTH = { prune: { at: daysAgo(0.2), ok: false, reason: 'archive-mismatch', refusedInARow: 2 } };
    await openDashboard();
    const card = topCard();
    expect(card?.querySelector('.dash-attention-title')?.textContent).toBe(t.attnPruneStuckTitle);
    expect(card?.querySelector('.dash-attention-body')?.textContent).toBe(t.attnPruneStuckBody(2));
    expect(card?.textContent).not.toContain('archive-mismatch');
    expect(card?.querySelector('.dash-attention-cta')?.textContent).toBe(t.attnRunTidyNow);
  });

  it('an old entry that was refused once says it was refused, not that it has not run', async () => {
    HEALTH = { prune: { at: daysAgo(4.2), ok: false, reason: 'archive-mismatch', refusedInARow: 1 } };
    await openDashboard();
    const card = topCard();
    expect(card?.querySelector('.dash-attention-title')?.textContent).toBe(t.attnPruneStuckTitle);
    expect(card?.querySelector('.dash-attention-body')?.textContent).toBe(t.attnPruneStuckBody(1));
    expect(card?.textContent).not.toMatch(/has not run/);
  });

  it('the card is one title, one sentence and one button: the heading above it is spoken, not shown', async () => {
    HEALTH = { prune: { at: daysAgo(4.2), ok: true, refusedInARow: 0 } };
    await openDashboard();
    const card = topCard();
    expect(card?.getAttribute('aria-label')).toBe(t.attnTitle);
    expect(card?.textContent).not.toContain(t.attnTitle);
    expect(card?.querySelectorAll('button.btn')).toHaveLength(1);
  });

  it('the button runs the prune and says Done when the run recorded ok', async () => {
    HEALTH = { prune: { at: daysAgo(4.2), ok: true, refusedInARow: 0 } };
    await openDashboard();
    await act(async () => { (topCard()?.querySelector('.dash-attention-cta') as HTMLElement).click(); });
    await settle();
    expect(sent).toContain('RUN_RECORD_TIDY');
    expect(host.textContent).toContain(t.attnDone);
  });

  it('a run that did not record ok leaves the button, and says nothing is done', async () => {
    HEALTH = { prune: { at: daysAgo(4.2), ok: true, refusedInARow: 0 } };
    TIDY_ANSWER = { ok: false };
    await openDashboard();
    await act(async () => { (topCard()?.querySelector('.dash-attention-cta') as HTMLElement).click(); });
    await settle();
    expect(sent).toContain('RUN_RECORD_TIDY');
    expect(host.textContent).not.toContain(t.attnDone);
    expect(topCard()?.querySelector('.dash-attention-cta')?.textContent).toBe(t.attnRunTidyNow);
  });
});
