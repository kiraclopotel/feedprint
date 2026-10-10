/** @vitest-environment jsdom */
// Stage 3 (10 Oct 2026): the recovery phrase gets Copy, Print where the phrase sits in a full tab, a tick the finish
// button waits for, and a read-out a screen reader says one character at a time. Measured first: in a real toolbar
// popup a print call showed nothing and a print from a hidden frame closed the popup within 3 s, so Print is offered
// only in a full tab (the setup tab on install, or a detached window). The phrase goes nowhere but the screen, the
// person's own Copy and the person's own paper: never an address, a page title or a console line.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';

import { RecoveryPhraseCard, spellPhrase } from '../../../../src/ui/popup/controls';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { _setProductForTesting } from '../../../../src/product';
import { UI_LANGUAGES } from '../../../../src/i18n';
import { installStorage, mount, unmount, button, buttonOrNull, click, host, t, walkSetupToLastStep } from '../../../helpers/popup-walk';

const PHRASE = 'ABCD-EFGH';
const consoleMethods = ['log', 'info', 'warn', 'error', 'debug'] as const;

function tick(): HTMLInputElement {
  const box = host.querySelector<HTMLInputElement>('[data-testid="recovery-kept"]');
  if (!box) throw new Error('no tick');
  return box;
}

describe('the card shown when a PIN is set or changed later', () => {
  let spies: Array<ReturnType<typeof vi.spyOn>> = [];
  beforeEach(() => {
    installStorage();
    history.replaceState(null, '', '/popup.html');
    spies = consoleMethods.map(m => vi.spyOn(console, m));
  });
  afterEach(async () => {
    for (const s of spies) s.mockRestore();
    await unmount();
    history.replaceState(null, '', '/');
  });

  it('in the toolbar popup: Copy, no Print, and Continue waits for the tick', async () => {
    const onConfirm = vi.fn();
    await mount(createElement(RecoveryPhraseCard, { phrase: PHRASE, onConfirm }));
    expect(button(t.recoveryCopy)).toBeDefined();
    expect(buttonOrNull(t.recoveryPrint), 'a print call in the toolbar popup shows nothing').toBeUndefined();
    expect(host.querySelector('[data-testid="recovery-print-card"]')).toBeNull();
    const finish = button(t.continueBtn);
    expect(finish.disabled).toBe(true);
    await click(finish);
    expect(onConfirm).not.toHaveBeenCalled();
    await click(tick());
    expect(finish.disabled).toBe(false);
    await click(finish);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('Copy writes the phrase once, only when pressed, and says it did', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await mount(createElement(RecoveryPhraseCard, { phrase: PHRASE, onConfirm: vi.fn() }));
    expect(writeText).not.toHaveBeenCalled();
    await click(button(t.recoveryCopy));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(PHRASE);
    expect(host.textContent).toContain(t.recoveryCopied);
  });

  it('Copy says when it did not work, refused or with no clipboard at all', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => { throw new Error('denied'); }) }, configurable: true });
    await mount(createElement(RecoveryPhraseCard, { phrase: PHRASE, onConfirm: vi.fn() }));
    await click(button(t.recoveryCopy));
    await vi.waitFor(() => expect(host.querySelector('[data-testid="recovery-copy-status"]')?.textContent?.trim()).toBe(t.recoveryCopyFailed));
    expect(host.textContent).not.toContain(t.recoveryCopied + ' ');
    await unmount();
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    await mount(createElement(RecoveryPhraseCard, { phrase: PHRASE, onConfirm: vi.fn() }));
    await click(button(t.recoveryCopy));
    expect(host.querySelector('[data-testid="recovery-copy-status"]')?.textContent?.trim()).toBe(t.recoveryCopyFailed);
  });

  it('Off never offers Print, even in a full tab: its printed card would name the other product', async () => {
    history.replaceState(null, '', '/popup.html?detached=1');
    _setProductForTesting('off');
    try {
      await mount(createElement(RecoveryPhraseCard, { phrase: PHRASE, onConfirm: vi.fn() }));
      expect(buttonOrNull(t.recoveryPrint)).toBeUndefined();
      expect(host.querySelector('[data-testid="recovery-print-card"]')).toBeNull();
      expect(button(t.recoveryCopy)).toBeDefined();
    } finally {
      _setProductForTesting(null);
    }
  });

  it('in a full tab: Print prints this page, whose printed card holds the phrase and the two steps', async () => {
    history.replaceState(null, '', '/popup.html?detached=1');
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    await mount(createElement(RecoveryPhraseCard, { phrase: PHRASE, onConfirm: vi.fn() }));
    const card = host.querySelector('[data-testid="recovery-print-card"]');
    expect(card?.textContent).toContain(PHRASE);
    expect(card?.textContent).toContain(t.recoveryPrintSteps);
    await click(button(t.recoveryPrint));
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });

  it('the phrase is never in the address, the page title or a console line', async () => {
    history.replaceState(null, '', '/popup.html?detached=1');
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => undefined) }, configurable: true });
    await mount(createElement(RecoveryPhraseCard, { phrase: PHRASE, onConfirm: vi.fn() }));
    await click(button(t.recoveryCopy));
    await click(button(t.recoveryPrint));
    await click(tick());
    await click(button(t.continueBtn));
    expect(location.href).not.toContain(PHRASE);
    expect(document.title).not.toContain(PHRASE);
    for (const s of spies) {
      for (const call of s.mock.calls) expect(JSON.stringify(call)).not.toContain('EFGH');
    }
    print.mockRestore();
  });

  it('a screen reader hears the phrase one character at a time, the hyphen as "dash"', async () => {
    expect(spellPhrase(PHRASE, 'dash')).toBe('A B C D dash E F G H');
    await mount(createElement(RecoveryPhraseCard, { phrase: PHRASE, onConfirm: vi.fn() }));
    const spoken = host.querySelector('[data-testid="recovery-phrase-spoken"]')?.textContent ?? '';
    expect(spoken).toBe(`${t.pinRecoveryPhraseLabel}: A B C D dash E F G H`);
  });

  it.each(UI_LANGUAGES)('%s: the new words exist and the dash is a word of the language', (lang) => {
    const s = POPUP_STRINGS[lang];
    for (const w of [s.recoveryCopy, s.recoveryCopied, s.recoveryPrint, s.recoveryDash, s.recoveryPrintName, s.recoveryPrintSteps]) {
      expect(w.trim().length).toBeGreaterThan(0);
      expect(w).not.toMatch(/[—–!]/);
    }
    expect(s.recoveryDash).not.toBe('-');
    expect(s.recoveryPrintSteps).toContain(s.pinForgot);
  });
});

describe('the setup ends on the phrase and waits for the tick', () => {
  beforeEach(() => { installStorage(); });
  afterEach(async () => { await unmount(); });

  it('Continue on the last screen stays off until the tick', async () => {
    await walkSetupToLastStep('teen');
    const finish = host.querySelector<HTMLButtonElement>('[data-testid="setup-recovery-confirm"]')!;
    expect(finish.textContent?.trim()).toBe(t.continueBtn);
    expect(finish.disabled).toBe(true);
    await click(tick());
    expect(finish.disabled).toBe(false);
  });
});
