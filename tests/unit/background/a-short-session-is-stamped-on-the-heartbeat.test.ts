// @vitest-environment jsdom
//
// A person who reads half an hour a day may never be in the browser when the six-hourly stamp alarm comes round,
// so the 15-minute heartbeat asks for a stamp once six hours have passed since the last one. This fires the
// heartbeat through the real service worker and watches whether the chain head is sent to be stamped: yes after six
// hours, no sooner, not again within the hour after an attempt, and never at Strict.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const SETTINGS = vi.hoisted(() => ({ mode: 'adult' as string }));
const LATEST = vi.hoisted(() => ({ anchor: null as null | { requestedAt: string } }));

vi.mock('../../../src/storage/settings', () => ({
  incrementNeutralized: vi.fn(async () => undefined),
  applyUsageIncrement: vi.fn(async () => undefined),
  getSettings: vi.fn(async () => ({ totalNeutralizedToday: 0, parentPin: null, mode: SETTINGS.mode })),
  verifyPin: vi.fn(async () => true),
}));

vi.mock('../../../src/forensics/author-store', () => ({
  getAuthorProfile: vi.fn(async () => null),
  updateAuthorProfile: vi.fn(async () => null),
}));

vi.mock('../../../src/forensics/scan-log', () => ({
  logScanEvent: vi.fn(async () => undefined),
  purgeScanEvents: vi.fn(async () => 0),
}));

vi.mock('../../../src/forensics/store', () => ({
  pruneRecordsToCap: vi.fn(async () => 0),
  getRecords: vi.fn(async () => []),
  getRecordsOrThrow: vi.fn(async () => []),
  lastRecordReadFailed: vi.fn(() => false),
  resetForensicChain: vi.fn(async () => ({
    recordsCleared: 0,
    signingIdentityRetained: true,
    resetMarkerWritten: true,
  })),
}));

vi.mock('../../../src/forensics/chain-rotation', () => ({
  rotateChainAtMonthFlip: vi.fn(async () => ({ rotated: false, reason: 'no-rotation-needed' as const })),
}));

vi.mock('../../../src/forensics/chain-debug-stats', () => ({
  buildChainDebugStatsResponse: vi.fn(() => ({ ok: true })),
}));

vi.mock('../../../src/forensics/chain-anchor-store', async (importOriginal) => ({
  anchorDueOnHeartbeat: (await importOriginal<typeof import('../../../src/forensics/chain-anchor-store')>()).anchorDueOnHeartbeat,
  getLatestAnchor: vi.fn(async () => LATEST.anchor),
  anchorChainHead: vi.fn(async () => ({ status: 'skipped' as const, reason: 'no_chained_records' })),
}));

vi.mock('../../../src/background/heartbeat', () => ({
  runHeartbeat: vi.fn(async () => ({ status: 'written', wroteGap: false })),
}));

vi.mock('../../../src/background/chain-height', () => ({
  checkChainHeight: vi.fn(async () => undefined),
  checkChainHeightOnRealmStart: vi.fn(async () => undefined),
}));

vi.mock('../../../src/forensics/key-genesis', () => ({
  ensureKeyGenesisAnchor: vi.fn(async () => ({ status: 'skipped', reason: 'test' })),
}));

vi.mock('../../../src/forensics/backup', () => ({
  autoBackupToDownloads: vi.fn(async () => ({ status: 'skipped' as const, reason: 'empty' })),
  restoreFromBackup: vi.fn(async () => ({ ok: true, recordsAdded: 0 })),
  restoreDownloadUiOnStartup: vi.fn(async () => undefined),
  adoptBackupSealSecret: vi.fn(async () => undefined),
}));

vi.mock('../../../src/forensics/delivery-outbox', () => ({
  enqueueForensicDelivery: vi.fn(async () => ({ state: 'pending' as const })),
  getForensicDeliveryReceiptState: vi.fn(async () => 'committed' as const),
  pruneForensicDeliveryReceipts: vi.fn(async () => 0),
}));

vi.mock('../../../src/forensics/forensic-delivery-pump', () => ({
  kickForensicDeliveryPump: vi.fn(async () => undefined),
}));

