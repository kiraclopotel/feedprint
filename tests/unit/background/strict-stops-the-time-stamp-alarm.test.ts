// @vitest-environment jsdom
//
// At Silent (the Strict level) without a key and the agreement the six-hourly time-stamp alarm does not exist and does
// not stamp; entering Silent clears it, leaving Silent arms it again on the person's own switch (the storage change), and a
// fire that slips through while Silent is on still reaches no time-stamp service. With a key and the agreement (12 Oct 2026,
// Silent reads) the alarm is armed like the other levels'. The other alarms, all of them local, are untouched.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const SETTINGS = vi.hoisted(() => ({ mode: 'child' as string }));
// What the gate reads for the key and the agreement (storage/license, storage/reading-consent).
const HELD = vi.hoisted(() => ({ tier: 'free' as string, agreed: false }));

vi.mock('../../../src/storage/license', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/storage/license')>();
  return { ...actual, getLicense: vi.fn(async () => ({ tier: HELD.tier, secret: HELD.tier === 'free' ? '' : 'abc' })) };
});

vi.mock('../../../src/storage/reading-consent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/storage/reading-consent')>();
  return { ...actual, getReadingConsent: vi.fn(async () => (HELD.agreed ? { at: 'x', provider: 'p' } : null)) };
});

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

vi.mock('../../../src/forensics/chain-anchor-store', () => ({
  anchorChainHead: vi.fn(async () => ({ status: 'skipped' as const, reason: 'no_chained_records' })),
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

type AlarmOpts = chrome.alarms.AlarmCreateInfo;
type StorageChanges = Record<string, { newValue?: unknown; oldValue?: unknown }>;

let liveAlarms: Record<string, AlarmOpts>;
let localStore: Record<string, unknown>;
let alarmsCleared: string[];
const onAlarm: Array<(alarm: { name: string }) => void> = [];
const onStorageChanged: Array<(changes: StorageChanges) => void> = [];

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
      get: (name: string) => {
        const opts = liveAlarms[name];
        return Promise.resolve(opts ? { name, periodInMinutes: opts.periodInMinutes, scheduledTime: 0 } : undefined);
      },
      create: (name: string, opts: AlarmOpts) => { liveAlarms[name] = opts; return Promise.resolve(); },
      clear: (name: string) => { alarmsCleared.push(name); const had = name in liveAlarms; delete liveAlarms[name]; return Promise.resolve(had); },
    },
    storage: {
      local: {
        get: (key: string) => Promise.resolve(key in localStore ? { [key]: localStore[key] } : {}),
        set: (obj: Record<string, unknown>) => { Object.assign(localStore, obj); return Promise.resolve(); },
        remove: () => Promise.resolve(),
      },
      session: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
      onChanged: { addListener: (fn: (changes: StorageChanges) => void) => { onStorageChanged.push(fn); } },
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
  return new Promise((r) => setTimeout(r, 100));
}

let armMissingAlarms: () => void;
let armAllAlarms: () => void;
let anchorChainHead: ReturnType<typeof vi.fn>;
let ensureKeyGenesisAnchor: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  liveAlarms = {};
  localStore = {};
  alarmsCleared = [];
  installChromeStub();
  const sw = await import('../../../src/background/service-worker');
  armMissingAlarms = sw.armMissingAlarms;
  armAllAlarms = sw.armAllAlarms;
  anchorChainHead = (await import('../../../src/forensics/chain-anchor-store')).anchorChainHead as unknown as ReturnType<typeof vi.fn>;
  ensureKeyGenesisAnchor = (await import('../../../src/forensics/key-genesis')).ensureKeyGenesisAnchor as unknown as ReturnType<typeof vi.fn>;
});

beforeEach(async () => {
  SETTINGS.mode = 'teen';
  HELD.tier = 'free';
  HELD.agreed = false;
  liveAlarms = {};
  localStore = {};
  alarmsCleared = [];
  anchorChainHead.mockClear();
  ensureKeyGenesisAnchor.mockClear();
  armAllAlarms();
  await flush();
  alarmsCleared = [];
});

const LOCAL_ALARMS = ['scan-purge', 'forensic-prune', 'forensic-month-rotation', 'forensic-backup', 'forensic-outbox-drain', 'forensic-heartbeat'];

function fire(name: string): void {
  for (const fn of onAlarm) fn({ name });
}

function modeChanged(to: string): void {
  SETTINGS.mode = to;
  for (const fn of onStorageChanged) fn({ mode: { newValue: to } });
}

describe('the time-stamp alarm and the level', () => {
  it('is armed in Moderate and Relaxed, with the local alarms', () => {
    expect(Object.keys(liveAlarms)).toContain('forensic-anchor');
    for (const name of LOCAL_ALARMS) expect(Object.keys(liveAlarms)).toContain(name);
  });

  it('entering Silent without a key clears it and leaves every local alarm running', async () => {
    modeChanged('child');
    await flush();
    expect(alarmsCleared).toEqual(['forensic-anchor']);
    expect(Object.keys(liveAlarms)).not.toContain('forensic-anchor');
    for (const name of LOCAL_ALARMS) expect(Object.keys(liveAlarms)).toContain(name);
  });

  it('Silent with a key but no agreement yet keeps it cleared: nothing leaves until the agreement', async () => {
    HELD.tier = 'family';
    modeChanged('child');
    await flush();
    expect(Object.keys(liveAlarms)).not.toContain('forensic-anchor');
  });

  it('Silent with a key and the agreement arms it, like the other levels', async () => {
    HELD.tier = 'family';
    HELD.agreed = true;
    modeChanged('child');
    await flush();
    expect(Object.keys(liveAlarms)).toContain('forensic-anchor');
    expect(alarmsCleared).toEqual([]);
  });

  it('giving the agreement at Silent arms it without a change of level (the agreement slot is watched)', async () => {
    HELD.tier = 'family';
    modeChanged('child');
    await flush();
    expect(Object.keys(liveAlarms)).not.toContain('forensic-anchor');
    HELD.agreed = true;
    for (const fn of onStorageChanged) fn({ readingConsent: { newValue: { at: 'x' } } });
    await flush();
    expect(liveAlarms['forensic-anchor']).toEqual({ periodInMinutes: 60 * 6, delayInMinutes: 15 });
  });

  it('a worker that wakes in Silent without a key does not arm it', async () => {
    modeChanged('child');
    await flush();
    armMissingAlarms();
    await flush();
    expect(Object.keys(liveAlarms)).not.toContain('forensic-anchor');
  });

  it('leaving Strict arms it again, with its first tick', async () => {
    modeChanged('child');
    await flush();
    modeChanged('adult');
    await flush();
    expect(liveAlarms['forensic-anchor']).toEqual({ periodInMinutes: 60 * 6, delayInMinutes: 15 });
  });

  it('a fire in Moderate stamps the key and the chain head', async () => {
    fire('forensic-anchor');
    await flush();
    expect(ensureKeyGenesisAnchor).toHaveBeenCalledTimes(1);
    expect(anchorChainHead).toHaveBeenCalledTimes(1);
  });

  it('a fire in Silent without a key stamps nothing', async () => {
    SETTINGS.mode = 'child';
    fire('forensic-anchor');
    await flush();
    expect(ensureKeyGenesisAnchor).not.toHaveBeenCalled();
    expect(anchorChainHead).not.toHaveBeenCalled();
  });

  it('a change to anything but the level touches no alarm', async () => {
    for (const fn of onStorageChanged) fn({ dashboardTheme: { newValue: 'dark' } });
    await flush();
    expect(alarmsCleared).toEqual([]);
  });
});
