// The shape every popup language file answers.
//
// Every user-visible string in src/ui/popup/Popup.tsx is a key here. The four language files beside
// this one each declare themselves as PopupStrings, so adding a key to one and not the others is a
// compile error and a translation cannot go missing quietly. Strings that take a value are
// functions rather than template keys, so the call sites stay type-checked.
//
// Cut out of src/i18n/popup-strings.ts on 2026-09-16 (PLAN-2026-09-16 item 10.2).

/** Off's switches as the status line names them, and the slur rule, which has no switch. */
export type OffWhatId =
  | 'slurs' | 'block-reels' | 'hide-stories' | 'hide-suggestions' | 'hide-right-column'
  | 'hide-marketplace' | 'hide-groups' | 'hide-engagement-metrics' | 'hide-action-buttons'
  | 'block-comment-posting' | 'strip-emojis' | 'block-ai-content' | 'block-ads'
  | 'hide-home-feed' | 'hide-recommended-videos';

export interface PopupStrings {
  // Header / status
  licenseLabel: string;
  statusOk: string;
  statusFree: string;
  statusRevoked: string;
  statusAction: string;
  statusChecking: string;
  statusCheckingShort: string;
  statusUnchecked: string;
  statusUncheckedShort: string;
  statusKeyHeld: string;
  statusKeyHeldShort: string;

  // Tab bar
  tabHome: string;
  tabLicense: string;

  // Shell
  loading: string;
  loadFailedTitle: string;
  loadFailedBody: string;
  loadFailedBodyOff: string;
  retry: string;

  // PIN overlay
  pinTitle: string;
  pinIncorrect: string;
  pinLockedFor: (seconds: number) => string;
  pinDigitAria: (n: number) => string;
  cancel: string;

  // Setup wizard
  setupWelcomeTitle: string;
  // Which browser Receipts goes on, said before anything else on the first screen.
  setupWelcomePurpose: string;
  setupWelcomeBody1: string;
  setupWelcomeBody2: string;
  beginSetup: string;
  setupWhoTitle: string;
  // One line per level, each starting with its name: what it sends out and what it locks.
  setupLevelChildLine: string;
  setupLevelTeenLine: string;
  setupLevelAdultLine: string;
  modeChild: string;
  modeTeen: string;
  modeAdult: string;
  continueBtn: string;
  back: string;
  setupPinTitle: string;
  setupPinBody: string;
  /** The setup PIN paragraph at Moderate: the Strict text less its clause about leaving Strict (V3). */
  setupPinBodyModerate: string;
  /** Adult mode on the first-run screen (14 Sep 2026): no PIN, no phrase; start with one button. */
  setupAdultNoPin: string;
  setupChooseFirst: string;
  setupPinNext: string;
  setupStartFree: string;
  choose: string;
  confirm: string;
  // PIN recovery phrase + change PIN (UX-I18N-A11Y-1)
  pinForgot: string;
  pinRecoveryTitle: string;
  pinRecoveryPhraseLabel: string;
  pinRecoveryNewPin: string;
  pinRecoveryConfirmPin: string;
  pinRecoveryReset: string;
  pinRecoveryWrong: string;
  pinRecoveryNone: string;
  /** The same line for Off, which keeps no record for a reinstall to delete. */
  pinRecoveryNoneOff: string;
  setupRecoveryTitle: string;
  setupRecoveryBody: string;
  /** The same warning for Off, which keeps no record for a reinstall to delete. */
  setupRecoveryBodyOff: string;
  setupRecoveryConfirm: string;
  /** Stage 3: the phrase card's Copy and Print buttons, the word said after Copy, the hyphen as a screen reader says it,
   *  and the printed card's name line and its two steps. */
  recoveryCopy: string;
  recoveryCopied: string;
  recoveryCopyFailed: string;
  recoveryPrint: string;
  recoveryDash: string;
  recoveryPrintName: string;
  recoveryPrintSteps: string;
  groupPin: string;
  changePinTitle: string;
  changePinDesc: string;
  /** One sentence, for Receipts' settings; Off keeps the longer line. */
  changePinDescOne: string;
  changePinCurrent: string;
  changePinSave: string;
  changePinWrong: string;
  /**
   * Said on the recovery-phrase step, where the two secrets are made (Child and
   * Teen): where the PIN and the recovery phrase end up. Both are stored as
   * salted PBKDF2 hashes on this computer only (storage/settings.ts), so the
   * phrase cannot be shown again.
   */
  setupWhereSecretsNote: string;
  /** The heading over setupWhereSecretsNote, on the recovery-phrase step where the two secrets are made. */
  setupWhereSecretsTitle: string;
  licCardName: string;
  /**
   * Quiet hours refused the edit and why. Both used to be a silent no-op: the
   * chip snapped back, nothing was written, nothing was said (2026-09-19).
   */
  quietNeedsADay: string;
  quietNeedsALength: string;

