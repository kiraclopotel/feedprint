/** @vitest-environment jsdom */
// After "Incorrect PIN" the four boxes clear. Focus has to go back to the first box with them:
// left on the fourth, the next PIN typed at once lands in the wrong boxes and nothing says why.
// And the two links under the boxes, "Forgot PIN?" and "Cancel", are two controls, not one run of
// text: they sit in their own column with a gap between them.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const pinMocks = vi.hoisted(() => ({ verify: false }));

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    verifyPin: vi.fn(async () => pinMocks.verify),
    pinLockRemainingMs: vi.fn(async () => 0),
  };
});

import { PinOverlay } from '../../../../src/ui/popup/controls';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = POPUP_STRINGS.en;
let root: Root | null = null;
let host: HTMLElement;

beforeEach(() => {
  pinMocks.verify = false;
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) }, onChanged: { addListener: vi.fn() } },
  };
});

afterEach(async () => {
  vi.useRealTimers();
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
});

async function mount(onSuccess = vi.fn()): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(I18nProvider, {
      lang: 'en',
      children: createElement(PinOverlay, { onSuccess, onCancel: () => {} }),
    }));
  });
}

const boxes = (): HTMLInputElement[] => Array.from(host.querySelectorAll<HTMLInputElement>('input.pin-box'));

async function typeDigit(box: HTMLInputElement, d: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(box, d);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('the PIN overlay after a wrong PIN', () => {
  it('clears the boxes and puts focus back on the first one', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await mount();
    for (const [i, d] of ['9', '9', '9', '9'].entries()) await typeDigit(boxes()[i], d);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(host.textContent).toContain(t.pinIncorrect);
    expect(boxes().map((b) => b.value)).toEqual(['', '', '', '']);
    expect(document.activeElement).toBe(boxes()[0]);

    await act(async () => { vi.advanceTimersByTime(3000); });

    expect(host.textContent).not.toContain(t.pinIncorrect);
    expect(boxes().map((b) => b.value)).toEqual(['', '', '', '']);
    expect(document.activeElement).toBe(boxes()[0]);
  });

  it('the right PIN typed straight after goes in from the first box and opens the gate', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const onSuccess = vi.fn();
    await mount(onSuccess);
    for (const [i, d] of ['9', '9', '9', '9'].entries()) await typeDigit(boxes()[i], d);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    pinMocks.verify = true;
    // Type where the focus is, as a person does, one digit at a time.
    for (const d of ['1', '2', '3', '4']) await typeDigit(document.activeElement as HTMLInputElement, d);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});

describe('the links under the boxes', () => {
  it('"Forgot PIN?" and "Cancel" sit apart, in a column with a gap', async () => {
    await mount();
    const buttons = Array.from(host.querySelectorAll('button'));
    const forgot = buttons.find((b) => b.textContent === t.pinForgot)!;
    const cancel = buttons.find((b) => b.textContent === t.cancel)!;
    expect(forgot).toBeTruthy();
    expect(cancel).toBeTruthy();
    const holder = forgot.parentElement as HTMLElement;
    expect(cancel.parentElement).toBe(holder);
    expect(holder.style.display).toBe('flex');
    expect(holder.style.flexDirection).toBe('column');
    expect(parseInt(holder.style.gap, 10)).toBeGreaterThanOrEqual(8);
  });
});
