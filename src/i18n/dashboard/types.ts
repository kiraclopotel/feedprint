// The shape every dashboard language file answers.
//
// Every user-visible string in src/ui/dashboard/Dashboard.tsx is a key here; the components/*
// sub-surfaces have their own tables. The four language files beside this one each declare
// themselves as DashboardStrings, so adding a key to one and not the others is a compile error and
// a translation cannot go missing quietly. Strings that take a value are functions rather than
// template keys, so the call sites stay type-checked.
//
// Romanian register, for whoever writes ./ro.ts: instructional prose takes the polite plural
// ("Alegeti..."), buttons the short imperative ("Continua", "Salveaza"), which is the ordinary
// Romanian software convention. Forensic terms follow the product glossary: local record and chain
// are "registrul local", chain integrity is "integritatea registrului".
//
// Cut out of src/i18n/dashboard-strings.ts on 2026-09-16 (PLAN-2026-09-16 item 10.2).

import type { DecisionAction } from '../../types/forensic';
import type { Level, RecordedMode } from '../../types/mode';
import type { ThemeChoice } from '../../ui/shared/theme';
import type { RecordSetName } from '../../ui/dashboard/record-sets';

export type UsageFrame = 'day' | 'week' | 'month' | 'year';
type FilterKey = 'all' | 'posts' | 'video' | 'flagged' | 'rewritten' | 'hidden' | 'ai' | 'passed' | 'ads' | 'comments' | 'replies' | 'repeat-offenders' | 'blocked' | 'disputed';
export type FilteredKey = Exclude<FilterKey, 'all'>;
/** Engagement-metric nouns used in secondary counters + the growth readout. */
export type MetricWord = 'likes' | 'views' | 'shares' | 'comments' | 'replies' | 'reposts' | 'quotes' | 'bookmarks';
type SafetyBucket = 'swearing' | 'slurs' | 'racial' | 'extreme';
export type FeedActionKey = 'manual' | 'blocked' | 'passed' | 'masked' | 'skipped' | 'rewritten' | 'hidden' | 'flagged' | 'seenALot';
type ExpoActionKey = 'ads' | 'house-rule' | 'detection' | 'ai-block';
export type FeedMediaStatusKey = 'ready' | 'pending' | 'partial' | 'failed' | 'not-supported' | 'no-media';
export type FeedCommentStatusKey = 'captured' | 'not-captured' | 'unavailable';

/** What a gap marker's sentence needs: its reason, its count, and its times as the reader's clock shows them. */
export interface GapSentenceParts {
  reason: string;
  count: number;
  /** Null when the line carried no readable time; the sentence then names none. */
  from: string | null;
  to: string | null;
  /** The site's name, or null when the loss had no site. */
  site: string | null;
}

export interface DashboardStrings {
  // Shell
  loading: string;
  /** The dashboard could not load its data. Never the same as an empty record. */
  loadFailedTitle: string;
  loadFailedBody: string;
  retry: string;
  /** The count beside the Activity tab: records flagged for review, said with its word, never a bare number (N1). */
  tabActivityFlagged: (n: number) => string;
  /** The badge's hover: whether every older month is counted by the module's rules yet, and what a month not counted yet adds. */
  tabActivityFlaggedTitle: (n: number, monthsNotCounted: number) => string;
  tabExposure: string;
  tabStatistics: string;
  tabRecord: string;
  // The Feed log tab (10 Oct 2026): name, line under it, empty window, pointer on the Record tab, column, next rows (n formatted).
  tabFeedLog: string;
  feedLogSub: string;
  feedLogEmpty: string;
  feedLogPointer: string;
  feedLogColAction: string;
  feedLogMore: (n: string) => string;
  feedLogNoMatch: string;
  feedLogClock: string;
  /** The Why of a hidden row whose record saved no reason. */
  feedLogNoReason: string;
  /** The seal badge on an opened Feed log row, one per status of the record check; unverified when the record failed as a whole. */
  // The statuses of RecordVerifyStatus (forensics/chain-integrity.ts), written out: i18n does not import from forensics.
  recordStatusLabel: Record<'verified' | 'unsigned' | 'prior-key' | 'broken' | 'pre-rekey' | 'pre-chain' | 'unverified', string>;
  /** A site the page has no name for. */
  otherSite: string;
  feedLogLast28: string;
  tabIssues: string;
  tabExport: string;

  // Shared buttons
  cancel: string;
  ok: string;

  // Manual-flag form
  verdictSaveFailed: string;

  // Activity tab — KPI row
  kpiRecordsToday: string;
  kpiFlagged: string;
  /** The 14-day chart's legend: what each grey column counts. */
  statsDailyItemsLegend: string;
  kpiBlocked: string;
  kpiActivePlatforms: string;

  // Activity tab — feed panel
  searchPlaceholder: string;
  filterChips: Record<FilterKey, string>;
  chipRewrittenTip: string;
  emptyAll: string;
  emptyFiltered: (filter: FilteredKey, hasSearch: boolean) => string;

  // Activity tab — side rail
  platformBreakdown: string;
  clickToFilter: string;
  noDataYet: string;
  clearNameFilterTip: (name: string) => string;
  showOnlyTip: (name: string) => string;
  techniqueFrequency: string;
  top7Hint: string;
  metricsHidden: string;
  metricsHiddenEmpty: string;
  metricsHiddenFootnote: string;

  // Activity tab — radar map (left gutter)

  // Activity tab — layout editor

  // Usage-time panel (Forensics tab)
  usageTitle: string;
  usageHeaderCount: (total: number, frame: UsageFrame) => string;
  usageSub: (frame: UsageFrame) => string;
  usageFrameChip: (frame: UsageFrame) => string;
  usageActiveLabel: (frame: UsageFrame) => string;
  usageRewritesLabel: string;
  usageBlocksLabel: string;
  usagePassLabel: string;
  usagePeakLabel: (frame: UsageFrame, count: number) => string;
  /** Scans that reached no verdict (skipped, cancelled): their own band, not "pass" (wiring audit 13 Sep, D2-13). */
  usageUnjudgedLabel: string;
  usageChartAria: (frame: UsageFrame) => string;
  usageBarTooltip: (label: string, count: number, flagged: number, blocked: number, pass: number, unjudged: number) => string;
  usageBarIdleTooltip: (label: string) => string;
  usageBarGapTooltip: (label: string, gaps: number) => string;
  legendPass: string;
  legendRewrite: string;
  legendBlock: string;
  legendIdle: string;
  legendGap: string;
  legendUnjudged: string;

  // Forensics tab
  anchorExplainers: { label: string; why: string }[];
  yourRecord: string;
  yourRecordSub: string;
  archiveMonthsTitle: string;
  archiveMonthsSub: string;
  /** Shown by every counting tab while the archived months are still being read (Dashboard.tsx archivesPending). */
  archivesPendingNote: string;
  archiveMonthCurrent: string;
  archiveMonthOk: string;
  archiveMonthFailed: string;
  archiveLinkOk: string;
  archiveLinkBroken: string;
  anchorEntriesDetail: (verified: string | number, pre: number) => string;
  anchorVerifierValue: string;
  /**
   * The wrapper every UTC instant on an evidence surface is printed in.
   * `stamp` comes from formatUtcStamp (src/ui/shared/format-time.ts) and is
   * already "2026-09-18 14:50:44"; this key adds the clock in WORDS, because
   * the rest of the dashboard is on the reader's local clock and a bare "UTC"
   * suffix is what a reader skips. Translations must keep `stamp` first and
   * unchanged, and must not turn the clause into an abbreviation.
   */
  utcStamp: (stamp: string) => string;
  noteUninstallLead: string;
  noteUninstall1: string;
  noteUninstall2: string;
  noteUninstall3: string;
  noteUninstall4: string;
  sortSeverity: string;
  techDetail: (name: string, sev: number) => string;
  originalLabel: string;
  softenedLabel: string;
  openOriginalPost: string;
  withholdBtn: string;
  withholdPrompt: string;
  withholdDone: string;
  withholdFailed: string;
  withheldNote: string;
  withheldShort: string;
  excludeBtn: string;
  excludeDone: string;
  exclusionsTitle: string;
  exclusionsSub: string;
  exclusionsNone: string;
  exclusionRemove: string;
  /** Row note when the record's author is on the not-recorded list (D2-16). */
  ledgerAuthorExcluded: string;
  /** Verdict pill for a swear mask: changed on the page, nothing charged (C13). */
  ledgerMasked: string;
  tiktokNoLink: string;
  noLinkCaptured: string;

