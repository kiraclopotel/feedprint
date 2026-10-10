/** @vitest-environment jsdom */
// A free install is not offered the AI reading (ai-wording.ts), so no tab may speak of it: a word about something a
// person cannot have reads first as a fault and then as an upsell. The whole dashboard is mounted on a free licence,
// in all four languages, over records a free install writes (the built-in filter's verdicts, no reading, no model),
// and every tab is opened and read as a person sees it.
//
// "AI" and "IA" are matched with their case and as whole words, because "ai" is an ordinary Romanian word ("ai
// văzut"). The other words are matched in any case. A record saved under a licence may still say what read it; these
// records were not.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { ForensicRecord } from '../../../../src/types/forensic';

let LANG: 'en' | 'ro' | 'es' | 'pt-BR' = 'en';
let LIVE: ForensicRecord[] = [];
let TIER: 'free' | 'starter' = 'free';

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
vi.mock('../../../../src/forensics/auto-heal', () => ({ repairRelegatedPositions: vi.fn(async () => undefined), readHealLog: vi.fn(async () => []) }));
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
  return { ...actual, getBackupHealth: vi.fn(async () => ({ lastSuccessAt: '2026-09-20T09:00:00.000Z' })), mirrorBackupToWiredFolder: vi.fn(async () => 'skipped') };
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
  return { ...actual, getLicense: vi.fn(async () => (TIER === 'free' ? actual.FREE_LICENSE : { tier: TIER, secret: 'test-only' })) };
});
vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    getSettings: vi.fn(async () => ({ dashboardTheme: 'light', uiLanguage: LANG, features: {} }) as unknown as Awaited<ReturnType<typeof actual.getSettings>>),
    saveSettings: vi.fn(async () => undefined),
  };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// AI-made videos are a thing a free install can block by its own switch, not the AI reading. The phrase is let through
// only where it names that block, beside "videos" or in the blocked list before "reels/shorts", so the same words
// anywhere else still fail.
const AI_MADE = /AI-content videos|AI content(?=, reels\/shorts)|[Vv]ideoclipuri(?:le)? cu conținut AI|conținut AI(?=, reels\/shorts)|[Vv]ideos con contenido de IA|contenido de IA(?=, reels\/shorts)|[Vv]ídeos com conteúdo de IA|conteúdo de IA(?=, reels\/shorts)/g;
const CASED = /\bAI\b|\bIA\b/;
const ANY_CASE = /reading|lectura|leitura|citire|\bmodel|\bmodelo|\bBETA\b/i;

function rec(n: number, over: Partial<ForensicRecord> & Record<string, unknown>): ForensicRecord {
  return {
    id: `r${n}`,
    timestamp: `2026-09-20T10:${String(10 + n).padStart(2, '0')}:00.000Z`,
    platform: 'twitter',
    originalText: `an ordinary post ${n}`,
    originalHash: `h${n}`,
    originalLength: 20,
    neutralizedText: '',
    author: `someone${n}`,
    postUrl: `https://x.com/someone/status/${n + 1}`,
    techniques: [],
    overallScore: 0,
    verdict: 'pass',
    userAgeCategory: 'teen',
    aiSource: 'rules',
    feedSource: 'foryou',
    prevRecordHash: '0'.repeat(64),
    chainPosition: n,
    chainAnchor: 'genesis-v1',
    kind: 'post',
    integrityHash: `ih${n}`,
    ...over,
  } as unknown as ForensicRecord;
}

class FakeResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }

let host: HTMLElement;

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

async function openDashboard(): Promise<void> {
  vi.resetModules();
  host = document.createElement('div');
  host.id = 'root';
  document.body.appendChild(host);
  await act(async () => { await import('../../../../src/ui/dashboard/Dashboard'); });
  await settle();
}

/**
 * What a person reads on the open tab, closed folds included: the Issues tab's support fold is read too, because a free
 * install's fold leaves out the AI allowance and the provider's errors (OperationalEventsPanel) and must stay that way.
 */
function shownText(): string {
  return (host.textContent ?? '').replace(AI_MADE, '');
}

/** Opens every tab in turn and returns each AI word it shows, and each tab that fell into its error box instead. */
async function readEveryTab(): Promise<string[]> {
  const tabs = [...host.querySelectorAll<HTMLElement>('[role="tab"]')];
  expect(tabs.length).toBeGreaterThan(5);
  const hits: string[] = [];
  for (const tab of tabs) {
    await act(async () => { tab.click(); });
    await settle();
    // A tab that fell into its error box would pass while saying nothing at all.
    if (host.querySelector('.fw-panel-failed')) hits.push(tab.id + ': the tab failed to draw');
    const text = shownText();
    for (const re of [CASED, ANY_CASE]) {
      const m = re.exec(text);
      if (m) hits.push(`${tab.id}: …${text.slice(Math.max(0, m.index - 50), m.index + 40)}…`);
    }
  }
  return hits;
}

beforeEach(() => {
  LIVE = [
    rec(0, {}),
    rec(1, { verdict: 'flagged', overallScore: 6, techniques: [{ name: 'fear-appeal', severity: 6 }] as unknown as ForensicRecord['techniques'] }),
    rec(2, { kind: 'comment', platform: 'facebook' }),
    rec(3, { kind: 'video', platform: 'youtube' }),
    rec(4, { platform: 'instagram', verdict: 'blocked' }),
  ];
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

describe.each(['en', 'ro', 'es', 'pt-BR'] as const)('%s: a free install meets no AI word on any tab', (lang) => {
  it('every tab, opened as a person opens it, says nothing of the AI, a reading, a model or a beta', async () => {
    LANG = lang;
    TIER = 'free';
    await openDashboard();
    expect(await readEveryTab()).toEqual([]);
  }, 60_000);

  it('an empty record, no archives, opens every tab without a failure and without an AI word', async () => {
    LANG = lang;
    TIER = 'free';
    LIVE = [];
    await openDashboard();
    expect(await readEveryTab()).toEqual([]);
  }, 60_000);
});

// The check above would pass as well if the words could never be seen. A licensed install with a record the cloud model
// read must meet them through the same walk.
describe('the walk sees the AI words where they belong', () => {
  it('a licensed install over a record the model read shows AI words on its tabs', async () => {
    LANG = 'en';
    TIER = 'starter';
    LIVE = [...LIVE, rec(5, { aiSource: 'cloud', verdict: 'flagged', overallScore: 7, techniques: [{ name: 'fear-appeal', severity: 7 }] as unknown as ForensicRecord['techniques'] })];
    await openDashboard();
    const hits = await readEveryTab();
    expect(hits.filter((h) => h.endsWith('failed to draw'))).toEqual([]);
    expect(hits.length).toBeGreaterThan(0);
  }, 60_000);
});