  // Home tab
  // Q63 (W59): numeric so the RO side can apply the "de" rule; each string
  // formats with toLocaleString itself.
  metaUnlimited: (used: number) => string;
  metaUsage: (used: number, cap: number, pct: number) => string;
  metaMonthly: (pct: number) => string;
  pausedTextDaily: string;
  pausedTextMonthly: string;
  coverageNoSite: string;
  /** The screen before the first paid reading (a draft, for the lawyer). */
  consentTitle: string;
  /** The one line on why this screen differs from a cookie banner: one company, named below. */
  consentWhy: string;
  consentWhatGoes: string;
  /** Names the company as the proxy serves it: no build holds a provider's name. */
  consentToWhom: (provider: string) => string;
  /** Shown instead when the proxy did not name it: without a name there is nothing to agree to. */
  consentProviderUnknown: string;
  consentWhatDoesNot: string;
  consentMoney: string;
  consentStart: string;
  consentNotNow: string;
  // Non-free tier whose live proxy probe returned 'revoked' (401/403). The
  // key is well-formatted but the server rejected it, so AI checks are off
  // even though the pills/toggles look active. Mirrors the free-tier banner
  // instead of leaving the small header dot as the only signal (POP-5).
  licenseInvalidTitle: string;
  licenseInvalidBody: string;
  // The hero is bound to `totalNeutralizedToday`, which increments once per
  // intervention of any kind (hide, collapse, softening), not once per rewrite. It
  // was labelled REWRITES until 2026-08-18, so a free-tier user with zero model calls
  // read a two-digit rewrite count. The counter is honest; the label was not.
  /** Popup hero. The three equal tiles it replaced gave the same weight to
   *  the one number a parent cares about (actions taken) and to a count of
   *  API requests, which is plumbing. One figure leads; the rest is a quiet
   *  second line. Mirrors the dashboard Overview hero (2026-08-21). */
  kpiTotal: (n: string) => string;
  popHeroLabel: string;
  // Home's count line: what the product looked at today (posts and comments, in the day's UTC count), with the numbers formatted by the caller.
  /** With site, the one-site sentence that stands in for the bar (stage 3). */
  homeReadCount: (posts: number, comments: number, fmt: (n: number) => string, site?: string) => string;
  homeReadNothing: string;
  kpiActionsTip: string;
  // Per-element cosmetic hides are deliberately not ledger records, so this tip must
  // never promise a dashboard filter that structurally cannot contain them: the
  // ledger's "metrics hidden" counts records, the popup tile counts DOM elements.
  openDashboard: string;
  detachWindow: string;
  settingsBtn: string;
  privacy: string;

