/** @vitest-environment jsdom */
// The whole popup, with a key present: the consent screen names the company the proxy served on the
// licence probe, and the consent it stores carries that same name. Nothing in the build holds the
// name, so this is the only way it can reach the screen. When the proxy names none, the screen
// says so and cannot be agreed to; when the name changes, a stored consent for the old one asks again.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';

import { installChromeStorageStub } from '../../../helpers/chrome-storage';
import { utcDayKey, utcMonthKey, CURRENT_SETTINGS_SCHEMA_VERSION } from '../../../../src/storage/settings';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = POPUP_STRINGS.en;
const SERVED = 'Served Company Inc., USA';

function stored(): Record<string, unknown> {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION, lastResetDate: utcDayKey(), lastResetMonth: utcMonthKey(),
    fw_license_key: 'fw-starter-abc12345', dailyCap: 2500, totalChecksToday: 0, totalTokensThisMonth: 100,
    setupDone: true, mode: 'adult', aiAnalysisEnabled: true,
  };
}

function probeAnswer(header: string | null): Response {
  return { status: 200, headers: { get: (n: string) => (n.toLowerCase() === 'x-fw-provider-legal' ? header : null) } } as unknown as Response;
}

async function settle(): Promise<void> {
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

async function openPopup(served: string | null, initial: Record<string, unknown> = {}): Promise<HTMLElement> {
  installChromeStorageStub({ initial: { ...stored(), ...initial }, sendMessage: () => undefined });
  (globalThis as { fetch: unknown }).fetch = vi.fn(async () => probeAnswer(served));
  document.body.innerHTML = '<div id="root"></div>';
  await import('../../../../src/ui/popup/Popup');
  await settle();
  await settle();
  return document.getElementById('root') as HTMLElement;
}

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('the popup with a key and no consent', () => {
  it('names the company the proxy served, and what the button stores names it too', async () => {
    const root = await openPopup(SERVED);
    const screen = root.querySelector('[data-testid="reading-consent"]');
    expect(screen).not.toBeNull();
    expect(screen!.textContent).toContain(t.consentToWhom(SERVED));

    await act(async () => { (root.querySelector('[data-testid="consent-start"]') as HTMLButtonElement).click(); });
    await settle();
    const rc = await import('../../../../src/storage/reading-consent');
    const kept = await rc.getReadingConsent('fw-starter-abc12345');
    expect(kept?.provider).toBe(SERVED);
    expect(root.querySelector('[data-testid="reading-consent"]')).toBeNull();
  });

  it('says it cannot start when the proxy served no name, and the button is dead', async () => {
    const root = await openPopup(null);
    const screen = root.querySelector('[data-testid="reading-consent"]');
    expect(screen).not.toBeNull();
    expect(screen!.textContent).toContain(t.consentProviderUnknown);
    expect((root.querySelector('[data-testid="consent-start"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('asks again when a stored consent is for another company than the one served now', async () => {
    const rc = await import('../../../../src/storage/reading-consent');
    const slot = (await import('../../../../src/forensics/hasher'));
    const digest = (await slot.sha256('fw-starter-abc12345')).slice(0, 32);
    const old = { textVersion: rc.READING_CONSENT_TEXT_VERSION, textHash: 'a'.repeat(64), at: '2026-10-05T10:00:00.000Z', provider: 'Old Company Ltd., EU' };
    const root = await openPopup(SERVED, { readingConsent: { [digest]: old } });
    const screen = root.querySelector('[data-testid="reading-consent"]');
    expect(screen).not.toBeNull();
    expect(screen!.textContent).toContain(SERVED);
    expect(screen!.textContent).not.toContain('Old Company');
  });

  it('does not ask again when the stored consent is for the company served', async () => {
    const rc = await import('../../../../src/storage/reading-consent');
    const slot = (await import('../../../../src/forensics/hasher'));
    const digest = (await slot.sha256('fw-starter-abc12345')).slice(0, 32);
    const given = { textVersion: rc.READING_CONSENT_TEXT_VERSION, textHash: 'a'.repeat(64), at: '2026-10-05T10:00:00.000Z', provider: SERVED };
    const root = await openPopup(SERVED, { readingConsent: { [digest]: given } });
    expect(root.querySelector('[data-testid="reading-consent"]')).toBeNull();
  });
});
