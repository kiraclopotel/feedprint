// The file named "latest" could be days old with everything on the dashboard
// green.
//
// The daily automatic backup writes two copies. The dated one goes into a
// folder named by date and record count, with `conflictAction: 'uniquify'`, and
// it refuses to record a success it cannot confirm: its own comment says only a
// CONFIRMED completion earns 'saved', so retention never prunes real backups on
// the strength of a phantom file.
//
// Two lines later the fixed-name copy is written with
// `conflictAction: 'overwrite'` and **its return value was thrown away**. That
// file exists for one reason: to answer "which backup is the newest" by its
// NAME, without reading dates off a dozen folders. A file that says "latest"
// and is not is worse than no such file, and nothing anywhere could say so.
//
// Found 2026-09-19. What changed is only the honesty, not the retry: by the
// time that line runs, the dated copy for this run is already on disk and
// confirmed, so nothing is at risk. What was missing was the ability to say
// that the convenience is out of date, and the Export tab says it now.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSource } from '../../helpers/read-source';

describe('the latest backup says when it is not (2026-09-19)', () => {
  it('the outcome is taken, not dropped on the floor', () => {
    // Read off the source: driving a whole automatic backup here would need the
    // chain, the seal and the downloads API, and what this case is about is one
    // assignment. The pair of assertions is the point — that the call is
    // awaited into something, and that the something reaches the health record.
    const src = readSource('src/forensics/backup.ts');
    expect(src, 'the write answers into a variable')
      .toMatch(/latestCopy = await downloadQuietly\(\{ url, filename: LATEST_DOWNLOADS_BACKUP_PATH/);
    expect(src, 'and that answer is recorded').toContain('lastLatestCopy: latestCopy');
    expect(src, 'an unattempted write is not silently a success')
      .toMatch(/let latestCopy: 'complete' \| 'interrupted' \| 'unconfirmed' = 'unconfirmed';/);
  });

  it('the dated copy is still the one that gates the health record', () => {
    // The distinction that must not blur. A failed fixed-name copy is a stale
    // convenience; a failed DATED copy is a missing backup, and only the second
    // one may stop the run reporting 'saved'.
    const src = readSource('src/forensics/backup.ts');
    const datedGate = src.match(/if \(outcome !== 'complete'\)[\s\S]{0,400}?return \{ status: 'error'/);
    expect(datedGate, 'the dated copy still refuses to report a success it cannot confirm').toBeTruthy();
    expect(src, 'and the fixed-name copy does not gate anything')
      .not.toMatch(/if \(latestCopy !== 'complete'\)[\s\S]{0,200}?return/);
  });

  it('the Export tab has a sentence for it, in all four languages', async () => {
    const { DASHBOARD_STRINGS } = await import('../../../src/i18n/dashboard-strings');
    for (const lang of ['en', 'ro', 'es', 'pt-BR'] as const) {
      const line = (DASHBOARD_STRINGS as Record<string, { backupLatestCopyStale?: string }>)[lang]?.backupLatestCopyStale;
      expect(line, `${lang} has the sentence`).toBeTruthy();
      expect(line!.length, `${lang} says more than a word`).toBeGreaterThan(40);
    }
  });

  it('that sentence names the dated copy first, so it does not read as a lost backup', async () => {
    // A person reading "the latest backup failed" concludes they have no
    // backup. They have one; it is in today's dated folder. The English is
    // checked against the two things it must carry.
    const { DASHBOARD_STRINGS } = await import('../../../src/i18n/dashboard-strings');
    const en = DASHBOARD_STRINGS.en.backupLatestCopyStale;
    expect(en, 'it says the backup was saved').toMatch(/saved/i);
    expect(en, 'and which file is the stale one').toMatch(/latest/i);
  });

  it('the tab only shows it when the copy actually failed', () => {
    const src = readSource('src/ui/dashboard/components/ExportTab.tsx');
    // Undefined means an older install that never recorded the field, or no
    // automatic run yet. Neither is a stale file, and neither may raise a
    // warning about one.
    expect(src).toContain("rawHealth?.lastLatestCopy !== undefined && rawHealth.lastLatestCopy !== 'complete'");
  });
});
