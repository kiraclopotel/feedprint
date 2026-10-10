// FeelingWise — Chain integrity verification.
//
// Walks the forensic record chain (Chain A) and verifies position +
// chain-link + integrity-hash + signature for every record.
//
// What this catches:
//   • Deletion of a record from the middle of a chain (next record's
//     prevHash references a hash no longer in the chain).
//   • Modification of any field of a record (recomputed integrityHash
//     diverges from the stored one).
//   • Reordering of records (chainPosition mismatch).
//   • Forged record signed with a different key (signature verification
//     fails).
//
// What this does NOT catch:
//   • Records that were never captured at all — we don't know what didn't
//     happen.
//   • Backdating: a local-only ECDSA signature can't prove WHEN it was
//     made. RFC 3161 timestamping is V1.5 scope per VISION §9.
//
// Pre-chain (legacy v1) records pass through unverified by this function —
// they predate the chain anchor. Their per-record signatures can still be
// checked individually via verifyHash (signing.ts).

import type { ForensicRecord } from '../types/forensic';
import { computeRecordIntegrityHash } from './canonical-payload';
import { verifyHash, getPublicKeyFingerprint } from './signing';
import { isSystemMarkerRecord } from './system-records';

/**
 * Chain A genesis. The very first forensic record's prevRecordHash equals
 * this string. Treat as immutable — changing it invalidates every chain
 * already written.
 */
export const CHAIN_GENESIS_HASH = 'feelingwise-chain-genesis-v1';

/**
 * Categorical reason for a chain integrity failure. Distinguishes recoverable
 * states (key-mismatch from extension reinstall) from unrecoverable ones
 * (content tampering). Drives dashboard copy + whether re-anchor is offered.
 *
 * `key-mismatch` — record content matches its stored hash, but signature
 *   doesn't verify under the current install's public key. Most likely cause:
 *   the keypair was regenerated (extension reinstall, chrome.storage cleared).
 *   The record content itself is intact; only cross-install verifiability is
 *   lost. Re-anchoring relegates these to legacy and starts a fresh chain.
 *
 * `tampered` — recomputed integrity hash diverges from the stored one. The
 *   record's bytes were changed after signing. NOT recoverable via re-anchor;
 *   the evidence is damaged and that fact must be preserved.
 *
 * `position-mismatch` — chainPosition gap (a record was deleted or chain was
 *   reordered). Caller has no way to know which record is the offender;
 *   surface as a chain break.
 *
 * `chain-link-mismatch` — prevRecordHash doesn't reference the previous
 *   record's integrityHash. Same indication as position-mismatch (deletion or
 *   substitution upstream); surfaced separately for diagnostic clarity.
 */
export type IntegrityFailureKind =
  | 'tampered'
  | 'key-mismatch'
  | 'position-mismatch'
  | 'chain-link-mismatch';

/**
 * Per-record verification status surfaced to the dashboard.
 * - 'verified': content hash recomputes AND signature verifies under the install key.
 * - 'unsigned': content hash recomputes but the record carries no signature
 *   (historical best-effort write or restored legacy record). New addRecord
 *   writes reject instead of landing unsigned. NOT proof of tampering — the
 *   stored hash is internally consistent, but there is no authentication.
 *   Kept distinct so
 *   the dashboard and the exported HTML verifier agree (the export marks a
 *   missing signature as 'unsigned', never 'tampered'; the dashboard must not
 *   over-claim 'verified'). Regression F-2.
 * - 'prior-key': content hash recomputes AND the record's stamped
 *   publicKeyFingerprint names a DIFFERENT key than the current install's.
 *   That earlier public key is not available here, so the signature is NOT
 *   cryptographically verified. The status stays non-failing to avoid calling
 *   a normal restore tampering, but presentation layers must show it as
 *   partial/unverified rather than green.
 */
export type RecordVerifyStatus = 'verified' | 'unsigned' | 'prior-key' | 'broken' | 'pre-rekey' | 'pre-chain';

export interface IntegrityResult {
  /** True iff no structural/hash/current-key signature failure was found. */
  valid: boolean;
  /** Index in the sorted chain where the first failure occurred. */
  brokenAt?: number;
  /**
   * The failing record's own `chainPosition`, which is the number the product
   * prints beside a record everywhere else (the feed's `#105`, the reason
   * sentence in this result). `brokenAt` is an array index into the loaded
   * slice and is not a number a reader can look up: on a chain whose first
   * loaded record sits at position 100 the two differ by 100, and the banner
   * printed "Entry #0 failed verification" above a sentence naming position
   * 100 (2026-09-17). Undefined where the position cannot be derived.
   */
  brokenAtPosition?: number;
  /**
   * Categorical reason — drives banner copy + UX action availability. When
   * `valid:true`, undefined.
   */
  brokenKind?: IntegrityFailureKind;
  /** Human-readable explanation when valid:false. */
  reason?: string;
  /** Number of records that ARE part of the chain (chainPosition >= 0). */
  chainLength: number;
  /** Number of pre-chain records (legacy, chainPosition undefined or -1). */
  preChainCount: number;
  /**
   * Number of records relegated by a previous re-anchor action (chainAnchor
   * === 'pre-rekey'). Counted separately from preChainCount so the dashboard
   * can distinguish "pre-Phase-1.2 legacy" from "post-rekey legacy."
   */
  preRekeyCount: number;
  /**
   * Chain records whose stored hash is internally consistent but whose
   * signature could not be checked because the stamped key differs.
   * They stay IN the chain at their original positions — see the 'prior-key'
   * status docs above. Undefined/0 when every signature verified.
   */
  priorKeyCount?: number;
  /**
   * Per-record verification status keyed by record.id. Populated by the
   * walker so the dashboard can render the precise broken row in red
   * while the rest stay green. Records past `brokenAt` are not in the
   * map (the walker bails on first failure) — callers should default
   * missing keys to 'verified' for valid chains, 'unverified' for broken.
   * Closes VISION §1.2 explainability-per-record (audit A7-02 BLOCKER).
   */
  perRecord?: Map<string, RecordVerifyStatus>;
  /**
   * Stored rows the caller could not decode, so the walk could not check them.
   * A gap in positions made only of these rows is counted here rather than
   * reported as a break; undefined when there were none.
   */
  damagedCount?: number;
  /**
   * The whole record, archive and live chain together, read by the checker's own walk
   * (record-lines.ts). Set only after the archived months were walked; undefined before.
   */
  recordLines?: RecordLines;
}

