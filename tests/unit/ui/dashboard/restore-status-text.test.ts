// W82: the restore/backup path's parent-facing sentences.
//
// Before W82 only the two seal failures (W81) were localized; every other
// refusal on the restore path, the key notes, and the whole backup-health line
// rendered hardcoded English to a Romanian parent. backup.ts now types the
// cause and this module picks the sentence. Locks: every typed cause maps to a
// NON-EMPTY, DISTINCT string in BOTH languages (a missed key would silently
// render English or blank); the interpolated numbers reach the sentence; the
// key notes keep the leading space the success message concatenates; and an
// untyped cause still falls back to backup.ts's English.

import { describe, it, expect } from 'vitest';
import {
  restoreFailureText,
  restoreKeyNoteText,
  backupHealthText,
} from '../../../../src/ui/dashboard/restore-status-text';
import { DASHBOARD_STRINGS } from '../../../../src/i18n/dashboard-strings';
import type {
  BackupAssessment,
  RestoreFailureReason,
  RestoreKeyNoteReason,
} from '../../../../src/forensics/backup';

const LOCALES = ['en', 'ro'] as const;

const ALL_FAILURE_REASONS: RestoreFailureReason[] = [
  'device-key-missing',
  'device-key-mismatch',
  'not-json',
  'not-an-object',
  'missing-schema-version',
  'schema-too-new',
  'no-records-array',
  'seal-format-too-new',
  'passphrase-required',
  'passphrase-wrong',
  'structure-invalid',
  'delivery-pending',
  'safety-backup-failed',
];

const ALL_KEY_NOTE_REASONS: RestoreKeyNoteReason[] = [
  'key-no-records',
  'key-passphrase-needed',
  'key-identity-mismatch',
];

const ALL_LEVELS: BackupAssessment['level'][] = [
  'never', 'ok', 'stale', 'failing', 'install-locked-only',
];

const detail = { fileVersion: 9, supportedVersion: 1, pendingCount: 3, cause: 'link broken' };

describe('restoreFailureText', () => {
  it('maps every typed cause to a non-empty, distinct sentence in both languages', () => {
    for (const locale of LOCALES) {
      const t = DASHBOARD_STRINGS[locale];
      const seen = new Map<string, RestoreFailureReason>();
      for (const reason of ALL_FAILURE_REASONS) {
        const text = restoreFailureText(reason, detail, 'ENGLISH FALLBACK', t);
        expect(text.trim().length, `${locale}/${reason}: non-empty`).toBeGreaterThan(0);
        expect(text, `${locale}/${reason}: not the English fallback`).not.toContain('ENGLISH FALLBACK');
        const clash = seen.get(text);
        expect(clash, `${locale}: ${reason} and ${clash} render the same sentence`).toBeUndefined();
        seen.set(text, reason);
      }
    }
  });

  it('interpolates the numbers and technical causes into the sentence', () => {
    for (const locale of LOCALES) {
      const t = DASHBOARD_STRINGS[locale];
      expect(restoreFailureText('schema-too-new', detail, undefined, t)).toContain('9');
      expect(restoreFailureText('schema-too-new', detail, undefined, t)).toContain('1');
      expect(restoreFailureText('seal-format-too-new', detail, undefined, t)).toContain('9');
      expect(restoreFailureText('delivery-pending', detail, undefined, t)).toContain('3');
      expect(restoreFailureText('structure-invalid', detail, undefined, t)).toContain('link broken');
      expect(restoreFailureText('safety-backup-failed', detail, undefined, t)).toContain('link broken');
    }
  });

  it('keeps the W78 recovery route on both seal failures', () => {
    for (const locale of LOCALES) {
      const t = DASHBOARD_STRINGS[locale];
      for (const reason of ['device-key-missing', 'device-key-mismatch'] as const) {
        expect(restoreFailureText(reason, undefined, undefined, t))
          .toContain(t.restoreSealedRecoveryRoute);
      }
    }
  });

  it('falls back to the English error when the cause is untyped, then to restoreFailed', () => {
    for (const locale of LOCALES) {
      const t = DASHBOARD_STRINGS[locale];
      expect(restoreFailureText(undefined, undefined, 'a crypto module threw this', t))
        .toBe('a crypto module threw this');
      expect(restoreFailureText(undefined, undefined, undefined, t)).toBe(t.restoreFailed);
    }
  });
});

