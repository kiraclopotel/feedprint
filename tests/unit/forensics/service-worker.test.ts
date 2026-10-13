// @vitest-environment jsdom
//
// FeelingWise - service-worker.ts unit-test coverage (Audit 3 R2; A6 of the
// A4+A6 integrity-critical pair per VISION §1.1 / ARCHITECTURE.md:44).
//
// service-worker.ts is the message-router for the FW envelopes
// (FW_MESSAGE_TYPES at src/types/messages.ts:197-211) that move every
// forensic-chain write from a content-script realm into the extension realm
// where the dashboard can read it. Pre-this suite, coverage on this file
// measured 0% statement coverage in Audit 3 R2.
//
// What this suite asserts (the load-bearing invariants — service-worker.ts is
// thin glue, so the contract is "the right downstream is called with the right
// payload, and async handlers respond with the right ok-shape"):
//
//   (1) Lifecycle wiring (service-worker.ts:23-32):
//       - chrome.runtime.onInstalled fires once on import → action badge cleared
//         + two chrome.alarms.create('scan-purge', 'forensic-prune') registered.
//       - chrome.alarms.onAlarm with name='scan-purge' calls purgeScanEvents(30).
//       - chrome.alarms.onAlarm with name='forensic-prune' calls
//         pruneRecordsToCap() with no arg (defaults to FORENSIC_RECORD_CAP).
//       - chrome.storage.onChanged with `lastResetDate` change clears badge.
//
//   (2) For each envelope handler, assert:
//       - The correct downstream module function is called.
//       - Payload fields propagate (the SW is a pass-through; if a payload
//         field is dropped at the dispatch boundary, callers silently lose
//         data — bit the chain once via the harm-floor field at SW handler:
//         see service-worker.ts:132-137 comment about the prior positional-
//         args explosion bug).
//       - Async handlers return true (keep channel open) AND eventually call
//         sendResponse with the right ok-shape. Fire-and-forget handlers
//         return false.
//       - Error paths inside async handlers respond {ok:false} (not throw).
//
//   (3) GET_CHAIN_DEBUG_STATS: SW calls getRecords() + delegates to the pure
//       buildChainDebugStatsResponse (covered separately in
//       tests/unit/forensics/chain-debug-stats.test.ts; this suite asserts the SW
//       dispatch wiring + that getRecords failure surfaces {ok:false}).
//
// What's deliberately OUT of scope:
//   - Re-asserting downstream-module invariants (logForensicEvent's chain-
//     state math, addRecord's IDB shape, purgeScanEvents's cutoff). Those
//     have their own suites (tests/unit/forensics-store.test.ts and the
//     rest of tests/unit/). Here we mock every
//     downstream and assert the SW called it correctly.
//   - 100% line coverage on service-worker.ts. Several handlers are
//     identical-shape async logger dispatches; we cover each shape once
//     instead of hammering every line. Target is ≥50% real lift from 0%.
//
// Test harness notes:
//   - SW registers listeners at IMPORT time (top-level `chrome.runtime.
//     onMessage.addListener` etc.). The harness installs a chrome stub
//     BEFORE the dynamic SW import so the listener-capture pattern works.
//   - vi.mock hoists each downstream-module mock to the top of the file
//     regardless of source-code position; the actual capture of the
//     vi.fn handles happens inside beforeAll via getMocks().
//   - chrome.runtime stubs: addListener takes the listener and stores it
//     in a module-local var; tests dispatch synthetic messages via that
//     captured listener.

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

