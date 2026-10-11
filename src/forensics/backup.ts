// FeelingWise — forensic chain backup + restore (survive-on-uninstall).
//
// MV3 uninstall wipes IndexedDB + chrome.storage.local, taking the forensic
// chain AND the signing key with it. The only durable copy is one the parent
// holds outside the browser profile. This module builds a portable backup of
// the chain (records + TSA anchors + parent feedback + the PUBLIC key) and
// restores it verbatim.
//
// SECURITY (approved 2026-06-05, docs/research/FORENSIC_BACKUP_DESIGN.md):
// this baseline backs up RECORDS ONLY — never the private signing key. Restored
// records stay verifiable against the embedded public key; a post-reinstall
// install starts a new chain segment under a new key (the existing
// key-mismatch UX). Passphrase-wrapped key continuity is a separate opt-in.
//
// SECURITY (G1, 2026-08-04): what lands in Downloads is no longer plaintext.
// The automatic daily backup and the pre-restore safety copy are sealed
// (AES-256-GCM, backup-envelope.ts) under a per-install device secret; the
// manual export is sealed under the parent's passphrase when they set one.
// Restore format-sniffs, so every legacy plaintext backup keeps restoring
// (decodeBackupPayload). Downloads is world-readable locally and frequently
// cloud-synced (OneDrive on Windows) — the child's verbatim feed history must
// not sit there readable.
//
// Records / anchors / feedback are written back VERBATIM (no re-signing) via
// store.replaceBackupStateUnderChainLock, so the original signatures keep
// verifying. Restore is REPLACE, never interleave — see restoreFromBackup.

import {
  getRecordsOrThrow, getRecordsDetailed, replaceBackupStateUnderChainLock, getAllParentFeedback,
  type ParentFeedback, type UnreadableStoredRecord,
} from './store';
import { loadArchivesOldestFirst, countArchivedRecords, readArchiveRecordsDetailed } from './archive-reader';
import { readSalvagedRecords, importSalvagedRecords } from './salvage-store';
import { rememberPublicKeys } from './known-keys';
import { archiveEvictedRecords } from './archive-writer';
import { getAnchors, type ChainAnchor } from './chain-anchor-store';
import { getKeyGenesis, restoreKeyGenesis, type KeyGenesisRecord } from './key-genesis';
import {
  getPublicKeyJWK,
  getPublicKeyFingerprint,
  exportWrappedPrivateKey,
  getSigningKeyCreatedAt,
  prepareSigningKeyRestore,
  commitSigningKeyRestore,
  type StagedSigningKeyRestore,
} from './signing';
import { unwrapPrivateKeyJwk, wrapSecretString, type WrappedKey } from './key-wrap';
// Static import (M40: no dynamic imports in SW-reachable modules). The
// module touches indexedDB and the picker global only at call time, so
// loading it in the SW is inert.
import {
  getBackupFolderWireStatus, writeBackupToWiredFolder,
  LATEST_BACKUP_FILENAME, RESTORE_KEY_FILENAME, restoreKeyFileContents,
} from './backup-folder-wire';

/** The fixed-name newest copy in Downloads (overwritten); the dated copies beside it never are. */
export const LATEST_DOWNLOADS_BACKUP_PATH = `FeelingWise/${LATEST_BACKUP_FILENAME}`;
import {
  sealBackupJson,
  openBackupJson,
  openBackupJsonWithRecoveryPassphrase,
  isSealedBackupEnvelope,
  generateDeviceSealSecret,
  SEALED_BACKUP_VERSION,
} from './backup-envelope';
import { verifyChainIntegrity, verifyChainStructure } from './chain-integrity';
import { sharedChainWriteLock } from './chain-write-lock';
import { stateKeyReplacementUnderChainLock } from './key-continuity';
import { getForensicDeliveryStatus } from './delivery-outbox';
import type { ForensicRecord } from '../types/forensic';

// v2 adds `archives` and `salvage`. The bump matters: the restore path
// REFUSES a file whose schemaVersion is newer than the build reading it, so an
// older build meets a history-carrying backup with an honest refusal instead
// of restoring the active chain and silently dropping every archived record.
export const BACKUP_SCHEMA_VERSION = 2;

export interface ForensicBackup {
  schemaVersion: number;
  exportedAt: string;
  publicKeyJwk: JsonWebKey;
  fingerprint: string;
  records: ForensicRecord[];
  anchors: ChainAnchor[];
  parentFeedback: ParentFeedback[];
  /** Option A: passphrase-encrypted private signing key (present only when the parent set a passphrase). */
  wrappedPrivateKey?: WrappedKey;
  /** Original signing-key creation time, carried so a restored key keeps its age. */
  keyCreatedAt?: string;
  /**
   * The time stamps two independent authorities took over this install's
   * public key (src/forensics/key-genesis.ts). Carried because they are the
   * only date on the key that did not come from this computer, and without
   * them a restore after a reinstall would re-stamp the same key with today's
   * date and lose the original attestation.
   */
  keyGenesis?: KeyGenesisRecord;
  /**
   * Archived history, keyed by UTC month. `records` above is the ACTIVE chain
   * only, which used to be the whole story because the cap prune destroyed
   * everything older. Since archive-on-evict it is not: most of the record
   * lives in the month archives, and a backup carrying only `records` would
   * protect the newest 10000 and let the rest die with the profile.
   *
   * Absent when the transport could not carry it (see `historyCoverage`).
   */
  archives?: Record<string, ForensicRecord[]>;
  /**
   * The independent timestamps each archived month carries. Rotation started
   * preserving these on 2026-09-04; a backup that took the records and left
   * the anchors would undo that on the next restore.
   */
  archiveAnchors?: Record<string, ChainAnchor[]>;
  /** Recovered prior-generation records held in the salvage store. */
  salvage?: ForensicRecord[];
  /**
   * Whether this file covers history, stated in the file itself so a restore
   * (or a person reading it later) never has to infer coverage from the
   * absence of a key.
   */
  historyCoverage?: 'full' | 'active-chain-only' | 'recent-records-only';
  /**
   * Set when the payload had to be trimmed to fit its transport. Names how
   * many records of the active chain were dropped, and from which end, so a
   * trimmed copy can never be mistaken for a whole one.
   */
  trimmedOlderRecords?: number;
  /**
   * Archived rows the install holds that did not decode, so they are not in
   * `archives`. Stated in the file so a full history less these rows cannot
   * read as the whole of it; absent when there were none.
   */
  unreadableArchivedRows?: number;
}

// ─── Pure logic (unit-tested; no IDB) ─────────────────────────────────────

/** Assemble a backup object from already-read parts. Pure. */
export function assembleBackup(parts: {
  exportedAt: string;
  publicKeyJwk: JsonWebKey;
  fingerprint: string;
  records: ForensicRecord[];
  anchors: ChainAnchor[];
  parentFeedback: ParentFeedback[];
  wrappedPrivateKey?: WrappedKey;
  keyCreatedAt?: string;
  keyGenesis?: KeyGenesisRecord;
  archives?: Record<string, ForensicRecord[]>;
  archiveAnchors?: Record<string, ChainAnchor[]>;
  salvage?: ForensicRecord[];
  historyCoverage?: 'full' | 'active-chain-only' | 'recent-records-only';
  trimmedOlderRecords?: number;
  unreadableArchivedRows?: number;
}): ForensicBackup {
  return { schemaVersion: BACKUP_SCHEMA_VERSION, ...parts };
}

/**
 * W81: why a sealed backup would not open, typed so a UI layer can render the
 * failure in the parent's language. The `error` string on the same result is
 * the English fallback for callers with no string table; this module never
 * imports the locale.
 */
type SealedRestoreFailureReason = 'device-key-missing' | 'device-key-mismatch';

/**
 * W82: the rest of the ways this path refuses a file, typed on the same route
 * W81 opened for the two seal causes above. Every value here is rendered by
 * the dashboard through DASHBOARD_STRINGS; `error` remains the English
 * fallback for callers with no string table, and this module still imports no
 * locale.
 */
export type RestoreFailureReason =
  | SealedRestoreFailureReason
  | 'not-json'
  | 'not-an-object'
  | 'missing-schema-version'
  | 'schema-too-new'
  | 'no-records-array'
  | 'seal-format-too-new'
  | 'passphrase-required'
  | 'passphrase-wrong'
  | 'structure-invalid'
  | 'delivery-pending'
  | 'safety-backup-failed'
  | 'store-read-failed';

/**
 * Why a restore could not put back all of the history the file carried, typed
 * on the same route as the refusals so the sentence can be localized later.
 * `history-not-restored` is the total loss (nothing the file carried is
 * readable afterwards); `history-partly-restored` is the shortfall.
 */
type RestoreHistoryNoteReason =
  | 'history-partly-restored'
  | 'history-not-restored';

/**
 * W82: the key notes this module authors itself, typed for the same reason.
 * Notes that are a crypto module's thrown message carry no reason.
 */
export type RestoreKeyNoteReason =
  | 'key-no-records'
  | 'key-passphrase-needed'
  | 'key-identity-mismatch';

/**
 * The values a localized refusal interpolates. `cause` is an untranslated
 * technical string from another module (chain-integrity, the download path);
 * it is shown verbatim because those modules are outside this route.
 */
export interface RestoreFailureDetail {
  /** Version stamped in the file, for the two "newer than this build" refusals. */
  fileVersion?: number;
  /** Backup schema version this build supports (schema refusal only). */
  supportedVersion?: number;
  /** Queued entries still waiting to be sealed (delivery-pending only). */
  pendingCount?: number;
  cause?: string;
}

export type ParseResult =
  | { ok: true; backup: ForensicBackup }
  | { ok: false; error: string; reason?: RestoreFailureReason; detail?: RestoreFailureDetail };

/**
 * The archived months in a parsed file: a plain object of month key to record
 * array, with any key whose value is not an array dropped rather than carried
 * as a shape the restore would then have to guard against. A file with no
 * usable month at all parses as undefined, which is the same thing the writer
 * emits when it had none.
 */
function parseArchivedMonths(raw: unknown): Record<string, ForensicRecord[]> | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const months: Record<string, ForensicRecord[]> = {};
  let any = false;
  for (const [monthKey, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    months[monthKey] = value as ForensicRecord[];
    any = true;
  }
  return any ? months : undefined;
}

/** The three coverage claims a file may make, or undefined for anything else. */
function parseHistoryCoverage(raw: unknown): ForensicBackup['historyCoverage'] {
  return raw === 'full' || raw === 'active-chain-only' || raw === 'recent-records-only' ? raw : undefined;
}

/**
 * Parse + validate a backup file's contents. Pure. Accepts a JSON string or a
 * pre-parsed object. Rejects a newer schema version (forward-safe: refuse
 * rather than mis-restore) and structurally invalid payloads. `anchors` and
 * `parentFeedback` are optional for tolerance across versions.
 *
 * Everything the writer puts in the file is carried back out here, including
 * the history. It was not: `archives`, `salvage`, `historyCoverage` and
 * `trimmedOlderRecords` were written by buildBackupBlob and dropped by this
 * function, and since every restore path runs through it, `backup.archives`
 * was undefined by the time the restore looked at it and the whole
 * put-the-history-back block never ran (found by the round-trip test in
 * tests/unit/forensics/backup-round-trip.test.ts, which restored two archived
 * months into a fresh profile and read the months back out empty). On a
 * long-running install the months are the large majority of the record, so
 * what was dropped here was most of what the backup exists to protect.
 */