  // License tab
  keySubFree: string;
  /** Under keySubFree, outside Strict: what a key adds. No price; the link below leads to the site's help page. */
  keyAdds: string;
  keyGetLink: string;
  /** With a key: the name of what the key turns on. The rows it covers follow under it, by their Settings names. */
  keySubActive: string;
  // POP-5 residual: the License tab's own pill/dot used to read "active" for
  // a revoked paid-shaped key regardless of the live proxy probe. These pair
  // with licenseInvalidTitle to give this tab the same honest revoked state
  // HomeTab already shows, worded for a parent who is already on this screen.
  licenseNotAcceptedPill: string;
  licenseInvalidBodyKeysTab: string;
  placeholderStored: string;
  show: string;
  /** The PIN show control: its label and tooltip say it works while held. */
  pinShowHold: string;
  hide: string;
  save: string;
  licenseStaysOnDevice: string;
  saved: string;
  removeLicense: string;
  removeConfirmBody: string;
  remove: string;
  cancelLower: string;
  dailyLimit: string;
  unlimitedCalls: string;
  callsPerDay: (cap: number) => string;
  noCallsRejected: string;
  capPauseNote: string;
  // Block-AI hashtag editor
  hashtagsHelp: string;
  hashtagsRestoreDefaults: string;
  hashtagsEmpty: string;
  /** The fold over the hashtag chips, with how many there are. */
  hashtagsShowList: (n: number) => string;
  removeHashtagAria: (tag: string) => string;
  addHashtagPlaceholder: string;
  /**
   * Shown under the hashtag box when Add is refused. Added 2026-09-19: the
   * refusal used to be silent, so a parent pressed a lit button and nothing
   * happened. Accented words are accepted now, so what is left to refuse is an
   * input that is not one word.
   */
  hashtagNotAWord: string;
  addHashtagAria: string;
  add: string;

  // Settings panel
  settingsTitle: string;
  themeAria: string;
  themeLight: string;
  themeDark: string;
  themeAuto: string;
  lookAria: string;
  lookA: string;
  lookB: string;
  lookC: string;
  lookD: string;
  lookE: string;
  uiLangName: string;
  /** The same row in Off, which names Off. */
  uiLangDescOff: string;
  uiLangAria: string;
  uiLangAuto: string;
  groupBreak: string;
  groupAi: string;
  /** The swear mask's own card: it uses no model, so it stands outside the AI card on every install. */
  rowInfoAria: string;
  featRewriteName: string;
  featRewriteDesc: string;
  featRewriteUnavailableHere: string;
  featRewriteNotOnYouTube: string;
  featDiffersOnPlatforms: string;
  featMarkersName: string;
  featMarkersDesc: string;
  featBlockAiName: string;
  featBlockAiDesc: string;
  featBlockReelsName: string;
  featBlockReelsDesc: string;
  featHideStoriesName: string;
  featHideStoriesDesc: string;
  featHideSuggestionsName: string;
  featHideSuggestionsDesc: string;
  featHideRightColumnName: string;
  featHideRightColumnDesc: string;
  featHideMarketplaceName: string;
  featHideMarketplaceDesc: string;
  featHideGroupsName: string;
  featHideGroupsDesc: string;
  featHideHomeFeedName: string;
  featHideHomeFeedDesc: string;
  featHideRecommendedName: string;
  featHideRecommendedDesc: string;
  featBlockAdsName: string;
  featBlockAdsDesc: string;
  featHideMetricsName: string;
  featHideMetricsDesc: string;
  featHideActionsName: string;
  featHideActionsDesc: string;
  featBlockPostingName: string;
  featBlockPostingDesc: string;
  featStripEmojisName: string;
  featStripEmojisDesc: string;
  softenSwearingName: string;
  /** The mask switch's accessible name while it is locked on at Strict (B2F, P3-3). */
  softenSwearingAriaChild: string;
  softenSwearingDesc: string;
  /** Shown on the soften-swearing row while Child mode holds it locked. */
  softenSwearingDescChild: string;
  softenSwearingDescImplied: string;
  reframeRewritesName: string;
  reframeRewritesDesc: string;
  /** The quiet-hours control (2026-09-15): one window for all five sites. */
  quietEditTitle: string;
  quietEditDesc: string;
  quietEditNow: string;
  quietEditFrom: string;
  quietEditTo: string;
  quietEditDays: string;
  /** Short day names indexed by JS getDay(), 0 = Sunday. */
  /** Shown under the day chips for an overnight window: a day is the night that STARTS on it. */
  quietEditOvernightNote: string;
  quietEditDayNames: readonly string[];
  quietEditHint: string;
  featAiMasterName: string;
  /** The AI switch's accessible name while it is locked off at Strict (B2F, P3-3). */
  featAiMasterAriaStrict: string;
  featAiMasterDesc: string;
  featAiMasterOffNote: string;
  /** The master reading switch's note in Strict, where it is off and cannot be turned on. */
  featAiMasterStrictNote: string;
  /** The licence card's line in Strict, which asks the server nothing. */
  keySubStrict: string;
  /** What Strict means, in the words the site and the store use. */
  strictNoCallsLine: string;
  outputLangName: string;
  outputLangAria: string;
  outputLangAuto: string;
  breakName: (platform: string) => string;
  breakDesc: (platform: string) => string;
  modeRowName: string;
  modeSegChild: string;
  modeSegTeen: string;
  modeSegAdult: string;
  // Names the mode the explanation below the segment row is about. The state
  // line beside it already says "Standard <Mode> protection."; the explanation
  // named no mode at all, so "Maximum protection." read as a second, competing
  // description of nothing in particular (parent install read, 18 Sep 2026).
  // `mode` is the human label of the mode being described.
  modeExplainPrefix: (mode: string) => string;
  modeExplainChildBody: string;
  modeExplainTeenBody: string;
  modeExplainAdultBody: string;
  // Mode-switch confirmation (POP-3). Applying a preset is a clean slate that
  // overwrites every custom toggle, so a switch that would change something
  // asks first. `mode` is the human label of the target mode.
  modeSwitchConfirmBody: (mode: string) => string;
  modeResetConfirmBody: (mode: string) => string;
  modeStateCustomized: (mode: string) => string;
  modeStateReset: string;
  modeSwitchConfirmYes: string;
  strictLangName: string;
  strictLangDescChild: string;
  strictLangDescOther: string;
  strictLangAria: string;
  strictLangAriaChild: string;

