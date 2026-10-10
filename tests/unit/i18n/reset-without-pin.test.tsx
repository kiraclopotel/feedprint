/** @vitest-environment jsdom */
// The reset button did nothing. On an install with no
// PIN, which is every adult install and every fresh install after a reinstall,
// the confirm modal refused the reset outright and sent the parent to the popup
// to set a PIN first (ResetChainConfirmModal, the noPin branch), and the
// service worker refused the same envelope a second time. Nothing the parent
// could do from that screen reset anything.
//
// The reset is now confirmed by typing the product's own word. That is a
// deliberate act, not a gate: where no PIN exists there is no secret to check,
// and a restore, which can replace the whole chain and the signing identity
// with it, has run on that rule since earlier the same day.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const getSettings = vi.fn(async () => ({ parentPin: '' } as unknown as Record<string, unknown>));
vi.mock('../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/storage/settings')>();
  return { ...actual, getSettings: (...a: unknown[]) => getSettings(...(a as [])) };
});

import { ResetChainConfirmModal } from '../../../src/ui/dashboard/components/ResetChainConfirmModal';
import { I18nProvider } from '../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';
import { UI_LANGUAGES, type ResolvedUiLanguage } from '../../../src/i18n';
import { SETUP_DRAFT_KEY } from '../../../src/storage/setup-draft';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CLEAN_RESULT = {
  recordsCleared: 6, recordsArchived: 6, signingIdentityRetained: true,
  scanLogCleared: true, authorProfilesCleared: true, verdictsCleared: true,
  diagnosticsCleared: true, usageStatsCleared: true, resetMarkerWritten: true,
  parentFeedbackCleared: true, chainAnchorsCleared: true,
};

const sendMessage = vi.fn(async () => ({ ok: true, result: CLEAN_RESULT }));
const onClose = vi.fn();
const onSuccess = vi.fn();
let session: Record<string, unknown> = {};
let host: HTMLDivElement;
let root: Root;

const settle = async (): Promise<void> => {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

async function mountModal(lang: ResolvedUiLanguage = 'en'): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(I18nProvider, {
      lang,
      children: createElement(ResetChainConfirmModal, { onClose, onSuccess }),
    }));
  });
  await settle();
}

function wordBox(): HTMLInputElement {
  const el = host.querySelector<HTMLInputElement>('[data-testid="reset-confirm-word"]');
  if (!el) throw new Error(`no word box (modal reads: ${host.textContent?.slice(0, 160)})`);
  return el;
}

function confirmBtn(): HTMLButtonElement {
  return host.querySelector<HTMLButtonElement>('[data-testid="reset-confirm-word-btn"]')!;
}

async function type(value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(wordBox(), value);
    wordBox().dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
}

beforeEach(() => {
  sendMessage.mockClear();
  onClose.mockClear();
  onSuccess.mockClear();
  getSettings.mockResolvedValue({ parentPin: '' } as unknown as Record<string, unknown>);
  session = { [SETUP_DRAFT_KEY]: { step: 2, mode: 'child', savedAt: 1 } };
  vi.stubGlobal('chrome', {
    runtime: { sendMessage },
    storage: {
      session: {
        get: () => Promise.resolve({ ...session }),
        set: (o: Record<string, unknown>) => { Object.assign(session, o); return Promise.resolve(); },
        remove: (k: string) => { delete session[k]; return Promise.resolve(); },
      },
      local: {
        get: () => Promise.resolve({}),
        set: () => Promise.resolve(),
        remove: () => Promise.resolve(),
      },
    },
  });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  vi.unstubAllGlobals();
});

describe('an install with no PIN can reset the record', () => {
  it('the typed word runs the reset, with no PIN in the envelope', async () => {
    await mountModal();
    // The same warning as the PIN path: a reset is not softer here.
    expect(host.textContent).toContain(DASHBOARD_STRINGS.en.resetBodyBold2);
    expect(confirmBtn().disabled).toBe(true);

    await type('reset');
    expect(confirmBtn().disabled).toBe(false);
    await act(async () => { confirmBtn().click(); });
    await settle();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'RESET_FORENSIC_CHAIN', payload: {} });
    expect(onSuccess).toHaveBeenCalledWith(CLEAN_RESULT);
    expect(onClose).toHaveBeenCalledTimes(1);
    // Nothing of the first run is left to come back to.
    await settle();
    expect(session[SETUP_DRAFT_KEY]).toBeUndefined();
  });

  it('any other word resets nothing and says so', async () => {
    await mountModal();
    await type('yes');
    expect(confirmBtn().disabled).toBe(true);
    // Enter is the other way in, and it must refuse the same way.
    await act(async () => {
      wordBox().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await settle();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(host.textContent).toContain(DASHBOARD_STRINGS.en.resetWordWrong);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('case and stray spaces are not part of the act', async () => {
    await mountModal();
    await type('  RESET ');
    expect(confirmBtn().disabled).toBe(false);
    await act(async () => { confirmBtn().click(); });
    await settle();
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('every language has its own word, and the English one is accepted everywhere', async () => {
    for (const lang of UI_LANGUAGES) {
      const t = DASHBOARD_STRINGS[lang];
      expect(t.resetConfirmWord.length, `${lang}`).toBeGreaterThan(2);
      expect(t.enterWordToConfirm(t.resetConfirmWord), `${lang}`).toContain(t.resetConfirmWord);
      expect(t.enterWordToConfirm(t.resetConfirmWord), `${lang}`).not.toContain('—');

      sendMessage.mockClear();
      await mountModal(lang);
      expect(host.textContent).toContain(t.enterWordToConfirm(t.resetConfirmWord));
      await type(t.resetConfirmWord);
      expect(confirmBtn().disabled, `${lang}`).toBe(false);
      await act(async () => { confirmBtn().click(); });
      await settle();
      expect(sendMessage, `${lang}`).toHaveBeenCalledWith({ type: 'RESET_FORENSIC_CHAIN', payload: {} });
      await act(async () => { root.unmount(); });
      host.remove();

      sendMessage.mockClear();
      await mountModal(lang);
      await type('reset');
      expect(confirmBtn().disabled, `${lang} falls back to the English word`).toBe(false);
      if (lang !== UI_LANGUAGES[UI_LANGUAGES.length - 1]) {
        await act(async () => { root.unmount(); });
        host.remove();
      }
    }
  });
});

describe('an install with a PIN is unchanged', () => {
  it('asks for four digits and offers no word box', async () => {
    getSettings.mockResolvedValue({ parentPin: 'pbkdf2$1$aa$bb' } as unknown as Record<string, unknown>);
    await mountModal();
    expect(host.querySelectorAll('input.pin-input').length).toBe(4);
    expect(host.querySelector('[data-testid="reset-confirm-word"]')).toBeNull();
    expect(host.textContent).toContain(DASHBOARD_STRINGS.en.enterPinToConfirm);
  });
});
