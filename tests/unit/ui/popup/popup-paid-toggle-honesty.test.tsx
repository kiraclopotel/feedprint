// Q86 — paid rows are HIDDEN without a license; stored values stay honest.
//
// History. D8 (2026-06) made license-gated toggles show their STORED value
// in a neutral "unavailable" state instead of masking them to off, because
// masking made a pasted license look like it had flipped switches by itself.
// Q86 (ruling, 2026-08-11) replaces the grayed state with hiding: an
// unpaid install does not render rows it cannot use. The D8 invariant is
// preserved in a stronger form and locked here:
//   - unlicensed: no AI row renders at all, so no masking is possible,
//     and no AI card either: nothing is sent or spent without a key;
//   - licensed: every paid row renders at exactly the stored value —
//     pasting a key reveals what the presets/parent stored, flips nothing;
//   - the master "AI checks" breaker renders on every tier that holds a
//     key (W6: stopping spend must never require more than the key that spends).
//
// Test strategy follows popup-license-honesty.test.tsx: renderToString on
// the real panel (no @testing-library in this project), then read switch
// buttons out of the markup by aria-label.

import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { SettingsPanel } from '../../../../src/ui/popup/Popup';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import type { FWSettings } from '../../../../src/storage/settings';
import { teenPreset } from '../../../../src/storage/presets';
import type { LicenseInfo } from '../../../../src/storage/license';

const EN = POPUP_STRINGS.en;
const REWRITE = EN.featRewriteName;

function settingsWith(rewriteEnabled: boolean): FWSettings {
  const features = teenPreset();
  features['rewritten-comments-first'].enabled = rewriteEnabled;
  return {
    settingsSchemaVersion: '12',
    mode: 'teen',
    strictLanguage: false,
    hideUnrewritable: false,
    parentPin: '1234', dailyCap: 2000, monthlyUsdCapOverride: null, locale: 'en',
    outputLanguage: 'auto', uiLanguage: 'auto',
    totalChecksToday: 0, totalNeutralizedToday: 0, totalTokensToday: 0,
    estimatedCostToday: 0, lastResetDate: '',
    totalChecksThisMonth: 0, totalTokensThisMonth: 0, lastResetMonth: '',
    totalTokensAllTime: 0, totalChecksAllTime: 0,
    totalNeutralizedAllTime: 0, estimatedCostAllTime: 0,
    features,
    presets: { appliedAt: '', appliedPreset: 'teen' },
    dashboardTheme: 'dark',
  } as FWSettings;
}

function renderPanel(tier: LicenseInfo['tier'], rewriteEnabled: boolean): string {
  return renderToString(
    createElement(I18nProvider, {
      lang: 'en',
      children: createElement(SettingsPanel, {
        settings: settingsWith(rewriteEnabled),
        license: { tier } as LicenseInfo,
        onBack: () => { /* no-op */ },
        onChange: async () => { /* no-op */ },
      }),
    }),
  );
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The rendered <button role="switch"> markup for one row, by aria-label. */
function switchMarkup(html: string, label: string): string {
  const match = html.match(new RegExp(`<button[^>]*aria-label="${esc(label)}"[^>]*>`));
  if (!match) throw new Error(`no switch rendered for "${label}"`);
  return match[0];
}

function hasSwitch(html: string, label: string): boolean {
  return new RegExp(`<button[^>]*aria-label="${esc(label)}"[^>]*>`).test(html);
}

const PAID_ROW_LABELS = [
  EN.featRewriteName,
  EN.reframeRewritesName,
];

describe('Q86 — paid AI rows hidden without a license, honest when revealed', () => {
  it('free tier renders NO paid row, regardless of stored value', () => {
    for (const stored of [true, false]) {
      const html = renderPanel('free', stored);
      for (const label of PAID_ROW_LABELS) {
        expect(hasSwitch(html, label), `"${label}" must not render on free tier`).toBe(false);
      }
    }
  });

  it('the swear mask row renders on the free tier: stars need no model (2026-09-07)', () => {
    const html = renderPanel('free', true);
    expect(hasSwitch(html, EN.softenSwearingName)).toBe(true);
  });

  it('a paid tier renders every paid row live', () => {
    const html = renderPanel('family', true);
    for (const label of PAID_ROW_LABELS) {
      expect(hasSwitch(html, label), `"${label}" must render on a paid tier`).toBe(true);
    }
  });

  it('paid rows render the STORED value on paid tiers — revealing never flips (D8 intent)', () => {
    for (const tier of ['starter', 'family'] as const) {
      for (const stored of [true, false]) {
        const markup = switchMarkup(renderPanel(tier, stored), REWRITE);
        expect(markup).toContain(`aria-checked="${stored}"`);
        expect(markup).not.toContain('disabled=""');
      }
    }
  });

  it('the master AI breaker renders on every tier that holds a key, and not without one', () => {
    for (const tier of ['starter', 'family'] as const) {
      expect(hasSwitch(renderPanel(tier, true), EN.featAiMasterName)).toBe(true);
    }
    expect(hasSwitch(renderPanel('free', true), EN.featAiMasterName)).toBe(false);
  });
});