  // Own rules: the word / phrase / account list editor (shared by both popups)
  rulesName: string;
  rulesDesc: string;
  /** One sentence, for Receipts' settings; Off keeps the longer line. */
  rulesDescOne: string;
  /** The one line under the Settings row that opens the own rules (the parent scout, 9 Oct 2026). */
  rulesLine: string;
  /** What a word catches besides itself; behind the rules row's info button, like every switch's text. */
  rulesMore: string;
  rulesWordsLabel: string;
  rulesWordsHint: string;
  rulesPhrasesLabel: string;
  rulesPhrasesHint: string;
  rulesAccountsLabel: string;
  rulesAccountsHint: string;
  rulesSaved: string;
  /** The search box over the own rules, shown once there is a rule. */
  rulesSearch: string;
  /** Said under a search box when no rule or pick matches. */
  searchNoMatch: string;
  /** Receipts settings: the first card, the switches a daily user reaches for. */
  setEssentialsTitle: string;
  /** Receipts settings: the closed fold over the switches that take parts of a page away. */
  rulesCount: (n: number) => string;
  /** The chip editor (2026-09-03): the empty input's prompt, and the remove button's label. */
  rulesAdd: string;
  rulesRemove: (item: string) => string;
  /** The per-rule count on a chip: how many posts or comments this rule hid. */
  rulesHit: (n: number) => string;

