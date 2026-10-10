// Two backup layers were always-on at once.
//
// A parent who wired a backup folder still got a file written into Downloads
// every day: a duplicate of a copy that is already better (no size ceiling, no
// download row, nothing a child can see or cancel). The cost was not only
// noise. Every automatic write creates a NEW dated folder under Downloads, and
// Chrome's "Save as" dialog opens in the directory of the most recent
// download, which is how unrelated files end up filed inside FeelingWise
// backup folders.
//
// The suppression must be time-bounded, and that is the part worth locking
// down. The folder mirror only runs in the dashboard, because the directory
// picker and its permission live in page context. The Downloads copy runs on a
// service-worker alarm and needs nobody present. Suppressing Downloads
// permanently just because a folder was once wired would silently end
// automatic backups for anyone who stopped opening the dashboard.

import { describe, expect, it } from 'vitest';
import { folderMirrorCoversDownloads } from '../../../src/forensics/backup';

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-09-01T12:00:00.000Z');

describe('folderMirrorCoversDownloads', () => {
  it('suppresses the Downloads copy right after a folder write', () => {
    expect(folderMirrorCoversDownloads(new Date(NOW - HOUR).toISOString(), NOW)).toBe(true);
  });

  it('still suppresses at 47 hours', () => {
    expect(folderMirrorCoversDownloads(new Date(NOW - 47 * HOUR).toISOString(), NOW)).toBe(true);
  });

  it('falls back to Downloads once the folder copy goes stale', () => {
    // The dashboard has not been opened in two days, so nothing is keeping the
    // folder current and the alarm-driven copy has to take over again.
    expect(folderMirrorCoversDownloads(new Date(NOW - 49 * HOUR).toISOString(), NOW)).toBe(false);
  });

  it('backs up when no folder copy has ever been written', () => {
    expect(folderMirrorCoversDownloads(undefined, NOW)).toBe(false);
  });

  it('backs up rather than trusting an unparseable timestamp', () => {
    expect(folderMirrorCoversDownloads('not a date', NOW)).toBe(false);
  });

  it('backs up rather than trusting a future timestamp', () => {
    // A clock moving backwards would otherwise read as a permanently fresh
    // backup and suppress Downloads forever.
    expect(folderMirrorCoversDownloads(new Date(NOW + 10 * HOUR).toISOString(), NOW)).toBe(false);
  });
});