export function parseBackup(raw: string | unknown): ParseResult {
  let obj: unknown;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); }
    catch { return { ok: false, reason: 'not-json', error: 'Not valid JSON.' }; }
  } else {
    obj = raw;
  }
  if (typeof obj !== 'object' || obj === null) {
    return { ok: false, reason: 'not-an-object', error: 'Backup is not an object.' };
  }
  const b = obj as Record<string, unknown>;
  if (typeof b.schemaVersion !== 'number') {
    return { ok: false, reason: 'missing-schema-version', error: 'Missing schemaVersion — not a FeelingWise backup.' };
  }
  if (b.schemaVersion > BACKUP_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: 'schema-too-new',
      detail: { fileVersion: b.schemaVersion, supportedVersion: BACKUP_SCHEMA_VERSION },
      error: `Backup schema v${b.schemaVersion} is newer than this version (v${BACKUP_SCHEMA_VERSION}). Update FeelingWise first.`,
    };
  }
  if (!Array.isArray(b.records)) {
    return { ok: false, reason: 'no-records-array', error: 'Backup has no records array.' };
  }
  return {
    ok: true,
    backup: {
      schemaVersion: b.schemaVersion,
      exportedAt: typeof b.exportedAt === 'string' ? b.exportedAt : '',
      publicKeyJwk: (typeof b.publicKeyJwk === 'object' && b.publicKeyJwk !== null ? b.publicKeyJwk : {}) as JsonWebKey,
      fingerprint: typeof b.fingerprint === 'string' ? b.fingerprint : '',
      records: b.records as ForensicRecord[],
      anchors: Array.isArray(b.anchors) ? (b.anchors as ChainAnchor[]) : [],
      keyGenesis: (typeof b.keyGenesis === 'object' && b.keyGenesis !== null
        ? b.keyGenesis as KeyGenesisRecord
        : undefined),
      archiveAnchors: (typeof b.archiveAnchors === 'object' && b.archiveAnchors !== null
        ? b.archiveAnchors as Record<string, ChainAnchor[]>
        : undefined),
      archives: parseArchivedMonths(b.archives),
      salvage: Array.isArray(b.salvage) ? (b.salvage as ForensicRecord[]) : undefined,
      historyCoverage: parseHistoryCoverage(b.historyCoverage),
      trimmedOlderRecords: typeof b.trimmedOlderRecords === 'number' ? b.trimmedOlderRecords : undefined,
      unreadableArchivedRows: typeof b.unreadableArchivedRows === 'number' ? b.unreadableArchivedRows : undefined,
      parentFeedback: Array.isArray(b.parentFeedback) ? (b.parentFeedback as ParentFeedback[]) : [],
      wrappedPrivateKey: b.wrappedPrivateKey && typeof b.wrappedPrivateKey === 'object'
        ? (b.wrappedPrivateKey as WrappedKey) : undefined,
      keyCreatedAt: typeof b.keyCreatedAt === 'string' ? b.keyCreatedAt : undefined,
    },
  };
}

/** True when a backup carries a passphrase-protected signing key. Pure. */
export function backupHasWrappedKey(backup: ForensicBackup): boolean {
  return !!backup.wrappedPrivateKey;
}

/**
 * Is this record a chain marker (reset marker) rather than real captured
 * evidence? Detected on three independent signals so a marker is recognized
 * even across schema generations: the `kind` discriminator, the
 * `detectionMode` stamp, and the marker's fixed originalText shape
 * (`[reset-marker @ <iso>]`). Pure.
 */
export function isResetMarker(r: ForensicRecord): boolean {
  if (r.kind === 'reset-marker') return true;
  if (r.detectionMode === 'reset-marker') return true;
  return typeof r.originalText === 'string' && r.originalText.startsWith('[reset-marker @');
}

/**
 * Count the REAL evidence records in the active chain: chained
 * (chainPosition >= 0) and not a reset marker. A chain holding only the
 * post-reset marker (or nothing) counts 0 — restoring onto it is safe with
 * no confirmation, because deleting markers loses no evidence. Pure.
 */
export function countRealChainRecords(records: ForensicRecord[]): number {
  return records.filter(
    (r) => typeof r.chainPosition === 'number' && r.chainPosition >= 0 && !isResetMarker(r),
  ).length;
}

/** Decide which anchors are new vs already present (dedup by anchor.id). Pure. */
export function selectNewAnchors(
  existingIds: Set<string>,
  backupAnchors: ChainAnchor[],
): { toAdd: ChainAnchor[]; skipped: number } {
  const toAdd: ChainAnchor[] = [];
  let skipped = 0;
  for (const a of backupAnchors) {
    if (a.id && existingIds.has(a.id)) { skipped++; continue; }
    toAdd.push(a);
  }
  return { toAdd, skipped };
}

// ─── Automatic-backup sealing secret (G1, 2026-08-04) ─────────────────────
//
// The AUTOMATIC daily backup has no parent passphrase to key its envelope:
// the manual export's passphrase is typed per-export and never stored
// (key-wrap.ts contract), and the parent PIN exists only as a SHA-256 hash
// (storage/settings.ts), so nothing derivable is in hand when the alarm
// fires. Rather than invent a passphrase-storage UX, the automatic path
// seals under a random 256-bit secret generated once per install and kept
// in chrome.storage.local — next to the signing key, same threat argument
// as key-wrap.ts: anything that can read this secret out of
// chrome.storage.local can already read the records straight out of
// IndexedDB, so a sealed Downloads file is STRICTLY more protected at rest
// than the plaintext file was. Downloads is the copy that leaves the
// machine (cloud sync) and is world-readable locally; the profile is not.
//
// Accepted trade-off (product fork, decided 2026-08-04, reversible): a
// device-key-sealed automatic backup is only openable by the install that
// wrote it — the secret dies with the profile on uninstall. Post-uninstall
// durability is the MANUAL passphrase-sealed export ("Back up now"), whose
// secret lives in the parent's head. The envelope is versioned and stamps
// its keySource, so a future parent-passphrase flow for the automatic path
// can ship without a format break.

const BACKUP_SEAL_SECRET_KEY = 'fw_backup_seal_key';

/** Read the install's sealing secret; undefined when none was created yet. */
async function getStoredBackupSealSecret(): Promise<string | undefined> {
  try {
    const stored = await chrome.storage.local.get(BACKUP_SEAL_SECRET_KEY);
    const s = stored[BACKUP_SEAL_SECRET_KEY];
    return typeof s === 'string' && s.length > 0 ? s : undefined;
  } catch {
    return undefined;
  }
}

/** Get the install's sealing secret, creating + persisting it on first use. */
const BACKUP_RECOVERY_WRAP_KEY = 'fw_backup_recovery_wrapped_secret';

/**
 * Set (or replace) the recovery passphrase for automatic backups.
 *
 * Stores ONLY the device seal secret encrypted under the passphrase. The
 * passphrase itself is never written anywhere, so an attacker with the profile
 * gains nothing, while the parent gains the ability to open an automatic
 * backup after the install that wrote it is gone.
 *
 * Applies to backups written from this point on. Files already in Downloads
 * were sealed without an escrow copy and cannot be retrofitted: their
 * ciphertext is fixed, and the secret that opens them may already be gone.
 */
export async function setBackupRecoveryPassphrase(passphrase: string): Promise<void> {
  if (!passphrase) throw new Error('A passphrase is required.');
  const secret = await getOrCreateBackupSealSecret();
  const wrapped = await wrapSecretString(secret, passphrase);
  await chrome.storage.local.set({ [BACKUP_RECOVERY_WRAP_KEY]: wrapped });
}

export async function clearBackupRecoveryPassphrase(): Promise<void> {
  try {
    await chrome.storage.local.remove(BACKUP_RECOVERY_WRAP_KEY);
  } catch { /* best-effort */ }
}

/** The escrow copy to embed in a device-key envelope, if the parent set one. */
async function getRecoveryWrappedSecret(): Promise<WrappedKey | undefined> {
  try {
    const stored = await chrome.storage.local.get(BACKUP_RECOVERY_WRAP_KEY);
    return (stored[BACKUP_RECOVERY_WRAP_KEY] as WrappedKey | undefined) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Whether automatic backups currently carry a recovery passphrase. */
export async function hasBackupRecoveryPassphrase(): Promise<boolean> {
  return (await getRecoveryWrappedSecret()) !== undefined;
}

/**
 * Take a seal secret brought in by a restore from a backup folder's key file
 * as this install's own (14 Sep 2026). From then on every automatic copy
 * seals under the key the folder already holds, so the folder keeps
 * restoring on its own after any later reinstall. Stored only; never printed.
 */
export async function adoptBackupSealSecret(secret: string): Promise<void> {
  if (!secret) return;
  await chrome.storage.local.set({ [BACKUP_SEAL_SECRET_KEY]: secret });
}

async function getOrCreateBackupSealSecret(): Promise<string> {
  const existing = await getStoredBackupSealSecret();
  if (existing) return existing;
  const fresh = generateDeviceSealSecret();
  // A failed persist must NOT let a backup be sealed under a secret nobody
  // holds — that file would be unopenable forever. Throw instead; the caller
  // records the failure in backup health.
  await chrome.storage.local.set({ [BACKUP_SEAL_SECRET_KEY]: fresh });
  return fresh;
}

/**
 * Format-sniff + decode one backup payload for restore (G1, 2026-08-04).
 * Accepts, in order:
 *   • legacy plaintext backup JSON (string or object) — parsed as-is, so
 *     every backup written before sealing shipped keeps restoring;
 *   • a sealed envelope (backup-envelope.ts) — opened with the parent's
 *     passphrase or the install's device secret per its stamped keySource,
 *     then the inner JSON goes through the same parseBackup validation.
 * The device secret arrives via an injected getter so this decision tree is
 * unit-testable without chrome.storage.
 */
export async function decodeBackupPayload(
  raw: string | unknown,
  passphrase: string | undefined,
  getDeviceSecret: () => Promise<string | undefined>,
): Promise<ParseResult> {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); }
    catch { return { ok: false, reason: 'not-json', error: 'Not valid JSON.' }; }
  }
  if (!isSealedBackupEnvelope(obj)) return parseBackup(obj);
  if (obj.fwSealedBackup > SEALED_BACKUP_VERSION) {
    // Forward-safe: refuse rather than mis-decrypt (parseBackup's schema gate).
    return {
      ok: false,
      reason: 'seal-format-too-new',
      detail: { fileVersion: obj.fwSealedBackup },
      error: `This backup uses a newer encryption format (v${obj.fwSealedBackup}). Update FeelingWise first.`,
    };
  }
  if (obj.keySource === 'passphrase') {
    if (!passphrase) {
      return { ok: false, reason: 'passphrase-required', error: 'This backup is encrypted. Enter the passphrase it was saved with, then try again.' };
    }
    try {
      return parseBackup(await openBackupJson(obj, passphrase));
    } catch {
      return { ok: false, reason: 'passphrase-wrong', error: 'Wrong passphrase or corrupted backup.' };
    }
  }
  // 'device-key': sealed by an install's automatic backup.
  // W78 (2026-08-18): both failures below used to end the sentence at "cannot
  // be opened here", which reads as "your record is gone". It often is not. A
  // Chrome Web Store copy and a developer build are separate extension ids
  // with separate chrome.storage, so they hold DIFFERENT seal secrets; a
  // parent running both has a second install whose key may open the file. Say
  // that before offering the fallback.
  const OTHER_INSTALL_HINT =
    ' If you run FeelingWise more than once in this browser, a Chrome Web Store copy and a developer build are separate extensions with separate keys, so try this same restore in the other one first.';
  const PASSPHRASE_FALLBACK = ' Otherwise, restore a passphrase-protected backup from "Back up now".';
  const secret = await getDeviceSecret();

  // The escrow door, tried BEFORE the device secret when the parent supplied a
  // passphrase. A file carrying `recoveryWrappedSecret` holds its own seal
  // secret encrypted under a passphrase the parent set, so it opens on any
  // install, including a fresh one after the reinstall that made every other
  // automatic backup in the folder unreadable. Trying it first matters on the
  // machine where both doors could work: the parent typed a passphrase, so
  // that is the door they are asking for.
  if (passphrase && obj.recoveryWrappedSecret) {
    try {
      return parseBackup(await openBackupJsonWithRecoveryPassphrase(obj, passphrase));
    } catch {
      // Fall through to the device secret. On the original install the file
      // still opens without any passphrase, and refusing here would turn one
      // mistyped passphrase into a backup the parent believes is lost.
      if (!secret) {
        return { ok: false, reason: 'passphrase-wrong', error: 'That backup passphrase does not open this backup.' };
      }
    }
  }

  const RECOVERY_HINT = obj.recoveryWrappedSecret
    ? ' This backup also opens with the backup passphrase set for the daily copies: type it in the Backup passphrase box and try again.'
    : '';
  if (!secret) {
    return {
      ok: false,
      reason: 'device-key-missing',
      error: 'This automatic backup can only be opened by the FeelingWise install that saved it, and that install\'s unseal key is not available here.'
        + RECOVERY_HINT + OTHER_INSTALL_HINT + PASSPHRASE_FALLBACK,
    };
  }
  try {
    return parseBackup(await openBackupJson(obj, secret));
  } catch {
    return {
      ok: false,
      reason: 'device-key-mismatch',
      error: 'This automatic backup was sealed by a different FeelingWise install, so this install\'s key does not open it.'
        + RECOVERY_HINT + OTHER_INSTALL_HINT + PASSPHRASE_FALLBACK,
    };
  }
}