  // Export tab
  restoreNotEmptyFallback: string;
  restoreReplaceConfirm: (n: number) => string;
  restoreFailed: string;
  /** W81: the two sealed-restore failures, localized. Lead sentence per cause... */
  restoreSealedKeyMissing: string;
  restoreSealedOtherInstall: string;
  /** ...plus the shared recovery route: other install first, passphrase fallback second (W78 order). */
  restoreSealedRecoveryRoute: string;
  /**
   * W82: the rest of the restore refusals, keyed by the `reason` backup.ts
   * returns. `cause` arguments are untranslated technical text from modules
   * outside that route and are shown verbatim.
   */
  restoreNotJson: string;
  restoreNotAnObject: string;
  restoreMissingSchemaVersion: string;
  restoreSchemaTooNew: (fileVersion: number, supportedVersion: number) => string;
  restoreNoRecordsArray: string;
  restoreSealFormatTooNew: (fileVersion: number) => string;
  restorePassphraseRequired: string;
  restorePassphraseWrong: string;
  restoreStructureInvalid: (cause: string) => string;
  restoreDeliveryPending: (pendingCount: number) => string;
  restoreSafetyBackupFailed: (cause: string) => string;
  restoreStoreReadFailed: (cause: string) => string;
  /** W82: the three key notes backup.ts authors itself. Each keeps the leading space the caller expects. */
  restoreKeyNoRecords: string;
  restoreKeyPassphraseNeeded: string;
  restoreKeyIdentityMismatch: string;
  restoreChainIntact: string;
  restoreChainNote: (err: string) => string;
  restoreChainFallback: string;
  restoreKeyRestored: string;
  restoredMsg: (added: number, skipped: number, anchors: number, chain: string, key: string) => string;
  /**
   * The restore's own confirmation, held by the dashboard so it survives the
   * refresh the restore starts. When the restore replaced nothing it says only
   * how many entries came back, since there are no earlier entries to speak of.
   */
  restoreDoneNotice: (restored: number, replaced: number) => string;
  /** The button that takes that sentence off the screen before its timer does. */
  restoreDoneDismiss: string;
  /**
   * W82: the backup-health line, keyed by the `level` backup.ts already
   * returns. `relativeAge` localizes the age those sentences interpolate.
   */
  relativeAge: (ms: number) => string;
  backupHealthFailing: (cause?: string) => string;
  backupHealthNever: string;
  backupHealthStale: (age: string) => string;
  backupHealthInstallLockedOnly: (age: string) => string;
  backupHealthOk: (age: string) => string;
  /** The automatic copy could not carry the archived history. */
  backupCoveragePartial: (archived: number) => string;
  backupCoverageFix: string;
  /**
   * The fixed-name "latest" copy in Downloads was not written on the last
   * automatic run, so the file whose name says it is the newest one is not.
   * The dated copy for that run IS on disk, which is what this has to say
   * first, or the sentence reads as a lost backup. Added 2026-09-19, when the
   * write outcome stopped being discarded.
   */
  backupLatestCopyStale: string;
  recoveryPassTitle: string;
  // Recovering records from older exports (Export tab; many files per pick).
  salvageChooseFiles: string;
  /** Picks a whole folder; the picker sorts out what is a chain file (owner, 2026-09-03). */
  salvageChooseFolder: string;
  salvageChecking: string;
  recoverTitle: string;
  recoverBody: string;
  recoverHeld: (n: number) => string;
  /** Files in a picked folder that are not .json or .html, passed over without a line each. */
  salvageSkipped: (n: number) => string;
  /** Platform-export comparison notes (wiring audit 13 Sep, D2-30: they were English-only). */
  /** Maintenance attention items (wiring audit 13 Sep, C28 and C29). */
  attnArchiveNeedsPersonTitle: string;
  attnArchiveNeedsPersonBody: (month: string) => string;
  attnRotationStuckTitle: (days: number) => string;
  attnRotationStuckBody: (reason: string) => string;
  attnPruneStuckTitle: string;
  attnPruneStuckBody: (runs: number) => string;
  attnPruneStaleTitle: (days: number) => string;
  attnPruneStaleBody: string;
  attnRunTidyNow: string;
  /** The six-hour time stamp refused for a day (F68, 6 Oct 2026). */
  attnStampStuckTitle: (attempts: number) => string;
  attnStampStuckBody: (reasons: string) => string;
  attnOpenRecordCheck: string;
  /** The whole-record export's progress line (wiring audit 13 Sep, D2-28). */
  everythingStage: (stage: 'reading-archives' | 'reading-keys' | 'building' | 'saving', records: number) => string;
  /** Tooltip on a Confirm or Dispute that is on: pressing again takes it back (D1-29). */
  feedUndoAnswerTip: string;
  /** DESCRIPTOR-V1 effect words on a feed card (PLAN-2026-09-15 item 1). */
  feedEffectLabels: Record<string, string>;
  feedEffectTip: string;
  /** A file too large for the browser page to parse; the gather script's epoch files are the way. */
  salvageTooLarge: (file: string, mb: number) => string;
  salvageSealedBackup: (file: string, byPassphrase: boolean) => string;
  salvageNoRecords: (file: string) => string;
  /** A picked file carried only signing keys (scripts/salvage-keys.ts output). */
  salvageKeysFile: (file: string, kept: number) => string;
  /** Appended to a file's line when its generation's public key was kept. */
  salvageKeyKept: string;
  salvageFileResult: (file: string, imported: number, already: number, rejected: number, epochs: number) => string;
  salvageFileUnreadable: (file: string, reason: string) => string;
  salvageTotal: (files: number, imported: number, already: number, rejected: number) => string;
  recoveryPassIntro: string;
  recoveryPassPlaceholder: string;
  recoveryPassSet: string;
  recoveryPassActive: string;
  recoveryPassSaved: string;
  /** The floor every sealing passphrase must clear (key-wrap.ts PASSPHRASE_MIN_LENGTH). */
  passphraseTooShort: (min: number) => string;
  /**
   * "Back up now" pressed and no file arrived. `reason` is one of
   * `interrupted`, `unconfirmed` or `no-downloads-api` (ManualBackupWrite in
   * forensics/backup.ts). Said out loud since 2026-09-19, when a cancelled
   * Save-As was being recorded as a backup taken.
   */
  backupNotSaved: (reason: string) => string;
  recoveryPassRemove: string;
  /** Attention banner: things that need one click from the parent. */
  attnTitle: string;
  attnFolderPermTitle: (folder: string) => string;
  attnFolderPermBody: string;
  attnFolderPermAction: string;
  attnBackupFailingTitle: string;
  attnBackupFailingBody: string;
  attnBackupFailingAction: string;
  /** The same card when no backup has ever been saved: nothing has failed yet, so it does not say so. */
  attnBackupNeverTitle: string;
  attnBackupNeverBody: string;
  attnDismiss: string;
  attnDone: string;
  courtReadyTitle: string;
  exportIntro: string;
  /** The name the file names its maker by (forensics/profile.ts). */
  profileNameLabel: string;
  profileNameHint: string;
  profileNamePlaceholder: string;
  /**
   * The button beside the name field (2026-09-19). There was none: the value
   * committed on blur and on Enter, both of which work and neither of which is
   * visible. Found on a live install 2026-09-19: a name typed, Enter pressed
   * because nothing else was offered, and no way to tell whether it had taken.
   */
  profileNameSave: string;
  profileNameSaved: (name: string | null) => string;
  exportChooseTitle: string;
  exportChooseShow: string;
  exportChooseShowBody: string;
  exportChooseAll: string;
  exportChooseAllBody: string;
  exportPartialNote: string;
  exportOtherFormats: string;
  pillRecommended: string;
  pdfCardBody: string;
  jsonCardBody: string;
  csvCardBody: string;
  everythingExportDone: (months: number, records: number) => string;
  /** Custody line after an HTML export (register item 17): file, size, SHA-256 of the delivered bytes. */
  exportReceipt: (file: string, bytes: number, sha256: string) => string;
  exportIncluded: (included: number, total: number) => string;
  exportNothingFlagged: string;
  /** Names which exports the included-of-total line describes (D2-6). */
  exportIncludedScope: string;
  /** What the Everything export holds: the active chain plus the archives (D2-6). */
  everythingIncludes: (active: number, archived: number) => string;
  /** Receipt for a download that has no digest (JSON, CSV) (D2-5). */
  exportSavedNote: (file: string, bytes: number) => string;
  /** The PDF print tab opened (D2-5). */
  pdfOpenedNote: (records: number) => string;
  /** The PDF print tab was blocked and the report went to Downloads instead (D2-5). */
  pdfFallbackNote: (file: string, bytes: number) => string;
  exportExcluded: (n: number) => string;
  // Donation card (forensics/donation.ts). Renders only when a build names a
  // recipient; the roster ships empty. The organisation's name is never
  // translated, so every string takes it as an argument.
  donateTitle: (name: string) => string;
  donateBody: (name: string) => string;
  donateNotice: string;
  donateConfirm: (records: number, name: string) => string;
  donateSend: string;
  donateCancel: string;
  donateSent: (records: number, name: string, receipt: string | null) => string;
  donateFailed: (detail: string) => string;
  donateNothing: string;
  backupRestoreTitle: string;
  backupLeadLost: string;
  backupLeadTwoWays: string;
  backupLeadByItself: string;
  backupHowTitle: string;
  backupPassLabel: string;
  /** Why saving needs PASSPHRASE_MIN_LENGTH characters and restoring does not (key-wrap.ts). */
  backupPassFloor: (min: number) => string;
  backupIntro: string;
  backupAutomaticLimit: string;
  folderWireTitle: string;
  folderWireBody: string;
  /** What the wired folder actually receives, in W78's words: automatic copies, install-locked. */
  folderWireAutomaticLimit: string;
  folderWireChoose: string;
  folderWireChange: string;
  folderWireAllow: string;
  folderWireOff: string;
  folderWireStatusReady: (name: string) => string;
  folderWireStatusNeedsPerm: (name: string) => string;
  folderWireStatusNone: string;
  folderWireStatusUnsupported: string;
  folderWireWritten: string;
  /** The dated copy landed and the file a restore reads, or the key beside it, did not. */
  folderWirePartial: string;
  restoreAnyway: string;
  backupNowTitle: string;
  backupNowBody: string;
  restoreTitle: string;
  restoreBody: string;
  /** Restore from a backup folder (14 Sep 2026): the newest copy and the key file beside it, one gesture. */
  restoreFolderTitle: string;
  restoreFolderBody: string;
  /** The picked folder holds no fixed-name newest copy (older layout): use the file picker. */
  restoreFolderNoLatest: string;
  backupPassPlaceholder: string;
  restorePinPlaceholder: string;
  restorePinRequired: string;
  restorePinNotConfigured: string;
  passphraseNote: string;

