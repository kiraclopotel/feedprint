/** @vitest-environment jsdom */
// M11 (was B2 unit 1, P1; walker rows R10, B15). Finishing setup with a PIN is not an entry of it, so the
// grace window (settings.ts markPinVerified) does not start and the next open asks. Only a PIN typed right
// (verifyPin) starts the 15-minute grace. Destructive gates never read the grace and are not touched here.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { installStorage, unmount, walkSetupToLastStep, button, click, t, keepPhraseAndContinue } from '../../../helpers/popup-walk';
import { isPinGraceActive, verifyPin } from '../../../../src/storage/settings';

vi.mock('../../../../src/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/ai/client')>();
  return { ...actual, probeProxy: vi.fn(async () => 'ok') };
});

beforeEach(() => { installStorage(); });
afterEach(async () => { await unmount(); });

async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise(r => setTimeout(r, 50));
}

describe('finishing setup with a PIN does not start the grace window (M11)', () => {
  it('at Strict', { timeout: 30000 }, async () => {
    const done = vi.fn();
    await walkSetupToLastStep('child', '1234', done);
    expect(await isPinGraceActive(), 'not before the PIN is entered').toBe(false);
    await keepPhraseAndContinue();
    await until(() => done.mock.calls.length > 0);

    expect(done).toHaveBeenCalled();
    expect(await isPinGraceActive(), 'setting a PIN is not typing it: the next open asks').toBe(false);
    expect(await verifyPin('1234'), 'the PIN itself is stored and works').toBe(true);
    expect(await isPinGraceActive(), 'a typed right PIN starts the grace').toBe(true);
  });

  it('at Moderate', { timeout: 30000 }, async () => {
    const done = vi.fn();
    await walkSetupToLastStep('teen', '4321', done);
    await keepPhraseAndContinue();
    await until(() => done.mock.calls.length > 0);

    expect(done).toHaveBeenCalled();
    expect(await isPinGraceActive(), 'setting a PIN is not typing it: the next open asks').toBe(false);
  });

  it('Relaxed sets no PIN, so no grace is started', { timeout: 30000 }, async () => {
    const { mount, modeButton, host } = await import('../../../helpers/popup-walk');
    const { createElement } = await import('react');
    const { SetupWizard } = await import('../../../../src/ui/popup/Popup');
    const done = vi.fn();
    await mount(createElement(SetupWizard, { onComplete: done }));
    await click(button(t.beginSetup));
    await click(modeButton(t.modeAdult));
    await click(button(t.setupStartFree));
    await until(() => done.mock.calls.length > 0);

    expect(host).toBeTruthy();
    expect(done).toHaveBeenCalled();
    expect(await isPinGraceActive()).toBe(false);
  });
});

describe('destructive gates still ignore the grace', () => {
  it('the gate code the grace is meant for is unchanged: only low-stakes callers read it', () => {
    const src = readFileSync(join(process.cwd(), 'src/storage/settings.ts'), 'utf8');
    // The comment that says destructive gates do NOT consult the grace stays, and the grace is read in one
    // place inside settings.ts (its own definition).
    expect(src).toContain('DESTRUCTIVE gates (forensic-chain reset)');
    expect(src.match(/isPinGraceActive\(/g)?.length).toBe(1);
  });
});
