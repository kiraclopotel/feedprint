// ─── Activity tab ───
// Moved out of Dashboard.tsx (Proposal B step 7). Owns the feed's filter
// state, the rail, the trust line, the windowed timeline and the side rail.

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { ForensicRecord } from '../../../types/forensic';
import { type AuthorEscalation } from '../../../forensics/analytics';
import { ForensicStats, ParentFeedback, FORENSIC_RECORD_CAP } from '../../../forensics/store';
import type { IntegrityResult } from '../../../forensics/chain-integrity';
import { isMarker } from '../record-sets';
import { authorProfileKey } from '../../../forensics/author-store';
import { useDashboardT, useUiLanguage } from '../../../i18n/react';
import { dashboardWords } from '../dashboard-words';
import { formatDateLocal, formatDateLongLocal, formatDayMonthLongLocal, localDayKey } from '../../shared/format-time';
import type { ResolvedUiLanguage } from '../../../types/ui-language';
import { FeedCard, TimelineRow } from './FeedCard';
import { type FeedFilter, type AccountFilter, ACCOUNT_FILTER_CHIPS } from './feed-filters';
import { GroupBehaviorPanel } from './GroupBehaviorPanel';
import { buildGrowthByRecordId } from './metric-growth';
import { PostGroupCard, type RecordGroup } from './PostGroupCard';
import { groupRecordsByPost } from './group-records';
import { foldMarkerRunGroups, foldMarkerRunRecords, isMarkerRunGroup } from './marker-runs';
import { MarkerRunLine } from './MarkerRunLine';
import { type ActivityDrill, computeFeedDividers } from './activity-drill';
import { sortGroupsWorstFirst, sortRecordsWorstFirst } from './feed-sort';
import { useVirtualScroll } from './use-virtual-scroll';
import { FilterRail, type RailGroupSpec } from './FilterRail';
import {
  type WhenFilter, WHEN_OPTIONS, type SeverityBand, SEVERITY_OPTIONS,
  type KindFilter, KIND_OPTIONS, RAIL_WHAT_OPTIONS,
  type ModeFilter, MODE_OPTIONS, MODEL_NONE, modelOptions,
  type SeenFilter, SEEN_OPTIONS, surfaceOptions, computeSeenBeforeIds,
  isWhenRange, whenRangeFromDrill, authorFilterHandle,
  deriveShowingTokens,
} from './filter-rail';
import type { FeedSource } from '../../../types/post';
import { RecidivistAuthorsPanel, computeRecidivistSet } from './RecidivistAuthorsPanel';
import { SafetyCategoriesPanel, SAFETY_BUCKET_LABELS, type BucketId } from './SafetyCategoriesPanel';
import { PLATFORM_LABELS, PRETTY_TECHNIQUE } from './color-maps';
import { FileText, X, ShieldAlert } from '../../shared/icons/lucide';
import { formatCount } from '../../shared/format-number';
import { receiptsRuns } from '../../../storage/switch-scope';
import {
  type ActivityFilterState, type ExceptAxis, type FilterContext,
  initialFilterFromHash, feedEmptyKind, buildSearchIndex,
  matchesWhat as matchesWhatPure, recordPasses, isAnyFilterActive, recordsExcept,
  computeRailCounts, computeTechFreq, computePlatFreq, computeHiddenFreq,
  computeCommentCountByRootRecordId, computeBrokenRecords,
} from './activity-filters';

