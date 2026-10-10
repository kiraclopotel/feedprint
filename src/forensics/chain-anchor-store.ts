// FeelingWise — RFC 3161 chain-anchor sidecar store.
//
// Sidecar IDB store (`chainAnchors`) alongside the main forensic chain
// (`records`) within the `feelingwise-forensics` database. Each anchor
// binds a specific chainPosition's integrityHash to a third-party-signed
// timestamp from an independent TSA (FreeTSA in V1).
//
// Chain-mirror invariant per VISION §1.1 preserved: original records remain
// immutable + append-only. Anchors live alongside the chain as additional
// independent-time evidence, not a mutation of the chain itself.
//
// Why a sidecar (vs. amending each ForensicRecord with a TST field):
//   • TSA calls don't happen per-record; they happen periodically, every few
//     hours. The 1-to-N mapping (one anchor → many
//     records) doesn't fit in a per-record field without nullable bloat.
//   • Anchors carry their own provenance: which TSA, when the request was
//     issued, what hash was sent. That's a different evidence shape from
//     a per-record signature.
//   • Adding a TST to every record would break legacy chain hash
//     compatibility. Sidecar pattern avoids that.
//
// What this gives the chain in court: a single anchor at chainPosition K
// retroactively binds every record at position ≤ K to a TSA-signed time,
// because the chain is cryptographically linked. Tamper any prior record
// and the chain-head integrityHash changes, breaking the TSA signature on
// the old hash. Opposing counsel can't impeach the timeline by claiming
// device-clock manipulation — FreeTSA's signature is independent of the
// device.

import { openDB } from './store';
import type { ChainAnchor } from '../types/chain-anchor';
import { requestVerifiedTimestamps, type TsaAnchorResponse } from './tsa-client';
import { getRecordsOrThrow } from './store';
import { sharedChainWriteLock } from './chain-write-lock';
import { isSystemMarkerRecord } from './system-records';

const CHAIN_ANCHOR_STORE_NAME = 'chainAnchors';

/**
 * The head is stamped again only after this many hours, whatever the volume since. A rule about volume alone
 * (stamp every 50 new positions) left a light reader's head unstamped for days while the site said the record
 * is stamped every few hours, and let a heavy reader be stamped sooner than the pages say. One rule about time
 * holds for both: at most one stamp per alarm tick, four a day. If the user base ever makes that a burden on the
 * free authorities, the alarm's own six-hour period is the dial, not this.
 */
export const MAX_HOURS_BETWEEN_ANCHORS = 6;

/**
 * How much younger than the window an anchor may be and still count as stale. requestedAt is
 * written once the authorities have answered, after the alarm fired, and the next tick comes one
 * period after that fire, so the anchor it finds is always that lag short of the window. Without
 * slack a light reader skipped every other tick and was stamped every twelve hours. The lag is the
 * chain read plus the authorities' round trips, well under this; the slack stays far below the
 * window, so an anchor taken an hour ago still holds.
 */
export const ANCHOR_AGE_SLACK_MINUTES = 30;


/**
 * Build a ChainAnchor from a successful TSA response + the chain head
 * details. Pure function; no IDB or network.
 */
