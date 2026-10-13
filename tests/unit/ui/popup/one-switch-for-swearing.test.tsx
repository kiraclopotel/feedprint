// @vitest-environment jsdom
// Feedprint's Settings had two switches for one function: "Strict language" and "Mask swearing" both reach
// blanketProfanitySoften (pipeline.ts), so turning one off left the other starring words (Board, 11 Oct 2026; Code read
// that no storage change is needed: the Strict level and Off keep writing strictLanguage). One switch is left, Mask
// swearing, with its own words. Pressed off, it clears both bits, or the stars would stay; pressed on, it sets its own.
// At Strict it stays on and locked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SettingsPanel } from '../../../../src/ui/popup/Popup';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { type FWSettings, utcDayKey } from '../../../../src/storage/settings';
import { teenPreset, childPreset } from '../../../../src/storage/presets';
import type { LicenseInfo } from '../../../../src/storage/license';
import { installCounterChrome, type FakeCounterChrome } from '../../../helpers/fake-counter-chrome';

vi.mock('../../../../src/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/ai/client')>();
  return { ...actual, probeProxy: vi.fn(async () => 'ok') };
});
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = POPUP_STRINGS.en;
const FREE = { tier: 'free', secret: '' } as unknown as LicenseInfo;
const make = (mode: 'teen' | 'child', strictLanguage: boolean) => ({
  settingsSchemaVersion: '14', mode, features: mode === 'child' ? childPreset() : teenPreset(), strictLanguage,
  parentPin: '1234', locale: 'en', uiLanguage: 'en', dashboardTheme: 'dark', lastResetDate: utcDayKey(),
} as unknown as FWSettings);

let fake: FakeCounterChrome;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

async function panel(s: FWSettings): Promise<void> {
  fake = installCounterChrome({ features: s.features, strictLanguage: s.strictLanguage, mode: s.mode });
  await act(async () => {
    root.render(createElement(I18nProvider, { lang: 'en', children: createElement(SettingsPanel, { settings: s, license: FREE, onBack: () => {}, onChange: async () => {}, openOn: 'general' }) }));
  });
}
const sw = (label: string) => container.querySelector(`[role="switch"][aria-label="${label}"]`) as HTMLElement | null;
const soften = () => (fake.state.features as Record<string, { enabled: boolean }>)['soften-swearing'].enabled;

describe('one switch for swearing', () => {
  it('Settings shows Mask swearing and no Strict language row', async () => {
    await panel(make('teen', false));
    expect(container.textContent).not.toContain('Strict language');
    expect(sw(t.softenSwearingName)).not.toBeNull();
    expect((t as unknown as Record<string, unknown>).strictLangName).toBeUndefined();
  });

  it('with the old Strict language bit on, the switch reads on, can be pressed, and off clears both', async () => {
    await panel(make('teen', true));
    const s = sw(t.softenSwearingName)!;
    expect(s.getAttribute('aria-checked')).toBe('true');
    expect(s.getAttribute('aria-disabled')).not.toBe('true');
    await act(async () => { s.click(); });
    for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(fake.state.strictLanguage).toBe(false);
    expect(soften()).toBe(false);
  });

  it('off, pressed on, it sets its own bit', async () => {
    await panel(make('teen', false));
    await act(async () => { sw(t.softenSwearingName)!.click(); });
    for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(soften()).toBe(true);
  });

  it('at Strict it is on and locked, and a press changes nothing', async () => {
    await panel(make('child', false));
    const s = sw(t.softenSwearingAriaChild)!;
    expect(s.getAttribute('aria-checked')).toBe('true');
    expect(s.getAttribute('aria-disabled')).toBe('true');
    await act(async () => { s.click(); });
    expect(soften()).toBe(true);
  });
});