// ─── IDB orchestration (live-verified on device) ──────────────────────────

/**
 * Read the whole chain + sidecars into a portable backup object. When
 * `passphrase` is given, the private signing key is encrypted under it and
 * included (Option A) so a restore can continue the SAME chain; without it the
 * backup is records-only and a restore starts a fresh chain segment.
 */
export async function buildBackupBlob(
  passphrase?: string,
  /**
   * Include the month archives and the salvage store.
   *
   * True for every transport that can carry them: the manual "Back up now"
   * (Blob URL) and the wired-folder mirror (File System Access) have no size
   * ceiling. False only for the service worker's Downloads auto-backup, which
   * must inline the whole payload as a data URL and is capped
   * (AUTO_BACKUP_MAX_BYTES). That copy then declares itself
   * 'active-chain-only' rather than passing as a full backup.
   */
  includeHistory = true,
): Promise<ForensicBackup> {
  // A read failure rejects: a zero-record backup written over a chain that
  // could not be read, and then reported as a success, is the worst outcome
  // this function can produce.
  const [records, anchors, feedbackMap, publicKeyJwk, fingerprint] = await Promise.all([
    getRecordsOrThrow(),
    getAnchors(),
    getAllParentFeedback(),
    getPublicKeyJWK(),
    getPublicKeyFingerprint(),
  ]);

  let archives: Record<string, ForensicRecord[]> | undefined;
  let archiveAnchors: Record<string, ChainAnchor[]> | undefined;
  let salvage: ForensicRecord[] | undefined;
  let unreadableArchivedRows = 0;
  if (includeHistory) {
    // Best-effort: an unreadable archive must not block the backup of
    // everything else, but it must also not be silently reported as covered.
    try {
      const months = await loadArchivesOldestFirst();
      if (months.length > 0) {
        archives = {};
        for (const { monthKey, records: monthRecords, anchors: monthAnchors, unreadable } of months) {
          archives[monthKey] = monthRecords;
          if (monthAnchors && monthAnchors.length > 0) {
            archiveAnchors = archiveAnchors ?? {};
            archiveAnchors[monthKey] = monthAnchors;
          }
          // A row that did not decode cannot be carried, so it is counted in the file instead.
          if (unreadable && unreadable.length > 0) {
            unreadableArchivedRows += unreadable.length;
            console.warn(`[FeelingWise] backup: ${unreadable.length} archived row(s) in ${monthKey} did not decode and are not in this copy`);
          }
        }
      }
    } catch (err) {
      console.warn('[FeelingWise] backup: archives unreadable, this copy covers the active chain only', err);
      includeHistory = false;
    }
    try {
      const recovered = await readSalvagedRecords();
      if (recovered.length > 0) salvage = recovered;
    } catch { /* salvage is additive; its absence does not change coverage */ }
  }
  let wrappedPrivateKey: WrappedKey | undefined;
  let keyCreatedAt: string | undefined;
  if (passphrase) {
    wrappedPrivateKey = await exportWrappedPrivateKey(passphrase);
    keyCreatedAt = (await getSigningKeyCreatedAt()) ?? undefined;
  }
  // Carried whether or not the private key is: the genesis stamps are about
  // the PUBLIC key, they prove nothing on their own, and a restore that keeps
  // the identity needs them to keep the key's date too.
  const keyGenesis = (await getKeyGenesis()) ?? undefined;
  return assembleBackup({
    exportedAt: new Date().toISOString(),
    publicKeyJwk,
    fingerprint,
    records,
    anchors,
    parentFeedback: Array.from(feedbackMap.values()),
    wrappedPrivateKey,
    keyCreatedAt,
    keyGenesis,
    archives,
    archiveAnchors,
    salvage,
    historyCoverage: includeHistory ? 'full' : 'active-chain-only',
    ...(includeHistory && unreadableArchivedRows > 0 ? { unreadableArchivedRows } : {}),
  });
}

export interface RestoreResult {
  ok: boolean;
  error?: string;
  /**
   * Typed refusal cause; lets the dashboard localize what `error` says in
   * English. W81 opened this for the two seal failures, W82 extended it to
   * the whole path; `detail` carries the values the sentence interpolates.
   */
  reason?: RestoreFailureReason;
  detail?: RestoreFailureDetail;
  /**
   * What the WRITE step was handed and wrote. This is not a statement that
   * the entries can be read back, and it was being read as one: a restore
   * whose write landed one row truncated reported all four here while three
   * untouched records had become unreadable alongside the fourth (M212, found
   * by the fault-injecting storage double, 2026-09-18). The honest pair sits
   * directly below; this field keeps its old meaning so that the number the
   * screen prints for "entries replaced" does not change under it.
   */
  recordsAdded: number;
  recordsSkipped: number;
  /**
   * Active-chain entries that were read back and DECODED after the write. The
   * companion to `recordsAdded`, on the same footing as `archivedRestored`
   * beside `archivedExpected`: written is one fact and readable is another,
   * and before these two existed nothing carried the second.
   */
  recordsReadable?: number;
  /**
   * Active-chain entries that are present in the store after the write and
   * could not be decoded on this install. A third state, held apart from both
   * of the others on purpose: these are not absent (they are there, and
   * `recordsAdded` counts them) and they are not returned (they are not in
   * `recordsReadable`). Zero on a clean restore. Left undefined only when the
   * read threw outright, which is the different, louder failure `chainError`
   * then describes.
   */
  recordsUnreadable?: number;
  /** Archived-history records the file carried, whether or not they landed. */
  archivedExpected?: number;
  /** Archived-history records read back out of their month databases after the write. */
  archivedRestored?: number;
  /** Recovered prior-generation records the file carried. */
  salvageExpected?: number;
  /** Recovered prior-generation records read back out of the salvage store after the write. */
  salvageRestored?: number;
  /**
   * True when everything the FILE carried was written back and read back
   * again. A file that carried no history has nothing to put back, so this is
   * true with `archivedExpected` 0: what such a file did NOT cover is stated
   * by its own `historyCoverage`, carried below, not by this field.
   */
  historyRestored?: boolean;
  /** The coverage the file claimed for itself, carried so a caller never infers it. */
  fileHistoryCoverage?: 'full' | 'active-chain-only' | 'recent-records-only';
  /** Plain-English statement of what of the history did not land. */
  historyNote?: string;
  /** Typed cause for `historyNote`, on the same route as the other typed causes. */
  historyNoteReason?: RestoreHistoryNoteReason;
  anchorsAdded: number;
  feedbackRestored: number;
  /**
   * Whether the restored RECORD came back whole: the active chain re-verified
   * after the import AND everything the file carried of the history is
   * readable again. A record whose archived months did not land is not whole,
   * whatever the active chain says about itself, and `chainError` then names
   * both halves. This field is the one note the restore screen renders, which
   * is why the history travels on it (`historyNote` carries the history half
   * on its own for a caller that wants it separately).
   */
  chainVerified: boolean;
  /** Human-readable reason if the record did not come back whole post-restore. */
  chainError?: string;
  /** Whether the signing key was restored (Option A continuity). */
  keyRestored: boolean;
  /** Plain-English note about the key (e.g. passphrase needed / wrong passphrase). */
  keyNote?: string;
  /**
   * W82: typed cause for the three key notes this module authors, so the
   * dashboard renders them in the parent's language. Left undefined when
   * `keyNote` carries an error message thrown by the crypto modules, which
   * are outside this route and stay English.
   */
  keyNoteReason?: RestoreKeyNoteReason;
  /**
   * True when the restore was held back because the current record holds real
   * evidence entries that a restore would REPLACE. Nothing was written; the
   * caller should confirm and re-call with `force: true`. `confirmMessage`
   * carries the plain-English warning; `existingRealCount` lets the UI build
   * a localized message.
   */
  needsConfirm?: boolean;
  confirmMessage?: string;
  /**
   * On the confirmation pause, the real (non-marker) chain entries in the
   * record that a restore would replace. On a finished restore, the ones it
   * did replace: zero when the backup had no entries, because then nothing
   * was swapped and the record's entries are still live.
   */
  existingRealCount?: number;
  /** True when the confirmed replace saved the prior records to Downloads first. */
  safetyBackupSaved?: boolean;
}

/**
 * Name one row that did not decode, for the single note line the restore
 * screen renders.
 *
 * It names the row rather than counting it because "one entry could not be
 * read" and "entry r2, at chain position 2, could not be read" are different
 * facts to the person holding the record: the second can be looked for in the
 * backup file, asked about, or re-restored, and the first can only be worried
 * about. The identifiers come off the envelope's own index fields, which
 * survive a damaged payload (store.ts UnreadableStoredRecord). A row carrying
 * neither is still reported, as a row with no readable identifier: an
 * unnameable unreadable entry is the one case where silence would be easiest
 * and is exactly the case that must not go quiet.
 */
function describeUnreadableRow(row: UnreadableStoredRecord): string {
  const parts: string[] = [];
  if (row.id) parts.push(`entry ${row.id}`);
  if (row.chainPosition !== undefined) parts.push(`chain position ${row.chainPosition}`);
  if (parts.length === 0) parts.push('an entry with no readable identifier');
  return `${parts.join(', ')}: ${row.reason}`;
}

/**
 * Decide whether a restore should pause for confirmation: true when the
 * current record holds REAL evidence entries (markers don't count) AND the
 * backup carries records — the restore REPLACES the current entries, so the
 * parent must approve. Pure.
 */
export function restoreNeedsConfirmation(existingRealCount: number, backupRecordCount: number): boolean {
  return existingRealCount > 0 && backupRecordCount > 0;
}

/**
 * Restore a backup. REPLACE semantics — never interleave (interleaving wrote
 * two records at the same chainPosition and broke verification: the
 * reset→restore trap, live-reproduced 2026-06-11):
 *
 *   • Current chain empty or markers-only (the post-reset state): markers are
 *     deleted and the backup's records land VERBATIM at their original
 *     positions/signatures — the restored chain verifies exactly as it did
 *     when backed up. No confirmation needed; markers carry no evidence.
 *   • Current chain has real records: pause for confirmation (needsConfirm)
 *     unless `force`. The confirmed path first saves the CURRENT records to
 *     an automatic safety-backup file in Downloads, then replaces them with
 *     the backup's set.
 *
 * The restore is STAGED: the incoming set is structurally verified in memory
 * (positions, links, content hashes — `verifyChainStructure`) BEFORE anything
 * is written; a corrupt backup returns an error with the current records
 * untouched. The IDB swap itself is a single atomic transaction
 * (`replaceBackupStateUnderChainLock`), so a failed write also leaves the
 * prior state intact.
 *
 * If the backup carries a passphrase-protected key and `passphrase` is given,
 * the signing key is restored first so the chain continues under the original
 * identity. After writing, re-verifies chain integrity for reporting.
 */
