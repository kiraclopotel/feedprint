// FeelingWise - Service worker entry point
// Extension lifecycle and message handling.
// All AI calls go through src/ai/client.ts (API-based).
// Forensic records are stored here (extension origin) so the dashboard can read them.

import { applyUsageIncrement, incrementNeutralized, getSettings, noteLevelChosenOnInstall, parentPinUnknown, verifyPin } from '../storage/settings';
import { getAuthorProfile, updateAuthorProfile } from '../forensics/author-store';
import { logScanEvent, purgeScanEvents } from '../forensics/scan-log';
import { pruneRecordsToCap, getRecords, getRecordsOrThrow, resetForensicChain, lastRecordReadFailed } from '../forensics/store';
import { AUTHOR_WEEK_MS, countAuthorWeek } from '../forensics/author-week';
import { rotateChainAtMonthFlip } from '../forensics/chain-rotation';
import { dailyJobOverdue, noteRotation, notePrune, noteStamp, readMaintenanceHealth } from '../forensics/maintenance-health';
import { buildChainDebugStatsResponse } from '../forensics/chain-debug-stats';
import { anchorChainHead, anchorDueOnHeartbeat, getLatestAnchor } from '../forensics/chain-anchor-store';
import { ensureKeyGenesisAnchor } from '../forensics/key-genesis';
import { autoBackupToDownloads, restoreFromBackup, restoreDownloadUiOnStartup, adoptBackupSealSecret } from '../forensics/backup';
import {
  enqueueForensicDelivery,
  getForensicDeliveryReceiptState,
  pruneForensicDeliveryReceipts,
  type ForensicDeliveryType,
} from '../forensics/delivery-outbox';
import { kickForensicDeliveryPump } from '../forensics/forensic-delivery-pump';
import { getPublicKeyFingerprint, getPublicKeyJWK, getSigningKeyCreatedAt, onSigningKeyBorn } from '../forensics/signing';
import { stateKeyReplacement } from '../forensics/key-continuity';
// capture-routing fix. Content scripts run at the host
// page's origin (tiktok.com etc.), not the extension origin, so direct
// IndexedDB writes from neutralizer.ts / queue.ts landed in the wrong origin's
// IDB. Captures must route through the service worker, which DOES write at
// the extension origin where popup / dashboard / dev-console can read them.
import { capturePromptIO } from '../forensics/capture-prompt-io';
import { captureBehaviorEvent } from '../forensics/capture-behavior';
// Same capture-routing fix, for the v2 perf-trace metrics store
// (feelingwise-pipeline-v2-metrics). See core/perf-trace.ts:dispatchPersist.
import { persistRecord as persistPerfRecord, type V2Stage } from '../diagnostics/perf-trace';
import { flagPostManually, InvalidManualFlagUrlError } from '../forensics/manual-flag';
import { createChainWriteLock, sharedChainWriteLock } from '../forensics/chain-write-lock';
import { getBakedBuildId, initDevReload, handleDevReloadAlarm } from './dev-reload';
import { runHeartbeat } from './heartbeat';
import { checkChainHeight, checkChainHeightOnRealmStart } from './chain-height';
import { appendGapMarker } from '../forensics/gap-marker';
import { appendImportMarker, isImportMarkerInput } from '../forensics/import-marker';
import { appendRepairMarker, isRepairMarkerInput } from '../forensics/repair-marker';
import { appendReconcileMarker, isReconcileMarkerInput } from '../forensics/reconcile-marker';
import { appendRedactionMarker, isRedactionMarkerInput } from '../forensics/redaction';
import { EXCLUSIONS_KEY, excludableAuthor, isExcludedAuthor, noteExcludedSkip, readExclusions, type AuthorExclusion } from '../forensics/author-exclusions';
import { HEARTBEAT_INTERVAL_MINUTES } from '../forensics/heartbeat';
import { makesNoOutsideCall } from '../types/mode';
import { noteBuildRun } from '../storage/build-history';
import { refreshEntitlementsOnInstall } from './entitlements-on-install';
import { rememberRecheckTab, forgetRecheckTab, sweepOrphanRecheckTabs } from './recheck-tab-ledger';
import { createInspectionRegistry } from './inspection-registry';
import {
  FW_MESSAGE_TYPES,
  type FWMessage,
  type ForensicLogPayload,
  type GetAuthorProfileResponse,
  type GetAuthorWeekResponse,
  type ResetForensicChainResponse,
  type RestoreForensicBackupResponse,
  type RunRecordTidyResponse,
  type UsageIncrementResponse,
} from '../types/messages';
import { openSetupOnInstall } from './open-setup-on-install';
import { provideBuildId } from '../core/build-id';

declare const __FW_BUILD_ID__: string;

// The worker states the build baked into its own file, never one read from a chunk it shares with
// the dashboard (src/core/build-id.ts). Before any message is handled, so every record it signs agrees.
provideBuildId(typeof __FW_BUILD_ID__ === 'string' ? __FW_BUILD_ID__ : '');

// Counter-write serialization. Pre-2026-05-24 two SW handlers had
// read-modify-write races across parallel messages from multiple tabs:
//   • NEUTRALIZATION_COMPLETE → incrementNeutralized (storage/settings):
//     getSettings + set(+1). Two parallel posts both read same prior
//     value → both write +1 → lost update → badge undercounts.
//   • AUTHOR_UPDATE → updateAuthorProfile (forensics/author-store):
//     readonly get + readwrite put in TWO IDB transactions. Two parallel
//     hits on the same author both read totalSeen=N → both put N+1 →
//     lost update. V1.5 recidivism blocklist (GAPS.md:53) depends on
//     this counter being correct. Audit A6 HIGH closure (V1.5 ROADMAP
//     rank 11).
//
// Two locks: ONE shared global for the counter (single value, full
// serialization), and a per-author Map<authorKey, Promise> for
// AUTHOR_UPDATE so updates on different authors don't block each other.
const counterWriteLock = createChainWriteLock();
const FORENSIC_DELIVERY_TYPES = new Set<ForensicDeliveryType>([
  'FORENSIC_LOG',
  'PASS_LOG',
  'ENVIRONMENT_LOG',
  'CANCEL_LOG',
  'BLOCKED_LOG',
  'SKIPPED_LOG',
  'GAP_LOG',
]);
const recheckDeliverySignals = new Map<number, () => void>();
// Accounts the recorder skips (register item 20 part 2): read once, refreshed
// on storage change, consulted on every retained-record delivery.
let exclusionsCache: AuthorExclusion[] | null = null;
async function exclusions(): Promise<AuthorExclusion[]> {
  if (exclusionsCache === null) exclusionsCache = await readExclusions();
  return exclusionsCache;
}
const authorWriteLocks = new Map<string, Promise<void>>();
async function withAuthorLock<T>(authorKey: string, work: () => Promise<T>): Promise<T> {
  const prior = authorWriteLocks.get(authorKey) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => { release = r; });
  authorWriteLocks.set(authorKey, next);
  try {
    await prior;
    return await work();
  } finally {
    release();
    // Best-effort cleanup: drop the entry if nobody else has chained
    // onto it. Race-safe because Map.get/set is atomic in the JS
    // single-threaded model.
    if (authorWriteLocks.get(authorKey) === next) {
      authorWriteLocks.delete(authorKey);
    }
  }
}

const ANCHOR_ALARM = 'forensic-anchor';

/**
 * Whether the time-stamp alarm may exist and fire: never in Strict, which makes no outside call. A
 * snapshot that cannot be read reads as Strict (settings.ts), so a failed read holds the alarm back
 * until the next wake rather than sending a hash out on a guess.
 */
async function anchoringAllowed(): Promise<boolean> {
  try {
    return !makesNoOutsideCall(await getSettings());
  } catch {
    return false;
  }
}

