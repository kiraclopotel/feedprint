/** @vitest-environment jsdom */
// B2 unit 8 (P3c; rows V4, B8). At Strict the setup had five screens, and the fifth (the license step) said a
// key changes nothing there. At Strict setup now ends on the recovery-phrase screen: four screens, four steps
// in the progress bar, and the button that says the phrase is written down also finishes setup. The note about
// where the PIN and phrase are kept (word for word) sits under that button, as on the last screen before.
// Moderate now ends the same way: setup runs with no key, so it has no license step at any level. The License
// tab stays in the popup for anyone who holds a key.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';

import {
  installStorage, unmount, mount, click, button, modeButton, typePin, host, t, local, walkSetupToLastStep, keepPhraseAndContinue
} from '../../../helpers/popup-walk';
import { SetupWizard } from '../../../../src/ui/popup/Popup';
import { isPinGraceActive, verifyPin } from '../../../../src/storage/settings';

vi.mock('../../../../src/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/ai/client')>();
  return { ...actual, probeProxy: vi.fn(async () => 'ok') };
});

beforeEach(() => { installStorage(); });
afterEach(async () => { await unmount(); });

async function toPhraseScreen(level: 'child' | 'teen', onComplete: () => void = () => {}): Promise<void> {
  await mount(createElement(SetupWizard, { onComplete }));
  await click(button(t.beginSetup));
  await click(modeButton(level === 'child' ? t.modeChild : t.modeTeen));
  await click(host.querySelector<HTMLElement>('[data-testid="setup-continue"]')!);
  await typePin(0, '1234');
  await typePin(1, '1234');
  await click(button(t.continueBtn));
}

const bar = () => host.querySelector('[role="progressbar"]')!;
async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise(r => setTimeout(r, 50));
}

describe('setup at Strict has four screens', () => {
  it('the progress bar shows 4 steps on the phrase screen, and the phrase screen is the last', { timeout: 30000 }, async () => {
    await toPhraseScreen('child');
    expect(host.querySelector('[data-testid="recovery-phrase"]')).not.toBeNull();
    expect(bar().getAttribute('aria-valuemax')).toBe('4');
    expect(bar().querySelectorAll('span').length).toBe(4);
  });

  it('"I wrote it down" finishes setup: the level, the PIN and the phrase are stored and the wizard completes', { timeout: 30000 }, async () => {
    const done = vi.fn();
    await toPhraseScreen('child', done);
    await keepPhraseAndContinue();
    await until(() => done.mock.calls.length > 0);

    expect(done).toHaveBeenCalledTimes(1);
    expect(local['mode']).toBe('child');
    expect(local['setupDone']).toBe(true);
    expect(await verifyPin('1234')).toBe(true);
    expect(await isPinGraceActive()).toBe(true);
    expect(host.querySelector(`input[aria-label="${t.licCardName}"]`), 'no key field at Strict').toBeNull();
  });

  it('the note about where the PIN and phrase are kept sits under the button, word for word', { timeout: 30000 }, async () => {
    await toPhraseScreen('child');
    const text = host.textContent ?? '';
    expect(text).toContain(t.setupWhereSecretsTitle);
    expect(text).toContain(t.setupWhereSecretsNote);
    expect(text.indexOf(t.continueBtn), 'the finish button comes first').toBeLessThan(text.indexOf(t.setupWhereSecretsNote));
  });
});

describe('setup at Moderate ends on the phrase too: four screens, no license step', () => {
  it('the phrase screen counts 4 steps and its button finishes setup', { timeout: 30000 }, async () => {
    const done = vi.fn();
    await toPhraseScreen('teen', done);
    expect(bar().getAttribute('aria-valuemax')).toBe('4');
    expect(bar().getAttribute('aria-valuenow')).toBe('4');
    await keepPhraseAndContinue();
    await until(() => done.mock.calls.length > 0);
    expect(done).toHaveBeenCalledTimes(1);
    expect(local['mode']).toBe('teen');
    expect(local['setupDone']).toBe(true);
  });

  it('the phrase screen says where the PIN and phrase are kept', { timeout: 30000 }, async () => {
    await toPhraseScreen('teen');
    const phrase = host.textContent ?? '';
    expect(phrase).toContain(t.setupWhereSecretsTitle);
    expect(phrase).toContain(t.setupWhereSecretsNote);
  });

  it('the walk to the last step ends on the phrase button', { timeout: 30000 }, async () => {
    await walkSetupToLastStep('teen');
    expect(Array.from(host.querySelectorAll('button')).some(b => b.textContent?.trim() === t.continueBtn)).toBe(true);
  });
});
