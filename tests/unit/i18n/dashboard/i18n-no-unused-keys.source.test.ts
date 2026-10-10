// Every string key is read by something (PLAN-2026-09-16 item 6.3).
//
// A removed panel leaves its words behind: nine keys survived UI that was taken out months
// earlier, in four languages each, which is 45 lines of text a translator would keep in step with
// nothing. They also read as a promise: a key called pinRequiredTitle says the product asks for a
// PIN somewhere it no longer does.
//
// This test scans the two string tables' interfaces and requires every key to be named somewhere in
// src outside i18n/. Keys reached through a computed name cannot be seen that way, so each one is
// listed below with the code that builds its name.
import { describe, expect, it } from 'vitest';
import { readSource } from '../../../helpers/read-source';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT as ROOT } from '../../../helpers/repo-root';

// Each surface declares its keys in one interface file and answers it once per language
// (PLAN-2026-09-16 item 10.2). The interface is where the keys are read from; the language files
// are where they are written, so neither counts as a reader.
const SURFACES = [
  { keys: 'src/i18n/dashboard/types.ts', languages: 'src/i18n/dashboard/' },
  { keys: 'src/i18n/popup/types.ts', languages: 'src/i18n/popup/' },
];
const DECLARING = (f: string): boolean =>
  SURFACES.some((s) => f === s.keys || f.startsWith(s.languages));

/** Keys whose name is built at run time, with where. */
const COMPUTED: Record<string, string> = {
  // The export's string table spreads these whole maps into the exported page's bundle.
  feedDecisionAction: 'src/i18n/export-strings.ts spreads it per action',
};

function sourceFiles(): string[] {
  // Tracked files plus files not yet added, because a reader written a minute ago counts. Reading
  // only the tracked list made this test fail on a file that existed and named the key.
  return execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', 'src'],
    { cwd: ROOT, encoding: 'utf8' },
  )
    .split('\n')
    // Everything but the files that declare the keys. i18n/ is not skipped as a whole: the export's
    // own string table moved into it (PLAN-2026-09-16 item 10.1), and a key only the export reads
    // would then have looked unused, so this guard would have told a session to delete a word the
    // exported page prints.
    .filter((f) => /\.(ts|tsx)$/.test(f) && !DECLARING(f));
}

function interfaceKeys(table: string): string[] {
  const text = readSource(table);
  const start = text.indexOf('export interface');
  const keys = new Set<string>();
  for (const m of text.slice(start).matchAll(/^ {2}(\w+)\??:/gm)) keys.add(m[1]);
  return [...keys];
}

describe('string tables carry no key nothing reads', () => {
  // A plain read for the sweep: readSource refuses a file that is only re-exports, and some
  // source files legitimately are. It is for the file a test is about, not for a sweep.
  const texts = sourceFiles().map((f) => readFileSync(join(ROOT, f), 'utf8'));

  for (const { keys: table } of SURFACES) {
    // Timed on these cases: trying every key's pattern on every source file takes up to two seconds
    // alone and over five beside other test runs, so each table gets 30 seconds, not the default 5.
    it(`${table}: every key is read somewhere in src`, () => {
      const unused = interfaceKeys(table).filter((key) => {
        if (key in COMPUTED) return false;
        const re = new RegExp(`\\bt\\.${key}\\b|['"\`]${key}['"\`]|\\.${key}\\b`);
        return !texts.some((t) => re.test(t));
      });
      expect(unused).toEqual([]);
    }, 30_000);
  }

  it('the computed-name list holds only keys the tables still carry', () => {
    const all = new Set(SURFACES.flatMap((s) => interfaceKeys(s.keys)));
    expect(Object.keys(COMPUTED).filter((k) => !all.has(k))).toEqual([]);
  });
});
