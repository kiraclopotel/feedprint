// @vitest-environment jsdom
//
// Alarm-arming regression tests (2026-09-18 adversarial read of
// src/background/service-worker.ts, the PERIODIC_ALARMS / armMissingAlarms /
// armAllAlarms region).
//
// DEFECT 1, confirmed by reading. armMissingAlarms's guard asked
// chrome.alarms.get(name) only "does this alarm exist" and created it only
// when the answer was no. chrome.alarms.create on an EXISTING name replaces
// it and resets its timer, which is exactly why the guard was written that
// way (a frequent dev-mode reload must not reset a running alarm's timer).
// But chrome.alarms.get can only ever report existence, never what an alarm
// was last configured with — so an existence-only guard can create an alarm
// that is ABSENT but can never correct one that is PRESENT with a stale
// cadence. PERIODIC_ALARMS was therefore frozen, per install, at whatever
// options that install's very first arm call used: forensic-anchor's
// delayInMinutes, added to the table on 2026-09-06, never reached an install
// made before that date, and no future table edit ever will reach an
// existing install either, without recording what each alarm was actually
// armed with and comparing against that record instead of against the
// alarm's mere presence.
//
// DEFECT 2, confirmed by reading, in the same function. The re-arm call was
// written as `void chrome.alarms.create(name, opts)` inside the
// chrome.alarms.get(...).then(...) callback, without returning it. Since the
// callback's own return value is what the outer .then()'s promise settles
// on, an un-returned `void`-prefixed call's rejection never reaches that
// promise, so the .catch(...) chained after .then(...) never sees it either:
// a failed re-arm surfaced as an unhandled promise rejection instead of the
// console.warn(...) the function clearly intends.
//
// This suite exercises the exported armMissingAlarms / armAllAlarms /
// PERIODIC_ALARMS against a stateful chrome.alarms + chrome.storage.local
// stub that mirrors real Chrome on the two facts this defect turns on:
// chrome.alarms.create on an existing name REPLACES its live options, and
// chrome.alarms.get's resolved Alarm never echoes delayInMinutes back (real
// chrome.alarms.Alarm has only name / periodInMinutes / scheduledTime).
//
// Importing service-worker.ts runs its entire module top level (~30 other
// imports, several reaching storage or network). The vi.mock blocks below
// are the same set tests/unit/forensics/service-worker.test.ts already uses
// to import this exact file safely; two modules that suite leaves real
// (src/background/heartbeat.ts, src/background/chain-height.ts) are left
// real here too; both wrap their bodies in try/catch and return a
// {status:'failed'} shape on any error rather than throw or reject, so an
// unmocked dependency of theirs failing under this stub is a caught no-op,
// not a test-suite crash.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

