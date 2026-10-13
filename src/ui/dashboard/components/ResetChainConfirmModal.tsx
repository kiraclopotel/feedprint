import { useEffect, useRef, useState } from 'react';
import type { ResetForensicChainResponse } from '../../../types/messages';
import type { ResetChainResult } from '../../../forensics/store';
import { getSettings, verifyPin, pinLockRemainingMs } from '../../../storage/settings';
import { clearSetupDraft } from '../../../storage/setup-draft';
import { useDashboardT } from '../../../i18n/react';
import type { DashboardStrings } from '../../../i18n/dashboard-strings';
import { resetModalStatusLine, incompleteResetParts, resetPartLabel, type ResetModalError, type ResetPartKey } from '../reset-modal-status';

/** Three lines a person reads before confirming; the full account of what moves and what is cleared stays one
 *  click away, so the confirm step is not lost under it. */
function ResetSummary({ t }: { t: DashboardStrings }) {
  return (
    <>
      <p style={{ margin: '0 0 4px' }}><b>{t.resetLead1}</b></p>
      <p style={{ margin: '0 0 4px' }}>{t.resetLead2}</p>
      <p style={{ margin: '0 0 8px' }}>{t.resetLead3}</p>
      <details style={{ margin: '0 0 12px' }}>
        <summary>{t.resetMoreTitle}</summary>
        <p>
          {t.resetBody1}<b>{t.resetBodyBold1}</b>{t.resetBody2}<b>{t.resetBodyBold2}</b>{t.resetBody3}
        </p>
      </details>
    </>
  );
}

