// Off: the popup. The first screen says what Off is doing, site by site, and
// where the setup guide is; everything else is folded below it: the switches
// (each with how many times it fired on this profile), the user's own rules,
// "block this", a pause per platform, an optional PIN, and the interface
// language. It asks nothing about who is using the browser.
//
// It shares the settings store, the presets, the strings, the CSS and the
// control components with the Feedprint popup; it carries none of the
// licence, AI, dashboard or record surfaces, because Off has none.

import '../../../ui/shared/tokens.css';
import '../../../ui/popup/popup-design.css';
import './off-popup.css';
import '../../../ui/popup/popup-life.css';
import { applyPopupLife } from '../../../ui/popup/life';
import { StrictMode, useCallback, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  type FWSettings, type FeatureId, getSettings, saveSettings, updateFeature,
  isFeatureEnabled, isPinGraceActive, parentPinUnknown, readPinEvidence, notePinWasSet,
} from '../../../storage/settings';
import { eagerApplyStoredTheme, applyTheme, subscribeToSystemThemeChanges } from '../../../ui/shared/theme';
import { applyLook, eagerApplyStoredLook } from '../../../ui/shared/looks';
import type { Platform } from '../../../types/post';
import { Toggle, FeatRow, PinOverlay, ChangePinPanel, RemovePinPanel, SetPinPanel } from '../../../ui/popup/controls';
import { modeSwitchRequiresPin } from '../../../ui/popup/switches';
import { BlocklistEditor } from '../../../ui/popup/BlocklistEditor';
import { BlockAiHashtagEditor } from '../../../ui/popup/BlockAiHashtagEditor';
import { PickCard } from '../../../ui/popup/PickCard';
import { DescribePage } from '../../../ui/popup/DescribePage';
import { QuietHoursEditor } from '../../../ui/popup/QuietHoursEditor';
import { UpdateNoticeLine, useUpdateNotice } from '../../../ui/popup/UpdateNotice';
import { resolveUiLanguage, UI_LANGUAGES, UI_LANGUAGE_LABELS, type UiLanguage } from '../../../i18n';
import { POPUP_STRINGS, type PopupStrings } from '../../../i18n/popup-strings';
import type { OffWhatId } from '../../../i18n/popup/types';
import { I18nProvider, usePopupT, useUiLanguage } from '../../../i18n/react';
import { offPrivacyUrl, sitePageUrl } from '../../../core/site-links';
import { OFF_SITES, SWITCH_REACH, pageOf, reportMailto, switchesOnFor as switchesOnAt, type PageKind } from '../../../ui/popup/report-link';

eagerApplyStoredTheme();
eagerApplyStoredLook();

function getVersion(): string {
  try {
    const v = chrome?.runtime?.getManifest?.()?.version;
    return v ? `v${v}` : '';
  } catch {
    return '';
  }
}

// `fired` words the per-switch tally: most switches hide, the emoji switch
// cleans text. The keys are the ones mark-hidden.ts tallies under.
type SwitchId = FeatureId & OffWhatId;

