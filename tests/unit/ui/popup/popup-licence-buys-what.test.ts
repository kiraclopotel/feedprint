// What the key buys, said as what the key buys.
//
// The setup wizard's licence screen, the licence card in it and the License
// tab's active subtitle all said the key "anchors your record", in four
// languages. Anchoring stopped being a paid feature on 2026-09-04, and the
// comment that removed the gate says why it had to: the site was telling
// parents that every entry carried an independent time stamp while no shipped
// install had ever received one. Since then the key buys the AI reading and
// nothing else, and every install anchors.
//
// So the product was overstating what money buys and understating what the
// free tier gives, on the screen where someone decides to pay, one screen from
// the plans link added the same day. This holds the copy to the code: the
// direct requests to the authorities (src/forensics/tsa-client.ts,
// chain-anchor-store.ts) read no tier and ask for no key; only the proxy
// fallback reads the licence.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';
import { repoPath } from '../../../helpers/repo-root';

/** Every way the four languages say "anchor", as a stem. */
const ANCHOR_WORDS = ['anchor', 'ancor', 'ancla', 'âncor'];

const LICENCE_STRINGS = (lang: (typeof UI_LANGUAGES)[number]): string[] => {
  const t = POPUP_STRINGS[lang];
  // The setup wizard's licence screen and card left setup with the licence step; the License tab's line stays.
  return [t.keySubActive];
};

/**
 * Every line in the popup that tells a reader what a key is for. Four of them
 * still said "rewrites" on 2026-09-17, on the same screens as the three above:
 * the home meta line, the free-tier status, the paste prompt and the removal
 * warning. A rewrite is one of four things the reading can lead to, and in a
 * Child install it is rarely the one that happens: the post is hidden. So the
 * screen that asks for money named the narrowest outcome, and named it
 * differently from the card two lines below it ("turn on AI checks").
 */
const WHAT_A_KEY_BUYS = (lang: (typeof UI_LANGUAGES)[number]): string[] => {
  const t = POPUP_STRINGS[lang];
  // metaFree was deleted in B2 unit 2 (30 Sep 2026): the free home card no longer has a line that sells the key.
  // pasteToEnable left the License tab on 8 Oct 2026 (the line "No AI calls without a key" already says it).
  return [...LICENCE_STRINGS(lang), t.keyAdds, t.statusFree, t.removeConfirmBody];
};

/** How each language spells the rewriting of a post. */
const REWRITE_WORDS = ['rewrit', 'reescri', 'rescri'];

describe('the licence sells the reading, not the time stamps', () => {
  it.each(UI_LANGUAGES)('%s: no licence copy claims the key anchors the record', lang => {
    for (const line of LICENCE_STRINGS(lang)) {
      const lower = line.toLowerCase();
      for (const word of ANCHOR_WORDS) {
        expect(lower.includes(word), `${lang}: "${line}"`).toBe(false);
      }
    }
  });

  it.each(UI_LANGUAGES)('%s: the licence copy names the reading instead', lang => {
    const t = POPUP_STRINGS[lang];
    // The lines say something; since 11 Oct 2026 the License tab's active line is the feature's name,
    // Live Rephrase, the same in every language (the rename pass, crew/site/words-2026-10-11), so the
    // check for the other languages is that they carry that name, not that they differ from English.
    for (const line of LICENCE_STRINGS(lang)) expect(line.trim().length).toBeGreaterThan(10);
    expect(t.keySubActive).toContain('Live Rephrase');
  });

  it.each(UI_LANGUAGES)('%s: no line that asks for money sells the key as rewrites', lang => {
    // The rewrite switch itself is allowed to say rewrite: it is the name of a
    // thing that rewrites. These lines are about what a key turns on.
    for (const line of WHAT_A_KEY_BUYS(lang)) {
      const lower = line.toLowerCase();
      for (const word of REWRITE_WORDS) {
        const standsAlone = lower.includes(word) && !lower.includes('reading')
          && !lower.includes('análisis') && !lower.includes('análise') && !lower.includes('analiza');
        expect(standsAlone, `${lang}: "${line}"`).toBe(false);
      }
    }
  });

  it('the switch that does rewrite still says it rephrases, in every language', () => {
    // The opposite failure: a sweep that renamed the feature itself would leave
    // the household unable to find the switch the copy is about. Since packet 36
    // (13 Oct 2026) its name is the level's first switch, "Show the calm version
    // first", and its line says what it does: a flagged post arrives rephrased.
    for (const lang of UI_LANGUAGES) {
      const line = POPUP_STRINGS[lang].reframeRewritesDesc.toLowerCase();
      expect([...REWRITE_WORDS, 'rephras', 'reformul'].some(w => line.includes(w)), `${lang}: "${line}"`).toBe(true);
    }
  });

  it('the direct authorities read no tier; only the proxy fallback does', () => {
    // If a tier gate ever comes back, this test is where the copy question is
    // asked again rather than discovered by a parent.
    const tsa = readFileSync(repoPath('src', 'forensics', 'tsa-client.ts'), 'utf8');
    const store = readFileSync(repoPath('src', 'forensics', 'chain-anchor-store.ts'), 'utf8');
    // Only the proxy fallback reads the licence, and it skips a free install
    // because the proxy would refuse it; the direct authorities serve every tier.
    expect(tsa).toMatch(/license\.tier !== 'free'\)\s*\{\s*const r = await requestViaProxy/);
    for (const source of [tsa, store]) {
      expect(source).not.toMatch(/tier\s*===\s*'free'\s*\)\s*return/);
      expect(source).not.toContain('paid tiers only');
    }
  });
});

describe('the adult ending points at the tab the key actually lives in', () => {
  // The one sentence an adult install ends on said a licence key or a PIN can
  // be added "in Settings". The PIN is there; the key is not, and never was:
  // it lives in the License tab, which is also where the plans link now sits.
  // Sending the one reader who might pay to the wrong tab is the cheapest
  // possible way to lose them (2026-09-17).
  // Both places, because the sentence offers both things: the key in the
  // License tab, the PIN in Settings.
  const SETTINGS_WORD = { en: 'settings', ro: 'setări', es: 'ajustes', 'pt-BR': 'configurações' } as const;

  it.each(UI_LANGUAGES)('%s: names the License tab for the key and Settings for the PIN', lang => {
    const line = POPUP_STRINGS[lang].setupAdultNoPin.toLowerCase();
    expect(line.includes(POPUP_STRINGS[lang].tabLicense.toLowerCase()), `${lang}: "${line}"`).toBe(true);
    expect(line.includes(SETTINGS_WORD[lang]), `${lang}: "${line}"`).toBe(true);
  });
});

