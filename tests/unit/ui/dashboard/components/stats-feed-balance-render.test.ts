// Render test for the Statistics-tab "feed balance" card — the honest benign
// majority that frames the harm counts (reported 2026-07: the dashboard "shows
// mainly negativity"). Verifies the pass-rate line, the legend counts, the
// denominator semantics (room/marker/cancelled excluded), and RO localization.

import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatisticsTab } from '../../../../../src/ui/dashboard/components/StatisticsTab';
import { I18nProvider } from '../../../../../src/i18n/react';
import type { ForensicRecord } from '../../../../../src/types/forensic';
import type { ForensicStats } from '../../../../../src/forensics/store';

function rec(id: string, verdict: ForensicRecord['verdict'], over: Partial<ForensicRecord> = {}): ForensicRecord {
  return {
    id, timestamp: '2026-07-03T10:00:00.000Z', platform: 'tiktok',
    originalText: 't', originalHash: 'h', originalLength: 1, neutralizedText: '',
    author: 'a', postUrl: '', techniques: [], overallScore: 0,
    userAgeCategory: 'teen', aiSource: 'cloud', feedSource: 'foryou',
    integrityHash: 'ih', verdict, ...over,
  } as ForensicRecord;
}

const STATS: ForensicStats = {
  total: 0, byTechnique: {}, byPlatform: {}, today: 0, thisWeek: 0, thisMonth: 0,
  blockedThisWeek: 0, blockedTotal: 0, unsignedRecordsCount: 0,
};

function render(records: ForensicRecord[], lang: 'en' | 'ro' = 'en'): string {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, {
      lang,
      children: React.createElement(StatisticsTab, {
        records, stats: STATS, now: new Date('2026-07-03T12:00:00.000Z'),
      }),
    }),
  );
}

describe('StatisticsTab feed balance card', () => {
  it('excludes rooms, markers, and cancelled scans from the pass rate', () => {
    // 2 pass + 2 flagged content = 4 decided → 50%. The env-pass, marker-pass,
    // and cancelled records must NOT change that (they are not decided content).
    const html = render([
      rec('p1', 'pass'), rec('p2', 'pass'),
      rec('f1', 'flagged'), rec('f2', 'flagged-hidden'),
      rec('e1', 'pass', { kind: 'environment' } as Partial<ForensicRecord>),
      rec('m1', 'pass', { kind: 'reset-marker' } as Partial<ForensicRecord>),
      rec('c1', 'cancelled-dom-gone'),
    ]);
    expect(html).toContain('50% of everything decided passed.');
    expect(html).toContain('50% passed untouched: 2 of 4 checked items.');
  });

  it('computes an exact pass percentage on a clean set', () => {
    // 3 pass + 1 flagged + 0 blocked = 4 decided → 75% passed.
    const html = render([rec('p1', 'pass'), rec('p2', 'pass'), rec('p3', 'pass'), rec('f1', 'flagged')]);
    expect(html).toContain('75% passed untouched: 3 of 4 checked items.');
  });

  // The headline was one fixed sentence, "Most of what was checked passed", shown over "25% passed untouched: 7 of 28"
  // (tester, 11 Oct 2026). It now says the share, in the Overview's own words, and an empty record says it is empty.
  it('says the share in its headline, whatever the share is', () => {
    const html = render([rec('p1', 'pass'), rec('f1', 'flagged'), rec('f2', 'flagged'), rec('f3', 'flagged')]);
    expect(html).toContain('25% of everything decided passed.');
    expect(html).not.toContain('Most of what was checked passed');
  });

  it('an empty record says so in the headline, not that most of it passed', () => {
    const html = render([]);
    expect(html).toContain('Nothing checked yet in this record.');
    expect(html).not.toContain('Most of what was checked passed');
  });

  it('localizes the balance copy in Romanian', () => {
    const html = render([rec('p1', 'pass'), rec('f1', 'flagged')], 'ro');
    expect(html).toContain('50% din tot ce a fost decis a trecut.');
    expect(html).toContain('au trecut neatinse');
  });
});
