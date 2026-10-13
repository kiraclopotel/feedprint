/** @vitest-environment jsdom */
// A first run that ends on a forced PIN is where a new person stops (13 Oct 2026). The PIN screen now has a plain link,
// "Skip the PIN for now", that finishes setup at once: the level is stored, setup is marked done, and no PIN and no
// recovery phrase are written (the two stay a pair). The line under the link says what that leaves open. Every level
// can finish without a PIN: Silent and Calm by the link, Open by its own button. The level screen also stops printing
// the level's name twice: the name is the heading, its sentence is its own line under it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';

import { installStorage, unmount, mount, click, button, buttonOrNull, modeButton, typePin, host, t, local } from '../../../helpers/popup-walk';
import { SetupWizard } from '../../../../src/ui/popup/Popup';
import { hasRecoveryPhrase, verifyPin } from '../../../../src/storage/settings';

vi.mock('../../../../src/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/ai/client')>();
  return { ...actual, probeProxy: vi.fn(async () => 'ok') };
});

beforeEach(() => { installStorage(); });
afterEach(async () => { await unmount(); });

async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise(r => setTimeout(r, 50));
}

async function toLevelScreen(level: 'child' | 'teen' | 'adult', onComplete: () => void = () => {}): Promise<void> {
  await mount(createElement(SetupWizard, { onComplete }));
  await click(button(t.beginSetup));
  await click(modeButton(level === 'child' ? t.modeChild : level === 'teen' ? t.modeTeen : t.modeAdult));
}
async function toPinScreen(level: 'child' | 'teen', onComplete: () => void = () => {}): Promise<void> {
  await toLevelScreen(level, onComplete);
  await click(host.querySelector<HTMLElement>('[data-testid="setup-continue"]')!);
}
const skip = () => host.querySelector<HTMLButtonElement>('[data-testid="setup-skip-pin"]');

describe('the PIN screen can be left', () => {
  it.each(['child', 'teen'] as const)('%s: the skip link finishes setup with the level and no PIN, no phrase', async (level) => {
    const done = vi.fn();
    await toPinScreen(level, done);
    expect(skip()?.textContent).toBe(t.setupPinSkip);
    await click(skip()!);
    await until(() => done.mock.calls.length > 0);

    expect(done).toHaveBeenCalledTimes(1);
    expect(local['mode']).toBe(level);
    expect(local['levelChosen']).toBe(true);
    expect(local['setupDone']).toBe(true);
    expect(local['parentPin'] ?? '').toBe('');
    expect(await hasRecoveryPhrase()).toBe(false);
    expect(await verifyPin('1234')).toBe(false);
  }, 30000);

  it('a PIN typed before the link is pressed is not stored', { timeout: 30000 }, async () => {
    const done = vi.fn();
    await toPinScreen('child', done);
    await typePin(0, '1234');
    await typePin(1, '1234');
    await click(skip()!);
    await until(() => done.mock.calls.length > 0);
    expect(local['setupDone']).toBe(true);
    expect(local['parentPin'] ?? '').toBe('');
    expect(await hasRecoveryPhrase()).toBe(false);
  });

  it('the screen says what skipping leaves open, and the Continue button still comes first', { timeout: 30000 }, async () => {
    await toPinScreen('teen');
    const note = host.querySelector('[data-testid="setup-skip-pin-note"]')?.textContent ?? '';
    expect(note).toBe(t.setupPinSkipNote);
    const text = host.textContent ?? '';
    expect(text.indexOf(t.continueBtn), 'the PIN road is the button').toBeLessThan(text.indexOf(t.setupPinSkip));
    const continueButton = button(t.continueBtn);
    expect(continueButton.className).toContain('pop-cta');
    expect(skip()?.className, 'skip is the smaller link, not a second button').toBe('lnk');
  });

  it('only the PIN screen offers it; and a PIN still leads to the phrase screen', { timeout: 30000 }, async () => {
    await toLevelScreen('child');
    expect(skip()).toBeNull();
    await click(host.querySelector<HTMLElement>('[data-testid="setup-continue"]')!);
    expect(skip()).not.toBeNull();
    await typePin(0, '1234');
    await typePin(1, '1234');
    await click(button(t.continueBtn));
    expect(host.querySelector('[data-testid="recovery-phrase"]')).not.toBeNull();
    expect(skip()).toBeNull();
  });

  it('Open already finishes without a PIN, by its own button', { timeout: 30000 }, async () => {
    const done = vi.fn();
    await toLevelScreen('adult', done);
    expect(buttonOrNull(t.setupStartFree)).toBeDefined();
    await click(host.querySelector<HTMLElement>('[data-testid="setup-start-free"]')!);
    await until(() => done.mock.calls.length > 0);
    expect(local['mode']).toBe('adult');
    expect(local['setupDone']).toBe(true);
    expect(local['parentPin'] ?? '').toBe('');
  });
});

describe('the level screen names the level once', () => {
  it.each(['child', 'teen', 'adult'] as const)('%s: the name is the heading and the sentence is its own line under it', { timeout: 30000 }, async (level) => {
    await toLevelScreen(level);
    const block = host.querySelector('[data-testid="setup-level-line"]')!;
    const label = level === 'child' ? t.modeChild : level === 'teen' ? t.modeTeen : t.modeAdult;
    const sentence = level === 'child' ? t.levelSentenceChild : level === 'teen' ? t.levelSentenceTeen : t.levelSentenceAdult;
    expect(block.querySelector('h3')?.textContent).toBe(label);
    expect(block.querySelector('p')?.textContent).toBe(sentence);
    expect(block.textContent, 'the name once, then the sentence, nothing in front of it').toBe(label + sentence);
  });
});