  // PIN-gated modal (reset)
  enterPinToConfirm: string;
  /**
   * No PIN on this install (an adult install, or a fresh one after a
   * reinstall): the reset is confirmed by typing a word instead. Until 14 Sep
   * 2026 it was refused outright, which is why the reset
   * button did nothing.
   */
  enterWordToConfirm: (word: string) => string;
  /** The word to type. Lower case; the comparison ignores case and spaces. */
  resetConfirmWord: string;
  /** Said when what was typed is not that word. */
  resetWordWrong: string;
  /** The button that runs the reset once the word matches. */
  resetConfirmBtn: string;
  pinDigitAria: (n: number) => string;
  wrongPin: string;
  pinLockedFor: (seconds: number) => string;
  /** No PIN set: the button that opens the popup where one is set (D2-32). */
  /** Reset outcome unknown: the button that reloads the record (D2-8). */
  resetReloadBtn: string;
  /** The store declined to reset: nothing was cleared and the record is intact. */
  resetRefused: string;
  resetFailed: string;
  resetUnknown: string;
  resetPartial: string;
  // Cleanup-part display names for the partial-reset parenthetical (DASH-4):
  // `incompleteResetParts()` returns stable flag keys, not text, so these
  // localize the names at the render site instead of a hardcoded-English map.
  resetPartScanLog: string;
  resetPartAuthorProfiles: string;
  resetPartVerdicts: string;
  resetPartDiagnostics: string;
  resetPartUsageCounters: string;
  resetPartParentFeedback: string;
  resetPartChainAnchors: string;
  resetting: string;
  resetLead1: string;
  resetLead2: string;
  resetLead3: string;
  resetMoreTitle: string;
  resetTitle: string;
  resetBody1: string;
  resetBodyBold1: string;
  resetBody2: string;
  resetBodyBold2: string;
  resetBody3: string;

  // ── Components slice (2b) ──
  // Display-layer lookups over STABLE internal keys (color-maps.ts).
  // `techniqueLabel` takes the technique id; `blockedCategoryLabel` takes the
  // English category label that `categorizeBlockedRecord` emits (it doubles
  // as the filter key + color key, so only the rendered text is localized).
  techniqueLabel: (id: string) => string;
  blockedCategoryLabel: (key: string) => string;

  // DashHeader (hdr*)
  hdrWordmarkSub: string;
  hdrRecordMgmtAria: string;
  hdrVerify: string;
  hdrVerifying: string;
  hdrVerifyTip: string;
  hdrResetTip: string;
  hdrHelpAria: string;
  hdrHelpDialogAria: string;
  hdrHelpVerifyTitle: string;
  hdrHelpVerifyBody: string;
  hdrHelpResetTitle: string;
  hdrHelpResetBody: string;
  hdrPillOk: string;
  hdrPillPartial: string;
  hdrPillChecking: string;
  hdrPillErr: string;
  hdrThemeName: Record<ThemeChoice, string>;
  hdrThemeTip: (theme: string, next: string) => string;
  hdrThemeAria: (theme: string, next: string) => string;
  hdrLastRecord: string;
  /** A value that has not come yet (the last record at 0 records, the peak at 0). */
  noneYet: string;
  hdrRecordsLabel: string;
  hdrRecordsTitle: string;
  /** The header's entry count opened: what the entries are, counted by src/ui/dashboard/record-sets.ts. */
  hdrBreakdownTitle: (total: string) => string;
  hdrBreakdownLoaded: (start: string, end: string) => string;
  hdrBreakdownOlder: (n: number, asOf: string) => string;
  hdrBreakdownUnread: (n: number) => string;
  /** The older months once each is counted by the module's rules (month-sets.ts), followed by their sets. */
  hdrBreakdownOlderSorted: (n: number, asOf: string) => string;
  /** The line on screen while the older months are counted in the background. */
  hdrCountingOlderMonths: (done: number, total: number) => string;
  /** A count with its set's noun ("16,210 checked items"). */
  setCount: (set: RecordSetName, n: number) => string;
  hdrToastVerifiedLead: string;
  hdrToastVerifiedBody: (n: number) => string;
  hdrToastPartialLead: string;
  hdrToastPartialBody: (n: number) => string;
  hdrToastIssueLead: (n: number | string) => string;
  hdrToastIssueBody: string;
  hdrDismissAria: string;

