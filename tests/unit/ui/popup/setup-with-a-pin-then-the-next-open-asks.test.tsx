/** @vitest-environment jsdom */
// M11 checks 4 and 5 (the head's (a); walker rows R10, B15).
// 4. Finish setup with a PIN, close, open the popup, press Settings: the PIN is ASKED. (Before M11 the mark made on
//    finishing setup let Settings open for fifteen minutes with no question, which the setup paragraph did not say.)
// 5. The setup steps after the PIN step never ask for it: the wizard runs from the PIN step to its end with no lock.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';

import { installStorage, unmount, walkSetupToLastStep, button, click, host, t, keepPhraseAndContinue } from '../../../helpers/popup-walk';

vi.mock('../../../../src/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/ai/client')>();
  return { ...actual, probeProxy: vi.fn(async () => 'ok') };
});

beforeEach(() => { installStorage(); });
afterEach(async () => { await unmount(); });

async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise(r => setTimeout(r, 50));
}

describe('setup with a PIN, then the next open', () => {
  it('Strict: no lock during setup; after it, the popup opens and Settings asks for the PIN', { timeout: 60000 }, async () => {
    const done = vi.fn();
    await walkSetupToLastStep('child', '1234', done);
    expect(host.querySelector('.pin-overlay'), 'the steps after the PIN step never ask').toBeNull();
    await keepPhraseAndContinue();
    await until(() => done.mock.calls.length > 0);
    expect(done).toHaveBeenCalled();
    expect(host.querySelector('.pin-overlay'), 'finishing setup never asks').toBeNull();
    await unmount();

    // The next open: the popup module loads fresh against the same storage.
    const rootEl = document.createElement('div');
    rootEl.id = 'root';
    document.body.appendChild(rootEl);
    vi.resetModules();
    await act(async () => { await import('../../../../src/ui/popup/Popup'); });
    for (let i = 0; i < 40 && !rootEl.querySelector('button[aria-label="Settings"]'); i++) {
      await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    }
    const settingsButton = rootEl.querySelector<HTMLButtonElement>('button[aria-label="Settings"]');
    expect(settingsButton, 'the main screen has its Settings button').not.toBeNull();
    await act(async () => { settingsButton!.click(); });
    await act(async () => { await new Promise(r => setTimeout(r, 200)); });

    expect(rootEl.querySelector('.pin-overlay'), 'Settings stays behind the PIN at the next open').not.toBeNull();
  });

  it('Moderate: the phrase step after the PIN step never asks either', { timeout: 60000 }, async () => {
    const done = vi.fn();
    await walkSetupToLastStep('teen', '4321', done);
    expect(host.querySelector('.pin-overlay'), 'the phrase step never asks').toBeNull();
    await keepPhraseAndContinue();
    await until(() => done.mock.calls.length > 0);
    expect(done).toHaveBeenCalled();
    expect(host.querySelector('.pin-overlay')).toBeNull();
  });
});
