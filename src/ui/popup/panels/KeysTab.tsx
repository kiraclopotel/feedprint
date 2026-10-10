// The licence tab: the key, what it allows, and the daily and monthly caps against it.
//
// Cut out of src/ui/popup/Popup.tsx on 2026-09-16 (PLAN-2026-09-16 item 10.3), which was 1,871
// lines holding every panel at once. Popup.tsx re-exports the names it exported before.

import type { ProxyProbeResult } from '../../../ai/client';
import { usePopupT } from '../../../i18n/react';
import { LicenseInfo, clearLicense, dailyCapForTier, isUncappedTier, setLicense } from '../../../storage/license';
import { levelMakesNoCalls } from '../../../types/mode';
import { FWSettings, isPinGraceActive, parentPinUnknown } from '../../../storage/settings';
import { Eye, EyeOff, ShieldAlert } from '../../shared/icons/lucide';
import { PinOverlay } from '../controls';
import { StatusLine } from '../../shared/StatusLine';
import { getFwVersion } from '../fw-version';
import { useState } from 'react';
import { KeyUsage } from './HomeTab';
import { readingRowNames } from './ai/AiCard';

/** The site's help section on the AI reading, which says what a key costs and where to get one. */
export const KEY_HELP_URL = 'https://feelingwise.org/help#ai-reading';

