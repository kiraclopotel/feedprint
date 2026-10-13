// FeelingWise — popup controls shared by the Receipts popup and the Off popup.
//
// Moved out of Popup.tsx on 2026-09-02 so the Off product can reuse the
// exact same switch, row and PIN surfaces without carrying the 2,000-line
// Receipts popup. Bodies are unchanged.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import {
  verifyPin, pinLockRemainingMs, hasRecoveryPhrase, resetPinWithRecoveryPhrase, changePin, removePin,
  generateRecoveryPhrase, setRecoveryPhrase, setPin, getSettings, parentPinUnknown,
} from '../../storage/settings';
import { Eye, EyeOff, Info as InfoIcon, Lock as LockIcon } from '../shared/icons/lucide';
import { usePopupT } from '../../i18n/react';
import { StatusLine } from '../shared/StatusLine';
import { isOffProduct } from '../../product';
import { flushSync } from 'react-dom';

// ─── Arrow keys in a group of radios or tabs ───
//
// A radiogroup or a tablist is one Tab stop: its chosen member takes the Tab key and the arrow keys, Home and End move
// among the rest. A group with nothing chosen keeps its first member on the Tab path, so it is never out of reach.
// `choose` makes the move the choice too, for a group whose choice costs nothing (tabs, the style dots). The level
// buttons leave it out: a level can ask for a PIN or wipe custom switches, so a pass over one with the arrow keys only
// moves the focus and Enter or Space chooses.
const GROUP_MEMBER = '[role="radio"], [role="tab"]';
const GROUP_KEY_TARGET: Record<string, (from: number, last: number) => number> = {
  ArrowRight: (from, last) => (from >= last ? 0 : from + 1),
  ArrowLeft: (from, last) => (from <= 0 ? last : from - 1),
  Home: () => 0,
  End: (_from, last) => last,
};

export function rovingGroup(checkedIndex: number, choose?: (index: number) => void): {
  onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
  tabIndexOf: (index: number) => 0 | -1;
} {
  const tabStop = Math.max(checkedIndex, 0);
  return {
    tabIndexOf: (index) => (index === tabStop ? 0 : -1),
    onKeyDown: (e) => {
      const target = GROUP_KEY_TARGET[e.key];
      if (!target || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      const members = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(GROUP_MEMBER));
      const from = members.indexOf(e.target as HTMLElement);
      if (from < 0) return;
      e.preventDefault();
      const to = target(from, members.length - 1);
      members[to]?.focus();
      choose?.(to);
    },
  };
}

// ─── Toggle ───
// `disabled` renders the switch in an informational state (visible but
// inert) — used when a mode makes the setting moot, e.g. Strict language
// in child mode. Hiding the row instead would read as a broken control.
//
// The former third state (`unavailable`, D8) died with Q86: license-gated
// rows no longer render at all without a license, so there is no tier
// state left to paint. The D8 invariant survives in a stronger form —
// stored values are never masked because unlicensed rows are never drawn,
// and presets keep seeding them so paying later reveals correct defaults.
// A disabled switch used to render at 0.45 opacity in BOTH states, which made a
// locked-ON control look like an OFF one: in child mode the rows that are forced
// on and locked were read as switches that had failed to turn on (2026-08-18,
// RECON F4). Those rows are Strict language and, since 2026-09-19, soften
// swearing. This named a rewrite-failure hide switch as the second one until
// then; that row was removed on 2026-09-07 and the phrase appears nowhere a
// reader could find it, so the comment asserted a locked child protection that
// is not on any screen. Locked-ON
// therefore paints at full strength and wears a padlock; only locked-OFF dims,
// where paleness means what it says.
export function Toggle({ on, onClick, label, disabled, heldByLevel }: {
  on: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  /** The level fixes this switch (Strict). Only then does a locked-off switch wear a padlock; a disabled switch that
   *  waits for a key or does not apply here is dimmed and has none (F37). */
  heldByLevel?: boolean;
}) {
  const lockedOn = on && !!disabled;
  return (
    // `disabled` used to sit here too, which removes a button from the tab
    // order entirely: a switch locked ON in child mode vanished from a screen reader's
    // and a keyboard user's world instead of announcing why it cannot be
    // changed (accessibility audit, 2026-09-18). aria-disabled keeps it
    // reachable; every call site that passes `disabled` already guards its
    // own onClick against acting while locked, so the click stays a no-op.
    <button
      role="switch" aria-checked={on} aria-label={label}
      aria-disabled={disabled || undefined}
      className={`toggle ${on ? 'on' : 'off'}${lockedOn ? ' locked-on' : ''}`}
      onClick={onClick}
      style={disabled ? { cursor: 'not-allowed', ...(lockedOn || heldByLevel ? {} : { opacity: 0.45 }) } : undefined}
    >
      {/* One locked look for every locked switch (B2F, P3-3): a locked-ON one draws its padlock in the knob
          (CSS, .locked-on); a locked-OFF one had none, so it read as merely faded. Its padlock sits in the
          resting knob, on the left. */}
      {disabled && !on && heldByLevel && (
        <span className="toggle-lock" aria-hidden="true" style={{ position: 'absolute', top: 7, left: 7, width: 10, height: 10, display: 'flex', color: 'var(--fw-card)', pointerEvents: 'none', zIndex: 1 }}>
          <LockIcon size={10} />
        </span>
      )}
    </button>
  );
}

