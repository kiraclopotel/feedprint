// Feedprint holds no price inside the extension, and its License tab says what a key adds.
//
// The price lives on the site's help page, which can change it without an update. Inside the extension a free
// install sees one line on what a key adds and one link to that page, on the License tab only and never at Strict,
// where nothing is read. A person who already holds a key pastes it in the same box and keeps the reading.
//
// What this holds, in every interface language: no price, no checkout and no buying words in the popup or dashboard
// strings; the License tab carries exactly that line and that link; no other screen links to the help page.

import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';

import { KeysTab } from '../../../../src/ui/popup/Popup';
import { KEY_HELP_URL } from '../../../../src/ui/popup/panels/KeysTab';
import { AiCard, readingRowNames } from '../../../../src/ui/popup/panels/ai/AiCard';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { DASHBOARD_STRINGS } from '../../../../src/i18n/dashboard-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';
import type { FWSettings } from '../../../../src/storage/settings';
import type { LicenseInfo } from '../../../../src/storage/license';
import { readSource } from '../../../helpers/read-source';

const FREE: LicenseInfo = { tier: 'free', secret: '' } as unknown as LicenseInfo;
const PAID: LicenseInfo = { tier: 'family', secret: 'abc' } as unknown as LicenseInfo;

function settings(lang: string, mode = 'adult'): FWSettings {
  return { mode, dailyCap: 2000, uiLanguage: lang, features: {} } as unknown as FWSettings;
}

function keysTab(license: LicenseInfo, lang: (typeof UI_LANGUAGES)[number], mode = 'adult'): string {
  return renderToString(createElement(I18nProvider, {
    lang,
    children: createElement(KeysTab, { settings: settings(lang, mode), license, probeResult: 'ok', onChange: async () => {} }),
  }));
}

/** React escapes text the same way when it renders to a string. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

/** Every sentence a table can produce: strings as they are, functions called with small numbers. */
function sentences(table: unknown, out: string[] = []): string[] {
  if (typeof table === 'string') out.push(table);
  else if (typeof table === 'function') {
    try {
      const said: unknown = (table as (...a: unknown[]) => unknown)(1, 2, 3);
      if (typeof said === 'string') out.push(said);
    } catch { /* a function that needs richer arguments says nothing about price here */ }
  } else if (table && typeof table === 'object') {
    for (const v of Object.values(table as Record<string, unknown>)) sentences(v, out);
  }
  return out;
}

const MONEY = /€|\bEUR\b|lemonsqueezy|checkout|\/pricing/i;
// Words that describe the reading as a product with paid levels. "Paid" about advertisers' paid
// items is what the record shows, not something sold, so it is left alone.
const LEVELS: Record<(typeof UI_LANGUAGES)[number], RegExp> = {
  en: /\bplans?\b|\btiers?\b|\btier-free\b|\bpaid\b(?! (items?|placements?|posts?|content))/i,
  es: /\bplan(es)?\b|\bplano\b|\bde pago\b|nivel gratuito/i,
  'pt-BR': /\bplanos?\b|(?<!conteúdo )\bpago\b|licença paga|nível gratuito/i,
  ro: /\bplan(ul|uri|urile)?\b|nivel(ul)? gratuit|· nivel|licență plătită|AI plătit/i,
};
// A person's own channel subscriptions on a site ("your subscriptions", "tus suscripciones",
// "abonamentele") are part of the page a switch hides or keeps, not something sold.
const SELLING: Record<(typeof UI_LANGUAGES)[number], RegExp> = {
  en: /\bbuy\b|(?<!your )subscri|your subscri(?!ptions\b)|upgrade|purchase|\bprice|pick a plan|see the plans/i,
  es: /\bcompr(ar|a|e)\b|(?<!tus )suscr[ií]|tus suscr[ií](?!pciones\b)|mejorarlo|upgrade|precio|elige un plan|ver los planes/i,
  'pt-BR': /\bcompr(ar|a|e)\b|upgrade|preço|escolha um plano|ver os planos/i,
  ro: /cumpăr|abonament(?!ele)|abonează|upgrade|preț|alege un plan|vezi planurile/i,
};