describe('service-worker — lifecycle wiring at module-import', () => {
  it('captured exactly one onMessage listener at import time', () => {
    // The SW registers exactly one chrome.runtime.onMessage.addListener at
    // service-worker.ts:52. If a future PR adds a second listener, this test
    // surfaces it — multiple listeners is a footgun (channel-open races).
    expect(captured.onMessageListener).not.toBeNull();
  });

  it('kicks the durable forensic outbox once when a fresh SW realm imports', () => {
    expect(initialPumpKickCount).toBe(1);
  });

  // 2026-09-18. Every periodic alarm was armed from onInstalled and nowhere
  // else, and chrome.runtime.onInstalled does not fire when an extension is
  // disabled and enabled again, nor after chrome.runtime.reload(). On an
  // install where that happened, the daily backup to Downloads, the six-hour
  // time-stamp anchor, the daily prune, the heartbeat and the outbox drain all
  // stopped for good, and nothing in the product said so. The daily backup is
  // the one that matters most: it is what stands between the person and losing
  // the whole record when the extension goes away.
  it('arms every missing alarm when a worker wakes, and on browser startup', async () => {
    expect(initialAlarmsAtImport.sort()).toEqual([
      'forensic-anchor',
      'forensic-backup',
      'forensic-heartbeat',
      'forensic-month-rotation',
      'forensic-outbox-drain',
      'forensic-prune',
      'scan-purge',
    ]);

    // onStartup is registered, and it arms what is missing without touching
    // what is running: here everything is already there AND armed with the
    // options the table asks for today, so nothing is created. Present alone is
    // not enough since 2026-09-18: an alarm armed with options the table has
    // since changed is recreated once, which is the only way a cadence edit
    // reaches an install made before it.
    seedArmedAlarmOptions(initialAlarmsAtImport, swModule.PERIODIC_ALARMS);
    expect(captured.onStartupListeners).toHaveLength(1);
    captured.onStartupListeners[0]();
    await flush();
    expect(captured.alarmsGot.sort()).toEqual([
      'forensic-anchor',
      'forensic-backup',
      'forensic-heartbeat',
      'forensic-month-rotation',
      'forensic-outbox-drain',
      'forensic-prune',
      'scan-purge',
    ]);
    expect(captured.alarmsCreated, 'a running alarm was recreated, which resets its timer').toEqual([]);

    // One alarm gone, the way a profile loses one: startup puts back that one
    // and only that one.
    existingAlarms.delete('forensic-backup');
    captured.alarmsGot.length = 0;
    captured.onStartupListeners[0]();
    await flush();
    expect(captured.alarmsCreated.map(a => a.name)).toEqual(['forensic-backup']);
    expect(captured.alarmsCreated[0].opts.periodInMinutes).toBe(60 * 24);
  });

  it('the install listener hands its reason to the setting that keeps a fresh install silent until a level is chosen', async () => {
    const settings = await import('../../../src/storage/settings');
    const note = vi.mocked(settings.noteLevelChosenOnInstall);
    note.mockClear();
    captured.onInstalledListeners[0]({ reason: 'install' });
    expect(note).toHaveBeenCalledWith('install');
  });

  it('captured an onInstalled listener that clears the badge and registers six alarms on fresh install', () => {
    // service-worker.ts:23-32. The SW registers ONE onInstalled listener.
    expect(captured.onInstalledListeners).toHaveLength(1);

    // M28: on a FRESH install every periodic alarm is created unconditionally
    // (no chrome.alarms.get guard). Drive the listener with reason='install'.
    existingAlarms.clear();
    captured.onInstalledListeners[0]({ reason: 'install' });

    // Badge cleared (service-worker.ts:25).
    expect(captured.badgeTextCalls).toContainEqual({ text: '' });

    // Five alarms created: 'scan-purge' + 'forensic-prune' +
    // 'forensic-month-rotation' + 'forensic-anchor' + 'forensic-backup'.
    // 'forensic-anchor' landed 2026-05-28 (RFC 3161 chain-head anchoring);
    // 'forensic-backup' landed 2026-06-05 (daily auto-backup to Downloads so
    // the chain survives uninstall — see src/forensics/backup.ts).
    expect(captured.alarmsCreated.map((a) => a.name).sort()).toEqual([
      'forensic-anchor',
      'forensic-backup',
      'forensic-heartbeat',
      'forensic-month-rotation',
      'forensic-outbox-drain',
      'forensic-prune',
      'scan-purge',
    ]);
    // The chained heartbeat (2026-09-06, evidence-gap register item 9).
    expect(captured.alarmsCreated.find((a) => a.name === 'forensic-heartbeat')!.opts.periodInMinutes).toBe(15);
    // Four daily alarms + one 6-hour alarm (forensic-anchor).
    expect(captured.alarmsCreated.find((a) => a.name === 'scan-purge')!.opts.periodInMinutes).toBe(
      60 * 24,
    );
    expect(captured.alarmsCreated.find((a) => a.name === 'forensic-prune')!.opts.periodInMinutes).toBe(
      60 * 24,
    );
    expect(captured.alarmsCreated.find((a) => a.name === 'forensic-month-rotation')!.opts.periodInMinutes).toBe(
      60 * 24,
    );
    expect(captured.alarmsCreated.find((a) => a.name === 'forensic-anchor')!.opts.periodInMinutes).toBe(
      60 * 6,
    );
    // And its FIRST tick is 15 minutes after the install, not six hours
    // (2026-09-17). Without the delay the first fire is the period, which is
    // why a fresh install wrote no anchor and no key stamp for four hours on
    // 2026-09-06 and nothing in the code explained it.
    expect(captured.alarmsCreated.find((a) => a.name === 'forensic-anchor')!.opts.delayInMinutes).toBe(15);
    expect(captured.alarmsCreated.find((a) => a.name === 'forensic-backup')!.opts.periodInMinutes).toBe(
      60 * 24,
    );
    // Fresh install does not consult chrome.alarms.get (creates unconditionally).
    expect(captured.alarmsGot).toEqual([]);
  });

  it('M28: on update with all alarms already present, recreates NONE (timers preserved)', async () => {
    // Every periodic alarm already exists (prior install). An extension UPDATE
    // must not call chrome.alarms.create for an already-present alarm, or its
    // periodInMinutes timer resets on every dev-mode reload.
    existingAlarms.clear();
    const everyAlarm = ['scan-purge', 'forensic-prune', 'forensic-month-rotation', 'forensic-anchor', 'forensic-backup', 'forensic-outbox-drain', 'forensic-heartbeat'];
    everyAlarm.forEach((n) => existingAlarms.add(n));
    // Present AND current. Present alone is no longer enough to be left alone:
    // an alarm armed with options the table has since changed is recreated
    // once, which is how the forensic-anchor delay of 2026-09-06 reaches an
    // install made before it.
    seedArmedAlarmOptions(everyAlarm, swModule.PERIODIC_ALARMS);

    captured.onInstalledListeners[0]({ reason: 'update' });
    await flush();

    // get consulted for each periodic alarm; create called for none.
    expect(captured.alarmsGot.sort()).toEqual([
      'forensic-anchor',
      'forensic-backup',
      'forensic-heartbeat',
      'forensic-month-rotation',
      'forensic-outbox-drain',
      'forensic-prune',
      'scan-purge',
    ]);
    expect(captured.alarmsCreated).toEqual([]);
  });

  it('M28: on update creates ONLY the alarms that are missing', async () => {
    existingAlarms.clear();
    // Two already present; the rest missing.
    existingAlarms.add('scan-purge');
    existingAlarms.add('forensic-prune');
    // And already armed with the options the table asks for today, so the
    // options half of the guard has nothing to correct on them.
    seedArmedAlarmOptions(['scan-purge', 'forensic-prune'], swModule.PERIODIC_ALARMS);

    captured.onInstalledListeners[0]({ reason: 'update' });
    await flush();

    // Only the absent alarms are (re)created.
    expect(captured.alarmsCreated.map((a) => a.name).sort()).toEqual([
      'forensic-anchor',
      'forensic-backup',
      'forensic-heartbeat',
      'forensic-month-rotation',
      'forensic-outbox-drain',
    ]);
  });

  it('captured an onAlarm listener that dispatches scan-purge to purgeScanEvents(30)', async () => {
    expect(captured.onAlarmListeners).toHaveLength(1);
    captured.onAlarmListeners[0]({ name: 'scan-purge' });
    await flush();
    // service-worker.ts:37 — purgeScanEvents(30), 30-day retention.
    expect(mocks.purgeScanEvents).toHaveBeenCalledWith(30);
  });

  it('captured an onAlarm listener that dispatches forensic-prune to pruneRecordsToCap()', async () => {
    captured.onAlarmListeners[0]({ name: 'forensic-prune' });
    await flush();
    // service-worker.ts:40 — pruneRecordsToCap() with no arg (defaults).
    expect(mocks.pruneRecordsToCap).toHaveBeenCalledWith();
    expect(mocks.pruneForensicDeliveryReceipts).toHaveBeenCalledWith();
  });

  it('captured an onAlarm listener that dispatches forensic-month-rotation to rotateChainAtMonthFlip()', async () => {
    captured.onAlarmListeners[0]({ name: 'forensic-month-rotation' });
    await flush();
    // Phase 1b chain-rotation alarm — rotateChainAtMonthFlip is idempotent
    // in 'auto' mode (default) so daily firing is safe even when no rotation
    // is needed. Called with no args so the function reads `new Date()`.
    expect(mocks.rotateChainAtMonthFlip).toHaveBeenCalledWith();
  });

  it('captured an onAlarm listener that dispatches forensic-anchor to anchorChainHead()', async () => {
    captured.onAlarmListeners[0]({ name: 'forensic-anchor' });
    await flush();
    // 2026-05-28 RFC 3161 anchor alarm — anchorChainHead reads the chain
    // head, asks the TSA proxy for a signed timestamp, writes a sidecar
    // anchor record. Called with no args.
    expect(mocks.anchorChainHead).toHaveBeenCalledWith();
  });

  it('onAlarm anchorChainHead rejection does not propagate (silent .catch)', async () => {
    mocks.anchorChainHead.mockRejectedValueOnce(new Error('tsa proxy down'));
    captured.onAlarmListeners[0]({ name: 'forensic-anchor' });
    await flush();
    expect(mocks.anchorChainHead).toHaveBeenCalled();
  });

  it('onAlarm with unknown alarm name does nothing', async () => {
    captured.onAlarmListeners[0]({ name: 'no-such-alarm' });
    await flush();
    expect(mocks.purgeScanEvents).not.toHaveBeenCalled();
    expect(mocks.pruneRecordsToCap).not.toHaveBeenCalled();
  });

  it('onAlarm purgeScanEvents rejection does not propagate (silent .catch)', async () => {
    mocks.purgeScanEvents.mockRejectedValueOnce(new Error('idb dead'));
    // service-worker.ts:37 — `.catch(() => {})`. The test passes if no
    // unhandled-rejection escapes the next macrotask.
    captured.onAlarmListeners[0]({ name: 'scan-purge' });
    await flush();
    // Verify the call still went out (the .catch swallows downstream).
    expect(mocks.purgeScanEvents).toHaveBeenCalledWith(30);
  });

  it('onAlarm pruneRecordsToCap rejection does not propagate (silent .catch)', async () => {
    mocks.pruneRecordsToCap.mockRejectedValueOnce(new Error('idb dead'));
    captured.onAlarmListeners[0]({ name: 'forensic-prune' });
    await flush();
    expect(mocks.pruneRecordsToCap).toHaveBeenCalledWith();
  });

  it('captured a storage.onChanged listener that clears badge on lastResetDate change', () => {
    // The worker registers ONE onChanged listener of its own, reacting only to
    // changes that contain a `lastResetDate` key. The licence module it loads
    // (through the plan list fetched on install) registers its own first, so
    // the worker's is the last one.
    expect(captured.onStorageChangeListeners).toHaveLength(2);
    captured.onStorageChangeListeners.at(-1)!({
      lastResetDate: { oldValue: '2026-05-14', newValue: '2026-05-15' },
    });
    expect(captured.badgeTextCalls).toContainEqual({ text: '' });
  });

  it('storage.onChanged with non-lastResetDate change is a no-op', () => {
    captured.onStorageChangeListeners.at(-1)!({
      otherKey: { oldValue: 1, newValue: 2 },
    });
    // Badge calls history should be empty for this listener invocation.
    // (resetCaptured() in beforeEach already cleared captured.badgeTextCalls
    // for this test scope.)
    expect(captured.badgeTextCalls).toEqual([]);
  });
});

// ─── Suite (2): Fire-and-forget handlers (return false; no sendResponse) ─────