/** The whole record read by the checker's own walk (record-lines.ts readRecordLines). */
export interface RecordLines {
  /** Entries on a line the record did not keep, each counted once. */
  setAside: number;
  /** One entry per place a kept line and a set-aside line part: the position, and how many were set aside. */
  setAsideLines: Array<{ position: number; n: number }>;
  /** Positions held twice where no marker says which line the record kept. */
  branches: number;
}

/** A stored row that did not decode, by the position its envelope carries (store.ts UnreadableStoredRecord). */
export interface DamagedRow {
  chainPosition?: number;
  /** How many readable records were stored before this row (archive-reader.ts UnreadableArchivedRow). */
  recordsBefore?: number;
}

/**
 * Minimal shape every chained record exposes. Used by `_verifyChain` to
 * walk either chain via a single generic implementation. `id` is included
 * so per-record verify status (IntegrityResult.perRecord) can key on it.
 */
interface ChainedRecord {
  id: string;
  chainPosition?: number;
  integrityHash: string;
  signature?: string;
  /** Fingerprint of the key that signed the record (stamped at write time). */
  publicKeyFingerprint?: string;
  /**
   * Non-hashed envelope marker. 'pre-rekey' = relegated by a re-anchor; such
   * records KEEP their original chainPosition (it is canonical-hashed
   * content) but are excluded from the active-chain walk by this flag, not
   * by a stripped position.
   */
  chainAnchor?: string;
}

interface ChainConfig<T extends ChainedRecord> {
  genesisHash: string;
  /** Returns the previous record's hash from the new record's perspective. */
  getPrevHash: (record: T) => string;
  /** Recomputes the canonical integrityHash from the record's content. */
  computePayloadHash: (record: T) => Promise<string>;
  /**
   * Skip signature verification entirely — structural walk only (positions,
   * links, recomputed content hashes). Used to stage-verify a backup BEFORE
   * restoring it: the backup's records were signed under the backup's key,
   * which this install may not hold, so current-key signature checks would
   * misreport an authentic backup as broken. Signature authenticity for
   * restored records remains verifiable per-record against the backup's
   * embedded public key (and via the prior-key path below post-restore).
   */
  skipSignatures?: boolean;
  /** Rows present in the store that did not decode (see IntegrityResult.damagedCount). */
  damaged?: readonly DamagedRow[];
}

/** Records verified between yields. One frame's worth at the measured cost. */
const VERIFY_YIELD_EVERY = 250;

/**
 * Give the browser a turn. `setTimeout(0)` rather than a microtask on purpose:
 * a microtask runs before rendering and would yield nothing to the user.
 * Falls back to an immediate resolve where there is no timer (worker realms).
 */
