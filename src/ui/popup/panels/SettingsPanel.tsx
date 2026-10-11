// The settings screen behind the PIN: every feature row, the presets, and the language picker.
//
// Cut out of src/ui/popup/Popup.tsx on 2026-09-16 (PLAN-2026-09-16 item 10.3), which was 1,871
// lines holding every panel at once. Popup.tsx re-exports the names it exported before.

import { readParentBlocklist } from '../../../core/parent-blocklist';
import { UI_LANGUAGES, UI_LANGUAGE_LABELS, type UiLanguage } from '../../../i18n';
import { POPUP_STRINGS, type PopupStrings } from '../../../i18n/popup-strings';
import { usePopupT } from '../../../i18n/react';
import { LicenseInfo } from '../../../storage/license';
import { FWSettings, FeatureId, type PlatformId, getFeatureValue, isFeatureEnabled, parentPinUnknown, saveSettings } from '../../../storage/settings';
import { Mode, levelMakesNoCalls } from '../../../types/mode';
import { BlocklistEditor } from '../BlocklistEditor';
import { AiCard } from './ai/AiCard';
import { ChangePinPanel, FeatRow, PinOverlay, SetPinPanel, Toggle } from '../controls';
import { getFwVersion } from '../fw-version';
import { flipSwitch, modeSwitchResetsToggles, overriddenPlatforms, switchIsOn, useCurrentPlatform, useModeSwitch } from '../switches';
import { useEffect, useState } from 'react';

// ─── Settings panel (PIN-gated) ───
// Row metadata (id / grouping / beta tag) is structural; the user-visible
// name + desc come from the localized table at render time.
// Q86: every row paints one line (the name); the description folds open
// behind the FeatRow info button, so nothing stacks into a wall of text. Rows a parent could not read from their
// names (the parent scout, 9 Oct 2026) show one short line instead: Strict language, the reframe markers and the own
// rules. Every install reads them, so none says "rewrite": a free install draws the dot too (starred swearing on a
// post, a folded post) but rewrites nothing.
// Receipts is a recorder, so its switches are the few a clean record needs, all on the first card. The
// page parts, the break, Block this and the other hiding switches are Off's (storage/switch-scope.ts).
type RowGroup = 'ai' | 'essential';
const featureRows = (t: PopupStrings): { id: FeatureId; name: string; desc: string; group: RowGroup; betaTag?: boolean; shown?: boolean }[] => [
  // AI / paid — rendered only when a license key is stored (see SettingsPanel).
  { id: 'rewritten-comments-first', name: t.featRewriteName, desc: t.featRewriteDesc, group: 'ai', betaTag: true },
  { id: 'block-ads', name: t.featBlockAdsName, desc: t.featBlockAdsDesc, group: 'essential' },
  { id: 'show-reframe-markers', name: t.featMarkersName, desc: t.featMarkersDesc, group: 'essential', shown: true },
];

/** Receipts' own switch ids that act on a page, for the report email (report-link.ts). */
export const receiptsSwitchIds = (): FeatureId[] => featureRows(POPUP_STRINGS.en).filter(r => r.group !== 'ai').map(r => r.id);

const RULES_CARD_ID = 'set-rules';

