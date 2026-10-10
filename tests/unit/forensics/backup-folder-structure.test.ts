// @vitest-environment jsdom
//
// Backup layout (ruled 2026-08-02: "create clear backup structure/date, not all
// backups in same place, put them separate, the folder tells date and how many
// records").
import { describe, expect, it } from 'vitest';
import {
  compactCount,
  backupFolder,
  autoBackupPath,
  autoBackupDayOf,
  selectAutoBackupPrune,
  AUTO_BACKUP_KEEP_DAYS,
} from '../../../src/forensics/backup';

describe('backup folder structure', () => {
  it('rounds the record count the way a person reads it', () => {
    expect(compactCount(0)).toBe('0');
    expect(compactCount(999)).toBe('999');
    expect(compactCount(1000)).toBe('1k');
    expect(compactCount(13459)).toBe('13k');
    expect(compactCount(13600)).toBe('14k');
  });

  it('names one folder per day, carrying the date and the size', () => {
    expect(backupFolder(new Date('2026-08-02T17:13:40Z'), 13459))
      .toBe('FeelingWise/2026-08-02-13k');
  });

  it('puts the time in the file name so a second backup the same day cannot overwrite the first', () => {
    const a = autoBackupPath(new Date('2026-08-02T09:05:00Z'), 13459);
    const b = autoBackupPath(new Date('2026-08-02T17:13:00Z'), 13459);
    expect(a).toBe('FeelingWise/2026-08-02-13k/feelingwise-backup-0905.json');
    expect(b).toBe('FeelingWise/2026-08-02-13k/feelingwise-backup-1713.json');
    expect(a).not.toBe(b);
  });

  it('sorts chronologically in a file manager — the reason for ISO over 8-2-26', () => {
    const days = [
      backupFolder(new Date('2026-12-01T00:00:00Z'), 1),
      backupFolder(new Date('2026-08-02T00:00:00Z'), 1),
      backupFolder(new Date('2027-01-09T00:00:00Z'), 1),
    ];
    expect([...days].sort()).toEqual([days[1], days[0], days[2]]);
  });
});

// Retention (G1, 2026-08-04): unbounded accumulation of daily folders (and,
// before the 2026-08-02 layout, weekly dated archives) is capped by keeping
// the newest AUTO_BACKUP_KEEP_DAYS distinct backup days. Every automatic
// backup is a FULL consolidated snapshot, so an older daily is strictly
// subsumed by any newer one — mirroring the in-DB 10k oldest-first cap.
describe('auto-backup retention selection', () => {
  const win = (rel: string) => `C:\\Users\\parent\\Downloads\\${rel.replace(/\//g, '\\')}`;
  const daily = (day: string, hhmm: string, count = '13k') =>
    win(`FeelingWise/${day}-${count}/feelingwise-backup-${hhmm}.json`);

  it('keeps two weeks of daily snapshots', () => {
    expect(AUTO_BACKUP_KEEP_DAYS).toBe(14);
  });

  it('extracts the backup day from both automatic layouts, either slash direction', () => {
    expect(autoBackupDayOf(daily('2026-08-02', '1713'))).toBe('2026-08-02');
    expect(autoBackupDayOf('/home/p/Downloads/FeelingWise/2026-08-02-13k/feelingwise-backup-1713.json')).toBe('2026-08-02');
    // Legacy weekly dated archive (pre-2026-08-02 layout).
    expect(autoBackupDayOf(win('FeelingWise/feelingwise-backup-2026-06-11.json'))).toBe('2026-06-11');
    // Chrome's uniquify suffix still parses.
    expect(autoBackupDayOf(win('FeelingWise/2026-08-02-13k/feelingwise-backup-1713 (1).json'))).toBe('2026-08-02');
  });

  it('never treats manual exports or pre-restore safety copies as automatic', () => {
    // Manual export (Downloads root, full ISO timestamp with time).
    expect(autoBackupDayOf('C:\\Users\\parent\\Downloads\\feelingwise-backup-2026-08-02T17-13-40-000Z.json')).toBeUndefined();
    // Manual export a user dragged INTO the FeelingWise folder.
    expect(autoBackupDayOf(win('FeelingWise/feelingwise-backup-2026-08-02T17-13-40-000Z.json'))).toBeUndefined();
    // Pre-restore safety copy.
    expect(autoBackupDayOf(win('FeelingWise/feelingwise-pre-restore-2026-08-02T17-13-40.json'))).toBeUndefined();
    // Unrelated file that happens to sit in the folder.
    expect(autoBackupDayOf(win('FeelingWise/notes.json'))).toBeUndefined();
  });

  it('prunes only the days beyond the newest N, counting a day once however many files it holds', () => {
    const items = [
      { id: 1, filename: daily('2026-08-04', '0900') },
      { id: 2, filename: daily('2026-08-04', '1730') }, // same day, second file
      { id: 3, filename: daily('2026-08-03', '0900') },
      { id: 4, filename: daily('2026-08-01', '0900') },
    ];
    // keepDays=2 keeps 08-04 (both files) + 08-03; 08-01 goes.
    expect(selectAutoBackupPrune(items, 2)).toEqual([4]);
  });

  it('prunes legacy weekly archives past the cap alongside daily folders', () => {
    const items = [
      { id: 1, filename: daily('2026-08-04', '0900') },
      { id: 2, filename: win('FeelingWise/feelingwise-backup-2026-06-11.json') },
      { id: 3, filename: win('FeelingWise/feelingwise-backup-2026-05-28.json') },
    ];
    expect(selectAutoBackupPrune(items, 2)).toEqual([3]);
  });

  it('prunes nothing while fewer than N days exist (the accumulation phase)', () => {
    const items = [
      { id: 1, filename: daily('2026-08-04', '0900') },
      { id: 2, filename: daily('2026-08-03', '0900') },
    ];
    expect(selectAutoBackupPrune(items, AUTO_BACKUP_KEEP_DAYS)).toEqual([]);
  });

  it('non-automatic files are never prune candidates even when old', () => {
    const items = [
      { id: 1, filename: daily('2026-08-04', '0900') },
      { id: 2, filename: win('FeelingWise/feelingwise-pre-restore-2025-01-01T00-00-00.json') },
      { id: 3, filename: 'C:\\Users\\parent\\Downloads\\feelingwise-backup-2025-01-01T00-00-00-000Z.json' },
    ];
    expect(selectAutoBackupPrune(items, 1)).toEqual([]);
  });
});