// ─── License tab ───
export function KeysTab({
  settings, license, probeResult = null, onChange,
}: {
  settings: FWSettings;
  license: LicenseInfo;
  // Live proxy-probe outcome (POP-5 residual). HomeTab already derives an
  // honest banner from this; this tab's own pill/dot did not consult it at
  // all, so a revoked paid-shaped key still read "active" on the one screen
  // a parent opens specifically to check the license. Same assume-good-
  // until-revoked policy as computeAiBannerState/computeStatusStates — only
  // a definitive 'revoked' probe changes the display.
  probeResult?: ProxyProbeResult | null;
  onChange: () => Promise<void>;
}) {
  const t = usePopupT();
  const [showLic, setShowLic] = useState(false);
  const [licDraft, setLicDraft] = useState('');
  const [licError, setLicError] = useState('');
  const [savedTick, setSavedTick] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // SEC-G15: with a parent PIN set, changing or removing the key is a
  // parent act. Without this gate a child removed the key from the popup
  // and every post then passed at the free tier while the mode still read
  // Child. Same PIN modal and grace window as Settings.
  const [pinFor, setPinFor] = useState<'save' | 'remove' | null>(null);
  const revoked = license.tier !== 'free' && probeResult === 'revoked';

  const withParentPin = (action: 'save' | 'remove', run: () => Promise<void>): void => {
    // A snapshot the reader could not confirm has an empty PIN whether or not one exists.
    if (parentPinUnknown(settings)) { setPinFor(action); return; }
    if (!settings.parentPin) { void run(); return; }
    void isPinGraceActive().then((grace) => {
      if (grace) void run();
      else setPinFor(action);
    });
  };

  const saveLic = async () => {
    setLicError('');
    if (!licDraft.trim()) return;
    const r = await setLicense(licDraft.trim());
    if (!r.ok) { setLicError(r.error); return; }
    setLicDraft('');
    setSavedTick(true);
    // Widened from 1200ms (accessibility audit, 2026-09-18): the confirmation
    // is now a status line a screen reader is expected to reach and read,
    // not only a green flash a sighted user catches out of the corner of
    // an eye.
    setTimeout(() => setSavedTick(false), 3000);
    await onChange();
  };

  // Remove the stored key → downgrade to free tier on next read. Two-step
  // (confirm) so a misclick can't silently sign the parent out and disable
  // AI rewrites. DOM-only protections keep running on free tier.
  const removeLic = async () => {
    await clearLicense();
    setConfirmRemove(false);
    await onChange();
  };
  const requestSave = () => withParentPin('save', saveLic);
  const requestRemove = () => withParentPin('remove', removeLic);

  // Strict makes no outside call, so at Strict this tab offers no key field, no price and no daily limit:
  // it says the Strict sentence, and a key already held can still be removed (B2 unit 3).
  const strict = levelMakesNoCalls(settings);
  const tierDailyCap = dailyCapForTier(license.tier);
  const uncapped = isUncappedTier(license.tier);
  // Same formula as HomeTab and pipeline.ts: dailyCap <= 0 is the legacy
  // "no user cap" sentinel, so the tier cap applies. Math.min alone read a
  // paid install with the legacy 0 as "no calls per day" (M117).
  const dailyCap = license.tier === 'free'
    ? 0
    : settings.dailyCap > 0
      ? Math.min(settings.dailyCap, tierDailyCap)
      : tierDailyCap;

  return (
    <>
      <KeyUsage settings={settings} license={license} probeResult={probeResult} />
      <div className="pop-card" style={{ marginTop: 14 }}>
        <div className="key-row">
          <span className={`key-dot ${license.tier !== 'free' ? (revoked ? 'err' : 'ok') : ''}`} />
          <div className="key-meta">
            <div className="key-name">{t.licCardName}</div>
            <div className="key-sub">
              {license.tier === 'free'
                ? (strict ? t.keySubStrict : t.keySubFree)
                : levelMakesNoCalls(settings) ? t.keySubStrict
                : revoked ? t.licenseInvalidTitle : t.keySubActive}
            </div>
            {/* A key held outside Strict says what it covers by the names the rows carry in Settings, so the two screens
                cannot name the reading's parts differently. */}
            {license.tier !== 'free' && !strict && !revoked && (
              <ul className="key-rows">
                {readingRowNames(t).map((name) => <li key={name}>{name}</li>)}
              </ul>
            )}
            {/* What a key adds, without its price: the price stays on the site, so the popup holds no money and the
                help page can change it without an update. */}
            {license.tier === 'free' && !strict && (
              <div className="key-sub">
                {t.keyAdds}{' '}
                <a href={KEY_HELP_URL} target="_blank" rel="noopener noreferrer">{t.keyGetLink}</a>
              </div>
            )}
          </div>
          {/* The line under the name says the key's state; a pill beside it said it again (his word, 8 Oct 2026).
              Only a refused key keeps its red mark. */}
          {revoked && <span className="key-pill err">{t.licenseNotAcceptedPill}</span>}
        </div>
        {/* Revoked / unauthorized paid key (POP-5 residual): this tab is the
            one screen a parent opens specifically to check the license, so
            it must not show the same pill/dot as a confirmed-active one. */}
        {revoked && (
          <div className="pop-bn err" role="alert" style={{ marginTop: 4, marginBottom: 4 }}>
            <div className="ttl"><ShieldAlert size={14} /> {t.licenseInvalidTitle}</div>
            <div className="body">{t.licenseInvalidBodyKeysTab}</div>
          </div>
        )}
        {!strict && (<>
        <div className="in-row">
          <input
            type={showLic ? 'text' : 'password'}
            value={licDraft}
            onChange={e => { setLicDraft(e.target.value); setLicError(''); }}
            placeholder={license.tier === 'free' ? 'fw-starter-…' : t.placeholderStored}
            // Named only by a placeholder that vanishes once there is a value
            // to read (accessibility audit, 2026-09-18); the "License key"
            // heading at key-name above is a plain div, not a <label>, so it
            // was never wired to this input either. aria-label reuses the
            // same text that heading already shows. aria-invalid + the
            // describedby pairing announce the validation failure below and
            // point a screen reader straight at it.
            aria-label={t.licCardName}
            aria-invalid={!!licError || undefined}
            aria-describedby={licError ? 'lic-key-error' : undefined}
          />
          {/* Took its name from `title` only, which is not reliably exposed
              to a screen reader when the icon inside is aria-hidden
              (accessibility audit, 2026-09-18): a real label, aria-pressed
              for its own show/hide state, and the type="button" it was
              missing (its default type inside a form-like context is
              submit). */}
          <button
            type="button"
            className="iconbtn"
            onClick={() => setShowLic(s => !s)}
            title={showLic ? t.hide : t.show}
            aria-label={showLic ? t.hide : t.show}
            aria-pressed={showLic}
          >
            {showLic ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button className="iconbtn" onClick={requestSave} disabled={!licDraft.trim()}>
            {t.save}
          </button>
        </div>
        {licError && <StatusLine tone="alert" id="lic-key-error" style={{ fontSize: 11, color: 'var(--fw-red)' }}>{licError}</StatusLine>}

        <div style={{ fontSize: 11, color: 'var(--fw-muted)', marginTop: 8, lineHeight: 1.5 }}>
          {t.licenseStaysOnDevice}
        </div>
        </>)}

        {savedTick && <StatusLine tone="status" style={{ fontSize: 11, color: 'var(--fw-green)' }}>{t.saved}</StatusLine>}

        {license.tier !== 'free' && (
          <div style={{ marginTop: 10 }}>
            {!confirmRemove ? (
              <button
                className="lnk"
                style={{ fontSize: 11, color: 'var(--fw-muted)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                onClick={() => setConfirmRemove(true)}
              >
                {t.removeLicense}
              </button>
            ) : (
              <div style={{ fontSize: 11, color: 'var(--fw-text)', lineHeight: 1.5 }}>
                {t.removeConfirmBody}
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <button className="iconbtn" style={{ color: 'var(--fw-red)' }} onClick={requestRemove}>{t.remove}</button>
                  <button className="iconbtn" onClick={() => setConfirmRemove(false)}>{t.cancelLower}</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* The daily limit is the AI reading's: a key that does not turn the reading on has none to show (9 Oct 2026). */}
      {!strict && license.tier !== 'free' && (<>
      <div className="grp-hdr">{t.dailyLimit}</div>
      <div className="pop-card" style={{ marginTop: 0 }}>
        <div style={{ fontSize: 12, color: 'var(--fw-text)' }}>
          {/* A refused key has no cap to speak of: nothing is being checked.
              This card promised 'Unlimited AI calls (founder)' directly under
              the red card saying the server would not take the key. */}
          {revoked
            ? t.noCallsRejected
            : uncapped
              ? t.unlimitedCalls
              : t.callsPerDay(dailyCap)}
        </div>
        {/* Only the limit's one rule is a note; the other states are said by the line above. */}
        {!revoked && !uncapped && dailyCap > 0 && (
          <div style={{ fontSize: 11, color: 'var(--fw-muted)', marginTop: 6, lineHeight: 1.5 }}>{t.capPauseNote}</div>
        )}
      </div>
      </>)}

      <div className="foot">
        <span>{getFwVersion()}</span>
        <a href="https://feelingwise.org/privacy" target="_blank" rel="noopener noreferrer">{t.privacy}</a>
      </div>
      {pinFor && (
        <PinOverlay
          onSuccess={() => {
            const action = pinFor;
            setPinFor(null);
            void (action === 'save' ? saveLic() : removeLic());
          }}
          onCancel={() => setPinFor(null)}
        />
      )}
    </>
  );
}
