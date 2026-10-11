// After "Back up now" the yellow band "Your record has not been backed up yet" stayed above the Export tab while the
// line under the button said "Last backed up just now"; it went only after a reload (tester, 11 Oct 2026,
// crew/tester/night-2026-10-11/fn-restore-after.png). The band is the dashboard's, recomputed when attentionTick moves;
// the tab's backup moved only its own health line. The tab now tells the dashboard, which reads the bands again.
import { describe, expect, it } from 'vitest';
import { readSource } from '../../../helpers/read-source';

const DASH = readSource('src/ui/dashboard/Dashboard.tsx');
const TAB = readSource('src/ui/dashboard/components/ExportTab.tsx');

describe('the backup band and the Export tab', () => {
  it('the dashboard re-reads its bands when the tab reports a backup', () => {
    expect(DASH).toMatch(/<ExportTab[\s\S]*?onBackupChanged=\{\(\) => setAttentionTick\(\(?n\)? => n \+ 1\)\}[\s\S]*?\/>/);
  });
  it('the tab reports a written backup and one that was not saved', () => {
    expect(TAB).toMatch(/await recordManualBackupSuccess\([^)]*\);\s*setHealthTick\(\(t\) => t \+ 1\);\s*onBackupChanged\?\.\(\);/);
    expect(TAB).toMatch(/await recordManualBackupNotSaved\(wrote\);\s*setHealthTick\(\(t\) => t \+ 1\);\s*onBackupChanged\?\.\(\);/);
  });
});
