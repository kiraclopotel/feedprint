// FeelingWise - the numbers engine for the forensic export mode
// (futurestate.md section 3b, item 2, part 1 of 2).
//
// One row of numbers per platform, four composable filters, and a "your rule"
// classifier. Pure functions, no DOM, no side effects, no runtime imports:
// this file must run both at export-build time in the extension and inside
// the exported HTML's inline script, so it is plain ES2019 and depends on
// nothing but the ForensicRecord type. Part 2 (the HTML and UI wiring)
// embeds or bundles it; the platform ids stay internal here ('twitter', not
// "X") and the UI layer maps them to display names.
//
// EVERY NUMBER IS COMPUTED OVER THE WHOLE ARRAY PASSED IN. Pass the whole
// chain and the numbers describe the whole chain; the caller never passes a
// loaded window, so statistics stop resetting as the reader pages.
// "Earlier" (seen-before) means earlier in the array, which the caller must
// hand over in chain order.
//
// Exported API
//   computePlatformRows(records, filter?)  one PlatformRow per platform in
//                                          fixed order, plus a totals row
//   applyFilters(records, filterState)     records that pass every set filter
//   ruleLabel(record)                      null for a judge's flag, else the
//                                          machine key of the rule that decided
//   isUserRule(label)                      which labels count as the user's
//                                          own rule (the user-hidden column)
//   surfaceBucket(record)                  'for-you' | 'following' | 'profile'
//                                          | 'permalink' | 'search' | 'unknown'
//                                          | 'other'
//   sittingByRecordId(records)             record id to 1-based sitting number
//   seenBeforeIds(records)                 ids whose content identity appeared
//                                          earlier in the array
//   isImpression(record)                   the kind test every column shares
//   isPaidPlacement / isModelNamed / isUserHidden   the column predicates
//   contentIdentity(record)                the dedupe key, or null
//
// Where each column comes from (file:line of the docblock that justifies it)
//   impressions      kind is a NodeKind or absent: src/types/forensic.ts:483-509
//                    (kind 'image' is an analysis record, not a DOM node the
//                    person saw, :487-492; 'environment' and every system
//                    marker are about the chain, src/forensics/system-records.ts:3-15)
//   unique posts     originalHash = sha256(originalText): src/forensics/logger.ts:141,
//                    :365, :556, :806, :954, :1028. A blocked record with an
//                    empty caption hashes the placeholder "[blocked: <reason>]"
//                    (logger.ts:1025-1027), so that text is not a content
//                    identity and such records are neither unique nor copies.
//   extra copies     impressions whose identity appeared earlier in the whole
//                    array (seenBeforeIds), the set the seen-before filter uses
//   paid placements  detectionMode 'sponsored-ad' / 'sponsored-ad:adult'
//                    (src/analysis/pipeline.ts:696-718), 'block:ads:*'
//                    (src/content/post-path/result-apply.ts:801-818, logger.ts:1073-1079),
//                    decision rail 'sponsored' (src/types/forensic.ts:107-108,
//                    src/core/policy/table.ts:112), accountType 'advertiser'
//                    (src/types/forensic.ts:1076-1089)
//   user-hidden      verdict 'blocked' written by the rule-based blockers
//                    (src/types/forensic.ts:295-300, logger.ts:621-636) with
//                    blockReason hashtag / ai-label / reel-surface /
//                    media-timeout (logger.ts:653, media-timeout.ts:145,
//                    reels-blocker.ts:319), and the parent blocklist
//                    'blocklist:<kind>:<rule>' (src/analysis/pipeline.ts:527-545).
//                    The ad marker is a user toggle too but has its own
//                    column, so it is kept out of this one to keep the two
//                    columns disjoint.
//   model-named      a judge read the item and flagged it: aiSource 'cloud' or
//                    'local' with no overrideOrigin (src/types/forensic.ts:182-204,
//                    :965-977) and verdict flagged (:267-290), and not a manual
//                    record: exactly flagProvenance(r) === 'judged' in
//                    src/forensics/flag-provenance.ts, by the same two structured
//                    fields and never by the detection-mode text, so the column
//                    and page one cannot disagree about a record (wiring audit
//                    13 Sep, C9). Never by severity: a blocked record carries a
//                    synthetic severity-10 'ai-content-block' technique
//                    (logger.ts:1044-1051).
//   surface          feedSource (src/types/post.ts:6-12): 'for-you', 'following',
//                    'profile', 'permalink', 'search' each keep their name;
//                    'unknown' or absent reads 'unknown' (not captured), which
//                    stays apart from 'other'; 'video' and 'manual' fall into
//                    'other'. DOM-side blocked records default to 'video'
//                    (logger.ts:1063-1069) and so read 'other'.
//   sitting          the 30-minute quiet gap with >= semantics, as
//                    BEHAVIOR_SCRIPT in src/forensics/html-export.ts:3922-3928,
//                    over record.timestamp; here in array order, not replay order.