const SWITCHES = (t: PopupStrings): { id: SwitchId; name: string; desc: string; fired: (n: number) => string; noNote?: boolean }[] => [
  { id: 'block-reels', name: t.featBlockReelsName, desc: t.featBlockReelsDesc, fired: t.offFiredHidden },
  { id: 'hide-stories', name: t.featHideStoriesName, desc: t.featHideStoriesDesc, fired: t.offFiredHidden },
  { id: 'hide-suggestions', name: t.featHideSuggestionsName, desc: t.featHideSuggestionsDesc, fired: t.offFiredHidden },
  { id: 'hide-right-column', name: t.featHideRightColumnName, desc: t.featHideRightColumnDesc, fired: t.offFiredHidden },
  { id: 'hide-marketplace', name: t.featHideMarketplaceName, desc: t.featHideMarketplaceDesc, fired: t.offFiredHidden },
  { id: 'hide-groups', name: t.featHideGroupsName, desc: t.featHideGroupsDesc, fired: t.offFiredHidden },
  { id: 'hide-home-feed', name: t.featHideHomeFeedName, desc: t.featHideHomeFeedDesc, fired: t.offFiredHidden },
  { id: 'hide-recommended-videos', name: t.featHideRecommendedName, desc: t.featHideRecommendedDesc, fired: t.offFiredHidden },
  { id: 'hide-engagement-metrics', name: t.featHideMetricsName, desc: t.featHideMetricsDesc, fired: t.offFiredHidden },
  { id: 'hide-action-buttons', name: t.featHideActionsName, desc: t.featHideActionsDesc, fired: t.offFiredHidden },
  { id: 'block-comment-posting', name: t.featBlockPostingName, desc: t.featBlockPostingDesc, fired: t.offFiredHidden, noNote: true },
  { id: 'strip-emojis', name: t.featStripEmojisName, desc: t.featStripEmojisDesc, fired: t.offFiredCleaned },
  { id: 'block-ai-content', name: t.featBlockAiName, desc: t.featBlockAiDesc, fired: t.offFiredHidden },
  { id: 'block-ads', name: t.featBlockAdsName, desc: t.offBlockAdsDesc, fired: t.offFiredHidden },
];

/** The switch ids in popup order, for the test that holds each one's reach to the content code. */
export const offSwitchIds = (): SwitchId[] => SWITCHES(POPUP_STRINGS.en).map(r => r.id);

export { OFF_SITES, SWITCH_REACH };

/** Off's switches that act on `site` and are on there, for the report email (report-link.ts). */
export const switchesOnFor = (settings: FWSettings, site: Platform | null): string[] => switchesOnAt(settings, site, offSwitchIds());

/** The site and kind of the page in front, read once when the popup opens; its address is not kept. */
/** The tab in front, for the page description (the popup asks that tab's page for it). */
async function frontTabId(): Promise<number | undefined> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0]?.id;
  } catch {
    return undefined;
  }
}

