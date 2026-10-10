// The store name and short description of both products, in the four
// interface languages, through Chrome's _locales mechanism (since 2.5.2 and
// 1.0.2). One folder, one key set, both manifests read it with __MSG_ keys.
//
// What this locks: the four locale files carry the same keys with non-empty
// text; every string fits the store's caps (name 75, short description 132);
// no em dash anywhere (house rule); both manifests point at keys that exist
// and declare the English default; the English text is byte-identical to the
// strings the store already shows for 2.5.1 and 1.0.1, so the update changes
// nothing for an English reader; and the Off descriptions open with the
// tagline the popup already ships in that language.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoPath } from '../../helpers/repo-root';
import { UI_LANGUAGES } from '../../../src/i18n/index';
import { POPUP_STRINGS } from '../../../src/i18n/popup-strings';

type Messages = Record<string, { message: string }>;

/** Chrome's folder name for each shipped interface language. */
const CHROME_LOCALE: Record<(typeof UI_LANGUAGES)[number], string> = {
  en: 'en',
  es: 'es',
  'pt-BR': 'pt_BR',
  ro: 'ro',
};

function readProjectJson<T>(path: string): T {
  return JSON.parse(readFileSync(repoPath(...path.split(String.fromCharCode(47))), 'utf8')) as T;
}

const messagesByLang = Object.fromEntries(
  UI_LANGUAGES.map((lang) => [lang, readProjectJson<Messages>(`_locales/${CHROME_LOCALE[lang]}/messages.json`)]),
) as Record<(typeof UI_LANGUAGES)[number], Messages>;

// receiptsShortName since the 2.5.18 release: Chrome shows Feedprint where the whole name does not fit.
const KEYS = ['receiptsName', 'receiptsShortName', 'receiptsDescription', 'receiptsActionTitle', 'offName', 'offDescription', 'offActionTitle'];
const NAME_MAX = 75;
const DESCRIPTION_MAX = 132;

const receipts = readProjectJson<{ name: string; description: string; default_locale: string; action: { default_title: string } }>('manifest.json');
const off = readProjectJson<{ name: string; description: string; default_locale: string; action: { default_title: string } }>('manifest.off.json');

describe('store locales', () => {
  it('every shipped interface language has a locale file with the same keys and non-empty text', () => {
    for (const lang of UI_LANGUAGES) {
      const messages = messagesByLang[lang];
      expect(Object.keys(messages).sort()).toEqual([...KEYS].sort());
      for (const key of KEYS) {
        expect(typeof messages[key].message).toBe('string');
        expect(messages[key].message.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('every name fits 75 and every short description fits 132, in every language', () => {
    for (const lang of UI_LANGUAGES) {
      const m = messagesByLang[lang];
      expect(m.receiptsName.message.length).toBeLessThanOrEqual(NAME_MAX);
      expect(m.offName.message.length).toBeLessThanOrEqual(NAME_MAX);
      expect(m.receiptsDescription.message.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
      expect(m.offDescription.message.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    }
  });

  it('carries no em dash and keeps the product names', () => {
    for (const lang of UI_LANGUAGES) {
      for (const key of KEYS) expect(messagesByLang[lang][key].message).not.toContain('—');
      // Receipts' name stopped ending in "FeelingWise" on 2026-09-27, for Off's reason below. Read in
      // store search that day: the listing came first only for "feed record" and "what my feed showed",
      // which nobody types, and for no archive or evidence search (STORE-LISTING-2.5.15.md).
      expect(messagesByLang[lang].receiptsName.message).toMatch(/^Feedprint - /);
      // Off's name stopped ending in "FeelingWise" on 2026-09-20. Measured that day: the listing
      // appeared in store search for no phrase a stranger would type, only for our own brand
      // words, and the listings that win the category are named as a search phrase. The publisher
      // name is shown by the store beside the title anyway, so the title spends its 75 characters
      // on what people search. Evidence: the demand study of 21 September 2026 (quieter-feed.md,
      // kept outside this repository).
      expect(messagesByLang[lang].offName.message).toMatch(/^Off - /);
      expect(messagesByLang[lang].offActionTitle.message).toBe('Off');
    }
  });

  it('both manifests read keys that exist and declare English as the default', () => {
    for (const [manifest, prefix] of [[receipts, 'receipts'], [off, 'off']] as const) {
      expect(manifest.default_locale).toBe('en');
      expect(manifest.name).toBe(`__MSG_${prefix}Name__`);
      expect(manifest.description).toBe(`__MSG_${prefix}Description__`);
      expect(manifest.action.default_title).toBe(`__MSG_${prefix}ActionTitle__`);
      for (const field of ['Name', 'Description', 'ActionTitle']) expect(messagesByLang.en[`${prefix}${field}`]).toBeDefined();
    }
  });

  it('the English text is the text the store shows', () => {
    const en = messagesByLang.en;
    // Receipts' pair changed on 2026-09-27, for the reason in the previous test.
    // Since the 2.5.18 release Receipts is called Feedprint, and the name takes the store title's shape.
    expect(en.receiptsName.message).toBe('Feedprint - Save What Your Feed Showed You');
    expect(en.receiptsDescription.message).toBe(
      'A signed archive of what your feed showed on X, Facebook, Instagram, TikTok and YouTube, kept on your computer. Anyone can check it.',
    );
    expect(en.receiptsActionTitle.message).toBe('Feedprint by FeelingWise');
    // Off's pair changed on 2026-09-20 for the reason in the previous test.
    expect(en.offName.message).toBe('Off - Hide Swearing, Likes, Reels, Shorts and Ads on Social Media');
    expect(en.offDescription.message).toBe(
      'Turn off swearing, slurs, like counts, Reels, Shorts and ads on Facebook, Instagram, X, TikTok and YouTube. Free, no account.',
    );
  });

  // Replaces "the Off description opens with the popup's own tagline". That rule was written when
  // the store text echoed the popup, and it is what kept the summary starting on a brand line that
  // nobody searches. It is replaced rather than dropped: the summary's job is to be findable and
  // true, so it has to name the things the switches do and the places they do it.
  it('the Off summary names what it hides and where, in every language', () => {
    const PLATFORMS = ['Facebook', 'Instagram', 'X', 'TikTok', 'YouTube'];
    const THINGS_HIDDEN: Record<string, string[]> = {
      en: ['swearing', 'like counts', 'Reels', 'Shorts', 'ads'],
      es: ['palabrotas', 'me gusta', 'Reels', 'Shorts', 'anuncios'],
      'pt-BR': ['palavrões', 'curtidas', 'Reels', 'Shorts', 'anúncios'],
      ro: ['înjurăturile', 'aprecierile', 'Reels', 'Shorts', 'reclamele'],
    };
    for (const lang of UI_LANGUAGES) {
      const summary = messagesByLang[lang].offDescription.message;
      for (const platform of PLATFORMS) expect(summary).toContain(platform);
      const named = THINGS_HIDDEN[lang].filter((thing) => summary.includes(thing));
      expect(named.length).toBeGreaterThanOrEqual(4);
    }
  });
});