export function SettingsPanel({
  settings, license, onBack, onChange, isDetached = false, platform: platformProp,
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
}) {
  const t = usePopupT();
  const detectedPlatform = useCurrentPlatform(isDetached);
  const platform = platformProp !== undefined ? platformProp : detectedPlatform;

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
  // The editor is the tallest thing on the screen, so it stays closed until its row is pressed; that keeps
  // Settings inside the 600 px Chrome gives a popup. Opening it brings it into view with the first field focused.
  const [rulesOpen, setRulesOpen] = useState(false);
  useEffect(() => {
    if (!rulesOpen) return;
    const card = document.getElementById(RULES_CARD_ID);
    card?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
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

  // House-rule swearing gate (`blanketProfanitySoften`, core/pipeline.ts).
  // That gate has no mode branch. A child install softens register profanity
  // because `childPreset` seeds the soften-swearing switch ON, and this switch
  // extends the same rule to teen and adult as an explicit family choice ("no
  // swearing in this house"). Saying "Child mode always" here, as this comment
  // did until 2026-09-19, described a rail that does not exist; the rows below
  // keep it true for Child by locking both of them. Slurs and detected attacks
  // are acted on regardless.
  // One switch for swearing (11 Oct 2026). "Strict language" and "Mask swearing" were two switches for this one gate,
  // so turning one off left the other starring words. Mask swearing is left; the strictLanguage bit stays in storage
  // because the Strict level and Off write it, so pressing the switch off clears that bit too, or the stars would stay.
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

  return (
    <>
      <div className="settings-bar">
        <button className="lnk" onClick={onBack} style={{ textDecoration: 'none' }}>{t.back}</button>
        <div className="title">{t.settingsTitle}</div>
        {/* Style and theme left the bar for Home's bottom row (his word, 9 Oct 2026). */}
      </div>

      {/* Mode leads the panel — it seeds every other default (childPreset /
          teenPreset / adultPreset), so it's the first choice, not the last
          (declutter pass, 2026-06-20). Its three named buttons say what it is, so it has no header:
          the card fits the 600 px popup without it. */}
      <div className="pop-card mode-card">
        {/* This is a value picker (one of child/teen/adult, not a set of
            panels to switch between), so role="tablist"/"tab" had it
            backwards: the REAL tab bar in header.tsx had none of these
            roles, and this non-tab control had them with no tabpanel and
            nothing shown or hidden by them (accessibility audit,
            2026-09-18). radiogroup/radio matches what this control actually
            is: a single choice among three named options. */}
        <div className="mode-segmented" role="radiogroup" aria-label={t.modeRowName}>
          {(['child', 'teen', 'adult'] as Mode[]).map(m => {
            const active = settings.mode === m;
            return (
              <button
                key={m}
                role="radio"
                aria-checked={active}
                className={`mode-seg-btn ${active ? 'active' : ''}`}
                // A switch that would wipe custom toggles routes through a
                // confirm (POP-3); a no-op switch applies silently. The
                // clean-slate preset apply itself is unchanged.
                onClick={() => modeSwitch.onModeClick(m)}
              >
                <span className="mode-seg-name">{m === 'child' ? t.modeSegChild : m === 'teen' ? t.modeSegTeen : t.modeSegAdult}</span>
              </button>
            );
          })}
        </div>

        {/* Inline confirm — only shown when the pending switch would reset the
            parent's custom toggles. Names the target mode and what resets in
            plain words. Cancel leaves everything untouched. */}
        {modeSwitch.pendingMode && (
          <div className="mode-confirm" role="alertdialog" aria-label={t.modeSwitchConfirmYes} style={{
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
              <button className="iconbtn" style={{ color: 'var(--fw-red)' }} onClick={modeSwitch.confirmPending}>{t.modeSwitchConfirmYes}</button>
              <button className="iconbtn" onClick={modeSwitch.cancelPending}>{t.cancelLower}</button>
            </div>
          </div>
        )}

        {modeSwitch.pinForMode !== null && (
          <PinOverlay
            onSuccess={modeSwitch.onPinSuccess}
            onCancel={modeSwitch.onPinCancel}
          />
        )}

        {/* The line about the switch state shows only when the switches differ from the level's
            defaults, with a PIN-free way back to them; the box below already names the level. */}
        {modeSwitchResetsToggles(settings.features, settings.mode) && (
          <div className="mode-state">
            <span>{t.modeStateCustomized(modeLabel(settings.mode))}</span>
            <button type="button" className="lnk" onClick={modeSwitch.requestReset}>
              {t.modeStateReset}
            </button>
          </div>
        )}

        {/* Exactly one explanation renders, and it has always been the one for
            settings.mode. What it never did was say so. A parent reading this
            card saw "Standard Child protection." on the line above and
            "Maximum protection. Everything on: ..." here, two sentences about
            the same mode with only one of them naming it, and pressing TEEN or
            ADULT changed neither, because leaving Child asks for the PIN first
            and the card still, correctly, describes the mode the install is
            actually in. Naming the mode is what was missing (parent install
            read, 18 Sep 2026). */}
        <div className="mode-explain">
          <strong>{t.modeExplainPrefix(modeLabel(settings.mode))}</strong>{' '}
          {settings.mode === 'child' ? t.modeExplainChildBody : settings.mode === 'teen' ? t.modeExplainTeenBody : t.modeExplainAdultBody}
        </div>
      </div>

      {/* With a key, the reading's drawer comes first after the level, so the rows a key adds are seen. */}
      <AiCard
        settings={settings}
        license={license}
        platform={platform}
        rows={rows.filter(r => r.group === 'ai')}
        render={render}
        toggle={toggle}
        overrideNote={overrideNote}
        onChange={onChange}
      />

      {/* Every switch Receipts has, on the first screen without scrolling: ads, swearing and slurs,
          the reframe markers, and the own rules one tap away. */}
      <div className="grp-hdr">{t.setEssentialsTitle}</div>
      <div className="pop-card set-essentials" style={{ marginTop: 0 }} data-must-show="essentials">
        {featRow(blockAds)}
        {/* The swear mask puts stars on vulgar words with no model, so every install gets it. Locked on in Child mode:
            blanketProfanitySoften has no mode branch, so an unlocked row there really would stop the masking the
            level promises. */}
        <FeatRow
          name={t.softenSwearingName}
          desc={t.softenSwearingDesc}
          note={childMode ? t.softenSwearingDescChild : undefined}
          quiet
          control={(
            <Toggle
              on={childMode || settings.strictLanguage || isFeatureEnabled(settings, 'soften-swearing')}
              disabled={childMode}
              onClick={() => { if (!childMode) void toggleMask(); }}
              label={childMode ? t.softenSwearingAriaChild : t.softenSwearingName}
            />
          )}
        />
        {featRow(reframeMarkers)}
        <button type="button" className="set-rules-jump" aria-controls={RULES_CARD_ID} aria-expanded={rulesOpen} onClick={jumpToRules}>
          <span>{t.rulesName}</span>
          <span className="set-rules-n">{t.rulesCount(ruleCount)} ›</span>
        </button>
        <div className="fr-desc fr-line set-rules-line">{t.rulesLine}</div>
      </div>

      {/* The user's own word / phrase / account list, opened by the essentials card's row. */}
      <div className="pop-card" id={RULES_CARD_ID} hidden={!rulesOpen}>
        <BlocklistEditor settings={settings} onChange={onChange} desc={t.rulesDescOne} />
      </div>

      {/* PIN and language are two rows of their own, not one group (the owner asked for them apart). */}
      <div className="pop-card set-pin-card">
        {offerSetPin ? (
          <>
            {/* One row named PIN, its action at the right: a header, a name and a link all saying "Set PIN" said it three times. */}
            <FeatRow
              name={t.groupPin}
              desc={t.offPinSetDesc}
              control={(
                <button type="button" className="lnk" onClick={() => { if (setPinOpen) closeSetPin(); else setSetPinOpen(true); }}>
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
                <button type="button" className="lnk" onClick={() => setChangePinOpen(o => !o)}>
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

      <div className="grp-hdr">{t.uiLangAria}</div>
      <div className="pop-card" style={{ marginTop: 0 }}>
        {/* The header names the language, and the picker shows the one in use, so it has no label of its own. What a
            change does to open pages is said under it, in words a keyboard or touch user reaches too. */}
        <div className="feat-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 0 }}>
          <div className="set-more-row">
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
          </div>
          <div className="fr-desc">{t.uiLangDesc}</div>
        </div>
      </div>

      <div className="foot">
        <span>{getFwVersion()}</span>
        <a href="https://feelingwise.org/privacy" target="_blank" rel="noopener noreferrer">{t.privacy}</a>
      </div>
    </>
  );
}
