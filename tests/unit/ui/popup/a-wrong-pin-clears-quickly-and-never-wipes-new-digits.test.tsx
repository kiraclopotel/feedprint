/** @vitest-environment jsdom */
// PA unit 2 (S-3), changed by PAW. After a wrong PIN the four wrong digits stayed for 3 seconds, then for 600 ms, and
// a timer wiped whatever the person typed in that time. Now the wrong digits clear at once, as the PIN is refused
// (PAW); anything typed after that is never wiped by a timer; the "Incorrect PIN" line keeps its 3 seconds (a screen
// reader needs the time, accessibility audit 18 Sep); closing the panel stops the timer.

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

async function type(box: HTMLInputElement, v: string): Promise<void> {
  await act(async () => { setter().call(box, v); box.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function wrongPin(): Promise<void> {
  await mount(createElement(PinOverlay, { onSuccess: () => {}, onCancel: () => {} }));
  // Fake timers start after the mount: the harness settles on a real timer.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  for (const [i, d] of ['9', '9', '9', '9'].entries()) await type(boxes()[i], d);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe('after a wrong PIN', () => {
  it('the wrong digits clear at once and the line stays until 3 seconds', async () => {
    await wrongPin();
    expect(host.textContent).toContain(t.pinIncorrect);
    expect(values(), 'digits cleared at once, no timer advanced').toEqual(['', '', '', '']);

    await act(async () => { vi.advanceTimersByTime(700); });
    expect(values(), 'digits cleared by 700 ms').toEqual(['', '', '', '']);
    expect(host.textContent, 'the line is still there for a screen reader').toContain(t.pinIncorrect);

    await act(async () => { vi.advanceTimersByTime(2500); });
    expect(host.textContent).not.toContain(t.pinIncorrect);
  });

  it('digits typed straight after a wrong PIN are never wiped', async () => {
    await wrongPin();
    await type(boxes()[0], '5');  // the focus is in the first box: a new digit at once, an unfinished entry
    await type(boxes()[1], '6');
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(values()).toEqual(['5', '6', '', '']);
  });

  it('closing the panel stops the timer: nothing runs afterwards', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await wrongPin();
    await unmount();
    await act(async () => { vi.advanceTimersByTime(10000); });
    expect(vi.getTimerCount(), 'no timer left behind').toBe(0);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