function yieldToEventLoop(): Promise<void> {
  if (typeof setTimeout !== 'function') return Promise.resolve();
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/**
 * How many positions from `from`, short of `to`, are damaged rows in a run. A gap
 * they do not fill is still a break, reported at the first position they leave missing.
 */
function crossedDamagedRows(from: number, to: number | undefined, damaged: ReadonlySet<number>): number {
  if (to === undefined || damaged.size === 0) return 0;
  let p = from;
  while (p < to && damaged.has(p)) p++;
  return p - from;
}

async function _verifyChain<T extends ChainedRecord>(
  records: T[],
  config: ChainConfig<T>,
): Promise<IntegrityResult> {
  const perRecord = new Map<string, RecordVerifyStatus>();
  const damagedPositions = new Set<number>();
  for (const row of config.damaged ?? []) {
    if (typeof row.chainPosition === 'number' && row.chainPosition >= 0) damagedPositions.add(row.chainPosition);
  }
  const damaged = config.damaged && config.damaged.length > 0 ? { damagedCount: config.damaged.length } : {};
  // Active chain = chained position AND not relegated. Relegated
  // (pre-rekey) records KEEP their original chainPosition — it is part of
  // the canonical signed payload and must never be stripped (stripping it
  // broke recomputed-hash verification in the export, live failure
  // 2026-06-11). The chainAnchor flag, which is NOT hashed, is the only
  // relegation marker. Without this exclusion, relegated records would
  // collide with the active chain's positions (both chains start at 0).
  const isActive = (r: T): boolean =>
    r.chainPosition !== undefined && r.chainPosition >= 0 && r.chainAnchor !== 'pre-rekey';
  const chainRecords = records
    .filter(isActive)
    .sort((a, b) => (a.chainPosition ?? 0) - (b.chainPosition ?? 0));

  // Bucket the non-chain records by anchor reason. Legacy v1 records
  // carry chainAnchor='pre-chain'; post-rekey relegations carry
  // chainAnchor='pre-rekey' (with their original chainPosition intact, or
  // undefined on records relegated by the old position-stripping code).
  // Records with neither + chainPosition undefined are also counted as
  // pre-chain (covers very early v1 installs).
  let preRekeyCount = 0;
  let preChainCount = 0;
  for (const r of records) {
    if (isActive(r)) continue;
    if (r.chainAnchor === 'pre-rekey') {
      preRekeyCount++;
      perRecord.set(r.id, 'pre-rekey');
    } else {
      preChainCount++;
      perRecord.set(r.id, 'pre-chain');
    }
  }

  if (chainRecords.length === 0) {
    return { valid: true, chainLength: 0, preChainCount, preRekeyCount, perRecord, ...damaged };
  }

  // Current install fingerprint, resolved lazily ONCE per walk — only needed
  // when a signature fails, to distinguish "signed by an earlier key" (kept
  // in chain as 'prior-key') from a genuine key-mismatch on this install's
  // own key. Unresolvable fingerprint (no key in THIS realm — e.g. dashboard
  // realm right after a restore) → undefined → the signature failure is
  // unattributable here, so the record falls back to a non-failing 'unsigned'
  // verdict instead of breaking the chain (the realm holding the key makes the
  // real key-mismatch call).
  let currentFingerprint: string | undefined;
  let fingerprintResolved = false;
  let priorKeyCount = 0;

  // Anchor the walk at the LOWEST surviving chainPosition rather than 0.
  // `pruneRecordsToCap` (store.ts:847-888) FIFO-deletes the oldest chain
  // entries when the chain exceeds FORENSIC_RECORD_CAP=10000. After prune,
  // chainRecords[0].chainPosition > 0. Pre-2026-05-24 the walker required
  // contiguous-from-zero and tripped `position-mismatch` immediately on
  // any post-prune chain — the chain self-broke silently at 10K records.
  // VISION §1.1 cap-ceiling closure (audit A4-BLOCKER-3 + V1.5 #5).
  // When the chain doesn't start at 0, trust the first surviving record's
  // own `prevRecordHash` claim — the genesis-hash invariant still applies
  // to the actual first record at write time, and per-record signatures
  // remain individually verifiable for every survivor.
  const firstChainPosition = chainRecords[0].chainPosition ?? 0;
  let expectedPrevHash =
    firstChainPosition === 0 ? config.genesisHash : config.getPrevHash(chainRecords[0]);
  let skipped = 0;

  for (let i = 0; i < chainRecords.length; i++) {
    // Hand the main thread back periodically.
    //
    // This walk does one SHA-256 and one ECDSA P-256 verify per record. On
    // a real chain that is 13,459 of each, and although the dashboard already
    // paints before starting it (the spinner fix), the walk then occupies the
    // main thread in one unbroken run — so the freshly painted dashboard is
    // unresponsive for as long as it takes. That is the "feels a bit slow"
    // reported from a live install, and it is not the record load: 13,500 records read and
    // render in 822 ms, measured with a CPU profile
    // (docs/measurements/2026-08-02-dashboard-perf.md).
    //
    // Yielding changes no result and no ordering. It only stops one honest
    // background check from holding the UI hostage. Every 250 records is
    // roughly a frame's worth of work at the measured per-record cost.
    if (i > 0 && i % VERIFY_YIELD_EVERY === 0) await yieldToEventLoop();
    const record = chainRecords[i];
    const crossed = crossedDamagedRows(firstChainPosition + i + skipped, record.chainPosition, damagedPositions);
    if (crossed > 0) {
      // The link runs through rows that cannot be read, so the walk takes this
      // record's own claim, as it does at the front of a pruned chain.
      skipped += crossed;
      expectedPrevHash = config.getPrevHash(record);
    }
    const expectedPos = firstChainPosition + i + skipped;

    if (record.chainPosition !== expectedPos) {
      perRecord.set(record.id, 'broken');
      return {
        valid: false,
        brokenAt: i,
        brokenAtPosition: expectedPos,
        brokenKind: 'position-mismatch',
        reason: `Position mismatch at index ${i}: expected chainPosition=${expectedPos}, got ${record.chainPosition}. Records may have been deleted or reordered.`,
        chainLength: chainRecords.length,
        preChainCount,
        preRekeyCount,
        perRecord,
      };
    }

    if (config.getPrevHash(record) !== expectedPrevHash) {
      perRecord.set(record.id, 'broken');
      return {
        valid: false,
        brokenAt: i,
        brokenAtPosition: expectedPos,
        brokenKind: 'chain-link-mismatch',
        reason: `Chain link broken at position ${expectedPos}: prevHash does not match the previous record's integrityHash. Previous record may have been altered or deleted.`,
        chainLength: chainRecords.length,
        preChainCount,
        preRekeyCount,
        perRecord,
      };
    }

    const recomputed = await config.computePayloadHash(record);
    if (recomputed !== record.integrityHash) {
      perRecord.set(record.id, 'broken');
      return {
        valid: false,
        brokenAt: i,
        brokenAtPosition: expectedPos,
        brokenKind: 'tampered',
        reason: `Integrity hash mismatch at position ${expectedPos}: record content was modified after signing.`,
        chainLength: chainRecords.length,
        preChainCount,
        preRekeyCount,
        perRecord,
      };
    }

    if (config.skipSignatures) {
      // Structural walk (backup staging): positions + links + content hashes
      // are verified above; signatures deliberately not checked.
      perRecord.set(record.id, record.signature ? 'verified' : 'unsigned');
      expectedPrevHash = record.integrityHash;
      continue;
    }

    if (!record.signature) {
      // Hash recomputed cleanly above, but there is no signature to verify.
      // Best-effort signing can leave a record unsigned; the chain stays
      // structurally valid (stored hash + links internally consistent), but we
      // must not claim 'verified'.
      // Matches the exported HTML verifier's 'unsigned' verdict (F-2).
      perRecord.set(record.id, 'unsigned');
      expectedPrevHash = record.integrityHash;
      continue;
    }
    {
      let sigValid = false;
      try {
        sigValid = await verifyHash(record.integrityHash, record.signature);
      } catch {
        // Malformed signature bytes or Web Crypto rejection are verification
        // failures, not reasons to abort the entire dashboard walk.
        sigValid = false;
      }
      if (!sigValid) {
        // Attribute the failure before alarming. The recomputed hash matched,
        // so the stored content/hash pair is internally consistent. If
        // the record names a DIFFERENT signing key than this install holds,
        // it may be an earlier-key record (restored from backup, or
        // written before a reset/reinstall regenerated the keypair) — keep it
        // in the chain as 'prior-key', but do not claim its signature verified.
        // Only the CURRENT key's own fingerprint with a failing signature
        // falls through to the key-mismatch chain break below. An unstamped
        // legacy record has no attributable signing key and stays unverified.
        if (!fingerprintResolved) {
          fingerprintResolved = true;
          try { currentFingerprint = await getPublicKeyFingerprint(); }
          catch { currentFingerprint = undefined; }
        }
        if (
          record.publicKeyFingerprint &&
          currentFingerprint &&
          record.publicKeyFingerprint !== currentFingerprint
        ) {
          perRecord.set(record.id, 'prior-key');
          priorKeyCount++;
          expectedPrevHash = record.integrityHash;
          continue;
        }
        // Fingerprint could not be resolved in THIS realm (getPublicKeyFingerprint
        // threw — common in the dashboard realm right after a restore, where the
        // signing key isn't loaded). We cannot compare the record's stamped key
        // against the current install's key, so the signature failure is
        // UNATTRIBUTABLE here — not a confirmed key-mismatch. The content hash
        // already recomputed cleanly above, so its stored hash is internally
        // consistent; the signature is unverifiable in this realm. Treat as a non-failing
        // 'unsigned' verdict (hash/link consistent, signature not verified)
        // rather than breaking the chain and falsely reporting a restored chain
        // as tampered/needs-re-anchor to the parent. The SW realm (where the key
        // resolves) makes the real key-mismatch determination.
        if (!currentFingerprint) {
          perRecord.set(record.id, 'unsigned');
          expectedPrevHash = record.integrityHash;
          continue;
        }
        if (!record.publicKeyFingerprint) {
          perRecord.set(record.id, 'unsigned');
          expectedPrevHash = record.integrityHash;
          continue;
        }
        // The stored hash recomputes, but the signature fails under the key
        // named by this record. That is a real verification failure. Do not
        // re-anchor automatically: doing so would hide the failed signature.
        //
        // Diagnostic logging surfaces the relevant key identifiers in
        // DevTools console (Verbose level). The record's
        // publicKeyFingerprint was stamped at sign time; the current
        // install's fingerprint is recomputed here.
        try {
          const currentFp = await getPublicKeyFingerprint();
          // T is a ChainedRecord (chainPosition/integrityHash/signature) but
          // diagnostic-only fields like publicKeyFingerprint + id live on the
          // concrete record type. Read defensively without changing the
          // generic constraint.
          const r = record as ChainedRecord & { publicKeyFingerprint?: string; id?: string };
          console.debug(
            `[FW chain-integrity] key-mismatch at position ${i}. ` +
            `Record signed-with fingerprint: ${r.publicKeyFingerprint ?? '<unstamped>'}, ` +
            `current install fingerprint: ${currentFp}. ` +
            `Record id: ${r.id ?? '<unknown>'}`,
          );
        } catch { /* diagnostic-only; never throw */ }
        perRecord.set(record.id, 'broken');
        return {
          valid: false,
          brokenAt: i,
          brokenAtPosition: expectedPos,
          brokenKind: 'key-mismatch',
          reason: `Signature at position ${expectedPos} does not verify under the current install's public key. The stored hash recomputes, but that unkeyed check is not authentication. The record, signature, or key data may have changed, or the stored file may be damaged.`,
          chainLength: chainRecords.length,
          preChainCount,
          preRekeyCount,
          perRecord,
        };
      }
    }

    perRecord.set(record.id, 'verified');
    expectedPrevHash = record.integrityHash;
  }

  return {
    valid: true,
    chainLength: chainRecords.length,
    preChainCount,
    preRekeyCount,
    priorKeyCount,
    perRecord,
    ...damaged,
  };
}

/**
 * Structural verification of a record set WITHOUT signature checks: positions
 * contiguous, prev-hash links intact, every record's canonical content hash
 * recomputes. Used to stage-verify a backup's records in memory BEFORE a
 * restore writes anything — a backup signed under an earlier key is
 * structurally verifiable even though this install can't verify its
 * signatures. Rejects, among others, the reset→restore collision state (two
 * records claiming the same chainPosition).
 */
export async function verifyChainStructure(records: ForensicRecord[]): Promise<IntegrityResult> {
  return _verifyChain(records, {
    genesisHash: CHAIN_GENESIS_HASH,
    getPrevHash: r => r.prevRecordHash ?? '',
    computePayloadHash: computeRecordIntegrityHash,
    skipSignatures: true,
  });
}

/**
 * Verify the integrity of Chain A (forensic detection records).
 *
 * Records are split into chain (chainPosition >= 0) and pre-chain
 * (legacy v1) sets. Pre-chain records are counted in `preChainCount` but
 * skipped in the walk — they predate the v2 chain anchor and only have
 * per-record signatures (verify with `verifyHash` from signing.ts).
 *
 * `damaged` names the stored rows that did not decode, so a row that is there
 * but unreadable is reported as damaged instead of as a record deleted.
 */
export async function verifyChainIntegrity(
  records: ForensicRecord[],
  damaged?: readonly DamagedRow[],
): Promise<IntegrityResult> {
  return _verifyChain(records, {
    genesisHash: CHAIN_GENESIS_HASH,
    getPrevHash: r => r.prevRecordHash ?? '',
    computePayloadHash: computeRecordIntegrityHash,
    damaged,
  });
}

// ─── Incremental verify watermark (Q25 family) ──────────────────────────────
//
// The passive dashboard refresh used to drop the integrity verdict whenever
// the chain grew (W13: keeping it painted a false green over unwalked
// records), leaving the banner unverified until a manual O(chain) re-walk.
// The watermark lets that refresh verify ONLY the appended records: if the
// previously verified tip is still in place, walk the new segment seeded
// from the tip's hash and merge.
//
// Scope, stated honestly: an extension re-checks the appended segment with
// full crypto but does NOT re-hash or re-sign-check the already-verified
// prefix. Retroactive tampering of a prefix record between two refreshes is
// caught by the next FULL walk — which still runs on every dashboard load
// and on every manual Verify. The extension refuses (returns null) whenever
// the prefix's shape moved at all: prune, re-anchor, count change, tip
// mismatch, or a prior non-valid result.

/** Active-chain subset, sorted by position — the walker's own definition. */
function activeChainSorted(records: ForensicRecord[]): ForensicRecord[] {
  return records
    .filter(r => r.chainPosition !== undefined && r.chainPosition >= 0 && r.chainAnchor !== 'pre-rekey')
    .sort((a, b) => (a.chainPosition ?? 0) - (b.chainPosition ?? 0));
}

/** Checkpoint of a completed FULL walk, from which growth can be extended. */
export interface ChainVerifyWatermark {
  tipId: string;
  tipHash: string;
  tipPosition: number;
  firstPosition: number;
  result: IntegrityResult;
}

/**
 * Build a watermark from a record set and the FULL-walk result computed over
 * it. Null when there is nothing to extend from (invalid result, empty
 * chain, or a result lacking the per-record map).
 */
export function chainWatermarkFrom(
  records: ForensicRecord[],
  result: IntegrityResult,
): ChainVerifyWatermark | null {
  if (!result.valid || !result.perRecord) return null;
  const active = activeChainSorted(records);
  if (active.length === 0 || active.length !== result.chainLength) return null;
  const tip = active[active.length - 1];
  return {
    tipId: tip.id,
    tipHash: tip.integrityHash,
    tipPosition: tip.chainPosition ?? 0,
    firstPosition: active[0].chainPosition ?? 0,
    result,
  };
}

/**
 * Extend a prior FULL-walk verdict over records appended since. Returns the
 * merged IntegrityResult, or null when the prefix cannot be proven unchanged
 * in O(prefix) non-crypto checks — the caller then falls back to the
 * unverified banner (or a full walk).
 */
export async function extendChainIntegrity(
  records: ForensicRecord[],
  watermark: ChainVerifyWatermark,
): Promise<IntegrityResult | null> {
  const prior = watermark.result;
  if (!prior.valid || !prior.perRecord) return null;
  const active = activeChainSorted(records);
  const tipIndex = prior.chainLength - 1;
  const tip = active[tipIndex];
  if (
    active.length <= tipIndex
    || !tip
    || tip.id !== watermark.tipId
    || tip.integrityHash !== watermark.tipHash
    || tip.chainPosition !== watermark.tipPosition
    || (active[0].chainPosition ?? 0) !== watermark.firstPosition
  ) return null;
  // Every prefix record must be one the full walk saw (same count + same
  // ids). Catches substitution-by-new-id without any hashing; substitution
  // that forges an already-seen id is caught by the next full walk (see the
  // scope note above).
  for (let i = 0; i < tipIndex; i++) {
    if (!prior.perRecord.has(active[i].id)) return null;
  }
  const appended = active.slice(tipIndex + 1);
  if (appended.length === 0) return prior;
  // The first appended record must link to the verified tip; _verifyChain
  // anchors a non-zero-start walk on that same claimed prevHash, so checking
  // it here makes the segment walk provably seeded from the watermark.
  if ((appended[0].prevRecordHash ?? '') !== watermark.tipHash) {
    return null;
  }
  if (appended[0].chainPosition !== watermark.tipPosition + 1) return null;
  const seg = await _verifyChain(appended, {
    genesisHash: CHAIN_GENESIS_HASH,
    getPrevHash: r => r.prevRecordHash ?? '',
    computePayloadHash: computeRecordIntegrityHash,
  });
  const perRecord = new Map([...prior.perRecord, ...(seg.perRecord ?? [])]);
  return {
    valid: seg.valid,
    ...(seg.brokenAt !== undefined ? { brokenAt: tipIndex + 1 + seg.brokenAt } : {}),
    // The position is the record's own, so it is carried across, never offset.
    ...(seg.brokenAtPosition !== undefined ? { brokenAtPosition: seg.brokenAtPosition } : {}),
    ...(seg.brokenKind !== undefined ? { brokenKind: seg.brokenKind } : {}),
    ...(seg.reason !== undefined ? { reason: seg.reason } : {}),
    chainLength: prior.chainLength + seg.chainLength,
    preChainCount: prior.preChainCount,
    preRekeyCount: prior.preRekeyCount,
    priorKeyCount: (prior.priorKeyCount ?? 0) + (seg.priorKeyCount ?? 0) || undefined,
    perRecord,
    ...(prior.damagedCount !== undefined ? { damagedCount: prior.damagedCount } : {}),
  };
}

/**
 * Cross-month integrity verification result. Per-month breakdown so the
 * dashboard can show which month broke if any.
 */
export interface CrossMonthIntegrityResult extends IntegrityResult {
  /**
   * Per-month results, ordered oldest first. The last entry is always the
   * active (current) chain.
   */
  perMonth: Array<{
    /** 'YYYY-MM' for archived months, 'current' for the live chain. */
    monthKey: string;
    result: IntegrityResult;
    /**
     * The chain-of-chains link, BACKWARD. True when this month's opening
     * Rotation Marker carries the previous month's terminal `integrityHash` in
     * its `priorChainHash`.
     *
     * Named `linkToNextOk` until 2026-09-19, with a docblock describing the
     * forward link, while the loop below stored the value on the LATER month.
     * So the field on month N said whether N linked back to N-1, and its own
     * description said the opposite. The sentence contradicted itself too: it
     * gave a forward reason and a backward reason for the same undefined, and
     * only the backward one was true. Both readers had privately corrected for
     * it, each with a comment of its own, which is how a wrong name survives.
     *
     * Undefined for the OLDEST month, which has no previous chain to link
     * from. The current chain does have this, because a rotation marker opens
     * it like any other month.
     */
    linkToPreviousOk?: boolean;
  }>;
}

type MonthArchive = { monthKey: string; records: ForensicRecord[]; unreadable?: readonly DamagedRow[] };

function isChainRecord(r: ForensicRecord): boolean {
  return r.chainPosition !== undefined && r.chainPosition >= 0 && r.chainAnchor !== 'pre-rekey';
}

function isOpeningReset(r: ForensicRecord): boolean {
  return isChainRecord(r) && r.chainPosition === 0 && r.kind === 'reset-marker';
}

function lastInChain(records: readonly ForensicRecord[]): ForensicRecord | undefined {
  let last: ForensicRecord | undefined;
  for (const r of records) {
    if (isChainRecord(r) && (!last || (r.chainPosition ?? -1) > (last.chainPosition ?? -1))) last = r;
  }
  return last;
}

/**
 * A reset files the chain it ends into the same month archive the chain after
 * it is later rotated into, so a marker at position 0 (the reset or rotation
 * marker) opens the next chain. Only a marker does, so a captured record
 * claiming position 0 twice is still reported as the collision it is.
 */
function splitMonthIntoChains(records: ForensicRecord[]): ForensicRecord[][] {
  const chains: ForensicRecord[][] = [[]];
  let chainHasRecords = false;
  for (const r of records) {
    const inChain = isChainRecord(r);
    const opensChain = inChain && r.chainPosition === 0 && isSystemMarkerRecord(r);
    if (opensChain && chainHasRecords) {
      chains.push([]);
      chainHasRecords = false;
    }
    chains[chains.length - 1].push(r);
    if (inChain) chainHasRecords = true;
  }
  return chains;
}

const RESET_LINK_CUT_REASON =
  'The reset at position 0 names an entry that is missing from the end of the chain before it. Entries may have been removed from the end of that chain.';

/**
 * Entries cut from the end of a chain just before a reset leave both chains
 * walking clean, so when the entry the reset marker's priorChainHash names is
 * nowhere in the record, the chain filed just before it has lost its end and
 * the marker is returned. Not when that chain was recorded after the marker (a
 * restore retired it) or ends in undecodable rows, one of which may be the entry.
 */
function resetLinkBreak(
  marker: ForensicRecord,
  before: ForensicRecord[],
  damagedBefore: readonly DamagedRow[],
  inRecord: (hash: string) => boolean,
): ForensicRecord | undefined {
  const named = marker.priorChainHash;
  if (marker.kind !== 'reset-marker' || !named) return undefined;
  const last = lastInChain(before);
  if (!last || last.integrityHash === named || Date.parse(last.timestamp) > Date.parse(marker.timestamp)) return undefined;
  if (inRecord(named)) return undefined;
  const lastPosition = last.chainPosition ?? -1;
  // Only a run of undecodable rows from just past the last readable one can
  // hold the entry named; a position the run leaves missing is a record known
  // to be gone, as the walk itself treats it.
  const damagedPast = new Set<number>();
  for (const row of damagedBefore) {
    if (typeof row.chainPosition === 'number' && row.chainPosition > lastPosition) damagedPast.add(row.chainPosition);
  }
  if (damagedPast.size > 0 && crossedDamagedRows(lastPosition + 1, Infinity, damagedPast) === damagedPast.size) {
    return undefined;
  }
  return marker;
}

/**
 * Positions restart at 0 in each chain, so a damaged row is given only to the
 * chain of the readable record stored just before it; given to every chain,
 * it would excuse a record missing at the same position in another. A row
 * with no stored place excuses no gap.
 */
function damagedRowsByChain(chains: ForensicRecord[][], damaged: readonly DamagedRow[] | undefined): DamagedRow[][] {
  const damagedByChain: DamagedRow[][] = chains.map(() => []);
  const chainEnds: number[] = [];
  let storedSoFar = 0;
  for (const chain of chains) chainEnds.push((storedSoFar += chain.length));
  for (const row of damaged ?? []) {
    if (row.recordsBefore === undefined) continue;
    const before = row.recordsBefore;
    const index = chainEnds.findIndex((end) => before <= end);
    damagedByChain[index === -1 ? chains.length - 1 : index].push(row);
  }
  return damagedByChain;
}

/**
 * A reset files each record of the chain it ends into that record's own month,
 * so one made after a month flip, before anything new was recorded, leaves that
 * whole chain in an earlier month; a chain whose end a rotation marker names was
 * followed by another and is passed over. A marker without a reason is not
 * compared there, because resets that deleted the chain they ended wrote none,
 * and the chain filed before such a marker is not the one it names.
 */
function earlierMonthResetLinkBreak(
  marker: ForensicRecord,
  markerMonthKey: string,
  archives: ReadonlyArray<MonthArchive>,
  inRecord: (hash: string) => boolean,
  namedByRotation: (hash: string) => boolean,
): ForensicRecord | undefined {
  if (!marker.resetReason) return undefined;
  const earlier = archives.filter(a => a.monthKey < markerMonthKey).sort((a, b) => (a.monthKey < b.monthKey ? 1 : -1));
  for (const month of earlier) {
    const chains = splitMonthIntoChains(month.records);
    const i = chains.length - 1;
    const end = lastInChain(chains[i]);
    const damaged = damagedRowsByChain(chains, month.unreadable)[i];
    // Rows that did not decode may be the whole chain the reset ended, so an
    // older chain is not compared in its place.
    if (!end && damaged.length === 0) continue;
    if (end && namedByRotation(end.integrityHash)) continue;
    return resetLinkBreak(marker, chains[i], damaged, inRecord);
  }
  return undefined;
}

/**
 * A reset that opens the live chain has no month archive of its own yet, so it
 * is compared with the last chain filed into the archive of its own month,
 * passing over a copy of the live chain that a failed rotation left there. Only
 * when that month holds nothing before it is an earlier month searched.
 */
function liveResetLinkBreak(
  current: ForensicRecord[],
  archives: ReadonlyArray<MonthArchive>,
  inRecord: (hash: string) => boolean,
  namedByRotation: (hash: string) => boolean,
): ForensicRecord | undefined {
  const marker = current.find(isOpeningReset);
  const at = marker ? Date.parse(marker.timestamp) : NaN;
  if (!marker || !Number.isFinite(at)) return undefined;
  const monthKey = new Date(at).toISOString().slice(0, 7);
  const month = archives.find(a => a.monthKey === monthKey);
  if (month) {
    const chains = splitMonthIntoChains(month.records);
    const damagedByChain = damagedRowsByChain(chains, month.unreadable);
    for (let i = chains.length - 1; i >= 0; i--) {
      if (chains[i].some(r => r.id === marker.id)) continue;
      if (!lastInChain(chains[i]) && damagedByChain[i].length === 0) continue;
      return resetLinkBreak(marker, chains[i], damagedByChain[i], inRecord);
    }
  }
  return earlierMonthResetLinkBreak(marker, monthKey, archives, inRecord, namedByRotation);
}

function withResetLinkCut(result: IntegrityResult, marker: ForensicRecord): IntegrityResult {
  return {
    ...result,
    valid: false,
    brokenAt: 0,
    brokenAtPosition: 0,
    brokenKind: 'chain-link-mismatch',
    reason: RESET_LINK_CUT_REASON,
    perRecord: new Map(result.perRecord ?? []).set(marker.id, 'broken'),
  };
}

async function verifyArchivedMonth(
  records: ForensicRecord[],
  damaged: readonly DamagedRow[] | undefined,
  inRecord: (hash: string) => boolean,
): Promise<IntegrityResult> {
  const chains = splitMonthIntoChains(records);
  if (chains.length === 1) return verifyChainIntegrity(records, damaged);
  // A row with no stored place is given to no chain and is still counted below.
  const damagedByChain = damagedRowsByChain(chains, damaged);
  const perRecord = new Map<string, RecordVerifyStatus>();
  let firstBroken: IntegrityResult | undefined;
  let brokenOffset = 0;
  let chainLength = 0;
  let preChainCount = 0;
  let preRekeyCount = 0;
  let priorKeyCount = 0;
  for (const [i, chain] of chains.entries()) {
    const result = await verifyChainIntegrity(chain, damagedByChain[i]);
    const cutMarker = i > 0 ? resetLinkBreak(chain[0], chains[i - 1], damagedByChain[i - 1], inRecord) : undefined;
    if (cutMarker && !firstBroken) {
      firstBroken = {
        valid: false,
        brokenAt: 0,
        brokenAtPosition: 0,
        brokenKind: 'chain-link-mismatch',
        reason: RESET_LINK_CUT_REASON,
        chainLength: 0,
        preChainCount: 0,
        preRekeyCount: 0,
      };
      brokenOffset = chainLength;
    }
    if (!result.valid && !firstBroken) {
      firstBroken = result;
      brokenOffset = chainLength;
    }
    chainLength += result.chainLength;
    preChainCount += result.preChainCount;
    preRekeyCount += result.preRekeyCount;
    priorKeyCount += result.priorKeyCount ?? 0;
    if (result.perRecord) for (const [id, status] of result.perRecord) perRecord.set(id, status);
    if (cutMarker) perRecord.set(cutMarker.id, 'broken');
  }
  return {
    valid: !firstBroken,
    ...(firstBroken?.brokenAt !== undefined ? { brokenAt: brokenOffset + firstBroken.brokenAt } : {}),
    ...(firstBroken?.brokenAtPosition !== undefined ? { brokenAtPosition: firstBroken.brokenAtPosition } : {}),
    ...(firstBroken?.brokenKind !== undefined ? { brokenKind: firstBroken.brokenKind } : {}),
    ...(firstBroken?.reason !== undefined ? { reason: firstBroken.reason } : {}),
    chainLength,
    preChainCount,
    preRekeyCount,
    priorKeyCount: priorKeyCount || undefined,
    perRecord,
    ...(damaged && damaged.length > 0 ? { damagedCount: damaged.length } : {}),
  };
}

/**
 * Verify integrity across the active chain + every archived month, following
 * the chain-of-chains via Rotation Markers' `priorChainHash` field.
 *
 * Inputs (caller provides — this function is pure and doesn't open IDB):
 *   • `current` — the active chain records
 *   • `archives` — map of monthKey → records, ordered oldest first
 *
 * Returns the standard IntegrityResult (rolled up: valid iff every month
 * passes AND every cross-month link reconciles) plus a per-month breakdown
 * for diagnostic UX. `perRecord` is the union of every month's per-record
 * map: a valid rolled-up result that carried no map read as "partial, every
 * record unverified" in integrity-summary.ts (wiring audit 13 Sep, D2-1).
 *
 * `reuse` skips the crypto walk for months whose result the caller already
 * holds: archives do not change when the active chain grows, so a refresh
 * re-checks the current chain and the link into it, nothing else (D2-22).
 * A month absent from the map is walked as usual.
 */
export async function verifyChainIntegrityAcrossMonths(
  current: ForensicRecord[],
  archives: Array<{ monthKey: string; records: ForensicRecord[]; unreadable?: readonly DamagedRow[] }>,
  reuse?: { archiveResults?: ReadonlyMap<string, IntegrityResult>; currentResult?: IntegrityResult },
): Promise<CrossMonthIntegrityResult> {
  const perMonth: CrossMonthIntegrityResult['perMonth'] = [];

  // A reset can file the chain it ended into an earlier month than its own, so
  // the entry its marker names is looked for across the whole record. The set
  // is built only when a marker does not link to the end of the chain before it.
  let hashesInRecord: Set<string> | undefined;
  const inRecord = (hash: string): boolean => {
    if (!hashesInRecord) {
      hashesInRecord = new Set(current.map(r => r.integrityHash));
      for (const a of archives) for (const r of a.records) hashesInRecord.add(r.integrityHash);
    }
    return hashesInRecord.has(hash);
  };
  let hashesRotationNamed: Set<string> | undefined;
  const namedByRotation = (hash: string): boolean => {
    if (!hashesRotationNamed) {
      hashesRotationNamed = new Set();
      for (const records of [current, ...archives.map(a => a.records)]) {
        for (const r of records) {
          if (r.chainPosition === 0 && r.kind === 'month-rotation-marker' && r.chainAnchor !== 'pre-rekey' && r.priorChainHash) {
            hashesRotationNamed.add(r.priorChainHash);
          }
        }
      }
    }
    return hashesRotationNamed.has(hash);
  };

  // Verify each archive in order, oldest first. A reset that opens a month's
  // first chain has nothing before it in that month, so the chain it ended is
  // looked for in an earlier one, even when the month's walk is reused. Rows
  // stored before it that did not decode may be that chain, so then no earlier
  // month is searched, as for a reset that opens the live chain.
  for (const { monthKey, records, unreadable } of archives) {
    const walked = reuse?.archiveResults?.get(monthKey) ?? await verifyArchivedMonth(records, unreadable, inRecord);
    const firstAt = records.findIndex(isChainRecord);
    const first = firstAt === -1 ? undefined : records[firstAt];
    const undecodedBefore = (unreadable ?? []).some(u => u.recordsBefore !== undefined && u.recordsBefore <= firstAt);
    const opening = first && isOpeningReset(first) && !undecodedBefore ? first : undefined;
    const cut = opening ? earlierMonthResetLinkBreak(opening, monthKey, archives, inRecord, namedByRotation) : undefined;
    perMonth.push({ monthKey, result: cut ? withResetLinkCut(walked, cut) : walked });
  }
  // Verify the current chain. The link from a reset that opens it is checked
  // even when the walk is reused, because the dashboard always passes its own.
  const walkedCurrent = reuse?.currentResult ?? await verifyChainIntegrity(current);
  const liveCut = liveResetLinkBreak(current, archives, inRecord, namedByRotation);
  const currentResult = liveCut ? withResetLinkCut(walkedCurrent, liveCut) : walkedCurrent;
  perMonth.push({ monthKey: 'current', result: currentResult });
  const perRecord = new Map<string, RecordVerifyStatus>();
  for (const m of perMonth) {
    if (m.result.perRecord) for (const [id, status] of m.result.perRecord) perRecord.set(id, status);
  }

  // Walk forward to verify cross-month links. The link from month N to
  // month N+1 is established by month N+1's first record (chainPosition 0)
  // being a 'month-rotation-marker' whose `priorChainHash` equals month N's
  // terminal record's integrityHash.
  let crossLinkBroken = false;
  let crossLinkBrokenAt: { monthKey: string; index: number } | undefined;
  for (let i = 0; i < perMonth.length - 1; i++) {
    const cur = perMonth[i];
    const next = perMonth[i + 1];
    // The next month's marker names the terminal of the chain rotation retired,
    // which is the last chain filed into this month.
    const curChains = i < archives.length ? splitMonthIntoChains(archives[i].records) : [current];
    const curRecords = curChains[curChains.length - 1];
    const nextRecords = i + 1 < archives.length ? archives[i + 1].records : current;

    // Find terminal of `cur` (largest ACTIVE chainPosition >= 0). Relegated
    // pre-rekey records keep their original positions and must not be
    // mistaken for the chain head.
    let curTerminal: ForensicRecord | undefined;
    for (const r of curRecords) {
      if (r.chainPosition === undefined || r.chainPosition < 0) continue;
      if (r.chainAnchor === 'pre-rekey') continue;
      if (!curTerminal || (r.chainPosition ?? -1) > (curTerminal.chainPosition ?? -1)) {
        curTerminal = r;
      }
    }
    // Find Rotation Marker at chainPosition 0 of `next` (active only — a
    // relegated marker from a prior chain may also sit at position 0).
    const nextMarker = nextRecords.find(
      r => r.chainPosition === 0 && r.kind === 'month-rotation-marker' && r.chainAnchor !== 'pre-rekey',
    );

    if (!curTerminal || !nextMarker) {
      // Missing data — cross-month link cannot be established.
      // Don't flag as broken: archives might be incomplete (user
      // deleted some) and that's a UX concern, not chain tampering.
      next.linkToPreviousOk = undefined;
      continue;
    }

    const ok = nextMarker.priorChainHash === curTerminal.integrityHash;
    next.linkToPreviousOk = ok;
    if (!ok && !crossLinkBroken) {
      crossLinkBroken = true;
      crossLinkBrokenAt = {
        monthKey: next.monthKey,
        index: nextMarker.chainPosition ?? 0,
      };
    }
  }

  // Roll up overall validity. Valid iff every month is valid AND no
  // cross-month link is broken.
  const everyMonthValid = perMonth.every(m => m.result.valid);
  const totalChainLength = perMonth.reduce((sum, m) => sum + m.result.chainLength, 0);
  const totalPreChain = perMonth.reduce((sum, m) => sum + m.result.preChainCount, 0);
  const totalPreRekey = perMonth.reduce((sum, m) => sum + m.result.preRekeyCount, 0);

  if (!everyMonthValid) {
    const broken = perMonth.find(m => !m.result.valid)!;
    return {
      valid: false,
      brokenAt: broken.result.brokenAt,
      brokenAtPosition: broken.result.brokenAtPosition,
      brokenKind: broken.result.brokenKind,
      reason: `Month ${broken.monthKey}: ${broken.result.reason}`,
      chainLength: totalChainLength,
      preChainCount: totalPreChain,
      preRekeyCount: totalPreRekey,
      perRecord,
      perMonth,
    };
  }
  if (crossLinkBroken && crossLinkBrokenAt) {
    return {
      valid: false,
      brokenAt: crossLinkBrokenAt.index,
      brokenKind: 'chain-link-mismatch',
      reason: `Cross-month link broken: ${crossLinkBrokenAt.monthKey}'s Rotation Marker priorChainHash does not match the prior month's terminal integrityHash.`,
      chainLength: totalChainLength,
      preChainCount: totalPreChain,
      preRekeyCount: totalPreRekey,
      perRecord,
      perMonth,
    };
  }

  const totalDamaged = perMonth.reduce((sum, m) => sum + (m.result.damagedCount ?? 0), 0);
  return {
    valid: true,
    chainLength: totalChainLength,
    preChainCount: totalPreChain,
    preRekeyCount: totalPreRekey,
    perRecord,
    perMonth,
    ...(totalDamaged > 0 ? { damagedCount: totalDamaged } : {}),
  };
}

