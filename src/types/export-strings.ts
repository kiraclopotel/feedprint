// The export page's own vocabulary: which language it speaks, and every string it prints.
//
// These live in the types layer because the words themselves live in src/i18n/export-strings.ts and
// i18n may not import forensics (PLAN-2026-09-16 items 8.11 and 10.1). The builder re-exports both
// names, so every existing import keeps working.

import type { ResolvedUiLanguage } from './ui-language';
import type { PolicyRowId } from './policy-row';
import type { DecisionAction } from './forensic';

// The export speaks the interface language: ExportLocale IS ResolvedUiLanguage, so adding an interface language is a
// compile error in the export tables until they carry it, rather than a silent fall back to English inside a
// court-facing document.
export type ExportLocale = ResolvedUiLanguage;

/** One signing key the file carries, by the fingerprint the records name. */

export type DecisionFlatKeys = { [K in `why_${PolicyRowId}`]: string } & { [K in `act_${DecisionAction}`]: string }
  // The family's own words for a band row (src/i18n/why-words.ts).
  & { [K in `whyfam_${'hostile' | 'threat' | 'commercial' | 'body' | 'profanity'}`]: string };

/** Page one's rows on where the record came from (src/forensics/export-evidence-strings.ts). */
export interface ExportEvidenceStrings {
  /** Page one when every record carries the same build id; `{id}` is that id. */
  summaryBuildOne: string;
  summaryBuildOneValue: string;
  /** The same build named by only some records: `{id}`, `{n}` of `{total}`, `{rest}` name none. */
  summaryBuildOneOfSomeValue: string;
  /** Page one's install row: the label, Chrome's five install types in words, one item, the records stating none, the limit. */
  summaryInstall: string;
  installNormal: string;
  installDevelopment: string;
  installSideload: string;
  installAdmin: string;
  installOther: string;
  /** `{what}` is one of the install words, `{n}` how many records say it. */
  summaryInstallItem: string;
  summaryInstallUnstated: string;
  summaryInstallLimit: string;
  /** The checker's notes on key changes inside the file; `{n}` counts them. */
  chainNoteKeyStated: string;
  chainNoteKeyUnstated: string;
}

