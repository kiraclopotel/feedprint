// FeelingWise - the signed gap marker (evidence-gap register item 9, 2026-09-06).
//
// Every loss path used to end in an unsigned day-scoped counter or in nothing,
// so a record that was never written and a post that never existed looked
// identical in the export. A gap marker is a chain record with no content that
// says, under the install's own signature, "between fromISO and toISO this
// many units were lost on this platform for this reason". The details ride
// inside originalText, which the canonical payload hashes, so the signature
// covers them without touching the canonical field list: no record written
// before this kind existed hashes any differently (tests/unit/
// canonical-payload-stability.test.ts is the pin). Template: appendPruneMarker
// in store.ts.
//
// Reasons, and what the count means for each:
//   retry-overflow        content-side retry buffer full; records (message count)
//   retry-exhausted       a record failed its last resend; records
//   delivery-quarantined  the outbox gave up on a row after the attempt ceiling;
//                         records (the row is kept in the outbox as evidence)
//   backlog-overflow      the interceptor dropped its pending DOM nodes under
//                         pressure; nodes, not posts. The periodic rescan may
//                         recover them on platforms that rescan.
//   backlog-hidden        the tab went hidden with nodes pending; nodes, not
//                         posts. Same recovery caveat.
//   recorder-down         no heartbeat between fromISO and toISO (the
//                         heartbeat writes this one); count is 0.
//   churn-breaker         an observer fired at or above its rate ceiling for a
//                         whole sustain period and was disconnected for a
//                         cooldown (content/churn-breaker.ts); events, the
//                         callbacks counted in the minute that tripped it. The
//                         recorder stood down on that surface for the cooldown.
//   context-invalidated   the extension was updated or reloaded, which orphans
//                         the content script in every tab that was already
//                         open: its chrome.runtime is nuked synchronously, so
//                         anything it had observed and not yet delivered never
//                         arrives. Count is 0 — the worker cannot know what
//                         those tabs were holding, and this is the one loss
//                         path that had no reason at all, so it vanished with
//                         nothing on the chain at all.
//   heap-valve            the sampled heap passed the valve threshold and the
//                         content script shed its observers for the rest of the
//                         page's life (content/diagnostics.ts); events, 1.
//   chain-lost            the chain read completely empty after the install had
//                         seen it reach a height (forensics/chain-height-witness.ts);
//                         records, the number of positions the chain held. The
//                         database was destroyed under the product, by a quota
//                         eviction on a build without `unlimitedStorage`, by a
//                         profile wipe, or by any other whole-origin clear. The
//                         count is a bound on positions, not on posts: a position
//                         can be a marker. This is the one gap reason that says
//                         a loss ALREADY happened before the marker's own chain
//                         began, which is why it is the first thing written on
//                         the new one.
//   key-replaced          the chain's newest record was signed by another key
//                         than the one now in use (forensics/key-continuity.ts):
//                         the browser lost the stored key and a new one was
//                         made, or a backup brought another key or other
//                         records back. Count is 0. The line
//                         names both fingerprints and why, and the marker is
//                         the first record the new key signs. Written by the
//                         worker only: a page cannot claim it.
// A gap marker states a bound on what was lost, never what the lost items
// were, and never that the recovery did or did not happen.

import type { ForensicRecord } from '../types/forensic';
import type { GapMarkerInput, GapReason, KeyReplacedOrigin } from '../types/gap-marker';
import { sha256 } from './hasher';
import { finalizeRecord } from './record-stamp';
import { getPublicKeyFingerprint } from './signing';
import { addRecord, getChainState } from './store';
import { getSettingsForAttestation } from '../storage/settings';
import { sharedChainWriteLock } from './chain-write-lock';
import { levelOf } from '../types/mode';

// The reasons a content script may report. key-replaced is left out: only the worker can see
// both keys, and a page that could claim a key change could cover a spliced line.
const GAP_REASONS: ReadonlySet<string> = new Set<GapReason>([
  'retry-overflow',
  'retry-exhausted',
  'delivery-quarantined',
  'backlog-overflow',
  'backlog-hidden',
  'recorder-down',
  'context-invalidated',
  'churn-breaker',
  'heap-valve',
  'chain-lost',
]);

const PLATFORMS: ReadonlySet<string> = new Set(['twitter', 'instagram', 'tiktok', 'facebook', 'youtube']);

