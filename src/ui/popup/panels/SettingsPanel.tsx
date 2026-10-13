// The settings screen behind the PIN: the level and what it does on one short page, and under it three folds in a list,
// General (the switches and the own rules), Live Rephrase (with a key) and PIN and language. Each fold opens and closes
// in place, the same way, so there is no page to go into and no way back to find; the PIN gate and the live settings are
// the same for all of them, and a reload of the settings never loses what is open.

import { readParentBlocklist } from '../../../core/parent-blocklist';
import { UI_LANGUAGES, UI_LANGUAGE_LABELS, type UiLanguage } from '../../../i18n';
import { POPUP_STRINGS, type PopupStrings } from '../../../i18n/popup-strings';
import { usePopupT } from '../../../i18n/react';
import { LicenseInfo } from '../../../storage/license';
import type { ReadingConsent } from '../../../storage/reading-consent';
import { FWSettings, FeatureId, type PlatformId, getFeatureValue, isFeatureEnabled, parentPinUnknown, saveSettings } from '../../../storage/settings';
import { Mode } from '../../../types/mode';
import { ChevronDown, ChevronLeft, ChevronRight } from '../../shared/icons/lucide';
import { BlocklistEditor } from '../BlocklistEditor';
import { AiCard } from './ai/AiCard';
import { FOLD_DEFAULT_OPEN, FOLD_KEYS, Fold } from './Fold';
import { ChangePinPanel, FeatRow, PinOverlay, SetPinPanel, Toggle, rovingGroup } from '../controls';
import { getFwVersion } from '../fw-version';
import { prefersReducedMotion } from '../life';
import { useReadingOn } from '../reading-gate';
import { flipSwitch, modeSwitchResetsToggles, overriddenPlatforms, switchIsOn, useCurrentPlatform, useModeSwitch } from '../switches';
import { useEffect, useState } from 'react';
import '../page-button.css';

// Row metadata (id / grouping / beta tag) is structural; the user-visible name + desc come from the localized table at
// render time. Every row paints one line (the name); the description folds open behind the FeatRow info button, so
// nothing stacks into a wall of text. Rows a parent could not read from their names show one short line instead. Every
// install reads them, so none says "rewrite": a free install draws the dot too (starred swearing on a post, a folded
// post) but rewrites nothing. Receipts is a recorder, so its switches are the few a clean record needs. The page parts,
// the break, Block this and the other hiding switches are Off's (storage/switch-scope.ts).
type RowGroup = 'ai' | 'essential';
const featureRows = (t: PopupStrings): { id: FeatureId; name: string; desc: string; group: RowGroup; betaTag?: boolean; shown?: boolean }[] => [
  // AI / paid — rendered only when a license key is stored (see SettingsPanel).
  { id: 'rewritten-comments-first', name: t.featRewriteName, desc: t.featRewriteDesc, group: 'ai', betaTag: true },
  { id: 'block-ads', name: t.featBlockAdsName, desc: t.featBlockAdsDesc, group: 'essential' },
  { id: 'show-reframe-markers', name: t.featMarkersName, desc: t.featMarkersDescFree, group: 'essential', shown: true },
];

/** Receipts' own switch ids that act on a page, for the report email (report-link.ts). */
export const receiptsSwitchIds = (): FeatureId[] => featureRows(POPUP_STRINGS.en).filter(r => r.group !== 'ai').map(r => r.id);

const RULES_CARD_ID = 'set-rules';

/** What Settings starts on: the list with every fold as it was left, or with one fold forced open (a test's way in). */
export type SettingsPage = 'main' | 'general' | 'topics' | 'device';

