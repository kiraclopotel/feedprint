// FeelingWise — popup (CYCLE N+10 re-skin against ui_kits/popup/).
//
// 380 px Chrome popup. Three screens: setup wizard (4 steps) → main
// (Home tab + License tab) → settings (PIN-gated).
//
// Visual contract: docs/history/design-system-2026-07/ui_kits/popup/. CSS classes live in
// popup-design.css. Tokens come from ../shared/tokens.css.
//
// Localization: every user-visible string comes from the typed table in
// src/i18n/popup-strings.ts via usePopupT(). The resolved language is
// provided once at the root from settings.uiLanguage ('auto' follows the
// browser). Do not add hardcoded user-facing literals here — add a key to
// PopupStrings instead (both EN and RO, enforced by the type).

import '../shared/tokens.css';
import './popup-design.css';
import './popup-frame.css';
import './popup-life.css';
import './popup-looks.css';
import './popup-panel.css';
import { applyLook, eagerApplyStoredLook } from '../shared/looks';
import { applyPopupLife } from './life';
import { type ProxyProbeResult, probeProxy, servedProviderName } from '../../ai/client';
import { resolveUiLanguage } from '../../i18n';
import { POPUP_STRINGS } from '../../i18n/popup-strings';
import { I18nProvider } from '../../i18n/react';
import { FREE_LICENSE, LicenseInfo, getLicense } from '../../storage/license';
import { levelMakesNoCalls } from '../../types/mode';
import { type DashboardTheme, FWSettings, getSettings, isPinGraceActive, parentPinUnknown, saveSettings } from '../../storage/settings';
import { bearerOf, getReadingConsent, recordReadingConsent, type ReadingConsent } from '../../storage/reading-consent';
import { ReadingConsentScreen, needsReadingConsent } from './panels/ReadingConsentScreen';
import { applyTheme, eagerApplyStoredTheme, subscribeToSystemThemeChanges } from '../shared/theme';
import { UpdateNoticeLine, useUpdateNotice } from './UpdateNotice';
import { storedOffSwitchOn } from '../../storage/switch-scope';
import { PinOverlay } from './controls';
import { HomeTab } from './panels/HomeTab';
import { KeysTab } from './panels/KeysTab';
import { SettingsPanel } from './panels/SettingsPanel';
import { SetupWizard } from './panels/SetupWizard';
import { PopHeader, PopTabBar } from './panels/header';
import { computeStatusStates } from './panels/status';
import type { Screen, Tab } from './panels/types';
import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

// Eager pre-mount theme apply, the same pattern the dashboard uses at the top of its module.
// It cuts the dark flash for a user whose stored preference is 'light' and whose system is
// dark, or the other way round. tokens.css's media fallback covers the case where
// chrome.storage is not there to read.
eagerApplyStoredTheme();
// The stored style the same way, so a cobalt or graphite popup does not open teal for a moment.
eagerApplyStoredLook();

// The panels moved to their own files (PLAN-2026-09-16 item 10.3). Everything this file exported
// before is re-exported here, so no test and no other surface had to change its import.
export { computeStatusStates, computeAiBannerState, type AiBannerState } from './panels/status';
export { PopHeader } from './panels/header';
export { SetupWizard } from './panels/SetupWizard';
export { HomeTab, queryCoverageTab } from './panels/HomeTab';
export { KeysTab } from './panels/KeysTab';
export { SettingsPanel } from './panels/SettingsPanel';

// ─── Mode-switch reset gate (POP-3) ───
//
// The confirm and PIN logic lives in ./switches so the Off popup runs the
// same gate. Re-exported here for the callers and tests that import it
// from this module.
export { modeSwitchResetsToggles, resolveModeClick, modeSwitchRequiresPin } from './switches';

// ─── Main popup ───