// Periodic-alarm registry: name + cadence. Created on first install; on every
// other lifecycle event (update, chrome_update, shared_module_update, an
// extension re-enable, or this worker simply waking up) each is (re)created
// only when it is either absent or armed with options different from what
// this table now asks for. Unconditional re-creation on every wake reset each
// alarm's periodInMinutes timer, so frequent dev-mode reloads could skip a
// scheduled window (the 6-hour forensic-anchor most visibly). chrome.alarms.
// create on an existing name silently replaces it — the guard below is what
// preserves the timer for an alarm that is already correct.
//
// An existence-only guard (what this used to be) can create an alarm that is
// ABSENT but can never correct one that is PRESENT with a stale cadence,
// because chrome.alarms.get only ever answers "does it exist", never "what
// was it configured with". That is why forensic-anchor's delayInMinutes,
// added below on 2026-09-06, never reached an install made before that date
// — found by the 2026-09-18 adversarial read of this file. See the comment
// above armMissingAlarms for the options-match half that closes this.
export const PERIODIC_ALARMS: ReadonlyArray<{ name: string; opts: chrome.alarms.AlarmCreateInfo }> = [
  { name: 'scan-purge', opts: { periodInMinutes: 60 * 24 } }, // once per day
  // daily prune of the forensic store. expanded write volume ~10x (every
  // L1-judged post now writes a record); cap at 10000 oldest-first protects
  // dashboard load latency. Same daily cadence as scan-log purge.
  { name: 'forensic-prune', opts: { periodInMinutes: 60 * 24 } },
  // Daily UTC month-rotation check. rotateChainAtMonthFlip is idempotent in
  // 'auto' mode (only acts when the active chain's terminal record is from
  // a different UTC month). Daily cadence covers month boundaries even when
  // the SW was evicted on the exact rollover moment.
  { name: 'forensic-month-rotation', opts: { periodInMinutes: 60 * 24 } },
  // RFC 3161 chain-head anchoring. Every 6 hours, ask the time-stamp
  // authorities directly to sign the latest chain integrityHash; the FW proxy
  // is only a fallback for an install with a key, when the direct requests
  // gave too few anchors, and the Strict level asks no one
  // (src/forensics/tsa-client.ts requestVerifiedTimestamps). anchorChainHead is
  // failure-tolerant + idempotent: it skips when the chain hasn't grown
  // far enough since the last anchor, when no chained records exist, or
  // when the TSA call fails. See src/forensics/chain-anchor-store.ts.
  // The first tick is 15 minutes after install, not 6 hours. A fresh install
  // wrote no anchor and no key stamp for four hours (owner's diagnostics,
  // 2026-09-06) and nothing in the code said why: the alarm's first fire IS
  // its period. A recorder whose first hours are unstamped cannot support the
  // sentence the letters and the site use, "anchored with independent RFC 3161
  // timestamp services every few hours", on the day someone installs it.
  { name: 'forensic-anchor', opts: { periodInMinutes: 60 * 6, delayInMinutes: 15 } },
  // Daily automatic backup of the whole chain to a rolling file in the user's
  // Downloads, so a surprise uninstall still leaves a recent parent-owned copy
  // (the record + signing key are wiped on uninstall). autoBackupToDownloads is
  // failure-tolerant + skips an empty chain. See src/forensics/backup.ts.
  { name: 'forensic-backup', opts: { periodInMinutes: 60 * 24 } },
  // Durable outbox recovery after MV3 worker eviction or a persistence outage.
  { name: 'forensic-outbox-drain', opts: { periodInMinutes: 1 } },
  // The chained heartbeat (evidence-gap register item 9): a signed record of
  // the recorder being alive, and a gap marker when a tick finds the last one
  // stale. See src/forensics/heartbeat.ts for what it writes and when.
  { name: 'forensic-heartbeat', opts: { periodInMinutes: HEARTBEAT_INTERVAL_MINUTES } },
];

// Where each alarm's live options are recorded, so armMissingAlarms can tell
// an out-of-date alarm from a current one without ever touching chrome.alarms
// for one that is already correct. chrome.storage.local, not .session:
// chrome.alarms themselves survive a browser restart, so a record that didn't
// would make every browser restart look like a cadence change and reset every
// timer once for nothing — the record has to outlive what it is describing.
const ARMED_ALARM_OPTIONS_KEY = 'fw_armed_alarm_options';

type ArmedAlarmOptions = Partial<Record<string, chrome.alarms.AlarmCreateInfo>>;

// Same read-modify-write discipline as recheck-tab-ledger.ts's ledgerChain:
// armMissingAlarms checks every entry in PERIODIC_ALARMS concurrently, so
// without serializing the writes, two corrections landing in the same tick
// could each read this record before the other's write lands and clobber it —
// permanently losing one alarm's recorded options, which would then read as
// mismatched, and get recreated, on every single future wake. That is the
// exact frequent-reset failure this whole mechanism exists to prevent.
let armedOptionsChain: Promise<unknown> = Promise.resolve();

function serializedOptionsWrite(op: () => Promise<void>): Promise<void> {
  const run = armedOptionsChain.then(op, op);
  armedOptionsChain = run.then(() => undefined, () => undefined);
  return run;
}

async function readArmedAlarmOptions(): Promise<ArmedAlarmOptions> {
  const out = await chrome.storage.local.get(ARMED_ALARM_OPTIONS_KEY);
  const raw = out[ARMED_ALARM_OPTIONS_KEY];
  return raw && typeof raw === 'object' ? (raw as ArmedAlarmOptions) : {};
}

function recordArmedAlarmOptions(name: string, opts: chrome.alarms.AlarmCreateInfo): Promise<void> {
  return serializedOptionsWrite(async () => {
    const record = await readArmedAlarmOptions();
    record[name] = opts;
    await chrome.storage.local.set({ [ARMED_ALARM_OPTIONS_KEY]: record });
  });
}

// chrome.alarms.Alarm (what .get() resolves to) never echoes delayInMinutes
// back — it only reports periodInMinutes and scheduledTime — so there is no
// live-alarm property to compare a table edit against. The recorded options
// above are compared instead: what this code last WROTE, not what Chrome
// reports back. undefined and absent mean the same thing for every
// AlarmCreateInfo field, so this compares the three fields chrome.alarms.
// create actually reads, rather than object identity or a JSON.stringify
// shape that would call two options objects different only because one
// omitted a key the other set to undefined.
function alarmOptionsMatch(
  recorded: chrome.alarms.AlarmCreateInfo | undefined,
  wanted: chrome.alarms.AlarmCreateInfo,
): boolean {
  if (!recorded) return false;
  return recorded.periodInMinutes === wanted.periodInMinutes
    && recorded.delayInMinutes === wanted.delayInMinutes
    && recorded.when === wanted.when;
}

/**
 * Make sure every periodic alarm exists AND is armed with the options
 * PERIODIC_ALARMS currently asks for, without disturbing one that is already
 * both present and current.
 *
 * Why this is a function and not a loop inside onInstalled (2026-09-18): it was
 * only inside onInstalled, and `chrome.runtime.onInstalled` does NOT fire when
 * an extension is disabled and enabled again, nor if the profile loses its
 * alarms any other way. Nothing else re-armed them and nothing checked they
 * were still there. On an install where that happened, every one of these
 * stopped for good and the product said nothing.
 *
 * One clause of that reasoning was wrong and is corrected here rather than
 * quietly dropped (checked against Chrome's runtime documentation, 2026-09-18):
 * `chrome.runtime.reload()` IS treated as an update and DOES fire onInstalled
 * with reason "update". The disable-then-enable case is real and is on its own
 * enough to have caused this, so the fix stands; the reload case never needed
 * it. The list of what stopped:
 *
 *   forensic-backup   the daily copy to Downloads, which is the only thing
 *                     standing between the person and losing the whole record
 *                     when the extension goes away. This one matters most.
 *   forensic-anchor   the independent time stamps, so the record stops being
 *                     anchored while the site and the store text say it is
 *                     anchored every few hours.
 *   forensic-prune    the cap on the active chain, so it grows without limit.
 *   forensic-heartbeat  the signed proof the recorder was alive, so a quiet
 *                     stretch becomes unanswerable.
 *   forensic-outbox-drain, forensic-month-rotation, scan-purge.
 *
 * It is called from three places now: onInstalled, onStartup, and once when this
 * worker wakes. The last one is what closes the hole, because an MV3 worker wakes
 * on every alarm, message and browser start, so any life at all re-arms the set.
 *
 * A second gap sat under the first fix and went unnoticed until the
 * 2026-09-18 adversarial read: chrome.alarms.get can only answer "does this
 * alarm exist", never "what was it configured with". A guard that only asked
 * that question — which is all this function checked before — could only
 * ever create an alarm that was ABSENT. It could never correct one that
 * existed with a stale cadence, so PERIODIC_ALARMS was effectively frozen at
 * whatever options each install first received: forensic-anchor's
 * delayInMinutes, added above on 2026-09-06, never reached an install made
 * before that date, and no future cadence change ever will either, on any
 * install already running. The recorded-options mechanism above is the other
 * half this needed: it lets this function tell "absent" and "present but
 * stale" apart from "present and current", and recreate only the first two.
 * Removing either half breaks something real — drop the existence check and a
 * profile that lost its alarms stays silent; drop the options check and a
 * table edit never reaches an existing install again.
 */
export function armMissingAlarms(): void {
  void Promise.all([readArmedAlarmOptions(), anchoringAllowed()]).then(([recorded, anchoring]) => {
    for (const { name, opts } of PERIODIC_ALARMS) {
      if (name === ANCHOR_ALARM && !anchoring) {
        // Cleared, not left to fire and skip: in Strict the alarm does not exist. Its recorded
        // options stay, so leaving Strict finds it absent and arms it again.
        void Promise.resolve().then(() => chrome.alarms.clear(name)).catch(err => {
          console.warn(`[FeelingWise] could not clear the ${name} alarm:`, err);
        });
        continue;
      }
      void chrome.alarms.get(name).then(existing => {
        if (!existing || !alarmOptionsMatch(recorded[name], opts)) {
          // Returned (not `void`-discarded): a rejection here must reach the
          // .catch below. The earlier version wrote `void chrome.alarms.
          // create(...)` on this line without returning it, so a failed
          // re-arm of, say, forensic-backup surfaced as an unhandled promise
          // rejection instead of the console.warn this function exists to
          // give (found by the 2026-09-18 adversarial read).
          return chrome.alarms.create(name, opts).then(() => recordArmedAlarmOptions(name, opts));
        }
        return undefined;
      }).catch(err => {
        console.warn(`[FeelingWise] could not arm the ${name} alarm:`, err);
      });
    }
  }).catch(err => {
    console.warn('[FeelingWise] could not read the recorded alarm options:', err);
  });
}

