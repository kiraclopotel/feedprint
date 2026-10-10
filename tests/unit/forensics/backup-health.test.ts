// FeelingWise — backup-health assessment (pure logic). A silently-failed backup
// must not look safe (VISION: record loss is military-grade failure). The
// storage read/write + dashboard surfacing are live-verified on device; this
// locks the pure status decision + age formatting.

import { describe, it, expect } from 'vitest';
import { assessBackupHealth, formatRelativeAge, exceedsAutoBackupSize, AUTO_BACKUP_MAX_BYTES, type BackupHealth } from '../../../src/forensics/backup';

const NOW = Date.parse('2026-06-05T12:00:00.000Z');
const agoMs = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

describe('formatRelativeAge', () => {
  it('formats across units', () => {
    expect(formatRelativeAge(5_000)).toBe('just now');
    expect(formatRelativeAge(MIN)).toBe('1 minute ago');
    expect(formatRelativeAge(3 * MIN)).toBe('3 minutes ago');
    expect(formatRelativeAge(HOUR)).toBe('1 hour ago');
    expect(formatRelativeAge(5 * HOUR)).toBe('5 hours ago');
    expect(formatRelativeAge(DAY)).toBe('1 day ago');
    expect(formatRelativeAge(4 * DAY)).toBe('4 days ago');
  });
  it('never goes negative', () => {
    expect(formatRelativeAge(-1000)).toBe('just now');
  });
});

describe('exceedsAutoBackupSize (SW data-URL memory guard)', () => {
  it('passes a normal-sized chain', () => {
    expect(exceedsAutoBackupSize(0)).toBe(false);
    expect(exceedsAutoBackupSize(5 * 1024 * 1024)).toBe(false); // 5 MB
    expect(exceedsAutoBackupSize(AUTO_BACKUP_MAX_BYTES)).toBe(false); // boundary = ok
  });
  it('skips an oversized chain (would spike SW memory as a data URL)', () => {
    expect(exceedsAutoBackupSize(AUTO_BACKUP_MAX_BYTES + 1)).toBe(true);
    expect(exceedsAutoBackupSize(100 * 1024 * 1024)).toBe(true);
  });
});

