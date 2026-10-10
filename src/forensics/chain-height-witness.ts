// FeelingWise - the chain height witness (M186's open half, 2026-09-18).
//
// M186 was the worst shape a failure can take here. The record lives in
// IndexedDB at the extension's own origin. When that database goes, the next
// write re-opens it EMPTY and every read of it SUCCEEDS: `getChainState` walks
// an empty index, finds no cursor, takes its success path, and a brand new
// chain starts at position 0 under the signing key. No read is marked failed,
// no banner shows an unreadable state, and the dashboard reads zero records.
// The person is told nothing, because nothing in the product ever compared the
// record with a height it is known to have reached.
//
// This module is that comparison. It keeps one small note in
// `chrome.storage.local` saying how high the record has ever been. When the
// record is shorter than the note and nothing on the chain explains why, the
// loss is stated instead of vanishing: a signed `chain-lost` gap marker goes on
// the chain, and the dashboard says so.
//
// WHAT THIS CATCHES AND WHAT IT CANNOT, stated plainly because an earlier draft
// of this file claimed more than it could support. The note is in
// `chrome.storage.local` and the record is in IndexedDB, which are two
// different stores, but they are not two different classes of protection:
// Chrome's extension storage documentation puts both under the same quota and
// the same `unlimitedStorage` exemption. So this note is NOT proof against a
// quota eviction on an install that lacks that permission, which is the case
// the first half of M186 was about, and it cannot survive an uninstall, a
// profile deletion, or a data clear that takes the whole extension. In all of
// those the note dies with the record, `readChainHeightWitness` returns null,
// and the install correctly says nothing, because it knows nothing.
//
// What it does catch is every loss that destroys the record's database while
// leaving extension settings storage intact: a failed schema migration, a
// corrupted database file, a store removed by something other than a whole
// profile wipe, and the case where the two stores go at different moments. That
// is a narrower claim than "the record can notice its own destruction" and it
// is the true one. Nothing in the tree has checked the storage premise
// empirically; until something does, this comment is the limit of what may be
// said about it anywhere the public can read.
//
// HOW A LOSS IS TOLD FROM A RESTART. Asking "is the chain empty" is not enough,
// and an earlier draft of this file made exactly that mistake. A heartbeat tick
// or a single captured post lands on the fresh chain within seconds, so by the
// time anything looks, a destroyed record reads as a chain of one rather than a
// chain of none, and the check would quietly re-base its own note and disarm
// itself for good. What distinguishes the two is what sits at position 0: every
// act that legitimately restarts the chain leaves its own marker there, and
// nothing else does.
//
//   reset           four digits clear the chain; a reset marker takes position 0
//   month-rotation  the month moves to its archive; a rotation marker takes it
//   import          records from an earlier export are brought in with a marker
//
// A chain shorter than the note whose position 0 is none of those is a loss.
// Those three acts also re-base the note at the moment they happen
// (`rebaseChainHeightWitness`), so in the ordinary case the drop is never even
// seen; the position 0 rule is the second layer, for when a re-base did not run.
//
// TWO DIMENSIONS, not one. The active chain is capped at 10,000 records and
// re-based to 1 at every month flip, so its height can never describe more than
// the current month, while the archived months hold everything before it. A
// note watching only the chain would say "the chain had reached 3 positions"
// while three hundred thousand archived records went with it. So the note also
// remembers how many archived months existed, and months falling to zero from
// non-zero is a loss in its own right. Nothing in the product deletes an
// archive database, so that has no innocent explanation either.
//
// An unreadable reading is never a zero. `listArchiveMonths()` answers with an
// empty list when `indexedDB.databases` is not available in the realm, and
// `countArchivedRecords()` reports low rather than not at all when one month
// will not open. Both would be a false alarm, so the caller passes null when it
// could not read the archives, and the planner leaves that dimension alone.
//
// What the note is not. It is not evidence and it is never signed, hashed or
// exported: a note in settings storage proves nothing to a stranger, and saying
// otherwise would be the kind of claim this product exists to avoid. It is a
// tripwire the install uses on itself. The MARKER it causes is the evidence,
// and that is a signed record on the chain like any other.
//
// The planner is pure so the tests can drive it; `src/background/chain-height.ts`
// does the reading and the writing.

export const CHAIN_HEIGHT_WITNESS_KEY = 'fw_chain_height_witness';

/** An act that legitimately leaves the chain shorter than it was. */
export type ChainRebaseReason = 'reset' | 'restore' | 'month-rotation';

/**
 * The marker kinds that sit at position 0 of a chain that restarted on purpose.
 * A short chain whose origin is one of these restarted; a short chain whose
 * origin is anything else, or nothing at all, lost what came before.
 */
export const CHAIN_RESTART_ORIGIN_KINDS: ReadonlySet<string> = new Set([
  'reset-marker',
  'month-rotation-marker',
  'import-marker',
]);

