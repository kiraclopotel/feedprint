/** @vitest-environment jsdom */
// F37 (verifier's note on B2F, 09:10). The padlock showed on every disabled-and-off switch, also where nothing is locked
// by the level: AI checks without a key at Moderate and Relaxed, the rewrite switch on YouTube. A padlock means "fixed by
// this level"; a switch that waits for a key, or does not apply to the site, gets the plain disabled look (dimmed, no
// padlock). And a padlocked-off switch is not dimmed (P4-2): the dimming is what made a lock read as an empty outline.

import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

import { SettingsPanel } from '../../../../src/ui/popup/Popup';
import { Toggle } from '../../../../src/ui/popup/controls';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import type { FWSettings } from '../../../../src/storage/settings';
import { childPreset, teenPreset } from '../../../../src/storage/presets';
import type { LicenseInfo } from '../../../../src/storage/license';

vi.mock('../../../../src/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/ai/client')>();
  return { ...actual, probeProxy: vi.fn(async () => 'ok') };
});

type Mode = 'child' | 'teen';
const PAID: LicenseInfo = { tier: 'family', secret: 'abc' } as unknown as LicenseInfo;
const FREE: LicenseInfo = { tier: 'free', secret: '' } as unknown as LicenseInfo;
const t = POPUP_STRINGS.en;

function settingsWith(mode: Mode): FWSettings {
  return {
    settingsSchemaVersion: '14', mode, strictLanguage: false, hideUnrewritable: false,
    parentPin: '1234', dailyCap: 2000, monthlyUsdCapOverride: null, locale: 'en', outputLanguage: 'auto', uiLanguage: 'auto',
    totalChecksToday: 0, totalNeutralizedToday: 0, totalTokensToday: 0, estimatedCostToday: 0, lastResetDate: '',
    totalChecksThisMonth: 0, totalTokensThisMonth: 0, lastResetMonth: '', totalTokensAllTime: 0, totalChecksAllTime: 0,
    totalNeutralizedAllTime: 0, estimatedCostAllTime: 0, metricsHiddenToday: 0, metricsHiddenAllTime: 0,
    features: mode === 'child' ? childPreset() : teenPreset(),
    presets: { appliedAt: '', appliedPreset: mode }, dashboardTheme: 'dark', aiAnalysisEnabled: true,
  } as unknown as FWSettings;
}

function render(mode: Mode, license: LicenseInfo, platform: 'youtube' | null = null): Document {
  const html = renderToString(createElement(I18nProvider, {
    lang: 'en',
    children: createElement(SettingsPanel, {
      settings: settingsWith(mode), license, onBack: () => {}, onChange: async () => {}, platform,
    }),
  }));
  return new DOMParser().parseFromString(html, 'text/html');
}

const switches = (doc: Document) => Array.from(doc.querySelectorAll<HTMLElement>('[role="switch"]'));
const disabledOff = (doc: Document) => switches(doc).filter(s => s.getAttribute('aria-disabled') === 'true' && s.getAttribute('aria-checked') === 'false');
const named = (doc: Document, label: string) => switches(doc).find(s => s.getAttribute('aria-label') === label);

describe('a padlock means the level holds the switch (F37)', () => {
  it('Silent with a key: AI checks is a live switch, held by nothing (Silent reads with a key since 12 Oct 2026)', () => {
    const ai = named(render('child', PAID), t.featAiMasterName)!;
    expect(ai, 'AI checks at Silent').toBeDefined();
    expect(ai.getAttribute('aria-disabled')).toBeNull();
    expect(ai.querySelector('.toggle-lock'), 'no padlock').toBeNull();
  });

  it('Calm without a key: no switch that is off and disabled wears a padlock', () => {
    const doc = render('teen', FREE);
    for (const s of disabledOff(doc)) expect(s.querySelector('.toggle-lock'), s.getAttribute('aria-label') ?? '').toBeNull();
  });

  it('Calm with a key: AI checks is a live switch', () => {
    const ai = named(render('teen', PAID), t.featAiMasterName)!;
    expect(ai.getAttribute('aria-disabled')).toBeNull();
    expect(ai.querySelector('.toggle-lock')).toBeNull();
  });

  it('a switch that does not apply on YouTube is dimmed, with no padlock', () => {
    const doc = render('teen', PAID, 'youtube');
    const off = disabledOff(doc);
    expect(off.length, 'the rewrite switch on YouTube').toBeGreaterThanOrEqual(1);
    for (const s of off) {
      expect(s.querySelector('.toggle-lock'), s.getAttribute('aria-label') ?? '').toBeNull();
      expect(s.style.opacity).toBe('0.45');
    }
  });

  it('the Toggle itself: a padlock only when it is told the level holds it', () => {
    const one = (props: { disabled?: boolean; heldByLevel?: boolean }) => new DOMParser().parseFromString(renderToString(createElement(Toggle, { on: false, onClick: () => {}, label: 'x', ...props })), 'text/html').querySelector('[role="switch"]')!;
    expect(one({ disabled: true }).querySelector('.toggle-lock')).toBeNull();
    expect(one({ disabled: true, heldByLevel: true }).querySelector('.toggle-lock')).not.toBeNull();
    expect(one({}).querySelector('.toggle-lock')).toBeNull();
  });
});
