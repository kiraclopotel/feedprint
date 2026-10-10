/** @vitest-environment jsdom */
// The mode screen pre-selects nothing (18 Sep 2026).
//
// A parent who had never seen this product was handed the popup and told to set
// it up for a child. The mode screen opened with Adult already chosen, the one
// button on that screen finished the setup from there, and the wizard's own
// line said it out loud: "For an adult there is nothing else to set: no PIN, no
// phrase." Two presses from Welcome, and a child's browser was running an adult
// install with no PIN, no recovery phrase and the heavier controls off, with
// nothing afterwards saying that was what happened.
//
// The default in a child-safety product cannot be the mode that turns the
// protections off, so there is no default. This drives the real wizard, not the
// source text: the screen arrives with nothing selected, the button on it is
// not pressable, and pressing it writes nothing.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { SetupWizard } from '../../../../src/ui/popup/Popup';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { SETUP_DRAFT_KEY } from '../../../../src/storage/setup-draft';
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
    runtime: { sendMessage: vi.fn(async () => undefined), getManifest: () => ({ version: '2.5.11' }) },
  };
}

let root: Root | null = null;
let host: HTMLElement;
const completed = vi.fn();

async function settle(): Promise<void> {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

async function mountWizard(): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(I18nProvider, {
      lang: 'en',
      children: createElement(SetupWizard, { onComplete: completed }),
    }));
  });
  await settle();
}

async function unmountWizard(): Promise<void> {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  host?.remove();
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

/** Which dot the progress bar calls current, the wizard's own answer. */
function activeStep(): number {
  const dots = Array.from(host.querySelectorAll('.setup-progress span'));
  return dots.findIndex(d => d.classList.contains('active'));
}

beforeEach(() => {
  completed.mockReset();
  installStorageStub();
});

afterEach(async () => {
  await unmountWizard();
  document.body.innerHTML = '';
});

describe('the mode screen arrives with nothing chosen', () => {
  it('no card is selected and no mode reads as checked', async () => {
    await mountWizard();
    await click(button(t.beginSetup));
    expect(activeStep()).toBe(1);

    expect(host.querySelectorAll('.mode-btn').length).toBe(3);
    expect(host.querySelector('.mode-btn.selected')).toBeNull();
    for (const b of Array.from(host.querySelectorAll<HTMLElement>('.mode-btn'))) {
      expect(b.getAttribute('aria-checked'), b.textContent ?? '').toBe('false');
    }
    // The adult line, and the button that finishes on this screen, belong to a
    // chosen Adult. Neither is on an unanswered screen.
    expect(host.textContent ?? '').not.toContain(t.setupAdultNoPin);
    expect(host.querySelector('[data-testid="setup-start-free"]')).toBeNull();
  });

  it('the button on that screen is not pressable, and pressing it writes nothing', async () => {
    await mountWizard();
    await click(button(t.beginSetup));

    const cta = host.querySelector<HTMLButtonElement>('[data-testid="setup-continue"]');
    expect(cta).not.toBeNull();
    expect(cta!.disabled).toBe(true);

    await click(cta!);
    expect(activeStep()).toBe(1);
    expect(completed).not.toHaveBeenCalled();
    expect(local['setupDone']).toBeUndefined();
    expect(local['mode']).toBeUndefined();
    expect(local['parentPin']).toBeUndefined();
    // Nothing chosen, nothing to keep: the draft starts at the first answer.
    expect(session[SETUP_DRAFT_KEY]).toBeUndefined();
    expect(local[SETUP_DRAFT_KEY]).toBeUndefined();
  });

  it('choosing Child opens the way to the PIN, which is where it went before', async () => {
    await mountWizard();
    await click(button(t.beginSetup));
    await click(modeButton(t.modeChild));

    const cta = host.querySelector<HTMLButtonElement>('[data-testid="setup-continue"]');
    expect(cta!.disabled).toBe(false);
    expect(session[SETUP_DRAFT_KEY]).toBeTruthy();

    await click(cta!);
    expect(activeStep()).toBe(2);
    expect((host.querySelector('.setup-step h2')?.textContent ?? '').trim()).toBe(t.setupPinTitle);
  });

  // Strict (Child) has four since B2 unit 8 (30 Sep 2026): it ends on the recovery phrase, with no license step.
  it('the progress bar counts the steps the chosen mode has: two for Adult, four for Child and for Teen', async () => {
    await mountWizard();
    await click(button(t.beginSetup));
    const bar = () => host.querySelector('.setup-progress')!;
    await click(modeButton(t.modeAdult));
    expect(bar().querySelectorAll('span')).toHaveLength(2);
    expect(bar().getAttribute('aria-valuemax')).toBe('2');
    await click(modeButton(t.modeChild));
    expect(bar().querySelectorAll('span')).toHaveLength(4);
    expect(bar().getAttribute('aria-valuemax')).toBe('4');
    await click(modeButton(t.modeTeen));
    expect(bar().querySelectorAll('span')).toHaveLength(4);
    expect(bar().getAttribute('aria-valuemax')).toBe('4');
  });

  it('Adult is still one press away and still finishes on this screen', async () => {
    await mountWizard();
    await click(button(t.beginSetup));
    await click(modeButton(t.modeAdult));

    expect(host.querySelector('.mode-btn.selected .label')?.textContent?.trim()).toBe(t.modeAdult);
    expect(host.textContent ?? '').toContain(t.setupAdultNoPin);

    const start = host.querySelector<HTMLButtonElement>('[data-testid="setup-start-free"]');
    expect(start).not.toBeNull();
    expect(start!.disabled).toBe(false);

    await click(start!);
    expect(completed).toHaveBeenCalledTimes(1);
    expect(local['setupDone']).toBe(true);
    expect(local['mode']).toBe('adult');
  });
});
