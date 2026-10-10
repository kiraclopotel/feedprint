// The popup's header: the wordmark, the status dots, and the tab bar under them.
//
// Cut out of src/ui/popup/Popup.tsx on 2026-09-16 (PLAN-2026-09-16 item 10.3), which was 1,871
// lines holding every panel at once. Popup.tsx re-exports the names it exported before.

import { usePopupT } from '../../../i18n/react';
import { Wordmark } from '../../shared/brand';
import { AppWindow, ExternalLink, FileText, Home as HomeIcon, Key as KeyIcon, Settings as SettingsIcon } from '../../shared/icons/lucide';
import { StatusLine } from '../../shared/StatusLine';
import type { Tab } from './types';

// ─── Pop header ───
//
// Single status dot reflects the FW License state — the only key the
// extension needs now that the proxy holds the Groq master key. Clicking
// it jumps to the License tab where the input lives. State semantics:
//   • `ok`       — green; the proxy accepted this license on a live probe
//   • `free`     — grey;  free tier (works for DOM-only protections, no AI
//                   rewrite). A calm neutral chip: a licence the parent never
//                   bought is not something to warn them about (gem 12).
//   • `warn`     — amber;  reserved, no licence state produces it today
//   • `err`      — red;   proxy returned 401/403 — license invalid / revoked
//   • `checking` — grey;  probe in flight, no answer yet
//   • `unchecked`— grey;  the probe could not complete (offline, timeout,
//                   proxy 5xx). This is NOT a license failure and must never
//                   read like one: an offline parent is not an unlicensed
//                   parent. It exists because green-for-unknown is the same
//                   silent-green defect the probe was written to remove.
//
// `checking` and `unchecked` carry their own visible chip text; the other
// three keep the plain "FW License" label and are read by dot color plus
// the hover tooltip.
export type DotState = 'ok' | 'warn' | 'err' | 'checking' | 'unchecked' | 'free';

function StatusDot({
  label, state, onClick, tooltip,
}: {
  label: string;
  state: DotState;
  onClick?: () => void;
  tooltip: string;
}) {
  const isClickable = !!onClick;
  return (
    <button
      type="button"
      className={`status-chip ${state} ${isClickable ? 'clickable' : ''}`}
      onClick={onClick}
      disabled={!isClickable}
      title={tooltip}
      aria-label={`${label}: ${tooltip}`}
    >
      <span className="status-dot" aria-hidden="true" />
      {/* The license state (checking, revoked, free, unchecked...) used to
          change silently in a plain span: nobody who could not see the dot
          change colour learned that it changed at all (accessibility audit,
          2026-09-18). role="status" (StatusLine's default tone) carries an
          implicit polite live region, so a label change here is announced
          the same as the ten other results this audit named, without a new
          string: the text is the same `label` this span always rendered. */}
      <StatusLine as="span" className="status-label">{label}</StatusLine>
    </button>
  );
}

// Pure helper: derive the license dot state from the resolved license tier
// + the latest proxy probe result. The `probeResult` parameter carries the
// outcome of an actual `/v1/models` call (see `probeProxy` in
// `ai/client.ts`).
//
// The pill states exactly what the probe found, including "it found nothing":
//   • 'revoked'          → 'err'. The proxy answered and refused the key.
//   • 'ok'               → 'ok'.  The proxy answered and accepted the key.
//   • 'unknown'          → 'unchecked'. The probe could not complete. This
//     used to render green, which meant a parent whose network, DNS or proxy
//     was down saw a confirmed-good license they had never confirmed. With
//     the AI layer off, comment protection falls back to the deterministic
//     floor, so "assume good" was the one wrong default here.
//   • null (pre-probe)   → 'checking'. Nothing has been asked yet, so nothing
//     is claimed. Normally invisible: `probeProxy` caches for five minutes,
//     so a reopened popup resolves without a network round trip.
//
// 'unchecked' is deliberately NOT red and never uses revoked wording: a
// failed check is a statement about the check, not about the license.