// ─── Settings row (Q86) ───
// One visible line per setting: the name, an optional BETA pill, and — when
// a longer explanation exists — a small info button that folds it open.
// `note` is STATE, not explanation (locked-on lines, breaker-off line,
// quiet-hours schedule), so it stays always-visible under the name, unless the
// row is `quiet`: then the note sits right under the name as a quiet line, so a
// screen reader reads it before the switch, and the (i) fold keeps only the
// description (his word, 9 Oct 2026: a state line set apart under a switch was
// one sentence too many).
export function FeatRow({ name, desc, shown, note, noteColor, beta, stack, quiet, noteInFold, control }: {
  name: string;
  desc?: string;
  note?: ReactNode;
  noteColor?: string;
  beta?: boolean;
  /**
   * Put the control under the name instead of beside it.
   *
   * A row is a flex line and the control keeps its intrinsic width, so a
   * control that is wide because of its own contents squeezes the name. The
   * language dropdown is exactly that: its width is its longest option, and
   * in Spanish and Brazilian Portuguese those options left the row's name 39
   * pixels of a 322 pixel row and the words were cut off, measured in a real
   * layout engine on 2026-09-17. The Receipts settings panel already stacks
   * that row by hand; this is the same shape, shared, so the next wide control
   * does not have to rediscover it.
   */
  stack?: boolean;
  /**
   * The note is the switch's state (why it is locked, or on because of another switch): said once, in small words under
   * the name, so a screen reader reads it before the switch. The (i) fold keeps only the description. Until 9 Oct 2026
   * it was a tooltip and a line inside the fold, which a screen reader never announced.
   */
  quiet?: boolean;
  /**
   * The description is one short line shown under the name, with no (i) fold. For a switch a parent cannot read from
   * its name alone (the parent scout, 9 Oct 2026: "Show reframe markers" and "Strict language" were unexplained).
   */
  shown?: boolean;
  /**
   * A quiet note opens with the (i), above the description, instead of a line under the name: for a switch whose own
   * label already says its state to a screen reader (the swear mask at Silent, 13 Oct 2026: the line ran the page past
   * the popup).
   */
  noteInFold?: boolean;
  control: ReactNode;
}) {
  const t = usePopupT();
  const [open, setOpen] = useState(false);
  const quietNote = quiet && note && !noteInFold ? note : null;
  const fold = shown ? undefined : desc;
  return (
    <div
      className="feat-row"
      style={stack ? { flexDirection: 'column', alignItems: 'stretch', gap: 8 } : undefined}
    >
      <div className="fr-body" style={stack ? { width: '100%' } : undefined}>
        <div className="fr-name">
          {/* The last word keeps the (i) beside it, so a long name never leaves the icon alone on a line (12 Oct 2026).
              Chrome breaks before an inline button whatever character joins it; only a nowrap span holds them. */}
          {name.slice(0, name.lastIndexOf(' ') + 1)}<span className="fr-tail">{name.slice(name.lastIndexOf(' ') + 1)}
          {beta && <span className="beta-pill" style={{ marginLeft: 8 }}>BETA</span>}
          {fold && (
            <button
              type="button"
              className="fr-info"
              aria-label={`${t.rowInfoAria}: ${name}`}
              aria-expanded={open}
              onClick={() => setOpen(o => !o)}
            >
              <InfoIcon size={13} />
            </button>
          )}</span>
        </div>
        {shown && desc && <div className="fr-desc fr-line">{desc}</div>}
        {quietNote && <div className="fr-desc fr-state">{quietNote}</div>}
        {open && noteInFold && note && <div className="fr-desc fr-state">{note}</div>}
        {open && desc && <div className="fr-desc">{desc}</div>}
        {note && !quiet && (
          <div className="fr-desc" style={noteColor ? { color: noteColor } : undefined}>{note}</div>
        )}
      </div>
      {control}
    </div>
  );
}

// Hand focus to the first box of `row` when that row is still empty. The fourth digit of a row calls this for the
// row below it; a row already being filled keeps the person where they are (PA unit 4, M3 and F-B1b).
export function focusRowIfEmpty(row: HTMLElement | null, values: string[]): void {
  if (values.every(d => d === '')) row?.querySelector('input')?.focus();
}

