// A person installed Receipts, or installed Off. The screens of each say that name. Receipts'
// dashboard spoke of "FW", and its setup asked how much "FeelingWise" should filter; Off told a
// person who forgot the PIN to "reinstall FeelingWise", a name Chrome never showed them. Chrome
// shows Off as "Off" (manifest.off.json, _locales/*/messages.json offActionTitle), in every
// language.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { POPUP_STRINGS } from '../../../src/i18n/popup-strings';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';
import { UI_LANGUAGES } from '../../../src/i18n';

const root = process.cwd();
const offPopup = readFileSync(join(root, 'src/products/off/popup/OffPopup.tsx'), 'utf8');

/** Every string in a table, and the source of every function that builds one. */
function allText(table: object): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.push(v);
    else if (typeof v === 'function') out.push(String(v));
    else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
  };
  walk(table);
  return out;
}

const OFF_LOCALES = { en: 'en', es: 'es', 'pt-BR': 'pt_BR', ro: 'ro' } as const;

describe.each(UI_LANGUAGES)('%s', (lang) => {
  it('the Feedprint dashboard never says "FW"', () => {
    const hits = allText(DASHBOARD_STRINGS[lang]).filter((s) => /\bFW\b/.test(s));
    expect(hits).toEqual([]);
  });

  it('the Feedprint setup asks how much Feedprint should filter', () => {
    expect(POPUP_STRINGS[lang].setupWhoTitle).toContain('Feedprint');
    expect(POPUP_STRINGS[lang].setupWhoTitle).not.toContain('FeelingWise');
  });

  it("Off's PIN and language texts say Off, the name Chrome shows", () => {
    const name = (JSON.parse(readFileSync(join(root, '_locales', OFF_LOCALES[lang], 'messages.json'), 'utf8')) as Record<string, { message: string }>).offActionTitle.message;
    expect(name).toBe('Off');
    const t = POPUP_STRINGS[lang];
    for (const s of [t.pinRecoveryNoneOff, t.setupRecoveryBodyOff, t.uiLangDescOff]) {
      expect(s).not.toContain('FeelingWise');
      expect(s).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });
});

describe('the Off popup', () => {
  it('reads the Off wording of the language row', () => {
    expect(offPopup).toContain('t.uiLangDescOff');
    expect(offPopup).not.toMatch(/t\.uiLangDesc\b(?!Off)/);
  });
});

describe.each(UI_LANGUAGES)('%s: the settings-read failure line', (lang) => {
  const t = POPUP_STRINGS[lang];

  it("Off's line says Off and never FeelingWise", () => {
    expect(t.loadFailedBodyOff).toMatch(/^(O )?Off\b/);
    expect(t.loadFailedBodyOff).not.toContain('FeelingWise');
  });

  it("Feedprint' line says Feedprint and never FeelingWise", () => {
    expect(t.loadFailedBody).toMatch(/^(O )?Feedprint\b/);
    expect(t.loadFailedBody).not.toContain('FeelingWise');
  });
});

describe('the settings-read failure line in English', () => {
  it('reads as one sentence per product', () => {
    expect(POPUP_STRINGS.en.loadFailedBodyOff).toBe('Off could not read its local settings. Retry after the extension finishes reloading.');
    expect(POPUP_STRINGS.en.loadFailedBody.startsWith('Feedprint could not read its local settings.')).toBe(true);
  });
});

describe('the Off popup and the shared PIN panel use the Off line', () => {
  it("Off's load-failure screen reads the Off wording", () => {
    expect(offPopup).toContain('strings.loadFailedBodyOff');
    expect(offPopup).not.toMatch(/strings\.loadFailedBody\b(?!Off)/);
  });

  it('the Set PIN panel picks the wording by product', () => {
    const controls = readFileSync(join(root, 'src/ui/popup/controls.tsx'), 'utf8');
    expect(controls).toContain('isOffProduct() ? t.loadFailedBodyOff : t.loadFailedBody');
  });
});
