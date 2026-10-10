// The dashboard boot reads the month summaries, not the archived months, which
// load on demand the first time a tab that walks records opens after each
// load; until then the header pill and the stats are built from the summaries
// plus the active chain.
//
// The shell (Dashboard.tsx) is locked by source reads, the same idiom as
// wiring-batch-b-whole-chain.test.tsx: mounting it needs IndexedDB and the
// service worker.

import { describe, expect, it } from 'vitest';
import { readSource } from '../../../helpers/read-source';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const shell = readSource('src/ui/dashboard/Dashboard.tsx');

describe('dashboard: summaries at boot, archives on demand', () => {
  it('load() reads the summaries and does not read the archived months', () => {
    const loadStart = shell.indexOf('const load = async (');
    const loadEnd = shell.indexOf('const onParentFeedback = async');
    expect(loadStart).toBeGreaterThan(0);
    expect(loadEnd).toBeGreaterThan(loadStart);
    const load = shell.slice(loadStart, loadEnd);
    // Since 2026-09-18 the read answers with the summaries it got AND whether
    // it got them all, so a month whose summary will not read can no longer be
    // folded into an all-time figure as if it held nothing.
    expect(load).toContain('const summaryRead = await readMonthSummaries();');
    expect(load).toContain('setMonthSummaries(summaryRead.summaries);');
    expect(load).toContain('if (!summaryRead.complete) {');
    expect(load).not.toContain('loadArchivesOldestFirst()');
    // The cheap counts stay: months listed and records counted, never unwrapped.
    // The count now answers whether it is the total or a floor, so an
    // unreadable month can no longer shrink an all-time figure in silence.
    expect(load).toContain('const counted = await countArchivedRecords();');
    expect(load).toContain('setArchivedRecordCount(counted.count);');
    expect(load).toContain('setArchivedRecordCountComplete(counted.complete);');
  });

  it('the months load on demand after each load, for every tab but Activity', () => {
    expect(shell).toContain('const ensureArchivesLoaded = async (): Promise<void> => {');
    expect(shell).toContain('const wanted = monthKeysInWindow(await listArchiveMonths(), new Date(), WALK_WINDOW_DAYS);');
    // Since 2026-09-18 the call answers with the months it could read AND the
    // ones it could not, so a month that will not open is named instead of
    // silently missing from every fold built here.
    expect(shell).toContain('const loaded = await loadArchiveMonths(wanted);');
    expect(shell).toContain('const archives = loaded.months;');
    expect(shell).toContain('if (loaded.unreadableMonths.length > 0) {');
    expect(shell).toContain("if (loading || loadFailed || tab === 'activity' || (tab === 'feedlog' && !feedLogNeedsMonths) || archivesLoaded) return;");
    expect(shell).toContain('void ensureArchivesLoaded();');
    // A reset or a restore changes the months, so every load lets them be read again.
    const load = shell.slice(shell.indexOf('const load = async ('), shell.indexOf('const onParentFeedback = async'));
    expect(load).toContain('archivesLoadingRef.current = false;');
    expect(load).toContain('setArchivesLoaded(false);');
  });

  it('stats and the flagged pill read the loaded months as records and every other month as its summary', () => {
    expect(shell).toContain('foldSummariesIntoStats(computeStats(allRecords), unloadedSummaries)');
    expect(shell).toContain('flaggedItemsAllMonths(allRecords, unloadedSummaries, monthSets)');
    // A month not counted by the module's rules yet adds its summary's flagged count.
    expect(readFileSync(join(process.cwd(), 'src/ui/dashboard/month-sets.ts'), 'utf8')).toContain('n += summary.flagged;');
    expect(shell).toContain('setLoadedMonthKeys(new Set(archives.map(a => a.monthKey)))');
    expect(shell).toContain('[...archiveRecords, ...records]');
  });
});
