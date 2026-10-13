// RECON F4 (2026-08-18) — a locked-ON switch must not look like an OFF switch.
//
// A report from a live install named two settings in child mode that "could not
// be changed". The behaviour was correct: "Strict language" and "Hide when a
// rewrite is impossible" are forced ON and locked while child mode is active.
// The affordance was not. Every disabled Toggle rendered at 0.45 opacity
// regardless of state, so locked-ON and plain OFF painted the same washed-out
// control, and a working lock read as a possible fault.
//
// Locked here: `on && disabled` carries the `locked-on` class (padlock styling in
// popup-design.css) and does NOT carry the dimming inline style, while a disabled
// OFF switch still dims, because there paleness means what it says.
//
// Test strategy follows popup-paid-toggle-honesty.test.tsx: renderToString on the
// real panel (no @testing-library in this project), then read switch buttons out
// of the markup by aria-label.

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { SettingsPanel } from '../../../src/ui/popup/Popup';
import { I18nProvider } from '../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../src/i18n/popup-strings';
import type { FWSettings } from '../../../src/storage/settings';
import { childPreset, teenPreset } from '../../../src/storage/presets';
import type { LicenseInfo } from '../../../src/storage/license';

const EN = POPUP_STRINGS.en;

function settingsFor(mode: FWSettings['mode']): FWSettings {
  return {
    settingsSchemaVersion: '12',
    mode,
    strictLanguage: false,
    hideUnrewritable: false,
    parentPin: '1234', dailyCap: 2000, monthlyUsdCapOverride: null, locale: 'en',
    outputLanguage: 'auto', uiLanguage: 'auto',
    totalChecksToday: 0, totalNeutralizedToday: 0, totalTokensToday: 0,
    estimatedCostToday: 0, lastResetDate: '',
    totalChecksThisMonth: 0, totalTokensThisMonth: 0, lastResetMonth: '',
    totalTokensAllTime: 0, totalChecksAllTime: 0,
    totalNeutralizedAllTime: 0, estimatedCostAllTime: 0,
    features: mode === 'child' ? childPreset() : teenPreset(),
    presets: { appliedAt: '', appliedPreset: mode === 'child' ? 'child' : 'teen' },
    dashboardTheme: 'dark',
  } as FWSettings;
}

function renderPanel(mode: FWSettings['mode']): string {
  return renderToString(
    createElement(I18nProvider, {
      lang: 'en',
      children: createElement(SettingsPanel, {
        settings: settingsFor(mode),
        license: { tier: 'family' } as LicenseInfo,
        onBack: () => { /* no-op */ },
        onChange: async () => { /* no-op */ },
        openOn: 'general',
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

// The rewrite-failure hide switch is gone (2026-09-07), so Strict language was the only locked row.
// Child mode holds the soften-swearing row as well, since 2026-09-19: the
// Strict-language row above it says Child mode softens swearing, and this one
// sat beneath it live and clickable, with no mode branch in the gate to stop a
// child turning the masking off.
// Since 11 Oct 2026 Mask swearing is the one switch for swearing; Strict language's row is gone.
const CHILD_LOCKED_LABELS = [EN.softenSwearingAriaChild];

describe('RECON F4 — locked-ON switches read as held, not as off', () => {
  it('child mode renders every locked row ON and held, and keeps it reachable', () => {
    const html = renderPanel('child');
    for (const label of CHILD_LOCKED_LABELS) {
      const markup = switchMarkup(html, label);
      expect(markup, label).toContain('aria-checked="true"');
      // `aria-disabled`, not `disabled`. The HTML attribute removes a button
      // from the tab order entirely, so a switch held ON in child mode
      // vanished from a keyboard user's and a screen reader's world instead of
      // announcing why it cannot be changed (accessibility audit, 2026-09-18).
      // What must stay true is that it cannot be operated, and that is asserted
      // below against the handler rather than against the attribute.
      expect(markup, label).toContain('aria-disabled="true"');
      expect(markup, label).not.toContain('disabled=""');
    }
  });

  it('a held switch does nothing when it is pressed, which is what the attribute used to enforce', () => {
    // Every call site that holds a switch guards its own onClick, so removing
    // the HTML attribute did not make the row operable. This reads the source
    // of those guards, because the panel's writes go through storage the
    // renderer here does not run.
    // The AI card's rows live in their own file since the card left SettingsPanel.
    const panel = ['src/ui/popup/panels/SettingsPanel.tsx', 'src/ui/popup/panels/ai/AiCard.tsx']
      .map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(panel).toContain('onClick={() => { if (!childMode) void toggleMask(); }}');
    expect(panel).toContain('onClick={() => { if (!onYouTube) void toggle(r.id); }}');
  });

  it('a locked-ON switch carries the locked-on class', () => {
    const html = renderPanel('child');
    for (const label of CHILD_LOCKED_LABELS) {
      expect(switchMarkup(html, label), label).toMatch(/class="[^"]*\blocked-on\b/);
    }
  });

  it('a locked-ON switch is NOT dimmed, which read as off', () => {
    const html = renderPanel('child');
    for (const label of CHILD_LOCKED_LABELS) {
      const markup = switchMarkup(html, label);
      expect(markup, label).not.toMatch(/opacity/);
      expect(markup, label).toContain('cursor:not-allowed');
    }
  });

  it('an unlocked switch stays plain: no lock styling, no dimming', () => {
    const markup = switchMarkup(renderPanel('teen'), EN.softenSwearingName);
    expect(markup).toContain('aria-checked="false"');
    expect(markup).not.toContain('disabled=""');
    expect(markup).not.toContain('locked-on');
    expect(markup).not.toMatch(/opacity/);
  });
});