export function ActivityTab({
  records, stats, parentFeedback, settings,
  onConfirm, onDispute, onViewOriginal, onRecheck,
  drill,
  integrity, onVerify, onReviewChain,
  escalations,
  archiveLoading,
  archivedCount,
  archivesIncluded,
  archivedOlderCount = 0,
  flaggedAllMonths = 0,
  flaggedAllMonthsTitle,
  liveCount,
  readFailed, onRetry,
  readingOffered = true,
}: {
  records: ForensicRecord[];
  stats: ForensicStats | null;
  parentFeedback: Map<string, ParentFeedback>;
  settings: { features?: { 'hide-engagement-metrics'?: { enabled?: boolean } } };
  onConfirm: (record: ForensicRecord) => void;
  onDispute: (record: ForensicRecord) => void;
  onViewOriginal: (record: ForensicRecord, url: string | null) => void;
  onRecheck: (record: ForensicRecord, url: string | null) => Promise<boolean>;
  drill?: ActivityDrill | null;
  /** Chain-integrity signal threaded from the shell so the feed can surface
   *  a compact chain-broken alert (Forensics ChainBanner stays the deep dive). */
  integrity?: IntegrityResult | null;
  /** Re-run the chain verification (reuses the header Verify handler). */
  onVerify?: () => void;
  /** Jump to the Forensics tab to inspect the broken records in detail. */
  onReviewChain?: () => void;
  /** D3: per-author severity trends, keyed by authorProfileKey(handle, platform). */
  escalations?: Map<string, AuthorEscalation> | null;
  /** True while `records` holds only the newest page of the chain. The trust
   *  line drops its total and the rail counts show a pending glyph — no
   *  surface states a total the page has not actually loaded. */
  archiveLoading?: boolean;
  /** Records in the month archives. Stated so the gap between this count and
   *  the header's total never reads as missing records: as "not listed here"
   *  while the archives are still being read, as "included" once `records` is
   *  the whole record (archivesIncluded). */
  archivedCount?: number;
  /** `records` is the whole record: the archived months plus the active chain
   *  (Dashboard.tsx allRecords). Off while the archives are still being read. */
  archivesIncluded?: boolean;
  /** Records in archived months outside the walk window (item 7, second
   *  slice, 14 Sep 2026): counted in every total, never listed here. Said,
   *  so a list that ends at 90 days is not read as the whole record. */
  archivedOlderCount?: number;
  /** The records flagged for review over every month, older ones from their summaries; said here, beside the other
   *  counts, because the tab name carries no number. */
  flaggedAllMonths?: number;
  flaggedAllMonthsTitle?: string;
  /** How many of `records` are the active chain (its newest records). The
   *  window note describes that chain: it is the one that rolls at the cap. */
  liveCount?: number;
  /** The record store could not be read (lastRecordReadFailed). An empty feed
   *  must render the failure, never the first-run welcome. */
  readFailed?: boolean;
  /** Re-run the shell's load() so the failure state has a way out. */
  onRetry?: () => void;
  /** The install has the AI reading (ai-wording.ts): off, the AI filters and the model group are not offered. */
  readingOffered?: boolean;
}) {
  const t = useDashboardT();
  const uiLang = useUiLanguage();
  // The side panels (platforms, techniques, safety words, frequent accounts) are a breakdown of the timeline, not
  // the timeline: they wait behind one fold, closed, so the first look is the sequence itself (9 Oct 2026).
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const words = dashboardWords(uiLang);
  // Default landing = 'all' (Everything): the parent drives selection themselves
  // rather than being auto-narrowed. A link can still preset a filter through
  // location.hash, as the popup's metrics-hidden line does with #blocked.
  const [filter, setFilter] = useState<FeedFilter>(initialFilterFromHash);
  const [platformFilter, setPlatformFilter] = useState<'all' | ForensicRecord['platform']>('all');
  // Feed order. 'seen' = the default as-observed replay (impression layer);
  // 'worst' = severity ranking, highest overallScore first, so a parent sees
  // the worst of what was served with one press. Time dividers only make
  // sense chronologically, so they are suppressed under 'worst'.
  const [feedSort, setFeedSort] = useState<'seen' | 'worst'>('seen');
  const [accountFilter, setAccountFilter] = useState<AccountFilter>('all');
  const [techniqueFilter, setTechniqueFilter] = useState<string | null>(null);
  const [hiddenCategoryFilter, setHiddenCategoryFilter] = useState<string | null>(null);
  const [safetyBucketFilter, setSafetyBucketFilter] = useState<BucketId | null>(null);
  const [search, setSearch] = useState('');
  // Q25: the raw value drives the input (instant echo); the value the O(N)
  // record predicate reads is debounced, so one keystroke no longer re-scans
  // the whole chain three times (list + railCounts + groups) per character.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 150);
    return () => clearTimeout(t);
  }, [search]);
  // Widened-drill filters (queue item 6): hour-of-day range, room URL, and an
  // explicit record-id set. All optional and off by default so the common
  // platform/technique drill is unchanged.
  const [hourRangeFilter, setHourRangeFilter] = useState<[number, number] | null>(null);
  const [roomUrlFilter, setRoomUrlFilter] = useState<string | null>(null);
  const [recordIdsFilter, setRecordIdsFilter] = useState<Set<string> | null>(null);
  // NEW rail axes (redesign 2026-08-01): When + Severity (computed from record
  // timestamps / overallScore) and Kind of content (record.kind). Pure
  // predicates live in ./components/filter-rail.
  const [whenFilter, setWhenFilter] = useState<WhenFilter>('any');
  const [severityFilter, setSeverityFilter] = useState<SeverityBand | null>(null);
  const [kindFilter, setKindFilter] = useState<KindFilter | null>(null);
  // Mode and model axes (capability audit 2026-09-06, P0 item 4): the
  // conditions a verdict was reached under, on every record.
  const [modeFilter, setModeFilter] = useState<ModeFilter | null>(null);
  const [modelFilter, setModelFilter] = useState<string | null>(null);
  // Axes the record carries that had no filter (wiring audit 13 Sep 2026,
  // finding 24): the surface an item sat on, one content-script session,
  // whether the chain already held the same text, and one author (finding 9,
  // replacing the free-text search the Frequent flaggers panel used to set).
  const [surfaceFilter, setSurfaceFilter] = useState<FeedSource | null>(null);
  const [sessionFilter, setSessionFilter] = useState<string | null>(null);
  const [seenBeforeFilter, setSeenBeforeFilter] = useState<SeenFilter | null>(null);
  const [authorFilter, setAuthorFilter] = useState<string | null>(null);
  // Thread state per group key (finding 14). The virtualizer unmounts a row
  // scrolled out of the window; keeping this here means scrolling back finds
  // the thread open and paged as the reader left it.
  const [openThreads, setOpenThreads] = useState<ReadonlySet<string>>(() => new Set());
  const [shownCommentsByKey, setShownCommentsByKey] = useState<ReadonlyMap<string, number>>(() => new Map());
  const toggleThread = useCallback((key: string) => {
    setOpenThreads((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);
  const showMoreComments = useCallback((key: string, page: number) => {
    setShownCommentsByKey((prev) => {
      const next = new Map(prev);
      next.set(key, (prev.get(key) ?? page) + page);
      return next;
    });
  }, []);

  // The per-section layout editor was removed 2026-06-14: the Activity layout is
  // now a fixed, contained, responsive design driven entirely by dashboard-design.css
  // (port of the approved "calm feed" mockup). The editor's component files were
  // deleted from the tree afterwards; rebuild from git history if it ever returns.

  // Apply a cross-tab drill (Statistics/Exposure/Patterns bar click). seq makes
  // the same drill re-applicable after the parent cleared local filters.
  useEffect(() => {
    if (!drill) return;
    // A cross-tab drill (clicking a Statistics/Exposure bar) is authoritative:
    // reset EVERY axis first, or a pre-existing narrowing can contradict the
    // drill and empty the feed. The old effect kept platform, technique,
    // mode, model, hour and room, so an Overview recordIds drill under a
    // stale platform pick opened fewer rows than the number clicked, often
    // zero (wiring audit 13 Sep 2026, finding 2). Then the drill's own fields
    // set the axes they carry; a field the drill leaves undefined stays reset.
    setFilter(drill.verdict ?? 'all');
    setPlatformFilter(drill.platform ?? 'all');
    setAccountFilter('all');
    setTechniqueFilter(drill.technique ?? null);
    setHiddenCategoryFilter(null);
    setSafetyBucketFilter(null);
    setSearch('');
    setWhenFilter(whenRangeFromDrill(drill.since, drill.until) ?? 'any');
    setSeverityFilter(null);
    setKindFilter(null);
    setModeFilter(null);
    setModelFilter(null);
    setSurfaceFilter(null);
    setSessionFilter(null);
    setSeenBeforeFilter(null);
    setAuthorFilter(null);
    setHourRangeFilter(drill.hourRange ?? null);
    setRoomUrlFilter(drill.roomUrl ?? null);
    setRecordIdsFilter(drill.recordIds && drill.recordIds.length > 0 ? new Set(drill.recordIds) : null);
  }, [drill?.seq]);
  // The counts switch is Off's; a value stored before it moved is not obeyed here either.
  const hideEngagement = receiptsRuns('hide-engagement-metrics') && !!settings.features?.['hide-engagement-metrics']?.enabled;
  const recidivistSet = useMemo(() => computeRecidivistSet(records), [records]);

  const searchIndex = useMemo(() => buildSearchIndex(records), [records]);
  // Seen-before is a property of the whole chain, computed once before any
  // filter runs (see computeSeenBeforeIds).
  const filterContext = useMemo<FilterContext>(
    () => ({ seenBeforeIds: computeSeenBeforeIds(records) }),
    [records],
  );

  const matchesWhat = useCallback(
    (r: ForensicRecord, f: FeedFilter): boolean => matchesWhatPure(r, f, parentFeedback, recidivistSet),
    [parentFeedback, recidivistSet],
  );

  // The predicate composition lives in ./activity-filters (recordPasses); the
  // state object is memoised so the per-record call allocates nothing.
  const filterState = useMemo<ActivityFilterState>(() => ({
    filter, platformFilter, accountFilter, whenFilter, severityFilter, kindFilter,
    modeFilter, modelFilter,
    techniqueFilter, hiddenCategoryFilter, safetyBucketFilter,
    recordIdsFilter, roomUrlFilter, hourRangeFilter,
    surfaceFilter, sessionFilter, seenBeforeFilter, authorFilter,
    search: debouncedSearch,
  }), [filter, platformFilter, accountFilter, whenFilter, severityFilter,
    kindFilter, modeFilter, modelFilter, techniqueFilter, hiddenCategoryFilter, safetyBucketFilter,
    recordIdsFilter, roomUrlFilter, hourRangeFilter,
    surfaceFilter, sessionFilter, seenBeforeFilter, authorFilter, debouncedSearch]);
  const passes = useCallback(
    (r: ForensicRecord, except?: ExceptAxis): boolean =>
      recordPasses(r, filterState, matchesWhat, searchIndex, except, filterContext),
    [filterState, matchesWhat, searchIndex, filterContext],
  );

  // Every filter applied, reversed for newest-first display — identical result
  // to the pre-rail step-by-step pipeline (intersection commutes).
  const list = useMemo(
    () => records.filter(r => passes(r)).reverse(),
    [records, passes],
  );

  // The live chain's own span, formatted in the reader's language. Null when
  // there is nothing to describe or no timestamp parses, so the sentence is
  // never rendered with an "Invalid Date" in it.
  const recordWindow = useMemo(() => {
    let oldest = Number.POSITIVE_INFINITY;
    let newest = Number.NEGATIVE_INFINITY;
    // The active chain is the newest `liveCount` records of the whole record
    // (archives first, then the chain, in chain order).
    const live = typeof liveCount === 'number' && liveCount < records.length ? records.slice(-liveCount) : records;
    for (const r of live) {
      const ms = Date.parse(r.timestamp);
      if (!Number.isFinite(ms)) continue;
      if (ms < oldest) oldest = ms;
      if (ms > newest) newest = ms;
    }
    if (!Number.isFinite(oldest) || !Number.isFinite(newest)) return null;
    return { from: formatDayMonthLongLocal(oldest, uiLang), to: formatDayMonthLongLocal(newest, uiLang), count: live.length };
  }, [records, liveCount, uiLang]);

  const railCounts = useMemo(
    () => computeRailCounts(records, passes, matchesWhat, new Date(), filterContext),
    [records, passes, matchesWhat, filterContext],
  );

  // Engagement growth per record (latest-vs-first sighting), computed over the
  // FULL record set so a recheck's delta is available regardless of the active
  // filter. Drives the "Update Metrics" growth readout on each card.
  const growthByRecordId = useMemo(() => buildGrowthByRecordId(records), [records]);

  const techFreq = useMemo(() => computeTechFreq(stats), [stats]);
  // Side panels count over the records passing every OTHER active filter
  // (recordsExcept, the same except-axis idea the rail uses), so a panel
  // number equals the rows a click on it opens (finding 8). techFreq stays on
  // stats.byTechnique, which the store computes; it is not narrowed here.
  const platFreq = useMemo(() => computePlatFreq(recordsExcept(records, passes, 'place')), [records, passes]);
  const hiddenFreq = useMemo(
    () => computeHiddenFreq(recordsExcept(records, passes, 'hidden-category').filter((r) => r.verdict === 'blocked')),
    [records, passes],
  );
  const safetyRecords = useMemo(() => recordsExcept(records, passes, 'safety'), [records, passes]);
  const authorRecords = useMemo(() => recordsExcept(records, passes, 'author'), [records, passes]);

  const baseGroups = useMemo(() => groupRecordsByPost(list), [list]);
  // Single display-sort site for BOTH views. 'worst' ranks a group by its peak
  // member severity (a thread is as bad as its worst item); the flat list
  // ranks records directly. Array.prototype.sort is stable, so equal-severity
  // entries keep their as-seen relative order as the tie-break. Grouping is
  // never recomputed on a toggle — only this cheap re-order runs.
  // Runs of housekeeping records fold into one line after the order is set, so
  // a run is what sits together on screen in either order (marker-runs.ts).
  const groups = useMemo(
    () => foldMarkerRunGroups(feedSort === 'seen' ? baseGroups : sortGroupsWorstFirst(baseGroups)),
    [baseGroups, feedSort],
  );
  const displayList = useMemo(
    () => foldMarkerRunRecords(feedSort === 'seen' ? list : sortRecordsWorstFirst(list)),
    [list, feedSort],
  );
  // Dividers describe time between consecutively served groups, so they are a
  // property of the whole ordered list, not of one index. Computed once per
  // list rather than per rendered row.
  const feedDividers = useMemo(
    () => (feedSort === 'seen' ? computeFeedDividers(groups) : []),
    [groups, feedSort],
  );
  // A reorder with the scroll position preserved is invisible when the top of
  // the feed looks similar in both orders — the press must produce a visible
  // response, so jump to the top of the feed on every order change.
  const setFeedSortVisible = (next: 'seen' | 'worst') => {
    setFeedSort(next);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  };
  const commentCountByRootRecordId = useMemo(() => computeCommentCountByRootRecordId(groups), [groups]);

  // Trust invariant (see isAnyFilterActive): any narrowing flattens the feed
  // so every matched record is visible; the raw search flattens at once.
  const anyFilterActive = isAnyFilterActive(filterState, search);
  const showFlat = anyFilterActive;
  // Which body an empty feed renders; a failed store read outranks both the
  // first-run welcome and the "no matches" note (see feedEmptyKind).
  const emptyKind = feedEmptyKind(anyFilterActive, !!readFailed);

  // ── Feed windowing (zero-lag at scale) ──
  // The feed mounts one card per post group; on a multi-thousand-record chain
  // that put thousands of DOM nodes on screen and dropped scroll to ~15fps with
  // a ~1.5s blocking mount (measured at 10k, docs/spec/subsystems/dashboard-perf.md).
  // Fix: render only the rows near the viewport; top/bottom spacer <div>s
  // preserve scroll height. useVirtualScroll tracks window.scrollY +
  // ResizeObserver-measured heights; see the hook above. (Browser-level
  // content-visibility was REMOVED from the rows — on the already-windowed feed
  // it was a second virtualizer that flipped each card between its intrinsic-size
  // placeholder and its real height at the viewport edge, making media cards pop on
  // scroll; known-issues M34 / dashboard-design.css. Windowing alone bounds the DOM.)
  const totalRows   = showFlat ? displayList.length : groups.length;
  const keyAtGroup  = useCallback((i: number) => groups[i]?.key ?? String(i), [groups]);
  const keyAtFlat   = useCallback((i: number) => displayList[i]?.key ?? String(i), [displayList]);
  const keyAt       = showFlat ? keyAtFlat : keyAtGroup;
  const { containerRef: feedContainerRef, range: feedRange } =
    useVirtualScroll(totalRows, keyAt);
  const visibleGroups = useMemo(
    () => groups.slice(feedRange.start, feedRange.end + 1),
    [groups, feedRange.start, feedRange.end],
  );
  const visibleList = useMemo(
    () => displayList.slice(feedRange.start, feedRange.end + 1),
    [displayList, feedRange.start, feedRange.end],
  );

  // Reset every active filter at once (the mockup's "clear filters" link).
  // Every axis isAnyFilterActive counts is reset here; the old link left mode
  // and model narrowed with the link still showing (finding 1).
  const clearAllFilters = () => {
    setFilter('all'); setPlatformFilter('all'); setAccountFilter('all'); setTechniqueFilter(null);
    setHiddenCategoryFilter(null); setSafetyBucketFilter(null);
    setRecordIdsFilter(null); setRoomUrlFilter(null); setHourRangeFilter(null);
    setWhenFilter('any'); setSeverityFilter(null); setKindFilter(null);
    setModeFilter(null); setModelFilter(null);
    setSurfaceFilter(null); setSessionFilter(null); setSeenBeforeFilter(null); setAuthorFilter(null);
    setSearch('');
  };

  // ── Filter rail groups (redesign 2026-08-01, mockup B) ──
  // Six grouped, collapsible axes, each option carrying its click-through
  // count. Single-select per axis; Severity/Kind toggle off on re-click
  // (they have no explicit "all" option, per the mockup).
  const rawPlatforms = useMemo(() => {
    const s = new Set<ForensicRecord['platform']>();
    for (const r of records) {
      if (isMarker(r)) continue;
      s.add(r.platform);
    }
    return s;
  }, [records]);
  const PLATFORM_ORDER: ForensicRecord['platform'][] = ['twitter', 'facebook', 'instagram', 'tiktok', 'youtube'];
  const surfacesPresent = useMemo(() => surfaceOptions(records), [records]);
  // Counts over a partial chain are totals the page has not loaded; the rail
  // shows a pending glyph until the full read lands.
  const railCount = (n: number): number | null => (archiveLoading ? null : n);
  // Two of these groups are built out of the records rather than from a fixed
  // list, so on a record set that has neither they came out empty: a heading
  // that opens onto nothing, which reads as a broken filter rather than as an
  // absent one. One of them remembered to guard itself and the other did not
  // (2026-09-18). The rule belongs here, once, so a group added tomorrow
  // inherits it: a filter with nothing to offer is not shown.
  const railGroupsAll: RailGroupSpec[] = [
    {
      id: 'place', label: t.railGroupPlace, defaultOpen: true,
      options: [
        { key: 'all', label: t.railPlaceAll, count: railCount(railCounts.place.all), active: platformFilter === 'all', onPick: () => setPlatformFilter('all') },
        ...PLATFORM_ORDER.filter(p => rawPlatforms.has(p) || platformFilter === p).map(p => ({
          key: p, label: PLATFORM_LABELS[p] ?? p, count: railCount(railCounts.place[p] ?? 0),
          active: platformFilter === p, onPick: () => setPlatformFilter(platformFilter === p ? 'all' : p),
        })),
      ],
    },
    {
      id: 'what', label: t.railGroupWhat, defaultOpen: true,
      options: RAIL_WHAT_OPTIONS.filter(k => readingOffered || (k !== 'rewritten' && k !== 'ai')).map(k => ({
        key: k, label: t.railWhat[k as keyof typeof t.railWhat] ?? t.filterChips[k],
        count: railCount(railCounts.what[k] ?? 0), active: filter === k,
        title: k === 'rewritten' ? t.chipRewrittenTip : undefined,
        onPick: () => setFilter(filter === k && k !== 'all' ? 'all' : k),
      })),
    },
    {
      id: 'who', label: t.railGroupWho,
      options: ACCOUNT_FILTER_CHIPS.map(k => ({
        key: k, label: t.accountFilterChips[k], count: railCount(railCounts.who[k]),
        active: accountFilter === k,
        onPick: () => setAccountFilter(accountFilter === k && k !== 'all' ? 'all' : k),
      })),
    },
    {
      id: 'when', label: t.railGroupWhen,
      options: WHEN_OPTIONS.map(w => ({
        key: w, label: t.railWhen[w], count: railCount(railCounts.when[w]), active: whenFilter === w,
        onPick: () => setWhenFilter(whenFilter === w && w !== 'any' ? 'any' : w),
      })),
    },
    {
      id: 'severity', label: t.railGroupSeverity,
      options: SEVERITY_OPTIONS.map(s => ({
        key: s, label: t.railSeverity[s], count: railCount(railCounts.severity[s]), active: severityFilter === s,
        onPick: () => setSeverityFilter(severityFilter === s ? null : s),
      })),
    },
    {
      id: 'kind', label: t.railGroupKind,
      options: KIND_OPTIONS.map(k => ({
        key: k, label: t.railKind[k], count: railCount(railCounts.kind[k]), active: kindFilter === k,
        onPick: () => setKindFilter(kindFilter === k ? null : k),
      })),
    },
    {
      id: 'mode', label: t.railGroupMode,
      options: MODE_OPTIONS.map(m => ({
        key: m, label: t.railMode[m], count: railCount(railCounts.mode[m]), active: modeFilter === m,
        onPick: () => setModeFilter(modeFilter === m ? null : m),
      })),
    },
    {
      id: 'model', label: t.railGroupModel,
      options: (readingOffered ? modelOptions(records) : []).map(m => ({
        key: m, label: m === MODEL_NONE ? t.railModelNone : m, count: railCount(railCounts.model[m] ?? 0), active: modelFilter === m,
        onPick: () => setModelFilter(modelFilter === m ? null : m),
      })),
    },
    // Surface: only the values present in the record set are listed. Its own
    // length guard was removed when the general one below was added; two
    // implementations of one rule is how the model group came to be missing it.
    {
      id: 'surface', label: t.railGroupSurface,
      options: surfacesPresent.map(s => ({
        key: s, label: t.railSurface[s], count: railCount(railCounts.surface[s] ?? 0), active: surfaceFilter === s,
        onPick: () => setSurfaceFilter(surfaceFilter === s ? null : s),
      })),
    },
    {
      id: 'seen', label: t.railGroupSeen,
      options: SEEN_OPTIONS.map(s => ({
        key: s, label: t.railSeen[s], count: railCount(railCounts.seen[s]), active: seenBeforeFilter === s,
        onPick: () => setSeenBeforeFilter(seenBeforeFilter === s ? null : s),
      })),
    },
  ];
  const railGroups = railGroupsAll.filter((g) => g.options.length > 0);

  // ── Showing line (the trust anchor) — every active narrowing as a token ──
  const showingTokens = deriveShowingTokens({
    filter, platform: platformFilter, account: accountFilter,
    when: whenFilter, severity: severityFilter, kind: kindFilter, mode: modeFilter, model: modelFilter, search,
    surface: surfaceFilter, seen: seenBeforeFilter, author: authorFilter, session: sessionFilter,
    technique: techniqueFilter, hiddenCategory: hiddenCategoryFilter,
    safetyBucket: safetyBucketFilter,
    recordIdsCount: recordIdsFilter ? recordIdsFilter.size : null,
    roomUrl: roomUrlFilter, hourRange: hourRangeFilter,
  });
  // A drill window renders as dates in the reader's locale; an ISO bound
  // that does not parse is shown raw rather than as "Invalid Date".
  const whenRangeLabel = (): string => {
    if (!isWhenRange(whenFilter)) return '';
    const day = (iso: string | null): string | null =>
      iso === null ? null : formatDateLocal(iso, uiLang);
    return t.tokenWhenRange(day(whenFilter.since), day(whenFilter.until));
  };
  const tokenLabel = (tok: typeof showingTokens[number]): string => {
    switch (tok.axis) {
      case 'place':    return PLATFORM_LABELS[tok.value] ?? tok.value;
      case 'what':     return t.railWhat[tok.value as keyof typeof t.railWhat] ?? t.filterChips[tok.value as FeedFilter];
      case 'who':      return t.accountFilterChips[tok.value as AccountFilter];
      case 'when':     return t.railWhen[tok.value as keyof typeof t.railWhen];
      case 'when-range': return whenRangeLabel();
      case 'severity': return t.railSeverity[tok.value as keyof typeof t.railSeverity];
      case 'kind':     return t.railKind[tok.value as keyof typeof t.railKind];
      case 'mode':     return t.railMode[tok.value as keyof typeof t.railMode];
      case 'model':    return tok.value === MODEL_NONE ? t.railModelNone : tok.value;
      case 'search':   return tok.value.length > 32 ? tok.value.slice(0, 32) + '…' : tok.value;
      case 'surface':  return t.railSurface[tok.value as keyof typeof t.railSurface] ?? tok.value;
      case 'seen':     return t.railSeen[tok.value as keyof typeof t.railSeen] ?? tok.value;
      case 'author':   return authorFilterHandle(tok.value);
      case 'session':  return t.tokenSession(tok.value.slice(0, 8));
      case 'technique': return PRETTY_TECHNIQUE[tok.value] ?? tok.value;
      case 'hidden-category':
        return t.railHiddenCategory[tok.value as keyof typeof t.railHiddenCategory] ?? tok.value;
      case 'safety':   return SAFETY_BUCKET_LABELS[tok.value as BucketId] ?? tok.value;
      case 'record-ids': return t.drillCount(recordIdsFilter?.size ?? 0);
      case 'room':     return tok.value.replace(/^https?:\/\//, '').slice(0, 40);
      case 'hour':     return tok.value;
      default:         return tok.value;
    }
  };
  const tokenRemove = (tok: typeof showingTokens[number]): void => {
    switch (tok.axis) {
      case 'place':    setPlatformFilter('all'); break;
      case 'what':     setFilter('all'); break;
      case 'who':      setAccountFilter('all'); break;
      case 'when':     setWhenFilter('any'); break;
      case 'when-range': setWhenFilter('any'); break;
      case 'severity': setSeverityFilter(null); break;
      case 'kind':     setKindFilter(null); break;
      case 'mode':     setModeFilter(null); break;
      case 'model':    setModelFilter(null); break;
      case 'search':   setSearch(''); break;
      case 'surface':  setSurfaceFilter(null); break;
      case 'seen':     setSeenBeforeFilter(null); break;
      case 'author':   setAuthorFilter(null); break;
      case 'session':  setSessionFilter(null); break;
      case 'technique': setTechniqueFilter(null); break;
      case 'hidden-category': setHiddenCategoryFilter(null); break;
      case 'safety':   setSafetyBucketFilter(null); break;
      case 'record-ids': setRecordIdsFilter(null); break;
      case 'room':     setRoomUrlFilter(null); break;
      case 'hour':     setHourRangeFilter(null); break;
    }
  };

  const brokenRecords = useMemo(() => computeBrokenRecords(integrity, records), [integrity, records]);
  const chainBroken = integrity?.valid === false;

  return (
    <>
      {/* Before the first record the rail is a column of zeros and the controls sort nothing: the first look is the steps alone. */}
      <div className="activity-grid" data-breakdown={breakdownOpen ? 'open' : 'closed'} data-first-look={records.length === 0 && !readFailed && !archiveLoading ? '' : undefined}>
        {/* Recent activity panel — surface-id: activity-feed (1.4.2).
            Redesign 2026-08-01 (mockup B): a left filter rail replaces the
            stacked filter rows; the feed keeps the sort control and gains the
            always-visible "Showing N of M" trust line above the listing. */}
        <div className="feed-layout">
          <FilterRail search={search} onSearchChange={setSearch} groups={railGroups} />
          <div className="feed-main">
          <div className="feed-panel">
            <div className="feed-controls">
              <div className="feed-controls-row">
                {/* Feed order — one visible press between the as-observed replay
                    and the worst-first severity ranking. */}
                <div className="feed-sort" role="group" aria-label={t.sortGroupLabel}>
                  <button
                    type="button"
                    className={'feed-sort-btn' + (feedSort === 'seen' ? ' active' : '')}
                    onClick={() => setFeedSortVisible('seen')}
                    title={t.sortAsSeenTip}
                  >
                    {t.sortAsSeen}
                  </button>
                  <button
                    type="button"
                    className={'feed-sort-btn' + (feedSort === 'worst' ? ' active' : '')}
                    onClick={() => setFeedSortVisible('worst')}
                    title={t.sortWorstTip}
                  >
                    {t.sortWorst}
                  </button>
                </div>
                <button
                  type="button"
                  className="feed-breakdown-btn"
                  aria-expanded={breakdownOpen}
                  aria-controls="activity-breakdown"
                  onClick={() => setBreakdownOpen((o) => !o)}
                >
                  {breakdownOpen ? words.breakdownHide : words.breakdownShow}
                </button>
              </div>

              {/* The single trust anchor: what subset is on screen, with EVERY
                  active narrowing as a removable token. Drill filters that
                  arrived from other tabs render purple. No hidden narrowing. */}
              <div className="feed-showing">
                <span>
                  {/* Grouped in the reader's own locale. The window sentence
                      below already groups, so leaving these raw printed the
                      same count two ways on one line ("2431 ... 2,431"). */}
                  {archiveLoading
                    ? <>{t.showingLoadingBefore}<b>{formatCount(list.length, uiLang)}</b>{t.showingLoadingAfter}</>
                    : <>{t.showingBefore}<b>{formatCount(list.length, uiLang)}</b>{t.showingBetween}<b>{formatCount(records.length, uiLang)}</b>{t.showingAfter}</>}
                </span>
                {!archiveLoading && (archivedCount ?? 0) > 0 && (
                  <span className="feed-showing-archived" style={{ color: 'var(--fw-muted)' }}>
                    {archivesIncluded ? t.showingArchivedIncluded(archivedCount ?? 0) : t.showingArchivedNote(archivedCount ?? 0)}
                  </span>
                )}
                {!archiveLoading && flaggedAllMonths > 0 && (
                  <span className="feed-showing-flagged" style={{ color: 'var(--fw-muted)' }} title={flaggedAllMonthsTitle}>
                    {t.tabActivityFlagged(flaggedAllMonths)}
                  </span>
                )}
                {!archiveLoading && archivedOlderCount > 0 && (
                  <span className="feed-showing-archived-older" style={{ color: 'var(--fw-muted)' }}>
                    {t.showingArchivedOlder(archivedOlderCount)}
                  </span>
                )}
                {/* How far back the live list goes, and that it rolls. Without
                    this, "showing 500 of 500" reads as the whole history when
                    it is the last few days (owner, 2026-09-05). */}
                {!archiveLoading && recordWindow && (
                  <span className="feed-showing-archived" style={{ color: 'var(--fw-muted)' }}>
                    {t.recordWindowNote(recordWindow.from, recordWindow.to, recordWindow.count, FORENSIC_RECORD_CAP)}
                  </span>
                )}
                {showingTokens.map((tok) => (
                  <span key={tok.axis + ':' + tok.value} className={'feed-tok' + (tok.drill ? ' drill' : '')}>
                    {tokenLabel(tok)}
                    <button
                      type="button"
                      aria-label={t.tokenRemoveTip}
                      title={t.tokenRemoveTip}
                      onClick={() => tokenRemove(tok)}
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
                {anyFilterActive && (
                  <button type="button" className="feed-showing-clear" onClick={clearAllFilters}>
                    {t.showEverything}
                  </button>
                )}
              </div>
            </div>


            {/* Compact chain-broken alert — only when the chain failed to
                verify. "Review N" filters the feed to the broken records;
                "verify again" re-runs the same check the header pill drives.
                The full ChainBanner deep-dive stays on the Forensics tab. */}
            {chainBroken && (
              <div className="fc-harm-row" role="alert" style={{ margin: '0 0 12px' }}>
                <span className="fc-harm-chip">{t.feedTrustChainBroken}</span>
                {/* `flex: 1` alone is flex-basis 0, so in the feed column the
                    reason took whatever the chip and the three buttons left,
                    which was about 120 pixels: the single most important
                    sentence this product shows was rendered as a tall narrow
                    strip of two-word lines beside them (seen 2026-09-17 in the
                    dashboard probe's own screenshot). A basis means the row
                    wraps and gives the sentence its own full-width line
                    instead of squeezing it. */}
                <span className="fc-harm-note" style={{ flex: '1 1 220px', minWidth: 0 }}>
                  {integrity?.reason ?? t.chainDescBrokenFallback}
                </span>
                {brokenRecords.length > 0 && (
                  <button
                    type="button"
                    className="chip"
                    onClick={() => setRecordIdsFilter(new Set(brokenRecords.map(r => r.id)))}
                    title={t.drillActiveLabel}
                  >
                    {t.drillCount(brokenRecords.length)}
                  </button>
                )}
                {onReviewChain && (
                  <button type="button" className="chip" onClick={onReviewChain}>
                    {t.tabRecord}
                  </button>
                )}
                {onVerify && (
                  <button type="button" className="chip" onClick={onVerify}>
                    {t.hdrVerify}
                  </button>
                )}
              </div>
            )}

            <div className="feed-body" id="feed-start">
              {list.length === 0 ? (
                emptyKind === 'load-failed' ? (
                  // A failed read must never wear the welcome state: "nothing
                  // recorded yet" and "the store could not be read" look
                  // identical to a parent otherwise.
                  <div className="feed-welcome" role="alert">
                    <ShieldAlert size={40} />
                    <h3>{t.loadFailedTitle}</h3>
                    <p>{t.loadFailedBody}</p>
                    {onRetry && (
                      <button type="button" className="chip" onClick={onRetry}>{t.retry}</button>
                    )}
                  </div>
                ) : emptyKind === 'welcome' ? (
                  <div className="feed-welcome">
                    <FileText size={40} />
                    <h3>{t.feedWelcomeTitle}</h3>
                    <ol className="feed-welcome-steps">
                      {words.welcomeSteps.map((step) => <li key={step}>{step}</li>)}
                    </ol>
                  </div>
                ) : (
                  <div className="feed-empty">
                    <FileText size={36} />
                    <div>
                      {filter === 'all'
                        ? t.emptyAll
                        : t.emptyFiltered(filter, !!search)}
                    </div>
                  </div>
                )
              ) : (
                <div className="fc-timeline" ref={feedContainerRef}>
                  {/* Top spacer: preserves scroll-height for unmounted items above
                      the visible window.  Height is the sum of measured/estimated
                      heights of items [0, feedRange.start). */}
                  {feedRange.topH > 0 && (
                    <div className="fc-virtual-spacer" style={{ height: feedRange.topH }} aria-hidden="true" />
                  )}
                  {!showFlat ? (
                    visibleGroups.map((g, localI) => {
                      // globalI is needed so dividerAbove references the full
                      // groups array at the correct absolute position.
                      const globalI = feedRange.start + localI;
                      if (isMarkerRunGroup(g)) {
                        return <MarkerRunLine key={g.key} rowKey={g.key} run={g.children} />;
                      }
                      // Time dividers only read chronologically; severity
                      // ranking scrambles time, so suppress them (ledger
                      // severity-sort precedent).
                      const div = feedSort === 'seen' ? (feedDividers[globalI] ?? null) : null;
                      // The divider renders INSIDE the group's measured row
                      // (PostGroupCard `above`), so the virtualizer counts its
                      // height (wiring audit 13 Sep, D1-12).
                      const divider = div && (
                            div.kind === 'session' ? (
                              // Session break — the timeline's dot+label divider.
                              <div className="fc-tl-session">
                                <span className="lbl">
                                  {t.feedSessionGap(Math.round((div.gapSeconds ?? 0) / 60))}
                                </span>
                              </div>
                            ) : (
                              // Platform switch — a quiet-gap row on the spine.
                              <div className="fc-tl-row gap">
                                <div className="fc-tl-gutter" />
                                <div className="fc-tl-gaplabel">
                                  {t.feedPlatformSwitch(PLATFORM_LABELS[div.fromPlatform] ?? div.fromPlatform, PLATFORM_LABELS[div.toPlatform] ?? div.toPlatform, div.gapSeconds)}
                                </div>
                              </div>
                            )
                          );
                      // A day heading where the day changes, so the list reads as a dated sequence (the timeline).
                      // Only in the as-seen order: worst-first scrambles time, as the dividers above already respect.
                      const day = feedSort === 'seen' ? dayHeadingAt(groups, globalI, uiLang) : null;
                      const above = (day || divider) ? <>{day}{divider}</> : null;
                      return (
                          <PostGroupCard
                            key={g.key}
                            above={above || undefined}
                            group={g}
                            feedbackMap={parentFeedback}
                            onConfirm={onConfirm}
                            onDispute={onDispute}
                            onViewOriginal={onViewOriginal}
                            onRecheck={onRecheck}
                            hideEngagement={hideEngagement}
                            recidivistSet={recidivistSet}
                            growthByRecordId={growthByRecordId}
                            expanded={openThreads.has(g.key)}
                            onToggleExpanded={() => toggleThread(g.key)}
                            shownComments={shownCommentsByKey.get(g.key)}
                            onShowMoreComments={(page) => showMoreComments(g.key, page)}
                          />
                      );
                    })
                  ) : (
                    visibleList.map((item) => {
                      if (item.run) return <MarkerRunLine key={item.key} rowKey={item.key} run={item.run} />;
                      const r = item.record;
                      return (
                      <TimelineRow key={r.id} record={r}>
                        <FeedCard
                          record={r}
                          feedback={parentFeedback.get(r.id)}
                          onConfirm={onConfirm}
                          onDispute={onDispute}
                          onViewOriginal={onViewOriginal}
                          onRecheck={onRecheck}
                          hideEngagement={hideEngagement}
                          recidivist={recidivistSet.has(authorProfileKey(r.author, r.platform))}
                          growth={growthByRecordId.get(r.id) ?? null}
                          commentCount={
                            r.kind === 'post' || r.kind === 'video'
                              ? (commentCountByRootRecordId.get(r.id) ?? 0)
                              : undefined
                          }
                        />
                      </TimelineRow>
                      );
                    })
                  )}
                  {/* Bottom spacer: preserves scroll-height for unmounted items
                      below the visible window. */}
                  {feedRange.bottomH > 0 && (
                    <div className="fc-virtual-spacer" style={{ height: feedRange.bottomH }} aria-hidden="true" />
                  )}
                </div>
              )}
            </div>
          </div>

          {/* surface-id: activity-how-groups-behave — per-group aggregate
              (slice 2). Renders only when group posts exist. */}
          {!archiveLoading && <GroupBehaviorPanel records={records} />}
          </div>
        </div>

        {/* Right rail — surface-id: activity-side-*. While `records` is only
            the newest page, every panel here would print a real-looking number
            off 400 records next to a rail that shows a pending glyph (wiring
            audit 13 Sep, D1-11, D2-11); say so instead, once, and paint the
            panels when the full read lands. */}
        {!breakdownOpen ? null : archiveLoading ? (
          <div className="side-rail" id="activity-breakdown" data-fw-side-pending="1">
            <div className="side-panel">
              <div className="muted" style={{ fontSize: 12 }}>{t.sidePanelsPending}</div>
            </div>
          </div>
        ) : (
        <div className="side-rail" id="activity-breakdown">
          <div className="side-panel">
            <div className="side-panel-header">
              <h3>{t.platformBreakdown}</h3>
              <span className="hint">{t.clickToFilter}</span>
            </div>
            {platFreq.length === 0 ? (
              <div className="muted" style={{ fontSize: 12 }}>{t.noDataYet}</div>
            ) : (
              platFreq.map((f) => {
                const isActive = platformFilter === f.key;
                return (
                  <button
                    type="button"
                    className="bar-row"
                    key={f.key}
                    onClick={() => setPlatformFilter(isActive ? 'all' : (f.key as ForensicRecord['platform']))}
                    style={{
                      background: 'transparent', border: 0, width: '100%',
                      cursor: 'pointer', textAlign: 'left',
                    }}
                    title={isActive ? t.clearNameFilterTip(f.key) : t.showOnlyTip(f.key)}
                  >
                    <span className="bar-label" style={{ color: f.color }}>{f.label}</span>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: f.width + '%', ['--bar-color' as never]: f.color }} />
                    </div>
                    <span className="bar-count">{f.value}</span>
                  </button>
                );
              })
            )}
          </div>

          <div className="side-panel">
            <div className="side-panel-header">
              <h3>{t.techniqueFrequency}</h3>
              <span className="hint">{t.top7Hint}</span>
            </div>
            {techFreq.length === 0 ? (
              <div className="muted" style={{ fontSize: 12 }}>{t.noDataYet}</div>
            ) : (
              techFreq.map((f) => {
                const isActive = techniqueFilter === f.rawName;
                return (
                  <button
                    type="button"
                    className="bar-row"
                    key={f.rawName}
                    onClick={() => setTechniqueFilter(isActive ? null : f.rawName)}
                    style={{
                      background: 'transparent', border: 0, width: '100%',
                      cursor: 'pointer', textAlign: 'left',
                    }}
                    title={isActive ? t.clearNameFilterTip(f.name) : t.showOnlyTip(f.name)}
                  >
                    <span className="bar-label" style={{ color: f.color }}>{f.name}</span>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: f.width + '%', ['--bar-color' as never]: f.color }} />
                    </div>
                    <span className="bar-count">{f.value}</span>
                  </button>
                );
              })
            )}
          </div>

          {/* surface-id: activity-side-safety-categories — always-on swearing /
              slurs / dehumanization / extreme-toxicity bucket counters with
              expandable phrase lists. */}
          <SafetyCategoriesPanel
            records={safetyRecords}
            activeBucket={safetyBucketFilter}
            onPickBucket={(b) => setSafetyBucketFilter((prev) => (prev === b ? null : b))}
          />

          {/* surface-id: activity-side-recidivist. A row sets the author axis
              (platform-scoped profile key), never the free-text search: "@news"
              used to match every post whose text mentioned news and overwrote
              what the reader had typed (finding 9). */}
          <RecidivistAuthorsPanel
            records={authorRecords}
            onPickAuthor={(_handle, profileKey) => setAuthorFilter((prev) => (prev === profileKey ? null : profileKey))}
            escalations={escalations}
          />

          <div className="side-panel">
            <div className="side-panel-header">
              <h3>{t.metricsHidden}</h3>
              {/* The hint promises an affordance, so it renders only when there
                  are rows to press. An empty panel used to print "click to
                  filter" over nothing (owner, 2026-09-04). */}
              {hiddenFreq.length > 0 && <span className="hint">{t.clickToFilter}</span>}
            </div>
            {hiddenFreq.length === 0 ? (
              <div className="muted" style={{ fontSize: 12 }}>
                {t.metricsHiddenEmpty}
              </div>
            ) : (
              <>
                {hiddenFreq.map((f) => {
                  const isActive = hiddenCategoryFilter === f.name;
                  const label = t.railHiddenCategory[f.name as keyof typeof t.railHiddenCategory] ?? f.name;
                  return (
                    <button
                      type="button"
                      className="bar-row"
                      key={f.name}
                      onClick={() => setHiddenCategoryFilter(isActive ? null : f.name)}
                      style={{
                        background: 'transparent', border: 0, width: '100%',
                        cursor: 'pointer', textAlign: 'left',
                      }}
                      title={isActive ? t.clearNameFilterTip(label) : t.showOnlyTip(label)}
                    >
                      <span className="bar-label" style={{ color: f.color }}>{label}</span>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: f.width + '%', ['--bar-color' as never]: f.color }} />
                      </div>
                      <span className="bar-count">{f.value}</span>
                    </button>
                  );
                })}
                <div className="muted" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.5, fontStyle: 'italic' }}>
                  {t.metricsHiddenFootnote}
                </div>
              </>
            )}
          </div>
        </div>
        )}
      </div>
    </>
  );
}

/** The day heading above group `i`, or null when the group above it is on the same day. Marker lines (housekeeping,
 *  not served) never start a day. */
function dayHeadingAt(groups: RecordGroup[], i: number, lang: ResolvedUiLanguage): ReactElement | null {
  const g = groups[i];
  if (!g || isMarkerRunGroup(g)) return null;
  const at = g.firstSeenAt || g.latestTs;
  if (!at) return null;
  const key = localDayKey(at);
  for (let j = i - 1; j >= 0; j--) {
    const p = groups[j];
    if (isMarkerRunGroup(p)) continue;
    const pAt = p.firstSeenAt || p.latestTs;
    if (pAt && localDayKey(pAt) === key) return null;
    break;
  }
  const text = formatDateLongLocal(at, lang);
  return <h3 className="fc-day-head">{text.charAt(0).toUpperCase() + text.slice(1)}</h3>;
}
