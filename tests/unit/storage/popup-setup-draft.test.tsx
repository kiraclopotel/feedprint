/** @vitest-environment jsdom */
// Board line b2, 14 Sep 2026: "closing and reopening it, which is exactly what
// Chrome does to an action popup whenever the click lands outside it, threw the
// walk back from step 2 to step 1, because the wizard keeps its steps in memory
// and writes nothing until the last screen".
//
// A remount IS the failure: Chrome does not hide the popup document, it tears
// it down and builds a new one. So these tests unmount the wizard and mount it
// again, which is the same thing the walk does by closing the popup page.
//
// What must come back: the step and the mode. What must NOT be anywhere: the
// PIN or the recovery phrase, in clear, in any storage area. A finished setup
// keeps only salted PBKDF2 hashes of both (storage/settings.ts), so a draft
// holding either would make the half-finished state readable where the finished
// state is not. The wizard therefore returns to the PIN screen, never past it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { SetupWizard } from '../../../src/ui/popup/Popup';
import { I18nProvider } from '../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../src/i18n/popup-strings';
import { SETUP_DRAFT_KEY, readSetupDraft } from '../../../src/storage/setup-draft';
import { CURRENT_SETTINGS_SCHEMA_VERSION, utcDayKey, utcMonthKey } from '../../../src/storage/settings';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../../src/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/ai/client')>();
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

/** `withSession: false` is the older Chrome and the degraded case: the draft
 *  falls back to chrome.storage.local, which is what the module promises. */
function installStorageStub(withSession = true): void {
  local = {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    lastResetDate: utcDayKey(),
    lastResetMonth: utcMonthKey(),
  };
  session = {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: area(() => local),
      ...(withSession ? { session: area(() => session) } : {}),
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: { sendMessage: vi.fn(async () => undefined), getManifest: () => ({ version: '2.5.6' }) },
  };
}

let root: Root | null = null;
let host: HTMLElement;
const completed = vi.fn();

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
  host.remove();
}

async function settle(): Promise<void> {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

function button(text: string): HTMLButtonElement {
  const btn = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.trim() === text);
  if (!btn) throw new Error(`no button "${text}" (screen reads: ${host.textContent?.slice(0, 120)})`);
  return btn;
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => { el.click(); });
  await settle();
}

/** Which dot the progress bar calls current: the wizard's own answer, and the
 *  one the walk reads (scripts/walk/walk.mjs, wizardStep). */
function activeStep(): number {
  const dots = Array.from(host.querySelectorAll('.setup-progress span'));
  return dots.findIndex(d => d.classList.contains('active'));
}

function heading(): string {
  return (host.querySelector('.setup-step h2')?.textContent ?? '').trim();
}

function selectedMode(): string {
  const btn = host.querySelector('.mode-btn.selected .label');
  return (btn?.textContent ?? '').trim();
}

/** Walk from the welcome screen to the PIN screen, which the wizard's progress
 *  bar shows as step 3 of 5. */
async function advanceToPinScreen(mode: string): Promise<void> {
  await click(button(t.beginSetup));
  const modeBtn = Array.from(host.querySelectorAll<HTMLElement>('.mode-btn'))
    .find(b => b.querySelector('.label')?.textContent?.trim() === mode);
  if (!modeBtn) throw new Error(`no mode button "${mode}"`);
  await click(modeBtn);
  await click(button(t.continueBtn));
}

beforeEach(() => {
  completed.mockReset();
  installStorageStub();
});

afterEach(async () => {
  await unmountWizard();
  document.body.innerHTML = '';
});

