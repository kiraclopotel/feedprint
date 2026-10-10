/** @vitest-environment jsdom */
// Q3 (quality loop, 29 Sep 2026): the level step and the PIN screens say what a stranger needs to hear.
//
// A stranger walking the setup met five silences: a dimmed Continue on the level screen with no reason; no word
// that a PIN comes next at Strict and Moderate; two PIN boxes that did not match and no message; two Cancel
// buttons on the Change PIN and Set PIN rows; and, on the dashboard, a reset field whose text and background
// were the same colour. Each is a test here, seen red before the fix.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SetupWizard } from '../../../../src/ui/popup/Popup';
import { ChangePinPanel, SetPinPanel } from '../../../../src/ui/popup/controls';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { CURRENT_SETTINGS_SCHEMA_VERSION, utcDayKey, utcMonthKey } from '../../../../src/storage/settings';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../../../src/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/ai/client')>();
  return { ...actual, probeProxy: vi.fn(async () => 'ok') };
});

const t = POPUP_STRINGS.en;

let local: Record<string, unknown> = {};
let session: Record<string, unknown> = {};

function area(store: () => Record<string, unknown>) {
  return {
    get: (keys: string | string[] | null) => {
      const s = store();
      if (keys === null || keys === undefined) return Promise.resolve({ ...s });
      const arr = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of arr) if (k in s) out[k] = s[k];
      return Promise.resolve(out);
    },
    set: (obj: Record<string, unknown>) => { Object.assign(store(), obj); return Promise.resolve(); },
    remove: (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete store()[k];
      return Promise.resolve();
    },
  };
}

function installStorageStub(): void {
  local = {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    lastResetDate: utcDayKey(),
    lastResetMonth: utcMonthKey(),
  };
  session = {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: area(() => local),
      session: area(() => session),
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: { sendMessage: vi.fn(async () => undefined), getManifest: () => ({ version: '2.5.16' }) },
  };
}

let root: Root | null = null;
let host: HTMLElement;

async function settle(): Promise<void> {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

async function mount(child: ReturnType<typeof createElement>): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(I18nProvider, { lang: 'en', children: child }));
  });
  await settle();
}

function button(text: string): HTMLButtonElement {
  const btn = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.trim() === text);
  if (!btn) throw new Error(`no button "${text}" (screen reads: ${host.textContent?.slice(0, 160)})`);
  return btn;
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => { el.click(); });
  await settle();
}

function modeButton(label: string): HTMLElement {
  const btn = Array.from(host.querySelectorAll<HTMLElement>('.mode-btn'))
    .find(b => b.querySelector('.label')?.textContent?.trim() === label);
  if (!btn) throw new Error(`no mode button "${label}"`);
  return btn;
}

/** Type digits into the n-th group of four PIN boxes on the screen. */
async function typePin(group: number, digits: string): Promise<void> {
  const boxes = Array.from(host.querySelectorAll<HTMLInputElement>('input.pin-box')).slice(group * 4, group * 4 + 4);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      setter.call(boxes[i], digits[i]);
      boxes[i].dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  await settle();
}

beforeEach(() => { installStorageStub(); });

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  host?.remove();
  document.body.innerHTML = '';
});

describe('the level screen says why Continue waits, and what comes next', () => {
  it('with nothing chosen it says to choose a level', async () => {
    await mount(createElement(SetupWizard, { onComplete: vi.fn() }));
    await click(button(t.beginSetup));
    expect(host.querySelector<HTMLButtonElement>('[data-testid="setup-continue"]')!.disabled).toBe(true);
    expect(host.querySelector('[data-testid="setup-continue-why"]')?.textContent ?? '').toBe(t.setupChooseFirst);
  });

  it('once a level is chosen the reason goes away', async () => {
    await mount(createElement(SetupWizard, { onComplete: vi.fn() }));
    await click(button(t.beginSetup));
    await click(modeButton(t.modeChild));
    expect(host.querySelector('[data-testid="setup-continue-why"]')).toBeNull();
  });

  it('Strict and Moderate say a PIN comes next; Relaxed does not, it has its own line', async () => {
    await mount(createElement(SetupWizard, { onComplete: vi.fn() }));
    await click(button(t.beginSetup));
    for (const label of [t.modeChild, t.modeTeen]) {
      await click(modeButton(label));
      expect(host.textContent ?? '', label).toContain(t.setupPinNext);
    }
    await click(modeButton(t.modeAdult));
    expect(host.textContent ?? '').not.toContain(t.setupPinNext);
    expect(host.textContent ?? '').toContain(t.setupAdultNoPin);
  });
});

