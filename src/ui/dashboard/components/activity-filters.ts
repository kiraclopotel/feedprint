// ─── Activity feed: pure filter predicates and derivations ───
// Split out of ActivityTab.tsx (Proposal B step 7) so the count === click
// invariant (tests/unit/ui/dashboard/components/dashboard-count-filter-invariant.test.ts) is
// exercised on the same predicate the feed renders, without mounting React.
// ActivityTab keeps the state and the memo wrappers; nothing here reads
// React.

import type { ForensicRecord } from '../../../types/forensic';
import type { ForensicStats, ParentFeedback } from '../../../forensics/store';
import { canonicalizeTechniqueForStats } from '../../../forensics/store';
import type { IntegrityResult } from '../../../forensics/chain-integrity';
import { authorProfileKey } from '../../../forensics/author-store';
import { isBlockedItem, isFlaggedItem, isFlaggedVerdict, isMarker, isRoomSummary, isTextPlaceholder, readableText } from '../record-sets';
import { shownText } from '../shown-text';
import type { ResolvedUiLanguage } from '../../../types/ui-language';
import {
  type FeedFilter, matchesTypeFilter, parseSerialQuery,
  type AccountFilter, matchesAccountFilter,
} from './feed-filters';
import type { FeedSource } from '../../../types/post';
import {
  type WhenFilter, type WhenPreset, WHEN_OPTIONS, type SeverityBand, SEVERITY_OPTIONS,
  type KindFilter, KIND_OPTIONS, RAIL_WHAT_OPTIONS,
  type ModeFilter, MODE_OPTIONS, matchesMode, matchesModel, modelKey,
  matchesWhen, matchesSeverity, matchesKind,
  type SeenFilter, SEEN_OPTIONS, matchesSeen, matchesSurface, surfaceKey,
  matchesSession, matchesAuthor,
} from './filter-rail';
import { recordMatchesBucket, type BucketId } from './SafetyCategoriesPanel';
import type { RecordGroup } from './PostGroupCard';
import {
  PLATFORM_COLORS,
  TECHNIQUE_COLORS,
  PRETTY_TECHNIQUE,
  BLOCKED_CATEGORY_LABELS,
  BLOCKED_CATEGORY_COLORS,
} from './color-maps';

// `block:<reason>:<token>` reasons emitted by content/engagement/*. Only the
// `<reason>` segment matters; hashtag + ai-label both collapse under "AI-content
// videos" in the lookup map (see color-maps.ts).
function categorizeBlockedRecord(r: ForensicRecord): string {
  const dm = r.detectionMode;
  if (!dm || !dm.startsWith('block:')) return 'Other blocks';
  const reason = dm.slice(6).split(':')[0];
  return BLOCKED_CATEGORY_LABELS[reason] ?? `Other (${reason})`;
}