function usePageInFront(): { site: Platform | null; kind: PageKind | null } {
  const [page, setPage] = useState<{ site: Platform | null; kind: PageKind | null }>({ site: null, kind: null });
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.tabs?.query) return;
    let cancelled = false;
    chrome.tabs.query({ active: true, currentWindow: true })
      .then((tabs) => { if (!cancelled) setPage(pageOf(tabs[0]?.url)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return page;
}

const siteLabel = (p: Platform): string => PLATFORMS.find(x => x.id === p)?.label ?? p;

/**
 * The first screen's status, true site by site: what runs on all five sites in one sentence, then
 * each switch that reaches fewer, with the sites it reaches. A switch never claims a site it does
 * not act on. Slurs are always named, because that rule has no switch and never turns off. A site on
 * break is named first, since its whole tab is covered whatever the switches say.
 */
export function offStatus(settings: FWSettings, t: PopupStrings): string {
  const everywhere: string[] = [];
  const some: string[] = [];
  for (const r of SWITCHES(t)) {
    const on = (SWITCH_REACH[r.id] ?? OFF_SITES).filter(p => isFeatureEnabled(settings, r.id, p));
    if (on.length === 0) continue;
    if (on.length === OFF_SITES.length) everywhere.push(t.offWhat[r.id]);
    else some.push(t.offOnSites(t.offWhat[r.id], on.map(siteLabel)));
  }
  // Slurs go last, so "hiding slurs, like counts" never reads as slurs being an example.
  everywhere.push(t.offWhat.slurs);
  const swearing = settings.mode === 'child' || settings.strictLanguage === true;
  const first = t.offStatusAll(swearing, everywhere, OFF_SITES.map(siteLabel));
  const status = some.length > 0 ? `${first} ${t.offStatusAlso(some)}` : first;
  const onBreak = OFF_SITES.filter(p => isFeatureEnabled(settings, 'media-timeout', p)).map(siteLabel);
  return onBreak.length > 0 ? `${t.offStatusBreak(onBreak)} ${status}` : status;
}

/** About one line of the status card at its 14px type; past it the sentence wraps. */
export const STATUS_LINE_CHARS = 48;

/**
 * The status in one line: as many of the things hidden on every site as fit by name, the rest counted. The
 * whole sentence (offStatus) stays on the line as its title. A site on break outweighs everything else.
 */
export function offStatusLine(settings: FWSettings, t: PopupStrings): string {
  const onBreak = OFF_SITES.filter(p => isFeatureEnabled(settings, 'media-timeout', p)).map(siteLabel);
  if (onBreak.length === OFF_SITES.length) return t.offStatusBreakAll;
  if (onBreak.length > 0) return t.offStatusBreakLine(onBreak);
  const everywhere: string[] = [];
  let some = 0;
  for (const r of SWITCHES(t)) {
    const on = (SWITCH_REACH[r.id] ?? OFF_SITES).filter(p => isFeatureEnabled(settings, r.id, p));
    if (on.length === OFF_SITES.length) everywhere.push(t.offWhat[r.id]);
    else if (on.length > 0) some += 1;
  }
  // The line counts switches, as the fold below does ("4 of 15 switches on"); the slur rule has no switch, so it is
  // named only when it is all Off hides. The whole sentence in the title names it always.
  if (everywhere.length + some === 0) everywhere.push(t.offWhat.slurs);
  const swearing = settings.mode === 'child' || settings.strictLanguage === true;
  const total = everywhere.length + some;
  // Names go in while the line still fits; a switch that reaches only some sites, or a name too long for the
  // line, is counted instead.
  let line = t.offStatusLine(swearing, [], total);
  for (let k = 1; k <= everywhere.length; k++) {
    const next = t.offStatusLine(swearing, everywhere.slice(0, k), total - k);
    if (next.length > STATUS_LINE_CHARS) break;
    line = next;
  }
  return line;
}

/** A section below the first screen: closed until opened, and nothing about it is stored. */
function Fold({ title, count, children }: { title: string; count?: string; children: ReactNode }) {
  return (
    <details className="off-fold">
      <summary className="grp-hdr">
        <span>{title}</span>
        {count && <span className="off-fold-n">{count}</span>}
      </summary>
      {children}
    </details>
  );
}

// Built from UI_LANGUAGES so a language added to the roster appears in both
// products' pickers at once; the endonyms are never translated.
const LANGUAGES: { value: UiLanguage; label: (t: PopupStrings) => string }[] = [
  { value: 'auto', label: t => t.uiLangAuto },
  ...UI_LANGUAGES.map(code => ({
    value: code as UiLanguage,
    label: () => UI_LANGUAGE_LABELS[code],
  })),
];

const PLATFORMS: { id: Platform; label: string }[] = [
  { id: 'tiktok', label: 'TikTok' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'twitter', label: 'X' },
  { id: 'youtube', label: 'YouTube' },
];

// The first PIN goes through the same panel Settings uses, so it ends on the recovery phrase card and
// the person confirms they have kept it. OffBody holds whether the panel is open, so the row outlives
// the reload that follows any switch flip and the card stays until it is confirmed. The toggle goes
// while the phrase shows, since closing then would hide a phrase nobody has read.
function SetPinCard({ open, phraseShowing, onToggle, onPhraseShown, onDone }: {
  open: boolean; phraseShowing: boolean; onToggle: () => void; onPhraseShown: () => void; onDone: () => void;
}) {
  const t = usePopupT();
  return (
    <>
      <FeatRow
        name={t.offPinSetName}
        desc={t.offPinSetDesc}
        control={phraseShowing ? undefined : (
          <button type="button" className="fw-page-btn" onClick={onToggle}>
            {open ? t.cancel : t.offPinSave}
          </button>
        )}
      />
      {open && <SetPinPanel commitOnConfirm onDone={onDone} onPhraseShown={onPhraseShown} />}
    </>
  );
}

// A platform with this many posts judged and no ad found is one where the
// label moved: Facebook serves an ad about every fourth feed unit.
const ADS_BLIND_AFTER = 80;


/** Off's two looks in its footer (13 Oct 2026): A, the crimson frame with teal controls; B, a quiet frame with the mark's
 *  crimson as the one accent (off-popup.css). A radio group: the arrow keys move the choice and the focus with it. */
function OffLooks({ settings }: { settings: FWSettings }) {
  const t = usePopupT();
  const [look, setLook] = useState<'a' | 'b'>(settings.popupLook === 'b' ? 'b' : 'a');
  const pick = (l: 'a' | 'b') => { applyLook(l); setLook(l); void saveSettings({ popupLook: l }); };
  return (
    <span className="look-row" role="radiogroup" aria-label={t.offLookAria} onKeyDown={(e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const next = look === 'a' ? 'b' : 'a';
      pick(next);
      e.currentTarget.querySelector<HTMLElement>(`[data-look="${next}"]`)?.focus();
    }}>
      {(['a', 'b'] as const).map((l) => (
        <button key={l} type="button" role="radio" data-look={l} aria-checked={look === l} tabIndex={look === l ? 0 : -1}
          aria-label={l === 'a' ? t.offLookA : t.offLookB} title={l === 'a' ? t.offLookA : t.offLookB} className="look-btn" onClick={() => pick(l)}>
          <span className={`look-swatch ${l}`} aria-hidden={true} />
        </button>
      ))}
    </span>
  );
}

export function OffBody({ settings, reload }: { settings: FWSettings; reload: () => Promise<void> }) {
  const t = usePopupT();
  const uiLang = useUiLanguage();
  const setupUrl = sitePageUrl(uiLang, 'off-setup');
  const pageInFront = usePageInFront();
  const [changePinOpen, setChangePinOpen] = useState(false);
  const [removePinOpen, setRemovePinOpen] = useState(false);
  const [setPinOpen, setSetPinOpen] = useState(false);
  const [phraseShowing, setPhraseShowing] = useState(false);
  const closeSetPin = () => { setSetPinOpen(false); setPhraseShowing(false); void reload(); };
  // Kept while open, so the reload after the PIN is stored cannot swap the row for Change PIN and take the phrase with it.
  const offerSetPin = !settings.parentPin || setPinOpen;
  const fired = (key: string): number => settings.hiddenByFeature?.[key] ?? 0;
  const adsBlindLines = PLATFORMS
    .filter(p => fired(`ads-judged:${p.id}`) >= ADS_BLIND_AFTER && fired(`ads-found:${p.id}`) === 0)
    .map(p => t.offAdsBlind(p.label, fired(`ads-judged:${p.id}`)));
  // The line under a switch: how often it acted, once it has and while it is on; the ad rule's
  // "no ad found" warning always. A zero is not worth a line, and Block comment posting hides nothing countable.
  const switchNote = (r: { id: SwitchId; fired: (n: number) => string; noNote?: boolean }): string | undefined => {
    const n = fired(r.id);
    const count = isFeatureEnabled(settings, r.id) && !r.noNote && n > 0 ? r.fired(n) : '';
    const blind = r.id === 'block-ads' ? adsBlindLines.join(' ') : '';
    return [count, blind].filter(Boolean).join(' ') || undefined;
  };

  const toggle = async (id: FeatureId) => {
    const next = !(settings.features?.[id]?.enabled);
    await updateFeature(id, cur => ({ ...cur, enabled: next }));
    await reload();
  };
  const togglePlatformPause = async (platform: Platform) => {
    const next = !isFeatureEnabled(settings, 'media-timeout', platform);
    await updateFeature('media-timeout', cur => ({
      ...cur,
      perPlatform: {
        ...(cur.perPlatform ?? {}),
        [platform]: { ...(cur.perPlatform?.[platform] ?? {}), enabled: next },
      },
    }));
    await reload();
  };
  // On an install saved as Child, swearing is on because of the mode, and this switch is the one
  // way out of Child left in this popup. Turning it off moves the install to Adult with swearing
  // off and leaves every other switch as it is; leaving Child asks for the PIN when one is set,
  // the same rule the recorder's level buttons follow.
  const [pinBeforeLeavingChild, setPinBeforeLeavingChild] = useState(false);
  const leaveChildWithSwearingOff = async () => {
    await saveSettings({ mode: 'adult', strictLanguage: false });
    await reload();
  };
  const toggleNoSwearing = async () => {
    if (settings.mode === 'child') {
      if (modeSwitchRequiresPin(settings, 'adult')) { setPinBeforeLeavingChild(true); return; }
      await leaveChildWithSwearingOff();
      return;
    }
    await saveSettings({ strictLanguage: !settings.strictLanguage });
    await reload();
  };
  const pickLanguage = async (value: UiLanguage) => {
    await saveSettings({ uiLanguage: value });
    await reload();
  };

  const childMode = settings.mode === 'child';
  // Things taken off the page: every hide tally, not the emoji switch's cleaned texts or the starred words.
  const hiddenSoFar = [...SWITCHES(t).filter(r => r.fired === t.offFiredHidden).map(r => r.id), 'picker', 'word-filter', 'slurs']
    .reduce((sum, key) => sum + fired(key), 0);
  const switchesOn = (childMode || settings.strictLanguage ? 1 : 0)
    + SWITCHES(t).filter(r => isFeatureEnabled(settings, r.id)).length;

  return (
    <>
      {pinBeforeLeavingChild && (
        <PinOverlay
          onSuccess={() => { setPinBeforeLeavingChild(false); void leaveChildWithSwearingOff(); }}
          onCancel={() => setPinBeforeLeavingChild(false)}
        />
      )}
      <div className="pop-card off-status-card">
        <p className="off-status" title={offStatus(settings, t)}>{offStatusLine(settings, t)}</p>
        <p className="off-hidden">{t.offStatusHidden(hiddenSoFar)}</p>
        {/* Pinning the icon and reloading an open site are read once, so they wait in a fold under the guide's own
            name and the card opens on what Off is doing. */}
        <details className="off-card-fold">
          <summary className="grp-hdr"><span>{t.offHelpLink}</span></summary>
          <p className="off-help">{t.offStartPin}</p>
          <p className="off-help">
            {t.offHelpLead}{' '}
            <a href={setupUrl} target="_blank" rel="noopener noreferrer">{t.offHelpLink}</a>
          </p>
        </details>
        <p className="off-help">
          {t.offReportLead}{' '}
          <a
            href={reportMailto({
              ...pageInFront, version: getVersion().replace(/^v/, '') || '?', switchesOn: switchesOnFor(settings, pageInFront.site),
            }, t)}
            target="_blank" rel="noopener noreferrer"
          >{t.offReportLink}</a>
        </p>
        <DescribePage tabId={frontTabId} />
      </div>

      <Fold title={t.offGroupSwitches} count={t.offSwitchesOn(switchesOn, SWITCHES(t).length + 1)}>
      <div className="pop-card" style={{ marginTop: 0 }}>
        <FeatRow
          name={t.offNoSwearingName}
          desc={t.offNoSwearingDesc}
          note={`${childMode || settings.strictLanguage ? t.offSlursNoteOn : t.offSlursNote}${(childMode || settings.strictLanguage) && fired('no-swearing') > 0 ? ` ${t.offFiredStarred(fired('no-swearing'))}` : ''}`}
          control={(
            <Toggle
              on={childMode || settings.strictLanguage}
              onClick={() => { void toggleNoSwearing(); }}
              label={t.offNoSwearingName}
            />
          )}
        />
        {SWITCHES(t).map(r => (
          <div key={r.id}>
            <FeatRow
              name={r.name}
              desc={r.desc}
              note={switchNote(r)}
              control={<Toggle on={isFeatureEnabled(settings, r.id)} onClick={() => { void toggle(r.id); }} label={r.name} />}
            />
            {/* The switch hides by this list; it is edited here, under the switch, while the switch is on. */}
            {r.id === 'block-ai-content' && isFeatureEnabled(settings, r.id) && (
              <BlockAiHashtagEditor settings={settings} onChange={reload} />
            )}
          </div>
        ))}
      </div>
      </Fold>

      <Fold title={t.rulesName}>
      <div className="pop-card" style={{ marginTop: 0 }}>
        <div className="fr-desc" style={{ marginBottom: 8 }}>{t.offRulesFired(fired('word-filter'), fired('slurs'))}</div>
        <BlocklistEditor settings={settings} onChange={reload} />
      </div>
      </Fold>

      <Fold title={t.offPickName}>
        <PickCard settings={settings} reload={reload} />
      </Fold>

      <Fold title={t.groupBreak}>
      <div className="pop-card" style={{ marginTop: 0 }}>
        {PLATFORMS.map(p => (
          <FeatRow
            key={p.id}
            name={t.breakName(p.label)}
            desc={t.breakDesc(p.label)}
            control={(
              <Toggle
                on={isFeatureEnabled(settings, 'media-timeout', p.id)}
                onClick={() => { void togglePlatformPause(p.id); }}
                label={t.breakName(p.label)}
              />
            )}
          />
        ))}
        <QuietHoursEditor settings={settings} onChanged={reload} />
      </div>
      </Fold>

      <Fold title={t.offGroupPin}>
      <div className="pop-card" style={{ marginTop: 0 }}>
        {!offerSetPin ? (
          <>
            <FeatRow
              name={t.changePinTitle}
              desc={t.changePinDesc}
              note={t.offPinLockedNote}
              control={(
                <button type="button" className="fw-page-btn" onClick={() => setChangePinOpen(o => !o)}>
                  {changePinOpen ? t.cancel : t.changePinTitle}
                </button>
              )}
            />
            {changePinOpen && <ChangePinPanel onDone={() => { setChangePinOpen(false); void reload(); }} />}
            <FeatRow
              name={t.offPinRemoveName}
              desc={t.offPinRemoveDesc}
              control={(
                <button type="button" className="fw-page-btn" onClick={() => setRemovePinOpen(o => !o)}>
                  {removePinOpen ? t.cancel : t.offPinRemoveName}
                </button>
              )}
            />
            {removePinOpen && <RemovePinPanel onDone={() => { setRemovePinOpen(false); void reload(); }} />}
          </>
        ) : (
          <SetPinCard
            open={setPinOpen}
            phraseShowing={phraseShowing}
            onToggle={() => setSetPinOpen(o => !o)}
            onPhraseShown={() => setPhraseShowing(true)}
            onDone={closeSetPin}
          />
        )}
      </div>
      </Fold>

      <Fold title={t.uiLangName}>
      <div className="pop-card" style={{ marginTop: 0 }}>
        <FeatRow
          name={t.uiLangName}
          desc={t.uiLangDescOff}
          stack
          control={(
            <select
              value={settings.uiLanguage || 'auto'}
              onChange={(e) => { void pickLanguage(e.target.value as UiLanguage); }}
              aria-label={t.uiLangAria}
              className="set-select"
              style={{ width: '100%' }}
            >
              {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label(t)}</option>)}
            </select>
          )}
        />
      </div>
      </Fold>

      <div className="foot">
        <span>{getVersion()}</span>
        <OffLooks settings={settings} />
        <a href={offPrivacyUrl(uiLang)} target="_blank" rel="noopener noreferrer">{t.offPrivacy}</a>
      </div>
    </>
  );
}

