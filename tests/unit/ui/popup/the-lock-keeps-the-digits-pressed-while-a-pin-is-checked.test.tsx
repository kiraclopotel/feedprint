/** @vitest-environment jsdom */
// PAW, the priced limit (lead 09:25). Checking a PIN takes real time. A person who typed the wrong PIN and went on
// typing at once typed into the full fourth box, which refuses input (maxLength 1), so those digits were lost, or met
// the old row when the refusal came back and left it mixed. Now the digit keys pressed while a PIN is being checked
// are kept: after a wrong PIN they start the new row (four of them are checked at once), after a right PIN they are
// dropped. Nothing else about the boxes changes.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';

import { installStorage, unmount, mount, host, t } from '../../../helpers/popup-walk';
import { PinOverlay } from '../../../../src/ui/popup/controls';

// Each verifyPin call waits for the test to answer it: the time the check takes is the point of these cases.
const pinMocks = vi.hoisted(() => ({ calls: [] as Array<{ pin: string; answer: (ok: boolean) => void }> }));

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    verifyPin: vi.fn((pin: string) => new Promise<boolean>((resolve) => { pinMocks.calls.push({ pin, answer: resolve }); })),
    pinLockRemainingMs: vi.fn(async () => 0),
  };
});

beforeEach(() => { installStorage(); pinMocks.calls = []; });
afterEach(async () => { vi.useRealTimers(); await unmount(); });

const boxes = () => Array.from(host.querySelectorAll<HTMLInputElement>('input.pin-box'));
const values = () => boxes().map(b => b.value);
const setter = () => Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
const flush = async () => { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); }); };

/** Types into the box that has the focus, as the keyboard does. A full box takes nothing (maxLength 1). */
async function typeWhereTheFocusIs(digit: string): Promise<void> {
  const el = document.activeElement as HTMLInputElement;
  if (!(el instanceof HTMLInputElement) || el.value.length >= 1) return;
  await act(async () => { setter().call(el, digit); el.dispatchEvent(new Event('input', { bubbles: true })); });
}

/** A key pressed on the focused element. Returns whether the page let it through (not prevented). */
async function pressKey(key: string): Promise<boolean> {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  await act(async () => { document.activeElement!.dispatchEvent(ev); });
  return !ev.defaultPrevented;
}

async function wrongPinBeingChecked(fake = false, onSuccess = vi.fn()) {
  await mount(createElement(PinOverlay, { onSuccess, onCancel: () => {} }));
  // Fake timers start after the mount: the harness settles on a real timer.
  if (fake) vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  for (const d of ['9', '9', '9', '9']) await typeWhereTheFocusIs(d);
  await flush();
  expect(pinMocks.calls.length, 'the check has started and has not answered').toBe(1);
  return onSuccess;
}

describe('digits pressed while a PIN is being checked are kept (PAW)', () => {
  it('one digit 50 ms after the wrong PIN, before the refusal: the row ends holding only that digit, and the rest go in after it', async () => {
    const onSuccess = await wrongPinBeingChecked(true);
    await act(async () => { vi.advanceTimersByTime(50); });
    await pressKey('1');

    pinMocks.calls[0].answer(false);
    await flush();
    expect(host.textContent).toContain(t.pinIncorrect);
    expect(values(), 'only the new digit, not the wrong row').toEqual(['1', '', '', '']);
    expect(document.activeElement).toBe(boxes()[1]);

    for (const d of ['3', '5', '7']) await typeWhereTheFocusIs(d);
    await flush();
    expect(pinMocks.calls[1]?.pin, 'the second check is the new row').toBe('1357');
    pinMocks.calls[1].answer(true);
    await flush();
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('a whole second PIN typed before the refusal is checked as soon as the refusal comes back, and opens the lock', async () => {
    const onSuccess = await wrongPinBeingChecked(true);
    for (const d of ['1', '3', '5', '7']) await pressKey(d);

    pinMocks.calls[0].answer(false);
    await flush();
    expect(pinMocks.calls[1]?.pin, 'the buffered PIN is the second check').toBe('1357');
    expect(values()).toEqual(['1', '3', '5', '7']);
    pinMocks.calls[1].answer(true);
    await flush();
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('when the first PIN turns out to be right, the extra digits are dropped: one success, no second check', async () => {
    const onSuccess = await wrongPinBeingChecked();
    await pressKey('1');
    await pressKey('3');

    pinMocks.calls[0].answer(true);
    await flush();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(pinMocks.calls.length).toBe(1);
  });

  it('only digit keys are kept, and only while a check is running', async () => {
    await wrongPinBeingChecked(true);
    expect(await pressKey('Tab'), 'Tab is not a digit').toBe(true);
    expect(await pressKey('a'), 'a letter is not a digit').toBe(true);
    expect(await pressKey('5'), 'a digit during the check is held back from the full box').toBe(false);

    pinMocks.calls[0].answer(false);
    await flush();
    expect(values()).toEqual(['5', '', '', '']);
    expect(await pressKey('2'), 'after the check the box takes its own digits again').toBe(true);
  });
});