import type { ForensicRecord } from '../types/forensic';

/** The five platforms, in the row order the export prints them. */
export const PLATFORM_ORDER: ReadonlyArray<ForensicRecord['platform']> =
  ['twitter', 'facebook', 'youtube', 'tiktok', 'instagram'];

export type SurfaceBucket = 'for-you' | 'following' | 'profile' | 'permalink' | 'search' | 'unknown' | 'other';

export interface PlatformRow {
  /** Internal platform id, or 'total' on the totals row. */
  platform: ForensicRecord['platform'] | 'total';
  /** Content records seen (kind is a DOM node kind); markers, environment and image analysis excluded. */
  impressions: number;
  /** Distinct content identities among the impressions that carry one. */
  uniquePosts: number;
  /** Impressions whose content identity appeared earlier in the whole array (the set seenBeforeIds returns). */
  extraCopies: number;
  /** Impressions carrying the platform's own ad marker, in any mode. */
  paidPlacements: number;
  /** Impressions hidden by one of the user's own rules. */
  userHidden: number;
  /** Impressions a judge model read and flagged. */
  modelNamed: number;
}

export interface FilterState {
  /** Keep only these platforms; undefined or empty means all. */
  platforms?: ReadonlyArray<ForensicRecord['platform']>;
  /** Keep only these surface buckets; undefined or empty means all. */
  surfaces?: ReadonlyArray<SurfaceBucket>;
  /** Keep only these 1-based sitting numbers; undefined or empty means all. */
  sittings?: ReadonlyArray<number>;
  /** true: only records seen before; false: only first sightings; undefined: both. */
  seenBefore?: boolean;
  /** Keep only impressions a judge named at this level (see severityLevel); undefined means any. */
  level?: SeverityLevel;
  /** Keep only impressions counted in this column of the numbers table; undefined means all impressions. */
  column?: NumbersColumn;
}

/** The export's three severity bands, the same cut the exposure summary draws: 6-10, 3-5, below 3. */
export type SeverityLevel = 'high' | 'medium' | 'low';

/** The table columns a reader can click to narrow the list to what the number counts. */
type NumbersColumn = 'uniquePosts' | 'extraCopies' | 'paidPlacements' | 'userHidden' | 'modelNamed';

const SYSTEM_MARKER_KINDS: ReadonlyArray<string> = [
  'reset-marker', 'month-rotation-marker', 'prune-marker', 'gap-marker',
  'heartbeat-marker', 'import-marker', 'repair-marker', 'redaction-marker',
  'reconcile-marker',
];

/** Sitting gap, milliseconds. Same constant as BEHAVIOR_SCRIPT. */
export const SITTING_GAP_MS = 30 * 60 * 1000;

/**
 * A reading the person asked for with the "read this" button (content/markers/read-this.ts):
 * a pass record whose detectionMode holds "read-this". The feed did not serve it, the
 * product did not decide on it, and it is usually a second record about a post that is
 * already here as its own impression. Until 2026-09-20 only the author-week count asked
 * (forensics/author-week.ts isReadingRecord, which now asks this); every number in an
 * export counted the reading as a serving, so a post read once and then sent to the reader
 * was "seen before: 1" and its author had "Servings 2" in the section about what the app
 * brings back.
 */