vi.mock('../../../src/forensics/signing', () => ({
  getPublicKeyJWK: vi.fn(async () => ({ kty: 'EC', crv: 'P-256', x: 'x', y: 'y' })),
  getPublicKeyFingerprint: vi.fn(async () => 'fingerprint-1234'),
  getSigningKeyCreatedAt: vi.fn(async () => null),
  onSigningKeyBorn: vi.fn(),
}));

vi.mock('../../../src/forensics/capture-prompt-io', () => ({
  capturePromptIO: vi.fn(async () => undefined),
}));

vi.mock('../../../src/forensics/capture-behavior', () => ({
  captureBehaviorEvent: vi.fn(async () => undefined),
}));

vi.mock('../../../src/diagnostics/perf-trace', () => ({
  persistRecord: vi.fn(async () => undefined),
}));

// ─── chrome stub ─────────────────────────────────────────────────────────────

let localStore: Record<string, unknown> = {};
const onAlarm: Array<(alarm: { name: string }) => void> = [];

function installChromeStub(): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      id: 'fw-test-extension-id',
      onInstalled: { addListener: (_fn: unknown) => {} },
      onStartup: { addListener: (_fn: unknown) => {} },
      onMessage: { addListener: (_fn: unknown) => {} },
    },
    alarms: {
      onAlarm: { addListener: (fn: (alarm: { name: string }) => void) => { onAlarm.push(fn); } },
      get: () => Promise.resolve(undefined),
      create: () => Promise.resolve(),
      clear: () => Promise.resolve(true),
    },
    storage: {
      local: {
        get: (key: string) => Promise.resolve(key in localStore ? { [key]: localStore[key] } : {}),
        set: (obj: Record<string, unknown>) => { Object.assign(localStore, obj); return Promise.resolve(); },
        remove: () => Promise.resolve(),
      },
      session: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
      onChanged: { addListener: (_fn: unknown) => {} },
    },
    action: { setBadgeText: () => Promise.resolve(), setBadgeBackgroundColor: () => Promise.resolve() },
    tabs: {
      create: () => Promise.resolve({ id: 1 }),
      remove: () => Promise.resolve(),
      onRemoved: { addListener: (_fn: unknown) => {} },
      onUpdated: { addListener: (_fn: unknown) => {} },
    },
  };
}

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

let anchorChainHead: ReturnType<typeof vi.fn>;
let ensureKeyGenesisAnchor: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  installChromeStub();
  await import('../../../src/background/service-worker');
  anchorChainHead = (await import('../../../src/forensics/chain-anchor-store')).anchorChainHead as unknown as ReturnType<typeof vi.fn>;
  ensureKeyGenesisAnchor = (await import('../../../src/forensics/key-genesis')).ensureKeyGenesisAnchor as unknown as ReturnType<typeof vi.fn>;
});

const HOUR = 3_600_000;
const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();

async function heartbeat(): Promise<void> {
  for (const fn of onAlarm) fn({ name: 'forensic-heartbeat' });
  for (let i = 0; i < 6; i++) await flush();
}

beforeEach(async () => {
  await flush();
  SETTINGS.mode = 'adult';
  LATEST.anchor = null;
  localStore = {};
  anchorChainHead.mockClear();
  ensureKeyGenesisAnchor.mockClear();
});

describe('the heartbeat stamps a short session', () => {
  it('sends the chain head once six hours have passed since the last stamp', async () => {
    LATEST.anchor = { requestedAt: ago(6 * HOUR + 60_000) };
    await heartbeat();
    expect(anchorChainHead).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when the last stamp is under six hours old', async () => {
    LATEST.anchor = { requestedAt: ago(5 * HOUR) };
    await heartbeat();
    expect(anchorChainHead).not.toHaveBeenCalled();
  });

  it('does not ask again within the hour after an attempt', async () => {
    LATEST.anchor = { requestedAt: ago(9 * HOUR) };
    localStore['fw-maintenance-health'] = { stamp: { at: ago(20 * 60_000), ok: false, refusedInARow: 1 } };
    await heartbeat();
    expect(anchorChainHead).not.toHaveBeenCalled();
  });

  it('sends nothing at Strict, however old the last stamp is', async () => {
    SETTINGS.mode = 'child';
    LATEST.anchor = { requestedAt: ago(48 * HOUR) };
    await heartbeat();
    expect(anchorChainHead).not.toHaveBeenCalled();
    expect(ensureKeyGenesisAnchor).not.toHaveBeenCalled();
  });
});