// ─── PIN-digit row ───
// The digits show as discs (a PIN on screen can be read over a shoulder, the very person it keeps out), and a control
// at the end of the row shows them only while it is held (PA unit 1, S-2). The boxes stay type=tel so the phone
// keyboard is the number pad; the masking is a presentation style, not a password field, so no browser offers to
// save it.
export function PinDigits({
  value, set, autoFocus, onComplete,
}: {
  value: string[];
  set: (v: string[]) => void;
  autoFocus?: boolean;
  onComplete?: (pin: string) => void;
}) {
  const t = usePopupT();
  const [shown, setShown] = useState(false);
  // The box the person was in before they pressed the show control (PA unit 5, S14 P1).
  const lastBox = useRef<number | null>(null);
  const refs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];
  useEffect(() => { if (autoFocus) refs[0].current?.focus(); }, [autoFocus]);
  // When the row is cleared (a wrong PIN), the next digit belongs in the first box. Left on the
  // last one, a PIN typed straight away fills the boxes out of order and nothing says why.
  const cleared = value.every(d => d === '');
  useEffect(() => {
    if (!cleared) return;
    const active = document.activeElement;
    if (refs.slice(1).some(r => r.current === active)) refs[0].current?.focus();
  }, [cleared]);
  const handle = (i: number, v: string) => {
    if (!/^\d?$/.test(v)) return;
    const next = [...value]; next[i] = v;
    set(next);
    if (v && i < 3) refs[i + 1].current?.focus();
    if (v && i === 3 && onComplete) {
      const pin = next.join('');
      if (pin.length === 4) onComplete(pin);
    }
  };
  // Releasing the show control (or leaving it while held) hides the digits and gives the focus back to the box the
  // person came from. Left on the control, the next digits typed went nowhere (PA unit 5, S14 P1). The focus moves
  // only if the digits were being held shown, so a pointer that merely passes over the control (or a keyboard user
  // resting on it) takes nothing. A mouse press leaves the focus on the page body, not on the control (PA5F), so the
  // focus is handed back when it is on the control or on nothing; focus that has gone to another element stays there.
  const showBtn = useRef<HTMLButtonElement>(null);
  // The PIN box that held the focus when the pointer went down, before the press moved it: the person may have pressed
  // this row's eye while typing in another row (Choose, then Confirm), and that is where the typing goes on (PA5F).
  const cameFrom = useRef<HTMLInputElement | null>(null);
  const press = () => {
    const a = document.activeElement;
    cameFrom.current = a instanceof HTMLInputElement && a.classList.contains('pin-box') ? a : null;
    setShown(true);
  };
  const release = () => {
    setShown(false);
    const from = cameFrom.current;
    cameFrom.current = null;
    if (!shown) return;
    const active = document.activeElement;
    if (active && active !== document.body && active !== showBtn.current) return;
    // The first empty box of this row when there is one (PA3); else the box the person came from, else the last one.
    const firstEmpty = value.findIndex(d => d === '');
    if (firstEmpty !== -1) refs[firstEmpty].current?.focus();
    else if (from && from.isConnected) from.focus();
    else refs[lastBox.current ?? 3].current?.focus();
  };
  return (
    <div className="pin-row" style={{ position: 'relative' }}>
      {value.map((d, i) => (
        <input
          key={i}
          ref={refs[i]}
          type="tel" inputMode="numeric" maxLength={1}
          aria-label={t.pinDigitAria(i + 1)}
          value={d}
          onFocus={() => { lastBox.current = i; }}
          onChange={e => handle(i, e.target.value)}
          onKeyDown={e => { if (e.key === 'Backspace' && !value[i] && i > 0) refs[i - 1].current?.focus(); }}
          className={`pin-box ${d ? 'filled' : ''}`}
          data-masked={shown ? 'false' : 'true'}
          style={{ WebkitTextSecurity: shown ? 'none' : 'disc', ...(shown ? {} : { fontSize: 28 }) } as CSSProperties}
        />
      ))}
      <button
        type="button"
        ref={showBtn}
        data-pin-show="1"
        aria-label={t.pinShowHold}
        title={t.pinShowHold}
        onPointerDown={press}
        onPointerUp={release}
        onPointerLeave={release}
        onPointerCancel={release}
        onBlur={() => setShown(false)}
        onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setShown(true); } }}
        onKeyUp={e => { if (e.key === ' ' || e.key === 'Enter') release(); }}
        style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--fw-muted)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24,
          position: 'absolute', left: 'calc(50% + 96px)', top: '50%', transform: 'translateY(-50%)',
        }}
      >
        <span style={{ display: 'inline-flex', pointerEvents: 'none' }}>{shown ? <EyeOff size={14} /> : <Eye size={14} />}</span>
      </button>
    </div>
  );
}

// The Save button sits below the room the error slot keeps; when the confirm row is complete it is brought into view (L3).
// A script that has no layout (a test page) has no scrollIntoView.
function bringIntoView(el: HTMLElement | null): void {
  if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
}
// ─── The error line of a PIN screen keeps its room (L3) ───
// The slot is always there; the line appears inside it, so a wrong PIN or two PINs that differ move neither the panel
// nor the Save button. The line is still conditional, so what a screen reader hears does not change.
function PinErrSlot({ children }: { children: ReactNode }) {
  return <div className="pin-err-slot">{children}</div>;
}
function PinErr({ children }: { children: ReactNode }) {
  return <StatusLine tone="alert" className="pin-err">{children}</StatusLine>;
}

