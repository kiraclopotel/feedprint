/** @vitest-environment jsdom */
// PA unit 4 (M3 + F-B1b). Setup's Choose row hands focus to Confirm after its fourth digit (R3). Change PIN
// (current, new, confirm) and Settings' Set PIN still stopped at the end of each row, and in setup, retyping the
// fourth Choose digit after starting Confirm jumped into the half-filled Confirm row. These tests type through
// real focus: each digit goes into whichever box has focus, as a person's keys do.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';

import { installStorage, unmount, mount, host, settle, click, button, modeButton, t } from '../../../helpers/popup-walk';
import { ChangePinPanel, PinRecoveryForm, SetPinPanel } from '../../../../src/ui/popup/controls';
import { SetupWizard } from '../../../../src/ui/popup/Popup';
import { _setProductForTesting } from '../../../../src/product';

vi.mock('../../../../src/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/ai/client')>();
  return { ...actual, probeProxy: vi.fn(async () => 'ok') };
});

beforeEach(() => { installStorage({ fw_pin_recovery: 'pbkdf2$1$00$00' }); });
afterEach(async () => { await unmount(); _setProductForTesting(null); });

const boxes = () => Array.from(host.querySelectorAll<HTMLInputElement>('input.pin-box'));
const focused = () => boxes().indexOf(document.activeElement as HTMLInputElement);

/** Type one digit into whichever pin box has focus. */
async function key(d: string): Promise<void> {
  const el = document.activeElement as HTMLInputElement;
  if (!el || !el.classList.contains('pin-box')) throw new Error(`focus is not on a PIN box (it is on ${el?.tagName})`);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(el, d); el.dispatchEvent(new Event('input', { bubbles: true })); });
}
const keys = async (s: string) => { for (const d of s) await key(d); };
const focusBox = async (i: number) => { await act(async () => { boxes()[i].focus(); }); };

describe.each(['receipts', 'off'] as const)('%s: focus moves from row to row as the digits are typed', (product) => {
  it('Change PIN: current, then new, then confirm; a half-typed row keeps focus', async () => {
    _setProductForTesting(product);
    await mount(createElement(ChangePinPanel, { onDone: () => {} }));
    expect(focused(), 'starts on the first current box').toBe(0);
    await keys('123');
    expect(focused(), 'a half-typed row keeps focus').toBe(3);
    await key('4');
    expect(focused(), 'the fourth current digit hands focus to the new row').toBe(4);
    await keys('5678');
    expect(focused(), 'the fourth new digit hands focus to the confirm row').toBe(8);
    await keys('5678');
    expect(boxes().map(b => b.value).join('')).toBe('123456785678');
  });

  it('Set PIN: choose, then confirm', async () => {
    _setProductForTesting(product);
    await mount(createElement(SetPinPanel, { onDone: () => {} }));
    expect(focused()).toBe(0);
    await keys('2468');
    expect(focused(), 'the fourth digit hands focus to the confirm row').toBe(4);
    await keys('2468');
    expect(boxes().map(b => b.value).join('')).toBe('24682468');
  });

  it('the recovery form: new PIN, then confirm', async () => {
    _setProductForTesting(product);
    await mount(createElement(PinRecoveryForm, { onSuccess: () => {}, onCancel: () => {} }));
    await settle();
    await focusBox(0);
    await keys('1357');
    expect(focused()).toBe(4);
  });
});

describe('retyping the last digit of a row does not pull focus into a row that is being filled', () => {
  it('Change PIN: editing current digit 4 after starting the new row keeps focus in the current row', async () => {
    await mount(createElement(ChangePinPanel, { onDone: () => {} }));
    await keys('1234');
    await keys('56');           // started the new row
    await focusBox(3);
    await key('');              // clear current digit 4
    await key('4');             // and retype it
    expect(focused(), 'focus stays where the person is typing').toBe(3);
  });

  it('setup: retyping Choose digit 4 after starting Confirm does not jump into Confirm', async () => {
    await mount(createElement(SetupWizard, { onComplete: () => {} }));
    await click(button(t.beginSetup));
    await click(modeButton(t.modeChild));
    await click(host.querySelector<HTMLElement>('[data-testid="setup-continue"]')!);
    await keys('1234');
    expect(focused(), 'first time through, focus goes to Confirm').toBe(4);
    await keys('56');           // started Confirm
    await focusBox(3);
    await key('');
    await key('4');
    expect(focused(), 'focus stays on Choose digit 4').toBe(3);
  });

  it('but an empty next row still gets focus on the fourth digit, however many times it is retyped', async () => {
    await mount(createElement(SetPinPanel, { onDone: () => {} }));
    await keys('2468');
    expect(focused()).toBe(4);
    await focusBox(3);
    await key('');
    await key('8');
    expect(focused(), 'the confirm row is still empty, so focus goes to it again').toBe(4);
  });
});