export function isButtonReading(r: Pick<ForensicRecord, 'detectionMode'>): boolean {
  return typeof r.detectionMode === 'string' && r.detectionMode.indexOf('read-this') !== -1;
}

/** A record the person could have seen: its kind is a DOM node kind or absent, and nobody asked for it. */
export function isImpression(r: ForensicRecord): boolean {
  if (isButtonReading(r)) return false;
  const k = r.kind;
  if (k === undefined) return true;
  if (k === 'image' || k === 'environment') return false;
  return SYSTEM_MARKER_KINDS.indexOf(k) === -1;
}

/**
 * The dedupe key: originalHash, which the logger computes as sha256 of the
 * caption. Null when the record holds the empty-caption placeholder instead
 * of content, so placeholders never collapse into one "post".
 */
export function contentIdentity(r: ForensicRecord): string | null {
  if (typeof r.originalHash !== 'string' || r.originalHash === '') return null;
  if (typeof r.originalText === 'string' && r.originalText.indexOf('[blocked:') === 0) return null;
  return r.originalHash;
}

/** The delivery prefix removed, as flag-provenance.ts baseDetectionMode. */
function baseMode(r: ForensicRecord): string {
  const m = typeof r.detectionMode === 'string' ? r.detectionMode : '';
  const p = 'late-after-rotation:';
  return m.indexOf(p) === 0 ? m.slice(p.length) : m;
}

function hasRail(r: ForensicRecord, name: string): boolean {
  const rails = r.decision && r.decision.rails;
  if (!rails) return false;
  for (let i = 0; i < rails.length; i++) if (rails[i].name === name) return true;
  return false;
}

function isManual(r: ForensicRecord): boolean {
  return r.feedSource === 'manual'
    || baseMode(r).indexOf('manual') === 0
    || (typeof r.id === 'string' && r.id.indexOf('fr-manual-') === 0);
}

/**
 * Which rule decided this record, as a short machine key, or null when a
 * judge's reading decided it. Classifies by detectionMode, decision rails,
 * overrideOrigin and aiSource only; never by severity or technique name.
 *
 * Keys: 'ad-marker', 'hashtag-block', 'ai-content-block', 'reel-surface',
 * 'media-timeout', 'word-filter', 'account-block', 'block:<reason>' for an
 * unlisted block reason, the overrideOrigin value verbatim for a product gate
 * ('identity-slur', 'profanity-tier', 'coded-harm', 'ad-hominem',
 * 'harm-floor', 'rage-format'), 'manual' for a hand-typed record, and 'rule'
 * when the record says a rule decided but not which.
 */
export function ruleLabel(r: ForensicRecord): string | null {
  if (isManual(r)) return 'manual';
  const mode = baseMode(r);
  const parts = mode.split(':');
  if (parts[0] === 'block') {
    const reason = parts[1] || '';
    if (reason === 'ads') return 'ad-marker';
    if (reason === 'hashtag') return 'hashtag-block';
    if (reason === 'ai-label') return 'ai-content-block';
    if (reason === 'reel-surface') return 'reel-surface';
    if (reason === 'media-timeout') return 'media-timeout';
    return reason ? 'block:' + reason : 'rule';
  }
  if (parts[0] === 'sponsored-ad') return 'ad-marker';
  if (parts[0] === 'blocklist') {
    const kind = parts[1] || '';
    if (kind === 'account') return 'account-block';
    if (kind === 'hashtag') return 'hashtag-block';
    return 'word-filter';
  }
  if (hasRail(r, 'sponsored')) return 'ad-marker';
  if (hasRail(r, 'blocklist')) return 'word-filter';
  if (r.overrideOrigin) return r.overrideOrigin;
  if (hasRail(r, 'identity-slur')) return 'identity-slur';
  if (hasRail(r, 'coded-harm')) return 'coded-harm';
  if (r.verdict === 'blocked') return 'rule';
  if (r.aiSource === 'rules' || r.aiSource === 'none') return 'rule';
  return null;
}

