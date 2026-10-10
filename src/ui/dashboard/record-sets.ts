// src/ui/dashboard/record-sets.ts
//
// The one place the dashboard sorts its entries into the sets it counts.
//
// Three numbers that count different sets over different windows under one
// word read as a contradiction. So every screen asks this module which set an
// entry belongs to, and every sentence names its set with the noun the
// language file keeps under the same key (setNouns), which a test checks.
//
// The sets, and how they add up (every entry is in exactly one of the first
// three, every item in exactly one of the last two groups):
//
//   entries        = items + roomSummaries + markers
//   items          = checked + notChecked
//   checked        = passed + flagged + blocked
//   seen           = items + roomSummaries (everything but the record's own markers)
//
//   marker         a record-keeping entry about the chain itself (reset, month
//                  rotation, prune, gap, heartbeat, import, repair, redaction,
//                  reconcile): never something the person saw.
//   roomSummary    kind 'environment': the AI reading's summary of a comment
//                  section, one per video, not an item of the feed.
//   item           everything else: a post, a comment, a video, an ad, and the
//                  older image readings and "read this" button readings.
//   checked        an item decided either way: passed untouched, flagged, or
//                  blocked by a rule (ads the person's own rule hid among them).
//                  The image readings and button readings are second records about
//                  a post already counted, so they are never checked, the same rule
//                  the export uses (forensics/flag-provenance.ts isDecidedContentRecord).
//   notChecked     the other items: skipped, cancelled before a verdict, starred
//                  by the swear setting only (masked), the image and button
//                  readings, and the two verdicts that older builds wrote
//                  (educational-reframe, harm-floor-trigger).
//
// Windows. A count is only true with its window, so each caller names one:
// the months loaded in the page (first to last entry of what it counts),
// the whole record (all months, loaded or not), today, or a chosen range.
// The module counts what it is given; the window is the caller's list.

import type { ForensicRecord } from '../../types/forensic';
import { isSystemMarkerRecord, SYSTEM_MARKER_KINDS } from '../../forensics/system-records';
import { isButtonReading } from '../../forensics/export-numbers';
import { carriesFlagVerdict, carriesHideVerdict, isRepeatMarkOnly } from '../../forensics/flag-verdict';
import { isPaidPlacement } from '../../forensics/paid-placement';
import { isTextPlaceholder } from '../../forensics/stand-in';
import { localDayKey } from '../shared/format-time';

/** Every set the dashboard counts, by the key its noun has in each language file. */
export const RECORD_SET_NAMES = [
  'entries', 'seen', 'items', 'checked', 'passed', 'flagged', 'seenALot', 'blocked', 'notChecked', 'roomSummaries', 'markers',
] as const;
export type RecordSetName = typeof RECORD_SET_NAMES[number];

export type EntryKind = 'item' | 'roomSummary' | 'marker';
export type ItemOutcome = 'passed' | 'flagged' | 'seenALot' | 'blocked' | 'notChecked';

// The per-entry rules every screen uses. A screen that labels one entry asks
// these; a screen that counts uses countRecordSets or isFlaggedItem below.

/** The record-keeping marker kinds, in the order the chain defines them. */
export const MARKER_KINDS: readonly string[] = Array.from(SYSTEM_MARKER_KINDS);

/** A record-keeping marker: about the chain itself, never something the person saw. */
export function isMarker(r: Pick<ForensicRecord, 'kind'>): boolean {
  return isSystemMarkerRecord(r);
}

/** A comment-section summary: the AI reading's summary of a comment section, not an item of the feed. */
export function isRoomSummary(r: Pick<ForensicRecord, 'kind'>): boolean {
  return r.kind === 'environment';
}

/** An item: neither a marker nor a comment-section summary. */
export function isItem(r: ForensicRecord): boolean {
  return !isRoomSummary(r) && !isMarker(r);
}


/** One entry's FLAGGED label: a flag verdict on anything that is not an ad.
 *
 * Advertising is never a flag. A child or teen sponsored-ad record is written
 * flagged-hidden at severity 6 from the platform's own marker alone, and an ad
 * is hidden by the person's own Block Ads rule, so it counts as blocked by a
 * rule (isRuleBlocked). Counts use isFlaggedItem, which also leaves out the
 * image and "Read this for me" readings, second records about a post.
 *
 * "Seen a lot" is never a flag either (the Head, 10 Oct 2026): a repeat-exposure mark alone carries a fixed severity
 * from how often the post or its source came back, and nothing read the content. */
export function isFlaggedVerdict(r: ForensicRecord): boolean {
  return carriesFlagVerdict(r) && !isPaidPlacement(r) && !isRepeatMarkOnly(r);
}

/** Blocked by a rule: the blocked verdict, or an ad the person's own rule hid
 *  (an ad they chose to keep visible keeps its own verdict). */
export function isRuleBlocked(r: ForensicRecord): boolean {
  return r.verdict === 'blocked' || (isPaidPlacement(r) && carriesFlagVerdict(r));
}

/** The text a person can read for an item: none when the record holds the marker a caption-less hidden item is stored under. */
export { isHiddenAd, isTextPlaceholder } from '../../forensics/stand-in';

export function readableText(r: ForensicRecord): string {
  return isTextPlaceholder(r) ? '' : (r.originalText || '');
}

/** Hidden from the feed because the reading found it too harmful to show, which an ad is never. */
export function isHiddenAsHarmful(r: ForensicRecord): boolean {
  return carriesHideVerdict(r) && !isPaidPlacement(r);
}

