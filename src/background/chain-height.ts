// Worker-realm chain height check (M186's open half, 2026-09-18).
//
// Reads how tall the record is now, reads the note beside it, hands both to the
// pure planner in forensics/chain-height-witness.ts, and writes what it decides.
// Failure tolerant: nothing here may stop the worker, and nothing here may state
// a loss it did not establish.
//
// THREE THINGS THIS FILE GETS RIGHT ON PURPOSE, each of them a defect an
// adversarial read of the first draft found before it shipped.
//
// 1. It runs BEFORE anything else writes to the chain on a fresh worker realm.
//    The first draft ran after the heartbeat, which writes a record of its own;
//    on an install whose record had just been destroyed, that heartbeat landed
//    at position 0, the chain read as a height of one instead of none, and the
//    check re-based its own note and disarmed itself for good. The planner no
//    longer depends on the chain being empty, and this file no longer lets the
//    question be asked late.
//
// 2. One check at a time per realm. An MV3 worker runs its module scope and the
//    alarm that woke it in the same realm, so two copies of this ran
//    unsynchronised: both read the note before either wrote it, and a real loss
//    would have been stated twice on the chain, each marker saying the record
//    was destroyed. The queue below is what makes the planner's once-only rule
//    actually hold.
//
// 3. The marker goes on the chain FIRST, and the note is only marked "stated"
//    once that write returned. If the marker fails, nothing is persisted, so the
//    next wake sees the same facts and tries again. The other order would lose
//    the statement for ever on one bad write, and losing the statement is the
//    whole defect.

import { getChainOriginKind, getChainState } from '../forensics/store';
import { countArchivedRecords, listArchiveMonthsDetailed } from '../forensics/archive-reader';
import { appendGapMarker } from '../forensics/gap-marker';
import {
  assessChainHeight,
  readChainHeightWitness,
  writeChainHeightWitness,
  type ArchiveHeight,
} from '../forensics/chain-height-witness';

export type ChainHeightOutcome =
  | { status: 'ok'; nextPosition: number }
  | { status: 'stated-loss'; heldPositions: number; heldArchivedMonths: number }
  | { status: 'restarted'; from: number; to: number; originKind: string }
  | { status: 'failed'; reason: string };

/**
 * Reading the archives means opening one database per month, so it is done on a
 * worker start and not on every fifteen minute tick. A tick passes null, which
 * the planner reads as "say nothing about that dimension" rather than as zero.
 */
async function readArchiveHeight(): Promise<ArchiveHeight | null> {
  try {
    // `listArchiveMonthsDetailed` exists because the plain list answered with an
    // empty array both when there are no archives and when the realm cannot
    // enumerate databases at all. Reading the second as zero months would state
    // a loss that did not happen, on a signed record, so an incomplete
    // enumeration is not read at all.
    const listing = await listArchiveMonthsDetailed();
    if (!listing.complete) return null;
    let records: number | null = null;
    try {
      const counted = await countArchivedRecords();
      // An incomplete count is a floor, not a total. Carrying a floor as the
      // high-water mark would understate what was held, and this number is
      // written onto a permanent record, so it is carried as uncounted instead.
      records = counted.complete ? counted.count : null;
    } catch {
      records = null;
    }
    return { months: listing.months.length, records };
  } catch {
    return null;
  }
}

/**
 * How long the archive read is allowed to be skipped for.
 *
 * The deep read was written for "a worker start", on the reading that a worker
 * start is a rare event. It is not: `forensic-outbox-drain` is armed at
 * `periodInMinutes: 1` and an MV3 worker idles out at about thirty seconds, so
 * the browser starts a fresh realm roughly every minute for as long as Chrome is
 * open, and module scope runs every time. A person with a year of archives was
 * paying an enumeration of the whole database list plus one database open,
 * count and close PER ARCHIVED MONTH, about twelve opens a minute, for ever,
 * for an answer that changes at most once. Found 2026-09-19, and it is new in
 * 2.5.11: the check itself landed the day before.
 *
 * Six hours is chosen against what the read is for rather than against the
 * cost. It answers one question, whether the archives are still there, and an
 * archive that vanishes stays vanished; the shallow check that runs on EVERY
 * realm is what catches the live record being destroyed, which is the case that
 * needs to be caught within minutes.
 */
const ARCHIVE_READ_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Where the last archive read is noted. Session first: see below. */
const ARCHIVE_READ_AT_KEY = 'fw_chain_height_archives_read_at';