function OffPopup() {
  const [settings, setSettings] = useState<FWSettings | null>(null);
  const [loadError, setLoadError] = useState(false);
  // The settings could not be read and nothing says a PIN exists: there is nothing to unlock, so the
  // popup says so and offers a retry instead of a PIN prompt.
  const [unreadable, setUnreadable] = useState(false);
  // null until the lock question has been answered. It was `false`, which is
  // an answer, and the wrong one: `reload()` sets `settings`, that ends the
  // loading branch below, and the whole switch grid, the mode segments and the
  // rules editor committed and became interactive before the PIN check had
  // even been asked. The paid popup does not do this; it stays on its main
  // screen and only navigates on success (2026-09-19).
  const [locked, setLocked] = useState<boolean | null>(null);
  // True when the lock stands on a PIN that is known to exist while the settings could not be read.
  // The lock screen then says so, with a Retry, instead of calling an unchecked PIN wrong.
  const [lockedUnread, setLockedUnread] = useState(false);
  // True after a PIN reset that leaves the could-not-read lock in place, so the lock can say the reset worked.
  const [pinChanged, setPinChanged] = useState(false);
  const [updateNotice, updateNoticeDone] = useUpdateNotice();

  const reload = useCallback(async () => {
    try {
      const s = await getSettings();
      setSettings(s);
      setLoadError(false);
      applyTheme(s.dashboardTheme ?? 'system');
      applyLook(s.popupLook === 'b' ? 'b' : 'a');
    } catch {
      setLoadError(true);
    }
  }, []);

  const start = useCallback(async () => {
    setUnreadable(false);
    setLockedUnread(false);
    setLocked(null);
    // The lock is decided first, and `settings` is published after it, so no
    // render can show an unlocked body while the answer is still in flight.
    const s = await getSettings().catch(() => null);
    if (s === null || parentPinUnknown(s)) {
      // A read that failed cannot say whether a PIN exists, and the
      // fail-closed snapshot reports none whether or not one is set. The old
      // `.catch(() => null)` left the popup open for good on a thrown read.
      // The two PIN fields are read on their own: a stored PIN keeps the lock, and with no sign of
      // one there is no PIN to ask for, so the popup stays closed behind the retry message.
      if ((await readPinEvidence()) !== 'present') { setUnreadable(true); return; }
      setLockedUnread(true);
      setLocked(true);
    } else if (s.parentPin) {
      notePinWasSet();
      const grace = await isPinGraceActive().catch(() => false);
      setLocked(!grace);
    } else {
      setLocked(false);
    }
    await reload();
  }, [reload]);

  useEffect(() => { void start(); }, [start]);

  useEffect(() => subscribeToSystemThemeChanges(() => { void reload(); }), [reload]);

  const lang = resolveUiLanguage(settings?.uiLanguage);
  const strings = POPUP_STRINGS[lang];

  let body;
  if (!settings || locked === null) {
    body = (
      <div className="fw-popup fw-off">
        <div className="pop-load-state" role={loadError || unreadable ? 'alert' : 'status'}>
          {loadError || unreadable ? (
            <>
              <div className="ttl">{strings.loadFailedTitle}</div>
              <p>{strings.loadFailedBodyOff}</p>
              <button type="button" className="pop-cta" onClick={() => { void start(); }}>{strings.retry}</button>
            </>
          ) : (
            <div className="muted">{strings.loading}</div>
          )}
        </div>
      </div>
    );
  } else {
    body = (
      <div className="fw-popup fw-off">
        <div className="pop-header">
          <span className="wordmark">Off</span>
          <span className="fw-off-tagline">{strings.offTagline}</span>
        </div>
        {locked ? (
          <PinOverlay
            onSuccess={() => { setPinChanged(false); if (lockedUnread) void start(); else setLocked(false); }}
            onReset={() => { setPinChanged(lockedUnread); if (lockedUnread) void start(); else setLocked(false); }}
            notice={pinChanged ? strings.pinChanged : undefined}
            onCancel={() => window.close()}
            onRetry={lockedUnread ? () => { void start(); } : undefined}
          />
        ) : (
          <>
            {updateNotice?.show && <UpdateNoticeLine version={updateNotice.version} onDone={updateNoticeDone} />}
            <OffBody settings={settings} reload={reload} />
          </>
        )}
      </div>
    );
  }

  return <I18nProvider lang={lang}>{body}</I18nProvider>;
}

// Mounted only where the popup page's #root exists; a test imports OffBody
// and renders it into its own container.
const rootEl = typeof document !== 'undefined' ? document.getElementById('root') : null;
if (rootEl) {
  applyPopupLife();
  createRoot(rootEl).render(
    <StrictMode>
      <OffPopup />
    </StrictMode>,
  );
}
