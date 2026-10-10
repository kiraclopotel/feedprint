// The screen before the first paid reading: what goes out, to whom, what does not, and the money
// line. It is the person's express request to start now, which ends the 14-day refund right for the
// period paid, so it is shown once per licence key, in every level that reads: Strict, and an install
// whose level is not chosen yet, make no outside call and are never asked.
//
// The words are a draft: they are read by the AI native readers and then by the lawyer before the
// store text or the site says anything about them.

import { useEffect, useRef } from 'react';
import { usePopupT } from '../../../i18n/react';
import type { PopupStrings } from '../../../i18n/popup/types';
import type { FWSettings } from '../../../storage/settings';
import type { LicenseInfo } from '../../../storage/license';
import type { ReadingConsent } from '../../../storage/reading-consent';
import { makesNoOutsideCall } from '../../../types/mode';

/**
 * Whether to ask now: a key, the reading on, no consent stored for this key, and a key the proxy
 * has not refused. Strict never asks, since it sends nothing (makesNoOutsideCall), nor does an install
 * whose level is not chosen yet; Moderate and Relaxed ask. A consent not yet read
 * (undefined) never shows the screen, so it cannot flash before the stored answer is known.
 * A consent given for another company than the one the proxy names now is asked for again; a name
 * not served at the moment (null) asks nothing new, so being offline never re-asks.
 */
export function needsReadingConsent(s: {
  license: LicenseInfo;
  settings: Pick<FWSettings, 'aiAnalysisEnabled' | 'mode' | 'levelChosen'>;
  consent: ReadingConsent | null | undefined;
  servedProvider: string | null;
  keyRefused: boolean;
}): boolean {
  if (s.license.tier === 'free' || s.settings.aiAnalysisEnabled === false || s.keyRefused) return false;
  if (makesNoOutsideCall(s.settings)) return false;
  if (s.consent === undefined) return false;
  if (s.consent === null) return true;
  return s.servedProvider !== null && s.consent.provider !== s.servedProvider;
}

/** Every line the person reads, in order; the hash stored with the consent is over this text. */
export function readingConsentText(t: PopupStrings, provider: string): string {
  return [t.consentTitle, t.consentWhy, t.consentWhatDoesNot, t.consentWhatGoes, t.consentToWhom(provider), t.consentMoney, t.consentStart].join('\n');
}

// A guided read, in the order a person needs it: why this differs from a cookie banner, what stays,
// what leaves, who reads it and what binds them, the money. The two answers look and weigh the same
// and neither is focused first: a nudged yes is no consent (Google's user data rules, EU law).
// The panel scrolls because Chrome caps the popup at 600px and sizes it to the page beneath, so
// the longer languages would otherwise cut off the title or the second answer.

/** provider is the company's name as the proxy served it; null means it was not served and the reading cannot start. */
export function ReadingConsentScreen({ provider, onStart, onNotNow, onClose }: { provider: string | null; onStart: (shownText: string, provider: string) => void; onNotNow: () => void; onClose?: () => void }) {
  const t = usePopupT();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  // Focus goes back to whatever had it before this screen opened, whichever way it closes (the close mark, Escape, an answer).
  // Declared before the heading takes the focus, so it remembers the right element. The shape is PinOverlay's (controls.tsx).
  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    return () => { previouslyFocused.current?.focus?.(); };
  }, []);
  useEffect(() => { titleRef.current?.focus(); }, []);
  // The screen says it is a modal, so Tab stays inside it, and Escape is the close mark and nothing else: it never answers.
  // The two answers weigh the same, and a nudged answer is no consent (this file's header), so Escape never starts the
  // reading and never says "Not now". With no close mark (onClose absent) Escape does nothing.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const root = rootRef.current;
      if (!root) return;
      const active = document.activeElement as HTMLElement | null;
      // A dialog opened on top of this one (the PIN gate after an answer) owns the keys while the focus is inside it.
      const other = active?.closest('[aria-modal="true"]');
      if (other && other !== root) return;
      if (e.key === 'Escape') { onClose?.(); return; }
      if (e.key !== 'Tab') return;
      const focusables = Array.from(root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])',
      ));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      // Focus is outside the dialog (or nowhere): bring it in at the end the key points to.
      if (!active || !root.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      // Inside, the browser moves the focus on its own except past the ends. The heading is not tabbable, so a position that is
      // not in the list counts the controls before and after it.
      const at = focusables.indexOf(active);
      const hasPrev = at === -1 ? focusables.some((f) => active.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_PRECEDING) : at > 0;
      const hasNext = at === -1 ? focusables.some((f) => active.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING) : at < focusables.length - 1;
      if (e.shiftKey ? !hasPrev : !hasNext) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  return (
    <div ref={rootRef} className="pin-overlay" role="dialog" aria-modal="true" aria-labelledby="fw-consent-title" data-testid="reading-consent">
      <div className="panel consent-panel" style={{ textAlign: 'left', maxHeight: 'calc(100vh - 16px)', overflowY: 'auto' }}>
        {/* The heading and the way out share a row, so the heading's focus ring (focus starts on it) encloses its words
            and not the mark. The mark answers nothing: it hides this screen for this open only, so it asks for no PIN
            and stores no consent and changes no setting; the screen shows again at the next open. Both answers below
            keep their PIN. The word is the one the popup already uses for closing a notice. The mark comes first in the
            document (its reading order) and last on the screen (order: 2). */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          {onClose && (
            <button type="button" className="chip-x" data-testid="consent-close" aria-label={t.updateNoticeDismiss} onClick={onClose} style={{ order: 2 }}>×</button>
          )}
          <h3 id="fw-consent-title" ref={titleRef} tabIndex={-1} style={{ flex: 1, minWidth: 0, order: 1 }}>{t.consentTitle}</h3>
        </div>
        <p>{t.consentWhy}</p>
        <p>{t.consentWhatDoesNot}</p>
        <p>{t.consentWhatGoes}</p>
        <p>{provider === null ? t.consentProviderUnknown : t.consentToWhom(provider)}</p>
        <p><strong>{t.consentMoney}</strong></p>
        {/* The two answers stay pinned at the panel's foot, so both are on screen in a 600 px popup in every language
            while the words above scroll; they still come after the words in the reading order. */}
        <div className="consent-actions">
          <button type="button" className="pop-cta" data-testid="consent-start" disabled={provider === null} onClick={() => { if (provider !== null) onStart(readingConsentText(t, provider), provider); }}>
            {t.consentStart}
          </button>
          <button type="button" className="pop-cta" data-testid="consent-not-now" onClick={onNotNow} style={{ marginTop: 8 }}>
            {t.consentNotNow}
          </button>
        </div>
      </div>
    </div>
  );
}