  // ChainBanner (chain*)
  chainTitleOk: string;
  /** A tab's body threw while rendering: the panel is replaced, the rest stays. */
  tabCrashTitle: string;
  tabCrashBody: string;
  tabCrashRetry: string;
  tabCrashDetail: (message: string) => string;
  chainTitleNothingYet: string;
  chainDescNothingYet: string;
  /** Green, but archived months exist and have not been checked. */
  chainTitleOkCurrentOnly: string;
  /** The store could not be read at all. Never the same as an empty chain. */
  chainTitleUnreadable: string;
  chainDescUnreadable: string;
  /** Some rows did not decode; the rest did. Never the same as an empty record. */
  chainTitleSomeUnreadable: string;
  chainDescSomeUnreadable: (unreadable: number, readable: number) => string;
  chainArchivesUnchecked: (months: number) => string;
  chainTitlePartial: string;
  chainTitleChecking: string;
  chainTitleEntryFailed: (n: number) => string;
  chainTitleBroken: string;
  chainDescOk: (entries: number, anchorISO: string | null) => string;
  /** Opens the checker's own notes about lines the record did not keep; the notes follow it. */
  chainLinesLead: string;
  chainDescPartial: (unverified: number) => string;
  chainUnsignedTail: (n: number) => string;
  chainDescChecking: string;
  chainDescBrokenFallback: string;
  chainRestoreHint: string;
  chainStatRecords: string;
  chainStatAnchor: string;
  chainStatAnchorTip: string;
  chainStatOnDisk: string;
  chainStatOnDiskTip: string;

  // ChainLossBanner (lossBanner*). Reads back what chain-height-witness.ts
  // stated on the chain the person is looking at BECAUSE it looks empty: the
  // marker lives on the one chain they have no reason to trust, so this is the
  // only surface that can put the fact in front of them. `heldArchivedRecords`
  // is null when the archived months were known to exist but their record
  // count was never taken; that case gets its own sentence rather than a "0".
  lossBannerHeading: string;
  lossBannerDate: (dateStr: string) => string;
  lossBannerHeldChain: (positions: number) => string;
  lossBannerHeldArchivesCounted: (months: number, records: number) => string;
  lossBannerHeldArchivesUncounted: (months: number) => string;
  lossBannerNoRecovery: string;
  lossBannerBackupOnly: string;
  /** The one limit this banner states: the chain it sits on started clean after the loss. */
  lossBannerNewChainStarted: string;
  lossBannerOpenBackup: string;

  // FeedCard (feed*)
  /** The handle line when the recorder refused a name it could see (AuthorCapture 'withheld'). */
  feedAuthorWithheld: string;
  /** The tooltip that says why. */
  feedAuthorWithheldWhy: string;
  feedUnknownAuthor: string;
  /** Beside a handle the record has seen often. Was a CSS content: string until 2026-09-19. */
  feedRecidivistFrequent: string;
  /** On a card the reader themselves marked as wrong. Was a CSS content: string until 2026-09-19. */
  feedYouDisputedThis: string;
  feedReelThreadHeader: string;
  feedActionLabels: Record<FeedActionKey, string>;
  /** Mono kind badge per record kind (post / comment / reply / video / AI-summary). */
  feedKindLabels: Record<string, string>;
  feedCommentedUnder: (author: string) => string;
  feedPostText: string;
  // Structured media-signal labels (post > video > audio).
  feedVideoDescription: string;
  feedVideoOnScreen: string;
  feedVideoScene: string;
  feedVideoSpoken: string;
  feedVideoNoAudio: string;
  feedOriginalVerbatim: string;
  feedProtectionsAtCapture: string;
  /** The one switch a record can carry that the popup does not name. */
  featCommentsPerVideo: string;
  feedSettingsReadFailedNote: string;
  feedMarkerReset: string;
  feedMarkerRotation: string;
  feedMarkerPrune: string;
  /** The label on a gap marker's own line: the recorder was off. */
  feedMarkerGap: string;
  /** A gap marker in the reader's words; times are already in the reader's clock. */
  feedGapSentence: (g: GapSentenceParts) => string;
  feedGapCopied: string;
  /**
   * The everyday name of a housekeeping record kind, without its number, in
   * the form that goes with `n` ("record heartbeat" / "record heartbeats").
   * The Activity list counts a folded run with it.
   */
  feedMarkerKindWord: (kind: string, n: number) => string;
  /** When a folded run happened. `to` is null when the run is one instant. */
  feedMarkerRunSpan: (from: string, to: string | null) => string;
  /** What a folded run is, on hover. */
  feedMarkerRunTip: string;
  feedEnvSummary: string;
  feedEnvHandle: string;
  feedVideoNoCaption: string;
  // Record-detail drawer (media signals + chain provenance, off the card face).
  feedForensicDetail: string;
  feedForensicDetailTip: string;
  feedMediaStatus: Record<FeedMediaStatusKey, string>;
  feedMediaStatusTip: Record<FeedMediaStatusKey, string>;
  feedFactContentType: string;
  feedFactFrames: string;
  feedFactAudioModel: string;
  feedFactSeverity: string;
  feedFactRecordedAt: string;
  feedFactChainPosition: string;
  feedFactHash: string;
  // Comment-section "room" combined reading, folded into the record drawer.
  feedRoomTitle: string;
  feedRoomReactions: (neg: number, neu: number, pos: number) => string;
  feedRoomReactionsLabel: string;
  feedRoomSampledLabel: string;
  feedRoomDominantLabel: string;
  // Structured room analysis (BETA) — the separate room sensor's fields.
  feedRoomClaimLabel: string;
  feedRoomClaim: (v: 'corroborates' | 'contradicts' | 'ignores' | 'no-claim') => string;
  feedRoomManipulationLabel: string;
  feedRoomManipulation: (v: 'none' | 'bandwagon' | 'pile-on' | 'astroturf') => string;
  feedRoomDistressLabel: string;
  feedRoomDistressYes: string;
  // "Update Metrics" — re-open the original, refresh engagement counts + re-check.
  feedRecheck: string;
  feedRechecking: string;
  feedRecheckedNow: string;
  feedRecheckFailed: string;
  feedRecheckTip: string;
  feedCommentsTip: string;
  feedCommentStatus: Record<FeedCommentStatusKey, string>;
  feedCommentStatusTip: Record<FeedCommentStatusKey, string>;
  /** Under an item's text: what the page carried against what the screen showed (ForensicRecord.textCapture). */
  feedTextCapture: { cut: (n: number) => string; folded: string };
  /**
   * Under an item that carried no words of its own: the verdict on this card
   * was read from the comments under it, not from the item
   * (ForensicRecord.verdictOrigin === 'room'). PLAN-2026-09-14 decision 3.
   */
  feedRoomVerdict: string;
  /** Under a reading the person asked for with the Read this for me button: not a serving, not counted. */
  feedReadingAsked: string;
  /** The decision block's lines on a card (docs/design/DECISION-BLOCK-2026-09-07.md section 4). */
  feedWhy: string;
  feedReader: string;
  /** The word for the record's reader value 'default': nobody was declared at the keyboard. Same words as the export's. */
  feedReaderDefault: string;
  /** Between the action the table chose and the one the page showed, when they differ. */
  feedDecisionShownAs: string;
  feedDecisionAction: Record<DecisionAction, string>;
  feedSerialTip: string;
  feedRecordedReplies: (n: number) => string;
  feedBetaTip: string;
  feedHiddenLabel: string;
  feedOpenUrlTip: (url: string) => string;
  feedNoUrlTip: string;
  feedViewOriginal: string;
  feedConfirm: string;
  feedConfirmed: string;
  feedConfirmTip: string;
  feedDispute: string;
  feedDisputed: string;
  feedDisputeTip: string;

  // PostGroupCard (grp*)
  grpCommentsWord: (n: number) => string;
  grpOrphanTag: string;
  grpViewOriginal: string;
  grpOrphanFootnote: string;