describe('service-worker — fire-and-forget envelope handlers', () => {
  it('SCAN_LOG dispatches payload to logScanEvent and returns false', () => {
    const payload = {
      timestamp: '2026-05-15T00:00:00.000Z',
      platform: 'twitter' as const,
      feedSource: 'home' as const,
      author: '@a',
      postId: 'post-1',
      action: 'pass' as const,
    };
    const { keepChannelOpen } = dispatchMessage({ type: 'SCAN_LOG', payload });
    // service-worker.ts:57 — return false (fire-and-forget; no async response).
    expect(keepChannelOpen).toBe(false);
    expect(mocks.logScanEvent).toHaveBeenCalledWith(payload);
  });

  it('SCAN_LOG logScanEvent rejection does not propagate (silent .catch)', async () => {
    mocks.logScanEvent.mockRejectedValueOnce(new Error('idb dead'));
    const payload = {
      timestamp: '2026-05-15T00:00:00.000Z',
      platform: 'twitter' as const,
      feedSource: 'home' as const,
      author: '@a',
      postId: 'post-1',
      action: 'pass' as const,
    };
    dispatchMessage({ type: 'SCAN_LOG', payload });
    await flush();
    expect(mocks.logScanEvent).toHaveBeenCalled();
    // No further assertion needed: if .catch were missing the unhandled
    // rejection would fail this test.
  });

  it('CAPTURE_PROMPT_IO dispatches payload to capturePromptIO and returns false', () => {
    const payload = {
      timestamp: Date.now(),
      stage: 'classify' as const,
      sliceProse: 'slice-prose',
      systemPrompt: 'sys',
      userPrompt: 'user',
      rawResponse: '{"r":1}',
      locale: 'en' as const,
      mode: 'teen' as const,
    };
    const { keepChannelOpen } = dispatchMessage({ type: 'CAPTURE_PROMPT_IO', payload });
    // service-worker.ts:67 — fire-and-forget, return false. Decision 7.
    expect(keepChannelOpen).toBe(false);
    expect(mocks.capturePromptIO).toHaveBeenCalledWith(payload);
  });

  it('CAPTURE_PROMPT_IO swallows capture-side failures (Decision 7 reversibility)', async () => {
    mocks.capturePromptIO.mockRejectedValueOnce(new Error('idb broken'));
    dispatchMessage({
      type: 'CAPTURE_PROMPT_IO',
      payload: {
        timestamp: Date.now(),
        stage: 'classify',
        sliceProse: '',
        systemPrompt: '',
        userPrompt: '',
        rawResponse: '',
      },
    });
    await flush();
    expect(mocks.capturePromptIO).toHaveBeenCalled();
  });

  it('CAPTURE_BEHAVIOR dispatches payload to captureBehaviorEvent and returns false', () => {
    const payload = {
      ts: Date.now(),
      postId: 'post-99',
      eventKind: 'dispatched' as const,
      ageMs: 42,
    };
    const { keepChannelOpen } = dispatchMessage({ type: 'CAPTURE_BEHAVIOR', payload });
    // service-worker.ts:71.
    expect(keepChannelOpen).toBe(false);
    expect(mocks.captureBehaviorEvent).toHaveBeenCalledWith(payload);
  });

  it('CAPTURE_PERF_RECORD dispatches payload to persistRecord (v2 perf-trace metrics store) and returns false', () => {
    // 2026-08-24 defect: content-realm perf-trace persist opened
    // feelingwise-pipeline-v2-metrics directly and hit the realm guard
    // (RealmGuardError, "[FW perf-trace] persist failed"). Fix routes the
    // record here instead — this is the extension-origin write.
    const payload = {
      version: 1 as const,
      timestamp: Date.now(),
      stage: 'combined_call',
      ms: 123.4,
      platform: 'twitter',
      mode: 'teen' as const,
      provider: 'groq' as const,
      success: true,
    };
    const { keepChannelOpen } = dispatchMessage({ type: 'CAPTURE_PERF_RECORD', payload });
    expect(keepChannelOpen).toBe(false);
    expect(mocks.persistPerfRecord).toHaveBeenCalledWith(payload);
  });

  it('CAPTURE_PERF_RECORD swallows persist-side failures (perf-trace is diagnostic-only)', async () => {
    mocks.persistPerfRecord.mockRejectedValueOnce(new Error('idb broken'));
    dispatchMessage({
      type: 'CAPTURE_PERF_RECORD',
      payload: {
        version: 1,
        timestamp: Date.now(),
        stage: 'video_gemini_call',
        ms: 500,
        platform: 'tiktok',
        mode: 'teen',
        success: true,
      },
    });
    await flush();
    expect(mocks.persistPerfRecord).toHaveBeenCalled();
    // No further assertion needed: if .catch were missing, the unhandled
    // rejection would fail this test.
  });

  it('NEUTRALIZATION_COMPLETE increments daily counter and updates badge', async () => {
    mocks.getSettings.mockResolvedValueOnce({ totalNeutralizedToday: 42 } as unknown as never);
    const { keepChannelOpen } = dispatchMessage({ type: 'NEUTRALIZATION_COMPLETE' });
    // service-worker.ts NEUTRALIZATION_COMPLETE handler — fire-and-forget.
    expect(keepChannelOpen).toBe(false);
    // Ship #19 (2026-05-24): handler wraps incrementNeutralized in
    // counterWriteLock (audit A6 V1.5 #11 race fix). The call now
    // happens inside a microtask-delayed lock acquisition — flush
    // BEFORE asserting incrementNeutralized was called.
    await flush();
    expect(mocks.incrementNeutralized).toHaveBeenCalled();
    await flush();
    await flush();
    expect(captured.badgeTextCalls).toContainEqual({ text: '42' });
    expect(captured.badgeBgColorCalls).toContainEqual({ color: '#00bcd4' });
  });

  it('M26: NEUTRALIZATION_COMPLETE retries a transient failure, then increments once', async () => {
    // A single transient chrome.storage failure used to drop the increment and
    // only warn — the badge then drifted below the real count. The handler now
    // retries with backoff (immediate, 100ms, 500ms). One failure then success
    // must call incrementNeutralized twice (1 fail + 1 success) and still
    // update the badge from the successful read.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.incrementNeutralized
      .mockRejectedValueOnce(new Error('transient storage error'))
      .mockResolvedValueOnce(undefined);
    mocks.getSettings.mockResolvedValueOnce({ totalNeutralizedToday: 9 } as unknown as never);

    dispatchMessage({ type: 'NEUTRALIZATION_COMPLETE' });

    // Past the first backoff (100ms) on fake timers: the suite pays no wall clock for a wait the
    // handler schedules, and the wait cannot grow flaky under load (PLAN-2026-09-16 item 7.7).
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(200);
    vi.useRealTimers();

    // Called twice: one rejected attempt, one successful retry.
    expect(mocks.incrementNeutralized).toHaveBeenCalledTimes(2);
    // Badge updated from the successful read (proves the retry path completed).
    expect(captured.badgeTextCalls).toContainEqual({ text: '9' });
    warnSpy.mockRestore();
  });

  it('M26: NEUTRALIZATION_COMPLETE leaves a warn when all retries fail (no throw escapes)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.incrementNeutralized.mockRejectedValue(new Error('persistent storage error'));

    dispatchMessage({ type: 'NEUTRALIZATION_COMPLETE' });
    // Past all three backoffs (0 + 100 + 500) on fake timers.
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(800);
    vi.useRealTimers();

    // All three attempts ran.
    expect(mocks.incrementNeutralized).toHaveBeenCalledTimes(3);
    // The final failure surfaced as a warn (acceptable per spec), not a throw.
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ─── Suite (3): Async ack handlers (return true; sendResponse {ok:true/false}) ─

describe('service-worker — async ack envelope handlers', () => {
  it('PASS_LOG durably enqueues the exact payload before acknowledging', async () => {
    const payload = {
      originalText: 'a benign post',
      analysis: {
        postId: 'p1',
        techniques: [],
        overallScore: 1,
        overallConfidence: 0.5,
        isManipulative: false,
        processingTimeMs: 5,
      },
      mode: 'teen' as const,
      platform: 'twitter' as const,
      aiSource: 'cloud' as const,
      passReason: 'below-threshold',
    };
    const { keepChannelOpen, responsePromise } = dispatchMessage({
      type: 'PASS_LOG',
      payload,
      deliveryId: 'delivery-pass',
      deliveryCapturedAt: '2026-07-11T10:00:00.000Z',
    });
    expect(keepChannelOpen).toBe(true);
    expect(await responsePromise).toEqual({
      ok: true,
      deliveryId: 'delivery-pass',
      state: 'pending',
    });
    expect(mocks.enqueueForensicDelivery).toHaveBeenCalledWith({
      deliveryId: 'delivery-pass',
      type: 'PASS_LOG',
      payload,
      enqueuedAt: '2026-07-11T10:00:00.000Z',
    });
    expect(mocks.kickForensicDeliveryPump).toHaveBeenCalledTimes(1);
  });

  it('PASS_LOG enqueue rejection produces {ok:false} ack', async () => {
    mocks.enqueueForensicDelivery.mockRejectedValueOnce(new Error('outbox failed'));
    const { responsePromise } = dispatchMessage({
      type: 'PASS_LOG',
      payload: {
        originalText: 'x',
        analysis: {
          postId: 'p',
          techniques: [],
          overallScore: 0,
          overallConfidence: 0,
          isManipulative: false,
          processingTimeMs: 0,
        },
        mode: 'teen',
        platform: 'twitter',
        aiSource: 'cloud',
        passReason: 'no-pattern',
      },
      deliveryId: 'delivery-pass-failed',
    });
    expect(await responsePromise).toEqual({ ok: false, error: 'outbox failed' });
  });

  it('does not acknowledge a forensic message until its outbox transaction commits', async () => {
    let release!: (value: { state: 'pending' }) => void;
    mocks.enqueueForensicDelivery.mockImplementationOnce(
      () => new Promise(resolve => { release = resolve; }),
    );
    const { responsePromise } = dispatchMessage({
      type: 'PASS_LOG',
      payload: { originalText: 'queued' },
      deliveryId: 'delivery-await-commit',
    });
    let acknowledged = false;
    void responsePromise.then(() => { acknowledged = true; });
    await Promise.resolve();

    expect(acknowledged).toBe(false);
    expect(mocks.kickForensicDeliveryPump).not.toHaveBeenCalled();

    release({ state: 'pending' });
    await expect(responsePromise).resolves.toMatchObject({ ok: true });
  });

  it.each([undefined, '', '   '])('rejects a missing/blank forensic delivery id (%s)', async (deliveryId) => {
    const { responsePromise } = dispatchMessage({
      type: 'PASS_LOG',
      payload: { originalText: 'missing id' },
      deliveryId,
    });
    expect(await responsePromise).toEqual({
      ok: false,
      error: 'missing forensic delivery id',
    });
    expect(mocks.enqueueForensicDelivery).not.toHaveBeenCalled();
  });

  it('rejects an invalid capture timestamp before durable enqueue', async () => {
    const { responsePromise } = dispatchMessage({
      type: 'PASS_LOG',
      payload: { originalText: 'bad clock' },
      deliveryId: 'delivery-invalid-time',
      deliveryCapturedAt: 'not-a-date',
    });
    expect(await responsePromise).toEqual({
      ok: false,
      error: 'invalid forensic capture timestamp',
    });
    expect(mocks.enqueueForensicDelivery).not.toHaveBeenCalled();
  });

  it('FORENSIC_LOG forwards the full payload object to the durable outbox', async () => {
    // Ship #18 (2026-05-24): logForensicEvent refactored from 21-positional-
    // args to a single ForensicEventInput object payload. The SW handler
    // now passes message.payload directly (with feedSource defaulted to
    // 'unknown'). A regression that drops fields at the dispatch boundary
    // (the pre-Phase-1.6.2 harmFloor precedent) is caught by asserting
    // the full object passed through.
    const payload = {
      originalText: 'manipulative',
      neutralizedText: 'softened',
      analysis: {
        postId: 'p1',
        techniques: [{ technique: 'fear-appeal', present: true, confidence: 0.9, severity: 7, evidence: [] }],
        overallScore: 7,
        overallConfidence: 0.9,
        isManipulative: true,
        processingTimeMs: 10,
      },
      mode: 'teen' as const,
      platform: 'tiktok' as const,
      aiSource: 'cloud' as const,
      author: '@bad',
      postUrl: 'https://x.com/p/9',
      feedSource: 'home' as const,
      aiModel: 'groq-llama',
      aiProvider: 'groq',
      detectionMode: 'cascade-v2',
      configSnapshot: { mode: 'teen', threshold: 0.6, dailyCap: 200 },
      kind: 'comment' as const,
      parentVideoId: 'v-456',
      parentRecordId: 'fr-parent-1',
      commentDepth: 2,
      roomAuthor: '@channel',
      roomCaption: 'caption',
      roomUrl: 'https://x.com/v/456',
      harmFloor: { kind: 'shame-attack', severity: 8 } as never,
    };
    const { keepChannelOpen, responsePromise } = dispatchMessage({
      type: 'FORENSIC_LOG',
      payload,
      deliveryId: 'delivery-forensic',
      deliveryCapturedAt: '2026-07-11T10:00:00.000Z',
    });
    expect(keepChannelOpen).toBe(true);
    expect(await responsePromise).toEqual({
      ok: true,
      deliveryId: 'delivery-forensic',
      state: 'pending',
    });

    // The handler passes message.payload directly (with feedSource
    // defaulted to 'unknown' if absent). Assert the full object shape.
    expect(mocks.enqueueForensicDelivery).toHaveBeenCalledWith({
      deliveryId: 'delivery-forensic',
      type: 'FORENSIC_LOG',
      payload: {
        ...payload,
        feedSource: payload.feedSource,
      },
      enqueuedAt: '2026-07-11T10:00:00.000Z',
    });
  });

  it('FORENSIC_LOG defaults feedSource="unknown" when payload omits it', async () => {
    // service-worker.ts FORENSIC_LOG handler: feedSource defaulted to
    // 'unknown' if message.payload.feedSource is undefined. Legacy
    // senders that don't include feedSource still produce a record
    // with a defined feedSource value (canonical-payload includes it
    // in the hash so it must always be present).
    const minimal = {
      originalText: 'x',
      neutralizedText: '',
      analysis: {
        postId: 'p',
        techniques: [],
        overallScore: 0,
        overallConfidence: 0,
        isManipulative: false,
        processingTimeMs: 0,
      },
      mode: 'teen' as const,
      platform: 'twitter' as const,
      aiSource: 'cloud' as const,
    };
    const { responsePromise } = dispatchMessage({
      type: 'FORENSIC_LOG',
      payload: minimal,
      deliveryId: 'delivery-default-feed',
    });
    await responsePromise;
    const callArg = mocks.enqueueForensicDelivery.mock.calls[0][0];
    expect(callArg.payload.feedSource).toBe('unknown');
  });

  it('FORENSIC_LOG outbox rejection acks {ok:false}', async () => {
    mocks.enqueueForensicDelivery.mockRejectedValueOnce(new Error('outbox write failed'));
    const { responsePromise } = dispatchMessage({
      type: 'FORENSIC_LOG',
      payload: {
        originalText: 'x',
        neutralizedText: '',
        analysis: {
          postId: 'p',
          techniques: [],
          overallScore: 0,
          overallConfidence: 0,
          isManipulative: false,
          processingTimeMs: 0,
        },
        mode: 'teen',
        platform: 'twitter',
        aiSource: 'cloud',
      },
      deliveryId: 'delivery-forensic-failed',
    });
    expect(await responsePromise).toEqual({ ok: false, error: 'outbox write failed' });
  });

  it('ENVIRONMENT_LOG durably enqueues its payload and acks {ok:true}', async () => {
    const payload = {
      platform: 'tiktok' as const,
      mode: 'teen' as const,
      parentVideoId: 'v-1',
      videoCaption: 'caption',
      environment: {
        label: 'hostile' as const,
        sampled: 12,
        percentages: { flagged: 70, pass: 30, blocked: 0 },
        summary: 'comment section dominated by shame-attack',
        dominantTechnique: 'shame-attack',
      },
    };
    const { keepChannelOpen, responsePromise } = dispatchMessage({
      type: 'ENVIRONMENT_LOG',
      payload,
      deliveryId: 'delivery-environment',
    });
    // service-worker.ts:154.
    expect(keepChannelOpen).toBe(true);
    expect(await responsePromise).toMatchObject({ ok: true, deliveryId: 'delivery-environment' });
    expect(mocks.enqueueForensicDelivery).toHaveBeenCalledWith(expect.objectContaining({
      deliveryId: 'delivery-environment',
      type: 'ENVIRONMENT_LOG',
      payload,
    }));
  });

  it('ENVIRONMENT_LOG enqueue rejection acks {ok:false}', async () => {
    mocks.enqueueForensicDelivery.mockRejectedValueOnce(new Error('boom'));
    const { responsePromise } = dispatchMessage({
      type: 'ENVIRONMENT_LOG',
      payload: {
        platform: 'tiktok',
        mode: 'teen',
        parentVideoId: 'v',
        videoCaption: '',
        environment: {
          label: 'safe',
          sampled: 0,
          percentages: { flagged: 0, pass: 0, blocked: 0 },
          summary: '',
        },
      } as never,
      deliveryId: 'delivery-environment-failed',
    });
    expect(await responsePromise).toEqual({ ok: false, error: 'boom' });
  });

  it('CANCEL_LOG durably enqueues its payload and acks {ok:true}', async () => {
    const payload = {
      originalText: 'partial',
      verdict: 'cancelled-mid-flight' as const,
      mode: 'teen' as const,
      platform: 'twitter' as const,
    };
    const { keepChannelOpen, responsePromise } = dispatchMessage({
      type: 'CANCEL_LOG',
      payload,
      deliveryId: 'delivery-cancel',
    });
    // service-worker.ts:171.
    expect(keepChannelOpen).toBe(true);
    expect(await responsePromise).toMatchObject({ ok: true, deliveryId: 'delivery-cancel' });
    expect(mocks.enqueueForensicDelivery).toHaveBeenCalledWith(expect.objectContaining({
      deliveryId: 'delivery-cancel',
      type: 'CANCEL_LOG',
      payload,
    }));
  });

  it('CANCEL_LOG enqueue rejection acks {ok:false}', async () => {
    mocks.enqueueForensicDelivery.mockRejectedValueOnce(new Error('boom'));
    const { responsePromise } = dispatchMessage({
      type: 'CANCEL_LOG',
      payload: {
        originalText: 'x',
        verdict: 'cancelled-stale',
        mode: 'teen',
        platform: 'twitter',
      },
      deliveryId: 'delivery-cancel-failed',
    });
    expect(await responsePromise).toEqual({ ok: false, error: 'boom' });
  });

  it('BLOCKED_LOG durably enqueues its payload and acks {ok:true}', async () => {
    const payload = {
      platform: 'tiktok' as const,
      mode: 'teen' as const,
      author: '@blockedCreator',
      postUrl: 'https://tiktok.com/v/1',
      blockReason: 'hashtag',
      matchedToken: '#aiart',
      caption: 'check this out',
    };
    const { keepChannelOpen, responsePromise } = dispatchMessage({
      type: 'BLOCKED_LOG',
      payload,
      deliveryId: 'delivery-blocked',
    });
    // service-worker.ts:188.
    expect(keepChannelOpen).toBe(true);
    expect(await responsePromise).toMatchObject({ ok: true, deliveryId: 'delivery-blocked' });
    expect(mocks.enqueueForensicDelivery).toHaveBeenCalledWith(expect.objectContaining({
      deliveryId: 'delivery-blocked',
      type: 'BLOCKED_LOG',
      payload,
    }));
  });

  it('BLOCKED_LOG enqueue rejection acks {ok:false}', async () => {
    mocks.enqueueForensicDelivery.mockRejectedValueOnce(new Error('boom'));
    const { responsePromise } = dispatchMessage({
      type: 'BLOCKED_LOG',
      payload: {
        platform: 'tiktok',
        mode: 'teen',
        author: '@a',
        postUrl: '',
        blockReason: 'hashtag',
        matchedToken: '#x',
        caption: '',
      },
      deliveryId: 'delivery-blocked-failed',
    });
    expect(await responsePromise).toEqual({ ok: false, error: 'boom' });
  });

  it('AUTHOR_UPDATE dispatches each field positionally to updateAuthorProfile, acks {ok:true}', async () => {
    const payload = {
      author: '@badactor',
      platform: 'twitter',
      flagged: true,
      techniques: ['shame-attack', 'fear-appeal'],
    };
    const { keepChannelOpen, responsePromise } = dispatchMessage({
      type: 'AUTHOR_UPDATE',
      payload,
    });
    expect(keepChannelOpen).toBe(true);
    // Ship #19 (2026-05-24): handler wraps updateAuthorProfile in a
    // per-author lock so the readonly-get + readwrite-put race is
    // serialized across parallel updates to the same author (audit
    // A6 V1.5 #11). Updates land via microtask — assert AFTER the
    // ack promise resolves.
    expect(await responsePromise).toEqual({ ok: true });
    // Positional: updateAuthorProfile(author, platform, flagged, techniques,
    // day?, textHash?). The exposure pair is optional, so a sender that omits
    // it forwards undefined and updates only the flag counts.
    expect(mocks.updateAuthorProfile).toHaveBeenCalledWith(
      payload.author,
      payload.platform,
      payload.flagged,
      payload.techniques,
      undefined,
      undefined,
    );
  });

  it('AUTHOR_UPDATE forwards the exposure pair when the sender supplies it', async () => {
    const payload = {
      author: '@advertiser',
      platform: 'facebook',
      flagged: false,
      techniques: [],
      day: '2026-08-26',
      textHash: 'abc123',
    };
    const { responsePromise } = dispatchMessage({ type: 'AUTHOR_UPDATE', payload });
    expect(await responsePromise).toEqual({ ok: true });
    expect(mocks.updateAuthorProfile).toHaveBeenCalledWith(
      payload.author,
      payload.platform,
      payload.flagged,
      payload.techniques,
      payload.day,
      payload.textHash,
    );
  });

  it('AUTHOR_UPDATE forwards the surface and whether the notice spoke, for the gate\'s window and once-a-day cap', async () => {
    const payload = {
      author: '@source',
      platform: 'youtube',
      flagged: false,
      techniques: [],
      day: '2026-10-13',
      textHash: 'abc123',
      surface: 'for-you',
      noticed: true,
    };
    const { responsePromise } = dispatchMessage({ type: 'AUTHOR_UPDATE', payload });
    expect(await responsePromise).toEqual({ ok: true });
    expect(mocks.updateAuthorProfile).toHaveBeenCalledWith(
      payload.author,
      payload.platform,
      payload.flagged,
      payload.techniques,
      payload.day,
      payload.textHash,
      { surface: 'for-you', noticed: true },
    );
  });

  it('AUTHOR_UPDATE updateAuthorProfile rejection acks {ok:false}', async () => {
    mocks.updateAuthorProfile.mockRejectedValueOnce(new Error('boom'));
    const { responsePromise } = dispatchMessage({
      type: 'AUTHOR_UPDATE',
      payload: { author: '@x', platform: 'tw', flagged: false, techniques: [] },
    });
    expect(await responsePromise).toEqual({ ok: false });
  });

  // STORAGE-LICENCE-WORKER-7/9: the SW is the single writer of the usage
  // counters; every other realm sends USAGE_INCREMENT and waits for the ack.
  it('USAGE_INCREMENT applies the increment in this realm and acks {ok:true}', async () => {
    const { keepChannelOpen, responsePromise } = dispatchMessage({
      type: 'USAGE_INCREMENT',
      payload: { kind: 'ai-call', inputTokens: 100, outputTokens: 50, tokenEquivalents: 225, provider: 'groq', model: 'openai/gpt-oss-20b' },
    });
    expect(keepChannelOpen).toBe(true);
    expect(await responsePromise).toEqual({ ok: true });
    expect(mocks.applyUsageIncrement).toHaveBeenCalledWith({
      kind: 'ai-call', inputTokens: 100, outputTokens: 50, tokenEquivalents: 225, provider: 'groq', model: 'openai/gpt-oss-20b',
    });
  });

  it('USAGE_INCREMENT without a kind is refused and never writes', async () => {
    const { responsePromise } = dispatchMessage({ type: 'USAGE_INCREMENT', payload: {} });
    expect(await responsePromise).toMatchObject({ ok: false });
    expect(mocks.applyUsageIncrement).not.toHaveBeenCalled();
  });

  it('USAGE_INCREMENT write failure acks {ok:false,error} so the sender knows the count was lost', async () => {
    mocks.applyUsageIncrement.mockRejectedValueOnce(new Error('storage unavailable'));
    const { responsePromise } = dispatchMessage({ type: 'USAGE_INCREMENT', payload: { kind: 'neutralized' } });
    expect(await responsePromise).toEqual({ ok: false, error: 'storage unavailable' });
  });

  // EVIDENCE-PATH-2: content realms cannot open the extension-origin author
  // store, so the pipeline's suspicion-boost lookup asks the SW.
  it('GET_AUTHOR_PROFILE reads the profile at the extension origin and replies with it', async () => {
    const profile = {
      profileKey: '@badactor@twitter',
      handle: '@badactor',
      platform: 'twitter',
      totalSeen: 10,
      totalFlagged: 8,
      techniques: { 'shame-attack': 8 },
      firstSeen: '2026-05-15T00:00:00.000Z',
      lastSeen: '2026-05-20T00:00:00.000Z',
    };
    mocks.getAuthorProfile.mockResolvedValueOnce(profile);
    const { keepChannelOpen, responsePromise } = dispatchMessage({
      type: 'GET_AUTHOR_PROFILE',
      payload: { handle: '@badactor', platform: 'twitter' },
    });
    expect(keepChannelOpen).toBe(true);
    expect(await responsePromise).toEqual({ ok: true, profile });
    expect(mocks.getAuthorProfile).toHaveBeenCalledWith('@badactor', 'twitter');
  });

  it('GET_AUTHOR_PROFILE without a handle replies {ok:false} and never reads', async () => {
    const { responsePromise } = dispatchMessage({
      type: 'GET_AUTHOR_PROFILE',
      payload: { handle: '' },
    });
    expect(await responsePromise).toMatchObject({ ok: false });
    expect(mocks.getAuthorProfile).not.toHaveBeenCalled();
  });

  it('GET_AUTHOR_PROFILE store failure replies {ok:false,error}', async () => {
    mocks.getAuthorProfile.mockRejectedValueOnce(new Error('idb closed'));
    const { responsePromise } = dispatchMessage({
      type: 'GET_AUTHOR_PROFILE',
      payload: { handle: '@x' },
    });
    expect(await responsePromise).toEqual({ ok: false, error: 'idb closed' });
  });

  // The reading's line from the record (content/read-this.ts): the chain is
  // extension-origin IndexedDB, so the count runs here, over the last week,
  // and is only ever shown, never fed back into a verdict.
  it('GET_AUTHOR_WEEK counts this account on this platform over the last week and replies with it', async () => {
    const now = Date.now();
    const rec = (over: Record<string, unknown>) => ({
      id: 'fr', timestamp: new Date(now - 60_000).toISOString(), platform: 'twitter', originalText: 'x',
      originalHash: 'h', originalLength: 1, neutralizedText: '', author: 'alice', postUrl: '', techniques: [],
      overallScore: 0, userAgeCategory: 'adult', aiSource: 'cloud', feedSource: 'unknown', integrityHash: 'i',
      verdict: 'pass', ...over,
    });
    mocks.getRecordsOrThrow.mockResolvedValueOnce([
      rec({ verdict: 'flagged' }), rec({}), rec({ author: 'bob', verdict: 'flagged' }),
    ] as unknown as never);
    const { keepChannelOpen, responsePromise } = dispatchMessage({
      type: 'GET_AUTHOR_WEEK',
      payload: { handle: 'alice', platform: 'twitter' },
    });
    expect(keepChannelOpen).toBe(true);
    expect(await responsePromise).toEqual({ ok: true, seen: 2, charged: 1 });
    const filters = mocks.getRecordsOrThrow.mock.calls[0][0] as { startDate: string };
    expect(Date.parse(filters.startDate)).toBeGreaterThan(now - 8 * 24 * 3600_000);
    expect(Date.parse(filters.startDate)).toBeLessThan(now - 6 * 24 * 3600_000);
  });

  it('GET_AUTHOR_WEEK without a handle or a platform replies {ok:false} and never reads', async () => {
    const { responsePromise } = dispatchMessage({ type: 'GET_AUTHOR_WEEK', payload: { handle: 'alice', platform: '' } });
    expect(await responsePromise).toMatchObject({ ok: false });
    expect(mocks.getRecordsOrThrow).not.toHaveBeenCalled();
  });

  it('GET_AUTHOR_WEEK reports a failed read as a failure, never as an empty week', async () => {
    mocks.getRecordsOrThrow.mockRejectedValueOnce(new Error('idb closed'));
    const { responsePromise } = dispatchMessage({ type: 'GET_AUTHOR_WEEK', payload: { handle: 'alice', platform: 'twitter' } });
    expect(await responsePromise).toEqual({ ok: false, error: 'idb closed' });
  });

  it('RESET_FORENSIC_CHAIN with the correct PIN runs the destructive cutover in the service-worker realm', async () => {
    const { keepChannelOpen, responsePromise } = dispatchMessage({
      type: 'RESET_FORENSIC_CHAIN',
      payload: { reason: 'parent requested reset', pin: '1234' },
    });

    expect(keepChannelOpen).toBe(true);
    expect(await responsePromise).toEqual({
      ok: true,
      result: expect.objectContaining({
        recordsCleared: 3,
        signingIdentityRetained: true,
        resetMarkerWritten: true,
      }),
    });
    // The SW verified the payload PIN itself — the dashboard modal's own
    // verifyPin call is client-side of the boundary and not the gate (F2).
    expect(mocks.verifyPin).toHaveBeenCalledWith('1234');
    expect(mocks.resetForensicChain).toHaveBeenCalledWith('parent requested reset');
  });

  it('RESET_FORENSIC_CHAIN rejects without claiming the chain was cleared', async () => {
    mocks.resetForensicChain.mockRejectedValueOnce(new Error('marker signing failed'));
    const { keepChannelOpen, responsePromise } = dispatchMessage({
      type: 'RESET_FORENSIC_CHAIN',
      payload: { pin: '1234' },
    });

    expect(keepChannelOpen).toBe(true);
    expect(await responsePromise).toEqual({
      ok: false,
      error: 'marker signing failed',
    });
  });

  // F2: the SW boundary is the PIN gate. Any extension realm can post the
  // envelope, so a reset without the correct stored-credential preimage must
  // be refused BEFORE resetForensicChain is reached (chain stays intact).
  it('RESET_FORENSIC_CHAIN without a PIN, where a PIN exists, is refused and never touches the chain', async () => {
    const { keepChannelOpen, responsePromise } = dispatchMessage({
      type: 'RESET_FORENSIC_CHAIN',
      payload: { reason: 'hostile realm, no pin' },
    });

    expect(keepChannelOpen).toBe(true);
    expect(await responsePromise).toEqual({
      ok: false,
      errorKind: 'pin-required',
      error: expect.any(String),
    });
    expect(mocks.verifyPin).not.toHaveBeenCalled();
    expect(mocks.resetForensicChain).not.toHaveBeenCalled();

    // Same refusal for the payload-less envelope shape.
    const bare = dispatchMessage({ type: 'RESET_FORENSIC_CHAIN' });
    expect(bare.keepChannelOpen).toBe(true);
    expect(await bare.responsePromise).toEqual({
      ok: false,
      errorKind: 'pin-required',
      error: expect.any(String),
    });
    expect(mocks.resetForensicChain).not.toHaveBeenCalled();
  });

  it('RESET_FORENSIC_CHAIN with a wrong PIN is refused and never touches the chain', async () => {
    mocks.verifyPin.mockResolvedValueOnce(false as unknown as never);
    const { keepChannelOpen, responsePromise } = dispatchMessage({
      type: 'RESET_FORENSIC_CHAIN',
      payload: { reason: 'guessed pin', pin: '9999' },
    });

    expect(keepChannelOpen).toBe(true);
    expect(await responsePromise).toEqual({
      ok: false,
      errorKind: 'pin-invalid',
      error: expect.any(String),
    });
    expect(mocks.verifyPin).toHaveBeenCalledWith('9999');
    expect(mocks.resetForensicChain).not.toHaveBeenCalled();
  });

  // 14 Sep 2026: an install with no PIN (every adult install, and every fresh
  // install after a reinstall) is not refused. The old answer, "set one in the
  // popup before resetting", is why the reset button did
  // nothing: an adult install never sets a PIN, so it could never reset. The
  // dashboard confirms the act by having the word typed instead, and the
  // identical rule already governs RESTORE_FORENSIC_BACKUP below, which is the
  // more destructive of the two.
  it('RESET_FORENSIC_CHAIN with no parent PIN configured resets without one', async () => {
    mocks.getSettings.mockResolvedValue(
      { totalNeutralizedToday: 7, parentPin: '' } as unknown as never,
    );
    const { keepChannelOpen, responsePromise } = dispatchMessage({
      type: 'RESET_FORENSIC_CHAIN',
      payload: { reason: 'no pin on this install' },
    });

    expect(keepChannelOpen).toBe(true);
    expect(await responsePromise).toEqual({ ok: true, result: expect.anything() });
    expect(mocks.verifyPin).not.toHaveBeenCalled();
    expect(mocks.resetForensicChain).toHaveBeenCalledWith('no pin on this install');
  });

  it('GET_SIGNING_METADATA initializes and returns one SW-owned public identity', async () => {
    const { keepChannelOpen, responsePromise } = dispatchMessage({
      type: 'GET_SIGNING_METADATA',
    });

    expect(keepChannelOpen).toBe(true);
    expect(await responsePromise).toEqual({
      ok: true,
      metadata: {
        publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
        fingerprint: 'fingerprint-1234',
        createdAt: '2026-07-11T00:00:00.000Z',
      },
    });
  });

  it('GET_SIGNING_METADATA failure is explicit', async () => {
    mocks.getPublicKeyJWK.mockRejectedValueOnce(new Error('key store unavailable'));
    const { responsePromise } = dispatchMessage({ type: 'GET_SIGNING_METADATA' });
    expect(await responsePromise).toEqual({ ok: false, error: 'key store unavailable' });
  });

  it('RESTORE_FORENSIC_BACKUP forwards the whole staged restore to the SW realm', async () => {
    const restored = { ok: true, recordsAdded: 4, keyRestored: true };
    mocks.restoreFromBackup.mockResolvedValueOnce(restored as unknown as never);
    const { keepChannelOpen, responsePromise } = dispatchMessage({
      type: 'RESTORE_FORENSIC_BACKUP',
      payload: { raw: '{"backup":true}', passphrase: 'secret', force: true, pin: '1234' },
    });

    expect(keepChannelOpen).toBe(true);
    expect(await responsePromise).toEqual({ ok: true, result: restored });
    expect(mocks.verifyPin).toHaveBeenCalledWith('1234');
    expect(mocks.restoreFromBackup).toHaveBeenCalledWith('{"backup":true}', 'secret', true, undefined);
  });

  // 14 Sep 2026: a restore from a backup folder brings the folder's key file;
  // the secret is handed to the restore and, on success, kept as this
  // install's own so the folder keeps opening after the restore.
  it('RESTORE_FORENSIC_BACKUP forwards a folder key file secret and adopts it on success', async () => {
    const backupMod = await import('../../../src/forensics/backup');
    mocks.restoreFromBackup.mockResolvedValueOnce({ ok: true, recordsAdded: 9 } as unknown as never);
    const { responsePromise } = dispatchMessage({
      type: 'RESTORE_FORENSIC_BACKUP',
      payload: { raw: '{"backup":true}', force: false, pin: '1234', sealSecret: 'folder-secret' },
    });
    expect(await responsePromise).toEqual({ ok: true, result: { ok: true, recordsAdded: 9 } });
    expect(mocks.restoreFromBackup).toHaveBeenCalledWith('{"backup":true}', undefined, false, 'folder-secret');
    expect(vi.mocked(backupMod.adoptBackupSealSecret)).toHaveBeenCalledWith('folder-secret');
  });

  it('RESTORE_FORENSIC_BACKUP does not adopt a folder secret when the restore failed', async () => {
    const backupMod = await import('../../../src/forensics/backup');
    vi.mocked(backupMod.adoptBackupSealSecret).mockClear();
    mocks.restoreFromBackup.mockResolvedValueOnce({ ok: false, error: 'structure' } as unknown as never);
    const { responsePromise } = dispatchMessage({
      type: 'RESTORE_FORENSIC_BACKUP',
      payload: { raw: '{"backup":true}', force: false, pin: '1234', sealSecret: 'folder-secret' },
    });
    await responsePromise;
    expect(vi.mocked(backupMod.adoptBackupSealSecret)).not.toHaveBeenCalled();
  });

  it('RESTORE_FORENSIC_BACKUP failure does not claim a restore', async () => {
    mocks.restoreFromBackup.mockRejectedValueOnce(new Error('restore transaction failed'));
    const { responsePromise } = dispatchMessage({
      type: 'RESTORE_FORENSIC_BACKUP',
      payload: { raw: '{}', force: false, pin: '1234' },
    });
    expect(await responsePromise).toEqual({ ok: false, error: 'restore transaction failed' });
  });

  // The restore envelope can replace every record and the signing key, and
  // the dashboard opens without a PIN, so the SW boundary is the gate, exactly
  // as for RESET_FORENSIC_CHAIN.
  it('RESTORE_FORENSIC_BACKUP without a PIN answers pin-required and never calls restoreFromBackup', async () => {
    const { keepChannelOpen, responsePromise } = dispatchMessage({
      type: 'RESTORE_FORENSIC_BACKUP',
      payload: { raw: '{"backup":true}', force: true },
    });
    expect(keepChannelOpen).toBe(true);
    expect(await responsePromise).toEqual({
      ok: false,
      errorKind: 'pin-required',
      error: expect.any(String),
    });
    expect(mocks.verifyPin).not.toHaveBeenCalled();
    expect(mocks.restoreFromBackup).not.toHaveBeenCalled();
  });

  it('RESTORE_FORENSIC_BACKUP with a wrong PIN answers pin-invalid and never calls restoreFromBackup', async () => {
    mocks.verifyPin.mockResolvedValueOnce(false as unknown as never);
    const { responsePromise } = dispatchMessage({
      type: 'RESTORE_FORENSIC_BACKUP',
      payload: { raw: '{"backup":true}', force: true, pin: '9999' },
    });
    expect(await responsePromise).toEqual({
      ok: false,
      errorKind: 'pin-invalid',
      error: expect.any(String),
    });
    expect(mocks.verifyPin).toHaveBeenCalledWith('9999');
    expect(mocks.restoreFromBackup).not.toHaveBeenCalled();
  });

  // 14 Sep 2026: an install with no PIN (an adult install, or a fresh install
  // after a reinstall, which is when a restore is needed) is not refused. The
  // old answer, "set a PIN in the popup first", made the restore impossible
  // exactly where it mattered. The gate stays wherever a PIN exists.
  it('RESTORE_FORENSIC_BACKUP with no parent PIN configured proceeds without one', async () => {
    mocks.getSettings.mockResolvedValue(
      { totalNeutralizedToday: 7, parentPin: '' } as unknown as never,
    );
    mocks.restoreFromBackup.mockResolvedValueOnce({ ok: true, recordsAdded: 3 } as unknown as never);
    const { responsePromise } = dispatchMessage({
      type: 'RESTORE_FORENSIC_BACKUP',
      payload: { raw: '{"backup":true}', force: true },
    });
    expect(await responsePromise).toEqual({ ok: true, result: { ok: true, recordsAdded: 3 } });
    expect(mocks.verifyPin).not.toHaveBeenCalled();
    expect(mocks.restoreFromBackup).toHaveBeenCalledWith('{"backup":true}', undefined, true, undefined);
  });

  it('SW-2: RESTORE_FORENSIC_BACKUP with no payload responds with a structured error, not a throw', async () => {
    // Every sibling privileged branch (AUTHOR_UPDATE, MANUAL_FLAG,
    // the FORENSIC_DELIVERY_TYPES branch) guards on
    // `&& message.payload`. RESTORE_FORENSIC_BACKUP previously destructured
    // `message.payload` unconditionally, so a malformed message (payload
    // undefined) threw synchronously inside the shared listener and
    // sendResponse was never called — a silent hang on the single most
    // destructive operation the SW exposes. It must now ack {ok:false,
    // errorKind:'missing-payload'} instead.
    const { keepChannelOpen, responsePromise } = dispatchMessage({
      type: 'RESTORE_FORENSIC_BACKUP',
      // payload deliberately omitted — malformed message.
    });
    expect(keepChannelOpen).toBe(true);
    expect(await responsePromise).toEqual({
      ok: false,
      errorKind: 'missing-payload',
      error: 'RESTORE_FORENSIC_BACKUP message is missing its payload',
    });
    expect(mocks.restoreFromBackup).not.toHaveBeenCalled();
  });

  it('GET_CHAIN_DEBUG_STATS reads chain via getRecords + delegates to debug-stats builder', async () => {
    const fakeRecords = [
      { id: 'fr-1', verdict: 'flagged', timestamp: '2026-05-15T00:00:00.000Z' },
      { id: 'fr-2', verdict: 'pass', timestamp: '2026-05-15T00:00:01.000Z' },
    ];
    mocks.getRecords.mockResolvedValueOnce(fakeRecords as unknown as never);
    mocks.buildChainDebugStatsResponse.mockReturnValueOnce({
      ok: true,
      totalRecords: 2,
      verdictCounts: {
        flagged: 1,
        'flagged-hidden': 0,
        blocked: 0,
        pass: 1,
        'flagged-undefined': 0,
        other: 0,
      },
      last10Records: [],
    });

    const { keepChannelOpen, responsePromise } = dispatchMessage({
      type: 'GET_CHAIN_DEBUG_STATS',
    });
    // service-worker.ts:262.
    expect(keepChannelOpen).toBe(true);

    const response = (await responsePromise) as { ok: boolean; totalRecords: number };

    // Assertion ordering: buildChainDebugStatsResponse runs AFTER the
    // getRecords promise resolves (service-worker.ts:254-258). The
    // response-promise await above ensures the .then chain has fired.
    expect(mocks.getRecords).toHaveBeenCalled();
    expect(mocks.buildChainDebugStatsResponse).toHaveBeenCalledWith(fakeRecords);
    expect(response.ok).toBe(true);
    expect(response.totalRecords).toBe(2);
  });

  it('GET_CHAIN_DEBUG_STATS getRecords rejection acks {ok:false}', async () => {
    mocks.getRecords.mockRejectedValueOnce(new Error('idb dead'));
    const { responsePromise } = dispatchMessage({ type: 'GET_CHAIN_DEBUG_STATS' });
    expect(await responsePromise).toEqual({ ok: false });
    // buildChainDebugStatsResponse was NOT called on the error path.
    expect(mocks.buildChainDebugStatsResponse).not.toHaveBeenCalled();
  });
});

// ─── Suite (3b): RECHECK_RECORD confirmation (M23) ───────────────────────────
//
// recheckRecord opens a background tab, then races the matching tab's durable
// outbox-commit signal against the 9s window. It acks recorded:true only after
// enqueue succeeds, and recorded:false on timeout or enqueue failure.

describe('service-worker — RECHECK_RECORD confirmation (M23)', () => {
  const RECHECK_TAB_ID = 4242; // matches the chrome.tabs.create stub

  it('acks recorded:true after the rechecked tab durably enqueues FORENSIC_LOG', async () => {
    const { keepChannelOpen, responsePromise } = dispatchMessage({
      type: 'RECHECK_RECORD',
      payload: { url: 'https://x.com/p/9' },
    });
    expect(keepChannelOpen).toBe(true);

    // Let chrome.tabs.create resolve + the durable-commit waiter register.
    await flush();
    expect(captured.tabsCreated).toContainEqual({ url: 'https://x.com/p/9', active: false });

    const delivery = dispatchMessage({
      type: 'FORENSIC_LOG',
      payload: {},
      deliveryId: 'recheck-flagged',
    }, { id: FW_EXTENSION_ID, tab: { id: RECHECK_TAB_ID } });
    await expect(delivery.responsePromise).resolves.toMatchObject({ ok: true });

    expect(await responsePromise).toEqual({ ok: true, recorded: true });
    expect(captured.tabsRemoved).toContain(RECHECK_TAB_ID);
  });

  it('acks recorded:true after the rechecked tab durably enqueues PASS_LOG', async () => {
    const { responsePromise } = dispatchMessage({
      type: 'RECHECK_RECORD',
      payload: { url: 'https://x.com/p/10' },
    });
    await flush();
    const delivery = dispatchMessage({
      type: 'PASS_LOG',
      payload: {},
      deliveryId: 'recheck-pass',
    }, { id: FW_EXTENSION_ID, tab: { id: RECHECK_TAB_ID } });
    await delivery.responsePromise;
    expect(await responsePromise).toEqual({ ok: true, recorded: true });
  });

  it('ignores chain-writes from a DIFFERENT tab id (only the rechecked tab counts)', async () => {
    vi.useFakeTimers();
    try {
      const { responsePromise } = dispatchMessage({
        type: 'RECHECK_RECORD',
        payload: { url: 'https://x.com/p/11' },
      });
      // Flush the tab-create microtask under fake timers.
      await vi.advanceTimersByTimeAsync(0);

      // A durable delivery from an unrelated tab must NOT resolve recorded:true.
      const delivery = dispatchMessage({
        type: 'FORENSIC_LOG',
        payload: {},
        deliveryId: 'unrelated-tab',
      }, { id: FW_EXTENSION_ID, tab: { id: 9999 } });
      await delivery.responsePromise;

      // Window elapses with no matching signal → recorded:false.
      await vi.advanceTimersByTimeAsync(9000);
      expect(await responsePromise).toEqual({ ok: true, recorded: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not report recorded:true when the matching tab enqueue fails', async () => {
    vi.useFakeTimers();
    try {
      const { responsePromise } = dispatchMessage({
        type: 'RECHECK_RECORD',
        payload: { url: 'https://x.com/p/13' },
      });
      await vi.advanceTimersByTimeAsync(0);
      mocks.enqueueForensicDelivery.mockRejectedValueOnce(new Error('outbox unavailable'));
      const delivery = dispatchMessage({
        type: 'PASS_LOG',
        payload: {},
        deliveryId: 'recheck-enqueue-failed',
      }, { id: FW_EXTENSION_ID, tab: { id: RECHECK_TAB_ID } });
      await expect(delivery.responsePromise).resolves.toMatchObject({ ok: false });

      await vi.advanceTimersByTimeAsync(9000);
      expect(await responsePromise).toEqual({ ok: true, recorded: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not report recorded:true when reset fencing discards the delivery', async () => {
    vi.useFakeTimers();
    try {
      const { responsePromise } = dispatchMessage({
        type: 'RECHECK_RECORD',
        payload: { url: 'https://x.com/p/14' },
      });
      await vi.advanceTimersByTimeAsync(0);
      mocks.enqueueForensicDelivery.mockResolvedValueOnce({ state: 'discarded' });
      const delivery = dispatchMessage({
        type: 'PASS_LOG',
        payload: {},
        deliveryId: 'recheck-discarded-by-reset',
      }, { id: FW_EXTENSION_ID, tab: { id: RECHECK_TAB_ID } });
      await expect(delivery.responsePromise).resolves.toMatchObject({
        ok: true,
        state: 'discarded',
      });

      await vi.advanceTimersByTimeAsync(9000);
      expect(await responsePromise).toEqual({ ok: true, recorded: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not report recorded:true while the delivery remains queued', async () => {
    vi.useFakeTimers();
    try {
      mocks.getForensicDeliveryReceiptState.mockResolvedValue(null);
      const { responsePromise } = dispatchMessage({
        type: 'RECHECK_RECORD',
        payload: { url: 'https://x.com/p/15' },
      });
      await vi.advanceTimersByTimeAsync(0);
      const delivery = dispatchMessage({
        type: 'PASS_LOG',
        payload: {},
        deliveryId: 'recheck-still-queued',
      }, { id: FW_EXTENSION_ID, tab: { id: RECHECK_TAB_ID } });
      await expect(delivery.responsePromise).resolves.toMatchObject({ ok: true, state: 'pending' });

      await vi.advanceTimersByTimeAsync(9000);
      expect(await responsePromise).toEqual({ ok: true, recorded: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it('acks recorded:false on timeout when no chain-write arrives', async () => {
    vi.useFakeTimers();
    try {
      const { responsePromise } = dispatchMessage({
        type: 'RECHECK_RECORD',
        payload: { url: 'https://x.com/p/12' },
      });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(9000);
      expect(await responsePromise).toEqual({ ok: true, recorded: false });
      expect(captured.tabsRemoved).toContain(RECHECK_TAB_ID);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── Suite (3c): RECHECK_RECORD URL scheme guard (SEC-2/M76) ────────────────
//
// `payload.url` is a forensic record's postUrl — DOM-derived, attacker-
// influenced text captured from the platform page. recheckRecord must refuse
// to open anything that isn't an ordinary http(s) address, and must never
// call chrome.tabs.create for a refused URL.

describe('service-worker — RECHECK_RECORD URL scheme guard (SEC-2/M76)', () => {
  it.each([
    ['javascript:alert(1)'],
    ['chrome-extension://abcdefg/page.html'],
    ['file:///etc/passwd'],
    ['data:text/html,<script>alert(1)</script>'],
  ])('refuses a non-http(s) URL (%s) with a structured error and never opens a tab', async (url) => {
    const { keepChannelOpen, responsePromise } = dispatchMessage({
      type: 'RECHECK_RECORD',
      payload: { url },
    });
    expect(keepChannelOpen).toBe(true);
    expect(await responsePromise).toEqual({
      ok: false,
      error: `Refusing to recheck non-http(s) URL: ${url}`,
    });
    expect(captured.tabsCreated).toEqual([]);
  });

  it('allows an http(s) URL through unchanged', async () => {
    vi.useFakeTimers();
    try {
      const { responsePromise } = dispatchMessage({
        type: 'RECHECK_RECORD',
        payload: { url: 'https://x.com/p/scheme-guard-ok' },
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(captured.tabsCreated).toContainEqual({
        url: 'https://x.com/p/scheme-guard-ok',
        active: false,
      });
      // No matching delivery signal arrives; let the window elapse so the
      // pending promise resolves and the test doesn't leak a dangling timer.
      await vi.advanceTimersByTimeAsync(9000);
      expect(await responsePromise).toEqual({ ok: true, recorded: false });
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── Suite (4): Unknown / malformed envelopes ────────────────────────────────

describe('service-worker — unknown / malformed envelopes', () => {
  it('returns false (no async response) for an unknown message type', () => {
    // service-worker.ts:265 — the final `return false` after all branches.
    const { keepChannelOpen } = dispatchMessage({ type: 'TOTALLY_BOGUS_TYPE' });
    expect(keepChannelOpen).toBe(false);
    // No downstream call.
    expect(mocks.enqueueForensicDelivery).not.toHaveBeenCalled();
    expect(mocks.logScanEvent).not.toHaveBeenCalled();
  });

  it('returns false for known type with missing payload (handlers guard on `&& message.payload`)', () => {
    // Several handlers guard on `message.type === 'X' && message.payload`
    // (service-worker.ts:53, 64, 68, 93, 103, 147, 164, 181, 191, 207).
    // A SCAN_LOG without payload should not dispatch logScanEvent.
    const { keepChannelOpen } = dispatchMessage({ type: 'SCAN_LOG' });
    // Falls through every type-specific branch + hits the final `return false`.
    expect(keepChannelOpen).toBe(false);
    expect(mocks.logScanEvent).not.toHaveBeenCalled();
  });
});

// ─── Suite (5): sender + message-type validation (SW-1/SEC-2/M76) ───────────
//
// Proposal 1 of docs/audits/swarm-2026-07-13/12-service-worker.md: wire the
// previously-dead FW_MESSAGE_TYPES allowlist + a sender.id === chrome.runtime.id
// check into the top of the listener. Verified the allowlist already matches
// every branch the listener actually handles (17 types, 1:1), so it's wired
// as-is with no update needed.

describe('service-worker — sender + message-type validation (SW-1/SEC-2/M76)', () => {
  it('rejects a message whose sender.id is not this extension, with no downstream dispatch', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const payload = {
      timestamp: '2026-07-13T00:00:00.000Z',
      platform: 'twitter' as const,
      feedSource: 'home' as const,
      author: '@a',
      postId: 'post-1',
      action: 'pass' as const,
    };
    const { keepChannelOpen } = dispatchMessage(
      { type: 'SCAN_LOG', payload },
      { id: 'some-other-extension-id' },
    );
    expect(keepChannelOpen).toBe(false);
    expect(mocks.logScanEvent).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('rejects a message with a valid same-extension sender but an unrecognized type', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { keepChannelOpen } = dispatchMessage({
      type: 'NOT_A_REAL_FW_MESSAGE_TYPE',
      payload: { anything: true },
    });
    expect(keepChannelOpen).toBe(false);
    expect(mocks.enqueueForensicDelivery).not.toHaveBeenCalled();
    expect(mocks.logScanEvent).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('still dispatches a legitimate same-extension, known-type message', () => {
    // Same-extension sender (matches chrome.runtime.id) + a real FW_MESSAGE_TYPES
    // discriminator must pass through unaffected by the new guard.
    const payload = {
      timestamp: '2026-07-13T00:00:00.000Z',
      platform: 'twitter' as const,
      feedSource: 'home' as const,
      author: '@a',
      postId: 'post-2',
      action: 'pass' as const,
    };
    const { keepChannelOpen } = dispatchMessage(
      { type: 'SCAN_LOG', payload },
      { id: FW_EXTENSION_ID },
    );
    expect(keepChannelOpen).toBe(false); // SCAN_LOG is fire-and-forget
    expect(mocks.logScanEvent).toHaveBeenCalledWith(payload);
  });
});

// ─── Suite (6): inspection pass — OPEN_ORIGINAL / IS_INSPECTION_TAB ─────────
//
// Dashboard-opened tabs run an observe-only inspection pass in the content
// script. The SW owns the registry: OPEN_ORIGINAL registers the created tab
// as 'reveal', RECHECK_RECORD registers its background tab as 'observe', and
// IS_INSPECTION_TAB answers from the registry keyed on sender.tab.id. A tab
// the registry never saw MUST answer {inspection:false} — the fail-closed
// default that keeps a normal child tab fully protected.

describe('service-worker — inspection pass (OPEN_ORIGINAL / IS_INSPECTION_TAB)', () => {
  const STUB_TAB_ID = 4242; // matches the chrome.tabs.create stub

  it('IS_INSPECTION_TAB answers {inspection:false} for a tab the registry never saw', async () => {
    const { keepChannelOpen, responsePromise } = dispatchMessage(
      { type: 'IS_INSPECTION_TAB' },
      { id: FW_EXTENSION_ID, tab: { id: 777001, url: 'https://x.com/unrelated/post' } },
    );
    // The registry is storage.session-backed now: the answer is async and the
    // handler keeps the channel open.
    expect(keepChannelOpen).toBe(true);
    expect(await responsePromise).toEqual({ inspection: false });
  });

  it('IS_INSPECTION_TAB answers {inspection:false} for a sender with no tab (popup/dashboard)', async () => {
    const { keepChannelOpen, responsePromise } = dispatchMessage(
      { type: 'IS_INSPECTION_TAB' },
      { id: FW_EXTENSION_ID },
    );
    expect(keepChannelOpen).toBe(false); // no tab = synchronous fail-closed
    expect(await responsePromise).toEqual({ inspection: false });
  });

  it('OPEN_ORIGINAL opens an ACTIVE tab and registers it mode reveal', async () => {
    const { keepChannelOpen, responsePromise } = dispatchMessage({
      type: 'OPEN_ORIGINAL',
      payload: { url: 'https://x.com/p/original' },
    });
    expect(keepChannelOpen).toBe(true);
    expect(await responsePromise).toEqual({ ok: true });
    expect(captured.tabsCreated).toContainEqual({ url: 'https://x.com/p/original', active: true });

    const query = dispatchMessage(
      { type: 'IS_INSPECTION_TAB' },
      { id: FW_EXTENSION_ID, tab: { id: STUB_TAB_ID } },
    );
    expect(await query.responsePromise).toEqual({ inspection: true, mode: 'reveal' });
  });

  it('TAB-CREATE RACE: a startup query that beats tabs.create still gets the grant (owner repro 2026-08-01)', async () => {
    // Model the live failure: the content script runs at document_start and
    // queries IS_INSPECTION_TAB before chrome.tabs.create has resolved in the
    // SW. tabs.create hangs; the grant must already be durably written and
    // resolvable by the sender's URL.
    tabsCreateImpl = () => new Promise(() => { /* never resolves */ });
    dispatchMessage({
      type: 'OPEN_ORIGINAL',
      payload: { url: 'https://x.com/p/race' },
    });
    await flush(); // let the pre-create grant write land
    expect(captured.tabsCreated).toContainEqual({ url: 'https://x.com/p/race', active: true });

    const query = dispatchMessage(
      { type: 'IS_INSPECTION_TAB' },
      { id: FW_EXTENSION_ID, tab: { id: 606001, url: 'https://x.com/p/race' } },
    );
    expect(await query.responsePromise).toEqual({ inspection: true, mode: 'reveal' });
  });

  it('TAB-CREATE RACE fail-closed: a non-matching URL gets NO grant while create is pending', async () => {
    tabsCreateImpl = () => new Promise(() => { /* never resolves */ });
    dispatchMessage({
      type: 'OPEN_ORIGINAL',
      payload: { url: 'https://x.com/p/race-guard' },
    });
    await flush();
    const query = dispatchMessage(
      { type: 'IS_INSPECTION_TAB' },
      { id: FW_EXTENSION_ID, tab: { id: 606002, url: 'https://x.com/some/other/page' } },
    );
    expect(await query.responsePromise).toEqual({ inspection: false });
  });

  it.each([
    ['javascript:alert(1)'],
    ['chrome-extension://abcdefg/page.html'],
    ['file:///etc/passwd'],
  ])('OPEN_ORIGINAL refuses a non-http(s) URL (%s) and never opens a tab', async (url) => {
    const { responsePromise } = dispatchMessage({
      type: 'OPEN_ORIGINAL',
      payload: { url },
    });
    expect(await responsePromise).toEqual({
      ok: false,
      error: `Refusing to open non-http(s) URL: ${url}`,
    });
    expect(captured.tabsCreated).toEqual([]);
  });

  it('RECHECK_RECORD registers its background tab mode observe', async () => {
    vi.useFakeTimers();
    try {
      const { responsePromise } = dispatchMessage({
        type: 'RECHECK_RECORD',
        payload: { url: 'https://x.com/p/observe-registration' },
      });
      await vi.advanceTimersByTimeAsync(0);

      const query = dispatchMessage(
        { type: 'IS_INSPECTION_TAB' },
        { id: FW_EXTENSION_ID, tab: { id: STUB_TAB_ID } },
      );
      expect(await query.responsePromise).toEqual({ inspection: true, mode: 'observe' });

      await vi.advanceTimersByTimeAsync(9000);
      await responsePromise;
    } finally {
      vi.useRealTimers();
    }
  });

  it('chrome.tabs.onRemoved drops the registry entry (recycled tabId cannot inherit a grant)', async () => {
    const { responsePromise } = dispatchMessage({
      type: 'OPEN_ORIGINAL',
      payload: { url: 'https://x.com/p/removed' },
    });
    await responsePromise;

    expect(captured.onTabRemovedListeners.length).toBeGreaterThan(0);
    for (const fn of captured.onTabRemovedListeners) fn(STUB_TAB_ID);

    const query = dispatchMessage(
      { type: 'IS_INSPECTION_TAB' },
      { id: FW_EXTENSION_ID, tab: { id: STUB_TAB_ID } },
    );
    expect(await query.responsePromise).toEqual({ inspection: false });
  });
});