/** What the archives held when they were last read successfully. */
export interface ArchiveHeight {
  months: number;
  /** Null when the months were listed but their records could not be counted. */
  records: number | null;
}

export interface ChainHeightWitness {
  v: 1;
  /** The highest `getChainState().nextPosition` this install has ever seen. */
  highestNextPosition: number;
  /** The most months and archived records this install has ever seen. */
  highestArchives?: ArchiveHeight;
  /** When that height was seen. */
  seenAtISO: string;
  /** The last act that lowered the note, kept for diagnostics. */
  rebase?: { reason: ChainRebaseReason | 'restart-marker'; atISO: string; toNextPosition: number };
  /** Set once a loss has been stated on the chain, so it is never stated twice. */
  stated?: {
    atISO: string;
    heldPositions: number;
    heldArchivedMonths: number;
    heldArchivedRecords: number | null;
  };
}

export interface ChainHeightFacts {
  /** The note as stored, or null on a fresh install and after a storage failure. */
  witness: ChainHeightWitness | null;
  /** `getChainState().nextPosition`, the next free slot on the active chain. */
  nextPosition: number;
  /**
   * The `kind` at chain position 0, or null when nothing is there. This is what
   * tells a deliberate restart from a loss; see the note above.
   */
  originKind: string | null;
  /**
   * What the archives read, or null when they could not be read at all. An
   * unreadable archive is never a zero.
   */
  archives: ArchiveHeight | null;
  nowISO: string;
}

/** What was lost, in the two dimensions the note watches. */
export interface ChainLossFacts {
  heldPositions: number;
  heldArchivedMonths: number;
  /** Null when the archives were known to exist and their size was never counted. */
  heldArchivedRecords: number | null;
}

export type ChainHeightVerdict =
  /** At or above the known height in every dimension. `witness` is what to store. */
  | { kind: 'ok'; witness: ChainHeightWitness; changed: boolean }
  /** Shorter, and nothing on the chain explains it. State it, once. */
  | { kind: 'loss'; loss: ChainLossFacts; sinceISO: string; witness: ChainHeightWitness }
  /** Shorter because the chain restarted on purpose. Re-based, no marker. */
  | { kind: 'restarted'; from: number; to: number; originKind: string; witness: ChainHeightWitness };

/** Shape check at the storage boundary: a stored note is untrusted input. */
export function isChainHeightWitness(x: unknown): x is ChainHeightWitness {
  if (!x || typeof x !== 'object') return false;
  const w = x as Record<string, unknown>;
  if (w.v !== 1) return false;
  if (typeof w.highestNextPosition !== 'number' || !Number.isInteger(w.highestNextPosition) || w.highestNextPosition < 0) return false;
  if (typeof w.seenAtISO !== 'string' || !Number.isFinite(Date.parse(w.seenAtISO))) return false;
  if (w.highestArchives !== undefined) {
    const a = w.highestArchives as Record<string, unknown> | null;
    if (!a || typeof a !== 'object') return false;
    if (typeof a.months !== 'number' || !Number.isInteger(a.months) || a.months < 0) return false;
    if (a.records !== null && (typeof a.records !== 'number' || !Number.isInteger(a.records) || a.records < 0)) return false;
  }
  return true;
}

/** The archive high-water mark only ever rises, and an unread count never lowers it. */
function raiseArchives(
  known: ArchiveHeight | undefined,
  seen: ArchiveHeight | null,
): ArchiveHeight | undefined {
  if (seen === null || seen === undefined) return known;
  if (!known) return seen;
  return {
    months: Math.max(known.months, seen.months),
    records: seen.records === null
      ? known.records
      : known.records === null ? seen.records : Math.max(known.records, seen.records),
  };
}

function archivesLost(known: ArchiveHeight | undefined, seen: ArchiveHeight | null): boolean {
  if (seen === null || seen === undefined || !known) return false;
  return known.months > 0 && seen.months === 0;
}

/**
 * Compare the record with the height it is known to have reached. Pure.
 *
 * A loss is reported at most once: the returned witness carries `stated`, and a
 * later call with that witness returns `ok` rather than writing a second marker
 * on every wake. `stated` is carried through every later re-base, including a
 * month rotation, so the fact that a loss happened outlives the month it
 * happened in.
 */
