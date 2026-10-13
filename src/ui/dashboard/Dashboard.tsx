// FeelingWise dashboard — Ship #26 redesign (Claude Design integration).
//
// What changed vs the prior version (commit a8807ed):
//   • Visual reskin: new DashHeader + ChainBanner + dashboard-design.css.
//   • NEW "Statistics" tab inserted between Activity and Forensics
//     (what the record holds, plus KPI snapshots — Inventory Part 7 #6).
//   • ActivityTab restructured with a per-platform chip-tab row + a
//     "Frequent flaggers" side panel (Inventory Part 7 #4, #5).
//   • FeedCard rewritten with social-post-card layout + engagement strip
//     pulling likes/views/replies from PlatformSpecificMeta (Inventory
//     Part 7 #1, no schema change).
//   • Forensics / Issues / Export tab bodies preserved verbatim — only
//     visually re-themed by the new CSS (Part 6 contracts unchanged).
//
// Behavioral contracts confirmed preserved (Inventory Part 6):
//   1. Chain banner scoped to the Forensics tab. The DashHeader integrity
//      pill (3-state ok/warn/err) carries the at-a-glance signal on every
//      tab; the banner itself is deep-dive context and lives where a
//      parent goes to verify the chain — i.e. Forensics.
//   2. PIN-gated destructive reset action.
//   3. Confirm / Dispute reachable on every flagged record (FeedCard).
//   4. View-original fallback chain (postUrl → roomUrl → platform-ID URL).
//   5. BETA pill on every rewrite.
//   6. HTML exports are free (2026-06-21 decision); no tier gate on the Export tab.
//   7. Theme cycle dark → light → system → dark.
//   8. No record cap on the Activity feed.
//   9. Issues tab badge from operational-event records.
//   10. Manual flag through SW with direct-call fallback.

import '../shared/tokens.css';
import './dashboard-design.css';
// Last, so the house values and the frame win on this page (dashboard-house.css header says why and until when).
import './dashboard-house.css';
import './dashboard-frame.css';
// After the frame: a look recolours the house values the frame draws with.
import './dashboard-looks.css';
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { ForensicRecord } from '../../types/forensic';
import { computeAuthorEscalation, type AuthorEscalation } from '../../forensics/analytics';
import { getAllAuthorProfiles } from '../../forensics/author-store';
import {
  getRecordsDetailed, getRecordsFirstPage, computeStats, lastRecordReadFailed,
  addParentFeedback, getAllParentFeedback, ParentFeedback, removeParentFeedback,
  type UnreadableStoredRecord } from '../../forensics/store';

// Newest records unwrapped for the progressive first paint (2026-08-03). Sized
// for scroll runway well past the visible cards while keeping the page unwrap
// far under the full-chain cost; the full read replaces it moments later.
const FIRST_RECORD_PAGE = 400;
import { repairRelegatedPositions } from '../../forensics/auto-heal';
import { discloseRepairsOnChain } from '../../forensics/repair-marker';
import { applyRedactions, REDACTED_FIELDS } from '../../forensics/redaction';
import { useRestoreNotice } from './restore-notice';
import {
  verifyChainIntegrity,
  verifyChainIntegrityAcrossMonths,
  chainWatermarkFrom,
  extendChainIntegrity,
  IntegrityResult,
  CrossMonthIntegrityResult,
  type ChainVerifyWatermark,
  type DamagedRow,
} from '../../forensics/chain-integrity';
import { readRecordLines, type RecordLines } from '../../forensics/record-lines';
import { loadArchivesOldestFirst, listArchiveMonths, countArchivedRecords } from '../../forensics/archive-reader';
import { readMonthSummaries } from '../../forensics/archive-summary-store';
import { foldSummariesIntoStats, type MonthSummary } from '../../forensics/archive-summary';
import { WALK_WINDOW_DAYS, loadArchiveMonths, monthKeysInWindow, summariesOutsideLoaded } from '../../forensics/archive-window';
import { AttentionBanner, type AttentionItem } from './components/AttentionBanner';
import { ChainLossBanner } from './components/ChainLossBanner';
import { readChainHeightWitness, type ChainHeightWitness } from '../../forensics/chain-height-witness';
import { maintenanceAttention, readMaintenanceHealth } from '../../forensics/maintenance-health';
import { getBackupFolderWireStatus, requestBackupFolderPermission } from '../../forensics/backup-folder-wire';
import { getBackupHealth, assessBackupHealth, mirrorBackupToWiredFolder } from '../../forensics/backup';
import { getLicense, LicenseInfo, FREE_LICENSE } from '../../storage/license';
import { safeSendMessage } from '../../storage/context-guard';
import type { FWMessage, RunRecordTidyResponse } from '../../types/messages';
import { DashboardTheme, getSettings, saveSettings } from '../../storage/settings';
import { resolveUiLanguage } from '../../i18n';
import { I18nProvider } from '../../i18n/react';
import { DASHBOARD_STRINGS } from '../../i18n/dashboard-strings';

// Ship #26 components — visible visual change.
import { DashHeader } from './components/DashHeader';
import { applyTheme, eagerApplyStoredTheme, readThemeMirror, subscribeToSystemThemeChanges, type ThemeChoice } from '../shared/theme';
import { eagerApplyStoredLook, followStoredLook } from '../shared/looks';
import { type ActivityDrill } from './components/activity-drill';
import { recordTip } from './components/records-tip';
import { ForensicsTab } from './components/ForensicsTab';
import { ResetChainConfirmModal } from './components/ResetChainConfirmModal';
import { offersReading } from './ai-wording';
import { ExportTab } from './components/ExportTab';
import { ActivityTab } from './components/ActivityTab';
import { TabBtn, type TabId } from './components/TabBtn';
import { FeedLogTab } from './components/FeedLogTab';
import { windowReachesBefore, type FeedLogFilter } from './components/feed-log';
import { TodayHead } from './components/TodayHead';
import { dashboardWords } from './dashboard-words';
import { TabPanel } from './components/TabPanel';
import { StatisticsTab } from './components/StatisticsTab';
import { ExposureView } from './components/ExposureView';
import { PatternsTab } from './components/PatternsTab';
import { authorProfileKey } from '../../forensics/author-store';

import { ShieldAlert } from '../shared/icons/lucide';
import { OperationalEventsPanel } from './components/OperationalEventsPanel';
import { OverviewTab } from './components/OverviewTab';
import { flaggedItemsAllMonths, olderMonthsNotCounted, type MonthSets, type OlderMonthsProgress } from './month-sets';
import { countOlderMonths } from './month-sets-store';

// ─── Theme application ───
// Single source: ../shared/theme (D5 de-tangle 2026-07-14). This file
// previously carried drifting inline copies of resolveTheme/applyTheme and
// the eager pre-mount apply — the exact fork shared/theme.ts:11-13 says it
// replaced in 2026-05-24. Locked by tests/unit/ui/dashboard/theme-single-source.source.test.ts.
eagerApplyStoredTheme();
// The look chosen in the popup is the dashboard's look too, before the first paint and when it changes there.
eagerApplyStoredLook();
followStoredLook();

// ─── Operational (Issues) tab ───
// Q25: the panel used to run its own full O(N) crypto chain walk on mount,
// duplicating the verdict the Dashboard already holds. Pass it down; the
// panel still falls back to its own walk when the verdict is absent
// (unverified-since-refresh, W13) so the tab never shows a stale shield.
function OperationalTab({ integrity }: { integrity: IntegrityResult | null }) {
  return <OperationalEventsPanel integrity={integrity} />;
}

// ─── Main Dashboard ───
/**
 * Which backup card a household sees, and why there are two.
 *
 * `assessBackupHealth` has told the two states apart since it was written:
 * 'failing' is a copy that was attempted and errored, 'never' is one that has
 * not run yet. This card said "the automatic backup is not working" for both,
 * so a fresh install opened on a first screen reporting a failure that had not
 * happened; the daily copy simply had not come round. A household told that
 * something is broken when it is not learns to discount the next warning, and
 * the next warning is the one that matters.
 */
