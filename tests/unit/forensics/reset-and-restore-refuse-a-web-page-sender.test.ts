// @vitest-environment jsdom
//
// B7 unit 2 (P34, SURVEY S14). The harness below is a copy of the top of service-worker.test.ts (its chrome stub, its
// downstream mocks and dispatchMessage), so this file drives the real router the same way; the suite that follows
// is new. Kept as its own file because an existing check is never edited by the maker.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

// ─── chrome stub ─────────────────────────────────────────────────────────────
//
// The SW touches chrome.runtime.onMessage / chrome.runtime.onInstalled /
// chrome.alarms.onAlarm / chrome.storage.onChanged at top level + chrome.action
// / chrome.alarms.create inside handlers. We capture every registered listener
// + every chrome.action and chrome.alarms.create call into module-local vars
// so tests can drive synthetic messages + assert side effects.

type MessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response?: unknown) => void,
) => boolean | undefined;

interface AlarmListener {
  (alarm: { name: string }): void;
}

interface StorageChangeListener {
  (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>): void;
}

// SEC-2/M76: stand-in for chrome.runtime.id. Any synthetic sender used to
// dispatch a "legitimate" message in this suite must set `id` to this value.
const FW_EXTENSION_ID = 'fw-extension-id';

const captured = {
  // The SW owns one main onMessage router. Recheck confirmation is signalled
  // from that router only after the matching tab's outbox enqueue commits.
  onMessageListener: null as MessageListener | null,
  messageListeners: [] as MessageListener[],
  onInstalledListeners: [] as Array<(details: { reason: string }) => void>,
  onStartupListeners: [] as Array<() => void>,
  onAlarmListeners: [] as AlarmListener[],
  onStorageChangeListeners: [] as StorageChangeListener[],
  alarmsCreated: [] as Array<{ name: string; opts: chrome.alarms.AlarmCreateInfo }>,
  alarmsGot: [] as string[],
  badgeTextCalls: [] as Array<{ text: string }>,
  badgeBgColorCalls: [] as Array<{ color: string }>,
  tabsCreated: [] as Array<{ url?: string; active?: boolean }>,
  tabsRemoved: [] as number[],
  onTabRemovedListeners: [] as Array<(tabId: number) => void>,
};

// chrome.alarms.get stub return value, keyed by alarm name. A name present here
// resolves to a truthy Alarm (already registered); absent resolves undefined.
const existingAlarms = new Set<string>();

// chrome.storage.session backing state (M91 recheck ledger + inspection-grant
// registry). Cleared per test so grants can never leak across tests.
const sessionState: Record<string, unknown> = {};
const localState: Record<string, unknown> = {};
/** The service worker module, captured at import so tests read its real alarm table. */
let swModule: typeof import('../../../src/background/service-worker');
/** The key armMissingAlarms records each alarm's armed options under. */
const ARMED_ALARM_OPTIONS_KEY = 'fw_armed_alarm_options';
/**
 * Seed the record of what each named alarm is already armed with, so the test
 * describes an install that is up to date rather than one upgrading into the
 * options-aware arming for the first time. Without a record, an alarm that
 * EXISTS is still recreated once, on purpose: that is the only way a cadence
 * change in PERIODIC_ALARMS ever reaches an install made before it.
 */
function seedArmedAlarmOptions(names: string[], table: ReadonlyArray<{ name: string; opts: unknown }>): void {
  const record: Record<string, unknown> = {};
  for (const n of names) {
    const row = table.find(r => r.name === n);
    if (row) record[n] = row.opts;
  }
  localState[ARMED_ALARM_OPTIONS_KEY] = record;
}

// Swappable chrome.tabs.create implementation so individual tests can model
// a slow tab creation (the inspection tab-create race).
let tabsCreateImpl: (opts: { url?: string; active?: boolean }) => Promise<{ id: number | null }> =
  () => Promise.resolve({ id: 4242 });

function resetCaptured(): void {
  for (const k of Object.keys(sessionState)) delete sessionState[k];
  for (const k of Object.keys(localState)) delete localState[k];
  tabsCreateImpl = () => Promise.resolve({ id: 4242 });
  captured.alarmsCreated.length = 0;
  captured.alarmsGot.length = 0;
  captured.badgeTextCalls.length = 0;
  captured.badgeBgColorCalls.length = 0;
  captured.tabsCreated.length = 0;
  captured.tabsRemoved.length = 0;
}