export function assessChainHeight(facts: ChainHeightFacts): ChainHeightVerdict {
  const { witness, nextPosition, originKind, archives, nowISO } = facts;

  if (witness === null) {
    return {
      kind: 'ok',
      changed: true,
      witness: {
        v: 1,
        highestNextPosition: nextPosition,
        seenAtISO: nowISO,
        ...(archives ? { highestArchives: archives } : {}),
      },
    };
  }

  const chainShort = nextPosition < witness.highestNextPosition;
  const restarted = originKind !== null && CHAIN_RESTART_ORIGIN_KINDS.has(originKind);
  const chainLost = chainShort && !restarted;
  const archivesGone = archivesLost(witness.highestArchives, archives);

  if (chainLost || archivesGone) {
    if (witness.stated) {
      // Already said. A record that is still short is not a second loss.
      return { kind: 'ok', witness, changed: false };
    }
    const stated = {
      atISO: nowISO,
      heldPositions: chainLost ? witness.highestNextPosition : 0,
      heldArchivedMonths: archivesGone ? (witness.highestArchives?.months ?? 0) : 0,
      heldArchivedRecords: archivesGone ? (witness.highestArchives?.records ?? null) : 0,
    };
    return {
      kind: 'loss',
      sinceISO: witness.seenAtISO,
      loss: {
        heldPositions: stated.heldPositions,
        heldArchivedMonths: stated.heldArchivedMonths,
        heldArchivedRecords: stated.heldArchivedRecords,
      },
      witness: {
        v: 1,
        highestNextPosition: nextPosition,
        seenAtISO: nowISO,
        // A dimension that was lost starts again from what is there now; a
        // dimension that survived keeps its mark.
        ...(archivesGone
          ? (archives ? { highestArchives: archives } : {})
          : (raiseArchives(witness.highestArchives, archives)
            ? { highestArchives: raiseArchives(witness.highestArchives, archives) as ArchiveHeight }
            : {})),
        stated,
      },
    };
  }

  const nextArchives = raiseArchives(witness.highestArchives, archives);

  if (chainShort) {
    return {
      kind: 'restarted',
      from: witness.highestNextPosition,
      to: nextPosition,
      originKind: originKind as string,
      witness: {
        v: 1,
        highestNextPosition: nextPosition,
        seenAtISO: nowISO,
        ...(nextArchives ? { highestArchives: nextArchives } : {}),
        rebase: { reason: 'restart-marker', atISO: nowISO, toNextPosition: nextPosition },
        // A loss already stated stays stated. Without this line the next month
        // rotation, which takes exactly this branch, would quietly erase the
        // only record that the loss ever happened.
        ...(witness.stated ? { stated: witness.stated } : {}),
      },
    };
  }

  const grew = nextPosition > witness.highestNextPosition;
  const archivesChanged =
    JSON.stringify(nextArchives ?? null) !== JSON.stringify(witness.highestArchives ?? null);
  if (!grew && !archivesChanged) return { kind: 'ok', witness, changed: false };
  return {
    kind: 'ok',
    changed: true,
    witness: {
      ...witness,
      highestNextPosition: Math.max(witness.highestNextPosition, nextPosition),
      seenAtISO: nowISO,
      ...(nextArchives ? { highestArchives: nextArchives } : {}),
    },
  };
}

/** Read the note. Best effort: a storage failure reads as "no note". */
export async function readChainHeightWitness(): Promise<ChainHeightWitness | null> {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
    const got = await chrome.storage.local.get([CHAIN_HEIGHT_WITNESS_KEY]);
    const raw = got[CHAIN_HEIGHT_WITNESS_KEY];
    return isChainHeightWitness(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Write the note. Best effort: nothing here may stop a caller. */
export async function writeChainHeightWitness(witness: ChainHeightWitness): Promise<void> {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    await chrome.storage.local.set({ [CHAIN_HEIGHT_WITNESS_KEY]: witness });
  } catch {
    // A note that cannot be written is a tripwire that does not arm. The record
    // itself is unaffected, so this must never throw into a caller that is in
    // the middle of a chain write.
  }
}

/**
 * Tell the note that an act shortened the chain on purpose, so the next check
 * reads the new height as the height rather than as a loss.
 *
 * Callers must await this before returning, so that a check running on the next
 * tick cannot read the old note against the new chain. The archive high-water
 * mark is untouched: none of the three acts removes a month, and two add one.
 */
export async function rebaseChainHeightWitness(
  reason: ChainRebaseReason,
  toNextPosition: number,
): Promise<void> {
  const atISO = new Date().toISOString();
  const prior = await readChainHeightWitness();
  await writeChainHeightWitness({
    v: 1,
    highestNextPosition: toNextPosition,
    seenAtISO: atISO,
    ...(prior?.highestArchives ? { highestArchives: prior.highestArchives } : {}),
    rebase: { reason, atISO, toNextPosition },
    // A loss already stated stays stated: the banner reads it, and a reset
    // after a loss must not quietly erase the fact that the loss happened.
    ...(prior?.stated ? { stated: prior.stated } : {}),
  });
}

/**
 * What the dashboard needs to say a loss out loud. Facts, not copy, so the four
 * languages each write their own sentence.
 */
export function statedLossFacts(
  witness: ChainHeightWitness | null,
): ChainHeightWitness['stated'] | null {
  return witness?.stated ?? null;
}