  // ─── Social-feed redesign (feed*) ───
  // Trust-arithmetic inventory bar nouns (RO carries plural agreement).
  feedTrustComments: (n: number) => string;
  feedTrustAiSummaries: (n: number) => string;
  feedTrustCheckedTimes: (n: number) => string;
  feedTrustChainBroken: string;
  // Reveal toggles + verbatim/rewrite framing. The "shown as" header is
  // mode-aware: a record captured in adult mode says "Shown to you as", never
  // "to the child" — the wording must match who the record was actually for.
  feedShownAs: (mode: RecordedMode) => string;
  /** The head of the shown block when the page showed the swearing starred, not a rewrite. */
  feedMaskedLabel: string;
  feedRevealVerbatim: string;
  feedAiReadingToggle: string;
  feedAiInterpretationNote: string;
  feedAiSampled: (sampled: number, visible: number) => string;
  /** The same when the platform's own comment count could not be read: the number that was read, and no denominator. */
  feedAiSampledRead: (sampled: number) => string;
  // Harm-floor chip on hidden records.
  feedHarmFloorLabel: (score: number, category: string) => string;
  feedHarmFloorNote: string;
  /** The note on a hidden card whose hide was not the table's choice with nothing tried first: a video skipped by the Child setting, a hide after a rewrite did not land. It gives no reason; the why line above it does. */
  feedHiddenKeptNote: string;
  // Serve-order + session-gap dividers.
  // Hover tooltip on the left-rail timeline dot, explaining what its colour means.
  feedNodeTip: (sev: 'hi' | 'mi' | 'lo' | 'pass') => string;
  feedSessionGap: (minutes: number) => string;
  /**
   * `seconds` is null when the two groups are not consecutive in serve order,
   * in which case the label states the switch and NO duration. The previous
   * signature could not express that, so a broken calculation was clamped to
   * zero and printed as `+0s` — a measured-looking value that was never
   * measured.
   */
  feedPlatformSwitch: (from: string, to: string, seconds: number | null) => string;
  feedLikesObscured: string;
  // Per-metric noun (secondary counters + growth readout) + the "Update Metrics"
  // growth line ("+1.3K likes · +400 views since 2026-06-10").
  feedMetricWord: (key: MetricWord, count: number) => string;
  feedGrowthSince: (date: string) => string;
  feedGrowthTip: (sightings: number) => string;
  // Source-of-content pill map (sourceCategory).
  // Source label — WHO posted it (slice 2). Card chip + "Who posted it" filter row.
  sourceChipLabels: Record<'person' | 'group' | 'page' | 'advertiser', string>;
  accountFilterLabel: string;
  accountFilterChips: Record<'all' | 'person' | 'group' | 'page' | 'advertiser', string>;
  // "How groups behave" aggregate panel.
  grpBehaveTitle: string;
  grpBehaveIntro: string;
  grpColGroup: string;
  grpColPostsSeen: string;
  grpColFlagged: string;
  grpColAvgSeverity: string;
  grpColMostCommon: string;
  // First-run welcome.
  feedWelcomeTitle: string;
  // Unwired placeholders (no schema yet) — never fabricated data.
  feedAvatarPlaceholder: string;

  // ─── Forensics ledger columns (fx*) ───
  fxColPlatform: string;
  fxLedgerMore: (range: string, n: number) => string;

  // ─── Drill-down filter bar (drill*) ───
  drillActiveLabel: string;
  drillCount: (n: number) => string;

  // StatisticsTab (stats*)
  statsBalanceTitle: string;
  statsBalanceSub: string;
  statsBalanceLine: (passedPct: number, passed: number, decided: number) => string;
  statsBalancePassed: string;
  statsBalanceFlagged: string;
  statsBalanceBlocked: string;
  statsBalanceEmpty: string;
  statsManipTitle: string;
  statsManipSub: string;
  statsPushTitle: string;
  statsPushSub: string;
  statsNoAmpData: string;
  statsAmpHigh: string;
  statsAmpNormal: string;
  statsAmpLow: string;
  statsTopPushed: string;
  statsViewsPerLike: (ratio: string, sightings: number) => string;
  statsFeedPatternsTitle: string;
  statsFeedPatternsSub: string;
  statsMostServed: string;
  statsLongestStreak: string;
  statsStreakValue: (len: number, kindLabel: string) => string;
  statsHighSeverity: string;
  statsNone: string;
  statsRhythm: string;
  statsRhythmNotEnough: (days: number) => string;
  statsRhythmWeekly: string;
  statsRhythmDaily: string;
  statsRhythmNDay: (n: number) => string;
  statsRhythmNone: string;
  statsAllTime: (total: string) => string;
  statsOfRecordsSeen: (n: number, start: string, end: string) => string;
  statsBlockedSub: (start: string, end: string) => string;
  statsByPlatformTitle: string;
  statsByPlatformSub: (n: number) => string;
  statsTechniquesObserved: string;
  /** The techniques tile counts names over the flagged entries of all months (the store's rule). */
  statsTechniquesSub: string;
  statsUnsigned: string;
  statsUnsignedSub: string;

  // SafetyCategoriesPanel (safety*)
  safetyTitle: string;
  safetyHint: string;
  safetyEmpty: string;
  safetyBucketLabel: Record<SafetyBucket, string>;
  safetyBucketDesc: Record<SafetyBucket, string>;
  safetyClearFilterTip: (label: string) => string;
  safetyShowOnlyTip: (label: string) => string;
  safetyClearFilter: (label: string) => string;
  safetyFilterTo: (label: string) => string;
  safetyNoPhrases: string;
  safetyPhraseTip: (count: number, phrase: string) => string;

  // RecidivistAuthorsPanel (recid*)
  recidTitle: string;
  recidHint: (threshold: number) => string;
  recidEmpty: string;
  recidFilterTip: (author: string) => string;
  recidTrendRising: string;
  recidTrendEasing: string;
  recidEscalating: string;
  recidEscalatingTip: (flagged: number, seen: number) => string;
  /** The account ledger's facts, the word after each number (the panel prints the number itself, so it can be
   *  bold and a zero can be dimmed): every content record by the account, split by verdict and surface. */
  recidFactWords: {
    recorded: (n: number) => string;
    passed: (n: number) => string;
    forYou: (n: number) => string;
    sought: (n: number) => string;
    days: (n: number) => string;
    bursts: (n: number) => string;
  };
  recidLedgerTip: string;
  statsUndatedNote: (n: number) => string;

  // ExposureView (expo*)
  expoLoading: string;
  expoEmpty: string;
  /** The same view when the record holds items, just none inside the window the reader picked. */
  expoEmptyWindow: (newestDay: string) => string;
  expoThisWeek: string;
  expoThisWeekSub: string;
  expoItemsWitnessed: string;
  expoDeltaNothing: string;
  expoDeltaSame: (baseline: number) => string;
  expoDeltaMore: (n: number, baseline: number) => string;
  expoDeltaFewer: (n: number, baseline: number) => string;
  expoActionLabels: Record<ExpoActionKey, string>;
  expoWhatFwDid: string;
  expoWhatFwDidSub: string;
  expoWhatPushed: string;
  expoWhatPushedSub: string;
  expoShownUnchanged: string;
  expoNoFlagged: string;
  expoAdsShare: (ads: number, total: number) => string;
  expoRepeatedTitle: string;
  expoRepeatedSub: string;
  expoNoRepeats: string;
  expoSeenTimes: (n: number) => string;
  expoLateTitle: string;
  expoLateSub: string;
  expoLateLabel: string;
  expoOfTotal: (total: number) => string;
  /**
   * The Exposure tab's platform split counts EVERY record in the window, not the
   * flagged ones, so it cannot borrow statsPlatTechTitle ("what FeelingWise
   * flagged per platform") the way it did until 2026-09-08. On a real week that
   * read "flagged 3,406 on twitter.com" over bars that summed to the whole
   * witnessed total while the header said 651 flagged.
   */
  expoPlatformsTitle: string;
  expoNoPlatforms: string;

  // StatisticsTab depth additions (statsDaily* / statsSev*)
  statsDailyTitle: string;
  statsDailySub: string;
  statsDailyFlaggedOf: (flagged: number, total: number) => string;
  statsSevDistTitle: string;
  statsSevDistSub: string;
  statsSevLo: string;
  statsSevMi: string;
  statsSevHi: string;
  statsPlatTechTitle: string;
  statsPlatTechSub: string;
  statsDrillHint: string;