async function restoreFromBackupUnderChainLock(raw: string | unknown, passphrase?: string, force = false, sealSecret?: string): Promise<RestoreResult> {
  const empty = { recordsAdded: 0, recordsSkipped: 0, anchorsAdded: 0, feedbackRestored: 0, chainVerified: false, keyRestored: false };
  // G1 (2026-08-04): sniff-and-open sealed envelopes; legacy plaintext
  // backups take the parseBackup path unchanged. The same passphrase later
  // unwraps the inner signing key (Option A) when present. A key file from a
  // backup folder (14 Sep 2026) is the secret tried first: it is the one the
  // folder's copies were sealed under, whatever this install holds.
  const parsed = await decodeBackupPayload(raw, passphrase, async () => sealSecret || (await getStoredBackupSealSecret()));
  if (!parsed.ok) return { ok: false, error: parsed.error, reason: parsed.reason, detail: parsed.detail, ...empty };
  const { backup } = parsed;

  // Stage 1 — verify the incoming set in memory BEFORE touching anything.
  // Rejects internally-broken backups (position collisions, broken links,
  // tampered content) while tolerating earlier-key signatures.
  if (backup.records.length > 0) {
    const structure = await verifyChainStructure(backup.records);
    if (!structure.valid) {
      return {
        ok: false,
        reason: 'structure-invalid',
        detail: { cause: structure.reason ?? 'structure check failed' },
        error: `The backup file did not verify (${structure.reason ?? 'structure check failed'}). Nothing was changed.`,
        ...empty,
      };
    }
  }

  // Replacing the chain while an automatic observation is queued would splice
  // pre-restore evidence into the imported chain after this lock releases.
  // Enqueue shares this lock, so the empty check is race-free.
  const deliveryStatus = await getForensicDeliveryStatus();
  if (deliveryStatus.pendingCount > 0) {
    return {
      ok: false,
      reason: 'delivery-pending',
      detail: { pendingCount: deliveryStatus.pendingCount },
      error: `Restore is waiting for ${deliveryStatus.pendingCount} queued record ${deliveryStatus.pendingCount === 1 ? 'entry' : 'entries'} to be sealed. Nothing was changed.`,
      ...empty,
    };
  }

  // Stage 2 — confirmation gate. Replacing real evidence needs the parent's
  // explicit OK; replacing markers (the post-reset state) does not.
  // A failed read is not an empty chain: with [] here the confirmation gate
  // and the safety copy would both be skipped and the store cleared.
  let existing: ForensicRecord[];
  try {
    existing = await getRecordsOrThrow();
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: 'store-read-failed',
      detail: { cause },
      error: `The current records could not be read (${cause}). Restore was cancelled; nothing was changed.`,
      ...empty,
    };
  }
  const existingRealCount = countRealChainRecords(existing);
  if (!force && restoreNeedsConfirmation(existingRealCount, backup.records.length)) {
    return {
      ok: false,
      needsConfirm: true,
      existingRealCount,
      confirmMessage: (existingRealCount === 1
        ? 'Restoring puts the backup\'s entries in place of the entry in the record now. '
          + 'It is not deleted: it moves into the record\'s monthly archive and stays in every export of the whole record, and a safety backup of it is saved to Downloads first. '
          + 'If it is not in the backup, those exports will read "PARTIALLY VERIFIED" once anything new is recorded, '
        : `Restoring puts the backup's entries in place of the ${existingRealCount} entries in the record now. `
          + 'They are not deleted: they move into the record\'s monthly archive and stay in every export of the whole record, and a safety backup of them is saved to Downloads first. '
          + 'If some of them are not in the backup, those exports will read "PARTIALLY VERIFIED" once anything new is recorded, ')
        + 'because the file then shows the record with two endings and cannot tell whether a restore or an edit made them. Continue?',
      ...empty,
    };
  }

  // Stage 3 — save the outgoing evidence while its original signing identity
  // is still active. A failed download aborts before key or record mutation.
  let safetyBackupSaved = false;
  if (backup.records.length > 0 && existingRealCount > 0) {
    const safety = await writeSafetyBackup();
    if (!safety.ok) {
      return {
        ok: false,
        reason: 'safety-backup-failed',
        detail: { cause: safety.reason },
        error: `Could not save a safety backup of the current entries (${safety.reason}). Restore was cancelled; nothing was changed.`,
        ...empty,
      };
    }
    safetyBackupSaved = true;
  }

  // The backup always carries its public key. Remember it before the private
  // key branch, so a restore without the passphrase still leaves the records
  // checkable by signature in the next export instead of reading as an
  // unverifiable prior key (evidence-gap quick win, 2026-09-06).
  try {
    await rememberPublicKeys([backup.publicKeyJwk]);
  } catch (err) {
    console.warn('[FeelingWise] restore: could not remember the backup public key:', err);
  }
  // Stage 4 — decrypt and validate the incoming key without persisting it.
  // A wrong passphrase does not abort the records restore.
  let keyRestored = false;
  let keyNote: string | undefined;
  let keyNoteReason: RestoreKeyNoteReason | undefined;
  let stagedKey: StagedSigningKeyRestore | undefined;
  if (backup.wrappedPrivateKey && backup.records.length === 0) {
    keyNoteReason = 'key-no-records';
    keyNote = 'The backup has no record entries, so its signing key was not imported.';
  } else if (backup.wrappedPrivateKey) {
    if (!passphrase) {
      keyNoteReason = 'key-passphrase-needed';
      keyNote = 'This backup includes a passphrase-protected key. Enter the passphrase to restore it and keep one continuous chain; without it, records are restored but a new chain segment starts.';
    } else {
      try {
        const privateJwk = await unwrapPrivateKeyJwk(backup.wrappedPrivateKey, passphrase);
        stagedKey = await prepareSigningKeyRestore(privateJwk, backup.keyCreatedAt);
        const publicKeyMatches =
          stagedKey.publicJwk.kty === backup.publicKeyJwk.kty
          && stagedKey.publicJwk.crv === backup.publicKeyJwk.crv
          && stagedKey.publicJwk.x === backup.publicKeyJwk.x
          && stagedKey.publicJwk.y === backup.publicKeyJwk.y
          && stagedKey.fingerprint === backup.fingerprint;
        if (!publicKeyMatches) {
          stagedKey = undefined;
          // Typed before the throw so the catch below, which also handles
          // untyped crypto-module errors, still reports the English message.
          keyNoteReason = 'key-identity-mismatch';
          throw new Error('The wrapped signing key does not match this backup\'s public identity.');
        }
      } catch (err) {
        keyNote = err instanceof Error ? err.message : String(err);
      }
    }
  }

  // Stage 5 — replace records while the outgoing identity is still active.
  // A failed atomic swap cannot change the key.
  let recordsAdded = 0;
  let anchorsAdded = 0;
  let feedbackRestored = 0;
  let realEntriesTakenOff = 0;
  if (backup.records.length > 0) {
    const replaced = await replaceBackupStateUnderChainLock(
      backup.records,
      backup.anchors,
      backup.parentFeedback,
      true,
    );
    recordsAdded = replaced.recordsAdded;
    anchorsAdded = replaced.anchorsAdded;
    feedbackRestored = replaced.feedbackRestored;
    realEntriesTakenOff = existingRealCount;
  }

  // Stage 5b — put the history back where it belongs.
  //
  // `backup.records` is the ACTIVE chain. Restoring only that would recover
  // the newest 10000 records and drop every archived one on the floor, which
  // is the same loss the backup exists to prevent, arriving through the
  // recovery path instead. Archived records go back to their month databases
  // and recovered ones to the salvage store, so the export sees the whole
  // record again rather than the last slice of it.
  //
  // Additive and best-effort by design: the active chain is already restored
  // at this point, and failing the whole restore because one archived month
  // could not be written would leave the user worse off than the partial
  // recovery they can see and retry. Best-effort is not silent, though: what
  // did not land is counted and said (restoreCarriedHistory).
  const history = await restoreCarriedHistory(backup);

  // Only a successful record swap may replace the signing identity. Storage
  // rejection leaves the outgoing identity in place and the restored records
  // remain honestly classified as earlier-key evidence.
  if (stagedKey) {
    try {
      // Remember the OUTGOING key before it is replaced. The restore already
      // remembers the incoming one, and nothing remembered the one being
      // dropped — so anything on this device still signed under it (archived
      // months, salvaged records, a record that arrived late through the
      // outbox) had no key left to check against and would read as an
      // unverifiable prior key in the next export. Storing a PUBLIC key costs
      // nothing and proves nothing on its own; it is what lets a recipient
      // check a signature that was already made.
      try {
        await rememberPublicKeys([await getPublicKeyJWK()]);
      } catch (outgoingErr) {
        console.warn('[FeelingWise] restore: could not remember the outgoing public key:', outgoingErr);
      }
      await commitSigningKeyRestore(stagedKey);
      keyRestored = true;
      // The key came back; its date has to come back with it. Without this the
      // next anchor alarm finds no genesis record for this digest and takes a
      // fresh stamp with today's date, so a reinstall would replace the
      // evidence that the key predates the dispute with evidence that it does
      // not. restoreKeyGenesis refuses a record whose digest is not this key's.
      try {
        await restoreKeyGenesis(backup.keyGenesis);
      } catch (genesisErr) {
        console.warn('[FeelingWise] restore: signing key genesis not carried over', genesisErr);
      }
    } catch (err) {
      keyNote = err instanceof Error ? err.message : String(err);
    }
  }

  // The restored chain's newest record and the key now in use can differ: a records-only restore
  // keeps this install's key over records another key signed. That change is stated on the chain
  // before the next record is signed, as the worker does at start. Nothing to say when they agree.
  if (backup.records.length > 0) {
    const continuity = await stateKeyReplacementUnderChainLock(keyRestored ? 'restored-from-backup' : 'records-restored');
    if (continuity.status === 'failed') console.warn('[FeelingWise] restore: key change not stated:', continuity.reason);
  }

  // Re-verify for reporting. With replace semantics + the staged structural
  // check this should always pass; key-related notes (e.g. records signed by
  // an earlier key on a records-only restore) surface as prior-key, which is
  // valid. A failure here is surfaced, never silently swallowed.
  let chainVerified = false;
  let chainError: string | undefined;
  let recordsReadable: number | undefined;
  let recordsUnreadable: number | undefined;
  try {
    // getRecordsDetailed, never getRecords, and no longer getRecordsOrThrow.
    //
    // Not getRecords: it answers an unreadable store with an empty list by
    // design, setting `lastRecordReadFailed()` so a caller can tell the two
    // apart, and this caller never asked. An empty list then walks clean,
    // because a chain of no records has nothing wrong with it, so a restore
    // whose result could not be read back reported that every record came back
    // AND that the chain verified, while the dashboard showed zero. That is
    // the same shape as M186 one path further in: unreadable read as empty.
    //
    // Not getRecordsOrThrow either, which is where M212 lived. It is correct
    // for the callers that must refuse to proceed over a damaged read, and its
    // signature is unchanged for them. It is wrong HERE, because this is the
    // one report a parent reads after a reinstall: one row landing truncated
    // made it throw for the whole restored chain, so three untouched records
    // stopped coming back too, and `recordsAdded` still said four. The
    // all-or-nothing reader could only say "the chain" or "nothing"; this
    // report has to be able to say which rows came back and which one did not.
    //
    // Both found by a fault-injecting storage double on 2026-09-18, which is
    // the first thing in this tree able to make a store lie.
    const read = await getRecordsDetailed();
    recordsReadable = read.records.length;
    recordsUnreadable = read.unreadable.length;
    // The chain is walked over what came back READABLE. A row that did not
    // decode leaves a real hole in the links, and the walk reporting that hole
    // is honest; what would not be honest is walking a list the hole was
    // quietly closed over, which would read as a shorter chain that verifies.
    const result = await verifyChainIntegrity(read.records);
    chainVerified = result.valid && read.complete;
    const notes: string[] = [];
    if (!read.complete) {
      // The unreadable note leads, because it is the cause: the chain break
      // the walk reports below is downstream of the row that did not decode,
      // and a reader given the break first chases the wrong record.
      const total = read.records.length + read.unreadable.length;
      const named = read.unreadable.map(describeUnreadableRow).join('; ');
      notes.push(
        `${read.unreadable.length} of ${total} ${read.unreadable.length === 1 ? 'entry' : 'entries'} in the restored `
        + `record could not be read back on this install (${named}); ${read.records.length} came back readable. `
        + 'Those entries are still stored and are not lost: this install cannot decode them today.',
      );
    }
    if (!result.valid) notes.push(result.reason ?? 'chain did not verify');
    if (notes.length > 0) chainError = notes.join('; ');
  } catch (err) {
    // The store itself would not answer: not one row that failed to decode
    // (getRecordsDetailed reports those above, by name, without throwing) but
    // a database that could not be opened or enumerated at all. Nothing can be
    // said about which entries came back, so nothing is: `recordsReadable` and
    // `recordsUnreadable` stay undefined rather than reading as zero, which
    // would be the same collapse of "unknown" into "none" this whole path was
    // corrected for.
    //
    // Never blank. A record that landed unreadable used to make this read
    // throw a DecompressionStream TypeError whose `message` is the empty
    // string, and this field is the whole of what the restore screen renders
    // as its explanation: the parent was shown nothing at the one moment they
    // most need to be told something (found by a fault-injecting storage
    // double, 2026-09-18). That case no longer arrives here, and the guard
    // stays because any other error can carry an empty message too. The
    // error's own name is used when it has no message, and the sentence says
    // what the failure means rather than only naming it.
    const raw = err instanceof Error ? (err.message || err.name) : String(err);
    chainError = raw
      ? `the restored record could not be read back (${raw})`
      : 'the restored record could not be read back';
  }

  // A restore that lost the history is not reported as a whole one.
  //
  // The screen renders exactly one note line over a successful restore (the
  // chain note in the Export tab), and `archivedRestored` had no consumer
  // anywhere in src/ when this was found, so a restore that wrote back none
  // of the months printed the same sentence as one that wrote back all of
  // them. The record that comes out of such a restore is the active chain
  // with its months missing: it is not intact, it is not reported as intact,
  // and the note says which months and how many records.
  if (!history.historyRestored) {
    chainVerified = false;
    chainError = chainError ? `${chainError}; ${history.note}` : history.note;
  }

  return {
    ok: true,
    recordsAdded,
    recordsReadable,
    recordsUnreadable,
    recordsSkipped: 0,
    // The screen that reports the restore says how many entries it replaced,
    // and after the swap that number is gone from the store. A backup with no
    // entries swaps nothing, so it replaced none and the record stays live.
    existingRealCount: realEntriesTakenOff,
    anchorsAdded,
    feedbackRestored,
    chainVerified,
    chainError,
    keyRestored,
    keyNote,
    keyNoteReason,
    safetyBackupSaved,
    archivedExpected: history.archivedExpected,
    archivedRestored: history.archivedRestored,
    salvageExpected: history.salvageExpected,
    salvageRestored: history.salvageRestored,
    historyRestored: history.historyRestored,
    fileHistoryCoverage: backup.historyCoverage,
    historyNote: history.note,
    historyNoteReason: history.noteReason,
  };
}

