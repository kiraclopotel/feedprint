// Two numbers on the dashboard that rounded or filtered away the thing they
// were describing.
//
// THE HEADLINE. "{pct}% of everything decided passed." was a plain
// Math.round over passed/decided. With 199 of 200 passed that is 99.5, which
// rounds to 100, so the sentence stated an absolute while the bar beneath it
// printed "flagged 1 (1%)" on the same screen: 101% between them, and a claim
// the records contradict two lines lower. The identical line sat in the
// Statistics tab, so the two could also drift apart.
//
// 100 and 0 are the two values a reader takes as statements that there were
// none of the other kind. They are now reserved for exactly that.
//
// THE BACKUP WARNING. `trimBackupToFit` halves the record count when the
// automatic copy is over the transport ceiling and marks it
// 'recent-records-only'. backup.ts counts those dropped records into
// `lastUncoveredArchived` and says in a comment that doing so "keeps the
// Export tab's warning honest in both cases". It did not: the Export tab asked
// for `lastAutoCoverage === 'active-chain-only'` by name, and the trimmed value
// is a third one, so the single case where today's automatic copy silently
// contains half the chain was the one case that printed nothing. The status
// line above it is green on age alone.
//
// Found 2026-09-19 by a read-only scan of the ways the record can be lost and
// the numbers a person reads about it. Both verified against the code that
// contradicts them.

import { describe, expect, it } from 'vitest';
import { honestPct } from '../../../../src/ui/dashboard/components/overview-data';
import { readSource } from '../../../helpers/read-source';

describe('a headline does not round away the flag (2026-09-19)', () => {
  it('199 of 200 is not 100%', () => {
    expect(honestPct(199, 200)).toBe(99);
    expect(Math.round((199 / 200) * 100), 'which is what it printed before').toBe(100);
  });

  it('one flagged in a thousand is still not 100%', () => {
    expect(honestPct(999, 1000)).toBe(99);
  });

  it('and one passed in a thousand is not 0%', () => {
    // The same rule at the other end: 0 says there were none.
    expect(honestPct(1, 1000)).toBe(1);
    expect(Math.round((1 / 1000) * 100), 'which is what it printed before').toBe(0);
  });

  it('100 and 0 still mean what a reader takes them to mean', () => {
    expect(honestPct(200, 200), 'everything passed').toBe(100);
    expect(honestPct(0, 200), 'nothing did').toBe(0);
    expect(honestPct(0, 0), 'nothing was decided').toBe(0);
  });

  it('an ordinary share is untouched', () => {
    expect(honestPct(150, 200)).toBe(75);
    expect(honestPct(1, 3)).toBe(33);
  });

  it('both tabs read the one rule, so they cannot disagree', () => {
    for (const path of [
      'src/ui/dashboard/components/overview-data.ts',
      'src/ui/dashboard/components/StatisticsTab.tsx',
    ]) {
      const src = readSource(path);
      expect(src, `${path} uses the helper`).toContain('honestPct(');
      expect(src, `${path} no longer rounds the share itself`)
        .not.toMatch(/Math\.round\(\((balancePassed|bPassed) \/ decided\) \* 100\)/);
    }
  });

  it('the backup warning is gated on coverage falling short, not on one name', () => {
    const tab = readSource('src/ui/dashboard/components/ExportTab.tsx');
    expect(tab).toContain("rawHealth?.lastAutoCoverage !== 'full' && (rawHealth?.lastUncoveredArchived ?? 0) > 0");
    expect(tab, 'the one-name gate is gone')
      .not.toContain("rawHealth?.lastAutoCoverage === 'active-chain-only'");
  });

  it('the trimmed copy really is a third value, which is why the name gate missed it', () => {
    // Stated as a reading of backup.ts rather than as a claim about it.
    const backup = readSource('src/forensics/backup.ts');
    expect(backup).toContain("historyCoverage: 'recent-records-only',");
    expect(backup, 'and its records are counted as uncovered')
      .toContain('lastUncoveredArchived: uncoveredArchived + (backup.trimmedOlderRecords ?? 0),');
  });
});