export function PopHeader({
  licenseState, keyHeld = false, strict = false, onClickStatus, onOpenSettings, onOpenDashboard, onDetach,
}: {
  licenseState: DotState;
  // At Strict with a key saved nothing is ever checked, so the chip says the key is saved instead of
  // reading "Not checked" as a fault (M4).
  keyHeld?: boolean;
  // Strict makes no outside call, so a chip that says LICENSE or "Free tier: a license key turns on the AI
  // reading" sits over "no license check" (B2F, P3-2). With no key it reads the level instead.
  strict?: boolean;
  onClickStatus?: () => void;
  onOpenSettings?: () => void;
  onOpenDashboard?: () => void;
  onDetach?: () => void;
}) {
  const t = usePopupT();
  const held = keyHeld && (licenseState === 'unchecked' || licenseState === 'checking');
  const strictNoKey = strict && !keyHeld && licenseState === 'free';
  const stateLabel = (s: DotState) => {
    if (held)              return t.statusKeyHeld;
    if (strictNoKey)       return t.strictNoCallsLine;
    if (s === 'ok')        return t.statusOk;
    if (s === 'free')      return t.statusFree;
    if (s === 'err')       return t.statusRevoked;
    if (s === 'checking')  return t.statusChecking;
    if (s === 'unchecked') return t.statusUnchecked;
    return t.statusAction;
  };
  // A grey dot on its own does not tell a parent that the license was never
  // checked, so the two no-answer states put words in the chip. The three
  // answered states keep the plain label they have always had.
  const chipLabel = (s: DotState) => {
    if (held)              return t.statusKeyHeldShort;
    if (strictNoKey)       return t.modeChild;
    if (s === 'checking')  return t.statusCheckingShort;
    if (s === 'unchecked') return t.statusUncheckedShort;
    return t.licenseLabel;
  };
  // A free install away from Strict has nothing to report about a license: its chip read LICENSE beside the License
  // tab and opened that tab, the same word twice (the head, 9 Oct 2026). So it shows none. At Strict the chip reads the
  // level, and a saved key keeps its chip.
  const chipShown = !(licenseState === 'free' && !keyHeld && !strictNoKey);
  return (
    <div className="pop-header">
      <Wordmark size={28} />
      <div className="status-row">
        {chipShown && (
          <StatusDot
            label={chipLabel(licenseState)}
            state={licenseState}
            onClick={onClickStatus}
            tooltip={stateLabel(licenseState)}
          />
        )}
        {onDetach && (
          <button type="button" className="hdr-iconbtn" onClick={onDetach} title={t.detachWindow} aria-label={t.detachWindow}>
            <AppWindow size={15} />
          </button>
        )}
        {onOpenDashboard && (
          <button type="button" className="hdr-iconbtn" onClick={onOpenDashboard} title={t.openDashboard} aria-label={t.openDashboard}>
            <FileText size={15} />
          </button>
        )}
        {onOpenSettings && (
          <button type="button" className="hdr-iconbtn" onClick={onOpenSettings} title={t.settingsBtn} aria-label={t.settingsBtn}>
            <SettingsIcon size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Tab bar ───
export function PopTabBar({
  active, onChange,
}: {
  active: Tab;
  onChange: (t: Tab) => void;
}) {
  const t = usePopupT();
  // This is the REAL tab bar (its output is the Home/License panel Popup.tsx
  // switches on), unlike SettingsPanel's child/teen/adult control, which
  // only looked like one. It had none of role="tablist"/"tab", aria-selected
  // or aria-controls, and its active state was a teal fill only, colour
  // alone (accessibility audit, 2026-09-18). The ids and aria-controls below
  // are the popup side of the pairing. Popup.tsx carries the other end since
  // 2026-09-19: until then both aria-controls pointed at ids that were nowhere
  // in the document, so the bar announced itself as tabs controlling panels
  // that did not exist.
  return (
    <div className="pop-tabbar" role="tablist">
      <button
        id="pop-tab-home"
        role="tab"
        aria-selected={active === 'home'}
        aria-controls="pop-tabpanel-home"
        className={`pop-tab ${active === 'home' ? 'active' : ''}`}
        onClick={() => onChange('home')}
      >
        <HomeIcon size={14} />
        <span>{t.tabHome}</span>
      </button>
      <button
        id="pop-tab-keys"
        role="tab"
        aria-selected={active === 'keys'}
        aria-controls="pop-tabpanel-keys"
        className={`pop-tab ${active === 'keys' ? 'active' : ''}`}
        onClick={() => onChange('keys')}
      >
        <KeyIcon size={14} />
        <span>{t.tabLicense}</span>
      </button>
    </div>
  );
}
