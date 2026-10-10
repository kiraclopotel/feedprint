// Q40 + Q41 (wiring W48): honest denominators and no fake-empty.
//
// Q40: the 14-day trend's "items witnessed" bar counted markers and room
// summaries while its flagged overlay was verdict-filtered; the platform
// card captioned flagged-only bars with the whole record count; the
// flagged KPI's "of N records seen" included non-content records.
// Q41: a theme-compute failure rendered the "not enough content" empty
// state; it now renders a distinct error line.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';

const STATS_TAB_PATH = 'src/ui/dashboard/components/StatisticsTab.tsx';
const PATTERNS_TAB_PATH = 'src/ui/dashboard/components/PatternsTab.tsx';
const RECIDIVIST_AUTHORS_PANEL_PATH = 'src/ui/dashboard/components/RecidivistAuthorsPanel.tsx';
const statsTab = readFileSync(join(process.cwd(), STATS_TAB_PATH), 'utf8');
const patternsTab = readFileSync(join(process.cwd(), PATTERNS_TAB_PATH), 'utf8');

describe('Q40 — StatisticsTab denominators (source-lock)', () => {
  it('the 14-day trend counts content records only', () => {
    const daily = statsTab.match(/const daily = React\.useMemo[\s\S]{0,1500}?\}, \[records, now\]\);/)?.[0] ?? '';
    expect(daily).toContain('if (!isBalanceContent(r)) continue;');
  });

  it('the flagged KPI denominator is the items seen, not all records', () => {
    expect(statsTab).toContain('t.statsOfRecordsSeen(sets.items, ');
    expect(statsTab).not.toContain('t.statsOfRecordsSeen(records.length)');
  });

  it('the platform caption states the flagged total the bars sum to', () => {
    expect(statsTab).toContain('t.statsByPlatformSub(Object.values(stats.byPlatform).reduce((a, b) => a + b, 0))');
  });

  it('the EN and RO captions name flagged items, not records', () => {
    expect(DASHBOARD_STRINGS.en.statsByPlatformSub(5)).toContain('flagged');
    expect(DASHBOARD_STRINGS.ro.statsByPlatformSub(5)).toContain('semnalate');
  });
});

describe('Q42 — dead reads rendered (source-lock, W49)', () => {
  it('RecidivistAuthorsPanel renders the escalating chip with its why', () => {
    const panel = readFileSync(join(process.cwd(), RECIDIVIST_AUTHORS_PANEL_PATH), 'utf8');
    expect(panel).toContain('esc?.escalating');
    expect(panel).toContain('t.recidEscalating');
    expect(panel).toContain('t.recidEscalatingTip(esc.flagged, esc.seen)');
  });

  it('StatisticsTab surfaces records dropped for unreadable timestamps', () => {
    expect(statsTab).toContain('exposure.undatedCount > 0');
    expect(statsTab).toContain('t.statsUndatedNote(exposure.undatedCount)');
  });

  it('both languages carry the new strings', () => {
    for (const lang of ['en', 'ro'] as const) {
      expect(DASHBOARD_STRINGS[lang].recidEscalating.length).toBeGreaterThan(0);
      expect(DASHBOARD_STRINGS[lang].recidEscalatingTip(3, 6).length).toBeGreaterThan(0);
      expect(DASHBOARD_STRINGS[lang].statsUndatedNote(2).length).toBeGreaterThan(0);
      expect(DASHBOARD_STRINGS[lang].statsUndatedNote(1)).not.toBe(DASHBOARD_STRINGS[lang].statsUndatedNote(2));
    }
  });
});

describe('Q41 — PatternsTab error state distinct from empty (source-lock)', () => {
  it('a compute failure can never be rendered as emptiness', () => {
    // The invariant, not its old shape. Until 2026-09-17 the themes section
    // read `computeFailed ? ... : top.length === 0 ? t.patEmpty : ...`, and
    // this test held the two apart by their order in the file. The section is
    // a component now, and what keeps them apart is the guard on the prop that
    // carries the empty sentence: the empty line is offered only when the
    // computation did NOT fail, and the failure has its own branch below it.
    expect(patternsTab).toContain('setComputeFailed(true);');
    expect(patternsTab).toContain('empty={!computeFailed && top.length === 0 ? t.patEmpty : undefined}');
    const failureLine = patternsTab.indexOf('{t.patComputeFailed}');
    expect(failureLine).toBeGreaterThan(-1);
  });

  it('both languages carry the failure string and it does not claim emptiness', () => {
    for (const lang of ['en', 'ro'] as const) {
      const s = DASHBOARD_STRINGS[lang].patComputeFailed;
      expect(s.length).toBeGreaterThan(0);
      expect(s).not.toBe(DASHBOARD_STRINGS[lang].patEmpty);
    }
  });
});