/** Shape check at the realm boundary: a content message is untrusted input. */
export function isGapMarkerInput(x: unknown): x is GapMarkerInput {
  if (!x || typeof x !== 'object') return false;
  const g = x as Record<string, unknown>;
  return typeof g.reason === 'string' && GAP_REASONS.has(g.reason)
    && typeof g.platform === 'string' && (g.platform === 'unknown' || PLATFORMS.has(g.platform))
    && typeof g.count === 'number' && Number.isInteger(g.count) && g.count >= 0
    && (g.unit === 'records' || g.unit === 'nodes' || g.unit === 'events')
    && typeof g.fromISO === 'string' && Number.isFinite(Date.parse(g.fromISO))
    && typeof g.toISO === 'string' && Number.isFinite(Date.parse(g.toISO));
}

const FINGERPRINT = /^[0-9a-f]{8,64}$/;
const KEY_ORIGINS: ReadonlySet<string> = new Set<KeyReplacedOrigin>(['generated-storage-empty', 'restored-from-backup', 'records-restored', 'unknown']);

// Only a key-replaced marker carries the clause, and only with values of the right shape. A content
// message passes the shape check with any extra field it likes, and the line is signed, so a free
// string here would let a page write its own words into a marker the checker parses.
function keyClause(input: GapMarkerInput): string {
  const k = input.key;
  if (input.reason !== 'key-replaced' || !k) return '';
  if (!FINGERPRINT.test(k.previous) || !FINGERPRINT.test(k.next) || !KEY_ORIGINS.has(k.origin)) return '';
  return ` previousKey=${k.previous} newKey=${k.next} origin=${k.origin}`;
}

/** The hashed line. Exported so the export renderer and tests read one format. */
export function gapMarkerText(input: GapMarkerInput, markerTimestamp: string, readFailed: boolean): string {
  // The breakdown is appended only when it is there, so every marker written
  // before the field existed hashes exactly as it did
  // (tests/unit/canonical-payload-stability.test.ts is the pin).
  const lost = input.lost
    ? ` chainPositions=${input.lost.chainPositions} archivedMonths=${input.lost.archivedMonths}`
      + ` archivedRecords=${input.lost.archivedRecords === null ? 'uncounted' : input.lost.archivedRecords}`
    : '';
  return `[gap-marker @ ${markerTimestamp}] reason=${input.reason} platform=${input.platform}`
    + ` count=${input.count} unit=${input.unit} from=${input.fromISO} to=${input.toISO}`
    + lost
    + keyClause(input)
    + (readFailed ? ' settings-read-failed' : '');
}

/**
 * What a chain-lost marker says went, in the reader's words. Two stores die in
 * one eviction and each gets its own clause; a dimension that did not go to
 * zero says nothing rather than printing a zero that reads as a loss.
 */
function chainLostParts(input: GapMarkerInput): string {
  const parts: string[] = [];
  const positions = input.lost ? input.lost.chainPositions : input.count;
  if (positions > 0) {
    parts.push(`The chain had reached ${positions} position${positions === 1 ? '' : 's'} and now begins again`);
  }
  const months = input.lost?.archivedMonths ?? 0;
  if (months > 0) {
    const records = input.lost?.archivedRecords;
    const held = records === null || records === undefined
      ? 'a number of records this install never counted'
      : `${records} record${records === 1 ? '' : 's'}`;
    parts.push(`${months} archived month${months === 1 ? '' : 's'} holding ${held} are gone from this computer`);
  }
  return parts.length > 0 ? parts.join(', and ') : 'The record is shorter than the height this install had reached';
}

const KEY_ORIGIN_WORDS: Record<KeyReplacedOrigin, string> = {
  'generated-storage-empty': 'this computer no longer held the old key, so the extension made a new one',
  'restored-from-backup': 'a backup brought another key back',
  'records-restored': 'a backup brought back records signed by another key',
  unknown: 'the extension could not tell why',
};