  // PatternsTab (pat*) — observed-pattern-only vocabulary, never platform
  // intent. Every count names its denominator + date range.
  tabPatterns: string;
  patIntro: (n: number, start: string, end: string) => string;
  patHonesty: string;
  patComputing: string;
  patEmpty: string;
  patComputeFailed: string;
  patThemesTitle: string;
  patThemesSub: string;
  patItems: (n: number) => string;
  patDays: (n: number) => string;
  patFlaggedShare: (flagged: number, total: number) => string;
  patGroupedBy: string;
  patShowRecords: string;
  patHideRecords: string;
  patOpenPost: string;
  patCrossDayTitle: string;
  patCrossDaySub: string;
  patCrossDayLine: (days: number, count: number) => string;
  patCrossDayEmpty: string;
  patReserveTitle: string;
  patReserveSub: string;
  patReserveLine: (serves: number, days: number) => string;
  patReserveEmpty: string;
  /** Near-duplicate re-serves (capability audit 2026-09-06, P1 item 7). */
  patTemplateTitle: string;
  patTemplateSub: string;
  patTemplateLine: (serves: number, days: number, variants: number) => string;
  patTemplateEmpty: string;
  patLexTitle: string;
  patLexSub: string;
  patLexEmpty: string;
  patLexCount: (occurrences: number, items: number) => string;
  patLexTierSlur: string;
  patLexTierProfanity: string;
  patCompTitle: string;
  patCompSub: string;
  patCompCoverage: (labeled: number, eligible: number, rooms: number, days: number, end: string) => string;
  patCompNotYet: string;
  patCompTopicsHead: string;
  patCompFormatsHead: string;
  patCompEmpty: string;
  patCompCount: (items: number) => string;
  patCompUnclassified: string;
  patCompRoomsHead: string;
  patCompRoomsCoverage: (rooms: number) => string;
  patCompRoomLabel: (key: string) => string;
  patCompOtherIsRoom: (n: number) => string;
  patToneTitle: string;
  patToneSub: string;
  patToneCoverage: (rooms: number, comments: number) => string;
  patToneEmpty: string;
  patTonePositive: string;
  patToneNeutral: string;
  patToneNegative: string;
  /** Platform switches (capability audit 2026-09-06, P1 item 6). */
  patSwitchTitle: string;
  patSwitchSub: string;
  patSwitchEmpty: string;
  patSwitchCount: (switches: number, content: number) => string;
  patSwitchPair: (from: string, to: string, count: number) => string;
  patSwitchWindow: (n: number) => string;
  patSwitchBaseline: string;
  patSwitchShare: (k: number, n: number, pct: number, lo: number, hi: number) => string;
  patSwitchNote: string;
  patPressureTitle: string;
  patPressureSub: string;
  patPressureEmpty: string;
  patPressureExposureCount: (n: number) => string;
  patPressureEscLabel: string;
  patPressureEscalation: (label: string, delta: string, count: number) => string;
  patPressureNoEscalation: string;
  patPressureEntropyLabel: string;
  patPressureEntropy: (drop: string, window: number) => string;
  patPressureEntropyPending: (window: number) => string;
  patPressureGapLabel: string;
  patPressureGap: (label: string, hours: number) => string;
  patPressureNoGap: string;
  patPressureSwitchLabel: string;
  patPressureSwitch: (percent: number, switches: number, transitions: number) => string;