describe('assessBackupHealth', () => {
  it('reports NEVER when nothing has succeeded', () => {
    const a = assessBackupHealth({}, NOW);
    expect(a.level).toBe('never');
    expect(a.message).toMatch(/Back up now/);
  });

  it('reports FAILING when the last status was an error (over any age)', () => {
    const h: BackupHealth = { lastStatus: 'error', lastError: 'disk full', lastAttemptAt: agoMs(MIN) };
    const a = assessBackupHealth(h, NOW);
    expect(a.level).toBe('failing');
    expect(a.message).toMatch(/failed/i);
    expect(a.message).toMatch(/disk full/);
  });

  it('reports OK when a success is recent and a passphrase copy exists', () => {
    const a = assessBackupHealth({ lastStatus: 'saved', lastSuccessAt: agoMs(2 * HOUR), lastPassphraseBackupAt: agoMs(30 * DAY) }, NOW);
    expect(a.level).toBe('ok');
    expect(a.message).toMatch(/2 hours ago/);
  });

  it('reports STALE when the last success is older than 2 days', () => {
    const a = assessBackupHealth({ lastStatus: 'saved', lastSuccessAt: agoMs(5 * DAY) }, NOW);
    expect(a.level).toBe('stale');
    expect(a.message).toMatch(/out of date/);
  });

  it('treats the 2-day boundary as still OK', () => {
    const a = assessBackupHealth({ lastStatus: 'saved', lastSuccessAt: agoMs(2 * DAY - MIN), lastPassphraseBackupAt: agoMs(30 * DAY) }, NOW);
    expect(a.level).toBe('ok');
  });

  it('a recent skip (empty chain) with a prior success still reads from success age', () => {
    const a = assessBackupHealth({ lastStatus: 'skipped', lastSuccessAt: agoMs(3 * HOUR), lastPassphraseBackupAt: agoMs(30 * DAY) }, NOW);
    expect(a.level).toBe('ok');
  });

  it('handles a malformed lastSuccessAt as never', () => {
    const a = assessBackupHealth({ lastStatus: 'saved', lastSuccessAt: 'not-a-date' }, NOW);
    expect(a.level).toBe('never');
  });

  // W82: the dashboard renders this line through DASHBOARD_STRINGS keyed on
  // `level`, so the age and the stored cause have to travel as fields rather
  // than only baked into the English `message`.
  it('carries the age as a field for the three levels that report one', () => {
    for (const [h, level] of [
      [{ lastStatus: 'saved', lastSuccessAt: agoMs(2 * HOUR), lastPassphraseBackupAt: agoMs(30 * DAY) }, 'ok'],
      [{ lastStatus: 'saved', lastSuccessAt: agoMs(5 * DAY) }, 'stale'],
      [{ lastStatus: 'saved', lastSuccessAt: agoMs(2 * HOUR) }, 'install-locked-only'],
    ] as Array<[BackupHealth, string]>) {
      const a = assessBackupHealth(h, NOW);
      expect(a.level).toBe(level);
      expect(a.ageMs, `${level}: age carried`).toBeGreaterThan(0);
    }
  });

  it('carries the stored failure cause as a field, and omits it when absent', () => {
    const withCause = assessBackupHealth(
      { lastStatus: 'error', lastError: 'disk full', lastAttemptAt: agoMs(MIN) }, NOW,
    );
    expect(withCause.cause).toBe('disk full');
    const withoutCause = assessBackupHealth({ lastStatus: 'error', lastAttemptAt: agoMs(MIN) }, NOW);
    expect(withoutCause.cause).toBeUndefined();
    expect(withoutCause.message).not.toContain('()');
  });

  it('leaves the age field unset when there is no successful backup to age', () => {
    expect(assessBackupHealth({}, NOW).ageMs).toBeUndefined();
  });
});

// W78: a daily automatic backup is sealed to the install that wrote it, so a
// parent holding nothing else is one uninstall away from losing the record.
// That state used to render green ("Last backed up 2 hours ago.") which is the
// most expensive lie on this surface.
describe('assessBackupHealth — automatic copies only (no passphrase export ever)', () => {
  it('does NOT report OK when every copy is locked to this install', () => {
    const a = assessBackupHealth({ lastStatus: 'saved', lastSuccessAt: agoMs(2 * HOUR) }, NOW);
    expect(a.level).toBe('install-locked-only');
    expect(a.level).not.toBe('ok');
  });

  it('still shows the age, and names the one action that fixes it', () => {
    const a = assessBackupHealth({ lastStatus: 'saved', lastSuccessAt: agoMs(2 * HOUR) }, NOW);
    expect(a.message).toMatch(/2 hours ago/);
    expect(a.message).toMatch(/passphrase/i);
    expect(a.message).toMatch(/Back up now/);
  });

  it('clears to OK once a passphrase backup has ever been taken, however old', () => {
    const a = assessBackupHealth(
      { lastStatus: 'saved', lastSuccessAt: agoMs(HOUR), lastPassphraseBackupAt: agoMs(400 * DAY) },
      NOW,
    );
    expect(a.level).toBe('ok');
  });

  it('does not mask a harder failure: error still reads FAILING, absence still reads NEVER', () => {
    expect(assessBackupHealth({ lastStatus: 'error', lastError: 'disk full' }, NOW).level).toBe('failing');
    expect(assessBackupHealth({}, NOW).level).toBe('never');
  });

  it('does not mask staleness: an old-only automatic copy still reads STALE', () => {
    const a = assessBackupHealth({ lastStatus: 'saved', lastSuccessAt: agoMs(5 * DAY) }, NOW);
    expect(a.level).toBe('stale');
  });
});
