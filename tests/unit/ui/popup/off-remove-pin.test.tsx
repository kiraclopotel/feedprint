/** @vitest-environment jsdom */
// Off's "Remove PIN" (the Leader's decision of 12 Oct 2026: yes, behind the current PIN only).
//
// The tester's finding (11 Oct): Off could change its PIN but never take it off. Removal needs the current PIN through the same
// gate and throttle as every other PIN act; the recovery phrase goes with it; and the note that a PIN once existed goes too,
// because left behind it makes every later start read "no PIN stored" as a failed read and ask for a PIN that is gone.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';

import { installStorage, local, unmount, mount, host, settle, click, button, typePin, t } from '../../../helpers/popup-walk';
import { RemovePinPanel } from '../../../../src/ui/popup/controls';
import { _setProductForTesting } from '../../../../src/product';
import {
  generateRecoveryPhrase, hasRecoveryPhrase, notePinWasSet, readPinEvidence, removePin, setPin, setRecoveryPhrase, verifyPin,
} from '../../../../src/storage/settings';

const PIN = '1234';

/** The PIN check hashes for real, so it takes longer than a tick: wait for what the screen should show. */
async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !condition(); i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

beforeEach(async () => {
  installStorage();
  localStorage.clear();
  await setPin(PIN);
  await setRecoveryPhrase(generateRecoveryPhrase());
});
afterEach(async () => { await unmount(); _setProductForTesting(null); localStorage.clear(); });

describe('removePin', () => {
  it('a wrong PIN removes nothing', async () => {
    expect(await removePin('0000')).toBe(false);
    expect(await verifyPin(PIN)).toBe(true);
    expect(await hasRecoveryPhrase()).toBe(true);
  });

  it('the right PIN takes the PIN, the recovery phrase and the note that a PIN once existed', async () => {
    expect(await readPinEvidence()).toBe('present');
    expect(await removePin(PIN)).toBe(true);
    expect(local.parentPin).toBe('');
    expect(await verifyPin(PIN)).toBe(false);
    expect(await hasRecoveryPhrase()).toBe(false);
    expect(localStorage.getItem('fw_pin_was_set')).toBeNull();
    expect(await readPinEvidence(), 'a removed PIN is not read as a PIN that failed to load').toBe('none');
  });

  it('a new PIN can be set afterwards', async () => {
    await removePin(PIN);
    await setPin('5678');
    expect(await verifyPin('5678')).toBe(true);
  });

  it('a run of wrong PINs locks it, as it locks every other PIN act', async () => {
    for (let i = 0; i < 10; i++) await removePin('0000');
    expect(await removePin(PIN)).toBe(false);
    expect(local.parentPin).not.toBe('');
  });
});

describe('the Remove PIN panel', () => {
  it('stays until four digits are typed, then removes the PIN and says it is done', async () => {
    let done = 0;
    _setProductForTesting('off');
    await mount(createElement(RemovePinPanel, { onDone: () => { done += 1; } }));
    expect(button(t.offPinRemoveSave).disabled).toBe(true);
    await typePin(0, PIN);
    expect(button(t.offPinRemoveSave).disabled).toBe(false);
    await click(button(t.offPinRemoveSave));
    await until(() => done > 0);
    expect(done).toBe(1);
    expect(local.parentPin).toBe('');
  });

  it('a wrong PIN says so, clears the boxes and removes nothing', async () => {
    let done = 0;
    _setProductForTesting('off');
    await mount(createElement(RemovePinPanel, { onDone: () => { done += 1; } }));
    await typePin(0, '0000');
    await click(button(t.offPinRemoveSave));
    await until(() => host.textContent!.includes(t.changePinWrong));
    expect(done).toBe(0);
    expect(host.textContent).toContain(t.changePinWrong);
    expect(await verifyPin(PIN)).toBe(true);
    expect(Array.from(host.querySelectorAll<HTMLInputElement>('input.pin-box')).map((b) => b.value).join('')).toBe('');
  });
});

describe('the note is the only thing the removal has to clear in the page', () => {
  it('notePinWasSet and the removal use the same key', () => {
    notePinWasSet();
    expect(localStorage.getItem('fw_pin_was_set')).toBe('1');
  });
});
