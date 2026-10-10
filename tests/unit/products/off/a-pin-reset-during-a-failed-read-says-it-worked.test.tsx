/** @vitest-environment jsdom */
// P2-5 (PAINT-2 addendum). With the settings unreadable and a PIN known to exist, Off shows a lock with a Retry.
// "Forgot PIN?" still works there. After a successful reset with the phrase the popup went straight back to the
// same could-not-read lock with no word, so the reset looked as if it had failed. It now says "PIN changed."

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let down = false;
let state: Record<string, unknown> = {};

// The failed read is staged the way the inspector's walk stages it: the whole-settings read rejects while a flag is on,
// and the two-key PIN read still answers.
function installStorage(): void {
  down = false;
  state = {};
  const get = vi.fn(async (keys: string | string[] | null | undefined) => {
    const whole = keys === null || keys === undefined || (Array.isArray(keys) && keys.includes('videoControls'));
    if (down && whole) throw new Error('IO error: storage busy');
    const list = keys === null || keys === undefined ? Object.keys(state) : Array.isArray(keys) ? keys : [keys];
    const out: Record<string, unknown> = {};
    for (const k of list) if (k in state) out[k] = state[k];
    return out;
  });
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get,
        set: vi.fn(async (obj: Record<string, unknown>) => { Object.assign(state, obj); }),
        remove: vi.fn(async (k: string | string[]) => { for (const key of Array.isArray(k) ? k : [k]) delete state[key]; }),
      },
      session: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: { sendMessage: vi.fn(async () => undefined), getManifest: () => ({ version: '1.0.11' }) },
  };
}

async function settle(ms = 1500): Promise<void> {
  await act(async () => { await new Promise(r => setTimeout(r, ms)); });
}

async function until(check: () => boolean, ms = 6000): Promise<void> {
  for (let waited = 0; waited < ms && !check(); waited += 100) await settle(100);
}

async function openOff(): Promise<HTMLElement> {
  const mount = document.createElement('div');
  mount.id = 'root';
  document.body.appendChild(mount);
  vi.resetModules();
  const { _setProductForTesting } = await import('../../../../src/product');
  _setProductForTesting('off');
  await act(async () => { await import('../../../../src/products/off/popup/OffPopup'); });
  await settle();
  return mount;
}

const findButton = (m: HTMLElement, text: RegExp): HTMLButtonElement | undefined =>
  Array.from(m.querySelectorAll('button')).find(b => text.test(b.textContent?.trim() ?? ''));

async function typeInto(inputs: HTMLInputElement[], digits: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  for (const [i, d] of digits.split('').entries()) {
    await act(async () => {
      setter.call(inputs[i], d);
      inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
}

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  localStorage.clear();
  installStorage();
  const { setPin, setRecoveryPhrase } = await import('../../../../src/storage/settings');
  await setPin('1234');
  await setRecoveryPhrase('ABCD-EFGH');
});
afterEach(() => {
  errors.mockRestore();
  document.body.innerHTML = '';
});

describe('Off: a PIN reset while the settings cannot be read says it worked (P2-5)', () => {
  it('after Forgot PIN and a good phrase, the lock says "PIN changed." and the new PIN is the one that works', { timeout: 60000 }, async () => {
    down = true;
    const mount = await openOff();
    expect(mount.querySelector('.pin-overlay'), 'the PIN is known, so the lock stays').not.toBeNull();
    expect(mount.textContent).toContain('could not read');
    expect(mount.textContent).not.toContain('PIN changed.');

    await act(async () => { findButton(mount, /^Forgot PIN\?$/)!.click(); });
    const phrase = mount.querySelector<HTMLInputElement>('input[type="text"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(phrase, 'ABCD-EFGH'); phrase.dispatchEvent(new Event('input', { bubbles: true })); });
    const boxes = Array.from(mount.querySelectorAll<HTMLInputElement>('input.pin-box'));
    expect(boxes.length).toBe(8);
    await typeInto(boxes.slice(0, 4), '1111');
    await typeInto(boxes.slice(4, 8), '1111');
    await act(async () => { findButton(mount, /^Reset PIN$/)!.click(); });
    await until(() => (mount.textContent ?? '').includes('PIN changed.'));

    expect(mount.textContent, 'the reset says it worked').toContain('PIN changed.');
    expect(mount.querySelector('.pin-overlay'), 'the lock is back, since the settings still cannot be read').not.toBeNull();
    expect(findButton(mount, /^Retry$/), 'with its Retry').toBeDefined();

    down = false; // reads work again, so the stored PIN can be checked
    const { verifyPin } = await import('../../../../src/storage/settings');
    expect(await verifyPin('1111'), 'the new PIN works').toBe(true);
  });

  it('a wrong phrase changes nothing and says nothing about a changed PIN', { timeout: 60000 }, async () => {
    down = true;
    const mount = await openOff();
    await act(async () => { findButton(mount, /^Forgot PIN\?$/)!.click(); });
    const phrase = mount.querySelector<HTMLInputElement>('input[type="text"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(phrase, 'WXYZ-2345'); phrase.dispatchEvent(new Event('input', { bubbles: true })); });
    const boxes = Array.from(mount.querySelectorAll<HTMLInputElement>('input.pin-box'));
    await typeInto(boxes.slice(0, 4), '1111');
    await typeInto(boxes.slice(4, 8), '1111');
    await act(async () => { findButton(mount, /^Reset PIN$/)!.click(); });
    await settle(2500);

    expect(mount.textContent).not.toContain('PIN changed.');
    down = false; // reads work again, so the stored PIN can be checked
    const { verifyPin } = await import('../../../../src/storage/settings');
    expect(await verifyPin('1234'), 'the old PIN still works').toBe(true);
  });
});