// Read the verdict-filter hint from `location.hash`. The popup's metrics-hidden
// line links to `dashboard.html#blocked`. (FeedFilter lives in ./feed-filters.)
export function initialFilterFromHash(): FeedFilter {
  if (typeof location === 'undefined') return 'all';
  const h = location.hash.replace(/^#/, '').toLowerCase();
  if (h === 'flagged' || h === 'blocked' || h === 'disputed' || h === 'rewritten') return h as FeedFilter;
  return 'all';
}

/**
 * Which body an EMPTY feed renders. Exported pure (computeFeedDividers idiom)
 * so tests/unit/ui/dashboard/components/dashboard-load-failed.test.ts can pin the ranking.
 *
 * A failed read outranks everything: with nothing read, neither "nothing
 * recorded yet" nor "no records match" is a statement the feed can honestly
 * make — the store's own contract (getRecords: A FAILED READ IS NOT AN EMPTY
 * CHAIN) forbids rendering one as the other. The welcome state is reserved for
 * a store that was actually read and is genuinely empty.
 */
export type FeedEmptyKind = 'load-failed' | 'welcome' | 'filtered';
export function feedEmptyKind(anyFilterActive: boolean, readFailed: boolean): FeedEmptyKind {
  if (readFailed) return 'load-failed';
  return anyFilterActive ? 'filtered' : 'welcome';
}

/** Every narrowing the feed applies. `search` is the DEBOUNCED value. */
export interface ActivityFilterState {
  filter: FeedFilter;
  platformFilter: 'all' | ForensicRecord['platform'];
  accountFilter: AccountFilter;
  whenFilter: WhenFilter;
  severityFilter: SeverityBand | null;
  kindFilter: KindFilter | null;
  modeFilter: ModeFilter | null;
  modelFilter: string | null;
  techniqueFilter: string | null;
  hiddenCategoryFilter: string | null;
  safetyBucketFilter: BucketId | null;
  recordIdsFilter: Set<string> | null;
  roomUrlFilter: string | null;
  hourRangeFilter: [number, number] | null;
  /** Surface the item sat on (record.feedSource, folded by surfaceKey). */
  surfaceFilter: FeedSource | null;
  /** One content-script load (record.surfaceSessionId). Token only, no rail list. */
  sessionFilter: string | null;
  /** 'repeat' = the chain already held this originalHash on an earlier record. */
  seenBeforeFilter: SeenFilter | null;
  /** One author: a handle or a platform-scoped authorProfileKey (matchesAuthor). */
  authorFilter: string | null;
  search: string;
}

export type RailAxis =
  | 'what' | 'place' | 'who' | 'when' | 'severity' | 'kind' | 'mode' | 'model' | 'surface' | 'seen';

/** Every axis a side panel can be counted "except": the rail axes plus the
 *  panel-owned ones. recordsExcept() takes these. */
export type ExceptAxis = RailAxis | 'technique' | 'hidden-category' | 'safety' | 'author' | 'session';

/**
 * Per-record context the predicate needs beyond the filter state: values
 * derived once over the whole record array, never per evaluation.
 * `seenBeforeIds` is computeSeenBeforeIds(records).
 */
export interface FilterContext {
  seenBeforeIds: ReadonlySet<string>;
}
const EMPTY_CONTEXT: FilterContext = { seenBeforeIds: new Set() };

// Q25: one lowercase haystack per record, built once per record set. The
// search predicate used to re-lowercase originalText plus every technique
// name per record per evaluation; with railCounts evaluating passes six
// times per record, one keystroke paid that allocation storm across the
// whole chain. Newline separators prevent cross-field matches.
const STAND_IN_LANGS: readonly ResolvedUiLanguage[] = ['en', 'ro', 'es', 'pt-BR'];

export function buildSearchIndex(records: ForensicRecord[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const r of records) {
    index.set(r.id, [
      // The marker a caption-less hidden item is stored under is not something anyone searches for; what the row reads
      // as is, in every language the dashboard speaks, so "ad" or "anuncio" finds a hidden ad whatever the screen's language.
      readableText(r),
      ...STAND_IN_LANGS.map((lang) => (isTextPlaceholder(r) ? shownText(r, lang) : '')),
      r.platform,
      // An account is found by what the row shows and by what it was called: the handle (with or without its @, the
      // fold takes the @ off both sides), the display name beside it, and the account a comment sits under. The handle
      // is also kept as words ("alice_w" as "alice w") so a quoted phrase finds it as a person would say it.
      r.author ?? '',
      (r.author ?? '').replace(/[._\-]+/g, ' '),
      r.authorName ?? '',
      r.roomAuthor ?? '',
      r.verdict ?? '',
      r.detectionMode ?? '',
      ...r.techniques.flatMap(t => [PRETTY_TECHNIQUE[t.name] ?? t.name, t.name]),
      r.neutralizedText ?? '',
    ].map(foldSearchText).join('\n'));
  }
  return index;
}

// Letters that carry their mark inside the letter and so do not come apart under NFD: a person typing "lukasz" means
// "Łukasz", "o" means "ø", "ss" means "ß". Applied after lower case, to both sides.
const UNMARKED_LETTERS: Record<string, string> = {
  'ł': 'l', 'ø': 'o', 'đ': 'd', 'ð': 'd', 'ħ': 'h', 'ı': 'i', 'ŧ': 't', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'þ': 'th',
};
const UNMARKED_LETTER = new RegExp(`[${Object.keys(UNMARKED_LETTERS).join('')}]`, 'gu');

/**
 * The one fold both sides of the search use, so they cannot drift: accents removed (NFKD, then the combining marks
 * go, so "criză" and "criza" are one word, Romanian ș and ş too, and a display name set in a fancy alphabet reads as
 * the plain letters), lower case, the letters that hold their mark inside them made plain, the @ that starts a handle
 * dropped (so "@alice" and "alice" are one word, in the query, in the author and in a mention in the text), runs of
 * white space one space.
 */
export function foldSearchText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(UNMARKED_LETTER, (c) => UNMARKED_LETTERS[c] ?? c)
    .replace(/(^|[\s("'\[{])@+(?=[\p{L}\p{N}_])/gu, '$1')
    .replace(/\s+/g, ' ');
}

// What a person typed, as the things every one of which must be in the record: a quoted phrase is one (it must
// appear as written, in order), every other word is one. The same query is asked of every record per keystroke, so
// the last one is kept.
let lastQuery = '';
let lastTerms: string[] = [];
function searchTerms(raw: string): string[] {
  if (raw === lastQuery) return lastTerms;
  const terms: string[] = [];
  for (const m of foldSearchText(raw).matchAll(/"([^"]*)"|(\S+)/g)) {
    const term = (m[1] ?? m[2] ?? '').replace(/^"+|"+$/g, '').trim();
    if (term) terms.push(term);
  }
  lastQuery = raw;
  lastTerms = terms;
  return terms;
}

// Per-record predicate for the "What happened" axis (the FeedFilter). The
// verdict-set values (flagged/blocked/disputed/rewritten/repeat-offenders)
// keep the exact predicates the pre-rail chip rows used; the pure kind /
// verdict / source values delegate to matchesTypeFilter.
export function matchesWhat(
  r: ForensicRecord,
  f: FeedFilter,
  parentFeedback: Map<string, ParentFeedback>,
  recidivistSet: Set<string>,
): boolean {
  switch (f) {
    case 'all':       return true;
    // The same flagged and blocked items the badge and the Statistics bar count, so an ad
    // the person's own rule hid is listed under blocked, never under flagged.
    case 'flagged':   return isFlaggedItem(r);
    case 'blocked':   return isBlockedItem(r);
    // Chain markers carry verdict 'pass' (store.ts cap-prune marker) but say
    // nothing about content; Statistics already leaves them out of "passed",
    // so the rail count and the rows it opens do too (finding 19).
    case 'passed':    return !isMarker(r) && matchesTypeFilter(r, f);
    case 'disputed':  return parentFeedback.get(r.id)?.feedback === 'disputed';
    case 'rewritten':
      return !!r.neutralizedText && r.neutralizedText.length > 0 && r.neutralizedText !== r.originalText;
    case 'repeat-offenders':
      // recidivistSet is built from flagged records, so the option must
      // intersect with that same exposure set — otherwise a recidivist author's
      // passed / blocked / environment records leak into a feed labelled
      // "Repeat accounts", over-counting vs the rail panel.
      //
      // Both sides moved together on 2026-09-19, from the two verdicts spelled
      // out to isFlaggedVerdict, which also counts a legacy record carrying no
      // verdict. That is what account-ledger.ts already counts for the rows the
      // panel shows, and its header says the panel, the Overview and Statistics
      // must never disagree on what a flag is. This predicate mirrors the set
      // by design, so it could not be widened alone and was not.
      return isFlaggedItem(r)
        && recidivistSet.has(authorProfileKey(r.author, r.platform));
    default:          return matchesTypeFilter(r, f);
  }
}

// One predicate composition for the whole feed. Filters compose by
// intersection, so predicate order is irrelevant to the result — this is the
// same math the pre-rail step-by-step pipeline applied. `except` skips one
// rail axis so the rail's per-option counts are click-through counts (the
// count an option shows === the rows it opens; the accountCounts precedent
// that fixed "Groups shows 360 but opens empty").
export function recordPasses(
  r: ForensicRecord,
  s: ActivityFilterState,
  what: (r: ForensicRecord, f: FeedFilter) => boolean,
  searchIndex: Map<string, string>,
  except?: ExceptAxis,
  ctx: FilterContext = EMPTY_CONTEXT,
): boolean {
  if (except !== 'what' && !what(r, s.filter)) return false;
  // A platform or account pick is a statement about content; chain markers
  // are not content (computePlatFreq already leaves them out), so a narrowed
  // place/who axis drops them. 'all' keeps them: the unnarrowed feed lists
  // the whole chain and its count must keep equalling its rows.
  if (except !== 'place' && s.platformFilter !== 'all'
    && (r.platform !== s.platformFilter || isMarker(r))) return false;
  if (except !== 'who' && s.accountFilter !== 'all'
    && (!matchesAccountFilter(r, s.accountFilter) || isMarker(r))) return false;
  if (except !== 'when' && !matchesWhen(r, s.whenFilter)) return false;
  if (except !== 'severity' && s.severityFilter && !matchesSeverity(r, s.severityFilter)) return false;
  if (except !== 'kind' && s.kindFilter && !matchesKind(r, s.kindFilter)) return false;
  if (except !== 'mode' && s.modeFilter && !matchesMode(r, s.modeFilter)) return false;
  if (except !== 'model' && s.modelFilter && !matchesModel(r, s.modelFilter)) return false;
  if (except !== 'surface' && s.surfaceFilter && !matchesSurface(r, s.surfaceFilter)) return false;
  if (except !== 'seen' && s.seenBeforeFilter && !matchesSeen(r, s.seenBeforeFilter, ctx.seenBeforeIds)) return false;
  if (except !== 'session' && s.sessionFilter && !matchesSession(r, s.sessionFilter)) return false;
  if (except !== 'author' && s.authorFilter && !matchesAuthor(r, s.authorFilter)) return false;
  if (except !== 'technique' && s.techniqueFilter) {
    // The Technique-frequency counter (techFreq) keys off stats.byTechnique,
    // which counts CANONICAL technique names over the FLAGGED-only set
    // (computeStats filters to flagged/flagged-hidden/legacy-undefined). To keep
    // counter === click-filter result, restrict to that same exposure set and
    // canonicalize each technique name before comparing.
    if (!(isFlaggedVerdict(r)
      && r.techniques.some(t => canonicalizeTechniqueForStats(t.name) === s.techniqueFilter))) return false;
  }
  // The "Metrics hidden" bars count over BLOCKED records only (computeHiddenFreq
  // is fed the blocked subset), and categorizeBlockedRecord answers 'Other
  // blocks' for any record without a block: mode. Without the verdict
  // intersect "Other blocks 4" opened every passed record (finding 7).
  if (except !== 'hidden-category' && s.hiddenCategoryFilter
    && (r.verdict !== 'blocked' || categorizeBlockedRecord(r) !== s.hiddenCategoryFilter)) return false;
  // Reuse the SafetyCategoriesPanel's own matcher so the filtered feed
  // matches the panel's per-bucket count exactly.
  if (except !== 'safety' && s.safetyBucketFilter && !recordMatchesBucket(r, s.safetyBucketFilter)) return false;
  if (s.recordIdsFilter && !s.recordIdsFilter.has(r.id)) return false;
  if (s.roomUrlFilter && (r.roomUrl ?? r.postUrl) !== s.roomUrlFilter) return false;
  if (s.hourRangeFilter) {
    const [lo, hi] = s.hourRangeFilter;
    const h = new Date(r.timestamp).getHours();
    if (!Number.isFinite(h)) return false;
    // Support wrap-around ranges (e.g. 22→1 late-night) as well as plain ones.
    if (!(lo <= hi ? (h >= lo && h <= hi) : (h >= lo || h <= hi))) return false;
  }
  if (s.search.trim()) {
    const serial = parseSerialQuery(s.search);
    if (serial !== null) {
      // #serial jump — find the record by its chain position number
      if (r.chainPosition !== serial) return false;
    } else {
      const haystack = searchIndex.get(r.id);
      if (haystack === undefined || !searchTerms(s.search).every(term => haystack.includes(term))) return false;
    }
  }
  return true;
}

// Trust invariant: when ANY filter narrows the feed, render a FLAT list so
// every matched record is visible. The default (unfiltered) feed reads like
// the record chain it mirrors — post → thread groups in record/timestamp order. But
// tree view groups records under their post; an unexpanded post group hides
// flagged child comments, so a counter that says "31 flagged" could click
// through to an apparently-empty (collapsed) tree. Filtering implies the
// parent wants to SEE the matches, not re-expand each post — so any
// verdict/technique/flagger/safety/platform/hidden/drill selection flattens.
// (The former tree/flat toggle is removed per the redesign brief; flattening
// on filter is the surviving behavior that holds the count↔filter invariant
// in tests/unit/ui/dashboard/components/dashboard-count-filter-invariant.test.ts.)
// `rawSearch` is the undebounced input: typing flattens at once.
export function isAnyFilterActive(s: Omit<ActivityFilterState, 'search'>, rawSearch: string): boolean {
  return s.filter !== 'all'
    || s.platformFilter !== 'all'
    || s.accountFilter !== 'all'
    || s.techniqueFilter !== null
    || s.hiddenCategoryFilter !== null
    || s.safetyBucketFilter !== null
    || s.recordIdsFilter !== null
    || s.roomUrlFilter !== null
    || s.hourRangeFilter !== null
    || s.whenFilter !== 'any'
    || s.severityFilter !== null
    || s.kindFilter !== null
    || s.modeFilter !== null
    || s.modelFilter !== null
    || s.surfaceFilter !== null
    || s.sessionFilter !== null
    || s.seenBeforeFilter !== null
    || s.authorFilter !== null
    || rawSearch.trim().length > 0;
}

/**
 * The records that pass every active filter EXCEPT `axis`: what a side panel
 * counts over so its numbers equal the rows a click on it opens (the same
 * except-axis idea computeRailCounts uses per option; finding 8).
 */
export function recordsExcept(
  records: readonly ForensicRecord[],
  passes: (r: ForensicRecord, except?: ExceptAxis) => boolean,
  axis: ExceptAxis,
): ForensicRecord[] {
  return records.filter((r) => passes(r, axis));
}

export interface RailCounts {
  place: Record<string, number>;
  what: Record<string, number>;
  who: Record<AccountFilter, number>;
  when: Record<WhenPreset, number>;
  severity: Record<SeverityBand, number>;
  kind: Record<KindFilter, number>;
  mode: Record<ModeFilter, number>;
  /** Keyed by modelKey(); every key present in the record set appears, so the rail's option list and its counts agree. */
  model: Record<string, number>;
  /** Keyed by surfaceKey(); every surface present appears. */
  surface: Record<string, number>;
  seen: Record<SeenFilter, number>;
}

const ACCOUNT_CHIPS: ReadonlySet<string> = new Set<AccountFilter>(['person', 'group', 'page', 'advertiser']);
/** The chip a record's accountType counts under; anything outside the four
 *  known chips (or missing) sits under 'person', the same fallback
 *  matchesAccountFilter applies, so the count never lands on an unknown key
 *  as NaN (finding 27). */
function accountChipOf(r: ForensicRecord): AccountFilter {
  const a = r.accountType as string | undefined;
  return a !== undefined && ACCOUNT_CHIPS.has(a) ? (a as AccountFilter) : 'person';
}

// Live rail counts: for each axis, count over the records passing every
// OTHER axis, tallied per option — so every count is a click-through count.
export function computeRailCounts(
  records: ForensicRecord[],
  passes: (r: ForensicRecord, except?: RailAxis) => boolean,
  what: (r: ForensicRecord, f: FeedFilter) => boolean,
  now: Date = new Date(),
  ctx: FilterContext = EMPTY_CONTEXT,
): RailCounts {
  const place: Record<string, number> = { all: 0 };
  const whatCounts: Record<string, number> = {};
  const who: Record<AccountFilter, number> = { all: 0, person: 0, group: 0, page: 0, advertiser: 0 };
  const when = { any: 0, today: 0, yesterday: 0, last7: 0, evening: 0 } as Record<WhenPreset, number>;
  const severity = { high: 0, medium: 0, low: 0 } as Record<SeverityBand, number>;
  const kind = { posts: 0, comments: 0, videos: 0, images: 0 } as Record<KindFilter, number>;
  const mode = { relaxed: 0, moderate: 0, strict: 0 } as Record<ModeFilter, number>;
  const model: Record<string, number> = {};
  const surface: Record<string, number> = {};
  const seen = { repeat: 0, first: 0 } as Record<SeenFilter, number>;
  for (const r of records) {
    model[modelKey(r)] = model[modelKey(r)] ?? 0;
    surface[surfaceKey(r)] = surface[surfaceKey(r)] ?? 0;
    const marker = isMarker(r);
    // Markers count under 'all' (the unnarrowed feed lists them) but under no
    // platform or account chip: the predicate drops them once either axis is
    // narrowed (finding 19), so the per-chip count stays a click-through count.
    if (passes(r, 'place')) { place.all++; if (!marker) place[r.platform] = (place[r.platform] ?? 0) + 1; }
    if (passes(r, 'what')) for (const k of RAIL_WHAT_OPTIONS) { if (what(r, k)) whatCounts[k] = (whatCounts[k] ?? 0) + 1; }
    if (passes(r, 'who')) { who.all++; if (!marker) who[accountChipOf(r)]++; }
    if (passes(r, 'when')) for (const w of WHEN_OPTIONS) { if (matchesWhen(r, w, now)) when[w]++; }
    if (passes(r, 'severity')) for (const s of SEVERITY_OPTIONS) { if (matchesSeverity(r, s)) severity[s]++; }
    if (passes(r, 'kind')) for (const k of KIND_OPTIONS) { if (matchesKind(r, k)) kind[k]++; }
    if (passes(r, 'mode')) for (const m of MODE_OPTIONS) { if (matchesMode(r, m)) mode[m]++; }
    if (passes(r, 'model')) model[modelKey(r)]++;
    if (passes(r, 'surface')) surface[surfaceKey(r)]++;
    if (passes(r, 'seen')) for (const s of SEEN_OPTIONS) { if (matchesSeen(r, s, ctx.seenBeforeIds)) seen[s]++; }
  }
  return { place, what: whatCounts, who, when, severity, kind, mode, model, surface, seen };
}

export interface FreqBar { width: number; value: number; color: string }

export function computeTechFreq(stats: ForensicStats | null): Array<FreqBar & { rawName: string; name: string }> {
  if (!stats) return [];
  const entries = Object.entries(stats.byTechnique).sort((a, b) => b[1] - a[1]).slice(0, 7);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return entries.map(([rawName, v]) => ({
    rawName,
    name: PRETTY_TECHNIQUE[rawName] ?? rawName,
    color: TECHNIQUE_COLORS[rawName] ?? 'var(--fw-muted)',
    width: Math.round((v / max) * 100),
    value: v,
  }));
}

// Count ALL records per platform so this rail agrees with the platform
// tabs above the feed. stats.byPlatform counts flagged-only — showing it
// here under the unqualified title "Platform breakdown" made platforms
// with zero flags (e.g. 17 Instagram records, 0 flagged) vanish entirely.
export function computePlatFreq(records: ForensicRecord[]): Array<FreqBar & { key: string; label: string }> {
  const counts: Record<string, number> = {};
  for (const r of records) {
    if (isMarker(r)) continue;
    counts[r.platform] = (counts[r.platform] ?? 0) + 1;
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return entries.map(([name, v]) => ({
    key: name,
    label: name + '.com',
    color: PLATFORM_COLORS[name] ?? 'var(--fw-muted)',
    width: Math.round((v / max) * 100),
    value: v,
  }));
}

export function computeHiddenFreq(blocked: ForensicRecord[]): Array<FreqBar & { name: string }> {
  const counts: Record<string, number> = {};
  for (const r of blocked) {
    const cat = categorizeBlockedRecord(r);
    counts[cat] = (counts[cat] ?? 0) + 1;
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return entries.map(([name, v]) => ({
    name,
    color: BLOCKED_CATEGORY_COLORS[name] ?? 'var(--fw-purple)',
    width: Math.round((v / max) * 100),
    value: v,
  }));
}

export function computeCommentCountByRootRecordId(groups: RecordGroup[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const g of groups) {
    const commentCount = g.children.filter(
      (r) => r.kind !== 'post' && r.kind !== 'video' && !isRoomSummary(r),
    ).length;
    const roots = (g.postRecord ? [g.postRecord, ...g.children] : g.children)
      .filter((r) => r.kind === 'post' || r.kind === 'video');
    for (const root of roots) map.set(root.id, commentCount);
  }
  return map;
}

// Chain-broken signal (queue: in-feed chain-broken alert). The Forensics tab
// owns the full ChainBanner; the Activity feed gets a compact alert only when
// the chain actually fails to verify. "broken" per-record statuses are the
// definitively-failed rows the parent should Review.
export function computeBrokenRecords(
  integrity: IntegrityResult | null | undefined,
  records: ForensicRecord[],
): ForensicRecord[] {
  if (!integrity || integrity.valid !== false) return [];
  const per = integrity.perRecord;
  if (per) {
    const failed = records.filter(r => per.get(r.id) === 'broken');
    if (failed.length > 0) return failed;
  }
  // Walker bails on first failure, so perRecord may not flag a row even
  // though the chain is invalid; fall back to the record at brokenAt.
  if (typeof integrity.brokenAt === 'number') {
    const sorted = [...records].sort((a, b) => (a.chainPosition ?? 0) - (b.chainPosition ?? 0));
    const offender = sorted[integrity.brokenAt];
    if (offender) return [offender];
  }
  return [];
}