// ─── PIN reset via recovery phrase (UX-I18N-A11Y-1) ───
export function PinRecoveryForm({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const t = usePopupT();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [phrase, setPhrase] = useState('');
  const [pin, setPinDigits] = useState<string[]>(['', '', '', '']);
  const [pinConfirm, setPinConfirmDigits] = useState<string[]>(['', '', '', '']);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const phraseRef = useRef<HTMLInputElement>(null);
  const confirmRowRef = useRef<HTMLFieldSetElement>(null);
  const noPhraseCancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    hasRecoveryPhrase().then(setAvailable, () => setAvailable(false));
  }, []);
  // Initial focus (accessibility audit, 2026-09-18): this screen replaces the
  // PIN overlay's own content, which autofocuses its first digit box, so
  // without this a screen reader user who pressed "Forgot PIN?" landed with
  // focus wherever it happened to sit before, on a screen that had moved on
  // without them.
  useEffect(() => {
    if (available === true) phraseRef.current?.focus();
    else if (available === false) noPhraseCancelRef.current?.focus();
  }, [available]);
  const newPin = pin.join('');
  const ready = phrase.trim().length > 0 && newPin.length === 4 && newPin === pinConfirm.join('');
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const ok = await resetPinWithRecoveryPhrase(phrase, newPin);
      if (ok) { onSuccess(); return; }
      const lockMs = await pinLockRemainingMs();
      setError(lockMs > 0 ? t.pinLockedFor(Math.ceil(lockMs / 1000)) : t.pinRecoveryWrong);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };
  if (available === null) return null;
  // The Cancel line here and below used to be a <div onClick>: it painted
  // like a link but a keyboard has no way to activate a div (accessibility
  // audit, 2026-09-18). A real <button> with the same inline style keeps the
  // muted, borderless look (the pattern already used for KeysTab's own
  // "Remove license" link) while restoring Tab and Enter/Space.
  const cancelLinkStyle = { fontSize: 12, color: 'var(--fw-muted)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' } as const;
  if (!available) {
    return (
      <>
        <p className="tag" style={{ margin: 0 }}>{isOffProduct() ? t.pinRecoveryNoneOff : t.pinRecoveryNone}</p>
        <button ref={noPhraseCancelRef} type="button" className="lnk" onClick={onCancel} style={{ ...cancelLinkStyle, marginTop: 14 }}>{t.cancel}</button>
      </>
    );
  }
  // Each PinDigits group repeats the same "digit 1 of 4" aria-label with
  // nothing to say which group it belongs to (accessibility audit,
  // 2026-09-18: controls.tsx:138 read identically for both the new PIN and
  // its confirmation). A fieldset/legend gives the group the name a screen
  // reader announces before the digits, reusing the same text already
  // printed above each group instead of a second copy of it.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3 style={{ margin: 0 }}>{t.pinRecoveryTitle}</h3>
      <label style={{ fontSize: 11, color: 'var(--fw-muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {t.pinRecoveryPhraseLabel}
        <input
          ref={phraseRef}
          type="text"
          className="key-input"
          autoComplete="off"
          value={phrase}
          onChange={e => setPhrase(e.target.value)}
          aria-label={t.pinRecoveryPhraseLabel}
          style={{ fontFamily: 'monospace', fontSize: 14, textTransform: 'uppercase' }}
        />
      </label>
      <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
        <legend className="pin-legend">{t.pinRecoveryNewPin}</legend>
        <PinDigits value={pin} set={setPinDigits} onComplete={() => focusRowIfEmpty(confirmRowRef.current, pinConfirm)} />
      </fieldset>
      <fieldset ref={confirmRowRef} style={{ border: 'none', margin: 0, padding: 0 }}>
        <legend className="pin-legend">{t.pinRecoveryConfirmPin}</legend>
        <PinDigits value={pinConfirm} set={setPinConfirmDigits} />
      </fieldset>
      <PinErrSlot>{error && <PinErr>{error}</PinErr>}</PinErrSlot>
      <button className="pop-cta" disabled={!ready || busy} onClick={() => { void submit(); }}>{t.pinRecoveryReset}</button>
      <button type="button" className="lnk" onClick={onCancel} style={{ ...cancelLinkStyle, textAlign: 'center' }}>{t.cancel}</button>
    </div>
  );
}