/** The items the person counts on: everything but markers and summaries (the old name of isItem). */
export const isBalanceContent = isItem;

/** Which of the three kinds of entry this is. */
export function entryKindOf(r: ForensicRecord): EntryKind {
  if (isMarker(r)) return 'marker';
  if (isRoomSummary(r)) return 'roomSummary';
  return 'item';
}

/** Where an item lands. Only meaningful for entryKindOf(r) === 'item'. */
export function itemOutcomeOf(r: ForensicRecord): ItemOutcome {
  if (isSecondReading(r)) return 'notChecked';
  // The ad rule first: a paid placement with a flag verdict was hidden by the
  // person's own rule, and is never a flag (overview-data.ts).
  if (isRuleBlocked(r)) return 'blocked';
  // "Seen a lot" is not a flag (the Head, 10 Oct 2026): a repeat-exposure mark alone carries a fixed severity from how
  // often the post or its source came back, and nothing read the content.
  if (carriesFlagVerdict(r) && isRepeatMarkOnly(r)) return 'seenALot';
  if (isFlaggedVerdict(r)) return 'flagged';
  if (r.verdict === 'pass') return 'passed';
  return 'notChecked';
}

/** The one flagged test every screen uses: a checked item on the flagged side. */
export function isFlaggedItem(r: ForensicRecord): boolean {
  return entryKindOf(r) === 'item' && itemOutcomeOf(r) === 'flagged';
}

// A timestamp that does not parse gives no day, so a window is never named from it.
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
function dayOf(r: ForensicRecord): string {
  if (!r.timestamp || !Number.isFinite(Date.parse(r.timestamp))) return '';
  const day = localDayKey(r.timestamp);
  return DAY_KEY.test(day) ? day : '';
}

export interface RecordSetCounts {
  entries: number;
  seen: number;
  items: number;
  checked: number;
  passed: number;
  flagged: number;
  /** Repeat-exposure marks alone: an item came back often; not a flag and not checked (nothing read it). */
  seenALot: number;
  blocked: number;
  notChecked: number;
  roomSummaries: number;
  markers: number;
  /** Local day of the first and last entry counted ('' when none). */
  firstDay: string;
  lastDay: string;
}

/** Count every set over the entries given. The caller's list is the window. */
export function countRecordSets(records: readonly ForensicRecord[]): RecordSetCounts {
  const c: RecordSetCounts = {
    entries: 0, seen: 0, items: 0, checked: 0, passed: 0, flagged: 0, seenALot: 0, blocked: 0,
    notChecked: 0, roomSummaries: 0, markers: 0, firstDay: '', lastDay: '',
  };
  for (const r of records) {
    c.entries++;
    const day = dayOf(r);
    if (day) {
      if (!c.firstDay || day < c.firstDay) c.firstDay = day;
      if (!c.lastDay || day > c.lastDay) c.lastDay = day;
    }
    const kind = entryKindOf(r);
    if (kind === 'marker') { c.markers++; continue; }
    c.seen++;
    if (kind === 'roomSummary') { c.roomSummaries++; continue; }
    c.items++;
    const outcome = itemOutcomeOf(r);
    c[outcome]++;
    if (outcome !== 'notChecked' && outcome !== 'seenALot') c.checked++;
  }
  return c;
}

/** The local day span of the entries in one set, for the window words beside its count. */
export function daySpanOf(records: readonly ForensicRecord[], inSet: (r: ForensicRecord) => boolean): { firstDay: string; lastDay: string } {
  let firstDay = '';
  let lastDay = '';
  for (const r of records) {
    if (!inSet(r)) continue;
    const day = dayOf(r);
    if (!day) continue;
    if (!firstDay || day < firstDay) firstDay = day;
    if (!lastDay || day > lastDay) lastDay = day;
  }
  return { firstDay, lastDay };
}

/** Is this entry in that set? One predicate per name, so a caller can take the window of the set it counts. */
export function inRecordSet(set: RecordSetName, r: ForensicRecord): boolean {
  const kind = entryKindOf(r);
  switch (set) {
    case 'entries': return true;
    case 'seen': return kind !== 'marker';
    case 'items': return kind === 'item';
    case 'roomSummaries': return kind === 'roomSummary';
    case 'markers': return kind === 'marker';
    case 'checked': { if (kind !== 'item') return false; const o = itemOutcomeOf(r); return o !== 'notChecked' && o !== 'seenALot'; }
    default: return kind === 'item' && itemOutcomeOf(r) === set;
  }
}

/** The one blocked test every count uses: a checked item a rule hid. */
export function isBlockedItem(r: ForensicRecord): boolean {
  return entryKindOf(r) === 'item' && itemOutcomeOf(r) === 'blocked';
}

/** An image reading or a "Read this for me" reading: a second record about a post
 *  already counted, so never a checked item (the export's rule too). */
export function isSecondReading(r: ForensicRecord): boolean {
  return r.kind === 'image' || isButtonReading(r);
}

/** Something FeelingWise acted on: flagged, hidden, blocked, or rewritten by an older
 *  build. A skipped, passed or cancelled entry was seen and not acted on, so it never
 *  inflates "what FeelingWise did". */
const ACTED_VERDICTS: ReadonlySet<string> = new Set(['flagged', 'flagged-hidden', 'blocked', 'educational-reframe', 'harm-floor-trigger']);
export function isActedOn(r: ForensicRecord): boolean {
  return r.verdict === undefined || ACTED_VERDICTS.has(r.verdict);
}
