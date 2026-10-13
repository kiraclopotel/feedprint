/** @vitest-environment jsdom */
// V12, V1 and V3 on screen (board/units/V12.md). The harness of the PIN part is a copy of the top of
// the-consent-close-mark-sits-beside-the-heading.test.tsx (its PIN mock, its stored install, the probe answer and the helpers); the suite
// that follows is new, and that file is not edited.
//
// V1: right after setup, at Moderate with a key, "Before the first reading" shows; the person presses "Not now" and the PIN lock opened
// with no reason ("Why do I need a PIN to say no? I only just made the PIN."). The lock now carries one line above its title while a
// reading answer waits, in the four languages; Settings' own lock carries none.
// V3: setup's PIN step at Moderate shows the Moderate paragraph and not the clause about leaving Strict; at Strict the old paragraph and
// its pinned phrase stand.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';

import { installChromeStorageStub } from '../../../helpers/chrome-storage';
import { utcDayKey, utcMonthKey, CURRENT_SETTINGS_SCHEMA_VERSION } from '../../../../src/storage/settings';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { installStorage, unmount, mount, host, click, button, modeButton } from '../../../helpers/popup-walk';
import { SetupWizard } from '../../../../src/ui/popup/Popup';

const pins = vi.hoisted(() => ({ right: '1234', wrong: '9999' }));

// The PIN's own hashing and throttle have their tests; here only the popup's gate is under test.
vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    verifyPin: vi.fn(async (pin: string) => pin === pins.right),
    pinLockRemainingMs: vi.fn(async () => 0),
    isPinGraceActive: vi.fn(async () => false),
  };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Lang = 'en' | 'ro' | 'es' | 'pt-BR';
const LANGS: Lang[] = ['en', 'ro', 'es', 'pt-BR'];
const SERVED = 'Served Company Inc., USA';
const STORED_PIN = 'a'.repeat(64);

// The voice seat's words, written out here as the spec (WORDS.md V1, V3).
const REASON: Record<Lang, string> = {
  en: 'Either answer changes a setting, so the PIN comes first.',
  ro: 'Oricare răspuns schimbă o setare, așa că mai întâi e nevoie de PIN.',
  es: 'Cualquiera de las dos respuestas cambia un ajuste, así que primero hace falta el PIN.',
  'pt-BR': 'Qualquer uma das respostas muda uma configuração, então o PIN vem antes.',
};
const STRICT_CLAUSE: Record<Lang, RegExp> = {
  en: /leaving Silent asks for it again/,
  es: /salir de Silencioso lo vuelve a pedir/,
  'pt-BR': /sair do Silencioso pede o PIN de novo/,
  ro: /ieșirea din nivelul Silențios îl cere din nou/,
};

function stored(over: Record<string, unknown>): Record<string, unknown> {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION, lastResetDate: utcDayKey(), lastResetMonth: utcMonthKey(),
    fw_license_key: 'fw-starter-abc12345', dailyCap: 2500, totalChecksToday: 0, totalTokensThisMonth: 100,
    setupDone: true, mode: 'teen', levelChosen: true, aiAnalysisEnabled: true, parentPin: STORED_PIN, ...over,
  };
}

function probeAnswer(header: string | null): Response {
  return { status: 200, headers: { get: (n: string) => (n.toLowerCase() === 'x-fw-provider-legal' ? header : null) } } as unknown as Response;
}

async function settle(ms = 20): Promise<void> {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

async function openPopup(over: Record<string, unknown>): Promise<void> {
  installChromeStorageStub({ initial: stored(over), sendMessage: () => undefined });
  // The settings module outlives vi.resetModules through the mock above, and so does its read cache:
  // a write drops it, so no case reads the PIN or the reading switch a case before it left.
  await (await import('../../../../src/storage/settings')).saveSettings({});
  (globalThis as { fetch: unknown }).fetch = vi.fn(() => Promise.resolve(probeAnswer(SERVED)));
  document.body.innerHTML = '<div id="root"></div>';
  await import('../../../../src/ui/popup/Popup');
  await settle();
  await settle();
  expect(document.querySelector('#pop-tab-home'), 'the main screen is shown, so the test is looking at the real popup').not.toBeNull();
}

const consentScreen = (): Element | null => document.querySelector('[data-testid="reading-consent"]');
const pinDialog = (): Element | null => document.querySelector('.pin-overlay:not([data-testid="reading-consent"])');

describe('V1: the PIN ask on "Not now" says why', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

  it.each(LANGS)('at Moderate with a key and a PIN, "Not now" opens the lock with the reason, in %s', async (lang) => {
    await openPopup({ uiLanguage: lang });
    expect(consentScreen(), 'the reading screen is asked for').not.toBeNull();
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-testid="consent-not-now"]')!.click(); });
    await settle();
    const lock = pinDialog();
    expect(lock, 'the PIN lock is open').not.toBeNull();
    expect(lock!.textContent, 'the lock says why').toContain(REASON[lang]);
  });

  it('Start opens the same lock with the same reason (the reason is true of both answers)', async () => {
    await openPopup({ uiLanguage: 'en' });
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-testid="consent-start"]')!.click(); });
    await settle();
    expect(pinDialog()!.textContent).toContain(REASON.en);
  });

  it('Settings opened with the PIN shows the lock with no reason line', async () => {
    // The reading is off, so no answer is owed: only Settings can open the lock.
    await openPopup({ uiLanguage: 'en', aiAnalysisEnabled: false });
    expect(consentScreen(), 'no reading answer is owed').toBeNull();
    const gear = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.getAttribute('aria-label') === POPUP_STRINGS.en.settingsBtn);
    expect(gear, 'the Settings control is on the header').toBeTruthy();
    await act(async () => { gear!.click(); });
    await settle();
    const lock = pinDialog();
    expect(lock, 'the PIN lock is open').not.toBeNull();
    for (const lang of LANGS) expect(lock!.textContent, `no reason line in ${lang}`).not.toContain(REASON[lang]);
  });
});

describe('V3: setup\'s PIN step at Moderate has no clause about Strict', () => {
  beforeEach(() => { installStorage({}); });
  afterEach(async () => { await unmount(); });

  async function pinStep(level: 'child' | 'teen', lang: Lang): Promise<string> {
    const s = POPUP_STRINGS[lang];
    await mount(createElement(SetupWizard, { onComplete: () => {} }), lang);
    await click(button(s.beginSetup));
    await click(modeButton(level === 'child' ? s.modeChild : s.modeTeen));
    await click(host.querySelector<HTMLElement>('[data-testid="setup-continue"]')!);
    const para = Array.from(host.querySelectorAll<HTMLElement>('p.tag')).find((p) => p.textContent === s.setupPinBodyModerate || p.textContent === s.setupPinBody);
    expect(para, 'the PIN step shows its paragraph').toBeTruthy();
    return para!.textContent!;
  }

  it.each(LANGS)('Moderate in %s shows the Moderate value and not "leaving Strict"', async (lang) => {
    const text = await pinStep('teen', lang);
    expect(text).toBe(POPUP_STRINGS[lang].setupPinBodyModerate);
    expect(text).not.toMatch(STRICT_CLAUSE[lang]);
  });

  it.each(LANGS)('Strict in %s keeps the old value and its pinned phrase', async (lang) => {
    const text = await pinStep('child', lang);
    expect(text).toBe(POPUP_STRINGS[lang].setupPinBody);
    expect(text).toMatch(STRICT_CLAUSE[lang]);
  });
});