/** Fresh install only: no alarm can exist yet, so there is nothing to preserve. */
export function armAllAlarms(): void {
  for (const { name, opts } of PERIODIC_ALARMS) {
    void chrome.alarms.create(name, opts).then(() => recordArmedAlarmOptions(name, opts)).catch(err => {
      console.warn(`[FeelingWise] could not arm the ${name} alarm:`, err);
    });
  }
}

// Every wake re-arms what is missing. See the note above armMissingAlarms for
// what was silently stopping before this line existed.
armMissingAlarms();

/**
 * Where an update gap waits until it is on the chain.
 *
 * The value is the ISO time of the update, so a marker written by a later realm
 * still says when the records were lost rather than when it got round to
 * saying so.
 */
const PENDING_UPDATE_GAP_KEY = 'fw_pending_update_gap';

/**
 * Write the noted update gap, if there is one, and clear the note only when the
 * chain has it.
 *
 * Runs on every fresh realm as well as from the update listener itself. A
 * second realm finding the note still there means the first one died before the
 * write landed, which on an auto-update is exactly the likely case: that is the
 * event the marker is about.
 *
 * Failure-tolerant in both directions. A read that throws says nothing and
 * leaves the note; a write that throws leaves the note for the next realm. The
 * note is cleared only after `appendGapMarker` has returned, so the worst case
 * is a marker written twice, which the chain shows as two statements of the
 * same event, and the best case of the old shape was silence.
 */
async function writePendingUpdateGap(): Promise<void> {
  let at: unknown;
  try {
    at = (await chrome.storage.local.get(PENDING_UPDATE_GAP_KEY))?.[PENDING_UPDATE_GAP_KEY];
  } catch {
    return;
  }
  if (typeof at !== 'string' || !at) return;
  try {
    await appendGapMarker({
      reason: 'context-invalidated', platform: 'unknown',
      count: 0, unit: 'records', fromISO: at, toISO: at,
    });
    await chrome.storage.local.remove(PENDING_UPDATE_GAP_KEY);
  } catch (err) {
    console.warn('[FeelingWise] update gap marker not written yet, kept for the next start:', err);
  }
}

chrome.runtime.onStartup.addListener(() => {
  armMissingAlarms();
});

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[FeelingWise] Extension installed');
  void chrome.action.setBadgeText({ text: '' });
  // An UPDATE orphans the content script in every tab that was already open:
  // chrome.runtime is nuked synchronously in those scripts, so anything they
  // had observed and not yet delivered never arrives, and nothing else on this
  // path writes a thing. It was the only loss route in the product with no gap
  // reason at all — a routine auto-update took records off the chain silently,
  // and the chain's whole claim is that a loss is stated rather than vanishing.
  //
  // Count 0, like recorder-down: the worker cannot know what those tabs held.
  // The marker states the EVENT, and its reader line says the amount is not
  // knowable rather than printing a zero that reads as nothing lost.
  //
  // Noted before it is written (2026-09-19). This was a bare fire-and-forget
  // from a synchronous listener, and nothing holds an MV3 worker open for it:
  // the marker whose whole purpose is to say that an auto-update orphaned the
  // content scripts could be lost to that same auto-update, with no retry and
  // no trace. The one loss route with no gap reason had a gap reason that could
  // itself go missing.
  //
  // The note goes down first and is cleared only when the marker is on the
  // chain, so a worker that dies mid-write leaves the intent behind and the
  // next realm writes it. `at` is kept in the note rather than recomputed, so a
  // marker written an hour later still says when the update happened.
  void noteLevelChosenOnInstall(details.reason).catch((err) => {
    console.warn('[FeelingWise] could not mark the level as chosen:', err);
  });
  if (details.reason === 'update') {
    const at = new Date().toISOString();
    void chrome.storage.local.set({ [PENDING_UPDATE_GAP_KEY]: at })
      .then(() => writePendingUpdateGap())
      .catch((err) => {
        console.warn('[FeelingWise] could not note the update gap:', err);
      });
  }
  // On fresh install create every periodic alarm unconditionally. On update
  // (or any other reason) create only the alarms that are missing, so an
  // already-running alarm keeps its timer instead of being reset.
  if (details.reason === 'install') armAllAlarms(); else armMissingAlarms();
  // R1 (29 Sep 2026): a new extension sits under the puzzle-piece menu; open the setup so the first minute is not a search.
  openSetupOnInstall(details.reason);
  refreshEntitlementsOnInstall(details.reason);
});

function stampKeyGenesis(): void {
  ensureKeyGenesisAnchor().then(result => {
    if (result.status === 'stamped') {
      console.log(
        `[FeelingWise] Signing key stamped by ${result.providers.join(', ')}`,
      );
    } else if (result.status === 'skipped') {
      console.log(`[FeelingWise] Signing key stamp skipped: ${result.reason}`);
    }
  }).catch(err => {
    console.warn('[FeelingWise] Signing key stamp failed:', err);
  });
}

// A new key is dated the moment it exists, not at the next six-hourly alarm: the stamp is the
// evidence of when the key was born, and every hour it waits is an hour it cannot vouch for. The
// key is made inside a record write, which does not wait for this.
onSigningKeyBorn(stampKeyGenesis);

/**
 * The six-hourly time stamps: the signing key's own, then the chain head's. Both go through
 * requestVerifiedTimestamps, which asks the level again, so nothing reaches a time-stamp service in
 * Strict by any other route either.
 */
function stampKeyAndChainHead(): void {
  // Stamp the signing key itself, once, before anchoring the chain head. The
  // birth call below usually did it already; this is the retry for a key born
  // offline. See src/forensics/key-genesis.ts for what the stamp is worth.
  stampKeyGenesis();
  anchorChainHead().then(result => {
    if (result.status === 'anchored') {
      console.log(
        `[FeelingWise] Chain anchored at position ${result.anchoredChainPosition} ` +
        `by ${result.tsaProvider} (TSA time: ${result.generalizedTime ?? 'unparsed'})`,
      );
    } else {
      // Every authority's answer, not only the first (F68): the one line a person can find later.
      const all = result.reasons && result.reasons.length > 1 ? ` (${result.reasons.join(', ')})` : '';
      console.log(`[FeelingWise] Chain anchor skipped: ${result.reason}${all}`);
    }
    // The maintenance record the dashboard reads (F68): a day of refusals becomes an attention item.
    void noteStamp(result);
  }).catch(err => {
    console.warn('[FeelingWise] Chain anchor failed:', err);
    void noteStamp({ status: 'failed', reason: `threw: ${err instanceof Error ? err.message : String(err)}` });
  });
}

// One run at a time per worker: the alarm, a catch-up and the dashboard's button can all ask within the same minute,
// and a second prune queued behind the first on the chain lock would only find nothing to do.
let recordTidyRun: Promise<void> | null = null;

/** The nightly prune: cap the active chain at 10000 records, oldest first, archived before anything is deleted. */
function runRecordTidy(): Promise<void> {
  if (recordTidyRun) return recordTidyRun;
  // The prune notes its own outcomes (store.ts); a throw that gets out of it is noted here as a refusal, so the
  // dashboard's maintenance line raises it like any other (S7, site 4).
  recordTidyRun = pruneRecordsToCap()
    .then(() => undefined, err => notePrune({ ok: false, reason: err instanceof Error ? (err.message || err.name) : String(err) }))
    .finally(() => { recordTidyRun = null; });
  pruneForensicDeliveryReceipts().catch(() => {});
  return recordTidyRun;
}

function runMonthRotation(): void {
  rotateChainAtMonthFlip().then(result => {
    // Kept where the dashboard reads it, so a refusal that repeats or needs a
    // person is not console-only (wiring audit 13 Sep, C28 and C29).
    void noteRotation(result);
    if (result.rotated) {
      console.log(
        `[FeelingWise] Forensic chain rotated: archived ${result.archivedCount} records into month ${result.archivedMonth} (marker written: ${result.rotationMarkerWritten})`,
      );
    } else if (result.reason && result.reason !== 'no-rotation-needed') {
      console.warn(`[FeelingWise] Forensic chain rotation skipped: ${result.reason}`);
    }
  }).catch(err => {
    console.error('[FeelingWise] Forensic chain rotation failed:', err);
    // A rotation that throws is a refused night, not a silent one (S7, site 4); the refusals it already notes stay as they are.
    void noteRotation({ rotated: false, reason: `threw: ${err instanceof Error ? (err.message || err.name) : String(err)}` });
  });
}

/**
 * Whether the prune recorded a success at or after `since`. The prune notes its outcome without waiting for the
 * write, so this looks again for up to two seconds before it calls the run unrecorded.
 */