vi.mock('../../../src/storage/settings', () => ({
  incrementNeutralized: vi.fn(async () => undefined),
  applyUsageIncrement: vi.fn(async () => undefined),
  getSettings: vi.fn(async () => ({ totalNeutralizedToday: 0, parentPin: null })),
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
//
// alarms and storage.local are the two pieces of "live Chrome state" this
// defect is about, so both are stateful, in-memory backing objects rather
// than the usual black-hole stub — everything else just needs to not throw
// at import time.

type AlarmOpts = chrome.alarms.AlarmCreateInfo;

let liveAlarms: Record<string, AlarmOpts>;
let localStore: Record<string, unknown>;
let alarmsCreated: Array<{ name: string; opts: AlarmOpts }>;
let alarmsGot: string[];
const createShouldFailFor = new Set<string>();
let createFailureError: Error = new Error('simulated chrome.alarms.create failure');

function installChromeStub(): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      id: 'fw-test-extension-id',
      onInstalled: { addListener: (_fn: unknown) => {} },
      onStartup: { addListener: (_fn: unknown) => {} },
      onMessage: { addListener: (_fn: unknown) => {} },
    },
    alarms: {
      onAlarm: { addListener: (_fn: unknown) => {} },
      get: (name: string) => {
        alarmsGot.push(name);
        const opts = liveAlarms[name];
        return Promise.resolve(
          opts ? { name, periodInMinutes: opts.periodInMinutes, scheduledTime: 0 } : undefined,
        );
      },
      create: (name: string, opts: AlarmOpts) => {
        alarmsCreated.push({ name, opts });
        if (createShouldFailFor.has(name)) return Promise.reject(createFailureError);
        // The one line that stands in for the whole first defect: a real
        // chrome.alarms.create on an existing name REPLACES it. If the guard
        // above this stub only checks existence, this line is the one it
        // never reaches for an alarm that is already there.
        liveAlarms[name] = opts;
        return Promise.resolve();
      },
    },
    storage: {
      local: {
        get: (key: string) =>
          Promise.resolve(key in localStore ? { [key]: localStore[key] } : {}),
        set: (obj: Record<string, unknown>) => {
          Object.assign(localStore, obj);
          return Promise.resolve();
        },
        remove: () => Promise.resolve(),
      },
      session: {
        get: async () => ({}),
        set: async () => undefined,
        remove: async () => undefined,
      },
      onChanged: { addListener: (_fn: unknown) => {} },
    },
    action: {
      setBadgeText: () => Promise.resolve(),
      setBadgeBackgroundColor: () => Promise.resolve(),
    },
    tabs: {
      create: () => Promise.resolve({ id: 1 }),
      remove: () => Promise.resolve(),
      onRemoved: { addListener: (_fn: unknown) => {} },
      onUpdated: { addListener: (_fn: unknown) => {} },
    },
  };
}

/**
 * Forget what the arming recorded for these alarms, so they read as armed by a
 * build that predates the record. Needed because importing the service worker
 * arms every alarm at module scope and records all seven, which would otherwise
 * make "an install from before the record existed" impossible to describe here.
 */
function forgetRecordedOptions(names: string[]): void {
  const record = (localStore['fw_armed_alarm_options'] ?? {}) as Record<string, unknown>;
  for (const n of names) delete record[n];
  localStore['fw_armed_alarm_options'] = record;
}

/** Wait one macrotask so fire-and-forget promise chains settle. */
function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

let armMissingAlarms: () => void;
let armAllAlarms: () => void;
let PERIODIC_ALARMS: ReadonlyArray<{ name: string; opts: AlarmOpts }>;

beforeAll(async () => {
  installChromeStub();
  liveAlarms = {};
  localStore = {};
  alarmsCreated = [];
  alarmsGot = [];
  const sw = await import('../../../src/background/service-worker');
  armMissingAlarms = sw.armMissingAlarms;
  armAllAlarms = sw.armAllAlarms;
  PERIODIC_ALARMS = sw.PERIODIC_ALARMS;
});

beforeEach(async () => {
  liveAlarms = {};
  localStore = {};
  alarmsCreated = [];
  alarmsGot = [];
  createShouldFailFor.clear();
  // Reach the ordinary steady state the same way a real fresh install does:
  // every alarm live, every alarm's options recorded. Each test then
  // perturbs one thing away from that baseline.
  armAllAlarms();
  await flush();
  alarmsCreated = [];
  alarmsGot = [];
});

function optsFor(name: string): AlarmOpts {
  const entry = PERIODIC_ALARMS.find((a) => a.name === name);
  if (!entry) throw new Error(`no PERIODIC_ALARMS entry named ${name}`);
  return entry.opts;
}