export function SettingsPanel({
  settings, license, onBack, onChange, isDetached = false, platform: platformProp, openOn = 'main', consent,
}: {
  settings: FWSettings;
  license: LicenseInfo;
  onBack: () => void;
  onChange: () => Promise<void>;
  isDetached?: boolean;
  // The platform of the page the parent is looking at (P9). `null` = not a
  // supported site, `undefined` = unknown. Tests pass it; the popup reads it
  // from the active tab.
  platform?: PlatformId | null;
  /** The fold Settings starts open; the popup starts every fold as the person left it, a test can open one directly. */
  openOn?: SettingsPage;
  /** The reading agreement stored for this key: null when none, undefined until read. The reading card's pill needs it at Silent. */
  consent?: ReadingConsent | null;
}) {
  const t = usePopupT();
  const detectedPlatform = useCurrentPlatform(isDetached);
  const platform = platformProp !== undefined ? platformProp : detectedPlatform;
  const readingOn = useReadingOn(license);

  // Mode switch is a destructive preset re-apply (POP-3): the shared state
  // machine in ./switches asks first when the switch would wipe custom
  // toggles, and demands the PIN when it leaves Child (D6). "Reset to
  // defaults" runs through the same confirm (P23).
  const modeSwitch = useModeSwitch(settings, onChange);
  const [changePinOpen, setChangePinOpen] = useState(false);
  const [setPinOpen, setSetPinOpen] = useState(false);
  const closeSetPin = () => { setSetPinOpen(false); void onChange(); };
  // A snapshot that could not be read says no PIN whether or not one exists, so it keeps Change PIN.
  // The set row stays while open, so a reload after the PIN is stored cannot hide the phrase.
  const offerSetPin = (!settings.parentPin && !parentPinUnknown(settings)) || setPinOpen;
  const modeLabel = (m: Mode) => m === 'child' ? t.modeChild : m === 'teen' ? t.modeTeen : t.modeAdult;
  // The level buttons are one Tab stop. A level can ask for a PIN or a confirm, so the arrow keys only move the focus
  // (no `choose`); Enter or Space on the focused button chooses it.
  const levels: Mode[] = ['child', 'teen', 'adult'];
  const levelKeys = rovingGroup(levels.indexOf(settings.mode));

  // Flips the global bit and clears the per-platform override that would
  // shadow it (P9). The write merges onto a FRESH read inside updateFeature
  // (POP-2), so a concurrent toggle in a second FW window is not clobbered.
  const toggle = async (id: FeatureId) => {
    await flipSwitch(settings, id, platform);
    await onChange();
  };

  // The switch shows the override for the current page when the popup knows
  // the platform, else the global bit (P9).
  const render = (id: FeatureId) => switchIsOn(settings, id, platform);
  // When the platform is unknown and an override exists, say so instead of
  // showing a global bit some page ignores.
  const overrideNote = (id: FeatureId): string | undefined =>
    platform === undefined && overriddenPlatforms(settings, id).length > 0 ? t.featDiffersOnPlatforms : undefined;

  const rows = featureRows(t);
  const [blockAds, reframeMarkers] = rows.filter(r => r.group === 'essential');
  const rules = readParentBlocklist(getFeatureValue(settings, 'parent-blocklist'));
  const ruleCount = rules.words.length + rules.phrases.length + rules.accounts.length;
  // The editor is the tallest thing on the screen, so it stays closed until its row is pressed; that keeps the page
  // inside the 600 px Chrome gives a popup. Opening it brings it into view with the first field focused.
  const [rulesOpen, setRulesOpen] = useState(false);
  useEffect(() => {
    if (!rulesOpen) return;
    const card = document.getElementById(RULES_CARD_ID);
    // A scripted scroll is not covered by the sheet's reduced-motion rule, so it asks the system itself.
    card?.scrollIntoView?.({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    (card?.querySelector('input') as HTMLInputElement | null)?.focus({ preventScroll: true });
  }, [rulesOpen]);
  const jumpToRules = () => setRulesOpen(o => !o);
  const featRow = (r: (typeof rows)[number]) => (
    <div key={r.id}>
      <FeatRow
        name={r.name}
        desc={r.desc}
        shown={r.shown}
        note={overrideNote(r.id)}
        quiet
        control={<Toggle on={render(r.id)} onClick={() => { void toggle(r.id); }} label={r.name} />}
      />
    </div>
  );

  // House-rule swearing gate (`blanketProfanitySoften`, core/pipeline.ts). That gate has no mode branch. A child install
  // softens register profanity because `childPreset` seeds the soften-swearing switch ON, and this switch extends the
  // same rule to teen and adult as an explicit family choice ("no swearing in this house"); the rows below keep it true
  // for Child by locking it. Slurs and detected attacks are acted on regardless.
  // One switch for swearing: "Strict language" and "Mask swearing" were two switches for this one gate, so turning one
  // off left the other starring words. Mask swearing is left; the strictLanguage bit stays in storage because the
  // Strict level and Off write it, so pressing the switch off clears that bit too, or the stars would stay.
  const toggleMask = async () => {
    if (settings.strictLanguage) {
      await saveSettings({ strictLanguage: false });
      if (switchIsOn(settings, 'soften-swearing', platform)) await flipSwitch(settings, 'soften-swearing', platform);
      await onChange();
      return;
    }
    await toggle('soften-swearing');
  };
  const childMode = settings.mode === 'child';

  // The one sentence under the three buttons: what the chosen level shows (the owner's card, 12 Oct 2026). Every
  // sentence speaks of the rephrased or the calm version, which a key pays for, so a free install is told nothing here:
  // no word of the reading reaches an install without a key (9 Oct 2026), and a promise it cannot keep is no help.
  const levelSentence = !readingOn ? null
    : settings.mode === 'child' ? t.levelSentenceChild
    : settings.mode === 'teen' ? t.levelSentenceTeen
    : t.levelSentenceAdult;

  const bar = (title: string, back: () => void) => (
    <div className="settings-bar">
      <button type="button" className="lnk" onClick={back}>
        <ChevronLeft size={14} aria-hidden={true} />
        {t.back}
      </button>
      <div className="title">{title}</div>
    </div>
  );

  const foot = (
    <div className="foot">
      <span>{getFwVersion()}</span>
      <a href="https://feelingwise.org/privacy" target="_blank" rel="noopener noreferrer">{t.privacy}</a>
    </div>
  );

  // Every switch Receipts has, in one fold: ads, swearing, the reframe markers, and the own rules one tap away.
  const generalBody = (
    <>
      <div className="set-essentials" data-must-show="essentials">
        {featRow(blockAds)}
        {/* The swear mask puts stars on vulgar words with no model, so every install gets it. Locked on in Child mode:
            blanketProfanitySoften has no mode branch, so an unlocked row there really would stop the masking the
            level promises. */}
        <FeatRow
          name={t.softenSwearingName}
          desc={t.softenSwearingDesc}
          note={childMode ? t.softenSwearingDescChild : undefined}
          quiet
          noteInFold
          control={(
            <Toggle
              on={childMode || settings.strictLanguage || isFeatureEnabled(settings, 'soften-swearing')}
              disabled={childMode}
              onClick={() => { if (!childMode) void toggleMask(); }}
              label={childMode ? t.softenSwearingAriaChild : t.softenSwearingName}
            />
          )}
        />
        {/* With a key the dot's row is the reading fold's second switch (AiCard); without one it stays here. */}
        {!readingOn && featRow(reframeMarkers)}
        <button type="button" className="set-rules-jump" aria-controls={RULES_CARD_ID} aria-expanded={rulesOpen} onClick={jumpToRules}>
          <span>{t.rulesName}</span>
          <span className="set-rules-n">
            {t.rulesCount(ruleCount)}
            <ChevronRight size={14} className="fw-page-chev" aria-hidden={true} />
          </span>
        </button>
        <div className="fr-desc fr-line set-rules-line">{t.rulesLine}</div>
      </div>
      {/* The user's own word / phrase / account list, opened by the row above. */}
      <div className="set-rules-editor" id={RULES_CARD_ID} hidden={!rulesOpen}>
        <BlocklistEditor settings={settings} onChange={onChange} desc={t.rulesDescOne} />
      </div>
    </>
  );

  const deviceBody = (
    <>
      <div className="set-pin-card">
        {offerSetPin ? (
          <>
            {/* One row named PIN, its action at the right: a header, a name and a link all saying "Set PIN" said it three times. */}
            <FeatRow
              name={t.groupPin}
              desc={t.offPinSetDesc}
              control={(
                <button type="button" className="fw-page-btn quiet" onClick={() => { if (setPinOpen) closeSetPin(); else setSetPinOpen(true); }}>
                  {setPinOpen ? t.cancel : t.offPinSave}
                </button>
              )}
            />
            {setPinOpen && <SetPinPanel commitOnConfirm onDone={closeSetPin} />}
          </>
        ) : (
          <>
            <FeatRow
              name={t.groupPin}
              desc={t.changePinDescOne}
              control={(
                <button type="button" className="fw-page-btn quiet" onClick={() => setChangePinOpen(o => !o)}>
                  {changePinOpen ? t.cancel : t.changePinTitle}
                </button>
              )}
            />
            {changePinOpen && (
              <ChangePinPanel onDone={() => { setChangePinOpen(false); void onChange(); }} />
            )}
          </>
        )}
      </div>

      <div className="set-lang-card">
        {/* The same row shape as the PIN card above it: a name, its line, and the control, the picker under the name
            because its width is its longest option. */}
        <FeatRow
          name={t.uiLangAria}
          desc={t.uiLangDesc}
          shown
          stack
          control={(
            <span className="set-select-wrap">
              <select
                className="set-select"
                value={settings.uiLanguage || 'auto'}
                onChange={(e) => { void (async () => {
                  await saveSettings({ uiLanguage: e.target.value as UiLanguage });
                  await onChange();
                })(); }}
                aria-label={t.uiLangAria}
              >
                <option value="auto">{t.uiLangAuto}</option>
                {UI_LANGUAGES.map(code => (
                  <option key={code} value={code}>{UI_LANGUAGE_LABELS[code]}</option>
                ))}
              </select>
              <ChevronDown size={16} className="set-select-chev" aria-hidden={true} />
            </span>
          )}
        />
      </div>
    </>
  );

  // Which fold a caller asked to start open (a test's way in); the popup passes none and every fold starts as it was left.
  const forced = (fold: 'general' | 'topics' | 'device'): boolean | undefined => openOn === 'main' ? undefined : openOn === fold;

  // Subjects the person does not want in their feed (Topics U1, 13 Oct 2026): one plain row per topic, matched on this
  // computer from a written list, hidden behind a line that says why. Built outside featureRows on purpose: these are the
  // person's own choices, not the recorder's switches, and the report email lists only the recorder's.
  const topicsBody = (
    <>
      <p className="topics-lead">{t.topicsFoldLead}</p>
      <div className="set-topics">
        <FeatRow
          name={t.topicGamblingName}
          desc={t.topicGamblingDesc}
          shown
          note={overrideNote('topic-gambling')}
          quiet
          control={<Toggle on={render('topic-gambling')} onClick={() => { void toggle('topic-gambling'); }} label={t.topicGamblingName} />}
        />
      </div>
    </>
  );

  const resetShown = modeSwitchResetsToggles(settings.features, settings.mode);
  const resetLink = (
    <button type="button" className="lnk" onClick={modeSwitch.requestReset}>{t.modeStateReset}</button>
  );
  return (
    <>
      {bar(t.settingsTitle, onBack)}

      {/* The level leads the page: it seeds every other default (childPreset / teenPreset / adultPreset). Its three named
          buttons say what it is, so it has no header, and the sentence under them says what the chosen one shows. */}
      <div className="pop-card mode-card">
        {/* A value picker (one of child/teen/adult), so radiogroup/radio: a single choice among three named options. */}
        <div className="mode-segmented" role="radiogroup" aria-label={t.modeRowName} aria-describedby={levelSentence !== null ? 'fw-level-sentence' : undefined} onKeyDown={levelKeys.onKeyDown}>
          {levels.map((m, i) => {
            const active = settings.mode === m;
            return (
              <button
                key={m}
                role="radio"
                aria-checked={active}
                tabIndex={levelKeys.tabIndexOf(i)}
                className={`mode-seg-btn ${active ? 'active' : ''}`}
                // A switch that would wipe custom toggles routes through a confirm (POP-3); a no-op switch applies
                // silently. The clean-slate preset apply itself is unchanged.
                onClick={() => modeSwitch.onModeClick(m)}
              >
                <span className="mode-seg-name">{m === 'child' ? t.modeSegChild : m === 'teen' ? t.modeSegTeen : t.modeSegAdult}</span>
              </button>
            );
          })}
        </div>

        {/* Inline confirm, only when the pending switch would reset the parent's custom toggles. Names the target mode
            and what resets in plain words. Cancel leaves everything untouched. */}
        {modeSwitch.pendingMode && (
          <div className="mode-confirm" role="alertdialog" aria-label={modeSwitch.pendingIsReset ? t.modeStateReset : t.modeSwitchConfirmYes} style={{
            marginTop: 8, padding: '10px 12px', borderRadius: 'var(--fw-r-md)',
            background: 'rgba(255,171,64,0.10)', border: '1px solid rgba(255,171,64,0.45)',
            fontSize: 12, lineHeight: 1.5, color: 'var(--fw-text)',
          }}>
            <div>
              {modeSwitch.pendingIsReset
                ? t.modeResetConfirmBody(modeLabel(modeSwitch.pendingMode))
                : t.modeSwitchConfirmBody(modeLabel(modeSwitch.pendingMode))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              {/* The same question serves a reset of the current level, where nothing switches: its yes says only Reset. */}
              <button className="iconbtn" style={{ color: 'var(--fw-red)' }} onClick={modeSwitch.confirmPending}>{modeSwitch.pendingIsReset ? t.modeStateReset : t.modeSwitchConfirmYes}</button>
              <button className="iconbtn" onClick={modeSwitch.cancelPending}>{t.cancel}</button>
            </div>
          </div>
        )}

        {modeSwitch.pinForMode !== null && (
          <PinOverlay
            onSuccess={modeSwitch.onPinSuccess}
            onCancel={modeSwitch.onPinCancel}
          />
        )}

        {/* Only when the switches differ from the level's defaults: a PIN-free way back to them. It ends the sentence's
            last line rather than taking a row of its own (30 px, which ran the page past the popup; 13 Oct 2026); the
            group is described by the sentence's own words, not the link. */}
        {levelSentence !== null && (
          <p className="level-sentence">
            <span id="fw-level-sentence">{levelSentence}</span>
            {resetShown && <>{' '}<span className="mode-state">{resetLink}</span></>}
          </p>
        )}
        {levelSentence === null && resetShown && <div className="mode-state">{resetLink}</div>}
      </div>

      {/* The three folds, one under the other: the reading (with a key), the everyday switches, then the PIN and the
          language. Closed, each is a pill; open, each is a card, and the chevron at its right closes it again. With a
          key the reading leads, since it is what the key bought (his word, 12 Oct 2026); without one it is not drawn
          and General leads. */}
      <AiCard
        settings={settings}
        license={license}
        platform={platform}
        rows={rows.filter(r => r.group === 'ai')}
        render={render}
        toggle={toggle}
        overrideNote={overrideNote}
        onChange={onChange}
        consent={consent}
        forceOpen={openOn === 'main' ? undefined : false}
      />

      <Fold name="general" bodyId="fw-fold-general" storageKey={FOLD_KEYS.general} defaultOpen={FOLD_DEFAULT_OPEN.general} forceOpen={forced('general')} title={t.setGeneralTitle}>
        {generalBody}
      </Fold>

      <Fold name="topics" bodyId="fw-fold-topics" storageKey={FOLD_KEYS.topics} defaultOpen={FOLD_DEFAULT_OPEN.topics} forceOpen={forced('topics')} title={t.topicsFoldName}>
        {topicsBody}
      </Fold>

      <Fold name="device" bodyId="fw-fold-device" storageKey={FOLD_KEYS.device} defaultOpen={FOLD_DEFAULT_OPEN.device} forceOpen={forced('device')} title={t.setDeviceTitle}>
        {deviceBody}
      </Fold>

      {foot}
    </>
  );
}