interface CarriedHistoryOutcome {
  archivedExpected: number;
  archivedRestored: number;
  salvageExpected: number;
  salvageRestored: number;
  historyRestored: boolean;
  note?: string;
  noteReason?: RestoreHistoryNoteReason;
}

/**
 * Write the archived months and the salvaged records a backup carried back
 * into their own databases, then READ THEM BACK and count what is actually
 * there.
 *
 * The read-back is the point. "The write resolved" and "the record is in the
 * month database" are different claims, and the second one is what the person
 * reinstalling after a disk problem is relying on; the eviction writer makes
 * the same distinction before it authorizes a delete (archive-writer.ts). So
 * every month this call touched is re-read and the ids the file carried are
 * looked for by hand: whatever cannot be found is reported missing, never
 * assumed written.
 *
 * Two details of the write path make the read-back read MORE months than the
 * file names. archiveEvictedRecords buckets by each record's own timestamp,
 * so a record filed under one month key can legitimately land in another
 * (and a record with an unparseable timestamp lands in the epoch month). The
 * months the writer reports are therefore added to the set that gets re-read,
 * so a record that landed somewhere honest is not counted as lost.
 *
 * Salvage goes through the same verifying import as any other salvaged file:
 * a backup file is no more trusted than an export file, and both sit on disk
 * where they can be edited. A record the import refuses is one that could not
 * prove it was unaltered, and it is counted as not restored, which is what it
 * is.
 */
async function restoreCarriedHistory(backup: ForensicBackup): Promise<CarriedHistoryOutcome> {
  const expectedIdsByMonth = new Map<string, string[]>();
  for (const [monthKey, monthRecords] of Object.entries(backup.archives ?? {})) {
    if (!Array.isArray(monthRecords) || monthRecords.length === 0) continue;
    expectedIdsByMonth.set(monthKey, monthRecords.map((record) => record.id));
  }
  let archivedExpected = 0;
  for (const ids of expectedIdsByMonth.values()) archivedExpected += ids.length;

  const monthsToReRead = new Set<string>(expectedIdsByMonth.keys());
  for (const monthKey of expectedIdsByMonth.keys()) {
    const monthRecords = backup.archives?.[monthKey] ?? [];
    try {
      const outcome = await archiveEvictedRecords(
        monthRecords.map((record, i) => ({ key: `restore-${monthKey}-${i}`, entry: record, record })),
      );
      if (outcome.ok) for (const written of outcome.months) monthsToReRead.add(written);
      else console.warn(`[FeelingWise] restore: archived month ${monthKey} could not be written (${outcome.reason})`);
    } catch (err) {
      console.warn(`[FeelingWise] restore: archived month ${monthKey} failed`, err);
    }
  }

  const presentIds = new Set<string>();
  for (const monthKey of monthsToReRead) {
    try {
      // Only rows that decode count as restored. A row already in the month
      // that will not decode must not make the rest of the month read as missing.
      for (const record of (await readArchiveRecordsDetailed(monthKey)).records) presentIds.add(record.id);
    } catch (err) {
      // An unreadable month contributes nothing, which lands its records in
      // the missing count. Reporting them as restored on the strength of a
      // write we cannot read back is the failure this whole function exists
      // to make impossible.
      console.warn(`[FeelingWise] restore: archived month ${monthKey} could not be read back`, err);
    }
  }

  let archivedRestored = 0;
  const shortMonths: string[] = [];
  for (const [monthKey, ids] of expectedIdsByMonth) {
    const landed = ids.filter((id) => presentIds.has(id)).length;
    archivedRestored += landed;
    if (landed < ids.length) shortMonths.push(monthKey);
  }

  const salvageExpected = backup.salvage?.length ?? 0;
  let salvageRestored = 0;
  if (backup.salvage && salvageExpected > 0) {
    try {
      await importSalvagedRecords(backup.salvage);
      const held = new Set((await readSalvagedRecords()).map((record) => record.id));
      salvageRestored = backup.salvage.filter((record) => held.has(record.id)).length;
    } catch (err) {
      console.warn('[FeelingWise] restore: salvaged records could not be written', err);
    }
  }

  const archivedMissing = archivedExpected - archivedRestored;
  const salvageMissing = salvageExpected - salvageRestored;
  if (archivedMissing <= 0 && salvageMissing <= 0) {
    return {
      archivedExpected, archivedRestored, salvageExpected, salvageRestored,
      historyRestored: true,
    };
  }

  const parts: string[] = [];
  if (archivedMissing > 0) {
    parts.push(
      `${archivedMissing} of ${archivedExpected} archived record${archivedExpected === 1 ? '' : 's'} in this backup `
      + `${archivedMissing === 1 ? 'is' : 'are'} not readable in the month record afterwards`
      + (shortMonths.length > 0 ? ` (${shortMonths.sort().join(', ')})` : ''),
    );
  }
  if (salvageMissing > 0) {
    parts.push(
      `${salvageMissing} of ${salvageExpected} recovered record${salvageExpected === 1 ? '' : 's'} `
      + `${salvageMissing === 1 ? 'is' : 'are'} not in the salvage store afterwards`,
    );
  }
  return {
    archivedExpected, archivedRestored, salvageExpected, salvageRestored,
    historyRestored: false,
    noteReason: archivedRestored === 0 && salvageRestored === 0 ? 'history-not-restored' : 'history-partly-restored',
    note: `${parts.join(', and ')}. The active chain was restored. Keep the backup file and run the restore again.`,
  };
}

/** Serialize the complete staged restore, including optional key replacement. */
export async function restoreFromBackup(
  raw: string | unknown,
  passphrase?: string,
  force = false,
  /** A seal secret from a backup folder's key file; tried before this install's own. */
  sealSecret?: string,
): Promise<RestoreResult> {
  return sharedChainWriteLock(() => restoreFromBackupUnderChainLock(raw, passphrase, force, sealSecret));
}

/**
 * Save the CURRENT record set to a Downloads file before a destructive
 * replace. Uses a Blob URL when available (dashboard page) and falls back to
 * a data URL. Returns ok:false instead of throwing — the caller aborts the
 * restore when the safety copy could not be written.
 *
 * G1 (2026-08-04): sealed under the install's device secret, never plaintext.
 * The safety copy exists to be re-restored on THIS install moments later if
 * the confirmed replace goes wrong, so device-key sealing keeps it usable
 * exactly where it is used while keeping verbatim history out of Downloads.
 */
async function writeSafetyBackup(): Promise<{ ok: boolean; reason?: string }> {
  try {
    if (typeof chrome === 'undefined' || !chrome.downloads?.download) {
      return { ok: false, reason: 'downloads permission unavailable' };
    }
    const backup = await buildBackupBlob();
    const sealSecret = await getOrCreateBackupSealSecret();
    const json = JSON.stringify(await sealBackupJson(JSON.stringify(backup), sealSecret, 'device-key', await getRecoveryWrappedSecret()));
    const filename = `FeelingWise/feelingwise-pre-restore-${new Date().toISOString().slice(0, 19).replace(/[:]/g, '-')}.json`;
    const url = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
      ? URL.createObjectURL(new Blob([json], { type: 'application/json' }))
      : `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
    const id = await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
    // "Saved" means the file is on disk, not that Chrome accepted the request:
    // the destructive replace that follows relies on this copy, so anything
    // short of 'complete' (interrupted, or still unconfirmed after the wait)
    // cancels the restore with the current records untouched.
    const state = await waitForDownloadState(id, SAFETY_BACKUP_POLLS);
    return state === 'complete' ? { ok: true } : { ok: false, reason: `safety copy ${state}` };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * What happened to a manual backup file, as far as the browser will say.
 *
 * 'unconfirmed' is its own answer and not a failure: the write was accepted and
 * had not settled inside the wait. It is reported as an attempt, never as a
 * success, because the whole point of the warning it feeds is that it must not
 * show green to somebody who has no copy.
 */
export type ManualBackupWrite = 'complete' | 'interrupted' | 'unconfirmed' | 'no-downloads-api';

/**
 * Write one manual backup and wait to find out whether it is on disk.
 *
 * The dashboard's "Back up now" used to build an object URL, click a hidden
 * anchor, and call `recordManualBackupSuccess` on the next line. A click is a
 * request, not a result: with Chrome set to ask where to save each file, a
 * parent who presses Escape on that dialog was recorded as having taken a
 * backup, and `lastPassphraseBackupAt` is a HIGH-WATER MARK that is never
 * cleared, so the `install-locked-only` warning that exists to stop showing
 * green to somebody with no reinstall-proof copy was suppressed permanently by
 * one cancelled dialog. Found 2026-09-19. Both other writers in this file had
 * already learned this: see the safety copy above and `downloadQuietly` below,
 * whose own comment records the same mistake costing pruned backups.
 *
 * `saveAs: true` keeps the parent's choice of folder, which the anchor gave
 * them through their own browser setting, and it is also what makes a cancel
 * legible: Chrome rejects the call with "User canceled", where an anchor click
 * reports nothing at all.
 */
export async function saveManualBackupFile(json: string, filename: string): Promise<ManualBackupWrite> {
  if (typeof chrome === 'undefined' || !chrome.downloads?.download) return 'no-downloads-api';
  const url = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
    ? URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    : `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
  try {
    const id = await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: true });
    return await waitForDownloadState(id, SAFETY_BACKUP_POLLS);
  } catch {
    // A cancelled Save-As lands here, and so does a refused write. Neither is a
    // backup, and neither may be recorded as one.
    return 'interrupted';
  } finally {
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function' && url.startsWith('blob:')) {
      // Revoked after the download has settled, not straight after the call:
      // revoking an object URL while Chrome is still reading it interrupts the
      // write, which is the failure this function exists to detect.
      try { URL.revokeObjectURL(url); } catch { /* already gone */ }
    }
  }
}

