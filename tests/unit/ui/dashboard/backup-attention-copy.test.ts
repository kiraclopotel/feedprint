// @vitest-environment jsdom
// A copy that has not run yet is not a copy that failed.
//
// The backup assessment has told the two states apart since it was written:
// 'failing' is an automatic copy that was attempted and errored, 'never' is one
// that has not run yet. The attention card on the dashboard's first screen used
// the failing words for both, so a fresh install opened by announcing "The
// automatic backup is not working" when the daily copy simply had not come
// round yet (seen 2026-09-17 on a fresh probe profile). A household told that
// something is broken when it is not learns to discount the next warning.

import { describe, expect, it } from 'vitest';
import { backupAttentionCopy } from '../../../../src/ui/dashboard/Dashboard';
import { DASHBOARD_STRINGS } from '../../../../src/i18n/dashboard-strings';

const LANGS = ['en', 'ro', 'es', 'pt-BR'] as const;

describe('the backup attention card', () => {
  it.each(LANGS)('%s: says nothing has been saved yet, not that something failed', lang => {
    const t = DASHBOARD_STRINGS[lang];
    const never = backupAttentionCopy('never', t);
    const failing = backupAttentionCopy('failing', t);

    expect(never.title).toBe(t.attnBackupNeverTitle);
    expect(never.body).toBe(t.attnBackupNeverBody);
    expect(failing.title).toBe(t.attnBackupFailingTitle);
    expect(failing.body).toBe(t.attnBackupFailingBody);
    // The two cards must not be the same card. The defect was that they were.
    expect(never.title).not.toBe(failing.title);
    expect(never.body).not.toBe(failing.body);
  });

  it.each(LANGS)('%s: the "no copy yet" card names the Export tab, where the copy is saved', lang => {
    const t = DASHBOARD_STRINGS[lang];
    expect(t.attnBackupNeverBody).toContain(t.tabExport);
  });

  it.each(LANGS)('%s: both cards carry words, in that language', lang => {
    const t = DASHBOARD_STRINGS[lang];
    for (const level of ['never', 'failing'] as const) {
      const { title, body } = backupAttentionCopy(level, t);
      expect(title.trim().length).toBeGreaterThan(10);
      expect(body.trim().length).toBeGreaterThan(30);
    }
    // And the never copy is this language's own, not English standing in for it.
    if (lang !== 'en') {
      expect(t.attnBackupNeverTitle).not.toBe(DASHBOARD_STRINGS.en.attnBackupNeverTitle);
      expect(t.attnBackupNeverBody).not.toBe(DASHBOARD_STRINGS.en.attnBackupNeverBody);
    }
  });
});