describe('the PIN screen says when the two PINs differ', () => {
  async function toPinScreen(): Promise<void> {
    await mount(createElement(SetupWizard, { onComplete: vi.fn() }));
    await click(button(t.beginSetup));
    await click(modeButton(t.modeChild));
    await click(host.querySelector<HTMLElement>('[data-testid="setup-continue"]')!);
  }

  it('two different PINs show the mismatch line and Continue stays off', async () => {
    await toPinScreen();
    await typePin(0, '1234');
    await typePin(1, '1235');
    expect(host.textContent ?? '').toContain(t.offPinMismatch);
    expect(button(t.continueBtn).disabled).toBe(true);
  });

  it('nothing is said while the second PIN is still being typed, or when they match', async () => {
    await toPinScreen();
    await typePin(0, '1234');
    expect(host.textContent ?? '').not.toContain(t.offPinMismatch);
    await typePin(1, '1234');
    expect(host.textContent ?? '').not.toContain(t.offPinMismatch);
    expect(button(t.continueBtn).disabled).toBe(false);
  });
});

describe('a PIN row has one Cancel, the row toggle above it', () => {
  it('Change PIN panel has none of its own', async () => {
    await mount(createElement(ChangePinPanel, { onDone: vi.fn() }));
    expect(Array.from(host.querySelectorAll('button')).filter(b => b.textContent?.trim() === t.cancel)).toHaveLength(0);
  });

  it('Set PIN panel has none of its own', async () => {
    await mount(createElement(SetPinPanel, { onDone: vi.fn() }));
    expect(Array.from(host.querySelectorAll('button')).filter(b => b.textContent?.trim() === t.cancel)).toHaveLength(0);
  });

  it('Change PIN says when the new PIN and its copy differ', async () => {
    await mount(createElement(ChangePinPanel, { onDone: vi.fn() }));
    await typePin(0, '1111');
    await typePin(1, '1234');
    await typePin(2, '1235');
    expect(host.textContent ?? '').toContain(t.offPinMismatch);
  });
});

describe('the reset word field on the dashboard is readable', () => {
  it('the dashboard sheet gives .modal .key-input a background and a text colour', () => {
    const css = readFileSync(join(__dirname, '../../../../src/ui/dashboard/dashboard-design.css'), 'utf8');
    const rule = /\.modal\s+\.key-input\s*\{([^}]*)\}/.exec(css);
    expect(rule, 'no .modal .key-input rule in dashboard-design.css').not.toBeNull();
    // The values, not only the properties: white on white would declare both and still be unreadable.
    expect(rule![1]).toMatch(/background(-color)?\s*:\s*var\(--fw-surface\)/);
    expect(rule![1]).toMatch(/(^|[;\s])color\s*:\s*var\(--fw-text\)/);
  });
});

describe('the new lines exist, in plain words, in all four languages', () => {
  for (const lang of ['en', 'es', 'pt-BR', 'ro'] as const) {
    it(lang, () => {
      const s = (POPUP_STRINGS as unknown as Record<string, { setupChooseFirst: string; setupPinNext: string }>)[lang];
      for (const line of [s.setupChooseFirst, s.setupPinNext]) {
        expect(line.length).toBeGreaterThan(10);
        expect(line).not.toMatch(/[\u2014\u2013]/);
        expect(line).not.toMatch(/\b(parent|child|teen|adult|kid|minor)/i);
      }
    });
  }
});