describe('no price inside Feedprint, and one line on what a key adds', () => {
  it('no popup sentence, in any language, names a price, a checkout or a buying word', () => {
    for (const lang of UI_LANGUAGES) {
      for (const s of sentences(POPUP_STRINGS[lang])) {
        expect(s, lang).not.toMatch(MONEY);
        expect(s, lang).not.toMatch(SELLING[lang]);
      }
    }
  });

  it('no dashboard sentence, in any language, names a price, a checkout or a buying word', () => {
    for (const lang of UI_LANGUAGES) {
      for (const s of sentences(DASHBOARD_STRINGS[lang])) {
        expect(s, lang).not.toMatch(MONEY);
        expect(s, lang).not.toMatch(SELLING[lang]);
      }
    }
  });

  it('no popup or dashboard sentence, in any language, speaks of plans, tiers or a paid reading', () => {
    for (const lang of UI_LANGUAGES) {
      for (const s of [...sentences(POPUP_STRINGS[lang]), ...sentences(DASHBOARD_STRINGS[lang])]) {
        expect(s, lang).not.toMatch(LEVELS[lang]);
      }
    }
  });

  it('the buying words catch a sale and let only the person\'s own subscriptions pass', () => {
    const sold: Array<[(typeof UI_LANGUAGES)[number], string]> = [
      ['en', 'Renew your subscription'],
      ['en', 'Your subscription renews monthly'],
      ['en', 'Subscribe to keep the AI reading'],
      ['es', 'Suscríbete para seguir'],
      ['es', 'Tu suscripción se renueva'],
      ['ro', 'Abonează-te acum'],
    ];
    for (const [lang, s] of sold) expect(s, lang).toMatch(SELLING[lang]);
    const own: Array<[(typeof UI_LANGUAGES)[number], string]> = [
      ['en', 'Search, your subscriptions and your own pages stay.'],
      ['es', 'La búsqueda, tus suscripciones y tus propias páginas se quedan.'],
      ['ro', 'Căutarea, abonamentele și paginile tale rămân.'],
    ];
    for (const [lang, s] of own) expect(s, lang).not.toMatch(SELLING[lang]);
  });

  it('the License tab on a free install has the key box, the line on what a key adds and one link to the help page', () => {
    for (const lang of UI_LANGUAGES) {
      const html = keysTab(FREE, lang);
      const t = POPUP_STRINGS[lang];
      expect(html, lang).toContain('<input');
      expect(html, lang).toContain(esc(t.keyAdds));
      const links = [...html.matchAll(/<a [^>]*>/g)].map((m) => m[0]).filter((a) => a.includes('#ai-reading'));
      expect(links, lang).toHaveLength(1);
      expect(links[0], lang).toContain(`href="${KEY_HELP_URL}"`);
      expect(links[0], lang).toContain('target="_blank"');
      expect(links[0], lang).toContain('rel="noopener noreferrer"');
      expect(html, lang).toContain(`>${esc(t.keyGetLink)}</a>`);
      expect(html, lang).not.toMatch(MONEY);
      expect(html, lang).not.toContain('data-fw-buy-path');
    }
    expect(KEY_HELP_URL).toBe('https://feelingwise.org/help#ai-reading');
  });

  it('at Strict, where nothing is read, the tab neither says what a key adds nor links to get one', () => {
    for (const lang of UI_LANGUAGES) {
      const html = keysTab(FREE, lang, 'child');
      expect(html, lang).not.toContain(esc(POPUP_STRINGS[lang].keyAdds));
      expect(html, lang).not.toContain('#ai-reading');
    }
  });

  it('a key held outside Strict shows the name of what it turns on and the rows it covers, and no line or link to get one', () => {
    for (const lang of UI_LANGUAGES) {
      const html = keysTab(PAID, lang);
      const t = POPUP_STRINGS[lang];
      expect(html, lang).toContain(`>${esc(t.keySubActive)}</div>`);
      const rows = [...html.matchAll(/<ul class="key-rows">(.*?)<\/ul>/g)].map((m) => m[1]);
      expect(rows, lang).toHaveLength(1);
      expect([...rows[0].matchAll(/<li>(.*?)<\/li>/g)].map((m) => m[1]), lang).toEqual(readingRowNames(t).map(esc));
      expect(html, lang).toContain(t.removeLicense);
      expect(html, lang).not.toContain(esc(t.keyAdds));
      expect(html, lang).not.toContain('#ai-reading');
      expect(html, lang).not.toMatch(MONEY);
    }
  });

  it('the rows the License tab lists are the rows the AI card in Settings shows with a key', () => {
    for (const lang of UI_LANGUAGES) {
      const html = renderToString(createElement(I18nProvider, {
        lang,
        children: createElement(AiCard, {
          settings: settings(lang), license: PAID, platform: undefined,
          rows: [{ id: 'rewritten-comments-first', name: POPUP_STRINGS[lang].featRewriteName, desc: '' }],
          render: () => true, toggle: async () => {}, overrideNote: () => undefined, onChange: async () => {},
        }),
      }));
      const shown = [...html.matchAll(/class="fr-name"[^>]*>(?:<[^>]+>)*([^<]+)/g)].map((m) => m[1].trim());
      expect(shown, lang).toEqual(readingRowNames(POPUP_STRINGS[lang]).map(esc));
    }
  });

  it('a key held at Strict lists no rows, since nothing is read there', () => {
    for (const lang of UI_LANGUAGES) {
      expect(keysTab(PAID, lang, 'child'), lang).not.toContain('key-rows');
    }
  });

  it('no screen links to the plans page or prints the price constants, and only the License tab links to the help page', () => {
    for (const file of [
      'src/ui/popup/panels/HomeTab.tsx',
      'src/ui/popup/panels/KeysTab.tsx',
      'src/ui/popup/panels/SetupWizard.tsx',
    ]) {
      const source = readSource(file);
      expect(source, file).not.toContain('pricingPageUrl');
      expect(source, file).not.toContain('AI_PRICE_EUR');
      if (!file.endsWith('KeysTab.tsx')) expect(source, file).not.toContain('#ai-reading');
    }
  });
});