// ─── PIN overlay ───
//
// The dialog roles, initial focus and Escape handling below copy the shape
// already established by the dashboard's ResetChainConfirmModal (the one
// other PIN-gated modal in this codebase); the focus trap and focus restore
// are added here because that model does not have them either
// (accessibility audit, 2026-09-18: this overlay had none of the five - no
// role="dialog", no aria-modal, no focus trap, no initial focus beyond what
// PinDigits already did for itself, and no focus restore on close - and its
// only exits other than a correct PIN were a <div onClick> backdrop and a
// <div onClick> Cancel line, neither reachable from a keyboard).
// onRetry is given only where the settings could not be read but a PIN is known to exist (Off's
// lock after a failed read). Then a PIN that does not verify may be the read failing, not a wrong
// PIN: the panel says the settings could not be read and offers Retry, and does not call it wrong.
// onReset is called instead of onSuccess when the PIN was reset with the recovery phrase, so the caller can say so;
// notice is a line shown above the PIN boxes (Off: "PIN changed." after a reset that leaves the lock in place).
export function PinOverlay({ onSuccess, onCancel, onRetry, onReset, notice }: {
  onSuccess: () => void; onCancel: () => void; onRetry?: () => void; onReset?: () => void; notice?: string;
}) {
  const t = usePopupT();
  const [digits, setDigits] = useState<string[]>(['', '', '', '']);
  const [error, setError] = useState(false);
  const [forgot, setForgot] = useState(false);
  // Q26: after repeated misses verifyPin locks the gate; a silent refusal
  // of the CORRECT pin would read as a broken keypad, so name the wait.
  const [lockSeconds, setLockSeconds] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  // After a wrong PIN the wrong digits clear at once and the message goes at 3 s. The timer is kept so closing the
  // panel leaves nothing running (PA unit 2, S-3). The row used to stay for 600 ms with the focus on its full fourth
  // box, which refuses input: a right PIN typed straight on lost every digit in that time (PAW, S17 PA2).
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopTimers = () => {
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = null;
  };
  useEffect(() => stopTimers, []);
  // Checking a PIN takes real time, and the fourth box is full meanwhile, so it refuses the digits of a person who goes
  // straight on. The digit keys pressed while a check runs are kept here and start the new row when a wrong PIN comes
  // back (four of them are checked at once); if the PIN was right they are dropped (PAW).
  const checking = useRef(false);
  const buffered = useRef<string[]>([]);

  // Focus restore: remember whatever had focus before this gate opened (the
  // Settings gear, the "Change PIN" link, the License tab's Remove button)
  // and give it back on close, whichever of onSuccess/onCancel closed it.
  // A layout effect (RS3): PinDigits takes the focus on its first box in a passive effect, and a
  // passive effect here ran after it, so the gate remembered its own box and gave the focus to a
  // box that was gone.
  useLayoutEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    return () => { previouslyFocused.current?.focus?.(); };
  }, []);

  // Escape closes the gate exactly like the visible Cancel line, and Tab is
  // trapped inside the panel so it cannot walk out into the controls the
  // overlay paints over (SettingsPanel renders this mid-document, and tab
  // order otherwise ran straight through it).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCancel(); return; }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusables = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])',
      ));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      // Focus is outside the panel (or nowhere): bring it in at the end the key points to (RS2).
      if (!active || !panelRef.current.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      // Inside, the browser moves the focus on its own except past the ends. A place that is not in the list (the panel itself,
      // a line of text that a click focused) counts the controls before and after it, as the reading screen does (RS1).
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
  }, [onCancel]);

  // The row after a refusal: empty, or holding the digits typed while the check ran (and checked at once if it is whole).
  const startNextRow = () => {
    const typed = buffered.current;
    buffered.current = [];
    flushSync(() => setDigits([...typed, '', '', '', ''].slice(0, 4)));
    if (typed.length === 4) { void tryPin(typed.join('')).catch(() => { checking.current = false; }); return; }
    panelRef.current?.querySelectorAll<HTMLInputElement>('input.pin-box')[typed.length]?.focus();
    checking.current = false;
  };
  const tryPin = async (pin: string) => {
    checking.current = true;
    buffered.current = [];
    const ok = await verifyPin(pin);
    if (ok) { checking.current = false; onSuccess(); return; }
    if (onRetry) {
      const fresh = await getSettings().catch(() => null);
      if (fresh === null || parentPinUnknown(fresh)) {
        startNextRow();
        return;
      }
    }
    const lockMs = await pinLockRemainingMs();
    setLockSeconds(lockMs > 0 ? Math.ceil(lockMs / 1000) : 0);
    setError(true);
    // The status line keeps its 3 seconds (accessibility audit, 2026-09-18: 600ms is not enough for a screen
    // reader to reach and read it); the wrong digits do not need them and clear now, which also hands the focus
    // back to the first box (the row is empty again: PinDigits moves the focus from a later box to box 1).
    stopTimers();
    startNextRow();
    errorTimer.current = setTimeout(() => { errorTimer.current = null; setError(false); }, 3000);
  };
  return (
    <div
      className="pin-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={forgot ? t.pinRecoveryTitle : t.pinTitle}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        ref={panelRef}
        className={`panel ${error ? 'shake' : ''}`}
        onKeyDownCapture={e => {
          if (!checking.current || !/^\d$/.test(e.key)) return;
          e.preventDefault();
          if (buffered.current.length < 4) buffered.current.push(e.key);
        }}
      >
        {forgot ? (
          <PinRecoveryForm onSuccess={onReset ?? onSuccess} onCancel={onCancel} />
        ) : (
          <>
            {notice && <StatusLine tone="status" style={{ fontSize: 11, marginBottom: 8 }}>{notice}</StatusLine>}
            {onRetry && (
              <div role="alert" style={{ marginBottom: 10 }}>
                <PinErr>{t.loadFailedBodyOff}</PinErr>
                <button type="button" className="lnk" onClick={onRetry}>{t.retry}</button>
              </div>
            )}
            <h3>{t.pinTitle}</h3>
            <PinDigits value={digits} set={setDigits} autoFocus onComplete={(pin) => { void tryPin(pin).catch(() => { checking.current = false; }); }} />
            <PinErrSlot>
              {error && (
                // The shake animation this panel already carries (className
                // "shake") signals the wrong PIN by motion and colour only;
                // this line is the fix, since it says in words what happened
                // (accessibility audit, 2026-09-18).
                <PinErr>{lockSeconds > 0 ? t.pinLockedFor(lockSeconds) : t.pinIncorrect}</PinErr>
              )}
            </PinErrSlot>
            {/* Two controls, one above the other: side by side with no gap they read as one
                run of text, "Forgot PIN?Cancel". */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginTop: 12 }}>
              <button type="button" className="lnk" onClick={() => setForgot(true)}>{t.pinForgot}</button>
              <button
                type="button"
                className="lnk"
                onClick={onCancel}
                style={{ fontSize: 12, color: 'var(--fw-muted)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
              >
                {t.cancel}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Change PIN (Settings row) ───
export function ChangePinPanel({ onDone }: { onDone: () => void }) {
  const t = usePopupT();
  const [current, setCurrent] = useState<string[]>(['', '', '', '']);
  const [next, setNext] = useState<string[]>(['', '', '', '']);
  const [confirm, setConfirm] = useState<string[]>(['', '', '', '']);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const nextRowRef = useRef<HTMLFieldSetElement>(null);
  const confirmRowRef = useRef<HTMLFieldSetElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  // Installs that set their PIN before recovery phrases existed get one
  // here, shown once, after the PIN change succeeds.
  const [phrase, setPhrase] = useState<string | null>(null);
  const nextPin = next.join('');
  const ready = current.join('').length === 4 && nextPin.length === 4 && nextPin === confirm.join('');
  // Q3 (29 Sep 2026): two new PINs that differ used to leave Save dimmed and say nothing.
  const nextMismatch = nextPin.length === 4 && confirm.join('').length === 4 && nextPin !== confirm.join('');
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const ok = await changePin(current.join(''), nextPin);
      if (!ok) {
        const lockMs = await pinLockRemainingMs();
        setError(lockMs > 0 ? t.pinLockedFor(Math.ceil(lockMs / 1000)) : t.changePinWrong);
        setCurrent(['', '', '', '']);
        return;
      }
      if (!(await hasRecoveryPhrase())) {
        const fresh = generateRecoveryPhrase();
        await setRecoveryPhrase(fresh);
        setPhrase(fresh);
        return;
      }
      onDone();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };
  if (phrase) return <RecoveryPhraseCard phrase={phrase} onConfirm={onDone} />;
  // Three PinDigits groups in a row, each with the same "digit 1 of 4"
  // aria-label and nothing telling current apart from new and confirm
  // (accessibility audit, 2026-09-18, naming controls.tsx:292,294,296). A
  // fieldset/legend per group gives it the name a screen reader announces
  // ahead of the digits, reusing the caption already printed above it.
  return (
    <div className="pin-panel" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
      <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
        <legend className="pin-legend">{t.changePinCurrent}</legend>
        <PinDigits value={current} set={setCurrent} autoFocus onComplete={() => focusRowIfEmpty(nextRowRef.current, next)} />
      </fieldset>
      <fieldset ref={nextRowRef} style={{ border: 'none', margin: 0, padding: 0 }}>
        <legend className="pin-legend">{t.pinRecoveryNewPin}</legend>
        <PinDigits value={next} set={setNext} onComplete={() => focusRowIfEmpty(confirmRowRef.current, confirm)} />
      </fieldset>
      <fieldset ref={confirmRowRef} style={{ border: 'none', margin: 0, padding: 0 }}>
        <legend className="pin-legend">{t.pinRecoveryConfirmPin}</legend>
        <PinDigits value={confirm} set={setConfirm} onComplete={() => bringIntoView(saveRef.current)} />
      </fieldset>
      <PinErrSlot>
        {error && <PinErr>{error}</PinErr>}
        {nextMismatch && <PinErr>{t.offPinMismatch}</PinErr>}
      </PinErrSlot>
      <button ref={saveRef} className="pop-cta" disabled={!ready || busy} onClick={() => { void submit(); }}>{t.changePinSave}</button>
    </div>
  );
}

// ─── Remove the PIN (Off): behind the current PIN, and nothing else ───
export function RemovePinPanel({ onDone }: { onDone: () => void }) {
  const t = usePopupT();
  const [current, setCurrent] = useState<string[]>(['', '', '', '']);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = current.join('').length === 4;
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      if (!(await removePin(current.join('')))) {
        const lockMs = await pinLockRemainingMs();
        setError(lockMs > 0 ? t.pinLockedFor(Math.ceil(lockMs / 1000)) : t.changePinWrong);
        setCurrent(['', '', '', '']);
        return;
      }
      onDone();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pin-panel" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
      <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
        <legend className="pin-legend">{t.changePinCurrent}</legend>
        <PinDigits value={current} set={setCurrent} autoFocus />
      </fieldset>
      <PinErrSlot>{error && <PinErr>{error}</PinErr>}</PinErrSlot>
      <button className="pop-cta" disabled={!ready || busy} onClick={() => { void submit(); }}>{t.offPinRemoveSave}</button>
    </div>
  );
}

// ─── Set a first PIN (Settings row, when none is stored) ───
// The wizard sets a PIN only for Child and Teen and Change PIN needs a current one, so an install set
// up as Adult had no way to get a PIN later. This stores the PIN and a fresh recovery phrase as the
// wizard does, and shows the phrase once.
// With commitOnConfirm (Off, and Receipts' Settings, M9) nothing is stored until "I wrote it down": the PIN and the phrase are held here and
// take force together, so closing the popup with the phrase showing leaves no PIN behind a phrase nobody read.
export function SetPinPanel({ onDone, onPhraseShown, commitOnConfirm }: {
  onDone: () => void; onPhraseShown?: () => void; commitOnConfirm?: boolean;
}) {
  const t = usePopupT();
  // Off asks for the PIN when it opens; Receipts asks in Settings. Each product's note says so.
  const lockedNote = isOffProduct() ? t.offPinLockedNote : t.pinLockedNote;
  const committing = useRef(false);
  const [next, setNext] = useState<string[]>(['', '', '', '']);
  const [confirm, setConfirm] = useState<string[]>(['', '', '', '']);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [phrase, setPhrase] = useState<string | null>(null);
  const confirmRowRef = useRef<HTMLFieldSetElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const nextPin = next.join('');
  const bothTyped = nextPin.length === 4 && confirm.join('').length === 4;
  const ready = bothTyped && nextPin === confirm.join('');
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      // The popup does not reload when parentPin changes, so the snapshot that offered this row can be
      // stale; read again and refuse rather than overwrite a PIN, or one that may exist, unseen.
      const current = await getSettings();
      if (parentPinUnknown(current)) { setError(isOffProduct() ? t.loadFailedBodyOff : t.loadFailedBody); return; }
      if (current.parentPin) { setError(lockedNote); return; }
      const fresh = generateRecoveryPhrase();
      if (!commitOnConfirm) {
        await setPin(nextPin);
        await setRecoveryPhrase(fresh);
        // Setting a PIN is not typing it: no grace starts here, so the next open asks for it (M11).
      }
      setPhrase(fresh);
      onPhraseShown?.();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };
  // Stores the held PIN and phrase together. A PIN that appeared in another window meanwhile is not overwritten.
  const confirmPhrase = async () => {
    if (!commitOnConfirm) { onDone(); return; }
    if (committing.current || phrase === null) return;
    committing.current = true;
    setError('');
    try {
      const current = await getSettings();
      if (parentPinUnknown(current)) { setError(isOffProduct() ? t.loadFailedBodyOff : t.loadFailedBody); return; }
      // A PIN that appeared in another window meanwhile is never overwritten, and the card does not close over it.
      if (current.parentPin) { setError(lockedNote); return; }
      // The phrase first: a phrase with no PIN locks nothing, and the next Set PIN makes a new one. The other
      // order, with the phrase write failing, would leave a PIN in force and no way back.
      await setRecoveryPhrase(phrase);
      await setPin(nextPin);
      // Setting a PIN is not typing it: no grace starts here, so the next open asks for it (M11).
      onDone();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      committing.current = false;
    }
  };
  if (phrase) {
    return (
      <>
        <RecoveryPhraseCard phrase={phrase} onConfirm={() => { void confirmPhrase(); }} />
        <PinErrSlot>{error && <PinErr>{error}</PinErr>}</PinErrSlot>
      </>
    );
  }
  return (
    <div className="pin-panel" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
      <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
        <legend className="pin-legend">{t.offPinNew}</legend>
        <PinDigits value={next} set={setNext} autoFocus onComplete={() => focusRowIfEmpty(confirmRowRef.current, confirm)} />
      </fieldset>
      <fieldset ref={confirmRowRef} style={{ border: 'none', margin: 0, padding: 0 }}>
        <legend className="pin-legend">{t.offPinConfirm}</legend>
        <PinDigits value={confirm} set={setConfirm} onComplete={() => bringIntoView(saveRef.current)} />
      </fieldset>
      <PinErrSlot>
        {bothTyped && !ready && <PinErr>{t.offPinMismatch}</PinErr>}
        {error && <PinErr>{error}</PinErr>}
      </PinErrSlot>
      <button ref={saveRef} className="pop-cta" disabled={!ready || busy} onClick={() => { void submit(); }}>{t.offPinSave}</button>
    </div>
  );
}

// ─── Recovery phrase card (shown exactly once) ───
// The phrase lives only in React state until the parent confirms; the
// storage layer keeps its salted hash and nothing else, so once this card
// closes the phrase cannot be shown again.
/**
 * The recovery warning, worded for the product. Reinstalling deletes the signed record in Receipts;
 * Off keeps no record, so its warning does not mention one.
 */
export function useRecoveryBody(): string {
  const t = usePopupT();
  return isOffProduct() ? t.setupRecoveryBodyOff : t.setupRecoveryBody;
}

export function RecoveryPhraseCard({ phrase, onConfirm }: { phrase: string; onConfirm: () => void }) {
  const t = usePopupT();
  const body = useRecoveryBody();
  const [kept, setKept] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h3 style={{ margin: 0 }}>{t.setupRecoveryTitle}</h3>
      <p className="tag" style={{ margin: 0 }}>{body}</p>
      <PhraseKeeper phrase={phrase} kept={kept} onKept={setKept} />
      <button className="pop-cta" data-testid="recovery-continue" disabled={!kept} onClick={onConfirm}>{t.continueBtn}</button>
    </div>
  );
}