  // OperationalEventsPanel (ops*)
  opsLoading: string;
  opsLoadFailed: (err: string) => string;
  opsTitle: string;
  opsIntro: string;
  /** Build provenance line at the top of the Issues tab. */
  opsBuildLine: (buildId: string, version: string) => string;
  opsBuildSince: (when: string) => string;
  opsBuildStraddleWarning: string;
  opsBuildUnknown: string;
  opsYourAccount: string;
  opsCapExhausted: (n: number) => string;
  opsCapBreakdown: (daily: number, monthly: number, tierFree: number) => string;
  opsSystemSide: string;
  opsLlmFailures: (n: number) => string;
  opsBatchTruncated: (n: number) => string;
  opsScanPurged: (n: number) => string;
  opsAiHealthTitle: string;
  opsAiHealthSub: string;
  opsLoadingShort: string;
  opsAiOff: string;
  /** The same line at Strict, where a key turns nothing on. */
  opsAiOffStrict: string;
  opsAiOffStrictKey: string;
  opsTierMismatch1: string;
  opsTierMismatch2: (n: number) => string;
  opsLicenseActive1: string;
  opsLicenseActive2: string;
  /** A retried call is one call here, counted by how it finally ended; `tries` counts every attempt. */
  opsGroqCalls: (calls: number, ok: number, failed: number, retried: number, tries: number, p50: number, p95: number) => string;
  /** Wraps the per-status list, which counts every try rather than every call. */
  opsGroqStatusLine: (breakdown: string) => string;
  opsGroqTokens: (tin: string, tout: string) => string;
  opsGroqTruncated: (n: number) => string;
  opsGroqHeadroom: (n: string) => string;
  opsGroqRetryAfter: (ms: number) => string;
  opsNoAiCalls: string;
  opsExtractionTitle: string;
  opsExtractionSub: string;
  opsIdentityTitle: string;
  opsIdentitySub: string;
  opsIdentityNoRecords: string;
  opsIdentityAllGood: (records: number) => string;
  opsIdentityOverall: (anon: number, total: number, pct: number) => string;
  opsIdentityRow: (anon: number, total: number, pct: number) => string;
  opsIdentityInsufficient: (records: number) => string;
  opsCardIdentityTitle: (platform: string, pct: number) => string;
  opsCardIdentityMeaning: string;
  opsCardIdentityAction: string;
  sortGroupLabel: string;
  sortAsSeen: string;
  sortAsSeenTip: string;
  sortWorst: string;
  sortWorstTip: string;
  opsIssuesClear: (n: number) => string;
  opsIssuesClearedNote: (n: number) => string;
  opsIssuesShowCleared: string;
  opsIssuesHideCleared: string;
  opsIssueChipNow: string;
  opsIssueChipToday: string;
  /** Chip for count cards whose count comes from the rolling 24h hour buckets
   *  (cap, LLM failures), which is not "today": on 2026-09-02 at 20:17 the
   *  LLM card read "counted today · first seen 23:15 · last seen 03:15". */
  opsIssueChip24h: string;
  opsIssueChipCleared: string;
  opsIssueSeenRange: (first: string, last: string) => string;
  opsIssueSeenAt: (time: string) => string;
  opsStatusAllClearedMeaning: string;
  opsDriftOk: string;
  opsDriftDrifting: string;
  opsDriftBroken: string;
  opsDriftNotMonitored: string;
  // Distinct from the line above: that one means "instrumented, nothing seen
  // today", this one means "FeelingWise has no watch on this surface at all".
  // Rendering the second as the first told the user a surface was quiet when
  // FeelingWise simply was not looking (RECON F3a, 2026-08-18).
  opsDriftNotInstrumented: string;
  // Zero selector-health counters, but the extraction-canary confirms the
  // platform IS extracting today. Distinct from opsDriftOk on purpose: that
  // one is earned by real selector counters showing no drift, this one is a
  // different, weaker instrument (a positive heartbeat, not a per-selector
  // measurement) and must never render with the same color or word as a
  // counter-backed "OK" (2026-08-24).
  opsDriftCanaryConfirmed: string;
  opsMissPct: (p: number) => string;
  opsFallbackPct: (p: number) => string;
  opsNoExtraction: string;
  opsSelectorsOk: (sites: number) => string;
  opsDriftSummary: (sites: number, misses: number) => string;
  opsMemoryTitle: string;
  opsCopyDiagnostics: string;
  opsCopied: string;
  opsMemorySub: string;
  opsNoMemSamples: string;
  opsMemoryLine: (now: number, peak: number, first: number) => string;
  opsMemClimbing: (delta: number) => string;
  opsMemStable: string;
  opsMemTooFewSamples: (count: number, needed: number) => string;
  opsMemSamples: (count: number, host: string) => string;
  opsThisSite: string;
  opsPeakSuffix: string;
  opsScanTitle: string;
  opsScanSub: string;
  opsNoScans: string;
  opsScannedWord: string;
  opsActedWord: (pct: number) => string;
  opsLeftAsIs: (n: string) => string;
  opsDidntFinish: (n: string) => string;
  opsBusiest: (hh: string) => string;
  opsPlatformScanRow: (scanned: string, acted: string, pct: number) => string;
  opsPerfTitle: string;
  opsPerfSub: string;
  opsPerfNoSamples1: string;
  opsPerfNoSamples2: string;
  // 2026-08-24: the panel used to say opsPerfNoSamples1/2 (the flag is off,
  // turn it on) unconditionally, even when the flag was actually ON and every
  // write was failing. These are the two states that copy could not tell
  // apart. opsPerfOnNoData fires when the flag is confirmed on but nothing
  // has landed yet (no failures observed either); opsPerfOnWritesFailing
  // fires when the flag is on AND persists are actually failing, citing the
  // real count instead of inventing a cause.
  opsPerfOnNoData: string;
  opsPerfOnWritesFailing: (failures: number, lastError: string) => string;
  opsPerfSamples: (n: number, platforms: string | null) => string;
  opsStageHelp: Record<string, string>;
  opsPctOk: (pct: string) => string;
  opsPctCached: (pct: string) => string;
  opsChainTitle: string;
  opsChainSub: string;
  opsChainEmpty: string;
  opsChainVerified: string;
  opsChainPartial: string;
  opsChainProblem: (kind: string) => string;
  opsChainCount: (n: number) => string;
  opsCountVerified: (n: string) => string;
  opsCountUnsigned: (n: string) => string;
  opsCountPreRekey: (n: string) => string;
  opsCountPriorKey: (n: string) => string;
  opsCountPreChain: (n: string) => string;
  opsCountBroken: (n: string) => string;
  opsChainVerifiedLine: string;
  opsUncheckedAfterBreak: (n: number) => string;
  opsHealTitle: string;
  opsHealSub: string;
  opsHealHealed: (when: string) => string;
  opsHealFailed: (when: string, reason: string) => string;
  opsHourlyTitle: string;
  opsHourlySub: string;
  opsLegendCapTitle: string;
  opsLegendCapBody: string;
  opsLegendLlmTitle: string;
  opsLegendLlmBody: string;
  opsLegendTruncTitle: string;
  opsLegendTruncBody: string;
  opsLegendPurgedTitle: string;
  opsLegendPurgedBody: string;
  opsAllQuiet: string;
  opsColHour: string;
  // Plain-language status cards (Issues tab triage): each card answers what
  // happened, what it means for the child's protection, and what to do.
  opsStatusAllGoodTitle: string;
  opsStatusAllGoodMeaning: string;
  opsWhatItMeansLabel: string;
  opsWhatToDoLabel: string;
  opsNoActionNeeded: string;
  /** Shown instead of opsNoActionNeeded when a failure kind cannot clear itself. */
  opsCardLlmAuthAction: (n: number) => string;
  /** Selectors seen too few times today to be worth a verdict. */
  opsSelectorUnrated: (sites: number) => string;
  opsCardTierMismatchTitle: (n: number) => string;
  opsCardTierMismatchMeaning: string;
  opsCardTierMismatchAction: string;
  opsCardCapTitle: (n: number) => string;
  opsCardCapMeaning: string;
  opsCardCapAction: string;
  opsCardChainTitle: string;
  opsCardChainMeaning: string;
  opsCardDeliveryPendingTitle: (n: number) => string;
  opsCardDeliveryPendingMeaning: string;
  opsCardDeliveryPendingAction: string;
  opsCardDeliveryQuarantinedTitle: (n: number) => string;
  opsCardDeliveryQuarantinedMeaning: string;
  opsCardDeliveryQuarantinedAction: string;
  opsCardDeliveryDiscardedTitle: (n: number) => string;
  opsCardDeliveryDiscardedMeaning: string;
  opsCardDeliveryDiscardedAction: string;
  opsCardDeliveryReadFailedTitle: string;
  opsCardDeliveryReadFailedMeaning: string;
  opsCardDeliveryReadFailedAction: string;
  opsCardCoverCheckingTitle: (n: number) => string;
  opsCardCoverCheckingMeaning: (post: number) => string;
  opsCardCoverSlowTitle: string;
  opsCardCoverSlowMeaning: (seconds: number) => string;
  opsCardCoverSlowAction: string;
  opsCardCoverBrokenTitle: string;
  opsCardCoverBrokenMeaning: string;
  opsCardCoverBrokenAction: string;
  /** `empty` of `n` were calls that completed and returned nothing usable. */
  opsCardPlatformBrokenTitle: (platform: string) => string;
  opsCardPlatformBrokenMeaning: (platform: string) => string;
  opsCardPlatformBrokenAction: string;
  opsCardPlatformDriftTitle: (platform: string) => string;
  opsCardPlatformDriftMeaning: string;
  opsCardLlmTitle: (n: number) => string;
  opsCardLlmMeaning: string;
  opsCardTruncatedTitle: (n: number) => string;
  opsCardTruncatedMeaning: string;
  opsCardPurgedTitle: (n: number) => string;
  opsCardPurgedMeaning: string;
  opsCardTextCapTitle: (period: 'daily' | 'monthly') => string;
  opsCardTextCapMeaning: (period: 'daily' | 'monthly') => string;
  opsCardTextCapAction: (period: 'daily' | 'monthly') => string;
  opsTechDetails: string;

  // Overview tab (the landing surface; every number names its denominator)
  tabOverview: string;
  ovEmpty: string;
  ovBriefSigned: string;
  ovHeroVideos: (n: number) => string;
  ovKpiDelta: (pct: number) => string;
  ovKpiNoPrior: (days: number) => string;
  ovBalanceEyebrow: string;
  ovBalanceHeadline: (pct: number) => string;
  ovBalanceSplit: (flagged: number, visible: number, hidden: number) => string;
  ovBalanceDayTip: (day: string, pct: number, decided: number) => string;
  ovBalanceDayEmpty: (day: string) => string;
  ovBalanceFootnote: (decided: number) => string;
  ovBalanceToStats: string;
  ovAttentionEyebrow: string;
  ovAttentionSub: string;
  ovAttentionEmpty: string;
  ovAttentionFlagged: string;
  ovAttentionSeverity: (s: number) => string;
  ovAttentionHidden: string;
  ovAttentionFootnote: string;
  ovUnknownAuthor: string;
  ovViewRecord: string;
  ovSessionsEyebrow: string;
  ovSessionsSub: (dateNice: string) => string;
  ovSessionTip: (from: string, to: string, items: number, flagged: number) => string;
  ovSessionsFootnote: (sessions: number, items: number) => string;
  ovSurfaceEyebrow: string;
  ovSurfaceSub: string;
  ovSurfaceLabel: (key: string) => string;
  ovSurfaceFlagRate: (pct: number) => string;
  /** 95% Wilson interval printed beside every share; the n is always in the same line or row. */
  shareInterval: (lo: number, hi: number) => string;
  ovSurfaceFootnote: (total: number) => string;
  ovSourcesEyebrow: string;
  ovSourcesSub: (total: number) => string;
  ovSourceType: (type: 'advertiser' | 'group') => string;
  ovSourceSeen: (n: number) => string;
  ovSourceFlagged: (n: number) => string;
  ovSourcesFootnote: string;
  ovRhythmEyebrow: string;
  ovRhythmSub: string;
  ovRhythmTip: (day: string, hour: number, n: number) => string;
  ovRhythmFootnote: string;