function Popup() {
  const [settings, setSettings] = useState<FWSettings | null>(null);
  const [license, setLicenseState] = useState<LicenseInfo>(FREE_LICENSE);
  const [screen, setScreen] = useState<Screen>('setup');
  const [tab, setTab] = useState<Tab>('home');
  const [pinOpen, setPinOpen] = useState(false);
  const [pendingConsentAnswer, setPendingConsentAnswer] = useState<(() => void) | null>(null);
  // The reading screen closed with its close mark, for this open only: nothing is answered or stored, so the
  // next open shows it again.
  const [consentClosed, setConsentClosed] = useState(false);
  const [proxyProbe, setProxyProbe] = useState<ProxyProbeResult | null>(null);
  // The company the proxy says reads the text, from the same probe as the licence check.
  const [servedProvider, setServedProvider] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // undefined until read, so the screen never flashes before the stored consent is known.
  const [consent, setConsent] = useState<ReadingConsent | null | undefined>(undefined);
  // Read on every open, whatever screen this lands on (see UpdateNotice.tsx on why).
  const [updateNotice, updateNoticeDone] = useUpdateNotice();

  // When the popup is opened as its own standalone window (the "detach"
  // affordance below opens popup.html?detached=1 via chrome.windows.create),
  // it should fill + be resizable rather than render as the fixed 380px action
  // popup. A body class lets popup-design.css relax the width; the detach
  // button itself hides (it's already a window).
  const isDetached = (() => {
    try { return new URLSearchParams(location.search).has('detached'); } catch { return false; }
  })();
  useEffect(() => {
    if (isDetached) document.body.classList.add('fw-detached');
  }, [isDetached]);

  const reload = useCallback(async () => {
    const [s, l] = await Promise.all([getSettings(), getLicense()]);
    setSettings(s);
    setLicenseState(l);
    setConsent(l.tier === 'free' ? null : await getReadingConsent(bearerOf(l)));
    setLoadError(null);
    return s;
  }, []);

  const loadInitial = useCallback(() => {
    reload().then(s => {
      // Setup is complete once the first-run screen was finished (setupDone,
      // 14 Sep 2026), or, for installs that finished before that field
      // existed, once a PIN was set. The license key is optional; users can
      // finish setup and paste it later via the License tab. Without this, a
      // user who skipped the license would get sent back to the wizard on
      // every popup open.
      // A snapshot the reader could not confirm says nothing about setup, and the
      // wizard would overwrite the parent's mode and PIN. The main screen keeps
      // every parent gate locked on such a snapshot.
      setScreen(s.setupDone || s.parentPin || parentPinUnknown(s) ? 'main' : 'setup');
      // Re-apply theme from settings (eager apply already ran at module
      // load; this catches the case where the stored value changed
      // between popup opens via the dashboard's theme cycle).
      applyTheme(s.dashboardTheme);
      applyLook(s.popupLook);
    }).catch((e) => {
      console.error(e);
      setLoadError(e instanceof Error ? e.message : String(e));
    });
  }, [reload]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  // When the parent flips theme, interface language, OR any settings this
  // surface renders (feature toggles / mode / strict-language / the analyzer
  // scalars) in another FW surface (dashboard, or the detached popup window),
  // reflect the change live without requiring a popup reopen. Re-pulling a
  // fresh `settings` snapshot here ALSO keeps the in-memory state that backs
  // the next toggle write current, complementing updateFeature's fresh-read
  // merge so a second open window never SHOWS a stale toggle (POP-2 display side).
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
    // Keys whose change should refresh this popup's rendered state.
    const RELOAD_ON = [
      'dashboardTheme', 'popupLook', 'uiLanguage',
      // hideUnrewritable is no longer shown or read by anything the popup
      // renders, so its change is not a reason to refresh (wiring audit P4).
      'features', 'mode', 'strictLanguage',
      'aiAnalysisEnabled',
      // Q49 (W50): a key pasted or removed in another FW window must update
      // this popup's tier pill and cap numbers without a reopen.
      'fw_license_key',
    ] as const;
    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.dashboardTheme) {
        applyTheme(changes.dashboardTheme.newValue as DashboardTheme);
      }
      if (changes.popupLook) applyLook(changes.popupLook.newValue);
      if (RELOAD_ON.some(k => k in changes)) {
        // Re-pull settings so the SettingsPanel's toggles + mode button reflect
        // the write made in the other window.
        void reload();
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [reload]);

  // When the chosen preference is 'system', listen for OS-level
  // prefers-color-scheme flips so the popup keeps mirroring the OS
  // without needing to be reopened.
  useEffect(() => {
    if (!settings || settings.dashboardTheme !== 'system') return;
    return subscribeToSystemThemeChanges(() => applyTheme('system'));
  }, [settings?.dashboardTheme]);

  // License live probe against the FeelingWise proxy. Fires when the popup
  // opens AND whenever the stored license tier changes (parent pastes /
  // replaces in the License tab). The probe hits `/v1/models` with the
  // license bearer (zero tokens) and the result drives `licenseState` via
  // `computeStatusStates` — a revoked license flips the dot to red so the
  // parent has a clear "open License tab" affordance instead of trusting a
  // green dot while every classification call silently 401s.
  useEffect(() => {
    if (license.tier === 'free') {
      setProxyProbe(null);
      setServedProvider(null);
      return;
    }
    let cancelled = false;
    const bearer = `fw-${license.tier}-${license.secret}`;
    probeProxy(bearer).then(result => {
      if (cancelled) return;
      setProxyProbe(result);
      setServedProvider(servedProviderName(bearer));
    }).catch((e) => console.error(e));
    return () => { cancelled = true; };
  }, [license.tier, license.secret, settings ? levelMakesNoCalls(settings) : null]);

  // Resolved interface language. Before settings load, 'auto' resolves
  // from the browser language so even the loading state is localized.
  const lang = resolveUiLanguage(settings?.uiLanguage);

  let body;
  if (!settings) {
    const strings = POPUP_STRINGS[lang];
    body = (
      <div className="fw-popup">
        <div className="pop-load-state" role={loadError ? 'alert' : 'status'}>
          {loadError ? (
            <>
              <div className="ttl">{strings.loadFailedTitle}</div>
              <p>{strings.loadFailedBody}</p>
              <button type="button" className="pop-cta" onClick={loadInitial}>{strings.retry}</button>
            </>
          ) : (
            <div className="muted">{strings.loading}</div>
          )}
        </div>
      </div>
    );
  } else {
    const { licenseState } = computeStatusStates(license, proxyProbe);
    // Strict with a key saved: the key is held, never checked (M4).
    const keyHeld = levelMakesNoCalls(settings) && license.tier !== 'free';
    const openDashboard = (section: 'all' | 'blocked' = 'all') => {
      const hash = section === 'all' ? '' : `#${section}`;
      void chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard.html${hash}`) });
    };
    // Detach the popup into its own resizable window. A `popup`-type window has
    // minimal chrome but is user-resizable and — unlike the action popup — does
    // NOT close when it loses focus, so the parent can keep it open beside the
    // feed. No `windows` permission is required for chrome.windows.create.
    const detachToWindow = () => {
      void chrome.windows.create({
        url: chrome.runtime.getURL('popup.html?detached=1'),
        type: 'popup',
        width: 400,
        height: 700,
        focused: true,
      });
      window.close();
    };

    if (screen === 'setup') {
      body = (
        <div className="fw-popup">
          <PopHeader licenseState={licenseState} keyHeld={keyHeld} strict={levelMakesNoCalls(settings)} />
          <SetupWizard onComplete={() => { reload().then(() => { setScreen('main'); setTab('home'); }).catch((e) => console.error(e)); }} />
        </div>
      );
    } else if (screen === 'settings') {
      body = (
        <div className="fw-popup">
          <PopHeader licenseState={licenseState} keyHeld={keyHeld} strict={levelMakesNoCalls(settings)} onClickStatus={() => setScreen('main')} />
          <SettingsPanel
            settings={settings}
            license={license}
            onBack={() => setScreen('main')}
            onChange={async () => { await reload(); }}
            isDetached={isDetached}
          />
        </div>
      );
    } else {
      // main screen. Settings + dashboard ride in the header as icon
      // buttons so both primary actions are reachable with zero scrolling.
      // "Not now" switches the reading off, so switching it back on asks again. The screen waits for the
      // licence probe, so the "company not named" text never shows while the probe is still answering.
      const needsConsent = proxyProbe !== null && needsReadingConsent({ license, settings, consent, servedProvider, keyRefused: licenseState === 'err' });
      // Both answers change what the parent set (Start ends the refund right, Not now switches the reading
      // off), so with a parent PIN set, or its state unknown, they wait for the PIN as Settings does.
      const answerWithPin = (answer: () => void) => {
        if (!parentPinUnknown(settings) && !settings.parentPin) { answer(); return; }
        void isPinGraceActive().then((grace) => {
          if (grace && !parentPinUnknown(settings)) answer();
          else { setPendingConsentAnswer(() => answer); setPinOpen(true); }
        });
      };
      const requestSettings = () => {
        // PIN gate if a PIN is set AND it wasn't entered recently (grace
        // window) — otherwise go straight in. Opening Settings is low-stakes;
        // re-prompting on every visit annoyed a tester. Destructive actions
        // (chain reset) still always demand the PIN.
        // A snapshot the reader could not confirm carries parentPin: '' whether
        // or not a PIN exists, so "no PIN is set" and "I could not find out"
        // arrived here as the same thing and both opened Settings with no
        // prompt (2026-09-19). Unknown demands the PIN: the next read succeeds
        // and the parent gets in, where an opened panel cannot be taken back.
        if (parentPinUnknown(settings)) { setPinOpen(true); return; }
        if (!settings.parentPin) { setScreen('settings'); return; }
        void isPinGraceActive().then((grace) => {
          if (grace) setScreen('settings');
          else setPinOpen(true);
        });
      };
      body = (
        <div className="fw-popup">
          <PopHeader
            licenseState={licenseState}
            keyHeld={keyHeld}
            strict={levelMakesNoCalls(settings)}
            onClickStatus={() => setTab('keys')}
            onOpenDashboard={() => openDashboard('all')}
            onOpenSettings={requestSettings}
            onDetach={isDetached ? undefined : detachToWindow}
          />
          <PopTabBar active={tab} onChange={setTab} />
          {updateNotice?.show && (
            <UpdateNoticeLine
              version={updateNotice.version}
              onDone={updateNoticeDone}
              switchesMoved={storedOffSwitchOn(settings.features)}
            />
          )}
          {/* The other end of the tab bar's pairing (2026-09-19). PopTabBar has
              carried role="tab" and aria-controls since 2026-09-18, and its own
              comment says Popup.tsx still needs role="tabpanel" on the two
              panels those ids point at. It did not have them, so both
              aria-controls pointed at ids that were nowhere in the document: to
              a screen reader the bar announced itself as tabs controlling
              panels that did not exist, which is worse than the plain buttons
              it replaced, because a reader is told a relationship and then
              cannot follow it. The dashboard closed the same gap on 2026-09-18
              and the popup was not carried.

              `aria-labelledby` points back at the tab, so the panel is
              announced by the word the person pressed. `tabIndex={0}` is what
              lets a keyboard reach the panel's content after the tab, which is
              the whole purpose of the pairing. */}
          {tab === 'home' && (
            <div id="pop-tabpanel-home" role="tabpanel" aria-labelledby="pop-tab-home" tabIndex={0}>
              <HomeTab
                settings={settings} license={license} probeResult={proxyProbe}
                onOpenDashboard={() => openDashboard('all')}
                onOpenDashboardSection={openDashboard}
                isDetached={isDetached}
                onOpenLicense={() => setTab('keys')}
                onChange={async () => { await reload(); }}
              />
            </div>
          )}
          {tab === 'keys' && (
            <div id="pop-tabpanel-keys" role="tabpanel" aria-labelledby="pop-tab-keys" tabIndex={0}>
              <KeysTab settings={settings} license={license} probeResult={proxyProbe} onChange={async () => { await reload(); }} />
            </div>
          )}
          {needsConsent && !consentClosed && (
            <ReadingConsentScreen
              provider={servedProvider}
              onClose={() => setConsentClosed(true)}
              onStart={(shownText, provider) => answerWithPin(() => { void recordReadingConsent(bearerOf(license), shownText, provider).then(reload); })}
              onNotNow={() => answerWithPin(() => { void saveSettings({ aiAnalysisEnabled: false }).then(reload); })}
            />
          )}
          {pinOpen && (
            <PinOverlay
              onSuccess={() => {
                setPinOpen(false);
                if (pendingConsentAnswer) { const answer = pendingConsentAnswer; setPendingConsentAnswer(null); answer(); }
                else setScreen('settings');
              }}
              onCancel={() => { setPinOpen(false); setPendingConsentAnswer(null); }}
              notice={pendingConsentAnswer ? POPUP_STRINGS[lang].pinConsentReason : undefined}
            />
          )}
        </div>
      );
    }
  }

  return <I18nProvider lang={lang}>{body}</I18nProvider>;
}

// ─── Mount ───
// Guarded so the module can be imported in a DOM-less unit-test env
// (renderToString / helper tests) without executing the real mount — in the
// actual popup `document` is always present.
if (typeof document !== 'undefined') {
  applyPopupLife();
  const rootEl = document.getElementById('root') ?? document.body.appendChild(document.createElement('div'));
  createRoot(rootEl).render(
    <StrictMode>
      <Popup />
    </StrictMode>,
  );
}