/** The reader's line, carried in resetReason like the prune marker's summary. */
export function gapMarkerSummary(input: GapMarkerInput): string {
  if (input.reason === 'key-replaced' && input.key) {
    return `key change at ${input.fromISO}: the records before this marker were signed by key ${input.key.previous}, `
      + `the records from this marker on by key ${input.key.next}; ${KEY_ORIGIN_WORDS[input.key.origin]}. `
      + 'This marker is signed by the new key';
  }
  const what = input.reason === 'recorder-down'
    ? 'no heartbeat'
    : input.reason === 'chain-lost'
      // Not "N records lost": a position can hold a marker, so the honest
      // statement is about the height reached, and it is two statements
      // because the chain and the archives are two stores that die together.
      // Every clause here is something the install observed. An earlier draft
      // said "that is what a whole origin clear looks like from inside", which
      // asserts a CAUSE the install never established, on a record that is
      // signed and permanent; a hostile reader would break that clause first.
      // What is actually known is the height, the shortfall, and that nothing
      // on the chain accounts for it.
      ? `entries this install had are gone. ${chainLostParts(input)}, and nothing on this chain accounts for it: an act that shortens the chain on purpose leaves its own marker at the first position, and none is there. What removed them is not knowable from here. They cannot be recovered from here either; a backup file is the only way back. The chain continues after this marker`
      : input.reason === 'context-invalidated'
      // Not "0 records lost": zero would read as nothing lost, and the honest
      // statement is that an unknown amount was, because the tabs that held it
      // were cut off from the worker in the same instant.
      ? 'the extension was updated or reloaded; every tab already open was cut off from the recorder, and anything those tabs had not yet delivered did not arrive. How much is not knowable from here'
      // One record, one node, one event: the unit is a plural word and the count can be 1.
      : `${input.count} ${input.count === 1 ? input.unit.replace(/s$/, '') : input.unit} lost (${input.reason}${input.platform === 'unknown' ? '' : `, ${input.platform}`})`;
  // When the two instants are one instant the line says "at", not "between T and T" (read
  // on an export, 2026-09-20: a reload marker ended "between 2026-..T10:00 and 2026-..T10:00").
  const when = input.fromISO === input.toISO ? `at ${input.fromISO}` : `between ${input.fromISO} and ${input.toISO}`;
  // The two reasons written as whole sentences take the time first. With it last, the
  // chain-lost line ended "... The chain continues after this marker between T and T",
  // which says the chain continues between two instants, and means nothing.
  if (input.reason === 'chain-lost' || input.reason === 'context-invalidated') return `gap ${when}: ${what}`;
  return `gap: ${what} ${when}`;
}

/**
 * Append one signed gap marker to the LIVE chain. Takes the shared chain-write
 * lock itself; callers already inside the lock (the delivery pump runs its
 * dispatch outside it) must not hold it. `deliveryId` is set when the marker
 * arrived through the durable outbox, so addRecord retires the row in the same
 * transaction, exactly as a content record does.
 */
export function appendGapMarker(input: GapMarkerInput, deliveryId?: string): Promise<void> {
  return sharedChainWriteLock(() => appendGapMarkerUnderChainLock(input, deliveryId));
}

/** The same, for a caller that already holds the shared chain-write lock. */
export async function appendGapMarkerUnderChainLock(input: GapMarkerInput, deliveryId?: string): Promise<void> {
  const { nextPosition, prevRecordHash } = await getChainState();
  const attestation = await getSettingsForAttestation();
  const markerTimestamp = new Date().toISOString();
  const text = gapMarkerText(input, markerTimestamp, attestation.readFailed);
  const partial: Omit<ForensicRecord, 'integrityHash' | 'signature'> = {
    id: `fr-gap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: markerTimestamp,
    // The record's platform slot is typed to the five feeds; a loss without a
    // platform names it in the hashed text and takes the same slot value the
    // prune marker takes. The text is the statement, the slot is storage.
    platform: input.platform === 'unknown' ? 'twitter' : input.platform,
    originalText: text,
    originalHash: await sha256(text),
    originalLength: text.length,
    neutralizedText: '',
    author: '',
    postUrl: '',
    techniques: [],
    overallScore: 0,
    userAgeCategory: levelOf(attestation.mode),
    aiSource: 'none',
    feedSource: 'unknown',
    detectionMode: 'gap-marker',
    prevRecordHash,
    chainPosition: nextPosition,
    chainAnchor: 'gap',
    verdict: 'pass',
    kind: 'gap-marker',
    resetReason: gapMarkerSummary(input),
    publicKeyFingerprint: await getPublicKeyFingerprint(),
  };
  await addRecord(await finalizeRecord(partial), deliveryId);
}