  // Feed behavior (the Patterns deep half; contract docs/design/READER_LENSES.md).
  // Caption functions take the active reader lens as their first argument; the
  // numbers themselves never change with the lens, only the "what this means"
  // line does. Every caption keeps behavior verbs about the feed (served,
  // repeated, returned), never intent verbs.
  fbLegendFact: string;
  fbLegendInterp: string;
  fbLensLabel: (lens: FeedBehaviorLens) => string;
  fbLensNote: string;
  fbProv: (set: RecordSetName, n: number, start: string, end: string) => string;
  fbProvRange: (start: string, end: string) => string;
  fbRunsTitle: string;
  fbRunsSub: string;
  fbRunsLead: string;
  fbRunsCount: (n: number) => string;
  fbRunsEnding: (hm: string) => string;
  fbRunsNone: string;
  fbRunsNote: (basePct: number) => string;
  fbRunsCap: (lens: FeedBehaviorLens, len: number, basePct: number) => string;
  fbSkewTitle: string;
  fbSkewSub: (big: number, total: number) => string;
  fbSkewOpen: string;
  fbSkewClose: string;
  fbSkewNum: (pct: number, f: number, n: number) => string;
  fbSkewNone: string;
  fbSkewCap: (lens: FeedBehaviorLens, openPct: number, closePct: number) => string;
  fbReturnTitle: string;
  fbReturnSub: string;
  fbReturnStatN: (f: number, n: number) => string;
  fbReturnStatTail: (pct: number) => string;
  fbReturnNote: (basePct: number, n: number) => string;
  fbReturnNone: string;
  fbReturnCap: (lens: FeedBehaviorLens, pct: number, basePct: number, n: number) => string;
  fbAmpTitle: string;
  fbAmpSub: string;
  fbAmpSeg: (k: 'high' | 'normal' | 'low' | 'unknown') => string;
  fbAmpAdvN: (f: number, n: number) => string;
  fbAmpAdvTail: string;
  fbAmpAdvNote: string;
  fbAmpNone: string;
  fbAmpProvCounts: (rooms: number, adv: number) => string;
  fbAmpCap: (lens: FeedBehaviorLens, highPct: number, rooms: number, advPct: number) => string;
  fbChainsTitle: string;
  fbChainsSub: string;
  fbChainThen: string;
  fbChainRepeats: string;
  fbChainTimes: (n: number) => string;
  fbChainHandoff: string;
  fbChainSustained: string;
  fbChainsNone: string;
  fbChainsUnnamed: (unnamed: number, total: number) => string;
  fbChainsProvPairs: (n: number) => string;
  fbChainsCap: (lens: FeedBehaviorLens) => string;
  fbVoicesTitle: string;
  fbVoicesSub: string;
  fbVoicesColAccount: string;
  fbVoicesColDays: string;
  fbVoicesColSeen: string;
  fbVoicesFlaggedShort: (n: number) => string;
  fbVoicesNone: string;
  fbVoicesProv: (shown: number, total: number) => string;
  fbVoicesCap: (lens: FeedBehaviorLens) => string;
  fbReserveCap: (lens: FeedBehaviorLens) => string;
  fbCautionTitle: string;
  fbCautionTag: string;
  fbCautionSub: string;
  fbCautionNone: string;
  fbCautionRun: string;
  fbCautionRunEv: (len: number, hm: string) => string;
  fbCautionReturn: string;
  fbCautionReturnEv: (f: number, n: number, pct: number, basePct: number) => string;
  fbCautionAmp: string;
  fbCautionAmpEv: (high: number, total: number, pct: number) => string;
  fbCautionChain: string;
  /** a/b arrive pre-localized through techniqueLabel. */
  fbCautionChainEv: (a: string, b: string, n: number) => string;
  fbPredTag: string;
  fbPredLead: string;
  fbPredClauseRun: string;
  fbPredClauseReturn: string;
  fbPredJoin: string;
  fbPredTail: string;
  fbCautionCap: (lens: FeedBehaviorLens) => string;

  // Statistics limits box (judge lens: limits stated before conclusions).
  statsLimitsTitle: string;
  statsLimit1: string;
  statsLimit2: string;
  statsLimit3: string;
  statsLimit4: string;
  /** Record tab — judge-lens limits box (limits stated before conclusions). */
  recordLimitsTitle: string;
  recordLimit1: string;
  recordLimit2: string;
  recordLimit3: string;
  recordLimit4: string;

  // Activity tab — filter rail (redesign 2026-08-01, mockup B)
  railHead: string;
  railHintButton: string;
  railHintWhatTitle: string;
  railHintWhatBody: string;
  railHintDoTitle: string;
  railHintDoBody: string;
  railGroupPlace: string;
  railGroupWhat: string;
  railGroupWho: string;
  railGroupWhen: string;
  railGroupSeverity: string;
  railGroupKind: string;
  railPlaceAll: string;
  railWhat: Record<'all' | 'flagged' | 'hidden' | 'rewritten' | 'ai' | 'passed' | 'ads' | 'repeat-offenders' | 'disputed' | 'blocked', string>;
  railWhen: Record<'any' | 'today' | 'yesterday' | 'last7' | 'evening', string>;
  railSeverity: Record<'high' | 'medium' | 'low', string>;
  railKind: Record<'posts' | 'comments' | 'videos' | 'images', string>;
  railGroupMode: string;
  railMode: Record<Level, string>;
  railGroupModel: string;
  railModelNone: string;
  /** Surface axis: record.feedSource folded by surfaceKey (filter-rail.ts). */
  railGroupSurface: string;
  railSurface: Record<'for-you' | 'following' | 'profile' | 'permalink' | 'search' | 'video' | 'manual' | 'unknown', string>;
  /** Seen-before axis: the chain already held this text on an earlier record. */
  railGroupSeen: string;
  railSeen: Record<'repeat' | 'first', string>;
  /** "Metrics hidden" category names (color-maps BLOCKED_CATEGORY_LABELS keys),
   *  for the showing-line token and the side panel. Unknown categories fall
   *  back to the raw name. */
  railHiddenCategory: Record<'AI-content videos' | 'Blocked hashtags' | 'Reels & shorts' | 'Platform breaks' | 'Ads' | 'Other blocks' | 'Hidden', string>;
  /** Custom date window token from a cross-tab drill; either bound may be open. */
  tokenWhenRange: (from: string | null, to: string | null) => string;
  /** Session token; `id` is the short session id. */
  tokenSession: (id: string) => string;
  /** "Showing {N} of {M} records" — split so the counts render bold. */
  /**
   * Older records held in the archive but NOT in this list. The list reads the
   * active chain, so once eviction starts archiving, "showing 10000 of 10000"
   * sits under a header counting more than that. Stating the difference is
   * what stops the gap reading as loss.
   */
  showingArchivedNote: (archived: number) => string;
  /** The archived records ARE in this list (the whole record has loaded). */
  showingArchivedIncluded: (archived: number) => string;
  /** Records in archived months outside the walk window (item 7, second slice): counted in every total, not listed here. */
  showingArchivedOlder: (older: number) => string;
  /** The side panels wait for the full read; a page of 400 must not print totals (D1-11, D2-11). */
  sidePanelsPending: string;
  /**
   * How far back the LIVE list goes, and that it turns over.
   *
   * The list reads the active chain, which is capped
   * (`FORENSIC_RECORD_CAP`, 10,000). At the volume the recorder writes, that
   * is days rather than months, and until 2026-09-05 no screen said so: a
   * reader saw "showing 500 of 500" and had no way to know the window rolls.
   * Stating the span and the ceiling together is what makes the number mean
   * something. `showingArchivedNote` above covers what has ALREADY rolled off;
   * this covers what is still here and for how much longer.
   */
  recordWindowNote: (from: string, to: string, count: number, cap: number) => string;
  showingBefore: string;
  showingBetween: string;
  showingAfter: string;
  /** Trust line while only the newest page is loaded. States no chain total:
   *  a total the page has not actually loaded is never claimed. */
  showingLoadingBefore: string;
  showingLoadingAfter: string;
  showEverything: string;
  tokenRemoveTip: string;
  /** Both export cards on an install that holds no record at all, active or archived (9 Oct 2026). */
  exportNothingRecorded: string;
}

/** The four reader lenses of the Feed behavior surface (READER_LENSES.md). */
export type FeedBehaviorLens = 'parent' | 'lawyer' | 'analyst' | 'self';