// ─── Reset-chain confirm modal ───
// (The re-anchor "Fix record" modal was removed 2026-06-11. The legacy
// key-mismatch path re-anchors automatically while retaining affected records
// as pre-rekey/unverified; structural corruption is never re-anchored.)
//
// Two ways to confirm, one modal. Where a PIN exists it is the gate, checked
// here and again in the service worker, unchanged. Where none exists the modal
// used to refuse the reset outright and send the parent to the popup to set
// one: on an adult install, which never sets a PIN, that made the reset button
// do nothing at all, which is what the owner reported on 14 Sep 2026. A no-PIN
// install now confirms by typing the product's own word (t.resetConfirmWord,
// or the English "reset" in any language). That is a deliberate act, not a
// gate: with no PIN there is no secret to check, and the same reasoning
// already governs RESTORE_FORENSIC_BACKUP, which can replace the whole chain
// and the signing key with it.
export function ResetChainConfirmModal({
  onClose, onSuccess, onUnknown,
}: {
  onClose: () => void;
  onSuccess: (r: ResetChainResult) => void;
  /**
   * The outcome could not be confirmed (no response, or the channel died):
   * the parent re-reads the chain so the screen shows what is there, instead
   * of a record list that may already be wiped (D2-8).
   */
  onUnknown?: () => void;
}) {
  const t = useDashboardT();
  const [digits, setDigits] = useState(['', '', '', '']);
  const [error, setError] = useState<ResetModalError>(null);
  // Non-empty = the chain reset committed but these sidecar wipes did not
  // finish. The modal stays open to say so instead of reporting a clean
  // success (known-issues M58).
  const [partialParts, setPartialParts] = useState<ResetPartKey[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [lockSeconds, setLockSeconds] = useState(0);
  const [noPin, setNoPin] = useState<boolean | null>(null);
  // The no-PIN path's typed confirmation.
  const [word, setWord] = useState('');
  // The lock countdown ticks; a frozen number read as a broken modal, and the
  // inputs stayed live under it (D2-31).
  useEffect(() => {
    if (lockSeconds <= 0) return;
    const id = window.setInterval(() => setLockSeconds(s => (s > 1 ? s - 1 : 0)), 1000);
    return () => window.clearInterval(id);
  }, [lockSeconds > 0]);
  const locked = lockSeconds > 0;
  const refs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];
  const wordRef = useRef<HTMLInputElement>(null);

  /**
   * Send the reset and read the answer. `pin` is undefined on a no-PIN
   * install, where the service worker's gate has nothing to check; every other
   * outcome (no response, a refusal, a partial wipe) is the same on both paths.
   */
  const commitReset = async (pin?: string): Promise<void> => {
    setBusy(true);
    try {
      // F2: the PIN rides in the payload because the SW re-verifies it against
      // the stored hash before wiping — the verifyPin() call in the digit
      // handler is fast local feedback, not the gate.
      const response = await chrome.runtime.sendMessage({
        type: 'RESET_FORENSIC_CHAIN',
        payload: pin === undefined ? {} : { pin },
      }) as ResetForensicChainResponse | undefined;
      if (!response) {
        // The worker may have committed and the response channel died: the
        // outcome is UNKNOWN, not failed (known-issues M58).
        console.error('[fw] reset chain: no response, outcome unknown');
        setBusy(false);
        setError('reset-unknown');
        return;
      }
      if (!response.ok || !response.result) {
        console.error('[fw] reset chain failed', response.error);
        setBusy(false);
        if (response.errorKind === 'pin-invalid' && pin !== undefined) {
          // The SW's authoritative check disagreed with the local one (e.g.
          // the PIN changed between the modal check and the SW verify): same
          // re-enter UX as a locally wrong PIN.
          setError('wrong-pin');
          setTimeout(() => {
            setDigits(['', '', '', '']);
            setError(null);
            refs[0].current?.focus();
          }, 600);
          return;
        }
        setError(response.errorKind === 'reset-refused' ? 'reset-refused' : 'reset-failed');
        return;
      }
      const parts = incompleteResetParts(response.result);
      onSuccess(response.result);
      // Nothing of the first run is left to come back to: the draft the setup
      // wizard keeps goes with the record it belongs to.
      void clearSetupDraft();
      if (parts.length === 0) {
        onClose();
        return;
      }
      setBusy(false);
      setPartialParts(parts);
    } catch (e) {
      // sendMessage rejected: transport-level failure, so whether the worker
      // received or committed the reset is unknown.
      console.error('[fw] reset chain response lost, outcome unknown', e);
      setBusy(false);
      setError('reset-unknown');
    }
  };

  /**
   * The word that confirms a reset where no PIN exists. Case and surrounding
   * spaces are not part of the act. The product's own word in the parent's
   * language is accepted, and so is the English one, which is what every
   * screenshot and every instruction written in English names.
   */
  const wordMatches = (typed: string): boolean => {
    const norm = typed.trim().toLowerCase();
    return norm.length > 0 && (norm === t.resetConfirmWord.trim().toLowerCase() || norm === 'reset');
  };

  const submitWord = async (): Promise<void> => {
    if (busy || partialParts !== null) return;
    if (!wordMatches(word)) { setError('wrong-word'); return; }
    setError(null);
    await commitReset(undefined);
  };

  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    getSettings().then(s => {
      setNoPin(!s.parentPin);
      if (s.parentPin) refs[0].current?.focus();
      else wordRef.current?.focus();
    }).catch((e) => console.error(e));
    // Escape closed this gate from the day it was written. Tab walked straight
    // out of it, and closing it gave focus to nothing.
    //
    // popup/controls.tsx said so in its own comment on 2026-09-19, one day
    // after this file was written, as its reason for building both: it added a
    // focus trap and focus restore "because that model does not have them
    // either". It was right, it was never carried back, and this is the dialog
    // that wipes the chain. A keyboard user tabbing off its last control landed
    // on the dashboard behind a backdrop they could still see through, and
    // closing it left focus at the top of the document rather than on the
    // button they opened it from.
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previouslyFocused.current?.focus?.();
    };
  }, []);

  const handleDigit = async (i: number, v: string) => {
    if (locked) return;
    if (!/^\d?$/.test(v)) return;
    const next = [...digits]; next[i] = v;
    setDigits(next);
    setError(null);
    if (v && i < 3) refs[i + 1].current?.focus();
    if (v && i === 3) {
      const pin = next.join('');
      const ok = await verifyPin(pin);
      if (!ok) {
        // Q26: after repeated misses the gate locks; refusing the correct
        // PIN silently would read as a broken modal, so name the wait.
        const lockMs = await pinLockRemainingMs();
        setLockSeconds(lockMs > 0 ? Math.ceil(lockMs / 1000) : 0);
        setError('wrong-pin');
        setTimeout(() => {
          setDigits(['', '', '', '']);
          if (lockMs <= 0) setError(null);
          refs[0].current?.focus();
        }, 600);
        return;
      }
      await commitReset(pin);
    }
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) refs[i - 1].current?.focus();
  };

  if (noPin === null) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="reset-title">
      <div className="modal" ref={panelRef}>
        {noPin ? (
          <>
            {/* The same warning as the PIN path: what a reset does is not
                softer because this install has no PIN. Only the confirmation
                differs. */}
            <h2 id="reset-title">{t.resetTitle}</h2>
            <ResetSummary t={t} />
            <div style={{ fontSize: 12 }}>{t.enterWordToConfirm(t.resetConfirmWord)}</div>
            <input
              ref={wordRef}
              type="text"
              value={word}
              data-testid="reset-confirm-word"
              spellCheck={false}
              autoComplete="off"
              disabled={busy || partialParts !== null}
              onChange={(e) => { setWord(e.target.value); if (error === 'wrong-word') setError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { void submitWord(); } }}
              aria-label={t.enterWordToConfirm(t.resetConfirmWord)}
              className="key-input"
              style={{ width: '100%', marginTop: 8 }}
            />
            <div style={{ fontSize: 12, color: 'var(--fw-red)', minHeight: 16 }}>
              {partialParts
                ? `${t.resetPartial} (${partialParts.map((k) => resetPartLabel(k, t)).join(', ')})`
                : resetModalStatusLine(error, busy, t)}
            </div>
            <div className="modal-actions">
              {error === 'reset-unknown' && onUnknown && (
                <button type="button" className="btn primary" onClick={() => { onUnknown(); onClose(); }}>
                  {t.resetReloadBtn}
                </button>
              )}
              <button type="button" className="btn" onClick={onClose} disabled={busy}>
                {partialParts ? t.ok : t.cancel}
              </button>
              {!partialParts && (
                <button
                  type="button"
                  className="btn primary"
                  data-testid="reset-confirm-word-btn"
                  disabled={busy || !wordMatches(word)}
                  onClick={() => { void submitWord(); }}
                >{t.resetConfirmBtn}</button>
              )}
            </div>
          </>
        ) : (
          <>
            <h2 id="reset-title">{t.resetTitle}</h2>
            <ResetSummary t={t} />
            <div style={{ fontSize: 12 }}>{t.enterPinToConfirm}</div>
            <div className="pin-row">
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={refs[i]}
                  type="tel"
                  inputMode="numeric"
                  maxLength={1}
                  value={d}
                  onChange={(e) => { void handleDigit(i, e.target.value); }}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  disabled={busy || locked || partialParts !== null}
                  className="pin-input"
                  aria-label={t.pinDigitAria(i + 1)}
                />
              ))}
            </div>
            <div style={{ fontSize: 12, color: 'var(--fw-red)', minHeight: 16 }}>
              {partialParts
                ? `${t.resetPartial} (${partialParts.map((k) => resetPartLabel(k, t)).join(', ')})`
                : locked
                  ? t.pinLockedFor(lockSeconds)
                  : resetModalStatusLine(error, busy, t)}
            </div>
            <div className="modal-actions">
              {error === 'reset-unknown' && onUnknown && (
                <button type="button" className="btn primary" onClick={() => { onUnknown(); onClose(); }}>
                  {t.resetReloadBtn}
                </button>
              )}
              <button type="button" className="btn" onClick={onClose} disabled={busy}>
                {partialParts ? t.ok : t.cancel}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