const USER_RULE_LABELS: ReadonlyArray<string> = [
  'word-filter', 'account-block', 'hashtag-block', 'ai-content-block',
  'reel-surface', 'media-timeout',
];

/** True for labels that are the user's own rule (the user-hidden column). The ad marker has its own column. */
export function isUserRule(label: string | null): boolean {
  return label !== null && USER_RULE_LABELS.indexOf(label) !== -1;
}

/** Any sign of the platform's own ad marker, in any mode. */
export function isPaidPlacement(r: ForensicRecord): boolean {
  const mode = baseMode(r);
  return mode.indexOf('sponsored-ad') === 0
    || mode.indexOf('block:ads') === 0
    || hasRail(r, 'sponsored')
    || r.accountType === 'advertiser';
}

/** Hidden by one of the user's own rules. */
export function isUserHidden(r: ForensicRecord): boolean {
  return isUserRule(ruleLabel(r));
}

/**
 * A judge model read the item and flagged it: flagProvenance 'judged', by the
 * structured fields only (aiSource, overrideOrigin, the manual markers). Rule
 * matches and manual records never count.
 *
 * Nor does a paid placement, whatever fields it carries (standing decision 1,
 * 2026-09-14: ads are never harm). An ad has its own column; letting one into
 * this one would put advertising back into the number that says a judge read
 * the item and named a technique.
 */
// The one place in src/ that compares a verdict to the flag words (flag-verdict.ts re-exports these for every
// reader; tests/repo/the-flag-verdict-has-one-reader.test.ts). Here because this file has no runtime import, so the
// chain analyzer loads it with plain node.
/** The record carries a flag verdict: flagged, flagged-hidden, or none (older builds wrote no verdict, and only on a
 *  flag; types/forensic.ts verdict). Before every other rule: advertising and "seen a lot" are each caller's next line. */
export function carriesFlagVerdict(r: Pick<ForensicRecord, 'verdict'>): boolean {
  const v = r.verdict;
  return v === 'flagged' || v === 'flagged-hidden' || v === undefined;
}

/** The flag verdict that also hid the item from the feed. */
export function carriesHideVerdict(r: Pick<ForensicRecord, 'verdict'>): boolean {
  return r.verdict === 'flagged-hidden';
}

/** "Seen a lot": a repeat-exposure mark alone. It is written at a fixed severity from how often a post or its source
 *  came back, with no reading of the content, so it is never a flag (the Head, 10 Oct 2026). */
export function isRepeatMarkOnly(r: Pick<ForensicRecord, 'techniques'>): boolean {
  return r.techniques?.length === 1 && r.techniques[0].name === 'repeat-exposure';
}

/** A flag that counts: a flag verdict on anything but "seen a lot". Advertising stays each caller's own rule. */
export function isCountedFlagVerdict(r: Pick<ForensicRecord, 'verdict' | 'techniques'>): boolean {
  return carriesFlagVerdict(r) && !isRepeatMarkOnly(r);
}

export function isModelNamed(r: ForensicRecord): boolean {
  if (!carriesFlagVerdict(r)) return false;
  if (isPaidPlacement(r)) return false;
  if (isManual(r)) return false;
  if (r.overrideOrigin) return false;
  // A repeat-exposure mark alone is a frequency observation, not a judge's
  // content reading (gem 74, 2026-09-27 recount 1: 104 of 368 "flagged by a
  // judge" were this shape, verdict left undefined by the mark itself).
  if (isRepeatMarkOnly(r)) return false;
  return r.aiSource === 'cloud' || r.aiSource === 'local';
}

/**
 * The band of an impression a judge named (isModelNamed), by its highest
 * technique severity: 6-10 high, 3-5 medium, below 3 low. Null for everything
 * else: an ad, a rule match or a pass has no level, so a level filter never
 * shows them.
 */
export function severityLevel(r: ForensicRecord): SeverityLevel | null {
  if (!isModelNamed(r)) return null;
  let max = 0;
  const t = r.techniques || [];
  for (let i = 0; i < t.length; i++) {
    if (typeof t[i].severity === 'number' && t[i].severity > max) max = t[i].severity;
  }
  return max >= 6 ? 'high' : max >= 3 ? 'medium' : 'low';
}

