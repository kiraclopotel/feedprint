// A word a person reads is a word in the string tables, or it is English for
// everybody.
//
// On 18 September an accessibility audit moved two strings out of CSS
// `content:` rules, where they could never be translated, into the DOM so a
// screen reader could reach them. It left a TODO in each place saying which key
// to add and which file to add it to, and the TODO was the whole of the fix
// that did not land. For the next day a Romanian or Spanish dashboard printed
// "· frequent" beside a handle and "you disputed this" across a card, in
// English, in the middle of its own sentences.
//
// Nothing caught it. The string tables themselves are well defended: all four
// languages answer one interface, so a key missing from one of them is a
// compile error rather than a blank on screen. That defence only covers words
// that made it into the tables. A literal written straight into a component has
// not entered the system the interface guards, so the interface never sees it.
//
// This guard is the narrow, enforceable half of that: no deferred translation
// under the two surfaces a person reads. A key takes two minutes to add, which
// is less time than writing the TODO took. If a word genuinely must not be
// translated, say so in the marker and say why: a handle, a product name, a
// unit, a language's own endonym in the picker.
//
// What this does NOT do, said plainly so nobody reads more into a green run
// than it earns: it does not find an English literal written directly into a
// component with no TODO above it. Recognising prose in JSX without drowning in
// false positives is a real piece of work and is not done here. This catches
// the shape that actually happened, which is the one that was announced in a
// comment and then forgotten.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT as ROOT } from '../helpers/repo-root';

/** The marker that says a word is not translated yet. */
const DEFERRED = /TODO\s*\(\s*i18n\s*\)/i;
/** An intentional, permanent exemption states its reason on the same line. */
const NEVER_TRANSLATED = /NOT-TRANSLATED:\s*\S+/;

function surfaceFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z', 'src/ui', 'src/i18n'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((p) => p.endsWith('.ts') || p.endsWith('.tsx'));
}

describe('every word on a surface is in the tables (2026-09-19)', () => {
  const files = surfaceFiles();

  it('actually read the surfaces', () => {
    expect(files.length, 'src/ui plus src/i18n').toBeGreaterThan(60);
  });

  it('leaves no translation deferred where a person can read it', () => {
    const open: string[] = [];
    for (const rel of files) {
      const lines = readFileSync(join(ROOT, rel), 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        if (!DEFERRED.test(line)) return;
        if (NEVER_TRANSLATED.test(line)) return;
        open.push(`  ${rel}:${i + 1}\n    ${line.trim()}`);
      });
    }
    expect(
      open,
      open.length === 0 ? '' :
        `${open.length} word(s) waiting to be translated on a surface a person reads:\n` +
        `${open.join('\n')}\n\n` +
        'Add the key to src/i18n/dashboard/ or src/i18n/popup/ in all four languages, which the' +
        ' interface in types.ts will then hold for you, and use it. If the word must never be' +
        ' translated, replace the marker with "NOT-TRANSLATED: <reason>".',
    ).toEqual([]);
  });

  it('holds the four tables to the same shape, which is what makes the rest safe', () => {
    // Not a new rule: a restatement of the one the interfaces already enforce,
    // here so a green run says what it covered rather than only that it passed.
    for (const surface of ['dashboard', 'popup']) {
      for (const lang of ['en', 'ro', 'es', 'pt-br']) {
        const rel = `src/i18n/${surface}/${lang}.ts`;
        expect(files, `${rel} is one of the files typed against types.ts`).toContain(rel);
      }
    }
  });
});