export function backupAttentionCopy(
  level: 'failing' | 'never',
  t: {
    attnBackupNeverTitle: string; attnBackupNeverBody: string;
    attnBackupFailingTitle: string; attnBackupFailingBody: string;
  },
): { title: string; body: string } {
  return level === 'never'
    ? { title: t.attnBackupNeverTitle, body: t.attnBackupNeverBody }
    : { title: t.attnBackupFailingTitle, body: t.attnBackupFailingBody };
}

function Dashboard() {
  const [records, setRecords] = useState<ForensicRecord[]>([]);
  // Newest page of the chain, present only between first paint and the full
  // read (the progressive load of 2026-08-03). INVARIANT: `records` only ever holds
  // the full set (or [] before it lands) — every consumer that states a total,
  // exports, or verifies reads `records`; only the Activity feed paints from
  // this page, under an explicit "while the full archive loads" trust line.
  const [firstPage, setFirstPage] = useState<ForensicRecord[] | null>(null);
  // Tip of the last-applied record set. The passive re-pull (visibility / focus
  // / settle) compares against this and skips the state churn when nothing was
  // appended, so the virtualized feed is not re-rendered (and re-measured) under
  // a scrolling user. Kept in sync with `records` by an effect below, so it
  // tracks every setter (load, heal, recheck) without scattering updates.
  const lastRecordTipRef = useRef<string>('0');
  // Checkpoint of the last completed FULL walk (load or manual Verify). The
  // passive refresh extends it over appended records only — full crypto on
  // the new segment, prefix proven unchanged by shape (see extendChainIntegrity
  // scope note); retroactive prefix tampering is still caught by the full
  // walks, which are unchanged.
  const verifyWatermarkRef = useRef<ChainVerifyWatermark | null>(null);
  // The chain as stored, for every integrity walk; `records` is the blanked copy the tabs see.
  const rawRecordsRef = useRef<ForensicRecord[]>([]);
  // The stored rows that did not decode, so the walk reports them as damaged and not the chain as broken.
  const unreadableRowsRef = useRef<UnreadableStoredRecord[]>([]);
  const [drill, setDrill] = useState<ActivityDrill | null>(null);
  const [integrity, setIntegrity] = useState<IntegrityResult | null>(null);
  // D3: cross-month verification result. Populated only by the explicit
  // Verify action (each archived month is a separate IDB database; loading
  // them is not part of first paint). Null = not run or no archives.
  const [crossMonth, setCrossMonth] = useState<CrossMonthIntegrityResult | null>(null);
  // Cheap on purpose: this counts archived months without reading a single
  // record, so the banner can state its scope without paying for the O(N)
  // cross-month walk on every dashboard open.
  const [archivedMonthCount, setArchivedMonthCount] = useState(0);
  // Records held in the archives. `records` is the ACTIVE chain only, so the
  // header would otherwise report a total that DROPS every time the cap is
  // enforced — the app appearing to lose records at the moment it started
  // keeping them. Counted, never unwrapped, like the month listing above.
  const [archivedRecordCount, setArchivedRecordCount] = useState(0);
  // When the archives were counted. They are counted once per load, so the header says the time.
  const [archivedCountedAt, setArchivedCountedAt] = useState<Date | null>(null);
  /** Rows that are stored and did not decode on this install (M212). Not absent, not lost. */
  const [unreadableCount, setUnreadableCount] = useState(0);
  /** False when at least one archived month could not be read, so the count above is a floor. */
  const [archivedRecordCountComplete, setArchivedRecordCountComplete] = useState(true);
  /**
   * True only once the archives were counted, completely, on this load. Until then a 0 above means "not known yet",
   * and after a failed or partial count it means "at least 0": neither may switch the whole-record export off (the
   * head, 9 Oct 2026: a person whose records are all archived saw "Nothing is recorded yet" over a disabled card).
   */
  const [archivedCountSure, setArchivedCountSure] = useState(false);
  // The archived months, unwrapped and blanked, oldest first (wiring audit
  // 13 Sep, C1/C2/C3, D1-3, D1-10). Every counter that describes "the record"
  // reads `allRecords` below, which is these plus the active chain; before
  // this, Overview, Exposure, Patterns, Statistics and Usage counted the active
  // chain alone, so the month rotation zeroed them and every eviction at the
  // cap lowered them. Loaded after first paint (it is the expensive read), and
  // `archivesPending` says so until it lands. The active chain stays its own
  // list for the ledger, the exports and the integrity walks, which are per
  // chain by construction.
  const [archiveRecords, setArchiveRecords] = useState<ForensicRecord[]>([]);
  const [archivesPending, setArchivesPending] = useState(true);
  // Item 7 (14 Sep 2026): the archived months' summaries, read at boot in
  // place of the months themselves. Counts only, derived from each archive
  // and recomputed when an archive's record count stops matching. The header
  // and the stats are built from these plus the active chain until a tab
  // that needs the records themselves asks for them (ensureArchivesLoaded).
  const [monthSummaries, setMonthSummaries] = useState<MonthSummary[]>([]);
  // Each archived month counted by the module's rules (month-sets.ts), filled
  // in the background after the summaries load; until a month is counted the
  // badge adds its summary and the header says how far the count has come.
  const [monthSets, setMonthSets] = useState<ReadonlyMap<string, MonthSets>>(new Map());
  const [olderMonthsProgress, setOlderMonthsProgress] = useState<OlderMonthsProgress | null>(null);
  const olderMonthsCountingRef = useRef(false);
  const [archivesLoaded, setArchivesLoaded] = useState(false);
  // Item 7, second slice: the months whose records are in the page. Only the
  // months inside the walk window (archive-window.ts, the last 90 days) are
  // ever loaded for the tabs; every older month stays a summary. A month is
  // in this set or in the summaries fold below, never both, so no counter
  // can count a month twice or drop one.
  const [loadedMonthKeys, setLoadedMonthKeys] = useState<ReadonlySet<string>>(() => new Set());
  const archivesLoadingRef = useRef(false);
  // Per-month verdicts from the last cross-month Verify. Archives do not change
  // when the active chain grows, so the passive refresh re-uses them and only
  // re-checks the current chain instead of reading the banner as "never
  // verified" (D2-22). Keyed by month; the records are what the link check
  // between the last archive and the current chain needs, and the rows that
  // did not decode are kept so the refresh checks a reset's link as Verify does.
  const archiveVerdictsRef = useRef<Map<string, IntegrityResult> | null>(null);
  const archivesRef = useRef<Array<{ monthKey: string; records: ForensicRecord[]; unreadable?: readonly DamagedRow[] }>>([]);

  // An unreadable store must not render as a quiet one.
  const [recordReadFailed, setRecordReadFailed] = useState(false);
  // D3: per-author escalation keyed by authorProfileKey(handle, platform).
  const [escalations, setEscalations] = useState<Map<string, AuthorEscalation> | null>(null);
  const [license, setLicenseState] = useState<LicenseInfo>(FREE_LICENSE);
  const [anchorCreatedAt, setAnchorCreatedAt] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  // M186's note (chain-height-witness.ts): read once at load and again on the
  // passive refresh below, so a loss the worker states while this dashboard is
  // already open still reaches the banner without a manual reload.
  const [chainWitness, setChainWitness] = useState<ChainHeightWitness | null>(null);
  const [parentFeedback, setParentFeedback] = useState<Map<string, ParentFeedback>>(new Map());
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  // Activity is the landing surface (product decision, 2026-07-22: open on
  // what actually happened in the feed, not the summary). Popup deep-links
  // (#flagged etc.) still land on the pre-filtered Activity feed, unchanged.
  // The Feed log opens first (the owner's report, 10 Oct 2026): what the feed showed today and what Feedprint did.
  const [tab, setTab] = useState<TabId>(() => 'feedlog');
  const [feedLogFilter, setFeedLogFilter] = useState<FeedLogFilter>({ window: 'today' });
  /** Every "show me the posts" on the other tabs lands here, already filtered. A click-through names its own window. */
  const openFeedLog = (filter: FeedLogFilter) => { setFeedLogFilter({ window: 'all', ...filter }); setTab('feedlog'); };
  // The Feed log's "Accounts not recorded" opens the Record tab at that list (his walk of 12 Oct 2026, V6).
  const [exclusionsFocus, setExclusionsFocus] = useState(0);
  const openExclusions = () => { setTab('forensics'); setExclusionsFocus((n) => n + 1); };
  /**
   * Which card the Export tab should put the reader on, when something sent
   * them there to do one thing (2026-09-19). Cleared the moment the reader
   * leaves that tab, so returning to Export by hand later opens it at the top
   * like any other visit rather than yanking them back down to the backup.
   */
  const [exportLandOn, setExportLandOn] = useState<'backup' | null>(null);
  useEffect(() => { if (tab !== 'export') setExportLandOn(null); }, [tab]);
  const [loading, setLoading] = useState(true);
  // load() itself failed (signing metadata not acknowledged, storage reads
  // rejecting). Renders the failure + Retry shell — records=[] alone would
  // wear the first-run welcome, telling a parent an unreadable store is empty.
  const [loadFailed, setLoadFailed] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  // The restore's confirmation, held HERE and not in the export tab, because
  // the restore's own refresh unmounts that tab (the `!archiveLoading` guard on
  // the render below) and took the sentence with it: the record came back hash
  // for hash and the screen said nothing (board line c2, 14 Sep 2026). The hold
  // and its ten second timer live in ui/dashboard/restore-notice.ts.
  const restoreNotice = useRestoreNotice();
  // Seed from the synchronously-readable mirror so the initial render agrees
  // with the pre-paint eagerApplyStoredTheme() pass instead of flashing dark
  // until the full data load settles (found 2026-08-02).
  const [themePref, setThemePref] = useState<DashboardTheme>(() => readThemeMirror() ?? 'dark');
  // Issues-reviewed watermark (ms epoch). Events at or before it stop counting
  // toward the Issues badge. Sidecar in chrome.storage.local — the chain is
  // append-only evidence and is never mutated by review state.
  const [opAckedUntil, setOpAckedUntil] = useState(0);
  const [settings, setSettings] = useState<{
    features?: { 'hide-engagement-metrics'?: { enabled?: boolean } };
    uiLanguage?: string;
  }>({});

  // Register item 20 part 1: withhold one record. The worker writes a signed
  // marker naming the record and its hash; the stored record is untouched and
  // the reload blanks the copy every tab sees.
  const withholdRecord = async (r: ForensicRecord, reason: string): Promise<boolean> => {
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'REDACTION_MARKER',
        payload: { recordId: r.id, recordHash: r.integrityHash, fields: [...REDACTED_FIELDS], reason: reason.slice(0, 200) },
      }) as { ok?: boolean; error?: string } | undefined;
      if (!resp?.ok) {
        console.warn('[FeelingWise] withhold failed:', resp?.error ?? 'no response');
        return false;
      }
      await load({ quiet: true });
      return true;
    } catch (err) {
      console.warn('[FeelingWise] withhold failed:', err);
      return false;
    }
  };

  // The re-read after an action (reset, restore, withhold) is quiet: the loading
  // screen and the first-page paint both unmount the tabs and the reset dialog,
  // which would take the action's own result off the screen.
  const load = async ({ quiet = false }: { quiet?: boolean } = {}) => {
    if (!quiet) setLoading(true);
    setLoadFailed(false);
    setFirstPage(null);
    // A reset or a restore files the outgoing chain into the month archives, so
    // the months are read again after every load, not once per page.
    archivesLoadingRef.current = false;
    setArchivesLoaded(false);
    try {
      // One-shot migration (persisted stamp): recover the chainPosition the
      // pre-2026-06-11 relegation stripped from pre-rekey records, so the
      // complete-chain export verifies them again. Runs before the reads so
      // this load already sees the repaired records; outcome lands in the
      // Issues tab via the heal log.
      try {
        await repairRelegatedPositions();
      } catch (e) {
        console.warn('[fw] relegation position repair failed', e);
      }
      // Register item 18: every repair in the heal log is disclosed on the
      // chain once, as a signed marker, at the first load after it ran.
      void discloseRepairsOnChain();
      const [lic, signing, fb, s] = await Promise.all([
        getLicense(),
        chrome.runtime.sendMessage({ type: 'GET_SIGNING_METADATA' }) as Promise<{
          ok?: boolean;
          metadata?: { fingerprint: string; createdAt: string | null };
          error?: string;
        }>,
        getAllParentFeedback(),
        getSettings(),
      ]);
      if (!signing?.ok || !signing.metadata) {
        throw new Error(signing?.error ?? 'Signing metadata was not acknowledged');
      }
      setLicenseState(lic);
      setFingerprint(signing.metadata.fingerprint);
      setAnchorCreatedAt(signing.metadata.createdAt);
      setParentFeedback(fb);
      setThemePref(s.dashboardTheme);
      setSettings(s as { features?: { 'hide-engagement-metrics'?: { enabled?: boolean } }; uiLanguage?: string });
      // Progressive load (2026-08-03): unwrapping the whole compressed chain
      // before first paint cost 832 ms at 13.5k records, and every component
      // of that cost scales with N. Paint the Activity feed from the newest
      // page first; the full read stays the only source of truth. A null page
      // (read error) or an empty one simply falls through to the full read —
      // the pre-turn-170 behavior exactly.
      const page = quiet ? null : await getRecordsFirstPage(FIRST_RECORD_PAGE);
      if (page !== null && page.length > 0) {
        setFirstPage(applyRedactions(page));
        setLoading(false);
      }
      // Withheld records reach every tab blanked (register item 20 part 1);
      // the integrity walk below reads the raw chain, whose bytes are intact.
      // getRecordsDetailed, not getRecords (M212). The plain reader answers an
      // empty list when a single stored row will not decode, so one damaged
      // entry showed a person with three good ones an empty feed and a banner
      // saying the store could not be opened, which was not what happened. This
      // one answers with the rows it read AND the rows it could not, and the
      // banner is given the second number so the page can say which it is.
      const read = await getRecordsDetailed().catch(() => null);
      const rawRecs = read?.records ?? [];
      setUnreadableCount(read?.unreadable.length ?? 0);
      rawRecordsRef.current = rawRecs;
      unreadableRowsRef.current = read?.unreadable ?? [];
      const recs = applyRedactions(rawRecs);
      setRecords(recs);
      // Paint the feed NOW. Chain verification is an O(N) SHA-256 + ECDSA walk
      // over the whole chain; awaiting it before clearing the spinner made an
      // 8k-record chain take seconds to first paint. Run verification AFTER
      // paint, each read in its own guard so a verify error never blanks the
      // already-shown feed; the integrity banner fills in when it resolves.
      // (`integrity` initializes null and every render site uses `integrity?.`,
      // so an unverified first paint is safe.)
      // A throw from the detailed reader is the store refusing to open at all,
      // which is the only thing this flag has ever meant. A partial read is a
      // different state and is carried by unreadableCount instead.
      setRecordReadFailed(read === null || lastRecordReadFailed());
      setFirstPage(null);
      setLoading(false);
      try {
        const integ = await verifyChainIntegrity(rawRecs, unreadableRowsRef.current);
        // Verification is read-only. In particular, a matching-key signature
        // failure remains visible; re-anchoring it would hide the failure.
        setIntegrity(integ);
        verifyWatermarkRef.current = chainWatermarkFrom(rawRecs, integ);
      } catch (e) {
        console.warn('[fw] chain integrity check failed', e);
      }
      // How many archived months exist. A listing only — no records read, no
      // signatures checked — so the banner can be honest about what its green
      // state does and does not cover without paying the cross-month walk.
      try {
        setArchivedMonthCount((await listArchiveMonths()).length);
        // `.count` is a floor, not the total, when `.complete` is false: the
        // month enumeration failed or a month would not open. Before that flag
        // existed (adversarial read, 18 Sep 2026) one unreadable month silently
        // shrank every all-time figure on this page and nothing said so. The
        // number still shows, because a blank is worse, and the gap is carried
        // beside it so a surface can say the figure is a floor.
        const counted = await countArchivedRecords();
        setArchivedRecordCount(counted.count);
        setArchivedCountedAt(new Date());
        setArchivedRecordCountComplete(counted.complete);
        setArchivedCountSure(counted.complete);
        if (!counted.complete) {
          console.warn('[fw] the archived record count is a floor; these months would not open:', counted.unreadableMonths);
        }
      } catch (e) {
        setArchivedCountSure(false);
        console.warn('[fw] archive month listing unavailable', e);
      }
      // M186's note. Best effort by its own contract (readChainHeightWitness
      // never throws), but this load must not be the one place that blanks a
      // stated loss on a storage hiccup, so it stays outside the reads it does
      // not depend on.
      try {
        setChainWitness(await readChainHeightWitness());
      } catch (e) {
        console.warn('[fw] chain height witness unavailable', e);
      }
      // The archived months' summaries (item 7): counts per month, so the
      // header and the stats describe the whole record without reading a
      // single archived record at boot. The months themselves load on demand
      // (ensureArchivesLoaded) for the tabs that walk records. A summary that
      // cannot be read leaves the figure low, never blank; the count above
      // says how many records the archives hold, so a gap is visible.
      try {
        const summaryRead = await readMonthSummaries();
        setMonthSummaries(summaryRead.summaries);
        // Not awaited: one month at a time with the page free between months.
        if (!olderMonthsCountingRef.current) {
          olderMonthsCountingRef.current = true;
          void countOlderMonths(summaryRead.summaries, summaryRead.complete, (sets, progress) => {
            setMonthSets(new Map(sets));
            setOlderMonthsProgress(progress.done < progress.total ? progress : null);
          }).finally(() => { olderMonthsCountingRef.current = false; });
        }
        if (!summaryRead.complete) {
          setArchivedRecordCountComplete(false);
          console.warn('[fw] at least one archived month summary could not be read; every all-time fold below is a floor');
        }
      } catch (e) {
        console.warn('[fw] month summaries unavailable', e);
        setMonthSummaries([]);
      }
      // D3: author severity trends for the frequent-flaggers panel. Post-paint
      // like the reads above; failure just leaves the panel without trend chips.
      try {
        const profiles = await getAllAuthorProfiles();
        const esc = computeAuthorEscalation(recs, profiles);
        setEscalations(new Map(esc.map(e => [authorProfileKey(e.handle, e.platform), e])));
      } catch (e) {
        console.warn('[fw] author escalation unavailable', e);
        setEscalations(null);
      }
    } catch (err) {
      // Pre-fix any rejection here (IDB corruption, quota error, the signing-
      // metadata handshake not acknowledged) landed on records=[] with no flag,
      // and the empty state it rendered was the first-run welcome: a parent
      // whose evidence store failed to READ was told the record was EMPTY.
      // Flag it; the render below swaps the tabs for the failure + Retry shell.
      console.error('[FeelingWise] Dashboard load failed:', err);
      setLoadFailed(true);
      setRecords([]);
      setFirstPage(null);
    } finally {
      setLoading(false);
    }
  };

  const onParentFeedback = async (recordId: string, kind: 'confirmed' | 'disputed') => {
    setFeedbackError(null);
    try {
      // Pressing the button that is already on takes the answer back (D1-29).
      if (parentFeedback.get(recordId)?.feedback === kind) {
        await removeParentFeedback(recordId);
        setParentFeedback(prev => {
          const next = new Map(prev);
          next.delete(recordId);
          return next;
        });
        return;
      }
      const entry = await addParentFeedback(recordId, kind);
      setParentFeedback(prev => {
        const next = new Map(prev);
        next.set(recordId, entry);
        return next;
      });
    } catch (e) {
      console.warn('[fw] parent feedback persist failed', e);
      setFeedbackError(t.verdictSaveFailed);
    }
  };

  const handleConfirm = (record: ForensicRecord) => { void onParentFeedback(record.id, 'confirmed'); };
  const handleDispute = (record: ForensicRecord) => { void onParentFeedback(record.id, 'disputed'); };
  const handleViewOriginal = (_record: ForensicRecord, url: string | null) => {
    if (!url) return;
    // Route through the SW so the new tab is registered as an inspection tab
    // (mode 'reveal') and the content script leaves the post visible — a
    // directly-created tab would get full protection re-applied and hide the
    // very post the parent came to inspect.
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      void safeSendMessage({ type: 'OPEN_ORIGINAL', payload: { url } });
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  // Light recheck — ask the SW to re-open the original in a background tab so the
  // content script re-extracts fresh metrics + re-runs the check (a new sighting
  // lands through the normal FORENSIC_LOG path). On success, re-read the chain so
  // the new popularity-over-time point appears. Returns whether it succeeded so
  // the card can flip its button to "rechecked".
  const handleRecheck = async (_record: ForensicRecord, url: string | null): Promise<boolean> => {
    if (!url || typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return false;
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'RECHECK_RECORD', payload: { url } }) as
        { ok?: boolean; recorded?: boolean; error?: string } | undefined;
      if (!resp?.ok || resp.recorded !== true) {
        // Surfaced on the card as "Refresh failed"; keep the diagnostic here.
        // Without the post's address, which can carry its author's handle.
        console.warn('[fw] recheck produced no new sighting', { resp });
        return false;
      }
      // Blank the withheld fields, exactly as the initial load and the
      // visibility refresh do. This was the one of four call sites that set the
      // records state from the raw chain, so a single Refresh on a card
      // un-redacted the whole session — every tab, and every JSON, CSV or PDF
      // taken from it afterwards — until the dashboard was reloaded. The raw
      // set still goes to rawRecordsRef, which is what the integrity walk reads
      // and where the bytes must stay intact.
      // Same reader as the boot read: without it a Refresh on one card put the
      // page straight back to an empty feed (M212).
      const reread = await getRecordsDetailed();
      const rawRecs = reread.records;
      setUnreadableCount(reread.unreadable.length);
      rawRecordsRef.current = rawRecs;
      unreadableRowsRef.current = reread.unreadable;
      setRecords(applyRedactions(rawRecs));
      return true;
    } catch (e) {
      console.warn('[fw] recheck failed', e);
      return false;
    }
  };

  useEffect(() => { void load(); }, []);

  // One clock for the page, read once a minute (decision 8, the Head, 10 Oct 2026): a new Date() on every render gave
  // Statistics a new `now` each time and threw away every sum it keeps against it. A minute is finer than any figure
  // the page dates, and Today and the Feed log's months move at midnight within it.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // The archived months inside the walk window are read on demand, the first
  // time a tab that walks records opens after each load (every tab but
  // Activity), because a reset or a restore changes the months. Older months
  // are never read here, since their summaries carry their share of every
  // counter; a month that cannot be read stays summarised, and Verify still
  // walks every month.
  // The Feed log reads the archived months when its window starts before the active record does (the month flipped
  // inside it) or when All is chosen; Today on a record that began before today reads the active record only.
  const feedLogNeedsMonths = tab === 'feedlog' && windowReachesBefore(records, feedLogFilter.window ?? 'today', now);
  const ensureArchivesLoaded = async (): Promise<void> => {
    if (archivesLoadingRef.current) return;
    archivesLoadingRef.current = true;
    setArchivesPending(true);
    try {
      const wanted = monthKeysInWindow(await listArchiveMonths(), new Date(), WALK_WINDOW_DAYS);
      const loaded = await loadArchiveMonths(wanted);
      const archives = loaded.months;
      if (loaded.unreadableMonths.length > 0) {
        // Named rather than only logged (adversarial read, 18 Sep 2026): the
        // loaded set is exactly `months`, so a month that would not open is
        // missing from every fold built here and must not read as a month that
        // held nothing.
        setArchivedRecordCountComplete(false);
        console.warn('[fw] these archived months would not open and are absent from the walk:', loaded.unreadableMonths);
      }
      archivesRef.current = archives.map(a => ({ monthKey: a.monthKey, records: a.records }));
      setArchiveRecords(applyRedactions(archives.flatMap(a => a.records)));
      setLoadedMonthKeys(new Set(archives.map(a => a.monthKey)));
    } catch (e) {
      console.warn('[fw] archived months unavailable for counting', e);
      archivesRef.current = [];
      setArchiveRecords([]);
      setLoadedMonthKeys(new Set());
    } finally {
      setArchivesPending(false);
      setArchivesLoaded(true);
    }
  };
  useEffect(() => {
    // The Feed log's Today and Last 7 days read the active record; its All, like the other tabs, needs the months.
    if (loading || loadFailed || tab === 'activity' || (tab === 'feedlog' && !feedLogNeedsMonths) || archivesLoaded) return;
    void ensureArchivesLoaded();
  }, [tab, loading, loadFailed, archivesLoaded, feedLogNeedsMonths]);

  // Keep the passive-refresh skip-guard aligned with the live record set,
  // regardless of which path set it (load, position repair, recheck). Cheap O(1).
  useEffect(() => { lastRecordTipRef.current = recordTip(records); }, [records]);

  // Issues-reviewed watermark: load once; opening the Issues tab advances it
  // (the badge clears — the parent has seen them). Storage failure is benign:
  // the badge just keeps counting the full 24h window.
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    chrome.storage.local.get('fw_op_events_acked_until')
      .then(v => { const n = Number(v?.fw_op_events_acked_until); if (Number.isFinite(n)) setOpAckedUntil(n); })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (tab !== 'operational') return;
    const now = Date.now();
    setOpAckedUntil(now);
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      void chrome.storage.local.set({ fw_op_events_acked_until: now }).catch?.(() => {});
    }
  }, [tab]);

  // After a passive refresh grew the chain: apply the extended verdict, or,
  // when the extension refused (prune, re-anchor, prior break:
  // extendChainIntegrity's guards) or there was no watermark, run the full
  // walk. Before this the banner sat at "Checking record" with nothing
  // checking, until a manual Verify (wiring audit 13 Sep, D2-7). The archived
  // months did not change, so their verdicts from the last Verify are reused
  // and only the link into the grown current chain is re-checked; without
  // that the whole-record banner read as "never verified" after every
  // append (D2-22).
  // The header and the banner read the same lines, so neither can stay green over a record whose
  // whole-record export reads partly verified. A failed read leaves both walks as they were.
  const withRecordLines = async (
    current: ForensicRecord[],
    archives: ReadonlyArray<{ records: ForensicRecord[] }>,
    currentResult: IntegrityResult,
    cross: CrossMonthIntegrityResult,
  ): Promise<void> => {
    let recordLines: RecordLines | undefined;
    try {
      recordLines = await readRecordLines(current, archives, cross.perRecord);
    } catch (e) {
      console.warn('[fw] whole-record line reading failed', e);
    }
    setIntegrity(recordLines ? { ...currentResult, recordLines } : currentResult);
    setCrossMonth(recordLines ? { ...cross, recordLines } : cross);
  };

  const settleRefreshVerify = (rawRecs: ForensicRecord[], ext: IntegrityResult | null): Promise<void> =>
    (ext ? Promise.resolve(ext) : verifyChainIntegrity(rawRecs, unreadableRowsRef.current))
      .then((result) => {
        // An append cannot take back a line set aside in the archive, so the last reading holds
        // until the one below replaces it, and the header does not flash green in between.
        setIntegrity((prev) => (prev?.recordLines ? { ...result, recordLines: prev.recordLines } : result));
        verifyWatermarkRef.current = result.valid ? chainWatermarkFrom(rawRecs, result) : null;
        const kept = archiveVerdictsRef.current;
        if (kept && archivesRef.current.length > 0) {
          return verifyChainIntegrityAcrossMonths(rawRecs, archivesRef.current, {
            archiveResults: kept,
            currentResult: result,
          }).then((cross) => withRecordLines(rawRecs, archivesRef.current, result, cross));
        }
      })
      .catch((e) => console.warn('[fw] refresh verify failed', e));

  // The dashboard is otherwise a one-shot snapshot: a tab left open showed
  // frozen counts forever (live report 2026-06-11). Re-pull the cheap data
  // (records / stats / feedback) whenever the tab regains visibility; the
  // chain re-verify stays manual (Verify button) — it is O(chain) work.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      // Cheap and independent of the record read below: a loss can be stated
      // by the worker's own heartbeat while this tab sits open, and the note
      // it writes is a settings read, not a chain walk.
      void readChainHeightWitness().then(setChainWitness).catch(() => {});
      // The detailed reader, as the boot read uses: the plain one answers an
      // empty list when one stored row will not decode, and the walk below
      // must be told which rows those are.
      void Promise.all([getRecordsDetailed(), getAllParentFeedback()])
        .then(([read, fb]) => {
          const rawRecs = read.records;
          const recs = applyRedactions(rawRecs);
          // Parent feedback is a small per-card sidecar; apply it always.
          setParentFeedback(fb);
          // Skip the record/stats churn when nothing was appended since the last
          // applied set. Replacing the array re-renders the whole virtualized
          // feed and re-fires ResizeObserver measurement, which a scrolling user
          // sees as the feed drifting on its own. Append-only chain → an
          // unchanged tip means an identical set.
          if (recordTip(recs) === lastRecordTipRef.current) return;
          rawRecordsRef.current = rawRecs;
          unreadableRowsRef.current = read.unreadable;
          setUnreadableCount(read.unreadable.length);
          setRecords(recs);
          // The chain grew past the last verified snapshot; a kept verdict
          // would be a false attestation (W13). Drop both verdicts FIRST,
          // then extend the last full walk over just the appended records
          // (full crypto on the new segment); settleRefreshVerify falls back
          // to a full walk when the extension refuses (D2-7).
          setIntegrity(null);
          setCrossMonth(null);
          const wm = verifyWatermarkRef.current;
          if (wm) {
            void extendChainIntegrity(rawRecs, wm)
              .then((ext) => settleRefreshVerify(rawRecs, ext))
              .catch((e) => { console.warn('[fw] incremental verify failed', e); return settleRefreshVerify(rawRecs, null); });
          } else {
            void settleRefreshVerify(rawRecs, null);
          }
        })
        .catch(e => console.warn('[fw] dashboard refresh failed', e));
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    // Initial-load freshness (Bug: "initial load incomplete, Refresh counts
    // fixes it"). The boot snapshot in load() can miss enrichment writes —
    // videoContext join, engagement metrics — still in flight from an active
    // capture session, so some cards render without their audio/video context.
    // Re-pull ONCE shortly after first paint through the SAME read path so the
    // snapshot self-corrects without the parent switching tabs. Every count
    // already comes from computeStats over the loaded records; this only
    // closes the read-timing gap. (Records whose context was never persisted —
    // capture happened before the join landed — still need the per-card "Refresh
    // counts" re-extraction; that is by design, not a dashboard read bug.)
    const settle = setTimeout(refresh, 1500);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      clearTimeout(settle);
    };
  }, []);

  // When the parent flips interface language in another FW surface (popup),
  // re-pull settings so the dashboard re-renders in the new language without
  // a manual reload.
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      // `features` matters as much as language: this settings object also
      // drives hideEngagement (FeedCard), so a parent flipping
      // hide-engagement-metrics in the popup must reach an open dashboard
      // without a manual reload. `dashboardTheme` covers the same change
      // made from another surface.
      if (changes.uiLanguage || changes.features || changes.dashboardTheme) {
        getSettings()
          .then((s) => {
            setSettings(s as { features?: { 'hide-engagement-metrics'?: { enabled?: boolean } }; uiLanguage?: string });
            if (changes.dashboardTheme) {
              const t = changes.dashboardTheme.newValue;
              if (t === 'dark' || t === 'light' || t === 'system') setThemePref(t);
            }
          })
          .catch((e) => console.error(e));
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  // Apply theme on every preference change. When pref === 'system', also listen
  // for OS-level prefers-color-scheme flips so the dashboard keeps mirroring the OS.
  useEffect(() => {
    applyTheme(themePref);
    if (themePref !== 'system') return;
    return subscribeToSystemThemeChanges(() => applyTheme('system'));
  }, [themePref]);

  const setTheme = (t: ThemeChoice) => {
    setThemePref(t);
    void saveSettings({ dashboardTheme: t });
  };

  const onVerify = async () => {
    const raw = rawRecordsRef.current.length > 0 ? rawRecordsRef.current : records;
    const integ = await verifyChainIntegrity(raw, unreadableRowsRef.current);
    setIntegrity(integ);
    verifyWatermarkRef.current = chainWatermarkFrom(raw, integ);
    // D3: the same explicit action also walks every archived month plus the
    // rotation links between months. Read-only, like the current-chain
    // verify. Failure here never blanks the current-chain result.
    try {
      const archives = await loadArchivesOldestFirst();
      archivesRef.current = archives.map(a => ({ monthKey: a.monthKey, records: a.records, unreadable: a.unreadable }));
      if (archives.length > 0) {
        const cross = await verifyChainIntegrityAcrossMonths(raw, archives, { currentResult: integ });
        archiveVerdictsRef.current = new Map(
          cross.perMonth.filter(m => m.monthKey !== 'current').map(m => [m.monthKey, m.result]),
        );
        await withRecordLines(raw, archives, integ, cross);
      } else {
        archiveVerdictsRef.current = null;
        setCrossMonth(null);
      }
    } catch (e) {
      console.warn('[fw] cross-month verification failed', e);
      setCrossMonth(null);
    }
  };

  const onReset = () => setResetOpen(true);

  // THE record, as every counter reads it: archived months first (oldest
  // first, the order rotation wrote them), then the active chain. One list,
  // so no panel can count a different span from its neighbour. `records`
  // alone is the active chain and stays what the ledger and the per-chain
  // exports read.
  //
  // De-duplicated by id, the archived copy winning, exactly as the exporter
  // does it and for the same reason it states: archive-on-evict writes a
  // record to its month archive BEFORE deleting it from the active chain, so a
  // record caught mid-move is in both lists. A RESTORE makes that systematic
  // rather than rare. `replaceBackupStateUnderChainLock` retires the whole
  // outgoing chain into the month archives and then writes the backup's
  // records into the active store, so every record the backup shares with the
  // chain it replaced is now in both places. This list was a plain
  // concatenation until 2026-09-19, so after recovering from a disaster, the
  // one moment a person reads these numbers hardest, items seen, flagged and
  // hidden, sessions, the per-account rows and the rhythm map all roughly
  // doubled, and the exported file disagreed with the screen about the same
  // record.
  const allRecords = useMemo(() => {
    if (archiveRecords.length === 0) return records;
    const seen = new Set<string>();
    return [...archiveRecords, ...records].filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
  }, [archiveRecords, records]);
  // The archived share of every counter comes from the records of the months
  // that are loaded (the walk window) plus the summaries of every month that
  // is not (item 7, both slices); the two never overlap, and the fold equals
  // computeStats over all the records by construction (archive-summary.test,
  // archive-window.test). Before any month is loaded that is every summary.
  const unloadedSummaries = useMemo(
    () => summariesOutsideLoaded(monthSummaries, loadedMonthKeys),
    [monthSummaries, loadedMonthKeys],
  );
  const stats = useMemo(
    () => foldSummariesIntoStats(computeStats(allRecords), unloadedSummaries),
    [allRecords, unloadedSummaries],
  );

  // Flagged items over all months: the loaded months counted by the same rule as the
  // Statistics bar, the others from their summaries. The pill says all months.
  const flaggedCount = useMemo(
    () => flaggedItemsAllMonths(allRecords, unloadedSummaries, monthSets),
    [allRecords, unloadedSummaries, monthSets],
  );
  // The whole record's entry count, for the figures that say "all-time":
  // every archived month (counted, never unwrapped) plus the active chain,
  // less the records that are in both.
  //
  // The overlap is real after a restore, for the reason given above
  // `allRecords`. It can only be measured over the months that are loaded,
  // because an unloaded month contributes a count and not its ids; the months
  // a restore duplicates are the ones it has just written, which are the
  // newest and so the ones the walk window holds. So this is the honest
  // correction available here rather than a complete one, and it is a large
  // improvement on adding the same record to itself (2026-09-19).
  const duplicatedInBoth = useMemo(() => {
    if (archiveRecords.length === 0) return 0;
    const archived = new Set(archiveRecords.map((r) => r.id));
    return records.reduce((n, r) => (archived.has(r.id) ? n + 1 : n), 0);
  }, [archiveRecords, records]);
  const wholeRecordCount = archivedRecordCount + records.length - duplicatedInBoth;
  // Nothing stored at all: no entry, no row that failed to decode, and a read
  // that succeeded (a failed read leaves the counts at 0). The daily copy skips
  // an empty chain on purpose, so "no copy yet" is not news there.
  const nothingToBackUp = wholeRecordCount === 0 && unreadableCount === 0 && !recordReadFailed;

  // Issues tab badge: operational-event records in the last 24h that the
  // parent has not yet reviewed (opening the Issues tab advances the
  // watermark — same mental model as a notification badge).
  const opCount = useMemo(() => {
    const cutoff = Math.max(Date.now() - 24 * 60 * 60 * 1000, opAckedUntil);
    return records.filter(r => {
      const ts = Date.parse(r.timestamp);
      if (!Number.isFinite(ts) || ts <= cutoff) return false;
      if (r.verdict === 'cancelled-batch-llm-failure') return true;
      if (r.verdict === 'cancelled-post-llm-failure') return true;
      if (r.verdict === 'cancelled-video-unjudged') return true;
      if (r.verdict === 'cancelled-image-unjudged') return true;
      if (r.verdict === 'cancelled-batch-truncated') return true;
      if (r.verdict === 'skipped' && r.skipReason === 'cap-exhausted') return true;
      if (r.skipReason === 'scan-purged') return true;
      return false;
    }).length;
  }, [records, opAckedUntil]);

  // Resolved interface language. Before settings load, 'auto' resolves from
  // the browser language so even the loading state is localized. The provider
  // feeds useDashboardT() in every child; the root reads the table directly
  // because it renders outside its own provider.
  const lang = resolveUiLanguage(settings.uiLanguage);
  const t = DASHBOARD_STRINGS[lang];

  // Problems the app already knows about AND can fix with one click. Computed
  // here rather than inside a tab, because the whole point is that the parent
  // should not have to open the right tab to discover them.
  const [attention, setAttention] = useState<AttentionItem[]>([]);
  const [attentionTick, setAttentionTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const items: AttentionItem[] = [];
      // A wired folder copy keeps the daily copy from running while it is
      // current, so the level stays 'never' although a copy exists.
      let folderReady = false;
      try {
        const wire = await getBackupFolderWireStatus();
        folderReady = wire.state === 'ready';
        if (wire.state === 'needs-permission') {
          items.push({
            id: 'folder-permission',
            title: t.attnFolderPermTitle(wire.folderName),
            body: t.attnFolderPermBody,
            actionLabel: t.attnFolderPermAction,
            // The browser requires a real user gesture for this grant, which
            // is exactly what the button press is.
            onAction: async () => {
              const granted = await requestBackupFolderPermission();
              if (granted) await mirrorBackupToWiredFolder();
              setAttentionTick(n => n + 1);
              return granted;
            },
          });
        }
      } catch { /* an unreadable wire status is not itself actionable */ }
      try {
        const health = assessBackupHealth(await getBackupHealth(), Date.now());
        // 'never' waits for something to back up; a copy that failed is still
        // shown at 0 entries, because that is a fault and not a pending first run.
        if (health.level === 'failing' || (health.level === 'never' && !nothingToBackUp && !folderReady)) {
          const copy = backupAttentionCopy(health.level, t);
          items.push({
            id: 'backup-failing',
            reminder: health.level === 'never',
            title: copy.title,
            body: copy.body,
            actionLabel: t.attnBackupFailingAction,
            // Opens the tab where the backup is fixed and lands on the button
            // that does it. Nothing is fixed yet, so this never says Done: the
            // reader still has to press it, and may want a passphrase first.
            onAction: () => { setExportLandOn('backup'); setTab('export'); return false; },
          });
        }
      } catch { /* health unreadable */ }
      // The record's own maintenance, when a refusal repeats or needs a person
      // (wiring audit 13 Sep, C28 and C29). Most actions open the record check,
      // which fixes nothing by itself, so they never say Done. The prune's
      // action runs the prune: a backup does not clear it, and the record
      // check would only send the reader looking for a button that is not there.
      try {
        for (const m of maintenanceAttention(await readMaintenanceHealth())) {
          const openCheck = (): boolean => { setTab('forensics'); return false; };
          const runTidy = async (): Promise<boolean> => {
            const resp = await safeSendMessage({ type: 'RUN_RECORD_TIDY' } satisfies FWMessage) as RunRecordTidyResponse | undefined;
            setAttentionTick(n => n + 1);
            return resp?.ok === true;
          };
          if (m.id === 'archive-needs-person') {
            items.push({ id: m.id, title: t.attnArchiveNeedsPersonTitle, body: t.attnArchiveNeedsPersonBody(m.month ?? '?'), actionLabel: t.attnOpenRecordCheck, onAction: openCheck });
          } else if (m.id === 'rotation-stuck') {
            items.push({ id: m.id, title: t.attnRotationStuckTitle(m.days), body: t.attnRotationStuckBody(m.reason), actionLabel: t.attnOpenRecordCheck, onAction: openCheck });
          } else if (m.id === 'stamp-stuck') {
            items.push({ id: m.id, title: t.attnStampStuckTitle(m.attempts), body: t.attnStampStuckBody(m.reasons.join(', ')), actionLabel: t.attnOpenRecordCheck, onAction: openCheck });
          } else if (m.id === 'prune-stale') {
            items.push({ id: m.id, title: t.attnPruneStaleTitle(m.days), body: t.attnPruneStaleBody, actionLabel: t.attnRunTidyNow, onAction: runTidy });
          } else {
            items.push({ id: m.id, title: t.attnPruneStuckTitle, body: t.attnPruneStuckBody(m.runs), actionLabel: t.attnRunTidyNow, onAction: runTidy });
          }
        }
      } catch { /* maintenance health unreadable */ }
      if (!cancelled) setAttention(items);
    })();
    return () => { cancelled = true; };
  }, [attentionTick, t, nothingToBackUp]);

  if (loading) {
    return (
      <I18nProvider lang={lang}>
        <div className="dash-root">
          <DashHeader records={[]} integrity={null} license={FREE_LICENSE} theme={themePref as ThemeChoice} setTheme={setTheme} />
          <div className="dash-shell" style={{ textAlign: 'center', padding: 60, color: 'var(--fw-muted)' }}>
            {t.loading}
          </div>
        </div>
      </I18nProvider>
    );
  }

  // Popup loadFailed idiom: the failure names itself and offers a way out.
  // Rendering the tabs here would put every panel on top of records=[] — the
  // welcome masquerade again, once per surface.
  if (loadFailed) {
    return (
      <I18nProvider lang={lang}>
        <div className="dash-root">
          <DashHeader records={[]} integrity={null} license={FREE_LICENSE} theme={themePref as ThemeChoice} setTheme={setTheme} />
          <div className="dash-shell" role="alert" style={{ textAlign: 'center', padding: 60 }}>
            <ShieldAlert size={40} style={{ color: 'var(--fw-red)' }} />
            <h3 style={{ margin: '12px 0 8px' }}>{t.loadFailedTitle}</h3>
            <p style={{ color: 'var(--fw-muted)', maxWidth: 480, margin: '0 auto 16px' }}>{t.loadFailedBody}</p>
            <button type="button" className="chip" onClick={() => { void load(); }}>{t.retry}</button>
          </div>
        </div>
      </I18nProvider>
    );
  }

  // Progressive-load phase: the Activity feed paints from the newest page
  // while the full chain unwraps. `records` stays full-or-empty, so every
  // other tab and every stated total waits behind the same loading state the
  // whole dashboard showed before the progressive load landed.
  const archiveLoading = firstPage !== null;
  const feedRecords = firstPage ?? records;
  const tabLoadingShell = (
    <div style={{ textAlign: 'center', padding: 60, color: 'var(--fw-muted)' }}>
      {t.loading}
    </div>
  );

  return (
    <I18nProvider lang={lang}>
    {/* data-tab on the root too (not just the shell) so the activity layout can
        shift the header to clear the left-wall radar map (dashboard-design.css). */}
    <div className="dash-root" data-tab={tab}>
      {/* The first stop for a keyboard: on the timeline the first item sat behind some 35 controls. Focus is moved by
          hand because a plain fragment link scrolls without moving focus onto an element that cannot take it. */}
      <a
        className="dash-skip"
        href={tab === 'activity' ? '#feed-start' : `#dash-panel-${tab}`}
        onClick={(e) => {
          const target = document.getElementById(tab === 'activity' ? 'feed-start' : `dash-panel-${tab}`);
          if (!target) return;
          e.preventDefault();
          if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
          target.focus();
        }}
      >
        {dashboardWords(lang).skipToList}
      </a>
      {/* Above everything, including the header: unlike AttentionBanner (per-item,
          dismissable for the day) or ChainBanner (scoped to Forensics), this states
          that evidence is gone, and is the one banner in this product that must not
          be missed or dismissed. Renders nothing when there is no stated loss. */}
      <ChainLossBanner witness={chainWitness} onOpenBackup={() => setTab('export')} />
      <DashHeader
        records={records}
        integrity={integrity}
        license={license}
        theme={themePref as ThemeChoice}
        setTheme={setTheme}
        onVerify={onVerify}
        onReset={onReset}
        onShowForensics={() => setTab('forensics')}
        countsPending={archiveLoading}
        // Less the records that are in both lists, so the chip adds up to wholeRecordCount, the total the Statistics and Record tabs show.
        archivedCount={archivedRecordCount - duplicatedInBoth}
        loadedEntries={allRecords}
        unloadedSummaries={unloadedSummaries}
        archivedCountedAt={archivedCountedAt}
        monthSets={monthSets}
        olderMonthsProgress={olderMonthsProgress}
      />
      {/* A failing copy or a stuck record shows over every tab. The first-backup reminder, which readers named as noise on
          every tab, sits inside the Overview and Export panels instead, so the tabs never move between tabs. */}
      <AttentionBanner items={attention.filter((a) => !a.reminder)} />
      <div className="dash-shell" data-tab={tab}>
        {feedbackError && (
          <div
            role="alert"
            style={{
              margin: '8px 16px 0', padding: '8px 12px',
              borderRadius: 0, fontSize: 12,
              background: 'rgba(239,83,80,0.10)', border: '1px solid rgba(239,83,80,0.40)',
              color: 'var(--fw-red)', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}
          >
            <span>{feedbackError}</span>
            <button
              type="button"
              onClick={() => setFeedbackError(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', opacity: 0.6, fontSize: 14, lineHeight: 1 }}
              aria-label={t.hdrDismissAria}
            >✕</button>
          </div>
        )}
        {/* surface-id: dash-tabs (1.3) — Statistics inserted between Activity and Forensics.
            Chain banner was previously mounted here; it now lives inside ForensicsTab. The
            DashHeader integrity pill (3-state ok/warn/err) is the at-a-glance signal on
            every tab; Forensics is where a parent goes for the full banner + stats. */}
        <div className="dash-tabs" role="tablist">
          <TabBtn id="feedlog"    tab={tab} onClick={setTab}>{t.tabFeedLog}</TabBtn>
          {/* A count beside a tab name read as part of the name; the flagged count is said inside the timeline, with its other counts. */}
          <TabBtn id="activity"   tab={tab} onClick={setTab}>{dashboardWords(lang).tabTimeline}</TabBtn>
          <TabBtn id="overview"   tab={tab} onClick={setTab}>{t.tabOverview}</TabBtn>
          <TabBtn id="statistics" tab={tab} onClick={setTab}>{t.tabStatistics}</TabBtn>
          <TabBtn id="patterns"   tab={tab} onClick={setTab}>{t.tabPatterns}</TabBtn>
          <TabBtn id="exposure"   tab={tab} onClick={setTab}>{t.tabExposure}</TabBtn>
          <TabBtn id="forensics"  tab={tab} onClick={setTab}>{t.tabRecord}</TabBtn>
          <TabBtn id="operational" tab={tab} onClick={setTab} hasIssues={opCount > 0}>
            {/* The mark, not a number: the count was of events in the last day, the page counts issues (12 against 1). */}
            {t.tabIssues}
          </TabBtn>
          <TabBtn id="export"     tab={tab} onClick={setTab}>{t.tabExport}</TabBtn>
        </div>

        {/* While the archive is still unwrapping, every non-activity tab shows
            the same loading note the whole dashboard showed before turn 170:
            each of them states totals or exports, and `records` is not yet the
            chain. The Activity feed alone paints early, from the newest page,
            under its explicit loading trust line. */}
        {/* One boundary around the active panel, keyed by the tab, so a panel
            that throws while rendering costs the reader that panel and not the
            whole dashboard. Before this, a throw in any tab unmounted the tree:
            tab strip, header and all, with no control left to press. Reported
            by a tester on a licensed install, 2026-09-18, on the Issues tab.
            It also carries the tabpanel role and the id TabBtn's aria-controls
            names, which until now pointed at nothing. */}
        <TabPanel id={tab}>
        {/* The day in three short lines leads the Overview (dashboard-words.ts, TodayHead.tsx). Over the timeline it pushed
            the list below the fold and said nothing the Overview does not, so the timeline opens on its list. Under the
            tabs, it never moves them. It waits for the archive like every tab that states a total. */}
        {tab === 'overview' && !archiveLoading && <TodayHead records={allRecords} lang={lang} />}
        {(tab === 'overview' || tab === 'export') && <AttentionBanner items={attention.filter((a) => a.reminder)
          .map((a) => (tab === 'export' && a.id === 'backup-failing' ? { ...a, body: dashboardWords(lang).backupNeverHere } : a))} />}
        {tab !== 'activity' && tab !== 'feedlog' && archiveLoading && tabLoadingShell}
        {/* Paints from the newest page while the rest loads, as the timeline does, and says so. */}
        {tab === 'feedlog' && (
          <FeedLogTab
            records={archiveLoading || !feedLogNeedsMonths ? feedRecords : allRecords}
            loadingRest={archiveLoading || (feedLogNeedsMonths && archivesPending)}
            archivedOlderCount={archivesPending ? 0 : Math.max(0, archivedRecordCount - archiveRecords.length)}
            filter={feedLogFilter}
            onFilter={setFeedLogFilter}
            integrity={integrity}
            onWithhold={withholdRecord}
            onViewOriginal={handleViewOriginal}
            onOpenExclusions={openExclusions}
          />
        )}
        {/* Every tab below counts `allRecords`: the archived months plus the
            active chain (C1, C2, C3). While the archives are still being read
            the tab states so (archivesPending) instead of printing a total
            over the active chain as if it were the whole record. */}
        {tab === 'overview' && !archiveLoading && (
          <OverviewTab
            records={allRecords}
            archivesPending={archivesPending}
            onDrill={(d) => { setDrill({ ...d, seq: (drill?.seq ?? 0) + 1 }); setTab('activity'); }}
            onOpenStatistics={() => setTab('statistics')}
          />
        )}
        {tab === 'activity' && (
          <ActivityTab
            readingOffered={offersReading(license.tier)}
            records={archiveLoading ? feedRecords : allRecords}
            archiveLoading={archiveLoading}
            archivedCount={archivesPending ? archivedRecordCount : archiveRecords.length}
            archivesIncluded={!archivesPending && archiveRecords.length > 0}
            archivedOlderCount={archivesPending ? 0 : Math.max(0, archivedRecordCount - archiveRecords.length)}
            flaggedAllMonths={flaggedCount}
            flaggedAllMonthsTitle={t.tabActivityFlaggedTitle(flaggedCount, olderMonthsNotCounted(unloadedSummaries, monthSets))}
            liveCount={records.length}
            stats={stats}
            parentFeedback={parentFeedback}
            settings={settings}
            onConfirm={handleConfirm}
            onDispute={handleDispute}
            onViewOriginal={handleViewOriginal}
            onRecheck={handleRecheck}
            drill={drill}
            integrity={integrity}
            onVerify={() => { void onVerify(); }}
            onReviewChain={() => setTab('forensics')}
            escalations={escalations}
            readFailed={recordReadFailed}
            onRetry={() => { void load(); }}
          />
        )}
        {tab === 'exposure' && !archiveLoading && <ExposureView records={allRecords} archivesPending={archivesPending} onDrill={(d) => { setDrill({ ...d, seq: (drill?.seq ?? 0) + 1 }); setTab('activity'); }} />}
        {tab === 'patterns' && !archiveLoading && <PatternsTab readingOffered={offersReading(license.tier)} records={allRecords} archivesPending={archivesPending} />}
        {tab === 'statistics' && !archiveLoading && (
          <StatisticsTab
            readingOffered={offersReading(license.tier)}
            records={allRecords}
            archivesPending={archivesPending}
            allTimeCount={wholeRecordCount}
            unloadedSummaries={unloadedSummaries}
            monthSets={monthSets}
            olderMonthsProgress={olderMonthsProgress}
            stats={stats}
            now={now}
            onDrill={(d) => { setDrill({ ...d, seq: (drill?.seq ?? 0) + 1 }); setTab('activity'); }}
          />
        )}
        {tab === 'forensics' && !archiveLoading && (
          <ForensicsTab
            readingOffered={offersReading(license.tier)}
            records={records}
            allRecords={allRecords}
            wholeCount={wholeRecordCount}
            unloadedSummaries={unloadedSummaries}
            archivesPending={archivesPending}
            integrity={integrity}
            crossMonth={crossMonth}
            archivedMonthCount={archivedMonthCount}
            recordReadFailed={recordReadFailed}
            unreadableCount={unreadableCount}
            anchorCreatedAt={anchorCreatedAt}
            fingerprint={fingerprint}
            unsignedCount={stats?.unsignedRecordsCount}
            onVerify={() => { void onVerify(); }}
            onExport={() => setTab('export')}
            onOpenFeedLog={() => openFeedLog({})}
            onOpenAccount={(e) => openFeedLog({ account: { key: e.key, label: e.author } })}
            focusExclusions={exclusionsFocus}
          />
        )}
        {tab === 'operational' && !archiveLoading && <OperationalTab integrity={integrity} />}
        {tab === 'export' && !archiveLoading && (
          <ExportTab
            records={records}
            archivedCount={archivedRecordCount}
            inBothCount={duplicatedInBoth}
            archivedCountSure={archivedCountSure}
            onRestored={(outcome) => { restoreNotice.show(outcome); void load({ quiet: true }); }}
            restoreNotice={restoreNotice.notice}
            onDismissRestoreNotice={restoreNotice.dismiss}
            landOn={exportLandOn}
            onBackupChanged={() => setAttentionTick(n => n + 1)}
          />
        )}
        </TabPanel>
      </div>

      {resetOpen && (
        <ResetChainConfirmModal
          onClose={() => setResetOpen(false)}
          onUnknown={() => { void load(); }}
          onSuccess={(r) => { void (async () => {
            console.info('[fw] reset chain:', r);
            await load({ quiet: true });
          })(); }}
        />
      )}
    </div>
    </I18nProvider>
  );
}

// ─── Mount ───
const rootEl = document.getElementById('root') ?? document.body.appendChild(document.createElement('div'));
createRoot(rootEl).render(
  <StrictMode>
    <Dashboard />
  </StrictMode>,
);
