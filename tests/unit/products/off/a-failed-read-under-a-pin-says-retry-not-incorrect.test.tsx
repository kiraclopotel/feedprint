/** @vitest-environment jsdom */
// M2 (Q17). When every storage read fails and a PIN was set, Off's lock screen answered a right PIN
// with "Incorrect PIN" and gave no way to retry. The read failed, the PIN was never checked, so the
// screen now says the settings could not be read, with a Retry above the PIN prompt, and never
// calls that a wrong PIN. A wrong PIN with storage reading fine is still refused.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let down = false;
let state: Record<string, unknown> = {};

function installStorage(): void {
  down = false;
  state = {};
  const get = vi.fn(async (keys: string | string[] | null | undefined) => {
    if (down) throw new Error('IO error: storage busy');
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

function retryButton(mount: HTMLElement): HTMLButtonElement | undefined {
  return Array.from(mount.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Retry');
}

async function typePin(mount: HTMLElement, pin: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  const boxes = Array.from(mount.querySelectorAll<HTMLInputElement>('input.pin-box'));
  for (const [i, d] of pin.split('').entries()) {
    await act(async () => {
      setter.call(boxes[i], d);
      boxes[i].dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  await settle();
}

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  localStorage.clear();
  installStorage();
  const { setPin } = await import('../../../../src/storage/settings');
  await setPin('1234');
});
afterEach(() => {
  errors.mockRestore();
  document.body.innerHTML = '';
});

describe('Off lock screen after a failed read (M2)', () => {
  it('a right PIN with every read failing says could not read, with a Retry, and never Incorrect PIN', { timeout: 30000 }, async () => {
    down = true;
    const mount = await openOff();
    expect(mount.querySelector('.pin-overlay'), 'the PIN is known, so the prompt stays').not.toBeNull();

    await typePin(mount, '1234');

    expect(mount.textContent).toContain('Off could not read its local settings');
    expect(retryButton(mount), 'a Retry on the lock screen').toBeDefined();
    expect(mount.textContent).not.toContain('Incorrect PIN');
    expect(mount.querySelector('.off-fold'), 'no settings behind the lock').toBeNull();
  });

  it('after Retry with storage working, the right PIN opens the popup', { timeout: 30000 }, async () => {
    down = true;
    const mount = await openOff();
    await typePin(mount, '1234');
    down = false;

    await act(async () => { retryButton(mount)!.click(); });
    await settle(300);
    expect(mount.querySelector('.pin-overlay'), 'the lock is back, asking for the PIN').not.toBeNull();
    await typePin(mount, '1234');

    expect(mount.querySelector('.off-fold'), 'the settings are there').not.toBeNull();
    expect(mount.textContent).not.toContain('could not read');
  });

  it('a wrong PIN with storage reading fine is still refused', { timeout: 30000 }, async () => {
    const mount = await openOff();
    await typePin(mount, '9999');

    expect(mount.textContent).toContain('Incorrect PIN');
    expect(mount.textContent).not.toContain('could not read');
    expect(mount.querySelector('.off-fold')).toBeNull();
  });
});
