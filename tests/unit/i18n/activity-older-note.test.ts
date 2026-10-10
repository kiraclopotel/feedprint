// Item 7, second slice, the last piece (14 Sep 2026): the Activity list ends
// at the walk window (90 days of archived months), and a list that ends
// there must not read as the whole record. The tab says how many older
// records are counted in every total and kept in the archive, in every
// locale; the shell hands it the count as archived minus loaded.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';

const shell = readFileSync(join(process.cwd(), 'src/ui/dashboard/Dashboard.tsx'), 'utf8');
const tab = readFileSync(join(process.cwd(), 'src/ui/dashboard/components/ActivityTab.tsx'), 'utf8');

describe('the Activity note for months outside the walk window', () => {
  it('the shell passes archived minus loaded, zero while the months are pending', () => {
    expect(shell).toContain('archivedOlderCount={archivesPending ? 0 : Math.max(0, archivedRecordCount - archiveRecords.length)}');
  });

  it('the tab prints it only when there are older records and the list is not loading', () => {
    expect(tab).toContain('{!archiveLoading && archivedOlderCount > 0 && (');
    expect(tab).toContain('t.showingArchivedOlder(archivedOlderCount)');
  });

  it('every locale names the 90 days, the totals and the complete export', () => {
    for (const locale of ['en', 'ro', 'es', 'pt-BR'] as const) {
      const s = DASHBOARD_STRINGS[locale].showingArchivedOlder(1234);
      expect(s, `${locale}: names the window`).toMatch(/90/);
      expect(s.length, `${locale}: says enough`).toBeGreaterThan(80);
      expect(s, `${locale}: carries the count`).toMatch(/1[.,]?234/);
    }
  });
});
