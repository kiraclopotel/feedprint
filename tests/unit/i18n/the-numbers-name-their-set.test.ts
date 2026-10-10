// A number on the dashboard says which set it counts with the noun the
// language file keeps under the counting module's own key for that set, so a
// sentence cannot call checked items "records" while the module counts
// something else. And the screens that print the counted sets take them
// from the module, not from a formula of their own.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';
import { UI_LANGUAGES } from '../../../src/i18n';
import { RECORD_SET_NAMES } from '../../../src/ui/dashboard/record-sets';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe.each(UI_LANGUAGES)('%s: every counted set has one noun, used by every sentence that names it', (lang) => {
  const t = DASHBOARD_STRINGS[lang];
  // The noun a count prints for a set, read from the count itself (setCount is keyed by the module's set names).
  const many = (set: typeof RECORD_SET_NAMES[number]) => t.setCount(set, 5).replace(/^5 /, '');

  it('names every set the module counts, each with its own noun', () => {
    const plurals = RECORD_SET_NAMES.map(many);
    expect(new Set(plurals).size).toBe(plurals.length);
    for (const set of RECORD_SET_NAMES) expect(t.setCount(set, 1)).not.toBe(t.setCount(set, 5).replace(/^5/, '1'));
  });

  it.each(RECORD_SET_NAMES)('a caption for %s carries the same count and noun', (set) => {
    expect(t.fbProv(set, 5, 'A', 'B')).toContain(t.setCount(set, 5));
  });

  it('the sentences on the header, Statistics and Feed behavior name their set and window', () => {
    expect(t.hdrRecordsLabel.toLowerCase()).toBe(many('entries').toLowerCase());
    expect(t.kpiRecordsToday.startsWith(many('entries'))).toBe(true);
    expect(t.statsAllTime('25.1K')).toContain('25.1K');
    expect(t.statsAllTime('25.1K')).toContain(many('entries'));
    expect(t.statsOfRecordsSeen(5, 'A', 'B')).toContain(t.setCount('items', 5));
    expect(t.statsOfRecordsSeen(5, 'A', 'B')).toMatch(/A.+B/);
    // The platform card sums the store's flagged rule, which keeps image and button readings,
    // so it must not print the module's flagged-items noun for that different set.
    expect(t.statsByPlatformSub(5)).not.toContain(t.setCount('flagged', 5));
    expect(t.statsByPlatformSub(5)).toContain(t.tabActivityFlagged(5).slice(t.tabActivityFlagged(5).indexOf(',') + 2));
    const coverage = t.patCompCoverage(3, 50, 7, 7, 'END');
    expect(coverage).toContain(t.setCount('seen', 50));
    expect(coverage).toContain(t.setCount('roomSummaries', 7));
    expect(coverage).toContain('END');
    // The badge counts all months, a different window from the Statistics bar, and says so.
    expect(t.tabActivityFlagged(4).length).toBeGreaterThan(t.tabActivityFlagged(4).indexOf(',') + 3);
    expect(t.tabActivityFlagged(4)).toContain(',');
  });

  it('the older months: the badge says when a month still adds its saved total, the line says how far the count has come', () => {
    const counted = t.tabActivityFlaggedTitle(9, 0);
    const pending = t.tabActivityFlaggedTitle(9, 2);
    expect(counted).toContain('9');
    expect(pending).toContain('9');
    expect(pending).toContain('2');
    // A month still counting adds a total that also counts the button readings: the hover names the button.
    expect(pending).toMatch(/Read this for me|Léeme esto|Leia isso para mim|Citește-mi asta/);
    expect(counted).not.toMatch(/Read this for me|Léeme esto|Leia isso para mim|Citește-mi asta/);
    expect(t.hdrCountingOlderMonths(3, 6)).toMatch(/3\D+6/);
    expect(t.hdrBreakdownOlderSorted(2, '20:10')).toContain('20:10');
    expect(t.hdrCountingOlderMonths(0, 1)).not.toMatch(/1 months/);
    expect(t.hdrBreakdownOlderSorted(1, '20:10')).not.toBe(t.hdrBreakdownOlderSorted(2, '20:10').replace('2', '1'));
    for (const x of [counted, pending, t.hdrCountingOlderMonths(3, 6), t.hdrBreakdownOlderSorted(2, '20:10')]) {
      expect(x).not.toContain('—');
    }
  });

  it('carries no em dash', () => {
    for (const s of [t.setCount('checked', 2), t.fbProv('items', 2, 'A', 'B'), t.patCompCoverage(1, 2, 1, 7, 'E'), t.hdrBreakdownOlder(2, '20:10'), t.hdrBreakdownUnread(2)]) {
      expect(s).not.toContain('\u2014');
    }
  });
});

// Every file under src/ui/dashboard but the counting module itself: no flagged, blocked,
// hidden, marker or comment-section-summary rule of its own, so two screens cannot count
// one set by two rules. Comments are stripped first; a rule is code.
function dashboardFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
    const p = dir + '/' + e.name;
    if (e.isDirectory()) out.push(...dashboardFiles(p));
    else if (/\.(ts|tsx)$/.test(e.name) && !p.endsWith('/record-sets.ts')) out.push(p);
  }
  return out;
}
const RULES: Array<[string, RegExp]> = [
  ['the marker list', /forensics\/system-records/],
  ['a store or export flagged rule', /isExposureRecord|isFlaggedRecord\b|isDecidedContentRecord|flaggedInSummaries/],
  ['a comment-section summary test', /kind (===|!==) 'environment'/],
  ['a flag verdict test', /verdict === '(flagged|flagged-hidden)'|verdict === undefined/],
  ['a local rule function', /function (isFlagged\w*|isHidden\w*|isBlocked\w*|isMarker|isRoomSummary|isItem|isIntervention)\(/],
];

describe('no dashboard file keeps a counting rule of its own', () => {
  const files = dashboardFiles('src/ui/dashboard');
  it('finds the dashboard files', () => { expect(files.length).toBeGreaterThan(40); });
  it.each(files)('%s', (p) => {
    const code = src(p).replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).filter((l) => !l.trim().startsWith('//')).join('\n');
    for (const [what, re] of RULES) expect(code, what).not.toMatch(re);
  });
});

describe.each(UI_LANGUAGES)('%s: the remaining counts name their set', (lang) => {
  const t = DASHBOARD_STRINGS[lang];
  const noun = (set: typeof RECORD_SET_NAMES[number]) => t.setCount(set, 5).replace(/^5 /, '');
  it('the blocked tile names its days, the techniques and unsigned tiles their window', () => {
    expect(t.statsBlockedSub('START', 'END')).toMatch(/START.+END/);
    expect(t.statsTechniquesSub).toContain(t.statsByPlatformSub(5).split(', ')[1]);
    expect(t.statsUnsignedSub).toContain(t.statsByPlatformSub(5).split(', ')[1]);
  });
  it('the Exposure total and its caption use one noun for one set', () => {
    expect(t.expoOfTotal(5)).toContain(t.fbProv('entries', 5, 'A', 'B').split(' · ')[0]);
    expect(t.expoItemsWitnessed.toLowerCase()).toContain(noun('entries').toLowerCase().split(' ')[0]);
  });
});