async function tidyOutcomeSince(since: string): Promise<boolean> {
  for (let tries = 0; tries < 10; tries++) {
    const prune = (await readMaintenanceHealth()).prune;
    if (prune && prune.at >= since) return prune.ok;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return false;
}

/**
 * Runs the prune and the month rotation now when either last reported more than a day ago. A daily alarm that is
 * re-created fires a full day later, so an install that reloads or updates more often than daily never reaches
 * either job by its alarm alone; a fresh worker, which starts about once a minute, reaches them here instead.
 */
export function catchUpDailyJobs(): Promise<void> {
  return readMaintenanceHealth().then(health => {
    if (dailyJobOverdue(health.prune)) void runRecordTidy();
    if (dailyJobOverdue(health.rotation)) runMonthRotation();
  });
}

/**
 * The heartbeat's chance to stamp: once six hours have passed since the last stamp, the next tick asks, so a person
 * who reads half an hour a day is stamped within a quarter of an hour of opening the browser rather than whenever the
 * six-hour alarm happens to come round. The same gate as the alarm, so Strict contacts nothing.
 */
async function stampOnHeartbeatIfDue(): Promise<void> {
  if (!(await anchoringAllowed())) return;
  const [latest, health] = await Promise.all([getLatestAnchor(), readMaintenanceHealth()]);
  if (anchorDueOnHeartbeat(latest, health.stamp?.at)) stampKeyAndChainHead();
}

// Daily maintenance — purge old scan events + prune oldest forensic records +
// check for month rotation.
chrome.alarms.onAlarm.addListener((alarm) => {
  // One listener for every alarm, on purpose, asserted by
  // tests/unit/forensics/service-worker.test.ts. dev-reload used to register a
  // second one of its own, inside an async callback, which is both a second
  // listener and the MV3 shape that fails silently after the worker restarts.
  handleDevReloadAlarm(alarm.name);
  if (alarm.name === 'scan-purge') {
    purgeScanEvents(30).catch(() => {}); // Keep 30 days of scan data
  }
  if (alarm.name === 'forensic-prune') void runRecordTidy();
  if (alarm.name === 'forensic-month-rotation') runMonthRotation();
  if (alarm.name === ANCHOR_ALARM) {
    void anchoringAllowed().then(allowed => { if (allowed) stampKeyAndChainHead(); });
  }
  if (alarm.name === 'forensic-backup') {
    autoBackupToDownloads().then(result => {
      if (result.status === 'saved') {
        const pruned = result.prunedCount ? ` (retention removed ${result.prunedCount} old backup file${result.prunedCount === 1 ? '' : 's'})` : '';
        console.log(`[FeelingWise] Auto-backup saved to ${result.filename}${pruned}`);
      } else if (result.status === 'skipped') {
        console.log(`[FeelingWise] Auto-backup skipped: ${result.reason}`);
      } else {
        console.warn(`[FeelingWise] Auto-backup failed: ${result.reason}`);
      }
    }).catch(err => {
      console.warn('[FeelingWise] Auto-backup failed:', err);
    });
  }
  if (alarm.name === 'forensic-outbox-drain') {
    void kickForensicDeliveryPump();
  }
  if (alarm.name === 'forensic-heartbeat') {
    // The height check runs BEFORE the heartbeat, never after. The heartbeat
    // writes a record of its own, and on an install whose record had just been
    // destroyed that record lands at position 0: the chain then reads as a
    // height of one instead of none, and a check running afterwards re-bases
    // its own note and disarms itself for good. Found by an adversarial read of
    // this ordering on 2026-09-18, before it shipped.
    checkChainHeight()
      .then(() => runHeartbeat('alarm'))
      .then(outcome => {
        if (outcome.status === 'failed') console.warn(`[FeelingWise] Heartbeat tick failed: ${outcome.reason}`);
        else if (outcome.wroteGap) console.warn('[FeelingWise] Heartbeat found the recorder was down; gap marker written');
        // A second, cheap pass keeps the note within one interval of the truth,
        // so the check at the next worker start has something current to
        // compare against. It writes no marker when nothing is wrong.
        return checkChainHeight();
      })
      .then(() => stampOnHeartbeatIfDue())
      .catch(() => {});
  }
});

// A signing key that changed under the surviving chain (a browser that lost the stored key, a
// restore) is stated on the chain before any other record is signed with it. It queues on the
// chain-write lock at module start, so every write this realm makes waits behind it. It writes only
// when a chain exists, so the height check below never sees a record it did not expect on an empty
// one.
void stateKeyReplacement().then(outcome => {
  if (outcome.status === 'stated') console.warn(`[FeelingWise] Signing key changed under the chain (${outcome.origin}); marker written`);
  else if (outcome.status === 'failed') console.warn(`[FeelingWise] Key continuity check failed: ${outcome.reason}`);
});

// Compare the record with the height it is known to have reached (M186's open
// half). A destroyed database re-opens EMPTY and SUCCEEDING, so without this
// line it reads as an empty record on every screen, with no error anywhere.
// What it can and cannot catch is written out in full in
// forensics/chain-height-witness.ts, and the honest answer is narrower than
// "the record notices its own destruction".
//
// This is FIRST on a fresh realm, before the delivery pump and before the
// heartbeat, because both of those write to the chain: a record written on the
// fresh chain before the comparison happens is a record that hides the drop the
// comparison exists to see. The archive half of it is read here and only here,
// because it opens one database per month, and at most once per browser session
// even so: a fresh realm is not a rare event, it is roughly every minute for as
// long as Chrome is open, because `forensic-outbox-drain` below is armed at one
// minute and a worker idles out at about thirty seconds. See
// ARCHIVE_READ_MIN_INTERVAL_MS in chain-height.ts (2026-09-19).
// Any update gap noted by an earlier realm and not yet on the chain. First,
// because it is a statement about records already lost and every tick that
// passes without it is a tick where the record does not say so.
void writePendingUpdateGap();

void checkChainHeightOnRealmStart().then(() => {
  // Resume durable deliveries whenever Chrome starts a fresh SW realm.
  void kickForensicDeliveryPump();
  // After the height check for the same reason as the pump: the prune moves records out of the active chain.
  void catchUpDailyJobs();
  // A fresh worker realm stamps a heartbeat tick and, when the last tick is
  // stale, writes the recorder-down gap at once rather than up to fifteen
  // minutes later. It writes no heartbeat record here (the alarm does that).
  void runHeartbeat('start');
});

// Q78 (W69): heal the global download-UI toggle on every worker start. If
// the SW died inside downloadQuietly's disable/enable window, the whole
// profile's download UI stayed off until browser restart; enabled is the
// default state so this is always safe to re-assert.
void restoreDownloadUiOnStartup();

/**
 * Ask the browser to keep this origin's storage rather than treat it as
 * throw-away (2026-09-18, with the `unlimitedStorage` permission added in the
 * same commit).
 *
 * The record lives in IndexedDB at the extension's own origin. Without
 * `unlimitedStorage` that origin is a best-effort bucket, which Chrome is free
 * to evict whole when the disk gets tight, and the way it fails is the worst
 * shape a failure can have here: the database comes back EMPTY and every read
 * of it SUCCEEDS. `getChainState` walks an empty index, finds no cursor, and
 * takes its success path, so a brand new chain starts at position 0 under the
 * surviving signing key. Nothing in the product compares the chain against a
 * height it had before, so the dashboard would simply say the record holds
 * nothing, with no error anywhere and no marker on any chain, because there is
 * no chain left to write a marker on.
 *
 * `unlimitedStorage` is what actually fixes it: Chrome exempts an extension
 * that holds it from quota eviction, and its own documentation says that
 * exemption covers `chrome.storage.local`, IndexedDB, Cache Storage and the
 * origin private file system together.
 *
 * WHAT THIS CALL IS AND IS NOT, corrected on 2026-09-18 against the current
 * documentation rather than against what the line was written believing.
 * `StorageManager.persist()` is documented as NOT available in a worker,
 * although the interface is; an MV3 service worker is a worker. So in this
 * realm the optional call below resolves to undefined and the old line logged
 * "refused", which reads as Chrome having declined something it was never
 * asked. It is left in place because it is free and because the same module is
 * loaded in realms where it does exist, but it is NOT a second layer of
 * protection here and must not be described as one: `unlimitedStorage` is the
 * whole of the protection, and the comparison in forensics/chain-height-witness.ts
 * is what notices when protection failed. The log line now says which of the
 * three things happened instead of collapsing two of them into "refused".
 */
void (async () => {
  try {
    const persisted = await navigator.storage?.persisted?.();
    if (persisted) return;
    if (typeof navigator.storage?.persist !== 'function') {
      console.log('[FeelingWise] storage persistence: not offered in this realm; the unlimitedStorage permission is what exempts the origin');
      return;
    }
    const granted = await navigator.storage.persist();
    console.log(`[FeelingWise] storage persistence: ${granted ? 'granted' : 'refused'}`);
  } catch {
    // Not available in this realm. The permission is the layer that matters.
  }
})();

// Dev-only self-reload: inert on store installs (installType gate) and
// whenever the local token server is not running. See dev-reload.ts.
initDevReload();

// Build chronology: remember which bundle is running and since when, so a
// Copy Diagnostics payload can state whether its numbers were produced by the
// code the reader is holding (build-history.ts). Best-effort by design — a
// storage failure here must never block the worker.
// Everything here is defensive on purpose: this runs at module scope, so a
// throw would take the whole worker down at boot. `getManifest` is absent in
// some test realms and could be absent in a future host.
void (async () => {
  let version = '';
  try {
    version = chrome?.runtime?.getManifest?.().version ?? '';
  } catch { /* version is decoration; the build id is the load-bearing part */ }
  await noteBuildRun(getBakedBuildId(), version, new Date().toISOString());
})().catch(() => { /* the history is a convenience, never a boot dependency */ });

// M91: every worker start reconciles recheck tabs a dead instance left
// behind (expired → closed now; still-in-window → closed at deadline).
void sweepOrphanRecheckTabs().catch(() => { /* sweep is best-effort */ });

// Inspection-tab registry: dashboard-opened tabs ("View original" → 'reveal',
// metrics recheck → 'observe') run an observe-only pass in the content script.
// Backed by chrome.storage.session so a worker eviction no longer forgets
// grants (owner repro 2026-08-01: the in-memory Map + register-after-create
// ordering lost the grant and the recheck tab got fully protected). Grants are
// TTL'd and URL-pre-granted BEFORE tab creation; see inspection-registry.ts.
// Closed tabs are dropped immediately so a recycled tabId can never inherit a
// grant within the TTL.
const inspectionTabs = createInspectionRegistry();
chrome.tabs?.onRemoved?.addListener((tabId) => void inspectionTabs.remove(tabId));

// Handle messages from content scripts and popup.
//
// IMPORTANT: For async handlers (IndexedDB writes), we return true AND call
// sendResponse when done. This keeps the service worker alive until the write
// completes — without sendResponse, Chrome closes the message channel and logs:
// "A listener indicated an asynchronous response by returning true, but the
// message channel closed before a response was received"
//
/**
 * Protocol plus host from a URL, or undefined when there is nothing usable.
 * The fallback for `sender.origin`, which older Chrome builds omit for some
 * frame types. Never falls back to a value the page controls.
 */
function originFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined;
    return u.origin;
  } catch {
    return undefined;
  }
}