describe('armMissingAlarms / armAllAlarms — 2026-09-18 adversarial read', () => {
  it('a stale-cadence install self-corrects on the next wake', async () => {
    // Simulates an install made before 2026-09-06: forensic-anchor exists,
    // live, with the pre-fix options (six-hour period, no first-tick delay).
    // No recorded-options entry survives from that install either, because
    // the recording mechanism itself postdates it — this IS the "no record"
    // case, reached honestly rather than by peeking at storage keys.
    liveAlarms['forensic-anchor'] = { periodInMinutes: 60 * 6 };
    forgetRecordedOptions(['forensic-anchor']);

    armMissingAlarms();
    await flush();

    // THE FAILING LINE (pre-fix): with only the old existence check,
    // chrome.alarms.get('forensic-anchor') resolves truthy, `!existing` is
    // false, chrome.alarms.create is never called, and liveAlarms stays at
    // { periodInMinutes: 21600 } forever. This assertion fails with:
    //   expected { periodInMinutes: 21600 } to equal
    //   { periodInMinutes: 21600, delayInMinutes: 15 }
    expect(liveAlarms['forensic-anchor']).toEqual(optsFor('forensic-anchor'));
    expect(alarmsCreated.filter((c) => c.name === 'forensic-anchor')).toHaveLength(1);
  });

  it('does not re-touch a just-corrected alarm on the following wake (no frequent-reload thrash)', async () => {
    liveAlarms['forensic-anchor'] = { periodInMinutes: 60 * 6 };
    forgetRecordedOptions(['forensic-anchor']);
    armMissingAlarms();
    await flush();
    expect(liveAlarms['forensic-anchor']).toEqual(optsFor('forensic-anchor'));

    // A second wake — a dev-mode reload thirty seconds later, say — must
    // leave it alone now that its recorded options match. This is the
    // frequent-reload failure the original get-guard was written to avoid;
    // the options-match half must not reintroduce it once a correction has
    // actually landed.
    alarmsCreated = [];
    armMissingAlarms();
    await flush();
    expect(alarmsCreated).toEqual([]);
  });

  it('creates an alarm that is missing outright, leaving the others untouched', async () => {
    delete liveAlarms['forensic-backup'];
    forgetRecordedOptions(['forensic-backup']);
    armMissingAlarms();
    await flush();
    expect(liveAlarms['forensic-backup']).toEqual(optsFor('forensic-backup'));
    expect(alarmsCreated.map((c) => c.name)).toEqual(['forensic-backup']);
  });

  it('touches nothing when every alarm is already live and current', async () => {
    armMissingAlarms();
    await flush();
    expect(alarmsCreated).toEqual([]);
  });

  it('corrects two stale alarms in the same wake without one clobbering the other\'s recorded options', async () => {
    // Guards the serialized read-modify-write on the options record: two
    // corrections settling in the same tick must not race each other into
    // losing one of the two updates (which would make that one look
    // mismatched, and get recreated, forever after).
    liveAlarms['forensic-anchor'] = { periodInMinutes: 60 * 6 };
    liveAlarms['forensic-backup'] = { periodInMinutes: 60 };
    forgetRecordedOptions(['forensic-anchor', 'forensic-backup']);

    armMissingAlarms();
    await flush();
    expect(liveAlarms['forensic-anchor']).toEqual(optsFor('forensic-anchor'));
    expect(liveAlarms['forensic-backup']).toEqual(optsFor('forensic-backup'));

    alarmsCreated = [];
    armMissingAlarms();
    await flush();
    expect(alarmsCreated).toEqual([]);
  });

  it('routes a failed re-arm to console.warn instead of leaving it an unhandled rejection', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    delete liveAlarms['forensic-backup'];
    createShouldFailFor.add('forensic-backup');

    armMissingAlarms();
    await flush();

    // THE FAILING LINE (pre-fix): the old code's `if (!existing) void
    // chrome.alarms.create(name, opts);` never returns the create() call, so
    // its rejection never reaches the .catch below it — this spy would see
    // zero calls instead of one, and Node/vitest would report the rejection
    // as unhandled instead.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('forensic-backup'),
      createFailureError,
    );
    warnSpy.mockRestore();
  });

  it('a fresh install (armAllAlarms) records what it armed, so the very next wake is a no-op', async () => {
    // Already exercised once per test via beforeEach, but asserted directly
    // here: PERIODIC_ALARMS itself, not a hand-picked subset, is what a
    // fresh install must end up matching, or a wake immediately after
    // install would look like an upgrade and reset every timer for nothing.
    for (const { name, opts } of PERIODIC_ALARMS) {
      expect(liveAlarms[name]).toEqual(opts);
    }
    armMissingAlarms();
    await flush();
    expect(alarmsCreated).toEqual([]);
  });
});