/** feedSource folded into the five named surfaces, 'unknown' (not captured) and 'other'. */
export function surfaceBucket(r: ForensicRecord): SurfaceBucket {
  const f = r.feedSource;
  if (f === 'for-you' || f === 'following' || f === 'profile' || f === 'permalink' || f === 'search') return f;
  if (f === undefined || f === 'unknown') return 'unknown';
  return 'other';
}

/**
 * Sittings: impressions in TIME order, a new sitting whenever the gap to the
 * previous impression's timestamp is 30 minutes or more. Returns record id to
 * 1-based sitting number, the earliest sitting first; non-impressions and
 * records with no parseable timestamp are absent.
 *
 * Time order, not array order, since 2026-09-20. A file is not always in time
 * order: records an import brings back are appended after newer ones, and a
 * step backwards in time is a negative gap, which is never 30 minutes or more.
 * Read on a chain holding imported records: "sitting 6" held 6 Facebook items
 * from 3 September and 8 X items from 10 August. The sort is stable, so a file
 * already in time order numbers its sittings exactly as before. The panel has
 * always sorted first (ui/dashboard/components/overview-data.ts).
 */
export function sittingByRecordId(records: ReadonlyArray<ForensicRecord>): { [id: string]: number } {
  const out: { [id: string]: number } = {};
  const timed: Array<{ id: string; t: number; i: number }> = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (!isImpression(r)) continue;
    const t = +new Date(r.timestamp);
    if (isNaN(t)) continue;
    timed.push({ id: r.id, t, i });
  }
  timed.sort((a, b) => (a.t !== b.t ? a.t - b.t : a.i - b.i));
  let sitting = 0;
  let lastEnd = NaN;
  for (let k = 0; k < timed.length; k++) {
    if (sitting === 0 || timed[k].t - lastEnd >= SITTING_GAP_MS) sitting++;
    lastEnd = timed[k].t;
    out[timed[k].id] = sitting;
  }
  return out;
}

/** Ids of impressions whose content identity appeared on an earlier impression in the array. */
export function seenBeforeIds(records: ReadonlyArray<ForensicRecord>): { [id: string]: true } {
  const seen: { [hash: string]: true } = {};
  const out: { [id: string]: true } = {};
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (!isImpression(r)) continue;
    const key = contentIdentity(r);
    if (key === null) continue;
    if (seen[key]) out[r.id] = true;
    else seen[key] = true;
  }
  return out;
}

function has<T>(list: ReadonlyArray<T> | undefined, v: T): boolean {
  return !list || list.length === 0 || list.indexOf(v) !== -1;
}

/**
 * The impression an image analysis record belongs to: the first post or
 * video impression of the same platform that carries the same parentVideoId,
 * or whose postUrl ends in that id. Null when the file holds no such record.
 */
function parentImpression(records: ReadonlyArray<ForensicRecord>, image: ForensicRecord): ForensicRecord | null {
  const pid = image.parentVideoId;
  if (typeof pid !== 'string' || pid === '') return null;
  let byUrl: ForensicRecord | null = null;
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.platform !== image.platform || !isImpression(r)) continue;
    if (r.kind === 'comment' || r.kind === 'reply') continue;
    if (r.parentVideoId === pid) return r;
    if (byUrl === null && typeof r.postUrl === 'string' && r.postUrl !== '') {
      const url = r.postUrl.split('?')[0].replace(/\/+$/, '');
      if (url.slice(-(pid.length + 1)) === '/' + pid) byUrl = r;
    }
  }
  return byUrl;
}

/**
 * Records that pass every set filter. Sitting numbers and seen-before are
 * computed over the WHOLE array first, so filtering never changes what
 * "earlier" or "sitting 3" means. An image analysis record follows the
 * impression it belongs to (see parentImpression); with no parent in the
 * file it is dropped whenever surface, sitting or seen-before is set. Every
 * other non-impression (markers, environment) is kept only when no filter
 * but platform is set, so a table of zeros never sits above a list.
 */