describe('the setup wizard keeps its place when Chrome tears the popup down', () => {
  it('step 3 of 5 with Teen chosen comes back as step 3 of 5 with Teen chosen', async () => {
    await mountWizard();
    expect(activeStep()).toBe(0);
    await advanceToPinScreen(t.modeTeen);
    expect(activeStep()).toBe(2);
    expect(heading()).toBe(t.setupPinTitle);

    // The popup document dies and a new one is built: the stray click.
    await unmountWizard();
    await mountWizard();

    expect(activeStep()).toBe(2);
    expect(heading()).toBe(t.setupPinTitle);
    // The mode is what the PIN screen cannot show, so the screen before it is
    // where the kept choice is read.
    await click(button(t.back));
    expect(activeStep()).toBe(1);
    expect(selectedMode()).toBe(t.modeTeen);
  });

  it('the same when the browser offers no session storage, through chrome.storage.local', async () => {
    installStorageStub(false);
    await mountWizard();
    await advanceToPinScreen(t.modeChild);
    expect(activeStep()).toBe(2);
    expect(local[SETUP_DRAFT_KEY]).toBeTruthy();
    expect(session[SETUP_DRAFT_KEY]).toBeUndefined();

    await unmountWizard();
    await mountWizard();
    expect(activeStep()).toBe(2);
    await click(button(t.back));
    expect(selectedMode()).toBe(t.modeChild);
  });

  it('the draft never holds the PIN or the phrase, and never lands past the PIN screen', async () => {
    await mountWizard();
    await advanceToPinScreen(t.modeTeen);
    const boxes = Array.from(host.querySelectorAll<HTMLInputElement>('input.pin-box'));
    expect(boxes.length).toBe(8);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    for (const box of boxes) {
      await act(async () => {
        setter.call(box, '7');
        box.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    await settle();
    // Past the PIN screen: the phrase screen, shown exactly once.
    await click(button(t.continueBtn));
    expect(activeStep()).toBe(3);
    const phrase = (host.querySelector('[data-testid="recovery-phrase"]')?.textContent ?? '').trim();
    expect(phrase).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    // savedAt is a clock reading; on 3 Oct 2026 21:2x it ended in 7777 and this check read it as the PIN (F66).
    const everything = JSON.stringify({ local, session }, (key, value) => (key === 'savedAt' ? undefined : value));
    expect(everything).not.toContain('7777');
    expect(everything).not.toContain(phrase);
    expect(everything).not.toContain(phrase.replace('-', ''));

    // And because neither is kept, the rebuilt popup comes back to the screen
    // that collects them rather than to a screen it cannot fill.
    await unmountWizard();
    await mountWizard();
    expect(activeStep()).toBe(2);
    expect(heading()).toBe(t.setupPinTitle);
  });
});

describe('finishing the setup clears the draft', () => {
  it('an adult install ends on the mode screen and leaves no draft behind', async () => {
    await mountWizard();
    await click(button(t.beginSetup));
    expect(activeStep()).toBe(1);
    // Nothing is pre-selected since 18 Sep 2026, so the draft has nothing to
    // keep until the parent answers the screen, and the button that finishes
    // an adult install is not on it until Adult is the answer.
    expect(session[SETUP_DRAFT_KEY]).toBeUndefined();
    const adult = Array.from(host.querySelectorAll<HTMLElement>('.mode-btn'))
      .find(b => b.querySelector('.label')?.textContent?.trim() === t.modeAdult)!;
    await click(adult);
    expect(session[SETUP_DRAFT_KEY]).toBeTruthy();

    await click(host.querySelector('[data-testid="setup-start-free"]') as HTMLElement);
    await settle();

    expect(completed).toHaveBeenCalledTimes(1);
    expect(local['setupDone']).toBe(true);
    expect(local['mode']).toBe('adult');
    expect(session[SETUP_DRAFT_KEY]).toBeUndefined();
    expect(local[SETUP_DRAFT_KEY]).toBeUndefined();
    expect(await readSetupDraft()).toBeNull();
  });
});

describe('the phrase screen says where the two secrets end up', () => {
  it('in every language, and not on an adult install, which sets neither', () => {
    for (const locale of Object.keys(POPUP_STRINGS) as Array<keyof typeof POPUP_STRINGS>) {
      const table = POPUP_STRINGS[locale];
      expect(table.setupWhereSecretsNote.length, `${locale}`).toBeGreaterThan(60);
      expect(table.setupWhereSecretsNote, `${locale}`).not.toContain('—');
    }
    // The line is on the recovery-phrase screen, where the two secrets are made;
    // an adult install finishes on the mode screen and is never shown it.
    // The setup wizard has its own file since PLAN-2026-09-16 item 10.3.
    const source = readFileSync(join(process.cwd(), 'src/ui/popup/panels/SetupWizard.tsx'), 'utf8');
    expect(source).toContain("const secretsNote = mode !== 'adult' && (");
    expect(source).toContain('<p className="tag">{t.setupWhereSecretsNote}</p>');
  });
});
