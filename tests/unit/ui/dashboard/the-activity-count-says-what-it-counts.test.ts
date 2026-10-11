// N1, 29 Sep 2026. A fresh reader of Receipts 2.5.16 at Strict saw the dashboard tab read
// "Activity 1" (rc-rewalk/rw2-text-Strict-rec-activity-.txt) and could not tell what the 1 was.
// It is flaggedCount: the records flagged for review across the whole record (Dashboard.tsx), the
// same number the "Flagged for review" filter on that tab shows with its name. A bare number beside
// a tab name reads as a stray; the pill now says what it counts, in every language.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DASHBOARD_STRINGS } from '../../../../src/i18n/dashboard-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';
import { dashboardWords } from '../../../../src/ui/dashboard/dashboard-words';

describe('the Activity tab pill', () => {
  const shell = readFileSync(join(process.cwd(), 'src/ui/dashboard/Dashboard.tsx'), 'utf8');

  it('says what it counts instead of printing a bare number, inside the timeline and not on its tab', () => {
    const timeline = readFileSync(join(process.cwd(), 'src/ui/dashboard/components/ActivityTab.tsx'), 'utf8');
    expect(shell).not.toContain('<span className="count-pill">{flaggedCount}</span>');
    expect(shell).toContain('<TabBtn id="activity"   tab={tab} onClick={setTab}>{dashboardWords(lang).tabTimeline}</TabBtn>');
    expect(shell).toContain('flaggedAllMonths={flaggedCount}');
    expect(shell).toContain('flaggedAllMonthsTitle={t.tabActivityFlaggedTitle(flaggedCount, olderMonthsNotCounted(unloadedSummaries, monthSets))}');
    expect(timeline).toContain('{t.tabActivityFlagged(flaggedAllMonths)}');
  });

  it('the day head leads the Overview only, so the timeline opens on its list and the Overview still says the day', () => {
    expect(shell).toContain("{tab === 'overview' && !archiveLoading && <TodayHead records={allRecords} lang={lang} />}");
    expect(shell).not.toMatch(/tab === 'activity'[^\n]*<TodayHead/);
  });

  it('names the tab in a word or two, in every language, with no count', () => {
    const want = { en: 'Timeline', ro: 'Cronologie', es: 'Cronología', 'pt-BR': 'Linha do tempo' } as const;
    for (const lang of UI_LANGUAGES) {
      expect(dashboardWords(lang).tabTimeline, lang).toBe(want[lang]);
      expect(dashboardWords(lang).tabTimeline, lang).not.toMatch(/\d/);
    }
  });

  it('reads "1 flagged, all months" in English', () => {
    expect(DASHBOARD_STRINGS.en.tabActivityFlagged(1)).toBe('1 flagged, all months');
  });

  // The pill counts records (ro: înregistrare, feminine: "1 semnalată"; a critic caught "1 semnalat").
  it.each([
    ['es', 1, '1 marcado, todos los meses'], ['es', 2, '2 marcados, todos los meses'], ['es', 20, '20 marcados, todos los meses'],
    ['pt-BR', 1, '1 marcado, todos os meses'], ['pt-BR', 2, '2 marcados, todos os meses'], ['pt-BR', 20, '20 marcados, todos os meses'],
    ['ro', 1, '1 semnalată, toate lunile'], ['ro', 2, '2 semnalate, toate lunile'], ['ro', 20, '20 de semnalate, toate lunile'],
  ] as const)('%s reads exactly for %i', (lang, n, want) => {
    expect(DASHBOARD_STRINGS[lang].tabActivityFlagged(n)).toBe(want);
  });

  it.each(UI_LANGUAGES)('%s: carries the number and a word, with no em dash', (lang) => {
    const f = DASHBOARD_STRINGS[lang].tabActivityFlagged;
    for (const n of [1, 2, 12]) {
      const s = f(n);
      expect(s.startsWith(`${n} `), s).toBe(true);
      expect(s.length, s).toBeGreaterThan(`${n} `.length + 3);
      expect(s).not.toContain('—');
    }
  });
});
