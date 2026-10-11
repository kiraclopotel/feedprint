// Feed behavior called 178 against 179 flagged of 1,516 a lean toward the end of a sitting, and its labels spoke in
// words a stranger stopped at: "hand-off", "quiet-gap return", "rising recurring motif", "entropy". A lean is said only
// when the two thirds' 95% intervals do not overlap, and the labels say what they count in plain words, in four
// languages.

import { describe, expect, it } from 'vitest';
import { skewLean } from '../../../../../src/ui/dashboard/components/feed-behavior-data';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';
import { UI_LANGUAGES } from '../../../../../src/i18n';
import { I18N } from '../../../../../src/i18n/export-strings';

describe('where flags land in a sitting', () => {
  it('calls one item in 1,516 even, as the walk found it', () => {
    expect(skewLean(178, 1516, 179, 1516)).toBe('even');
    expect(skewLean(179, 1516, 178, 1516)).toBe('even');
  });

  it('says a lean on either side once the two thirds are clearly apart', () => {
    expect(skewLean(300, 1516, 150, 1516)).toBe('open');
    expect(skewLean(150, 1516, 300, 1516)).toBe('close');
  });

  it('holds even just inside the noise and leans just past it, on both sides', () => {
    // 1,516 a third: at 178 against 230 the intervals still touch; at 178 against 231 they part.
    expect(skewLean(178, 1516, 230, 1516)).toBe('even');
    expect(skewLean(178, 1516, 231, 1516)).toBe('close');
    expect(skewLean(230, 1516, 178, 1516)).toBe('even');
    expect(skewLean(231, 1516, 178, 1516)).toBe('open');
  });

  it('calls a small sitting even, and an empty one too', () => {
    expect(skewLean(2, 6, 4, 6)).toBe('even');
    expect(skewLean(0, 0, 0, 0)).toBe('even');
  });

  it('says the even case as about the same share, in every language, for every lens', () => {
    for (const lang of UI_LANGUAGES) {
      const t = DASHBOARD_STRINGS[lang];
      const even = t.fbSkewCap('parent', 'even', 11.7, 11.8);
      expect(even, lang).not.toBe(t.fbSkewCap('parent', 'close', 11.7, 11.8));
      for (const lens of ['parent', 'lawyer', 'analyst', 'self'] as const) {
        expect(t.fbSkewCap(lens, 'even', 11.7, 11.8), `${lang} ${lens}`).not.toMatch(/lean|inclin|încl/i);
      }
    }
    expect(DASHBOARD_STRINGS.en.fbSkewCap('parent', 'even', 11.7, 11.8)).toContain('about the same share');
  });
});

describe('Feed behavior labels in plain words', () => {
  const JARGON = /hand-off|quiet-gap|motif|motivo|motiv |entrop|relevo|passagem|predare/i;

  for (const lang of UI_LANGUAGES) {
    it(`${lang}: no label a stranger stopped at`, () => {
      const t = DASHBOARD_STRINGS[lang];
      const said = [
        t.fbChainHandoff, t.fbChainSustained, t.patPressureNoEscalation, t.patPressureEntropyLabel,
        t.patPressureEntropy('0.42', 10), t.patPressureEntropy('0', 10), t.patPressureGap('fear', 3), t.patPressureNoGap,
        t.fbCautionChainEv('fear', 'anger', 5),
      ];
      for (const s of said) expect(s, lang).not.toMatch(JARGON);
      expect(t.fbChainHandoff, lang).not.toBe(t.fbChainSustained);
    });

    it(`${lang}: a variety drop of zero does not read as a narrowing`, () => {
      const t = DASHBOARD_STRINGS[lang];
      expect(t.patPressureEntropy('0', 10), lang).not.toBe(t.patPressureEntropy('0.42', 10));
      expect(t.patPressureEntropy('0', 10), lang).not.toContain('(');
    });
  }

  // The exported file's behavior section prints the same rows, so it says the same words.
  for (const locale of Object.keys(I18N) as (keyof typeof I18N)[]) {
    it(`export ${locale}: the same plain words as the dashboard`, () => {
      const x = I18N[locale];
      for (const s of [x.bhChainHandoff, x.bhChainSustained, x.bhChainsUnnamed, x.bhCautionChainEv]) {
        expect(s, locale).not.toMatch(JARGON);
        expect(s, locale).not.toMatch(/sustained|sostenido|sustentado|susținut|preluare/i);
      }
    });
  }

  it('English reads as written', () => {
    const t = DASHBOARD_STRINGS.en;
    expect(t.patPressureGap('fear', 1)).toBe('fear came back after 1 hour with none in between');
    expect(t.patPressureEntropy('0.42', 10)).toBe('the mix of patterns narrowed between the first and the last 10 flagged entries (by 0.42 on the variety score)');
  });
});
