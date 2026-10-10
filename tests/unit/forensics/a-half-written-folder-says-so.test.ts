// The folder mirror said "written" when the file a restore reads was not.
//
// mirrorBackupToWiredFolder writes three things: a dated copy, a fixed-name
// newest copy, and the key that opens every copy in the folder. Its own comment
// says what the last two are for: "a reinstall or another computer restores
// from the folder alone, no passphrase, no PIN."
//
// It returned 'written' as soon as the DATED copy landed, after printing a
// warning naming this exact case, and then stamped both its head and its
// timestamp regardless.
//
// Three things followed. The parent read "Backup written to the folder." The
// one file a restore-from-folder reads by fixed name could be stale, or the key
// could be missing, which is the whole of what the folder is for. And the
// stamped timestamp told autoBackupToDownloads to stand down for 48 hours, so
// the fallback was suppressed on the strength of a write that had half failed.
//
// This file pins the shape of the fix rather than driving the File System
// Access API, which needs a real directory handle and a user gesture: what
// changed is which outcome is returned and which stamps are skipped, and both
// are readable in the source. The behaviour that can be driven, the 48-hour
// stand-down, is driven.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT as ROOT } from '../../helpers/repo-root';
import { folderMirrorCoversDownloads } from '../../../src/forensics/backup';

const SRC = readFileSync(join(ROOT, 'src/forensics/backup.ts'), 'utf8');

/** The mirror function's body, so a match elsewhere in the file cannot pass. */
const mirrorBody = (() => {
  const i = SRC.indexOf('export async function mirrorBackupToWiredFolder');
  expect(i, 'the mirror is still declared').toBeGreaterThan(-1);
  const j = SRC.indexOf('\n}', i);
  return SRC.slice(i, j);
})();

describe('a half-written folder says so (2026-09-19)', () => {
  it('has a word for the case where the dated copy landed alone', () => {
    expect(SRC, 'the outcome union carries it').toContain("| 'written-without-latest'");
    expect(mirrorBody, 'and the mirror returns it').toContain("return 'written-without-latest';");
  });

  it('returns before the stamps, so neither is written on a half failure', () => {
    const at = mirrorBody.indexOf("return 'written-without-latest';");
    const stamps = mirrorBody.indexOf('LAST_FOLDER_MIRROR_AT_KEY');
    expect(at).toBeGreaterThan(-1);
    expect(stamps).toBeGreaterThan(-1);
    expect(at, 'the early return comes first').toBeLessThan(stamps);
  });

  it('still returns written when all three land', () => {
    expect(mirrorBody).toContain("return 'written';");
  });

  it('the stand-down it used to trigger is a real 48 hours', () => {
    // Why skipping the timestamp matters: the Downloads fallback reads it and
    // stops running. This is the behaviour that was being switched off on the
    // strength of a write that had half failed.
    const now = Date.parse('2026-09-19T12:00:00.000Z');
    const oneHourAgo = new Date(now - 3_600_000).toISOString();
    const threeDaysAgo = new Date(now - 3 * 86_400_000).toISOString();

    expect(folderMirrorCoversDownloads(oneHourAgo, now), 'recent mirror suppresses Downloads').toBe(true);
    expect(folderMirrorCoversDownloads(threeDaysAgo, now), 'an old one does not').toBe(false);
    expect(folderMirrorCoversDownloads(undefined, now), 'and no mirror never does').toBe(false);
  });

  it('a clock that jumped forward is not a fresh backup', () => {
    // Already true before this change; asserted here because the fix leans on
    // this function being the only thing standing between a half-written folder
    // and a suppressed fallback.
    const now = Date.parse('2026-09-19T12:00:00.000Z');
    const future = new Date(now + 86_400_000).toISOString();
    expect(folderMirrorCoversDownloads(future, now)).toBe(false);
  });

  it('the parent is told, in every language', () => {
    for (const lang of ['en', 'ro', 'es', 'pt-br']) {
      const table = readFileSync(join(ROOT, `src/i18n/dashboard/${lang}.ts`), 'utf8');
      expect(table, `${lang} has the sentence`).toContain('folderWirePartial:');
    }
    const ui = readFileSync(join(ROOT, 'src/ui/dashboard/components/ExportTab.tsx'), 'utf8');
    expect(ui, 'and the tab shows it rather than the success line')
      .toContain("r === 'written-without-latest'");
  });
});