export interface ExportI18nStrings extends DecisionFlatKeys {
  title: string;
  subtitle: string;
  whatThisDoes: string;
  pageOneHeader: string;
  summaryRecordCount: string;
  /** The label under the number of sites at the head of the file. */
  certSites: string;
  /** The line under the verdict at the head of the file: where and when the check ran. */
  certCheckedHere: string;
  /** Label of the row that says what a content record is (2026-09-20). */
  summaryContentRecords: string;
  /** `{n} of {total}` and the definition, in the words of isDecidedContentRecord's docblock. */
  summaryContentRecordsValue: string;
  /** On the card of a reading the person asked for with the button (2026-09-20). */
  feedReadingAsked: string;
  /** A report's absent positions, and the behaviour section's sentence over a report (2026-09-20). */
  summarySelectionCoverage: string;
  summarySelectionCoverageValue: string;
  bhSelectionNote: string;
  /** Page one, the recorder's own signed gaps and the resets after the first run (2026-09-20). */
  summarySignedGaps: string;
  summarySignedGapsValue: string;
  summaryResetsInside: string;
  summaryResetsInsideValue: string;
  /** Page one, the archived records the install could not read and so left out. `{n}` leads the value, where the checkers read it. */
  summaryUnreadableRows: string;
  summaryUnreadableRowsValue: string;
  /** Flagged share of the content records in this file, with n and a 95% Wilson interval. */
  summaryFlaggedShare: string;
  summaryFlaggedShareValue: string;
  summaryFlaggedShareNone: string;
  /** Flags a judge made, flags a rule made, and what the rules were. */
  summaryFlaggedJudged: string;
  summaryFlaggedJudgedValue: string;
  summaryFlaggedRule: string;
  summaryFlaggedRuleValue: string;
  summaryFlaggedRuleNone: string;
  /** The same, for a file that also holds flags a person typed in. */
  summaryFlaggedRuleNoneShort: string;
  /** Flags a person typed in. No detector ran on these. */
  summaryFlaggedManual: string;
  summaryFlaggedManualValue: string;
  /** Records that arrived on a timer into an open tab, with nobody scrolling. */
  summaryUnattended: string;
  summaryUnattendedValue: string;
  summaryUnattendedNone: string;
  /** No stretch was long enough to judge either way. */
  summaryUnattendedUnjudged: string;
  /** More than one build wrote this file — a tab an extension reload left behind. */
  summaryBuilds: string;
  summaryBuildsValue: string;
  /** One build's share of the file, and one unattended stretch. Substituted
   *  INTO the sentences above, so they need their own translation: an English
   *  fragment inside a Romanian sentence is the fallback bug this avoids. */
  summaryBuildsItem: string;
  summaryUnattendedRun: string;
  /** Label for the size of the chain this export drew from. */
  summaryDrawnFrom: string;
  /** Label for what the export gate held back. */
  summaryHeldBack: string;
  summaryHeldBackUnreviewed: string;
  summaryHeldBackLowSeverity: string;
  summaryHeldBackNonDetection: string;
  /** Shown when nothing was held back, so silence never has to be read. */
  summaryHeldBackNone: string;
  /** Chain-coverage labels: what this file can and cannot account for. */
  summaryChainRange: string;
  /** Per run, how many records fall under a time stamp; {a} {b} the run's positions, {n} of {m}, {t} the newest stamp. */
  summaryStampCoverage: string;
  /** A report: left-out records the install holds a stamp over; the value says the file neither carries nor checks those stamps. */
  summaryStampsElsewhere: string;
  summaryStampsElsewhereValue: string;
  summaryStampRun: string;
  summaryStampRunNewest: string;
  summaryStampNote: string;
  /** The same count, recounted in the reader's browser from tokens that pass its own check. */
  completenessStampRun: string;
  completenessStampRunNewest: string;
  summaryMissingBefore: string;
  summaryMissingBeforeNote: string;
  /** The same note when the install could not read some archived records, which may be the ones before the file. */
  summaryMissingBeforeNoteUnreadable: string;
  summaryGapsInside: string;
  summaryResetLabel: string;
  summaryResetNote: string;
  summaryCoverageComplete: string;
  summaryTimeWindow: string;
  /** Said once beside the page-one range, whose dates are the records' own UTC (2026-09-20). */
  summaryTimeWindowUtc: string;
  /** The word for the record's reader value 'default': nobody was declared at the keyboard. */
  feedReaderDefault: string;
  summaryFingerprint: string;
  /** Multi-key files: one row per signing key, and "exported by" instead of "recorded by". */
  summaryKeysInFile: string;
  summaryEpochsLabel: string;
  summaryEpochsNote: string;
  /** "{n} of them carried in this file": keys whose signatures the verifier can check. */
  summaryKeysCarried: string;
  summaryExportedBy: string;
  /** Page-one rows naming the maker (their chosen name) and the machine. */
  summaryMadeBy: string;
  summaryMadeByNote: string;
  summaryMachine: string;
  summaryMachineUnknown: string;
  epochColKey: string;
  epochColRecords: string;
  epochColPositions: string;
  epochColPeriod: string;
  epochColModels: string;
  epochActiveKey: string;
  /** An earlier generation whose key the file carries (recovered with its records). */
  epochCarriedKey: string;
  epochPriorKey: string;
  epochUnfingerprinted: string;
  epochNoPositions: string;
  epochRunsWord: string;
  epochMissingWord: string;
  epochGapsWord: string;
  epochNoModel: string;
  /** Conditions per epoch (capability audit 2026-09-06, P0 item 3): mode and configuration. */
  epochColModes: string;
  epochColConditions: string;
  /** Single-key files: the same conditions as one page-one row. */
  summaryConditions: string;
  epochModeAdult: string;
  epochModeTeen: string;
  epochModeChild: string;
  epochModeStrict: string;
  epochModeModerate: string;
  epochModeRelaxed: string;
  /** Follows the sentence for a mode written before the levels existed. */
  epochModeBeforeLevels: string;
  /** '{n} at confidence cut {t}, daily cap {c}': post-path records, a cut in [0, 1]. */
  epochConditionFmt: string;
  /** '{n} at severity floor {t} of 10, daily cap {c}': comment-path records, a floor on the 1 to 10 scale. */
  epochConditionFmtSeverity: string;
  /**
   * '{n} of them do not carry the settings the app was running under, so this
   * file cannot say what those were'.
   *
   * A sentence since 2026-09-18, and not a noun phrase. It read '{n} without a
   * configuration snapshot', which a researcher meeting the file cold took to
   * mean that {n} records were broken: the phrase never says what a
   * configuration snapshot is, whether its absence is normal, or what it costs
   * the reader.
   */
  epochNoSnapshot: string;
  /**
   * '{n} recorded with the app in {mode} mode'. No article before {mode}:
   * the first draft wrote "a {mode} reader" and the suite caught it printing
   * "a adult", which is the kind of thing a format string does in one
   * language and not the other three.
   *
   * Also a sentence, for the same reason and found in the same read: this row
   * printed the mode word and a count side by side, so "teen 1500" had to be
   * guessed at, and the count is the record count that already appears two rows
   * above.
   */
  epochModeFmt: string;
  /**
   * '{n} matched {label}': one rule and how many records it matched.
   *
   * A sentence since 2026-09-18, and the same defect as epochModeFmt one
   * line above: this list printed the label and the count side by side, so
   * "the swearing list 17" was read as a version number, then as a severity,
   * before the reader worked out it was the count repeating itself.
   */
  ruleKindFmt: string;
  /** Why the key exists (capability audit 2026-09-06, P1 item 5). */
  epochColWhy: string;
  epochWhyGenerated: string;
  epochWhyRestored: string;
  epochWhyUnknown: string;
  summaryKeyOrigin: string;
  summaryPrecisionLabel: string;
  summaryPrecisionMissing: string;
  whatFWDoesNotMeasure: string;
  /** What the file tells a recipient about the person who made it. */
  whatThisFileTells: string;
  whatThisFileTellsIntro: string;
  /** The same sentence when the file carries a chosen name ({name}). */
  whatThisFileTellsIntroNamed: string;
  whatThisFileTellsOutro: string;
  tellsAuthors: string;
  tellsChosen: string;
  tellsAdvertisers: string;
  tellsContainers: string;
  tellsLinks: string;
  tellsMedia: string;
  tellsSpan: string;
  notMeasureBullets: string;
  exposureHeader: string;
  exposureIntro: string;
  exposureEvents: string;
  exposureDateRange: string;
  exposureSeverityHeader: string;
  exposureSevHigh: string;
  exposureSevMid: string;
  exposureSevLow: string;
  exposureTechHeader: string;
  exposurePlatformHeader: string;
  exposureShareWord: string;
  verifyBtn: string;
  verifyingLabel: string;
  manifestFailed: string;
  manifestMissing: string;
  chainVerified: string;
  chainPartial: string;
  chainBroken: string;
  chainVerifiedBody: string;
  /** "{n} signatures under {k} keys this file does not carry". */
  chainPartialBody: string;
  /** "{n} records carry no signature". */
  chainPartialUnsigned: string;
  /**
   * "{n} signatures were checked and did not verify." The sharpest of the
   * partial reasons and the one that must never be folded into the sentence
   * above it: a signature that was RUN under the key this file carries and
   * came back false is not a signature that could not be checked. Added
   * 2026-09-19; until then the page said the record sat under a key the file
   * does not carry, and counted this file's own key among the ones it lacks.
   */
  chainPartialRejected: string;
  /** "{n} signatures could not be checked at all". */
  chainPartialUncheckable: string;
  /**
   * "{n} records verify under a key that travelled inside this file." Its own
   * route to a partial verdict in verificationState, and until 2026-09-19 the
   * page printed no sentence for it, so a file whose only shortfall was this
   * showed an amber headline with no reason under it.
   */
  chainPartialCarriedKey: string;
  /**
   * "{n} records had fields withheld." Printed under BOTH the verified and the
   * partial headline, because the verified body says every included record
   * matched its stored hash and for a withheld record the hash was never
   * recomputed: its content has left the file. The record stands on a signed
   * redaction marker naming its id and its stored hash, which is sound, and is
   * not what that sentence says. The standalone checker has printed this since
   * 2026-09-08; the page said nothing until 2026-09-19.
   */
  chainWithheld: string;
  /** "For {u} of those, no signature was checked." */
  chainWithheldUnchecked: string;
  perRecordPass: string;
  perRecordFail: string;
  perRecordUnsigned: string;
  perRecordPriorKey: string;
  perRecordCarriedKey: string;
  perRecordUnverified: string;
  perRecordPlatform: string;
  perRecordAuthor: string;
  perRecordProtections: string;
  perRecordSettingsReadFailed: string;
  perRecordCaptured: string;
  perRecordSurface: string;
  perRecordSurfaceWarn: string;
  perRecordExcerpt: string;
  perRecordClassification: string;
  perRecordOpinionDisclaimer: string;
  perRecordHash: string;
  failReasonTampered: string;
  /**
   * Added to the failure above when the record carries fields this checker does
   * not know: a checker older than the file cannot hash a field added later, so
   * a sound file fails its recomputation. The verdict does not change.
   */
  failReasonUnknownFields: string;
  failReasonKeyMismatch: string;
  failReasonVerifierSetup: string;
  /**
   * The last arm of the failure-reason chain: a record that did not pass for a
   * reason this page has no sentence for. `verifyOne` returns exactly three
   * reasons and all three are named above it, so nothing reaches this today;
   * it is the guard for a reason added later. It said "this record does not
   * reference the previous record correctly" until 2026-09-19, which nothing
   * in the checker ever produces, so a new reason would have printed a
   * specific wrong cause instead of an honest one.
   */
  failReasonUnnamed: string;
  /**
   * The check threw while hashing records. Until 2026-09-19 that path printed
   * the key-setup sentence, which names a malformed key and a fingerprint
   * mismatch, long after the key had been accepted.
   */
  failReasonCheckStopped: string;
  /**
   * "{n} seams in the chain." A seam is EITHER a position held by two
   * records under one key (a branch) OR a break between consecutive
   * positions (a restart); chainNotes sums the two and prints this once.
   * Named for the branch alone until 2026-09-19, with wording to match, so a
   * file holding one restart and no branch told its reader that a position
   * was held by more than one record when none was.
   */
  chainNoteSeams: string;
  /**
   * "{n} records continue from position {position} on a line the record did not keep": one per
   * line the checker counted as set aside. The file cannot tell a restore from a rewrite with the
   * same key, so the sentence names both.
   */
  chainNoteSetAside: string;
  chainNoteUnattributed: string;
  chainNoteOutside: string;
  /** The verdict header when the file is a report that states its own selection and the missing links are within it. {x} of {y}. */
  chainVerifiedSelection: string;
  /** The outside-links note for such a report: {n} links, {x} of {y} records. */
  chainNoteOutsideStated: string;
  /** The outside-links note when the install's signed count of archived records it could not read covers them: {n} links, {u} records. */
  chainNoteOutsideUnreadable: string;
  /** Printed in the verdict box when the file carries no chain anchor and no key stamp. */
  noTimestampsNote: string;
  completenessHeader: string;
  completenessRun: string;
  completenessWhole: string;
  /** The same two lines for a file that holds more than one run of positions (2026-09-20). */
  completenessRuns: string;
  completenessWholeRuns: string;
  completenessMissingBefore: string;
  completenessGaps: string;
  completenessFiltered: string;
  completenessAnchorMissing: string;
  completenessAnchorBeyond: string;
  completenessAnchorHolds: string;
  completenessManual: string;
  completenessNote: string;
  completenessAnchorLimit: string;
  manualBadge: string;
  feedWithheld: string;
  /** In place of the marker a hidden item with no caption is stored under (forensics/stand-in.ts): an ad that was hidden, a rule the person added, anything else. */
  feedAdHidden: string;
  feedHiddenOwnRuleNoCaption: string;
  feedHiddenNoCaption: string;
  feedWithheldAuthor: string;
  perRecordRedacted: string;
  failReasonRedactionUnattested: string;
  manualExplain: string;
  chainBrokenAtRecord: string;
  chainBrokenReason: string;
  chainBrokenWhatToDo: string;
  chainBrokenBullet1: string;
  chainBrokenBullet2: string;
  chainBrokenBullet3Prior: string;
  chainBrokenBullet3FirstRecord: string;
  capturedBy: string;
  anchorsHeader: string;
  anchorsIntro: string;
  anchorsNone: string;
  /** No stamp over the records, while the signing key itself was stamped (the section above says by whom). */
  anchorsNoneKeyStamped: string;
  anchorTsa: string;
  anchorCovers: string;
  anchorAt: string;
  anchorHash: string;
  anchorRequestedAt: string;
  anchorTstBytes: string;
  anchorCheckHeader: string;
  anchorCheckRunning: string;
  anchorCheckPassed: string;
  anchorCheckPassedUnknown: string;
  anchorCheckFailed: string;
  anchorCheckSignedTime: string;
  anchorCheckSigner: string;
  anchorCheckUnpinned: string;
  anchorCheckNoJs: string;
  anchorCheckUnavailable: string;
  keyGenesisHeader: string;
  keyGenesisIntro: string;
  keyGenesisNone: string;
  keyGenesisExisted: string;
  keyGenesisLimit: string;
  keyGenesisDigest: string;
  fileHeader: string;
  fileIntro: string;
  fileMadeAt: string;
  fileBuild: string;
  fileKey: string;
  fileKeyCreated: string;
  fileRepairs: string;
  /** Register item 10: the record checked against the platform's own data export. */
  reconcileHeader: string;
  reconcileIntro: string;
  reconcileNone: string;
  reconcileLine: string;
  reconcileArchive: string;
  reconcileFloor: string;
  fileRepairPositionSolve: string;
  fileRepairReanchor: string;
  fileRepairFailed: string;
  fileRecords: string;
  fileDigest: string;
  fileDigestNote: string;
  fileOriginNote: string;
  checkResponseGranted: string;
  checkMessageImprint: string;
  checkSignedAttrs: string;
  checkSignature: string;
  checkEku: string;
  checkGenTime: string;
  checkIssuer: string;
  checkKnownRoot: string;
  checkNonce: string;
  feedHeader: string;
  feedIntro: string;
  /** Feed paging: "{n}" is replaced in the inline script. */
  feedShowMore: string;
  feedUnchecked: string;
  feedRemaining: string;
  /** The paging control counts RECORDS, the unit the page header counts. */
  feedRemainingRecords: string;
  feedNextRecords: string;
  feedPosts: string;
  feedComments: string;
  feedReplies: string;
  feedFlagged: string;
  feedBlockedCount: string;
  feedBlockedNote: string;
  feedWhyPrefix: string;
  /** The label over a line the app assembled from the adult reader's three answers (2026-09-20). */
  feedWhyPrefixReader: string;
  /* One flat key per reason half of detectionMode 'block:<reason>:<token>'.
     Flat, not a nested map, so the EN/RO parity guard (which walks values and
     requires a non-empty string) keeps covering them. */
  feedBlockReasonAds: string;
  feedBlockReasonMediaTimeout: string;
  feedBlockReasonReelSurface: string;
  feedBlockReasonHashtag: string;
  feedBlockReasonAiLabel: string;
  feedBlockReasonOther: string;
  feedSevHigh: string;
  feedSevMid: string;
  feedSevLow: string;
  feedTechniquesHeader: string;
  feedPeopleHeader: string;
  feedPeopleNote: string;
  feedPeopleItems: string;
  /** The label before the count of flagged items whose page named no account, kept out of the ranking. */
  feedPeopleNoAuthor: string;
  feedShowOriginal: string;
  /** Under a cut item: what the page carried, with `{n}` for the character count. */
  feedTextCaptureCut: string;
  /** The card body is capped at 500 characters; the record is not. */
  feedTextClipped: string;
  /** Under a folded item: the page carried the whole text, the screen the first lines. */
  feedTextCaptureFolded: string;
  /** Image records the flagged count above leaves out, named so the reader sees why. */
  feedFlaggedImagesNote: string;
  feedNoLevelNote: string;
  /** The author line when the recorder refused a name it could see (AuthorCapture 'withheld'). */
  feedAuthorWithheld: string;
  /** An ad whose page named no advertiser, in the dashboard card's words. */
  feedAdAuthorNotShown: string;
  /** Why it refused, under the item. */
  feedAuthorWithheldWhy: string;
  feedMediaAsRead: string;
  feedSoftened: string;
  /** The head of the softened block when the page showed the swearing starred, not a rewrite. */
  feedMasked: string;
  /** The decision block's lines on a card, flat so they ride the i18n digest (2026-09-07). */
  feedWhy: string;
  feedReader: string;
  feedDecisionShownAs: string;
  /** The fixed notes of a decision block (src/content/record/decision.ts), in the reader's language. */
  feedNoteNotApplied: string;
  feedNoteSettingOff: string;
  feedNoteLegacyActed: string;
  /** A hidden advertisement: Block ads hid it (NOTE_AD_HIDDEN). */
  feedNoteAdHidden: string;
  feedNoteVideoSkipped: string;
  feedNoteVideoMarked: string;
  feedNoteVideoFolded: string;
  feedNoteLateVerdict: string;
  feedNotePairVetoed: string;
  feedRoomHeader: string;
  feedRoomSampled: string;
  feedHarmPrescreen: string;
  feedCountLikes: string;
  feedCountShares: string;
  feedCountViews: string;
  feedCountComments: string;
  feedSeverityWord: string;
  feedNotAnalyzed: string;
  feedBlocked: string;
  feedReframed: string;
  feedSkipped: string;
  feedNoTechnique: string;
  feedOpinionHeader: string;
  feedOpinionNote: string;
  feedChainMarker: string;
  feedChainReset: string;
  /** The reader's line for a month rotation marker, which carries none of its own (2026-09-20). */
  feedMonthRotation: string;
  /** A reset marker's link to the chain before it (wiring audit C22). */
  feedPriorChain: string;
  /** A verdict a fixed product gate set, not a model (wiring audit C22). */
  feedGateRule: string;
  feedGateIdentitySlur: string;
  feedGateProfanityTier: string;
  feedGateCodedHarm: string;
  feedGateAdHominem: string;
  feedGateHarmFloor: string;
  feedGateRageFormat: string;
  feedKindPost: string;
  /** A root-level video. Before 2026-09-19 the export could not tell one from a text post. */
  feedKindVideo: string;
  /** The reading of a picture: an analysis record, not something a person wrote. */
  feedKindImage: string;
  feedKindComment: string;
  feedKindReply: string;
  feedViewOriginal: string;
  feedViewComment: string;
  feedScanQr: string;
  feedRewriteBeta: string;
  feedCountReposts: string;
  feedCountReplies: string;
  feedLikesHidden: string;
  feedMetricHeart: string;
  feedPopularityHeader: string;
  feedPopularitySeenPre: string;
  feedPopularitySeenPost: string;
  feedPopularityNote: string;
  feedReconBadge: string;
  feedReconVideo: string;
  feedReelThread: string;
  feedReconNote: string;
  // ── Methodology section ("under what criteria", court-readiness) ──
  methodologyHeader: string;
  methodologyIntro: string;
  methodologyModelsLabel: string;
  methodologyThresholdsLabel: string;
  methodologyTopicsLabel: string;
  methodologyPromptsLabel: string;
  // ── Feed behavior (five levels + reader lenses; docs/design/READER_LENSES.md).
  //    Strings use %1..%4 placeholders resolved by the in-page fmt() helper.
  //    Caption keys carry one variant per reader lens; the numbers a caption
  //    cites are the same numbers the panel shows, so the lens can never
  //    change the evidence, only the register. ──
  bhHeader: string;
  bhIntro: string;
  bhLegendFact: string;
  bhLegendInterp: string;
  bhLensParent: string;
  bhLensLawyer: string;
  bhLensAnalyst: string;
  bhLensSelf: string;
  bhLensNote: string;
  bhLevelWord: string;
  bhProv: string;
  bhRunsTitle: string;
  bhRunsSub: string;
  bhRunsStatPre: string;
  bhRunsStatHi: string;
  bhRunsStatEnd: string;
  bhRunsNone: string;
  bhRunsNote: string;
  bhRunsCapParent: string;
  bhRunsCapLawyer: string;
  bhRunsCapAnalyst: string;
  bhRunsCapSelf: string;
  bhSkewTitle: string;
  bhSkewSub: string;
  bhSkewOpen: string;
  bhSkewClose: string;
  bhSkewNum: string;
  bhSkewNone: string;
  bhSkewCapParent: string;
  bhSkewCapLawyer: string;
  bhSkewCapAnalyst: string;
  bhSkewCapSelf: string;
  bhReturnTitle: string;
  bhReturnSub: string;
  bhReturnStat: string;
  bhReturnNote: string;
  /** '95% interval %1–%2%', appended after every rate the behavior section prints. */
  bhCi: string;
  bhReturnNone: string;
  bhReturnCapParent: string;
  bhReturnCapLawyer: string;
  bhReturnCapAnalyst: string;
  bhReturnCapSelf: string;
  bhAmpTitle: string;
  bhAmpSub: string;
  bhAmpHigh: string;
  bhAmpNormal: string;
  bhAmpLow: string;
  bhAmpUnknown: string;
  bhAmpAdv: string;
  bhAmpAdvNote: string;
  bhAmpNone: string;
  bhAmpProv: string;
  bhAmpCapParent: string;
  bhAmpCapLawyer: string;
  bhAmpCapAnalyst: string;
  bhAmpCapSelf: string;
  bhReserveTitle: string;
  bhReserveSub: string;
  bhReserveColThread: string;
  bhReserveColDays: string;
  bhReserveColServings: string;
  bhReserveColFlagged: string;
  bhReserveNone: string;
  bhReserveProv: string;
  bhReserveCapParent: string;
  bhReserveCapLawyer: string;
  bhReserveCapAnalyst: string;
  bhReserveCapSelf: string;
  bhChainsTitle: string;
  bhChainsSub: string;
  bhChainThen: string;
  bhChainRepeats: string;
  bhChainTimes: string;
  bhChainHandoff: string;
  bhChainSustained: string;
  bhChainsNone: string;
  bhChainsUnnamed: string;
  bhChainsProv: string;
  bhChainsCapParent: string;
  bhChainsCapLawyer: string;
  bhChainsCapAnalyst: string;
  bhChainsCapSelf: string;
  bhVoicesTitle: string;
  bhVoicesSub: string;
  bhVoicesColAccount: string;
  bhVoicesColDays: string;
  bhVoicesColSeen: string;
  bhVoicesFlagged: string;
  bhVoicesAdvertiser: string;
  bhVoicesNone: string;
  bhVoicesProv: string;
  bhVoicesCapParent: string;
  bhVoicesCapLawyer: string;
  bhVoicesCapAnalyst: string;
  bhVoicesCapSelf: string;
  bhCautionTitle: string;
  bhCautionTag: string;
  bhCautionSub: string;
  bhCautionNone: string;
  bhCautionRun: string;
  bhCautionRunEv: string;
  bhCautionReturn: string;
  bhCautionReturnEv: string;
  bhCautionAmp: string;
  bhCautionAmpEv: string;
  bhCautionChain: string;
  bhCautionChainEv: string;
  bhPredTag: string;
  bhPredLead: string;
  bhPredClauseRun: string;
  bhPredClauseReturn: string;
  bhPredJoin: string;
  bhPredTail: string;
  bhCautionCapParent: string;
  bhCautionCapLawyer: string;
  bhCautionCapAnalyst: string;
  bhCautionCapSelf: string;
  // The reading mode (futurestate.md section 3b, item 2): platform marks,
  // the numbers row, the filters, the blur toggle, and the plain rule label.
  rdHeader: string;
  rdIntro: string;
  /** The one-line answer over the current selection: {platform}, {surface}, {impressions}, {unique}, {paid}, {from}, {to}. */
  rdSentence: string;
  rdSentenceAll: string;
  /** The selection holds no record: {platform}, {surface}. */
  rdSentenceNone: string;
  rdAll: string;
  rdColImpressions: string;
  rdColUnique: string;
  rdColSeenBefore: string;
  rdColPaid: string;
  rdColUserHidden: string;
  rdColModelNamed: string;
  rdTotal: string;
  /** How the two columns beside it are counted: once per text, on the platform that showed it first (2026-09-20). */
  rdUniqueNote: string;
  rdWholeChain: string;
  /** The file is a selection: the table ran over its {n} records, drawn from {m} in the record. */
  rdSelectionNote: string;
  rdSurface: string;
  rdSurfaceAny: string;
  rdSurfaceForYou: string;
  rdSurfaceProfile: string;
  rdSurfacePermalink: string;
  rdSurfaceSearch: string;
  rdSurfaceOther: string;
  /** X's Following tab and pinned lists (wiring audit L2). */
  rdSurfaceFollowing: string;
  /** The surface was not captured. */
  rdSurfaceUnknown: string;
  rdSitting: string;
  rdSittingAny: string;
  rdSittingN: string;
  rdSeen: string;
  rdSeenAny: string;
  rdSeenOnly: string;
  rdSeenFirst: string;
  /** Label of the severity level filter in the reading mode. */
  rdLevel: string;
  rdLevelAny: string;
  /** Under the numbers table: a number is a filter. */
  rdNumbersHint: string;
  /** DESCRIPTOR-V1 labels on a card (PLAN-2026-09-15 item 1): the effect, then the group. */
  dvGroupHostility: string;
  dvPersonHostility: string;
  dvThreat: string;
  dvSexual: string;
  dvSelfHarm: string;
  dvViolence: string;
  dvBody: string;
  dvCommercial: string;
  dvDeception: string;
  dvDrugs: string;
  dvProfanity: string;
  dvgJewsIsraelis: string;
  dvgMuslims: string;
  dvgChristians: string;
  dvgBlackPeople: string;
  dvgAsianPeople: string;
  dvgRoma: string;
  dvgMigrants: string;
  dvgWomen: string;
  dvgMen: string;
  dvgLgbtq: string;
  dvgDisabledPeople: string;
  dvgANationality: string;
  dvgAPoliticalSide: string;
  dvgOtherGroup: string;
  dvTitle: string;
  rdMatching: string;
  rdBlur: string;
  rdInterpSummary: string;
  rdMethodSummary: string;
  feedYourRule: string;
  ruleWordFilter: string;
  ruleAccountBlock: string;
  ruleHashtagBlock: string;
  ruleAiContentBlock: string;
  ruleReelSurface: string;
  ruleMediaTimeout: string;
  ruleAdMarker: string;
  summaryPaidPlacement: string;
  summaryPaidPlacementValue: string;
  methodologyAdsNote: string;
}
