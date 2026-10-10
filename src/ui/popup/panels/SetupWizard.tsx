// First run: up to four screens, ending on the recovery phrase. There is no licence screen: setup always runs
// with no key, so it says nothing about what a key turns on. A key is added later in the License tab.
//
// Nothing it collects reaches storage until the last screen is finished. A walk step checks that.
//
// Cut out of src/ui/popup/Popup.tsx on 2026-09-16 (PLAN-2026-09-16 item 10.3), which was 1,871
// lines holding every panel at once. Popup.tsx re-exports the names it exported before.

import { usePopupT } from '../../../i18n/react';
import { applyPreset, generateRecoveryPhrase, getSettings, saveSettings, setPin, setRecoveryPhrase } from '../../../storage/settings';
import { presetKeepingOffOnly } from '../../../storage/switch-scope';
import { clearSetupDraft, readSetupDraft, saveSetupDraft } from '../../../storage/setup-draft';
import type { Mode } from '../../../types/mode';
import { PhraseKeeper, PinDigits, focusRowIfEmpty, useRecoveryBody } from '../controls';
import { StatusLine } from '../../shared/StatusLine';
import { useEffect, useRef, useState } from 'react';

// ─── Setup wizard (4 steps) ───
// The step and the mode are kept in a draft outside React (storage/setup-draft)
// because Chrome tears this document down on any click outside the popup: until
// 14 Sep 2026 that sent the parent back to "Welcome" with nothing typed saved
// (board line b2). Secrets are never in that draft; read the module's docblock
// for what is kept and why the wizard returns to the PIN screen.
export function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const t = usePopupT();
  const recoveryBody = useRecoveryBody();
  const [step, setStep] = useState(0);
  // Nothing pre-selected (18 Sep 2026). Adult was the arrival default from
  // 14 Sep on the reading that the customer is an adult on a desktop. A parent
  // installing this for a child read a blind pass of the wizard and hit the
  // consequence: Adult was already chosen on the mode screen, the screen's one
  // button finished the setup from there, and two presses from Welcome left a
  // child's browser on an adult install with no PIN, no recovery phrase, and
  // every heavier control off, with nothing afterwards saying so. A
  // child-safety product must not pre-select the mode that turns the
  // protections off, so it pre-selects nothing and the button below stays
  // unpressable until the parent says who this is for.
  const [mode, setMode] = useState<Mode | null>(null);
  // False until the draft has been read back. Nothing is written before that,
  // so the first render's defaults cannot overwrite a kept step with step 0.
  const [draftRead, setDraftRead] = useState(false);
  const [pin, setPinDigits] = useState<string[]>(['', '', '', '']);
  const [pinConfirm, setPinConfirmDigits] = useState<string[]>(['', '', '', '']);
  // Generated when the PIN step completes; persisted (hashed) by finishSetup.
  const [recoveryPhrase, setRecoveryPhraseState] = useState('');
  const [phraseKept, setPhraseKept] = useState(false);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState('');
  // R3 (29 Sep 2026): the Confirm row, so the fourth Choose digit can hand focus to it.
  const confirmRow = useRef<HTMLFieldSetElement>(null);

  const modeLabel = (m: Mode) => m === 'child' ? t.modeChild : m === 'teen' ? t.modeTeen : t.modeAdult;

  // Read the draft back once, on mount. A missing or unreadable draft leaves
  // the wizard where a first-ever install starts: step 0, no mode chosen.
  useEffect(() => {
    let alive = true;
    void readSetupDraft().then(d => {
      if (!alive) return;
      if (d) { setMode(d.mode); setStep(d.step); }
      setDraftRead(true);
    }).catch(() => { if (alive) setDraftRead(true); });
    return () => { alive = false; };
  }, []);

  // Save the place on every move. Writes only after the read above, so a
  // remount cannot clobber the kept step with the first render's defaults.
  // Nothing is written before a mode is chosen: the draft's shape carries a
  // mode, and a teardown at that point has only one press to lose (Welcome
  // → the mode screen). Coming back to Welcome with nothing chosen is the
  // safe end of that trade; coming back with a mode invented for the parent
  // is not.
  useEffect(() => {
    if (!draftRead || mode === null) return;
    void saveSetupDraft({ step, mode });
  }, [draftRead, step, mode]);

  // Defined ahead of the step renders: step 1 (Adult) finishes from here.
  const finishSetup = async () => {
    // No mode, nothing to write. Every button that reaches here is disabled
    // until one is chosen; this is the type-level floor under that.
    if (mode === null) return;
    setActivating(true);
    setError('');
    try {
      const patch = applyPreset(mode);
      // Settings BEFORE the PIN. Wizard re-entry used to be gated on
      // parentPin being empty, so a PIN persisted ahead of a failed settings
      // write locked the install at Teen defaults forever while the parent
      // believed they chose this screen's mode (laydown 2026-08-04, D5). With
      // this order a failure leaves setupDone false and the wizard reopens
      // for a clean retry. setupDone is what marks the screen finished since
      // 14 Sep 2026; an adult install sets no PIN and no phrase.
      // Setup sets Receipts' own switches; what an older install stored for Off's switches stays as it was.
      const stored = (await getSettings()).features;
      await saveSettings({
        mode,
        levelChosen: true,
        features: presetKeepingOffOnly(patch.features, stored),
        presets: patch.presets,
      });
      const pinDigits = pin.join('');
      if (mode !== 'adult' && pinDigits.length === 4) {
        await setPin(pinDigits);
        await setRecoveryPhrase(recoveryPhrase);
        // Setting a PIN is not typing it (M11): no grace starts, so the next open asks for it. The fifteen
        // minutes the PIN screen names start when the person enters the PIN.
      }
      await saveSettings({ setupDone: true });
      // The draft's whole job ends here: the settings are written, and reopening the popup opens on the main
      // screen, not on the wizard.
      await clearSetupDraft();
      onComplete();
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setActivating(false);
    }
  };

  // Five empty spans said nothing to a screen reader about where the person
  // stood in setup (accessibility audit, 2026-09-18): no role="progressbar",
  // no aria-valuenow, no aria-current="step", no label. `label` is the same
  // heading text each step already renders in its own <h2>, passed in by the
  // caller rather than invented here, since a new string would need adding
  // to four language tables this file does not own.
  // An adult's setup ends after choosing the mode; Strict and Moderate end on the recovery phrase.
  const totalSteps = mode === 'adult' ? 2 : 4;

  // Where the two secrets end up, said on the step that makes them, under its own heading: on the licence step it
  // read as part of the licence. Child and Teen only: an adult install sets neither and finishes on the mode screen.
  const secretsNote = mode !== 'adult' && (
    <>
      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{t.setupWhereSecretsTitle}</h3>
      <p className="tag">{t.setupWhereSecretsNote}</p>
    </>
  );
  const Progress = ({ label }: { label: string }) => (
    <div
      className="setup-progress"
      role="progressbar"
      aria-valuenow={step + 1}
      aria-valuemin={1}
      aria-valuemax={totalSteps}
      aria-valuetext={label}
    >
      {Array.from({ length: totalSteps }, (_, i) => i).map(i => (
        <span key={i} aria-current={i === step ? 'step' : undefined} className={i < step ? 'done' : i === step ? 'active' : ''} />
      ))}
    </div>
  );

  // Nothing is drawn until the draft has been read: a wizard that paints step 1
  // first and jumps a moment later shows the parent the screen they were just
  // sent back from, and anything reading this popup (the walk, a test) would
  // read that first paint as the answer.
  if (!draftRead) return null;

  if (step === 0) {
    return (
      <>
        <Progress label={t.setupWelcomeTitle} />
        <div className="setup-step">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="num">1</span>
            <h2>{t.setupWelcomeTitle}</h2>
          </div>
          <p className="tag">{t.setupWelcomePurpose}</p>
          <p className="tag">{t.setupWelcomeBody1}</p>
          <p className="tag">{t.setupWelcomeBody2}</p>
          <button className="pop-cta" onClick={() => setStep(1)}>{t.beginSetup}</button>
        </div>
      </>
    );
  }

  if (step === 1) {
    return (
      <>
        <Progress label={t.setupWhoTitle} />
        <div className="setup-step">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="num">2</span>
            <h2>{t.setupWhoTitle}</h2>
          </div>
          {/* Each line says what its level sends out and what it locks, so the choice can be made from the lines
              before anything is picked. */}
          <p className="tag" data-testid="setup-level-lines">
            {t.setupLevelChildLine}<br />{t.setupLevelTeenLine}<br />{t.setupLevelAdultLine}
          </p>
          {/* Selection here was className only ("selected"), which a screen
              reader cannot see (accessibility audit, 2026-09-18). child/teen/
              adult is a mutually exclusive single choice, the same shape as
              the settings panel's own mode picker (SettingsPanel.tsx), fixed
              to the same role="radiogroup"/role="radio" pattern for
              consistency between the two. */}
          <div style={{ display: 'flex', gap: 8 }} role="radiogroup" aria-label={t.setupWhoTitle}>
            {(['child', 'teen', 'adult'] as Mode[]).map(m => (
              <button
                key={m}
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={`mode-btn ${mode === m ? 'selected' : ''}`}
              >
                <div className="label">{modeLabel(m)}</div>
              </button>
            ))}
          </div>
          {/* Adult (14 Sep 2026): nothing else to set. The PIN and the
              recovery phrase are parental controls; an adult install ends
              here with one button, and a fresh install after a reinstall
              is usable without typing anything, once this screen has been
              answered (18 Sep 2026: it no longer answers itself). Child and
              Teen keep the PIN and the phrase: a control a child can undo is
              not one. */}
          {/* What the chosen level does, in the words Settings uses for it: the levels differ in swearing, the PIN and
              what leaves the computer, not in what the page shows otherwise. */}
          {mode !== null && (
            <p className="tag" data-testid="setup-level-line">
              <strong>{t.modeExplainPrefix(modeLabel(mode))}</strong>{' '}
              {mode === 'child' ? t.modeExplainChildBody : mode === 'teen' ? t.modeExplainTeenBody : t.modeExplainAdultBody}
            </p>
          )}
          {mode === 'adult' && <p className="tag">{t.setupAdultNoPin}</p>}
          {/* Q3 (29 Sep 2026): a dimmed Continue said nothing, and Strict and Moderate never said a PIN comes next. */}
          {mode === null && <p className="tag" data-testid="setup-continue-why">{t.setupChooseFirst}</p>}
          {(mode === 'child' || mode === 'teen') && <p className="tag">{t.setupPinNext}</p>}
          {error && <StatusLine tone="alert" style={{ fontSize: 11, color: 'var(--fw-red)' }}>{error}</StatusLine>}
          {/* With nothing chosen the second branch renders, disabled: no press
              on this screen can finish or advance a setup whose mode the
              parent has not stated. Child and Teen go on to the PIN; Adult
              finishes here, which is the whole point of that branch. */}
          {mode === 'adult'
            ? <button className="pop-cta" data-testid="setup-start-free" disabled={activating} onClick={() => { void finishSetup(); }}>{t.setupStartFree}</button>
            : <button className="pop-cta" data-testid="setup-continue" disabled={mode === null} onClick={() => setStep(2)}>{t.continueBtn}</button>}
          <button className="lnk" onClick={() => setStep(0)} style={{ alignSelf: 'center' }}>{t.back}</button>
        </div>
      </>
    );
  }

  if (step === 2) {
    const bothTyped = pin.join('').length === 4 && pinConfirm.join('').length === 4;
    const pinFull = bothTyped && pin.join('') === pinConfirm.join('');
    return (
      <>
        <Progress label={t.setupPinTitle} />
        <div className="setup-step">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="num">3</span>
            <h2>{t.setupPinTitle}</h2>
          </div>
          <p className="tag">{mode === 'teen' ? t.setupPinBodyModerate : t.setupPinBody}</p>
          {/* Two PinDigits groups, each announcing the same "digit 1 of 4"
              with nothing to say which is the chosen PIN and which is the
              confirmation (accessibility audit, 2026-09-18, naming
              SetupWizard.tsx:194,198). A fieldset/legend gives each group the
              name already printed above it, reused rather than duplicated. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
              <legend style={{ display: 'block', width: '100%', fontSize: 11, color: 'var(--fw-muted)', textAlign: 'center', marginBottom: 8, padding: 0 }}>{t.choose}</legend>
              <PinDigits value={pin} set={setPinDigits} autoFocus onComplete={() => focusRowIfEmpty(confirmRow.current, pinConfirm)} />
            </fieldset>
            <fieldset ref={confirmRow} style={{ border: 'none', margin: 0, padding: 0 }}>
              <legend style={{ display: 'block', width: '100%', fontSize: 11, color: 'var(--fw-muted)', textAlign: 'center', marginBottom: 8, padding: 0 }}>{t.confirm}</legend>
              <PinDigits value={pinConfirm} set={setPinConfirmDigits} />
            </fieldset>
          </div>
          {bothTyped && !pinFull && <StatusLine tone="alert" style={{ fontSize: 11, color: 'var(--fw-red)' }}>{t.offPinMismatch}</StatusLine>}
          <button
            className="pop-cta"
            disabled={!pinFull}
            onClick={() => { if (!recoveryPhrase) setRecoveryPhraseState(generateRecoveryPhrase()); setStep(3); }}
          >
            {t.continueBtn}
          </button>
          <button className="lnk" onClick={() => setStep(1)} style={{ alignSelf: 'center' }}>{t.back}</button>
        </div>
      </>
    );
  }

  // The recovery phrase is the last screen; a draft that names a later step lands here too.
  return (
    <>
      <Progress label={t.setupRecoveryTitle} />
      <div className="setup-step">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="num">4</span>
          <h2>{t.setupRecoveryTitle}</h2>
        </div>
        <p className="tag">{recoveryBody}</p>
        <PhraseKeeper phrase={recoveryPhrase} kept={phraseKept} onKept={setPhraseKept} />
        {error && <StatusLine tone="alert" style={{ fontSize: 11, color: 'var(--fw-red)' }}>{error}</StatusLine>}
        <button
          className="pop-cta"
          data-testid="setup-recovery-confirm"
          disabled={activating || !phraseKept}
          onClick={() => { void finishSetup(); }}
        >
          {t.continueBtn}
        </button>
        {/* Under the button, not above it: above it, the button sat at 614 px in Spanish and Portuguese, below a 600 px popup. */}
        {secretsNote}
        <button className="lnk" onClick={() => setStep(2)} disabled={activating} style={{ alignSelf: 'center' }}>{t.back}</button>
      </div>
    </>
  );
}