/** Where the popup is a full tab (the setup tab on install, or a detached window), not the toolbar popup. */
function inFullTab(): boolean {
  try { return new URLSearchParams(location.search).has('detached'); } catch { return false; }
}

const visuallyHidden: CSSProperties = {
  position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap',
};

/** The phrase as a screen reader says it: one character at a time, the hyphen as the word for dash. */
export function spellPhrase(phrase: string, dash: string): string {
  return [...phrase].map(c => (c === '-' ? dash : c)).join(' ');
}

/**
 * The phrase, the ways to keep it, and the tick the finish button waits for (stage 3, 10 Oct 2026). Copy writes the
 * phrase to the clipboard only when pressed. Print is offered only in a full tab: in the toolbar popup a print call
 * showed nothing, and a print from a hidden frame closed the popup within 3 s, which would lose a phrase already
 * stored (measured 10 Oct 2026 in a real toolbar popup). The printed card is part of this page, so the phrase never
 * goes into an address, a title or another page, and nothing here writes it to the console.
 */
export function PhraseKeeper({ phrase, kept, onKept }: { phrase: string; kept: boolean; onKept: (kept: boolean) => void }) {
  const t = usePopupT();
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no');
  // Off never prints: its card would name Feedprint's window and Settings path, and its popup can be opened in a tab.
  const canPrint = inFullTab() && !isOffProduct();
  const copy = () => {
    if (!navigator.clipboard?.writeText) { setCopied('failed'); return; }
    void navigator.clipboard.writeText(phrase).then(() => setCopied('yes'), () => setCopied('failed'));
  };
  return (
    <>
      <div style={{ fontFamily: 'monospace', fontSize: 20, letterSpacing: 2, textAlign: 'center', padding: '10px 0' }}>
        <span aria-hidden={true} data-testid="recovery-phrase" style={{ userSelect: 'all' }}>{phrase}</span>
        <span style={visuallyHidden} data-testid="recovery-phrase-spoken">
          {`${t.pinRecoveryPhraseLabel}: ${spellPhrase(phrase, t.recoveryDash)}`}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        <button type="button" className="pop-cta sec" style={{ flex: 1 }} data-testid="recovery-copy" onClick={copy}>{t.recoveryCopy}</button>
        {canPrint && (
          <button type="button" className="pop-cta sec" style={{ flex: 1 }} data-testid="recovery-print" onClick={() => window.print()}>{t.recoveryPrint}</button>
        )}
      </div>
      <span role="status" data-testid="recovery-copy-status" style={copied !== 'no' ? { textAlign: 'center', fontSize: 12 } : visuallyHidden}>
        {copied === 'yes' ? t.recoveryCopied : copied === 'failed' ? t.recoveryCopyFailed : ''}
      </span>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <input type="checkbox" data-testid="recovery-kept" checked={kept} onChange={e => onKept(e.currentTarget.checked)} />
        {t.setupRecoveryConfirm}
      </label>
      {canPrint && (
        <div className="fw-phrase-print" data-testid="recovery-print-card">
          <p className="fw-phrase-print-name">{t.recoveryPrintName}</p>
          <p className="fw-phrase-print-phrase">{phrase}</p>
          <p>{t.recoveryPrintSteps}</p>
        </div>
      )}
    </>
  );
}