export function anchorFromTsaResponse(
  tsa: TsaAnchorResponse,
  anchoredChainPosition: number,
  anchoredIntegrityHash: string,
): ChainAnchor {
  return {
    id: `anchor-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    anchoredChainPosition,
    anchoredIntegrityHash,
    tsaProvider: tsa.tsaProvider,
    responseB64: tsa.response,
    tstB64: tsa.tst,
    generalizedTime: tsa.generalizedTime,
    requestedAt: new Date().toISOString(),
    route: tsa.route,
    verification: {
      ok: tsa.verification.ok,
      signerSubject: tsa.verification.signerSubject,
      rootCertSha256: tsa.verification.rootCertSha256,
      knownRootName: tsa.verification.knownRootName,
      checks: tsa.verification.checks.map(c => ({ name: c.name, ok: c.ok, detail: c.detail })),
    },
  };
}

async function addAnchor(anchor: ChainAnchor): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(CHAIN_ANCHOR_STORE_NAME, 'readwrite');
    tx.objectStore(CHAIN_ANCHOR_STORE_NAME).add(anchor);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('anchor add transaction aborted')); };
  });
}

export async function getAnchors(): Promise<ChainAnchor[]> {
  try {
    const db = await openDB();
    return await new Promise<ChainAnchor[]>((resolve, reject) => {
      const tx = db.transaction(CHAIN_ANCHOR_STORE_NAME, 'readonly');
      const req = tx.objectStore(CHAIN_ANCHOR_STORE_NAME).getAll();
      req.onsuccess = () => { db.close(); resolve(req.result as ChainAnchor[]); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  } catch (err) {
    console.warn('[FeelingWise] getAnchors failed:', err);
    return [];
  }
}

export async function getLatestAnchor(): Promise<ChainAnchor | null> {
  try {
    const db = await openDB();
    return await new Promise<ChainAnchor | null>((resolve, reject) => {
      const tx = db.transaction(CHAIN_ANCHOR_STORE_NAME, 'readonly');
      // Open a DESC cursor on the 'anchoredChainPosition' index so the first
      // record the cursor lands on is the maximum — O(log N) vs the prior
      // getAll() + JS max scan which is O(N). Behavior is identical: returns
      // the anchor with the highest anchoredChainPosition, or null when empty.
      const req = tx.objectStore(CHAIN_ANCHOR_STORE_NAME)
        .index('anchoredChainPosition')
        .openCursor(null, 'prev');
      req.onsuccess = () => {
        db.close();
        resolve(req.result ? (req.result.value as ChainAnchor) : null);
      };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  } catch (err) {
    console.warn('[FeelingWise] getLatestAnchor failed:', err);
    return null;
  }
}

// Reset-time anchor clearing lives in store.ts (clearChainAnchors): the
// sidecar shares store.ts's database, and importing this module from
// store.ts — statically or dynamically — is what injected Vite's DOM
// preload helper into the service worker (known-issues M40).

export type AnchorChainHeadResult =
  | {
      status: 'anchored';
      anchoredChainPosition: number;
      generalizedTime: string | null;
      tsaProvider: string;
      /** Every authority that answered this round, so a log line names them all. */
      providers: string[];
    }
  | {
      status: 'skipped';
      reason: string;
      lastAnchoredPosition?: number;
      /**
       * Every authority's answer when none gave a token (F68, 6 Oct 2026): `reason` names the first
       * only, and a record whose stamps had stopped could not say what the other two said.
       */
      reasons?: string[];
      /** The head the attempt tried to stamp, when one was found. */
      headPosition?: number;
    };

/**
 * Periodic chain-head anchoring entry point.
 *
 * Reads the highest-chainPosition record in the chain, asks the TSA proxy
 * to sign its integrityHash, stores the resulting anchor. Skips when:
 *   • the chain has no chained records (chainPosition < 0 on all)
 *   • nothing the feed showed was recorded since the last anchor (chain
 *     markers alone, the heartbeat's included, do not count)
 *   • the last anchor is younger than MAX_HOURS_BETWEEN_ANCHORS less
 *     ANCHOR_AGE_SLACK_MINUTES, whatever the volume since
 *   • the TSA call fails (network, free-tier, malformed response, etc.)
 *
 * Failure-tolerant: returns a status object, never throws upward. The
 * chain write path is independent of TSA availability — records continue
 * to write with their local ECDSA signatures even when no TSA anchor can
 * be obtained.
 *
 * Called from:
 *   • src/background/service-worker.ts on the 'forensic-anchor' alarm.
 *   • (Future) on-demand from the dashboard's "Anchor now" button.
 */
/**
 * True when the last anchor is older than MAX_HOURS_BETWEEN_ANCHORS, less
 * ANCHOR_AGE_SLACK_MINUTES, and the chain has grown since it was taken. Both halves matter: without the growth
 * test an idle install would stamp the same head four times a day for nothing,
 * and without the age test a light reader's head is never stamped at all.
 *
 * An anchor whose requestedAt cannot be read is treated as NOT stale, so a
 * malformed row cannot turn the anchor path into a timer that fires every tick.
 */
export function anchorIsStale(
  latest: Pick<ChainAnchor, 'requestedAt' | 'anchoredChainPosition'>,
  headPosition: number,
  now: number = Date.now(),
): boolean {
  if (headPosition <= latest.anchoredChainPosition) return false;
  const takenAt = Date.parse(latest.requestedAt ?? '');
  if (!Number.isFinite(takenAt)) return false;
  return now - takenAt >= (MAX_HOURS_BETWEEN_ANCHORS * 60 - ANCHOR_AGE_SLACK_MINUTES) * 60 * 1000;
}

/**
 * How long the heartbeat waits after a stamp attempt before it asks again. A tick that finds the authorities out of
 * reach (offline, or a network that blocks them) would otherwise ask every 15 minutes for the rest of the day.
 */
export const HEARTBEAT_STAMP_RETRY_MINUTES = 60;

/**
 * Whether the 15-minute heartbeat asks for a stamp: the last anchor is at least MAX_HOURS_BETWEEN_ANCHORS old, or
 * there is none, and no attempt was made within the retry wait. Growth is left to anchorChainHead, which stamps only
 * when the feed added something since the last stamp, so this reads no record.
 *
 * The six-hour alarm was the only path to a stamp, and a browser that runs half an hour a day reaches one of its
 * ticks by chance, or the next day. Six hours stays the gap, so a heavy reader is stamped no more often than before.
 */
export function anchorDueOnHeartbeat(
  latest: Pick<ChainAnchor, 'requestedAt'> | null,
  lastAttemptAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  const attempted = Date.parse(lastAttemptAt ?? '');
  if (Number.isFinite(attempted) && now - attempted < HEARTBEAT_STAMP_RETRY_MINUTES * 60 * 1000) return false;
  if (!latest) return true;
  const takenAt = Date.parse(latest.requestedAt ?? '');
  // An unreadable time is not stale, as in anchorIsStale: a malformed row must not make every tick ask.
  if (!Number.isFinite(takenAt)) return false;
  return now - takenAt >= MAX_HOURS_BETWEEN_ANCHORS * 60 * 60 * 1000;
}

export async function anchorChainHead(): Promise<AnchorChainHeadResult> {
  // A failed read must not look like an empty chain (no_chained_records).
  const records = await getRecordsOrThrow();
  let head: { chainPosition: number; integrityHash: string } | null = null;
  for (const r of records) {
    if (typeof r.chainPosition !== 'number' || r.chainPosition < 0) continue;
    // Relegated (pre-rekey) records keep their original chainPosition but
    // belong to a prior chain — anchoring one would waste the TSA call on a
    // non-head record and skew the anchor-gap math.
    if (r.chainAnchor === 'pre-rekey') continue;
    if (!head || r.chainPosition > head.chainPosition) {
      head = { chainPosition: r.chainPosition, integrityHash: r.integrityHash };
    }
  }
  if (!head) {
    return { status: 'skipped', reason: 'no_chained_records' };
  }

  // Only something the feed showed counts as growth. The heartbeat writes a marker every tick while the browser
  // runs, so counting markers would stamp a browser left open on no site four times a day, telling the authorities
  // that the install is alive and nothing more.
  const latest = await getLatestAnchor();
  const coveredUpTo = latest ? latest.anchoredChainPosition : -1;
  const feedGrew = records.some((r) => typeof r.chainPosition === 'number' && r.chainPosition > coveredUpTo
    && r.chainAnchor !== 'pre-rekey' && !isSystemMarkerRecord(r));
  if (!feedGrew) {
    return {
      status: 'skipped',
      reason: 'no_feed_entry_since_last_anchor',
      lastAnchoredPosition: latest?.anchoredChainPosition,
      headPosition: head.chainPosition,
    };
  }
  // The time floor holds whatever the volume, so a heavy reader is stamped no more often than a light one and
  // "never sooner than five and a half hours" is true at every count. A month rotation and a reset clear the
  // anchors, so the new record's first stamp comes with its first feed entry: a new chain is covered at once. A restore
  // writes the backup's anchors back, so the wait runs from the latest of them.
  if (latest && !anchorIsStale(latest, head.chainPosition)) {
    return {
      status: 'skipped',
      reason: 'recent_anchor_covers_head',
      lastAnchoredPosition: latest.anchoredChainPosition,
      headPosition: head.chainPosition,
    };
  }

  // Ask more than one authority. One anchor answers "was this backdated"; two
  // from unrelated operators answer "and what if that authority was got at".
  const round = await requestVerifiedTimestamps(head.integrityHash);
  if (round.anchors.length === 0) {
    return {
      status: 'skipped',
      reason: `tsa_${round.reasons[0] ?? 'no_authority_answered'}`,
      reasons: round.reasons.length > 0 ? round.reasons : ['no_authority_answered'],
      headPosition: head.chainPosition,
    };
  }

  const anchors = round.anchors.map(
    a => anchorFromTsaResponse(a, head.chainPosition, head.integrityHash),
  );
  try {
    return await sharedChainWriteLock(async () => {
      // The TSA call ran outside the lock. Re-read under the destructive-
      // cutover lock so reset/restore/rotation cannot receive a stale anchor.
      // Only the stamped record has to still be in the chain, not still be its
      // head: the heartbeat alarm is armed in the same second as this one and
      // writes a record during every round, so requiring the head threw away
      // every stamp on installs armed that way. A token on a record one write
      // old is still a true time for that record and everything before it.
      const current = await getRecordsOrThrow();
      const stillChained = current.some(record =>
        record.chainPosition === head.chainPosition
        && record.integrityHash === head.integrityHash
        && record.chainAnchor !== 'pre-rekey');
      if (!stillChained) {
        return { status: 'skipped', reason: 'chain_head_changed', headPosition: head.chainPosition };
      }
      for (const anchor of anchors) await addAnchor(anchor);
      return {
        status: 'anchored',
        anchoredChainPosition: head.chainPosition,
        generalizedTime: anchors[0].generalizedTime,
        tsaProvider: anchors[0].tsaProvider,
        providers: anchors.map(a => a.tsaProvider),
      };
    });
  } catch (err) {
    console.warn('[FeelingWise] addAnchor failed:', err);
    return { status: 'skipped', reason: 'idb_write_failed', headPosition: head.chainPosition };
  }
}

// The shape lives in src/types/chain-anchor.ts so the types layer imports nothing (PLAN-2026-09-16 item 8.6);
// every importer of this module keeps working through this re-export.
export type { ChainAnchor } from '../types/chain-anchor';