/** 250 ms polls; the safety copy can be a large Blob, so it waits longer than a data-URL write. */
const SAFETY_BACKUP_POLLS = 120;

/**
 * Poll one download until it settles or the bound runs out. Shared by the
 * quiet automatic write and the pre-restore safety copy so both answer the
 * same question the same way: is the file actually on disk.
 */
async function waitForDownloadState(
  id: number,
  polls: number,
): Promise<'complete' | 'interrupted' | 'unconfirmed'> {
  for (let i = 0; i < polls; i++) {
    const [item] = await chrome.downloads.search({ id });
    if (!item) return 'unconfirmed';
    if (item.state === 'complete') return 'complete';
    if (item.state === 'interrupted') return 'interrupted';
    await new Promise(r => setTimeout(r, 250));
  }
  return 'unconfirmed';
}

/**
 * Compact record count for a folder name: 13459 becomes "13k".
 *
 * The count is in the folder name so the parent can see at a glance which
 * snapshot is the substantial one, without opening a single file.
 */
export function compactCount(n: number): string {
  return n < 1000 ? String(n) : `${Math.round(n / 1000)}k`;
}

/**
 * One folder per backup day, named by date and size (a real request,
 * 2026-08-02: a clear backup structure by date, not all backups in one place).
 *
 * ISO date rather than the 8-2-26 example given, deliberately: folders sort
 * chronologically in every file manager, which is the whole point of dating
 * them. The date reads the same either way.
 */
export function backupFolder(now: Date, recordCount: number): string {
  return `FeelingWise/${now.toISOString().slice(0, 10)}-${compactCount(recordCount)}`;
}

/** Full path for one automatic backup. Time in the name, so nothing overwrites. */
export function autoBackupPath(now: Date, recordCount: number): string {
  const hhmm = now.toISOString().slice(11, 16).replace(':', '');
  return `${backupFolder(now, recordCount)}/feelingwise-backup-${hhmm}.json`;
}

/**
 * Head hash of the last successfully backed-up chain.
 *
 * A backup that writes the same bytes again is pure noise: it costs a download
 * the parent has to watch appear, and it protects nothing new. Skipping an
 * unchanged chain is what makes the automatic backup stop being something the
 * user notices.
 */
const LAST_BACKUP_HEAD_KEY = 'fw_backup_last_head';
// Q36: the folder mirror keeps its OWN dedup head so wiring a folder after
// months of Downloads backups still writes the first folder copy.
const LAST_FOLDER_MIRROR_HEAD_KEY = 'fw_backup_folder_last_head';
// When the wired folder last received a copy. The Downloads auto-backup uses
// it to stand down while a better copy is being written elsewhere.
const LAST_FOLDER_MIRROR_AT_KEY = 'fw_backup_folder_last_at';
/**
 * How long a wired-folder copy suppresses the Downloads auto-backup.
 *
 * The folder mirror runs in the DASHBOARD (the directory picker and its
 * permission live in page context), so it only fires when the parent opens the
 * app. The Downloads copy runs on a service-worker alarm and needs no one to
 * be present. Skipping Downloads permanently just because a folder is wired
 * would therefore silently end automatic backups for anyone who stops opening
 * the dashboard. Two days is long enough to stop the daily churn for an active
 * user and short enough that an abandoned dashboard falls back on its own.
 */
const FOLDER_MIRROR_SUPPRESSES_DOWNLOADS_MS = 48 * 60 * 60 * 1000;

export type FolderMirrorOutcome =
  | 'written'
  /**
   * The dated copy landed and the newest-copy file or the key beside it did
   * not (2026-09-19). It used to return 'written' here, after printing a
   * warning naming this exact case, and stamp the head and the timestamp
   * anyway.
   *
   * Three things followed from that. The parent was told the record was backed
   * up. The one file a restore-from-folder reads by fixed name could be stale,
   * or the key that opens every copy in the folder could be missing, which is
   * the whole of what this folder is for: "a reinstall or another computer
   * restores from the folder alone, no passphrase, no PIN." And the stamped
   * timestamp told autoBackupToDownloads to stand down for 48 hours, so the
   * fallback was suppressed on the strength of a write that had half failed.
   */
  | 'written-without-latest'
  | 'skipped-unchanged' | 'skipped-empty'
  | 'no-folder' | 'no-permission' | 'error';

/**
 * Q36 layer 2: silently mirror the current sealed backup into the
 * parent-wired folder. Runs from parent-facing pages (the dashboard calls
 * it on open and after a manual backup); the File System Access write shows
 * no download UI at all. Same sealing as every other backup path.
 */
export async function mirrorBackupToWiredFolder(): Promise<FolderMirrorOutcome> {
  try {
    const status = await getBackupFolderWireStatus();
    if (status.state === 'none' || status.state === 'unsupported') return 'no-folder';
    if (status.state === 'needs-permission') return 'no-permission';

    const backup = await sharedChainWriteLock(() => buildBackupBlob());
    if (backup.records.length === 0) return 'skipped-empty';
    const head = backup.records[backup.records.length - 1]?.integrityHash ?? '';
    try {
      const seen = await chrome.storage.local.get(LAST_FOLDER_MIRROR_HEAD_KEY);
      if (head && seen[LAST_FOLDER_MIRROR_HEAD_KEY] === head) return 'skipped-unchanged';
    } catch { /* unreadable — mirror rather than skip */ }

    const sealSecret = await getOrCreateBackupSealSecret();
    const json = JSON.stringify(await sealBackupJson(JSON.stringify(backup), sealSecret, 'device-key', await getRecoveryWrappedSecret()));
    const now = new Date();
    const stamp = now.toISOString().slice(0, 16).replace(/[:]/g, '');
    const filename = `feelingwise-backup-${stamp}-${compactCount(backup.records.length)}.json`;
    const result = await writeBackupToWiredFolder(json, filename);
    if (!result.ok) return result.reason === 'write-failed' ? 'error' : result.reason;
    // The folder restores on its own (14 Sep 2026): beside the dated copies it
    // carries one file with a fixed name that is always the newest whole
    // record, and the key that opens every copy in it. The key lives on the
    // owner's own disk in the folder the owner chose, next to the record it
    // opens; a reinstall or another computer restores from the folder alone,
    // no passphrase, no PIN. The Downloads copies stay sealed without a key
    // beside them (G1), because Downloads is not a folder anyone chose.
    const latest = await writeBackupToWiredFolder(json, LATEST_BACKUP_FILENAME);
    const keyFile = await writeBackupToWiredFolder(restoreKeyFileContents(sealSecret), RESTORE_KEY_FILENAME);
    if (!latest.ok || !keyFile.ok) {
      console.warn('[FeelingWise] folder mirror: the dated copy was written, the latest copy or the key file was not');
      // Neither stamp is written here, on purpose. The head would stop this
      // retrying until the chain moved again, and the timestamp would stand the
      // Downloads fallback down for 48 hours. A half-written folder is the
      // moment to keep both of those running, not to switch them off.
      return 'written-without-latest';
    }
    try {
      await chrome.storage.local.set({
        ...(head ? { [LAST_FOLDER_MIRROR_HEAD_KEY]: head } : {}),
        [LAST_FOLDER_MIRROR_AT_KEY]: new Date().toISOString(),
      });
    } catch { /* worst case one redundant copy next time */ }
    return 'written';
  } catch (err) {
    console.warn('[FeelingWise] folder mirror failed:', err);
    return 'error';
  }
}

// ─── Weekly dated archive: gone, and why the retention rules still know it ───
//
// Until 2026-08-02 the auto-backup wrote a dated copy at most once a week, so the parent always
// held one week-old known-good snapshot beside the daily overwrite. The daily-folder layout
// replaced it: every automatic backup is a full consolidated snapshot, and retention keeps the
// newest AUTO_BACKUP_KEEP_DAYS of them, which is a stronger promise. The two helpers that decided
// when a weekly copy was due (shouldWriteWeeklyArchive, weeklyArchiveFilename) and their stamp key
// stayed behind, called by nothing but their own tests, until 2026-09-16 (PLAN-2026-09-16 item
// 6.2). The retention rules below still match the files those weeks left on disk.

// ─── Downloads retention (G1, 2026-08-04) ───────────────────────────────────
//
// One folder per day, forever, meant unbounded accumulation of full chain
// snapshots in Downloads (and before the 2026-08-02 layout, weekly dated
// archives accumulated the same way — retention prunes those legacy files
// too, by the date in their name). Every automatic backup is a FULL
// consolidated snapshot (buildBackupBlob reads the whole chain — never a
// delta), so an older daily is strictly subsumed by any newer one.
//
// Retention mirrors the in-DB philosophy (store.ts pruneRecordsToCap: a hard
// 10k cap, oldest-first): keep the newest AUTO_BACKUP_KEEP_DAYS distinct
// backup days, remove automatic files older than that. 14 days = two weeks
// of independent known-good snapshots — double the "at least one week-old
// good copy" guarantee the weekly archive existed for — while keeping
// Downloads bounded. Manual exports and pre-restore safety copies NEVER
// match the patterns below and are never touched.

export const AUTO_BACKUP_KEEP_DAYS = 14;

// Both automatic layouts, matched against the ABSOLUTE on-disk path that
// chrome.downloads.search reports (either slash direction), tolerating
// Chrome's `conflictAction: 'uniquify'` " (1)" suffix. The manual export
// (`feelingwise-backup-<full ISO with time>.json`, Downloads root) and the
// pre-restore safety file (`feelingwise-pre-restore-…`) fail both patterns.
const AUTO_DAILY_FILE_RE = /[\\/]FeelingWise[\\/]\d{4}-\d{2}-\d{2}-[^\\/]+[\\/]feelingwise-backup-\d{4}(?: \(\d+\))?\.json$/;
const LEGACY_WEEKLY_FILE_RE = /[\\/]FeelingWise[\\/]feelingwise-backup-\d{4}-\d{2}-\d{2}(?: \(\d+\))?\.json$/;
const BACKUP_DAY_RE = /(\d{4}-\d{2}-\d{2})/;

/** The backup day (YYYY-MM-DD) an automatic backup file belongs to, or undefined for anything that is not an automatic backup. Pure. */
export function autoBackupDayOf(filename: string): string | undefined {
  if (!AUTO_DAILY_FILE_RE.test(filename) && !LEGACY_WEEKLY_FILE_RE.test(filename)) return undefined;
  return BACKUP_DAY_RE.exec(filename)?.[1];
}

/**
 * Decide which download items retention removes: everything automatic whose
 * backup day is older than the newest `keepDays` distinct days. Days, not
 * file counts, so a multi-backup day (several files in one folder) still
 * counts once. Non-automatic files are never candidates. Pure.
 */