/**
 * True when a message was sent from a web page's tab and not from one of this extension's own pages.
 * A content script runs inside the page: its sender carries a tab and the PAGE's URL. The popup has no tab, and
 * the dashboard has an extension URL even when it is open as a tab. A sender with a tab and no URL cannot be shown
 * to be an extension page, so it counts as a web page (fails closed). The prefix ends in a slash so an id that only
 * starts the same way does not pass. The two most destructive messages (reset, restore) are taken only from
 * extension pages (B7 unit 2, P34).
 */
function isWebPageSender(sender: chrome.runtime.MessageSender): boolean {
  if (!sender.tab) return false;
  return !(sender.url ?? '').startsWith(`chrome-extension://${chrome.runtime.id}/`);
}

/**
 * The messages that add a marker or a flag to the chain. Only the extension's own pages send them (the dashboard's
 * Export tab and Issues tab, the repair path, the attention line's prune button), so a web page's tab is refused
 * (B7 unit 4, P35). RECHECK_RECORD and
 * OPEN_ORIGINAL are not here: existing checks send them from a web tab and expect them to work.
 */
const EXTENSION_PAGE_ONLY_TYPES: ReadonlySet<string> = new Set([
  'IMPORT_MARKER',
  'REPAIR_MARKER',
  'RECONCILE_MARKER',
  'REDACTION_MARKER',
  'MANUAL_FLAG',
  'RUN_RECORD_TIDY',
]);