describe('restoreKeyNoteText', () => {
  it('maps every key note to a distinct sentence in both languages', () => {
    for (const locale of LOCALES) {
      const t = DASHBOARD_STRINGS[locale];
      const seen = new Set<string>();
      for (const reason of ALL_KEY_NOTE_REASONS) {
        const text = restoreKeyNoteText(reason, 'ENGLISH FALLBACK', t);
        expect(text.trim().length, `${locale}/${reason}: non-empty`).toBeGreaterThan(0);
        expect(text, `${locale}/${reason}: not the English fallback`).not.toContain('ENGLISH FALLBACK');
        expect(seen.has(text), `${locale}/${reason}: distinct`).toBe(false);
        seen.add(text);
      }
    }
  });

  // The success message concatenates this straight onto the restored-count
  // sentence, so a missing leading space runs two sentences together.
  it('keeps the leading space the success message concatenates', () => {
    for (const locale of LOCALES) {
      const t = DASHBOARD_STRINGS[locale];
      for (const reason of ALL_KEY_NOTE_REASONS) {
        expect(restoreKeyNoteText(reason, undefined, t).startsWith(' '), `${locale}/${reason}`).toBe(true);
      }
      expect(restoreKeyNoteText(undefined, 'thrown message', t)).toBe(' thrown message');
      expect(restoreKeyNoteText(undefined, undefined, t)).toBe('');
    }
  });
});

describe('backupHealthText', () => {
  it('maps every level to a non-empty, distinct line in both languages', () => {
    for (const locale of LOCALES) {
      const t = DASHBOARD_STRINGS[locale];
      const seen = new Set<string>();
      for (const level of ALL_LEVELS) {
        const text = backupHealthText(
          { level, message: 'ENGLISH FALLBACK', ageMs: 3 * 60 * 60 * 1000 }, t,
        );
        expect(text.trim().length, `${locale}/${level}: non-empty`).toBeGreaterThan(0);
        expect(text, `${locale}/${level}: not the English fallback`).not.toContain('ENGLISH FALLBACK');
        expect(seen.has(text), `${locale}/${level}: distinct`).toBe(false);
        seen.add(text);
      }
    }
  });

  it('carries the age into the three lines that report one', () => {
    for (const locale of LOCALES) {
      const t = DASHBOARD_STRINGS[locale];
      const age = t.relativeAge(3 * 24 * 60 * 60 * 1000);
      for (const level of ['ok', 'stale', 'install-locked-only'] as const) {
        expect(
          backupHealthText({ level, message: '', ageMs: 3 * 24 * 60 * 60 * 1000 }, t),
          `${locale}/${level}`,
        ).toContain(age);
      }
    }
  });

  it('names the stored failure cause when the automatic backup is failing', () => {
    for (const locale of LOCALES) {
      const t = DASHBOARD_STRINGS[locale];
      expect(backupHealthText({ level: 'failing', message: '', cause: 'disk full' }, t))
        .toContain('disk full');
      // No stored cause: the sentence still reads cleanly, with no empty parens.
      expect(backupHealthText({ level: 'failing', message: '' }, t)).not.toContain('()');
    }
  });
});

describe('relativeAge', () => {
  const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

  it('matches the English wording backup.ts falls back to', () => {
    const t = DASHBOARD_STRINGS.en;
    expect(t.relativeAge(5_000)).toBe('just now');
    expect(t.relativeAge(MIN)).toBe('1 minute ago');
    expect(t.relativeAge(3 * MIN)).toBe('3 minutes ago');
    expect(t.relativeAge(HOUR)).toBe('1 hour ago');
    expect(t.relativeAge(5 * HOUR)).toBe('5 hours ago');
    expect(t.relativeAge(DAY)).toBe('1 day ago');
    expect(t.relativeAge(4 * DAY)).toBe('4 days ago');
    expect(t.relativeAge(-1000)).toBe('just now');
  });

  // Romanian needs "de" above 19 (roPlural), which the English form has no
  // equivalent of; getting it wrong is the visible tell of a machine string.
  it('applies the Romanian plural rule, including the "de" form', () => {
    const t = DASHBOARD_STRINGS.ro;
    expect(t.relativeAge(5_000)).toBe('chiar acum');
    expect(t.relativeAge(MIN)).toBe('acum 1 minut');
    expect(t.relativeAge(3 * MIN)).toBe('acum 3 minute');
    expect(t.relativeAge(25 * MIN)).toBe('acum 25 de minute');
    expect(t.relativeAge(HOUR)).toBe('acum 1 oră');
    expect(t.relativeAge(5 * HOUR)).toBe('acum 5 ore');
    expect(t.relativeAge(DAY)).toBe('acum 1 zi');
    expect(t.relativeAge(4 * DAY)).toBe('acum 4 zile');
    expect(t.relativeAge(20 * DAY)).toBe('acum 20 de zile');
  });
});
