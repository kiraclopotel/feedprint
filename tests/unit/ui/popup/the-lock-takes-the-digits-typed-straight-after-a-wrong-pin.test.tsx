/** @vitest-environment jsdom */
// PAW (stranger's S17, PA2). After a wrong PIN the four wrong digits stayed on screen for 600 ms with the focus on
// the full fourth box, which refuses more input: a person who typed the right PIN straight on lost every digit
// typed in that time and ended with 0 or 2 of 4. Now the wrong row clears the moment the PIN is refused and the
// focus is in the first box; the "Incorrect PIN" line keeps its 3 seconds (a screen reader needs them).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';

import { installStorage, unmount, mount, host, t } from '../../../helpers/popup-walk';
import { PinOverlay } from '../../../../src/ui/popup/controls';

const pinMocks = vi.hoisted(() => ({ verify: false }));

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    verifyPin: vi.fn(async () => pinMocks.verify),
    pinLockRemainingMs: vi.fn(async () => 0),
  };
});

beforeEach(() => { installStorage(); pinMocks.verify = false; });
afterEach(async () => { vi.useRealTimers(); await unmount(); });

const boxes = () => Array.from(host.querySelectorAll<HTMLInputElement>('input.pin-box'));
const values = () => boxes().map(b => b.value);
const setter = () => Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;

/** Types into the box that has the focus, as the keyboard does. A full box takes nothing (maxLength 1). */
async function typeWhereTheFocusIs(digit: string): Promise<void> {
  const el = document.activeElement as HTMLInputElement;
  if (!(el instanceof HTMLInputElement) || el.value.length >= 1) return;
  await act(async () => { setter().call(el, digit); el.dispatchEvent(new Event('input', { bubbles: true })); });
}

async function openAndTypeWrongPin(): Promise<void> {
  await mount(createElement(PinOverlay, { onSuccess: () => {}, onCancel: () => {} }));
  // Fake timers start after the mount: the harness settles on a real timer.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  for (const d of ['9', '9', '9', '9']) await typeWhereTheFocusIs(d);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe('after a wrong PIN the next digits are never lost (PAW)', () => {
  it('the wrong row is gone and the focus is in the first box at once, with no timer needed', async () => {
    await openAndTypeWrongPin();
    expect(host.textContent).toContain(t.pinIncorrect);
    expect(values()).toEqual(['', '', '', '']);
    expect(document.activeElement).toBe(boxes()[0]);
  });

  it('the right PIN typed straight after (no wait at all, and 150 ms and 400 ms later) fills all four boxes and opens the gate', async () => {
    for (const gap of [0, 150, 400]) {
      pinMocks.verify = false;
      const onSuccess = vi.fn();
      await unmount();
      await mount(createElement(PinOverlay, { onSuccess, onCancel: () => {} }));
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      for (const d of ['9', '9', '9', '9']) await typeWhereTheFocusIs(d);
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      await act(async () => { vi.advanceTimersByTime(gap); });

      pinMocks.verify = true;
      const typed: string[] = [];
      for (const d of ['1', '3', '5', '7']) {
        await typeWhereTheFocusIs(d);
        typed.push(values().join(''));
      }
      expect(typed[2], `gap ${gap} ms: three digits in, none lost`).toBe('135');
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(onSuccess, `gap ${gap} ms: the gate opens`).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    }
  });

  it('the "Incorrect PIN" line stays for 3 seconds and then goes', async () => {
    await openAndTypeWrongPin();
    await act(async () => { vi.advanceTimersByTime(2900); });
    expect(host.textContent, 'still there at 2.9 s for a screen reader').toContain(t.pinIncorrect);
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(host.textContent).not.toContain(t.pinIncorrect);
  });

  it('digits typed after a wrong PIN are never wiped by a timer', async () => {
    await openAndTypeWrongPin();
    await typeWhereTheFocusIs('5');
    await typeWhereTheFocusIs('6');
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(values()).toEqual(['5', '6', '', '']);
  });
});