export function applyFilters(records: ReadonlyArray<ForensicRecord>, filter: FilterState): ForensicRecord[] {
  const surfaceSet = !!(filter.surfaces && filter.surfaces.length);
  const sittings = filter.sittings && filter.sittings.length ? sittingByRecordId(records) : null;
  const column = filter.column;
  const before = filter.seenBefore !== undefined || column === 'uniquePosts' || column === 'extraCopies'
    ? seenBeforeIds(records) : null;
  const narrows = surfaceSet || sittings !== null || filter.seenBefore !== undefined
    || filter.level !== undefined || column !== undefined;
  function inColumn(r: ForensicRecord): boolean {
    if (column === 'uniquePosts') return contentIdentity(r) !== null && !(before && before[r.id]);
    if (column === 'extraCopies') return contentIdentity(r) !== null && !!(before && before[r.id]);
    if (column === 'paidPlacements') return isPaidPlacement(r);
    if (column === 'userHidden') return isUserHidden(r);
    if (column === 'modelNamed') return isModelNamed(r);
    return true;
  }
  function passes(r: ForensicRecord): boolean {
    if (surfaceSet && !has(filter.surfaces, surfaceBucket(r))) return false;
    if (sittings && !has(filter.sittings, sittings[r.id])) return false;
    if (filter.seenBefore !== undefined && (!!before && before[r.id] === true) !== filter.seenBefore) return false;
    if (filter.level !== undefined && severityLevel(r) !== filter.level) return false;
    if (!inColumn(r)) return false;
    return true;
  }
  const out: ForensicRecord[] = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (!has(filter.platforms, r.platform)) continue;
    if (isImpression(r)) {
      if (!passes(r)) continue;
    } else if (narrows) {
      if (r.kind !== 'image') continue;
      const parent = parentImpression(records, r);
      if (parent === null || !passes(parent)) continue;
    }
    out.push(r);
  }
  return out;
}

function emptyRow(platform: PlatformRow['platform']): PlatformRow {
  return { platform, impressions: 0, uniquePosts: 0, extraCopies: 0, paidPlacements: 0, userHidden: 0, modelNamed: 0 };
}

/**
 * One row per platform in PLATFORM_ORDER plus a 'total' row, over every
 * record in the array. With a filter, the filter is applied first (see
 * applyFilters). Seen-before is decided over the WHOLE array, the same set
 * seenBeforeIds gives the filter, so a copy whose first sighting sits outside
 * the filter still reads as seen before; unique posts are the impressions
 * with a content identity that are not copies.
 */
export function computePlatformRows(records: ReadonlyArray<ForensicRecord>, filter?: FilterState): PlatformRow[] {
  const set = filter ? applyFilters(records, filter) : records;
  const before = seenBeforeIds(records);
  const rows: { [p: string]: PlatformRow } = {};
  for (let i = 0; i < PLATFORM_ORDER.length; i++) rows[PLATFORM_ORDER[i]] = emptyRow(PLATFORM_ORDER[i]);
  const total = emptyRow('total');
  for (let i = 0; i < set.length; i++) {
    const r = set[i];
    if (!isImpression(r)) continue;
    const row = rows[r.platform];
    if (!row) continue;
    row.impressions++;
    total.impressions++;
    if (contentIdentity(r) !== null) {
      if (before[r.id]) { row.extraCopies++; total.extraCopies++; } else { row.uniquePosts++; total.uniquePosts++; }
    }
    if (isPaidPlacement(r)) { row.paidPlacements++; total.paidPlacements++; }
    if (isUserHidden(r)) { row.userHidden++; total.userHidden++; }
    if (isModelNamed(r)) { row.modelNamed++; total.modelNamed++; }
  }
  const out: PlatformRow[] = [];
  for (let i = 0; i < PLATFORM_ORDER.length; i++) out.push(rows[PLATFORM_ORDER[i]]);
  out.push(total);
  return out;
}