/**
 * The note goes in `chrome.storage.session` when there is one, so it is empty
 * again at browser start and the first realm of a session always reads the
 * archives, which is the guarantee the original code meant to give. A realm
 * with no session storage falls back to `chrome.storage.local`, where the note
 * outlives the browser: the floor still holds, and the worst case is one
 * archive read every six hours instead of one per browser session. Either way
 * the cost is bounded, which it was not before.
 *
 * A storage failure reads the archives. A worker that cannot remember is a
 * worker that checks, and the old behaviour is the safe end of this.
 */
async function shouldReadArchives(nowMs: number): Promise<boolean> {
  const areas = [chrome.storage?.session, chrome.storage?.local];
  for (const area of areas) {
    if (!area) continue;
    try {
      const got = await area.get(ARCHIVE_READ_AT_KEY);
      const last = got?.[ARCHIVE_READ_AT_KEY];
      if (typeof last === 'number' && nowMs - last < ARCHIVE_READ_MIN_INTERVAL_MS) return false;
      await area.set({ [ARCHIVE_READ_AT_KEY]: nowMs });
      return true;
    } catch {
      continue;
    }
  }
  return true;
}

/**
 * The realm-start check: the shallow read always, the archive read at most once
 * per browser session. Everything else about it is unchanged, including that it
 * runs before anything else writes to the chain.
 */
export async function checkChainHeightOnRealmStart(nowMs = Date.now()): Promise<ChainHeightOutcome> {
  return checkChainHeight(await shouldReadArchives(nowMs));
}

/** One check at a time in this realm. See note 2 at the top of this file. */
let queue: Promise<ChainHeightOutcome> = Promise.resolve({ status: 'ok', nextPosition: 0 });

export function checkChainHeight(deep = false): Promise<ChainHeightOutcome> {
  queue = queue.then(() => runCheck(deep), () => runCheck(deep));
  return queue;
}

async function runCheck(deep: boolean): Promise<ChainHeightOutcome> {
  try {
    // An error from either of these is NOT an empty chain: both throw on a read
    // failure precisely so the two are never confused. A record we could not
    // read is a record we say nothing about.
    //
    // allSettled, not all. Each of these opens its own connection to the record
    // database and closes it on the way out. `Promise.all` rejects the instant
    // the first one does and hands control back while the other is still in
    // flight, so the connection it holds outlives the check: the next thing to
    // ask for that database is blocked by a handle nobody is using any more.
    // Waiting for both to settle costs one read and guarantees both are closed
    // before anything here returns (found by a fault-injecting storage double on
    // 2026-09-18, which deleted the database under the check and was refused).
    const [chainRead, originRead] = await Promise.allSettled([getChainState(), getChainOriginKind()]);
    if (chainRead.status === 'rejected') throw chainRead.reason;
    if (originRead.status === 'rejected') throw originRead.reason;
    const chain = chainRead.value;
    const originKind = originRead.value;
    const archives = deep ? await readArchiveHeight() : null;
    const witness = await readChainHeightWitness();
    const verdict = assessChainHeight({
      witness,
      nextPosition: chain.nextPosition,
      originKind,
      archives,
      nowISO: new Date().toISOString(),
    });

    if (verdict.kind === 'ok') {
      if (verdict.changed) await writeChainHeightWitness(verdict.witness);
      return { status: 'ok', nextPosition: chain.nextPosition };
    }

    if (verdict.kind === 'restarted') {
      await writeChainHeightWitness(verdict.witness);
      return { status: 'restarted', from: verdict.from, to: verdict.to, originKind: verdict.originKind };
    }

    // A loss. Say it on the chain that replaced the one that is gone.
    const at = new Date().toISOString();
    const { heldPositions, heldArchivedMonths, heldArchivedRecords } = verdict.loss;
    await appendGapMarker({
      reason: 'chain-lost',
      platform: 'unknown',
      // The bound on what went, in one number, with the two halves stated
      // separately beside it. An uncounted archive contributes nothing to the
      // total rather than a guess.
      count: heldPositions + (heldArchivedRecords ?? 0),
      unit: 'records',
      fromISO: verdict.sinceISO,
      toISO: at,
      lost: { chainPositions: heldPositions, archivedMonths: heldArchivedMonths, archivedRecords: heldArchivedRecords },
    });
    await writeChainHeightWitness(verdict.witness);
    console.warn(
      `[FeelingWise] the record is shorter than the height this install had reached: ${heldPositions} chain positions and ${heldArchivedMonths} archived months are unaccounted for. A chain-lost marker was written.`,
    );
    return { status: 'stated-loss', heldPositions, heldArchivedMonths };
  } catch (err) {
    return { status: 'failed', reason: err instanceof Error ? err.message : String(err) };
  }
}