  // Off popup
  offTagline: string;
  offGroupSwitches: string;
  /** The fold title's count: how many of the switches are on. */
  offSwitchesOn: (on: number, total: number) => string;
  /**
   * The first screen's status. `sites` and `hidden` arrive as lists and each language joins them.
   * Swearing is masked (starred), never hidden, so it has its own verb.
   */
  offStatusAll: (swearing: boolean, hidden: string[], sites: string[]) => string;
  /** The switches that reach only some sites, each already put as `offOnSites`. */
  offStatusAlso: (items: string[]) => string;
  /** The sites on break come first: their whole tab is covered, which outweighs any switch. */
  offStatusBreak: (sites: string[]) => string;
  /**
   * The first screen's status in one line: up to a few of the things hidden on every site by name, the rest
   * counted (`more`), so no switch claims a site it does not reach. `names` empty means count them all.
   */
  offStatusLine: (swearing: boolean, names: string[], more: number) => string;
  /** The one line while a site is on break: its whole tab is covered, which outweighs any switch. */
  offStatusBreakLine: (sites: string[]) => string;
  /** The same, when every site is on break. */
  offStatusBreakAll: string;
  offOnSites: (what: string, sites: string[]) => string;
  /** What each switch hides, as the object of "hiding ...", plus the slur rule that has no switch. */
  offWhat: Record<OffWhatId, string>;
  offHelpLead: string;
  offHelpLink: string;
  /** The quiet line under the help line: a question and the link that opens a prefilled email to support. */
  offReportLead: string;
  offReportLink: string;
  /** The email's subject; the site's name, or '' when the page in front is not one of Off's sites. */
  offReportSubject: (site: string) => string;
  /** The email's first line, above the space the person writes in, and the labels of the facts below it. */
  offReportAsk: string;
  offReportSite: string;
  offReportPage: string;
  offReportVersion: string;
  offReportSwitches: string;
  offReportNoSite: string;
  offReportNone: string;
  receiptsReportSubject: (site: string | null) => string;
  receiptsReportVersion: string;
  receiptsReportNoSite: string;
  offGroupPin: string;
  /** Off's own footer link, capitalised; the shared `privacy` stays lower case for the recorder. */
  offPrivacy: string;
  /** The sum of the hide tallies: things taken off the page, not text starred or cleaned. */
  offStatusHidden: (n: number) => string;
  offStartPin: string;
  offNoSwearingName: string;
  offNoSwearingDesc: string;
  /** The No swearing row's note, off and on. */
  offSlursNote: string;
  offSlursNoteOn: string;
  offBlockAdsDesc: string;
  /** Per-switch tally lines under each switch, from settings.hiddenByFeature. */
  offFiredHidden: (n: number) => string;
  offFiredStarred: (n: number) => string;
  offFiredCleaned: (n: number) => string;
  offRulesFired: (words: number, slurs: number) => string;
  /** The ad rule judged n posts on a platform and found no ad: the label has probably moved. */
  offAdsBlind: (platform: string, judged: number) => string;
  /** "Block this": arm the picker from the popup, list and remove the picks. */
  offPickName: string;
  offPickDesc: string;
  /** Shown when no tab took the arming: the wrong page, or one not reloaded since Off arrived. */
  offPickNoPage: string;
  offPickButton: string;
  offPickManyButton: string;
  offPickNone: string;
  offPickRemove: string;
  /** The grouped list: a pick with no name, one Clear per platform, the fold. */
  /** A pick with no name of its own, named by the day it was picked. */
  offPickDated: (date: string) => string;
  offPickSearch: string;
  offPickClear: string;
  offPickShowAll: (n: number) => string;
  offPickShowLess: string;
  /** Adult mode, the recorder: the on-demand reading card on the Home tab. */
  offPinSetName: string;
  offPinSetDesc: string;
  offPinNew: string;
  offPinConfirm: string;
  offPinSave: string;
  offPinMismatch: string;
  offPinLockedNote: string;
  /** Receipts' note when a PIN is already set (Settings ask for it); Off has its own, offPinLockedNote. */
  pinLockedNote: string;
  /** One line over the PIN lock while a reading answer waits: why even an answer asks for the PIN (V1). */
  pinConsentReason: string;
  /** The line after a PIN was reset with the recovery phrase. */
  pinChanged: string;
  /** The one line after an update, until it is opened or dismissed once (PLAN-2026-09-17 item 8a). */
  updateNoticeLine: (version: string) => string;
  updateNoticeDismiss: string;
  /** Receipts' update line, once, for an install that had a switch on that moved to Off. */
  pageSwitchesMovedNote: string;
  /** Home's page status in a few words: the site and that it is being recorded, or limited there. */
  pageRecording: (platform: string) => string;
  pageLimited: (platform: string) => string;
  /** The reading card: what the AI reads when you pick (a comment brings the start of its post). */
  /** Under the language picker: pages already open switch after a reload. */
  uiLangDesc: string;
  /** Receipts' "Write to the maker" mail (8 Oct 2026): the link, its subject, its first line and its three labels. */
  makerLink: string;
  makerSubject: string;
  makerAsk: string;
  makerKey: string;
  makerKeyUnread: string;
  makerLastError: string;
  /** Home's bottom-row contact menu (9 Oct 2026): its name, and the line that mails a report about the page. */
  contactAria: string;
  contactReport: string;
  /** The word beside Home's figure since 9 Oct 2026: the posts and comments Receipts saw today. */
  homeSeenLabel: string;
}