export function selectAutoBackupPrune(
  items: ReadonlyArray<{ id: number; filename: string }>,
  keepDays: number,
): number[] {
  const dated: { id: number; day: string }[] = [];
  for (const item of items) {
    const day = autoBackupDayOf(item.filename);
    if (day) dated.push({ id: item.id, day });
  }
  const keep = new Set(
    Array.from(new Set(dated.map((d) => d.day))).sort().reverse().slice(0, Math.max(0, keepDays)),
  );
  return dated.filter((d) => !keep.has(d.day)).map((d) => d.id);
}

/**
 * Best-effort retention pass over Downloads, run right after a successful
 * automatic backup (so the newest snapshot always exists before anything is
 * removed). removeFile deletes the bytes on disk; erase clears the history
 * row so the downloads page doesn't fill with "Deleted" ghosts. Both are
 * per-file best-effort — a file the user already deleted or moved simply
 * gets its stale history row cleared. Never throws.
 */
async function pruneAutoBackupDownloads(): Promise<number> {
  if (typeof chrome === 'undefined' || !chrome.downloads?.search) return 0;
  const items = await chrome.downloads.search({ filenameRegex: 'feelingwise-backup-', limit: 0 });
  const ids = selectAutoBackupPrune(
    items
      .filter((i) => typeof i.id === 'number' && typeof i.filename === 'string')
      .map((i) => ({ id: i.id, filename: i.filename })),
    AUTO_BACKUP_KEEP_DAYS,
  );
  let pruned = 0;
  for (const id of ids) {
    try { await chrome.downloads.removeFile(id); } catch { /* file already gone — still clear the row */ }
    try { await chrome.downloads.erase({ id }); pruned++; } catch { /* row survives; next daily run retries */ }
  }
  return pruned;
}

/**
 * Max serialized backup size the SW auto-backup will turn into a `data:` URL.
 * The service worker has no `URL.createObjectURL`, so it must inline the whole
 * payload as a data URL — `encodeURIComponent` then inflates it ~1.3-3x and very
 * large data URLs spike SW memory / choke chrome.downloads. Above this, auto-
 * backup skips and tells the user to use the manual "Back up now" (which uses a
 * Blob URL in the page and handles large records fine). 30 MB pre-encode is a
 * safe ceiling (thousands of records); a normal chain is well under it.
 * Since G1 (2026-08-04) the ceiling is measured on the SEALED envelope JSON
 * (base64 ≈ 1.37× the plaintext) because that is what becomes the data URL;
 * the effective record ceiling is a bit lower and still thousands of records.
 */
export const AUTO_BACKUP_MAX_BYTES = 30 * 1024 * 1024;

/** Pure: is the serialized auto-backup too large for the SW data-URL path? */
export function exceedsAutoBackupSize(byteLength: number): boolean {
  return byteLength > AUTO_BACKUP_MAX_BYTES;
}

export interface AutoBackupResult {
  status: 'saved' | 'skipped' | 'error';
  filename?: string;
  reason?: string;
  /** Old automatic backup files removed by the retention pass (G1, 2026-08-04). */
  prunedCount?: number;
}

/**
 * Automatic periodic backup (service-worker alarm path). Writes the full chain
 * to the user's Downloads as a disaster copy for IN-PLACE recovery (chain
 * reset, IDB corruption). Sealed under the install's device secret (G1,
 * 2026-08-04), it is NOT openable after an uninstall or profile migration —
 * post-uninstall durability is the manual passphrase-sealed "Back up now"
 * export, and its UI copy says so. Requires the `downloads` permission
 * (approved 2026-06-05).
 *
 * Failure-tolerant: skips when the chain is empty (nothing to protect yet) and
 * never throws — a maintenance alarm must not crash the SW. Uses a `data:` URL
 * because MV3 service workers have no `URL.createObjectURL`.
 *
 * Writes the FULL consolidated record set every time (buildBackupBlob reads
 * the whole chain — never a daily delta), SEALED under the install's device
 * secret (G1, 2026-08-04) so the child's verbatim feed history never sits in
 * Downloads as plaintext. One folder per day (decided 2026-08-02); a retention
 * pass after each successful save keeps the newest AUTO_BACKUP_KEEP_DAYS days
 * and removes older automatic files.
 */
/**
 * Q36 layer 1: run one download with Chrome's download UI suppressed, so the
 * AUTOMATIC backup never pops a bubble a child could see and cancel
 * (risk raised 2026-08-10: if the record download shows while the child is
 * online, the app is exposed and the download can be canceled). Chrome's setUiOptions is global,
 * so the window is kept as short as the download itself: disable, download,
 * wait for the write to leave in_progress (bounded), re-enable. The history
 * row is deliberately KEPT: retention pruning finds old backups through it,
 * and the exposure risk was the popup, not chrome://downloads. Parent-
 * initiated backups stay on the plain path because the parent is present.
 * Without the downloads.ui permission (or on browsers lacking the API) this
 * degrades to a normal download.
 */
/**
 * Q78 (W69): respawn safety net for the quiet-download window. setUiOptions
 * is a GLOBAL, browser-wide toggle re-enabled only in downloadQuietly's own
 * finally; if the SW is evicted or the browser closes mid-backup, the
 * download UI stayed off for every download in the profile until browser
 * restart. Called unconditionally at SW module scope on every worker
 * start; enabled is the default state, so this is always safe.
 */
export async function restoreDownloadUiOnStartup(): Promise<void> {
  try {
    const setUi = (globalThis.chrome?.downloads as unknown as {
      setUiOptions?: (o: { enabled: boolean }) => Promise<void>;
    } | undefined)?.setUiOptions;
    if (setUi) await setUi({ enabled: true });
  } catch { /* best-effort; without the permission there is nothing to heal */ }
}

/**
 * Q79 (W67): returns the download's observed terminal state instead of
 * void. The old shape treated ANY exit from in_progress (including
 * 'interrupted': disk full, user cancel) and a missing search result as
 * completion; the caller then recorded 'saved', advanced the dedup head,
 * and PRUNED older genuine backups on the strength of a file that does
 * not exist.
 */
async function downloadQuietly(options: {
  url: string; filename: string; conflictAction: 'uniquify' | 'overwrite'; saveAs: false;
}): Promise<'complete' | 'interrupted' | 'unconfirmed'> {
  const setUi = (chrome.downloads as unknown as {
    setUiOptions?: (o: { enabled: boolean }) => Promise<void>;
  }).setUiOptions;
  if (setUi) { try { await setUi({ enabled: false }); } catch { /* degrade to visible */ } }
  try {
    const id = await chrome.downloads.download(options);
    // A data-URL download completes near-instantly; bound the wait so the
    // global UI toggle can never stick off on a stalled write.
    return await waitForDownloadState(id, 20);
  } finally {
    if (setUi) { try { await setUi({ enabled: true }); } catch { /* UI stays hidden until browser restart — logged below */ } }
  }
}

/**
 * Shrink a backup until its sealed form fits the automatic transport.
 *
 * Halving rather than estimating: the sealed size is base64 over compressed
 * JSON, so bytes-per-record is not constant and a computed cut would still
 * need verifying. Each attempt is sealed and measured for real. Bounded to a
 * handful of rounds, and it gives up rather than shipping a token backup.
 *
 * Returns null when even a small slice will not fit, which means something
 * other than record count is the problem.
 */
export async function trimBackupToFit(
  backup: ForensicBackup,
  sealSecret: string,
): Promise<{ backup: ForensicBackup; json: string; bytes: number } | null> {
  const total = backup.records.length;
  let keep = Math.floor(total / 2);
  for (let round = 0; round < 6 && keep >= 1; round++) {
    const trimmedBackup: ForensicBackup = {
      ...backup,
      records: backup.records.slice(total - keep),
      historyCoverage: 'recent-records-only',
      trimmedOlderRecords: total - keep,
    };
    const json = JSON.stringify(await sealBackupJson(JSON.stringify(trimmedBackup), sealSecret, 'device-key', await getRecoveryWrappedSecret()));
    const bytes = new Blob([json]).size;
    if (!exceedsAutoBackupSize(bytes)) return { backup: trimmedBackup, json, bytes };
    keep = Math.floor(keep / 2);
  }
  return null;
}

/**
 * Pure: is a wired-folder copy recent enough that the Downloads copy adds
 * nothing? Exported for its own test — the timing rule is the whole safety
 * argument and should not need a service worker to exercise.
 */
export function folderMirrorCoversDownloads(lastMirrorAt: string | undefined, nowMs: number): boolean {
  if (!lastMirrorAt) return false;
  const at = Date.parse(lastMirrorAt);
  if (!Number.isFinite(at)) return false;
  const age = nowMs - at;
  // A future timestamp means a clock change, not a fresh backup.
  return age >= 0 && age < FOLDER_MIRROR_SUPPRESSES_DOWNLOADS_MS;
}