chrome.runtime.onMessage.addListener((message: FWMessage, sender, sendResponse) => {
  // SEC-2/M76 hardening: manifest.json declares no `externally_connectable`
  // and no `onMessageExternal`, so today only this extension's own content
  // scripts / popup / dashboard can reach this listener at all. This check
  // is defense-in-depth (future-proofs the gap if external reachability is
  // ever added) and also rejects a malformed `type` before it can reach any
  // privileged branch below — a dev-console-injected message, a future
  // caller bug, etc. Each rejection is logged once with its reason so a
  // genuine integration bug stays visible without spamming the console.
  if (sender.id !== chrome.runtime.id) {
    console.warn('[FeelingWise] Rejected onMessage: sender is not this extension', {
      senderId: sender.id,
    });
    return false;
  }
  const messageType = (message as { type?: unknown } | null | undefined)?.type;
  if (!FW_MESSAGE_TYPES.includes(messageType as FWMessage['type'])) {
    console.warn('[FeelingWise] Rejected onMessage: unrecognized message type', { messageType });
    return false;
  }

  if (message.type === 'SCAN_LOG' && message.payload) {
    logScanEvent(message.payload).catch(err => {
      console.warn('[FeelingWise] Scan log failed:', err);
    });
    return false; // Fire-and-forget
  }

  //  capture routing. Content-script callers send
  // these messages instead of writing IDB directly; SW writes to the extension
  // origin's IDB so the popup / dashboard / dev-console at the extension origin
  // can read the captures back. Fire-and-forget; capture failures swallowed.
  if (message.type === 'CAPTURE_PROMPT_IO' && message.payload) {
    capturePromptIO(message.payload).catch(() => { /* swallow per Decision 7 */ });
    return false;
  }
  if (message.type === 'CAPTURE_BEHAVIOR' && message.payload) {
    captureBehaviorEvent(message.payload).catch(() => { /* swallow per Decision 7 */ });
    return false;
  }
  if (message.type === 'CAPTURE_PERF_RECORD' && message.payload) {
    const payload = message.payload;
    persistPerfRecord({ ...payload, stage: payload.stage as V2Stage })
      .catch(() => { /* swallow — perf-trace is diagnostic-only */ });
    return false;
  }

  if (message.type === 'NEUTRALIZATION_COMPLETE') {
    // Serialize read-modify-write so parallel posts from multiple tabs
    // don't lose increments. Audit A6 HIGH closure (V1.5 ROADMAP #11).
    counterWriteLock(async () => {
      // Retry the counter write with short backoff (mirrors
      // sendSWMessageWithRetry in forensics/store.ts). A single transient
      // chrome.storage failure used to only warn here, so the increment was
      // lost and the badge silently drifted below the real neutralized count.
      await incrementNeutralizedWithRetry();
      const settings = await getSettings();
      void chrome.action.setBadgeText({ text: String(settings.totalNeutralizedToday) });
      void chrome.action.setBadgeBackgroundColor({ color: '#00bcd4' });
    }).catch(err => {
      console.warn('[FeelingWise] NEUTRALIZATION_COMPLETE counter update failed:', err);
    });
    // Fire-and-forget — no sendResponse needed, content script doesn't await
    return false;
  }

  // Single counter writer. Content scripts, the popup and the dashboard
  // send their usage increments here instead of writing chrome.storage
  // themselves; the write runs in this realm's serialised chain and
  // re-reads storage when its snapshot's period keys are behind the clock.
  // Acknowledged so a sender can tell a dropped increment from a landed one.
  if (message.type === 'USAGE_INCREMENT') {
    const increment = message.payload;
    if (!increment || typeof increment !== 'object' || typeof increment.kind !== 'string') {
      sendResponse({ ok: false, error: 'USAGE_INCREMENT requires a payload with a kind' } satisfies UsageIncrementResponse);
      return true;
    }
    counterWriteLock(() => applyUsageIncrement(increment))
      .then(() => sendResponse({ ok: true } satisfies UsageIncrementResponse))
      .catch(err => {
        console.warn('[FeelingWise] USAGE_INCREMENT failed:', err);
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        } satisfies UsageIncrementResponse);
      });
    return true;
  }

  // Q85 (W69): a falsy payload used to fall through to `return false` with
  // NO response, costing the content side three retries before it counted
  // a loss. Mirror RESTORE's explicit error reply.
  if (FORENSIC_DELIVERY_TYPES.has(message.type as ForensicDeliveryType) && !message.payload) {
    sendResponse({ ok: false, error: 'missing forensic delivery payload' });
    return true;
  }
  if (FORENSIC_DELIVERY_TYPES.has(message.type as ForensicDeliveryType) && message.payload) {
    const deliveryId = 'deliveryId' in message ? message.deliveryId?.trim() : undefined;
    if (!deliveryId) {
      sendResponse({ ok: false, error: 'missing forensic delivery id' });
      return true;
    }
    const type = message.type as ForensicDeliveryType;
    // Where the content script was running, according to the BROWSER.
    //
    // Nothing else in a record ties its bytes to a platform rather than to a
    // browser: platform attribution is one read of the document host, so a
    // hosts-file line plus a local server produces a fully signed, chained and
    // time-stamped fake feed. `sender.origin` is set by Chrome from the frame
    // that sent the message, so the page cannot forge it and the content
    // script does not assert it. That is why it is stamped here and not
    // threaded up from the content side with the rest of the payload.
    //
    // It does not close the spoof (someone who can edit hosts can also serve
    // https with a certificate their own machine trusts) and the export says
    // so. It makes the cheap version visible: all five platforms are
    // HTTPS-only, so an http: origin was not a real session on any of them.
    const senderOrigin = typeof sender.origin === 'string' && sender.origin.length > 0
      ? sender.origin
      : originFromUrl(sender.url ?? sender.tab?.url);
    const payload = type === 'FORENSIC_LOG'
      ? {
          ...(message.payload as ForensicLogPayload),
          feedSource: (message.payload as ForensicLogPayload).feedSource ?? 'unknown',
          ...(senderOrigin ? { surfaceOrigin: senderOrigin } : {}),
        }
      : {
          ...(message.payload as object),
          ...(senderOrigin ? { surfaceOrigin: senderOrigin } : {}),
        };
    const rawCapturedAt = 'deliveryCapturedAt' in message ? message.deliveryCapturedAt : undefined;
    const capturedMs = rawCapturedAt === undefined ? Date.now() : Date.parse(rawCapturedAt);
    if (!Number.isFinite(capturedMs)) {
      sendResponse({ ok: false, error: 'invalid forensic capture timestamp' });
      return true;
    }
    const enqueuedAt = new Date(capturedMs).toISOString();
    // Register item 20 part 2: an account the parent stopped recording is
    // dropped here, before the outbox, and counted for the next heartbeat.
    // Protection on the page already happened; only the record is withheld.
    // Narrowed once here: the hoisted enqueue below cannot see the early-return narrowing.
    const id: string = deliveryId;
    const excluded = excludableAuthor(type, payload);
    if (excluded) {
      void exclusions().then(list => {
        if (isExcludedAuthor(list, excluded.platform, excluded.author)) {
          void noteExcludedSkip();
          sendResponse({ ok: true, deliveryId, state: 'skipped-excluded' });
          return;
        }
        enqueue();
      }).catch(() => enqueue());
      return true;
    }
    enqueue();
    return true;
    function enqueue(): void {
    // Enqueue shares the chain lock with reset/rotation/restore. This makes
    // their pending-delivery check/fence race-free in the single SW realm.
    sharedChainWriteLock(() => enqueueForensicDelivery({ deliveryId: id, type, payload, enqueuedAt }))
      .then(result => {
        const sourceTabId = sender.tab?.id;
        if (sourceTabId != null && recheckDeliverySignals.has(sourceTabId)) {
          if (result.state === 'committed') {
            recheckDeliverySignals.get(sourceTabId)?.();
          } else if (result.state === 'pending') {
            // Enqueue durability is enough to close the content message, but
            // the dashboard's “rechecked” label requires the chain commit.
            void confirmRecheckDeliveryCommit(sourceTabId, id);
          }
        }
        if (result.state === 'pending') void kickForensicDeliveryPump();
        sendResponse({ ok: true, deliveryId: id, state: result.state });
      })
      .catch(err => {
        console.error('[FeelingWise] Could not durably enqueue forensic delivery:', err);
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  if (message.type === 'AUTHOR_UPDATE' && message.payload) {
    const p = message.payload;
    // Per-author lock so concurrent updates to the SAME author from
    // multiple tabs serialize their readonly-get + readwrite-put
    // pair; different authors don't block each other. Audit A6 HIGH
    // closure (V1.5 ROADMAP #11). Author-key includes platform so
    // an @handle on X vs FB is treated as separate identity (matches
    // the underlying author-store keying).
    const authorKey = `${p.author}@${p.platform}`;
    withAuthorLock(authorKey, () => updateAuthorProfile(p.author, p.platform, p.flagged, p.techniques, p.day, p.textHash))
      .then(() => sendResponse({ ok: true }))
      .catch(err => {
        console.error('[FeelingWise] Author profile update failed:', err);
        sendResponse({ ok: false });
      });
    return true; // Keep channel open for async sendResponse
  }

  // Content-realm read of an author profile. The profile store is
  // extension-origin IndexedDB that this realm alone writes; a content
  // script opening it directly gets the host page's (empty) origin store.
  // The reply feeds the pipeline's exposure notice. Failure degrades to
  // {ok:false}: the boost is enrichment, never a gate.
  if (message.type === 'GET_AUTHOR_PROFILE' && message.payload) {
    const { handle, platform } = message.payload;
    if (typeof handle !== 'string' || handle.length === 0) {
      sendResponse({ ok: false, error: 'GET_AUTHOR_PROFILE requires a handle' } satisfies GetAuthorProfileResponse);
      return true;
    }
    getAuthorProfile(handle, typeof platform === 'string' ? platform : undefined)
      .then(profile => sendResponse({ ok: true, profile } satisfies GetAuthorProfileResponse))
      .catch(err => {
        console.warn('[FeelingWise] Author profile read failed:', err);
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        } satisfies GetAuthorProfileResponse);
      });
    return true;
  }

  // The reading's line from the record: counted here because the chain is
  // extension-origin IndexedDB a content script cannot open. Read-only; the
  // reply is shown beside the item and feeds no verdict.
  if (message.type === 'GET_AUTHOR_WEEK' && message.payload) {
    const { handle, platform } = message.payload;
    if (typeof handle !== 'string' || handle.length === 0 || typeof platform !== 'string' || platform.length === 0) {
      sendResponse({ ok: false, error: 'GET_AUTHOR_WEEK requires a handle and a platform' } satisfies GetAuthorWeekResponse);
      return true;
    }
    getRecordsOrThrow({ startDate: new Date(Date.now() - AUTHOR_WEEK_MS).toISOString() })
      .then(records => {
        const week = countAuthorWeek(records, handle, platform);
        sendResponse({ ok: true, ...week } satisfies GetAuthorWeekResponse);
      })
      .catch(err => {
        console.warn('[FeelingWise] Author week read failed:', err);
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        } satisfies GetAuthorWeekResponse);
      });
    return true;
  }

  // Destructive reset must execute in this realm so it shares the same
  // chain-write lock as FORENSIC/PASS/CANCEL/BLOCKED/ENVIRONMENT writes.
  //
  // F2 hardening: the reset is parent-PIN-gated HERE, not only in the
  // dashboard modal. The modal's verifyPin() runs client-side of this
  // boundary, so before this check any extension realm (a content-script
  // context on a hostile page, a dev-console injection) could post this
  // envelope and wipe the evidence chain unauthenticated — exactly the
  // "NEVER ship without a PIN gate" condition resetForensicChain's own doc
  // states (forensics/store.ts). The SW verifies the supplied PIN preimage
  // against the stored parentPin hash (same verifyPin as every other gate)
  // and refuses to touch the chain otherwise. Where NO PIN is stored the gate
  // opens: an adult install never sets one, and until 14 Sep 2026 its reset
  // button could not reset anything. The branch below says so at length. This
  // paragraph used to say the opposite, that a missing PIN was refused as
  // unconfigured rather than treated as an open gate, so the two comments in
  // this one branch contradicted each other and a reader checking the gate met
  // the false one first (2026-09-19).
  //
  // What makes the open case safe is that a missing PIN is a fact read from
  // storage, not a fact the reader failed to read: `parentPinUnknown` refuses
  // the act when the settings snapshot is the fail-closed fallback, because
  // that snapshot reports no PIN whether or not one exists.
  //
  // The PIN grace window is deliberately NOT consulted: destructive gates
  // always demand the PIN (storage/settings.ts PIN-grace contract).
  if (message.type === 'RESET_FORENSIC_CHAIN') {
    if (isWebPageSender(sender)) {
      console.warn('[FeelingWise] RESET_FORENSIC_CHAIN refused: sent from a web page, not an extension page');
      const refused: ResetForensicChainResponse = {
        ok: false,
        errorKind: 'sender-refused',
        error: 'RESET_FORENSIC_CHAIN is taken only from an extension page',
      };
      sendResponse(refused);
      return false;
    }
    const pin = message.payload?.pin;
    (async (): Promise<ResetForensicChainResponse> => {
      // The parent-PIN gate, but only where a PIN exists to check — the same
      // rule RESTORE_FORENSIC_BACKUP took on 14 Sep 2026, and for the same
      // reason. Until now an install with no PIN was refused outright ("set
      // one in the popup first"), so on an adult install, which never sets a
      // PIN, the reset button could not reset anything: reported live as
      // "the reset button does nothing". Where a PIN exists the gate is
      // unchanged, and it stays at this boundary because any extension realm
      // can post this envelope. Where none exists there is no secret to check;
      // the dashboard confirms the act by having the word typed
      // (ResetChainConfirmModal), and a restore, which can replace the chain
      // AND the signing identity, already runs on this same rule.
      const settings = await getSettings();
      // A snapshot the reader could not confirm reports no PIN whether or not
      // one exists, so it must not be allowed to open this gate (2026-09-19).
      if (parentPinUnknown(settings)) {
        console.warn('[FeelingWise] RESET_FORENSIC_CHAIN refused: settings could not be read');
        return {
          ok: false,
          errorKind: 'pin-required',
          error: 'Settings could not be read, so the parent PIN could not be checked. Try again.',
        };
      }
      if (settings.parentPin) {
        if (typeof pin !== 'string' || pin.length === 0) {
          console.warn('[FeelingWise] RESET_FORENSIC_CHAIN rejected: no PIN in payload');
          return {
            ok: false,
            errorKind: 'pin-required',
            error: 'RESET_FORENSIC_CHAIN requires the parent PIN',
          };
        }
        if (!(await verifyPin(pin))) {
          console.warn('[FeelingWise] RESET_FORENSIC_CHAIN rejected: wrong PIN');
          return { ok: false, errorKind: 'pin-invalid', error: 'Wrong parent PIN' };
        }
      }
      const result = await resetForensicChain(message.payload?.reason);
      // The store REFUSES rather than throwing when it cannot archive the
      // outgoing chain first, and returns a result with every flag false. That
      // shape is indistinguishable from a reset that happened and left every
      // sidecar behind, which is exactly how the modal read it: it called
      // onSuccess and printed the partial-reset sentence over a chain that had
      // not been touched. reset-modal-status.ts says outright that a
      // marker failure "never reaches this path"; it did. The marker is the
      // one flag that means the chain itself was reset, so it decides here,
      // and archiveFailedReason finally has a reader (2026-09-19).
      if (!result.resetMarkerWritten) {
        console.warn('[FeelingWise] RESET_FORENSIC_CHAIN refused by the store; nothing was cleared');
        return {
          ok: false,
          errorKind: 'reset-refused',
          error: result.archiveFailedReason
            ? `the current chain could not be archived first (${result.archiveFailedReason})`
            : 'the chain was not reset',
        };
      }
      return { ok: true, result };
    })()
      .then(response => sendResponse(response))
      .catch(err => {
        const error = err instanceof Error ? err.message : String(err);
        console.error('[FeelingWise] Forensic chain reset failed:', err);
        sendResponse({ ok: false, error });
      });
    return true;
  }

  if (message.type === 'GET_SIGNING_METADATA') {
    sharedChainWriteLock(async () => {
      // First-use key persistence must finish before reading createdAt.
      const publicKeyJwk = await getPublicKeyJWK();
      const [fingerprint, createdAt] = await Promise.all([
        getPublicKeyFingerprint(),
        getSigningKeyCreatedAt(),
      ]);
      return { publicKeyJwk, fingerprint, createdAt };
    })
      .then(metadata => sendResponse({ ok: true, metadata }))
      .catch(err => {
        console.error('[FeelingWise] Signing metadata read failed:', err);
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      });
    return true;
  }

  if (message.type === 'RESTORE_FORENSIC_BACKUP') {
    if (isWebPageSender(sender)) {
      console.warn('[FeelingWise] RESTORE_FORENSIC_BACKUP refused: sent from a web page, not an extension page');
      const refused: RestoreForensicBackupResponse = {
        ok: false,
        errorKind: 'sender-refused',
        error: 'RESTORE_FORENSIC_BACKUP is taken only from an extension page',
      };
      sendResponse(refused);
      return false;
    }
    // SW-2 hardening: every sibling privileged branch guards with
    // `&& message.payload` before touching `message.payload`; this one
    // didn't, so a malformed/incomplete message (dev-console injected, a
    // future caller bug) threw synchronously on the destructure below,
    // sendResponse was never called, and the dashboard's restore-from-backup
    // UI got no error at all — just a silent hang. This is also the single
    // most destructive operation the SW exposes (it can replace the signing
    // key and the entire chain), so it fails with an explicit structured
    // error instead of the guarded siblings' silent no-response fallthrough.
    if (!message.payload) {
      console.warn('[FeelingWise] RESTORE_FORENSIC_BACKUP received without payload');
      sendResponse({
        ok: false,
        errorKind: 'missing-payload',
        error: 'RESTORE_FORENSIC_BACKUP message is missing its payload',
      });
      return true;
    }
    const { raw, passphrase, force, pin, sealSecret } = message.payload;
    (async (): Promise<RestoreForensicBackupResponse> => {
      // The parent-PIN gate, the same as RESET_FORENSIC_CHAIN's, but only
      // where a PIN exists to check. Until 14 Sep 2026 an install with no PIN
      // was refused outright ("set one in the popup first"), which made the
      // restore impossible exactly where it is needed: a fresh install after
      // a reinstall has no PIN and nothing to protect, and an adult install
      // never sets one. With a PIN configured the gate is unchanged: any
      // extension realm can post this envelope, and with force:true it
      // replaces the whole chain and can replace the signing identity.
      const settings = await getSettings();
      // A snapshot the reader could not confirm reports no PIN whether or not
      // one exists, so it must not be allowed to open this gate (2026-09-19).
      if (parentPinUnknown(settings)) {
        console.warn('[FeelingWise] RESTORE_FORENSIC_BACKUP refused: settings could not be read');
        return {
          ok: false,
          errorKind: 'pin-required',
          error: 'Settings could not be read, so the parent PIN could not be checked. Try again.',
        };
      }
      if (settings.parentPin) {
        if (typeof pin !== 'string' || pin.length === 0) {
          console.warn('[FeelingWise] RESTORE_FORENSIC_BACKUP rejected: no PIN in payload');
          return { ok: false, errorKind: 'pin-required', error: 'RESTORE_FORENSIC_BACKUP requires the parent PIN' };
        }
        if (!(await verifyPin(pin))) {
          console.warn('[FeelingWise] RESTORE_FORENSIC_BACKUP rejected: wrong PIN');
          return { ok: false, errorKind: 'pin-invalid', error: 'Wrong parent PIN' };
        }
      }
      // restoreFromBackup owns one non-reentrant chain lock around the whole
      // staged operation, including optional key replacement and record swap.
      const result = await restoreFromBackup(raw, passphrase, force, sealSecret);
      // A restore from a backup folder brought the folder's key with it: keep
      // it, so the automatic copies written from now on open with the same
      // key file and the folder stays one thing that restores anywhere.
      if (result.ok && typeof sealSecret === 'string' && sealSecret.length > 0) {
        await adoptBackupSealSecret(sealSecret);
      }
      return { ok: true, result };
    })()
      .then(response => sendResponse(response))
      .catch(err => {
        console.error('[FeelingWise] Forensic backup restore failed:', err);
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      });
    return true;
  }

  // The five messages that add a marker or a flag, and the prune run, which adds a prune marker, are taken only from
  // extension pages: a content script in a web page carries a tab and the page's URL, and could otherwise write any of
  // them (B7 unit 4, P35).
  if (EXTENSION_PAGE_ONLY_TYPES.has(message.type) && isWebPageSender(sender)) {
    console.warn(`[FeelingWise] ${message.type} refused: sent from a web page, not an extension page`);
    sendResponse({
      ok: false,
      errorKind: 'sender-refused',
      error: `${message.type} is taken only from an extension page`,
    });
    return false;
  }

  if (message.type === 'RUN_RECORD_TIDY') {
    const startedAt = new Date().toISOString();
    void runRecordTidy()
      .then(() => tidyOutcomeSince(startedAt))
      .then(ok => sendResponse({ ok } satisfies RunRecordTidyResponse), () => sendResponse({ ok: false } satisfies RunRecordTidyResponse));
    return true;
  }

  // Dashboard-initiated parent-flag chain write. Pre-2026-05-24 the
  // dashboard called `flagPostManually` directly in its own realm where
  // a separate `createChainWriteLock()` instance raced SW-realm writes
  // (logger.ts entrypoints) and could stamp duplicate chainPosition.
  // Routing through SW puts the chain write under the same
  // sharedChainWriteLock as logger.ts. Audit A4-BLOCKER-2 / A6-BLOCKER
  // closure. Mirrors the 2026-05-22 BLOCKED_LOG migration pattern.
  if (message.type === 'MANUAL_FLAG' && message.payload) {
    const p = message.payload;
    flagPostManually(p.url, p.reason)
      .then(({ record }) => sendResponse({ ok: true, record }))
      .catch(err => {
        if (err instanceof InvalidManualFlagUrlError) {
          sendResponse({ ok: false, errorKind: 'invalid-url', error: err.message });
        } else {
          console.error('[FeelingWise] Manual flag failed:', err);
          sendResponse({ ok: false, errorKind: 'sw-error', error: String(err?.message ?? err) });
        }
      });
    return true; // async response
  }

  // Verify-session diagnostic. Reads the chain at extension origin and
  // returns a snapshot suitable for page-console logging. Sender (content
  // script) gates this on `ff_chainDebugStats`; SW does not gate again
  // because the round-trip cost is negligible. If the IDB read fails we
  // respond `{ ok: false }` rather than throw; the diagnostic must not
  // disrupt the BATCH path.
  // Dashboard-initiated import marker after a salvage import (register item
  // 15): the chain says that recovered records entered, and which ones.
  if (message.type === 'IMPORT_MARKER') {
    if (!isImportMarkerInput(message.payload)) {
      sendResponse({ ok: false, error: 'import marker payload rejected' });
      return true;
    }
    appendImportMarker(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch(err => {
        console.error('[FeelingWise] Import marker write failed:', err);
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      });
    return true;
  }

  // Dashboard-initiated repair disclosure (register item 18): one signed
  // marker per heal-log event, so a repair is on the chain, not only in a
  // 20-entry local log.
  if (message.type === 'REPAIR_MARKER') {
    if (!isRepairMarkerInput(message.payload)) {
      sendResponse({ ok: false, error: 'repair marker payload rejected' });
      return true;
    }
    appendRepairMarker(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch(err => {
        console.error('[FeelingWise] Repair marker write failed:', err);
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      });
    return true;
  }

  // Dashboard-initiated reconciliation (register item 10): one signed marker
  // per comparison against a platform's own data export. The archive is read
  // in the dashboard and kept nowhere; only counts and its digest reach here.
  if (message.type === 'RECONCILE_MARKER') {
    if (!isReconcileMarkerInput(message.payload)) {
      sendResponse({ ok: false, error: 'reconcile marker payload rejected' });
      return true;
    }
    appendReconcileMarker(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch(err => {
        console.error('[FeelingWise] Reconcile marker write failed:', err);
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      });
    return true;
  }

  // Dashboard-initiated redaction (register item 20 part 1): one signed
  // marker per withheld record; the stored record is never touched.
  if (message.type === 'REDACTION_MARKER') {
    if (!isRedactionMarkerInput(message.payload)) {
      sendResponse({ ok: false, error: 'redaction marker payload rejected' });
      return true;
    }
    appendRedactionMarker(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch(err => {
        console.error('[FeelingWise] Redaction marker write failed:', err);
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      });
    return true;
  }

  if (message.type === 'GET_CHAIN_DEBUG_STATS') {
    getRecords()
      .then(records => {
        // Q83 (W69): getRecords swallows an IDB failure into [] and sets a
        // module flag; without consulting it this diagnostic answered
        // "0 records, chain healthy" for an unopenable database - the
        // green-on-failure class removed everywhere else.
        if (lastRecordReadFailed()) {
          sendResponse({ ok: false, error: 'record store unreadable' });
          return;
        }
        sendResponse(buildChainDebugStatsResponse(records));
      })
      .catch(err => {
        console.warn('[FeelingWise] GET_CHAIN_DEBUG_STATS failed:', err);
        sendResponse({ ok: false });
      });
    return true; // async response
  }

  // Light recheck: re-open the original post in a BACKGROUND tab so the content
  // script re-extracts fresh metrics + re-runs the check (writing a new
  // metric-bearing sighting via the normal FORENSIC_LOG path), then close the
  // tab. No media is fetched/stored. The dashboard re-reads the chain on success
  // to surface the new point on popularity-over-time. Async: returning true
  // keeps the channel (and the SW) alive while the tab is open.
  if (message.type === 'RECHECK_RECORD' && message.payload) {
    recheckRecord(message.payload.url)
      .then(recorded => sendResponse({ ok: true, recorded }))
      .catch(err => {
        console.error('[FeelingWise] Recheck failed:', err);
        sendResponse({ ok: false, error: String(err?.message ?? err) });
      });
    return true; // async response
  }

  // Content-script startup query — answered from the durable registry.
  // Unknown / expired tab (or a sender with no tab, e.g. the popup) gets
  // {inspection:false}; the content side additionally fails closed on any
  // error, so a normal child tab keeps full protection by construction.
  // The lookup also resolves the tab-create race: a grant written before
  // `chrome.tabs.create` is matched by the sender's URL and bound one-shot
  // to this tab even when the tabId binding hasn't landed yet.
  if (message.type === 'IS_INSPECTION_TAB') {
    const tabId = sender.tab?.id;
    if (tabId == null) {
      sendResponse({ inspection: false });
      return false;
    }
    inspectionTabs.lookup(tabId, sender.url ?? sender.tab?.url)
      .then(entry => sendResponse(entry ? { inspection: true, mode: entry.mode } : { inspection: false }))
      .catch(() => sendResponse({ inspection: false }));
    return true; // async response
  }

  // Dashboard "View original": open the post in an ACTIVE tab and grant it
  // 'reveal' inspection so the content script shows the post untouched while
  // still extracting + logging. The grant is durably written BEFORE the tab
  // is created (document_start content scripts can query before tabs.create
  // resolves). Same URL-scheme guard as RECHECK_RECORD — postUrl is
  // DOM-derived, attacker-influenced text.
  if (message.type === 'OPEN_ORIGINAL' && message.payload) {
    const { url } = message.payload;
    if (!/^https?:\/\//i.test(url)) {
      sendResponse({ ok: false, error: `Refusing to open non-http(s) URL: ${url}` });
      return true;
    }
    inspectionTabs.grantForUrl(url, 'reveal')
      .then(() => chrome.tabs.create({ url, active: true }))
      .then(async tab => {
        if (tab.id != null) await inspectionTabs.bindTab(url, 'reveal', tab.id);
        sendResponse({ ok: true });
      })
      .catch(err => {
        console.error('[FeelingWise] Open-original failed:', err);
        sendResponse({ ok: false, error: String(err?.message ?? err) });
      });
    return true; // async response
  }

  return false;
});

// --- Light recheck -----------------------------------------------------------
// Open the original in an off-screen tab (`active:false`) so the content script
// re-extracts + writes a fresh sighting, then close it. Extraction runs on a
// backgrounded tab because the pipeline is MutationObserver + setTimeout-driven,
// not requestAnimationFrame (which Chrome suspends when hidden — see
// docs/history/brain-2026-05-to-08/lessons/2026-06-05-youtube-renderer-oom-background-raf.md).
//
// Kept to a SHORT fixed window (no chrome.tabs.onUpdated load-wait): the old
// load-event + 7s design could hold the worker open ~27s, long enough for the
// MV3 service worker to be suspended before chrome.tabs.remove ran — which left
// the recheck tab open forever AND the dashboard waiting on a response that
// never came (found 2026-06-15). A flat window the open message port can keep the
// worker alive through is robust; a permalink renders its post near-instantly,
// so ~9s comfortably covers load + re-extract + the chain write. Tunable.
//
// The window is now a TIMEOUT, not a fixed wait: recheckRecord resolves early
// (recorded:true) only after the rechecked tab's FORENSIC_LOG/PASS_LOG commits
// to the durable outbox, and falls back to recorded:false if the window
// elapses. The tab still closes in the finally either way.
const RECHECK_WINDOW_MS = 9000;
const RECHECK_RECEIPT_POLL_MS = 100;

async function confirmRecheckDeliveryCommit(tabId: number, deliveryId: string): Promise<void> {
  try {
    // Poll this receipt while the global pump continues; waiting for the
    // entire queue to drain could outlive the recheck window even when this
    // particular delivery committed near the head.
    void kickForensicDeliveryPump().catch(err => {
      console.warn('[FeelingWise] Recheck delivery pump failed:', err);
    });
    const deadline = Date.now() + RECHECK_WINDOW_MS;
    while (Date.now() < deadline && recheckDeliverySignals.has(tabId)) {
      const state = await getForensicDeliveryReceiptState(deliveryId);
      if (state === 'committed') {
        recheckDeliverySignals.get(tabId)?.();
        return;
      }
      if (state === 'discarded') return;
      await delay(RECHECK_RECEIPT_POLL_MS);
    }
  } catch (err) {
    console.warn('[FeelingWise] Recheck commit confirmation failed:', err);
  }
}

async function recheckRecord(url: string): Promise<boolean> {
  // SEC-2/M76 hardening: `url` is a forensic record's postUrl — DOM-derived,
  // attacker-influenced text captured from the platform page, not a value
  // this extension controls. Refuse anything that isn't an ordinary web
  // address before ever calling chrome.tabs.create, so a crafted post can't
  // get this privileged background flow to open file://, chrome://, or a
  // javascript: URL.
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`Refusing to recheck non-http(s) URL: ${url}`);
  }
  // Inspection pass: the recheck tab must observe (re-extract + write a fresh
  // metric-bearing sighting) without re-applying hides — a hidden post cannot
  // be re-measured. The 'observe' grant is durably written BEFORE the tab is
  // created: the content script runs at document_start and its
  // IS_INSPECTION_TAB query can beat both tabs.create's resolution and any
  // await between it and a register call (the 2026-08-01 owner repro).
  await inspectionTabs.grantForUrl(url, 'observe');
  const tab = await chrome.tabs.create({ url, active: false });
  const tabId = tab.id;
  if (tabId == null) return false;
  // M91: track the tab durably BEFORE any waiting — a hard-killed worker
  // between here and the finally would otherwise leak an invisible
  // background tab with no reconciliation. Startup sweep closes orphans.
  await rememberRecheckTab(tabId, Date.now() + RECHECK_WINDOW_MS);
  await inspectionTabs.bindTab(url, 'observe', tabId);

  // Resolve `recorded:true` only after the main router has committed the
  // rechecked tab's delivery to IDB. Race that signal against the flat window:
  // a slow page or failed enqueue resolves `recorded:false` instead of
  // claiming that a message arrival was already a retained observation.
  let recorded = false;
  let markRecorded!: () => void;
  const recordedSignal = new Promise<void>(resolve => {
    markRecorded = () => {
      recorded = true;
      resolve();
    };
    recheckDeliverySignals.set(tabId, markRecorded);
  });

  try {
    await Promise.race([recordedSignal, delay(RECHECK_WINDOW_MS)]);
  } finally {
    if (recheckDeliverySignals.get(tabId) === markRecorded) {
      recheckDeliverySignals.delete(tabId);
    }
    try { await chrome.tabs.remove(tabId); } catch { /* tab already gone */ }
    await inspectionTabs.remove(tabId); // belt-and-braces with onRemoved
    await forgetRecheckTab(tabId).catch(() => { /* ledger cleanup best-effort */ });
  }
  return recorded;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Retry incrementNeutralized up to 3 attempts with short backoff. A failed
// counter write (transient chrome.storage error) would otherwise be lost and
// the action badge would silently drift below the real neutralized count.
// Backoff ordering mirrors sendSWMessageWithRetry (forensics/store.ts:78):
// immediate, then 100ms, then 500ms. If all attempts fail the error
// propagates to the caller's .catch which leaves a warn (acceptable per spec).
async function incrementNeutralizedWithRetry(): Promise<void> {
  const backoffsMs = [0, 100, 500];
  let lastErr: unknown;
  for (let attempt = 0; attempt < backoffsMs.length; attempt++) {
    if (backoffsMs[attempt] > 0) await delay(backoffsMs[attempt]);
    try {
      await incrementNeutralized();
      return;
    } catch (err) {
      lastErr = err;
      console.warn(
        `[FeelingWise] incrementNeutralized attempt ${attempt + 1}/${backoffsMs.length} failed:`,
        err,
      );
    }
  }
  throw lastErr;
}

// Clear badge when daily stats reset (lastResetDate changes)
chrome.storage.onChanged.addListener((changes) => {
  if (changes.lastResetDate) {
    void chrome.action.setBadgeText({ text: '' });
  }
  // Entering Strict clears the time-stamp alarm and leaving it arms it again.
  if (changes.mode) armMissingAlarms();
  if (changes[EXCLUSIONS_KEY]) exclusionsCache = null;
});
