/** @vitest-environment jsdom */
// A parent could not tell what "Show reframe markers", "Strict language" and "My own rules / 0 rules ›" do (the parent
// scout, 9 Oct 2026): their descriptions sat behind the (i) fold. Each now shows one short line under its name, with no
// fold to open, in every language; the other rows keep their fold. The words came from the open model and passed a
// claim check against the code (crew/record/words/01-switch-lines): swear words in posts starred (comments only when
// the paid reading of them succeeds, so the line says posts), a dot beside a changed post. A free install draws that
// dot too and rewrites nothing, so no line says "rewrite" (a-free-install-shows-no-ai-word).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { SettingsPanel } from '../../../../src/ui/popup/Popup';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';
import type { FWSettings } from '../../../../src/storage/settings';
import { teenPreset } from '../../../../src/storage/presets';
import type { LicenseInfo } from '../../../../src/storage/license';

vi.mock('../../../../src/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/ai/client')>();
  return { ...actual, probeProxy: vi.fn(async () => 'ok') };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FREE = { tier: 'free' } as unknown as LicenseInfo;
const SETTINGS = {
  settingsSchemaVersion: '14', mode: 'teen', strictLanguage: false, parentPin: '1234', locale: 'en', uiLanguage: 'auto',
  features: teenPreset(), presets: { appliedAt: '', appliedPreset: 'teen' }, dashboardTheme: 'dark',
} as unknown as FWSettings;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      session: { get: async () => ({}), set: async () => {} },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: { sendMessage: vi.fn(async () => undefined), getManifest: () => ({ version: '1.0.0' }) },
    tabs: { query: vi.fn(async () => []) },
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe.each(UI_LANGUAGES)('each switch a parent cannot read from its name says what it does, %s', (lang) => {
  const t = POPUP_STRINGS[lang];

  it('the three lines show under their names with nothing opened, and those rows have no fold', async () => {
    await act(async () => {
      root.render(createElement(I18nProvider, {
        lang,
        children: createElement(SettingsPanel, { settings: SETTINGS, license: FREE, onBack: () => {}, onChange: async () => {}, openOn: 'general' }),
      }));
    });
    const card = container.querySelector('.set-essentials')!;
    const lines = Array.from(card.querySelectorAll('.fr-line')).map(e => e.textContent);
    // Strict language's line left with its row on 11 Oct 2026 (one-switch-for-swearing.test.tsx).
    expect(lines).toEqual([t.featMarkersDescFree, t.rulesLine]);
    const folds = Array.from(card.querySelectorAll('.fr-info')).map(b => b.getAttribute('aria-label'));
    for (const name of [t.featMarkersName, t.rulesName]) {
      expect(folds).not.toContain(`${t.rowInfoAria}: ${name}`);
    }
    // The rows a name explains keep their fold.
    expect(folds).toContain(`${t.rowInfoAria}: ${t.featBlockAdsName}`);
  });

  it('each line is one short sentence', () => {
    for (const line of [t.featMarkersDescFree, t.rulesLine]) {
      expect([...line].length, line).toBeLessThanOrEqual(130); // the row wraps to two lines at most (pictures, 9 Oct 2026)
      expect(line.trim().endsWith('.'), line).toBe(true);
      expect(line.slice(0, -1), line).not.toContain('. ');
    }
  });
});

describe('the words say what the code does', () => {
  // The head's check, 9 Oct 2026, and two claim checks after it: the line must hold in every language. It says
  // posts, because comments are starred only when the paid reading of them succeeds; it names no site and no "every",
  // because some parts of some sites are not read; it says nothing of slurs, because a hidden post can be shown anyway
  // and that is not this switch's doing.
  // The strict line's claim test left with the line and its row on 11 Oct 2026 (one switch for swearing).
  it('the markers line holds on a free install: a changed post, no rewrite, no original, no comment', () => {
    // A free install shows the dot's own free line since 13 Oct 2026 (packet 36: with a key the row is the reading fold's).
    const line = POPUP_STRINGS.en.featMarkersDescFree;
    expect(line).toMatch(/changed/);
    expect(line).not.toMatch(/rewrit|original|comment|\bAI\b/i);
  });
  it.each(UI_LANGUAGES)('%s: the Strict level note names the lock, not softening', (lang) => {
    expect(POPUP_STRINGS[lang].softenSwearingDescChild).not.toMatch(/soft|atenu|suaviz/i);
  });
});