export async function autoBackupToDownloads(): Promise<AutoBackupResult> {
  const now = new Date().toISOString();
  try {
    // Stand down while the wired folder is being kept current.
    //
    // Both layers were always-on, so a parent who wired a folder still got a
    // file written into Downloads every day: a duplicate of a copy that is
    // already better (no size ceiling, no download row, nothing a child sees).
    // The cost was not just noise. Every write lands in a NEW dated folder,
    // and Chrome's "Save as" dialog opens in the directory of the most recent
    // download, which is how unrelated files end up inside FeelingWise backup
    // folders (found 2026-09-01).
    try {
      const seen = await chrome.storage.local.get(LAST_FOLDER_MIRROR_AT_KEY);
      if (folderMirrorCoversDownloads(seen[LAST_FOLDER_MIRROR_AT_KEY] as string | undefined, Date.now())) {
        await recordBackupHealth({ lastAttemptAt: now, lastStatus: 'skipped', source: 'auto' });
        return { status: 'skipped', reason: 'folder-mirror-current' };
      }
    } catch {
      // Storage unreadable: back up rather than skip. A missed backup is the
      // worse failure of the two.
    }

    // Capture records + public identity from one chain epoch. Download I/O
    // stays outside the lock so normal writes are not blocked by Chrome.
    //
    // includeHistory=false: this transport inlines the whole payload as a data
    // URL and is capped at AUTO_BACKUP_MAX_BYTES, which the active chain alone
    // already approaches. Carrying the archives here would push every run past
    // the ceiling and the daily backup would stop happening at all. It writes
    // what it can carry and declares the coverage instead of implying more;
    // the wired folder and the manual backup carry everything.
    let backup = await sharedChainWriteLock(() => buildBackupBlob(undefined, false));
    if (backup.records.length === 0) {
      await recordBackupHealth({ lastAttemptAt: now, lastStatus: 'skipped', source: 'auto' });
      return { status: 'skipped', reason: 'empty-chain' };
    }
    // G1 (2026-08-04): seal before anything touches Downloads. A secret that
    // cannot be persisted aborts (caught below) rather than ever writing a
    // file nobody can open — or falling back to plaintext.
    const sealSecret = await getOrCreateBackupSealSecret();
    let json = JSON.stringify(await sealBackupJson(JSON.stringify(backup), sealSecret, 'device-key', await getRecoveryWrappedSecret()));
    // Memory guard: the SW must inline the whole payload as a data URL (no
    // createObjectURL here). Above the ceiling, skip rather than spike SW
    // memory — the parent's manual "Back up now" (Blob URL) handles large
    // records, and backup-health surfaces this so they know to use it.
    let bytes = new Blob([json]).size;
    if (exceedsAutoBackupSize(bytes)) {
      // Over the ceiling used to mean NO backup at all, for as long as the
      // chain stayed large — which, at a 10000-record cap sealing to roughly
      // 28 MB against a 30 MB ceiling, is a state this install sits one busy
      // day away from. A day with no copy is a worse outcome than a copy of
      // the newest records, as long as the file says which it is.
      //
      // Halve the record count until it fits. Newest records are kept: the
      // older ones are the ones already carried by yesterday's backups and by
      // the month archives, so they are the cheaper end to drop.
      const trimmed = await trimBackupToFit(backup, sealSecret);
      if (!trimmed) {
        const reason = `record too large for automatic backup (${(bytes / (1024 * 1024)).toFixed(1)} MB) — use "Back up now" on the Export tab to save it manually`;
        await recordBackupHealth({ lastAttemptAt: now, lastStatus: 'error', lastError: reason, source: 'auto' });
        return { status: 'error', reason };
      }
      json = trimmed.json;
      backup = trimmed.backup;
      bytes = trimmed.bytes;
      console.warn(
        `[FeelingWise] auto-backup trimmed to the newest ${backup.records.length} records ` +
        `(${backup.trimmedOlderRecords} older ones dropped) to fit the download size limit.`,
      );
    }
    // Nothing new since the last successful backup: write nothing. Re-saving
    // identical bytes protects nothing and costs the parent a download they
    // have to watch appear, every single day. This is what stops the automatic
    // backup from being something the user notices.
    const head = backup.records[backup.records.length - 1]?.integrityHash ?? '';
    try {
      const seen = await chrome.storage.local.get(LAST_BACKUP_HEAD_KEY);
      if (head && seen[LAST_BACKUP_HEAD_KEY] === head) {
        await recordBackupHealth({ lastAttemptAt: now, lastStatus: 'skipped', source: 'auto' });
        return { status: 'skipped', reason: 'chain-unchanged' };
      }
    } catch {
      // Storage unreadable — back up rather than skip. A missed backup is the
      // worse failure of the two.
    }

    const url = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
    // One folder per day, named by date and record count, with the time in the
    // file name so a later backup the same day never overwrites an earlier one
    // (decided 2026-08-02). Every day is now its own archive, which is what the
    // weekly dated copy existed to guarantee.
    const filename = autoBackupPath(new Date(now), backup.records.length);
    const outcome = await downloadQuietly({
      url,
      filename,
      conflictAction: 'uniquify',
      saveAs: false,
    });
    // Q79 (W67): only a CONFIRMED completion earns 'saved'. An interrupted
    // or unconfirmed write records the failure honestly, leaves the dedup
    // head unset (the next run retries the same content), and never lets
    // retention prune real backups on the strength of a phantom file.
    if (outcome !== 'complete') {
      const reason = outcome === 'interrupted'
        ? 'download interrupted (disk full, canceled, or blocked) - the backup file was not written'
        : 'could not confirm the download completed - the backup file may not exist';
      await recordBackupHealth({ lastAttemptAt: now, lastStatus: 'error', lastError: reason, source: 'auto' });
      return { status: 'error', reason };
    }
    // One file with a fixed name that is always the newest copy (14 Sep 2026),
    // so "which backup is the latest" is answered by its name and not by
    // reading dates off a dozen folders. Overwritten each time; the dated
    // copy above is the one that is never overwritten. Best effort.
    //
    // Its outcome was thrown away (found 2026-09-19). The dated copy above
    // refuses to record a success it cannot confirm, for reasons its own
    // comment gives; this one, written two lines later, did not even look. So
    // the file whose whole purpose is to answer "which backup is the latest"
    // by its NAME could be days old with everything on the dashboard green,
    // and nothing anywhere would be able to say so.
    //
    // Recorded rather than retried: the dated copy for this run IS on disk and
    // confirmed by the time this line runs, so nothing is at risk; what was
    // missing is the ability to say that the convenience is out of date.
    let latestCopy: 'complete' | 'interrupted' | 'unconfirmed' = 'unconfirmed';
    try {
      latestCopy = await downloadQuietly({ url, filename: LATEST_DOWNLOADS_BACKUP_PATH, conflictAction: 'overwrite', saveAs: false });
    } catch { /* the dated copy is on disk; the fixed-name copy is a convenience */ }
    // Count what this copy did NOT cover, so the Export tab can name the gap
    // instead of showing a green tick over a partial backup.
    let uncoveredArchived = 0;
    try {
      // `.count` is a floor when `.complete` is false (a month would not open).
      // A gap reported low is still better here than a gap reported as none,
      // and the health record below is what the Export tab reads.
      const counted = await countArchivedRecords();
      uncoveredArchived = counted.count;
    } catch { /* unknown; reported as 0 rather than guessed high */ }
    await recordBackupHealth({
      lastAttemptAt: now,
      lastSuccessAt: now,
      lastStatus: 'saved',
      lastRecordCount: backup.records.length,
      lastError: undefined,
      source: 'auto',
      lastAutoCoverage: backup.historyCoverage ?? 'active-chain-only',
      // Trimmed older records are uncovered too, and for the same reason: the
      // transport could not carry them. Counting them here keeps the Export
      // tab's warning honest in both cases.
      lastUncoveredArchived: uncoveredArchived + (backup.trimmedOlderRecords ?? 0),
      lastLatestCopy: latestCopy,
    });
    try {
      if (head) await chrome.storage.local.set({ [LAST_BACKUP_HEAD_KEY]: head });
    } catch {
      // Worst case the next run writes one redundant copy.
    }

    // Retention (G1, 2026-08-04): only after a confirmed successful save, so
    // the newest snapshot always exists before anything older is removed.
    let prunedCount: number | undefined;
    try {
      prunedCount = await pruneAutoBackupDownloads();
    } catch {
      // Best-effort — a failed prune never fails the backup that protected it.
    }

    return { status: 'saved', filename, prunedCount };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn('[FeelingWise] auto-backup failed:', err);
    await recordBackupHealth({ lastAttemptAt: now, lastStatus: 'error', lastError: reason, source: 'auto' });
    return { status: 'error', reason };
  }
}

// ─── Backup health (so a silently-failed backup can't masquerade as safe) ──
//
// VISION §1.1: forensic record loss is military-grade failure. A backup that
// quietly stopped working is WORSE than none, because the parent believes they
// are protected. We persist the last attempt/success so the dashboard can warn.

const BACKUP_HEALTH_KEY = 'fw_backup_health';

export interface BackupHealth {
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastStatus?: 'saved' | 'skipped' | 'error';
  lastRecordCount?: number;
  lastError?: string;
  source?: 'auto' | 'manual';
  /**
   * W78 (2026-08-18): when a passphrase-sealed manual export was last taken.
   * `source` cannot answer this — it holds only the most recent backup's
   * origin, and the daily alarm overwrites it. Durability past uninstall is a
   * property of whether such an export has EVER been taken (the G1 fork,
   * :196-208), so it needs its own high-water mark.
   */
  lastPassphraseBackupAt?: string;
  /**
   * What the last automatic copy actually covered. 'active-chain-only' is the
   * normal state of the Downloads auto-backup since archive-on-evict: the
   * archives do not fit a data URL. Recorded so the Export tab can say it out
   * loud rather than letting a green "saved" imply the whole record is safe.
   */
  lastAutoCoverage?: 'full' | 'active-chain-only' | 'recent-records-only';
  /** Archived records NOT covered by the last automatic copy. */
  lastUncoveredArchived?: number;
  /**
   * Whether the fixed-name "latest" copy was written on the last automatic run.
   *
   * That file exists so a person can answer "which backup is the newest" from
   * its name without reading dates off a dozen folders, and until 2026-09-19
   * its write outcome was discarded. A file that says "latest" in its name and
   * is days old is worse than no such file, and this is what lets the Export
   * tab say so. The dated copy for the same run is confirmed separately and is
   * unaffected.
   */
  lastLatestCopy?: 'complete' | 'interrupted' | 'unconfirmed';
}

export async function getBackupHealth(): Promise<BackupHealth> {
  try {
    const stored = await chrome.storage.local.get(BACKUP_HEALTH_KEY);
    const h = stored[BACKUP_HEALTH_KEY];
    return h && typeof h === 'object' ? (h as BackupHealth) : {};
  } catch {
    return {};
  }
}

async function recordBackupHealth(patch: Partial<BackupHealth>): Promise<void> {
  try {
    const current = await getBackupHealth();
    await chrome.storage.local.set({ [BACKUP_HEALTH_KEY]: { ...current, ...patch } });
  } catch (err) {
    console.warn('[FeelingWise] backup-health write failed:', err);
  }
}

/**
 * Record a successful MANUAL backup (called by the dashboard "Back up now").
 * `sealedWithPassphrase` marks the export that survives this install, so the
 * health assessment can stop showing green to a parent who has never taken one.
 */
export async function recordManualBackupSuccess(recordCount: number, sealedWithPassphrase: boolean): Promise<void> {
  const now = new Date().toISOString();
  await recordBackupHealth({
    lastAttemptAt: now,
    lastSuccessAt: now,
    lastStatus: 'saved',
    lastRecordCount: recordCount,
    lastError: undefined,
    source: 'manual',
    // Never cleared by a later unsealed backup: this is a high-water mark, not
    // a description of the most recent file.
    ...(sealedWithPassphrase ? { lastPassphraseBackupAt: now } : {}),
  });
}

/**
 * A manual backup that did not reach the disk. Records the attempt and nothing
 * else: no `lastSuccessAt`, no `lastStatus`, and above all no
 * `lastPassphraseBackupAt`, so the warning about having no reinstall-proof copy
 * keeps standing. That warning being suppressed by a cancelled Save-As dialog
 * is the defect this pair of functions closes (2026-09-19).
 */
export async function recordManualBackupNotSaved(reason: string): Promise<void> {
  await recordBackupHealth({
    lastAttemptAt: new Date().toISOString(),
    lastError: reason,
    source: 'manual',
  });
}

export interface BackupAssessment {
  level: 'never' | 'ok' | 'stale' | 'failing' | 'install-locked-only';
  /** English fallback for callers with no string table; `level` is the localizable route. */
  message: string;
  /**
   * W82: the values the localized sentence interpolates. `ageMs` is the age
   * of the last successful backup (absent on 'never'); `cause` is the stored
   * failure text, written in English by the automatic path ('failing' only).
   */
  ageMs?: number;
  cause?: string;
}

/** Auto-backup runs daily; >2 days without a success means something is wrong. */
const BACKUP_STALE_MS = 1000 * 60 * 60 * 24 * 2;

/** Human-friendly age string. Pure. */
export function formatRelativeAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/**
 * Turn stored health into a parent-facing status. Pure (takes nowMs) so it's
 * unit-testable without mocking time.
 */
export function assessBackupHealth(h: BackupHealth, nowMs: number): BackupAssessment {
  if (h.lastStatus === 'error') {
    return {
      level: 'failing',
      cause: h.lastError,
      message: `Last automatic backup failed${h.lastError ? ` (${h.lastError})` : ''}. Use "Back up now" to save a copy manually.`,
    };
  }
  if (!h.lastSuccessAt) {
    return { level: 'never', message: 'No backup saved yet — use "Back up now" to save a copy you control.' };
  }
  const ageMs = nowMs - Date.parse(h.lastSuccessAt);
  if (Number.isNaN(ageMs)) {
    return { level: 'never', message: 'No backup saved yet — use "Back up now" to save a copy you control.' };
  }
  if (ageMs > BACKUP_STALE_MS) {
    return { level: 'stale', ageMs, message: `Your last backup was ${formatRelativeAge(ageMs)} — it may be out of date. Use "Back up now" to refresh it.` };
  }
  // W78 (2026-08-18): fresh automatic backups are not the same as safety. They
  // are sealed to this install (:196-208), so a parent whose only copies are
  // automatic loses everything the moment the extension goes. Green is the
  // wrong colour for that state; report the risk while it is still fixable.
  if (!h.lastPassphraseBackupAt) {
    return {
      level: 'install-locked-only',
      ageMs,
      message: `Last backed up ${formatRelativeAge(ageMs)}, but every copy so far is locked to this FeelingWise install and would not open after a reinstall. Set a passphrase and use "Back up now" once to keep a copy that does.`,
    };
  }
  return { level: 'ok', ageMs, message: `Last backed up ${formatRelativeAge(ageMs)}.` };
}
