// A timeline card read "1 shares": the word after a count took no count. It takes one now, in every language, and
// Romanian puts "de" between a count from 20 up and its noun.

import { describe, expect, it } from 'vitest';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';
import { UI_LANGUAGES } from '../../../src/i18n';

describe('a count of one reads singular', () => {
  it('says "1 share" and "4 shares" in English', () => {
    const t = DASHBOARD_STRINGS.en;
    expect(t.feedMetricWord('shares', 1)).toBe('share');
    expect(t.feedMetricWord('shares', 4)).toBe('shares');
    expect(t.feedMetricWord('views', 1)).toBe('view');
    expect(t.feedMetricWord('replies', 1)).toBe('reply');
  });

  it('has a different word for one than for several, in every language (a Spanish like is me gusta either way, so likes are left out)', () => {
    const words = ['views', 'shares', 'comments', 'replies', 'reposts', 'quotes', 'bookmarks'] as const;
    for (const lang of UI_LANGUAGES) {
      const t = DASHBOARD_STRINGS[lang];
      for (const w of words) {
        expect(t.feedMetricWord(w, 1), `${lang} ${w}`).not.toBe(t.feedMetricWord(w, 4));
      }
    }
  });

  it('puts "de" before the Romanian noun from 20 up, and not below', () => {
    const t = DASHBOARD_STRINGS.ro;
    expect(t.feedMetricWord('shares', 1)).toBe('distribuire');
    expect(t.feedMetricWord('shares', 4)).toBe('distribuiri');
    expect(t.feedMetricWord('shares', 23)).toBe('de distribuiri');
    expect(t.feedMetricWord('shares', 101)).toBe('distribuiri');
    expect(t.feedMetricWord('shares', 0)).toBe('distribuiri');
  });
});