function installChromeStub(): void {
  const stub = {
    runtime: {
      // SEC-2/M76 hardening test fixture: the SW now rejects any message
      // whose sender.id !== chrome.runtime.id. Every synthetic sender in
      // this suite that represents a legitimate same-extension caller
      // (content script / popup / dashboard) must carry this id.
      id: FW_EXTENSION_ID,
      onMessage: {
        addListener: (fn: MessageListener) => {
          captured.messageListeners.push(fn);
          if (captured.onMessageListener === null) captured.onMessageListener = fn;
        },
        removeListener: (fn: MessageListener) => {
          const i = captured.messageListeners.indexOf(fn);
          if (i >= 0) captured.messageListeners.splice(i, 1);
        },
      },
      onInstalled: {
        addListener: (fn: (details: { reason: string }) => void) => {
          captured.onInstalledListeners.push(fn);
        },
      },
      onStartup: {
        addListener: (fn: () => void) => {
          captured.onStartupListeners.push(fn);
        },
      },
    },
    alarms: {
      onAlarm: {
        addListener: (fn: AlarmListener) => {
          captured.onAlarmListeners.push(fn);
        },
      },
      // Returns a promise, as chrome.alarms.create does in MV3. The stub used
      // to return undefined, which is not what the API does and hid the fact
      // that a caller may chain on it (the arming path records what it armed
      // once the create resolves, since 2026-09-18).
      create: (name: string, opts: chrome.alarms.AlarmCreateInfo) => {
        captured.alarmsCreated.push({ name, opts });
        existingAlarms.add(name);
        return Promise.resolve();
      },
      get: (name: string) => {
        captured.alarmsGot.push(name);
        return Promise.resolve(
          existingAlarms.has(name) ? { name, periodInMinutes: 60 } : undefined,
        );
      },
    },
    tabs: {
      create: (opts: { url?: string; active?: boolean }) => {
        captured.tabsCreated.push(opts);
        return tabsCreateImpl(opts);
      },
      remove: (tabId: number) => {
        captured.tabsRemoved.push(tabId);
        return Promise.resolve();
      },
      // Inspection-tab registry cleanup wiring (chrome.tabs.onRemoved).
      onRemoved: {
        addListener: (fn: (tabId: number) => void) => {
          captured.onTabRemovedListeners.push(fn);
        },
      },
    },
    storage: {
      local: {
        // Backed in memory since 2026-09-18, not a constant {}. armMissingAlarms
        // records the options it armed each alarm with here, because Chrome's
        // Alarm object cannot be asked what delayInMinutes it was created with.
        // With a get that always answered {}, every alarm read as armed with
        // something unknown and was recreated on every wake.
        get: async (keys?: string | string[]) => {
          if (keys === undefined) return { ...localState };
          const out: Record<string, unknown> = {};
          for (const k of Array.isArray(keys) ? keys : [keys]) if (k in localState) out[k] = localState[k];
          return out;
        },
        set: async (obj: Record<string, unknown>) => { Object.assign(localState, obj); },
        remove: async (keys: string | string[]) => {
          for (const k of Array.isArray(keys) ? keys : [keys]) delete localState[k];
        },
      },
      // M91 recheck-tab ledger + inspection-grant registry persist to
      // storage.session; in-memory stub (module-level sessionState, wiped per
      // test) so both round-trip inside a test the same way they do live.
      session: {
        get: async (key: string) => (key in sessionState ? { [key]: sessionState[key] } : {}),
        set: async (obj: Record<string, unknown>) => { Object.assign(sessionState, obj); },
        remove: async (keys: string | string[]) => {
          for (const k of Array.isArray(keys) ? keys : [keys]) delete sessionState[k];
        },
      },
      onChanged: {
        addListener: (fn: StorageChangeListener) => {
          captured.onStorageChangeListeners.push(fn);
        },
      },
    },
    action: {
      setBadgeText: (opts: { text: string }) => {
        captured.badgeTextCalls.push(opts);
        return Promise.resolve();
      },
      setBadgeBackgroundColor: (opts: { color: string }) => {
        captured.badgeBgColorCalls.push(opts);
        return Promise.resolve();
      },
    },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = stub;
}

// ─── downstream-module mocks ─────────────────────────────────────────────────
//
// Each mock provides a vi.fn that resolves successfully by default; tests
// override specific calls (reject, throw) to exercise error branches.

vi.mock('../../../src/storage/settings', () => ({
  incrementNeutralized: vi.fn(async () => undefined),
  applyUsageIncrement: vi.fn(async () => undefined),
  getSettings: vi.fn(async () => ({ totalNeutralizedToday: 7, parentPin: 'stored-pin-hash' })),
  getSettingsForAttestation: vi.fn(async () => ({ mode: 'adult', readFailed: false })),
  // The real one: a snapshot that could not be read cannot say whether a PIN
  // exists, and both destructive handlers refuse on it (2026-09-19).
  parentPinUnknown: (s: { readFailedFallback?: true }) => s.readFailedFallback === true,
  verifyPin: vi.fn(async () => true),
  // The install listener writes a fresh install's level as not chosen yet.
  noteLevelChosenOnInstall: vi.fn(async () => undefined),
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
  getSigningKeyCreatedAt: vi.fn(async () => '2026-07-11T00:00:00.000Z'),
  onSigningKeyBorn: vi.fn(),
}));

vi.mock('../../../src/forensics/backup', () => ({
  autoBackupToDownloads: vi.fn(async () => ({ status: 'skipped' as const, reason: 'empty' })),
  restoreFromBackup: vi.fn(async () => ({ ok: true, recordsAdded: 0 })),
  // W69: module-scope respawn net for the download-UI toggle.
  restoreDownloadUiOnStartup: vi.fn(async () => undefined),
  adoptBackupSealSecret: vi.fn(async () => undefined),
}));

vi.mock('../../../src/forensics/author-store', () => ({
  getAuthorProfile: vi.fn(async () => null),
  updateAuthorProfile: vi.fn(async () => ({
    handle: '@x',
    platform: 'twitter',
    totalSeen: 1,
    totalFlagged: 1,
    techniques: {},
    firstSeen: '2026-05-15T00:00:00.000Z',
    lastSeen: '2026-05-15T00:00:00.000Z',
  })),
}));

vi.mock('../../../src/forensics/scan-log', () => ({
  logScanEvent: vi.fn(async () => undefined),
  purgeScanEvents: vi.fn(async () => 0),
}));

vi.mock('../../../src/forensics/store', () => ({
  pruneRecordsToCap: vi.fn(async () => 0),
  getRecords: vi.fn(async () => []),
  getRecordsOrThrow: vi.fn(async () => []),
  // W69 (Q83): the debug-stats branch consults the read-failed flag.
  lastRecordReadFailed: vi.fn(() => false),
  resetForensicChain: vi.fn(async () => ({
    recordsCleared: 3,
    signingIdentityRetained: true,
    resetMarkerWritten: true,
  })),
}));

vi.mock('../../../src/forensics/chain-rotation', () => ({
  rotateChainAtMonthFlip: vi.fn(async () => ({ rotated: false, reason: 'no-rotation-needed' as const })),
}));

vi.mock('../../../src/forensics/chain-debug-stats', () => ({
  buildChainDebugStatsResponse: vi.fn((records: unknown[]) => ({
    ok: true,
    totalRecords: records.length,
    verdictCounts: {
      flagged: 0,
      'flagged-hidden': 0,
      blocked: 0,
      pass: 0,
      'flagged-undefined': 0,
      other: 0,
    },
    last10Records: [],
  })),
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

vi.mock('../../../src/forensics/chain-anchor-store', () => ({
  anchorChainHead: vi.fn(async () => ({ status: 'skipped' as const, reason: 'no_chained_records' })),
}));

// Same reason as chain-anchor-store above: key-genesis reaches public
// time-stamp authorities, and its import chain pulls in storage/license, which
// registers a storage.onChanged listener of its own in every realm. Mocking it
// keeps this file testing the service worker's OWN wiring.
vi.mock('../../../src/forensics/key-genesis', () => ({
  ensureKeyGenesisAnchor: vi.fn(async () => ({ status: 'skipped', reason: 'test' })),
}));

// ─── deferred imports ────────────────────────────────────────────────────────
//
// The mocks above are hoisted to the top; the actual `import { foo } from ...`
// happens inside `beforeAll` so we can install the chrome stub first, then
// import the SW (which registers listeners), then capture the downstream
// mocks for assertion access.

let mocks: {
  incrementNeutralized: ReturnType<typeof vi.fn>;
  getSettings: ReturnType<typeof vi.fn>;
  verifyPin: ReturnType<typeof vi.fn>;
  enqueueForensicDelivery: ReturnType<typeof vi.fn>;
  getForensicDeliveryReceiptState: ReturnType<typeof vi.fn>;
  pruneForensicDeliveryReceipts: ReturnType<typeof vi.fn>;
  kickForensicDeliveryPump: ReturnType<typeof vi.fn>;
  getPublicKeyJWK: ReturnType<typeof vi.fn>;
  getPublicKeyFingerprint: ReturnType<typeof vi.fn>;
  getSigningKeyCreatedAt: ReturnType<typeof vi.fn>;
  restoreFromBackup: ReturnType<typeof vi.fn>;
  updateAuthorProfile: ReturnType<typeof vi.fn>;
  getAuthorProfile: ReturnType<typeof vi.fn>;
  applyUsageIncrement: ReturnType<typeof vi.fn>;
  logScanEvent: ReturnType<typeof vi.fn>;
  purgeScanEvents: ReturnType<typeof vi.fn>;
  pruneRecordsToCap: ReturnType<typeof vi.fn>;
  getRecords: ReturnType<typeof vi.fn>;
  getRecordsOrThrow: ReturnType<typeof vi.fn>;
  resetForensicChain: ReturnType<typeof vi.fn>;
  rotateChainAtMonthFlip: ReturnType<typeof vi.fn>;
  buildChainDebugStatsResponse: ReturnType<typeof vi.fn>;
  capturePromptIO: ReturnType<typeof vi.fn>;
  captureBehaviorEvent: ReturnType<typeof vi.fn>;
  persistPerfRecord: ReturnType<typeof vi.fn>;
  anchorChainHead: ReturnType<typeof vi.fn>;
};
let initialPumpKickCount = 0;
// What the module-level arming created at import time, captured before any
// beforeEach clears the stub's arrays.
let initialAlarmsAtImport: string[] = [];

beforeAll(async () => {
  installChromeStub();
  // Importing the SW module runs its top-level code:
  //   chrome.runtime.onInstalled.addListener(...)
  //   chrome.alarms.onAlarm.addListener(...)
  //   chrome.runtime.onMessage.addListener(...)
  //   chrome.storage.onChanged.addListener(...)
  // The chrome stub captures every listener for later test dispatch.
  swModule = await import('../../../src/background/service-worker');
  // The SW arms its alarms at module scope now, through chrome.alarms.get,
  // so let those promises settle before anything is read back.
  await Promise.resolve();
  await Promise.resolve();
  initialAlarmsAtImport = [...existingAlarms];

  // Pull the mocked module exports out post-import so we can spy on calls.
  const settings = await import('../../../src/storage/settings');
  const outbox = await import('../../../src/forensics/delivery-outbox');
  const pump = await import('../../../src/forensics/forensic-delivery-pump');
  const signing = await import('../../../src/forensics/signing');
  const backup = await import('../../../src/forensics/backup');
  const author = await import('../../../src/forensics/author-store');
  const scanLog = await import('../../../src/forensics/scan-log');
  const store = await import('../../../src/forensics/store');
  const chainRotation = await import('../../../src/forensics/chain-rotation');
  const debugStats = await import('../../../src/forensics/chain-debug-stats');
  const captureIO = await import('../../../src/forensics/capture-prompt-io');
  const captureBehavior = await import('../../../src/forensics/capture-behavior');
  const perfTrace = await import('../../../src/diagnostics/perf-trace');
  const chainAnchor = await import('../../../src/forensics/chain-anchor-store');

  mocks = {
    incrementNeutralized: vi.mocked(settings.incrementNeutralized),
    getSettings: vi.mocked(settings.getSettings),
    verifyPin: vi.mocked(settings.verifyPin),
    enqueueForensicDelivery: vi.mocked(outbox.enqueueForensicDelivery),
    getForensicDeliveryReceiptState: vi.mocked(outbox.getForensicDeliveryReceiptState),
    pruneForensicDeliveryReceipts: vi.mocked(outbox.pruneForensicDeliveryReceipts),
    kickForensicDeliveryPump: vi.mocked(pump.kickForensicDeliveryPump),
    getPublicKeyJWK: vi.mocked(signing.getPublicKeyJWK),
    getPublicKeyFingerprint: vi.mocked(signing.getPublicKeyFingerprint),
    getSigningKeyCreatedAt: vi.mocked(signing.getSigningKeyCreatedAt),
    restoreFromBackup: vi.mocked(backup.restoreFromBackup),
    updateAuthorProfile: vi.mocked(author.updateAuthorProfile),
    getAuthorProfile: vi.mocked(author.getAuthorProfile),
    applyUsageIncrement: vi.mocked(settings.applyUsageIncrement),
    logScanEvent: vi.mocked(scanLog.logScanEvent),
    purgeScanEvents: vi.mocked(scanLog.purgeScanEvents),
    pruneRecordsToCap: vi.mocked(store.pruneRecordsToCap),
    getRecords: vi.mocked(store.getRecords),
    getRecordsOrThrow: vi.mocked(store.getRecordsOrThrow),
    resetForensicChain: vi.mocked(store.resetForensicChain),
    rotateChainAtMonthFlip: vi.mocked(chainRotation.rotateChainAtMonthFlip),
    buildChainDebugStatsResponse: vi.mocked(debugStats.buildChainDebugStatsResponse),
    capturePromptIO: vi.mocked(captureIO.capturePromptIO),
    captureBehaviorEvent: vi.mocked(captureBehavior.captureBehaviorEvent),
    persistPerfRecord: vi.mocked(perfTrace.persistRecord),
    anchorChainHead: vi.mocked(chainAnchor.anchorChainHead),
  };
  initialPumpKickCount = mocks.kickForensicDeliveryPump.mock.calls.length;
});

beforeEach(() => {
  resetCaptured();
  vi.clearAllMocks();
  // Re-establish default resolutions after clearAllMocks (which wipes
  // both call history AND impl). Each test that needs a custom impl
  // overrides via .mockRejectedValueOnce / .mockImplementationOnce.
  mocks.incrementNeutralized.mockResolvedValue(undefined);
  // parentPin present by default: popup setup treats "PIN set" as
  // setup-complete, so a configured install always has one. The
  // no-PIN-configured reset test overrides this with parentPin: ''.
  mocks.getSettings.mockResolvedValue(
    { totalNeutralizedToday: 7, parentPin: 'stored-pin-hash' } as unknown as never,
  );
  mocks.verifyPin.mockResolvedValue(true as unknown as never);
  mocks.enqueueForensicDelivery.mockResolvedValue({ state: 'pending' });
  mocks.getForensicDeliveryReceiptState.mockResolvedValue('committed');
  mocks.pruneForensicDeliveryReceipts.mockResolvedValue(0);
  mocks.kickForensicDeliveryPump.mockResolvedValue(undefined);
  mocks.getPublicKeyJWK.mockResolvedValue({ kty: 'EC', crv: 'P-256', x: 'x', y: 'y' });
  mocks.getPublicKeyFingerprint.mockResolvedValue('fingerprint-1234');
  mocks.getSigningKeyCreatedAt.mockResolvedValue('2026-07-11T00:00:00.000Z');
  mocks.restoreFromBackup.mockResolvedValue({ ok: true, recordsAdded: 0 } as unknown as never);
  mocks.updateAuthorProfile.mockResolvedValue({
    handle: '@x',
    platform: 'twitter',
    totalSeen: 1,
    totalFlagged: 1,
    techniques: {},
    firstSeen: '2026-05-15T00:00:00.000Z',
    lastSeen: '2026-05-15T00:00:00.000Z',
  } as unknown as never);
  mocks.logScanEvent.mockResolvedValue(undefined);
  mocks.purgeScanEvents.mockResolvedValue(0 as unknown as never);
  mocks.pruneRecordsToCap.mockResolvedValue(0 as unknown as never);
  mocks.getRecords.mockResolvedValue([] as unknown as never);
  mocks.resetForensicChain.mockResolvedValue({
    recordsCleared: 3,
    signingIdentityRetained: true,
    resetMarkerWritten: true,
  } as unknown as never);
  mocks.buildChainDebugStatsResponse.mockImplementation((records: unknown) => ({
    ok: true,
    totalRecords: Array.isArray(records) ? records.length : 0,
    verdictCounts: {
      flagged: 0,
      'flagged-hidden': 0,
      blocked: 0,
      pass: 0,
      'flagged-undefined': 0,
      other: 0,
    },
    last10Records: [],
  }));
  mocks.capturePromptIO.mockResolvedValue(undefined);
  mocks.captureBehaviorEvent.mockResolvedValue(undefined);
  mocks.persistPerfRecord.mockResolvedValue(undefined);
  mocks.anchorChainHead.mockResolvedValue({ status: 'skipped', reason: 'no_chained_records' } as unknown as never);
});

afterEach(() => {
  // Silence the SW handler's console.error from intentionally-rejected
  // promises; we assert via sendResponse, not stderr.
});

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Drive a synthetic message through the SW's captured onMessage listener.
 * Returns {keepChannelOpen, responsePromise}: the listener's return value
 * tells the harness whether to expect an async sendResponse; the promise
 * resolves with whatever the SW eventually passes to sendResponse.
 */
function dispatchMessage(message: unknown, sender: unknown = { id: FW_EXTENSION_ID }): {
  keepChannelOpen: boolean | undefined;
  responsePromise: Promise<unknown | undefined>;
} {
  let resolveResponse: (value: unknown) => void = () => {};
  const responsePromise = new Promise<unknown | undefined>((resolve) => {
    resolveResponse = resolve;
  });
  const sendResponse = (response?: unknown): void => resolveResponse(response);
  // Resolve to `undefined` if the handler never calls sendResponse (e.g.,
  // fire-and-forget). We give microtasks a chance to flush via a queued
  // setTimeout 0; tests that don't care just don't await responsePromise.
  // For fire-and-forget paths, a Promise.race below gives a deterministic
  // "no response within a microtask" signal.
  const listener = captured.onMessageListener;
  if (!listener) throw new Error('SW onMessage listener not captured — import order broken');
  const keepChannelOpen = listener(message, sender, sendResponse);
  return { keepChannelOpen, responsePromise };
}

/** Wait one macrotask so fire-and-forget promise chains settle before assertion. */
function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

// ─── Suite (1): Lifecycle wiring (top-level addListener) ─────────────────────


// ─── B7 unit 2 (P34, SURVEY S14): reset and restore take only extension pages ────────────────────────────────────
//
// RESET_FORENSIC_CHAIN and RESTORE_FORENSIC_BACKUP are the two most destructive messages the worker takes (the chain,
// and with a restore the signing identity too). The sender.id check only proves the message came from this extension,
// and the extension's content scripts run inside every web page the person visits: a content script's sender carries
// a tab and the PAGE's URL. So a script in a page's tab could send either message; with no PIN set (an adult install)
// nothing else stands in the way. Both are now refused from a sender that has a tab and is not one of the extension's
// own pages. The popup (no tab) and the dashboard (an extension URL, even when opened as a tab) still work.

const OWN_PAGE = `chrome-extension://${FW_EXTENSION_ID}/dashboard.html`;

const webPageSender = { id: FW_EXTENSION_ID, tab: { id: 7, url: 'https://example.com/post/1' }, url: 'https://example.com/post/1', frameId: 0 };
const popupSender = { id: FW_EXTENSION_ID, url: `chrome-extension://${FW_EXTENSION_ID}/popup.html` };
const dashboardTabSender = { id: FW_EXTENSION_ID, tab: { id: 9, url: OWN_PAGE }, url: OWN_PAGE };

describe('service-worker — reset and restore refuse a web page sender (B7 unit 2 / P34)', () => {
  const RESET = { type: 'RESET_FORENSIC_CHAIN', payload: { reason: 'from a page', pin: '1234' } };
  const RESET_NO_PIN = { type: 'RESET_FORENSIC_CHAIN', payload: { reason: 'from a page' } };
  const RESTORE = { type: 'RESTORE_FORENSIC_BACKUP', payload: { raw: '{"backup":true}', passphrase: 'secret', force: true, pin: '1234' } };

  it('RESET from a content script in a web page is refused and never touches the chain', async () => {
    const { responsePromise } = dispatchMessage(RESET, webPageSender);
    expect(await responsePromise).toEqual(expect.objectContaining({ ok: false, errorKind: 'sender-refused' }));
    expect(mocks.resetForensicChain).not.toHaveBeenCalled();
    expect(mocks.verifyPin).not.toHaveBeenCalled();
  });

  it('RESET from a web page is refused on an install with NO PIN too (the case nothing else guards)', async () => {
    mocks.getSettings.mockResolvedValue({ totalNeutralizedToday: 7, parentPin: '' } as unknown as never);
    const { responsePromise } = dispatchMessage(RESET_NO_PIN, webPageSender);
    expect(await responsePromise).toEqual(expect.objectContaining({ ok: false, errorKind: 'sender-refused' }));
    expect(mocks.resetForensicChain).not.toHaveBeenCalled();
  });

  it('RESTORE from a content script in a web page is refused and never touches the chain or the key', async () => {
    const { responsePromise } = dispatchMessage(RESTORE, webPageSender);
    expect(await responsePromise).toEqual(expect.objectContaining({ ok: false, errorKind: 'sender-refused' }));
    expect(mocks.restoreFromBackup).not.toHaveBeenCalled();
    expect(mocks.verifyPin).not.toHaveBeenCalled();
  });

  it('a sender with a tab and no URL cannot be shown to be an extension page, so it is refused', async () => {
    const { responsePromise } = dispatchMessage(RESET, { id: FW_EXTENSION_ID, tab: { id: 7 } });
    expect(await responsePromise).toEqual(expect.objectContaining({ ok: false, errorKind: 'sender-refused' }));
    expect(mocks.resetForensicChain).not.toHaveBeenCalled();
  });

  it('a look-alike extension URL is refused: the prefix must be this extension id followed by a slash', async () => {
    const lookAlike = `chrome-extension://${FW_EXTENSION_ID}-evil/dashboard.html`;
    const { responsePromise } = dispatchMessage(RESET, { id: FW_EXTENSION_ID, tab: { id: 7, url: lookAlike }, url: lookAlike });
    expect(await responsePromise).toEqual(expect.objectContaining({ ok: false, errorKind: 'sender-refused' }));
    expect(mocks.resetForensicChain).not.toHaveBeenCalled();
  });

  it('RESET from the popup (no tab) still works', async () => {
    const { keepChannelOpen, responsePromise } = dispatchMessage(RESET, popupSender);
    expect(keepChannelOpen).toBe(true);
    expect(await responsePromise).toEqual({ ok: true, result: expect.anything() });
    expect(mocks.resetForensicChain).toHaveBeenCalledWith('from a page');
  });

  it('RESET from the dashboard opened as a tab (an extension URL) still works', async () => {
    const { keepChannelOpen, responsePromise } = dispatchMessage(RESET, dashboardTabSender);
    expect(keepChannelOpen).toBe(true);
    expect(await responsePromise).toEqual({ ok: true, result: expect.anything() });
    expect(mocks.resetForensicChain).toHaveBeenCalledWith('from a page');
  });

  it('RESTORE from the dashboard opened as a tab still works', async () => {
    const restored = { ok: true, recordsAdded: 4, keyRestored: true };
    mocks.restoreFromBackup.mockResolvedValueOnce(restored as unknown as never);
    const { keepChannelOpen, responsePromise } = dispatchMessage(RESTORE, dashboardTabSender);
    expect(keepChannelOpen).toBe(true);
    expect(await responsePromise).toEqual({ ok: true, result: restored });
    expect(mocks.restoreFromBackup).toHaveBeenCalledWith('{"backup":true}', 'secret', true, undefined);
  });

  it('a content script can still send the messages that are meant for it (SCAN_LOG is not affected)', () => {
    const { keepChannelOpen } = dispatchMessage({ type: 'SCAN_LOG', payload: { id: 's1' } }, webPageSender);
    expect(keepChannelOpen).toBe(false);
    expect(mocks.logScanEvent).toHaveBeenCalled();
  });
});
