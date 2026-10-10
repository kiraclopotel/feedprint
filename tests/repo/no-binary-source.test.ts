// No source file holds a raw NUL byte (PLAN-2026-09-16 item 6.6).
//
// One did, as a string separator, and the cost was silence: ripgrep treats a file containing a NUL
// as binary and skips it without printing a word, so every sweep of src for a pattern read clean
// while never having opened that file. A clean sweep is only a finding when the tool looked.
// The byte is fine written as a unicode escape; the rule is that it must not sit in the file raw.
// (This comment carried the escape itself at first, and the tool that wrote the file turned it
// into the byte, which failed this test on its own first run.)
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT as ROOT } from '../helpers/repo-root';

function trackedText(dir: string): string[] {
  return execFileSync('git', ['ls-files', dir], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.(ts|tsx|mjs|js|css|html|json|md)$/.test(f));
}

/**
 * Tab, newline and carriage return. Every other byte below 32 is a control
 * character that no source file has a reason to hold raw.
 */
const ALLOWED = new Set([9, 10, 13]);

/** The folders a session may not open. Named here so this sweep skips them. */
const GUARDED = ['store/', 'corpus/', 'past-forensics/', 'scratch/', 'release/'];

function controlBytesIn(raw: Buffer): number[] {
  const found = new Set<number>();
  for (const b of raw) if (b < 32 && !ALLOWED.has(b)) found.add(b);
  return [...found].sort((a, b) => a - b);
}

// Every file is read from disk once, here, while vitest imports this file, and vitest puts no time
// limit on an import, so a disk slowed by the rest of the suite cannot time a case out. Both cases
// then only scan the same bytes in memory, well inside the default per-test limit.
const SWEEP_FILES = [
  ...trackedText('src'), ...trackedText('tests'),
  ...trackedText('scripts'), ...trackedText('docs'),
].filter((f) => !GUARDED.some((g) => f.startsWith(g)));
const SWEEP_CONTENTS = new Map(SWEEP_FILES.map((f) => [f, readFileSync(join(ROOT, f))]));

describe('source files stay text', () => {
  it('no tracked source or test file carries a raw NUL byte', () => {
    const withNul = SWEEP_FILES.filter(
      (f) => (f.startsWith('src/') || f.startsWith('tests/')) && SWEEP_CONTENTS.get(f)!.includes(0),
    );
    expect(withNul).toEqual([]);
  });

  // Widened 2026-09-18, after a sweep found four MORE eaten escapes in tracked
  // text, all of them written through a shell that halves a backslash:
  //
  //   scripts/walk/walk.mjs   /(?=\d{3}\b)/ became /(?=\d{3}<BS>)/, so the
  //                           board's thousands-separator strip could never
  //                           match and "3,278" was read back as 3. The board
  //                           then compared that number against itself and
  //                           reported the step green.
  //   docs/spec/known-issues  the M171 entry, which is ABOUT word boundaries,
  //                           lost the word boundary it was describing.
  //   docs/STATE-LOG.md       a Windows path: \feelingwise-verifier became a
  //                           form feed, so the history names no directory.
  //   two archive documents   raw NULs, which is the byte that makes ripgrep
  //                           skip a file without a word.
  //
  // None of them is visible in an editor, and three changed what the file
  // means. The escape is always fine; the raw byte is not.
  it('no tracked text file carries a raw control character', () => {
    // A green run over nothing proves nothing.
    expect(SWEEP_FILES.length).toBeGreaterThan(400);
    const bad = SWEEP_FILES
      .map((f) => ({ file: f, bytes: controlBytesIn(SWEEP_CONTENTS.get(f)!) }))
      .filter((x) => x.bytes.length > 0)
      .map((x) => `${x.file}: ${x.bytes.map((b) => `0x${b.toString(16).padStart(2, '0')}`).join(', ')}`);
    expect(
      bad,
      bad.length === 0 ? '' :
        `raw control bytes in tracked text:\n  ${bad.join('\n  ')}\n\n` +
        'Write the character as an escape instead. If a shell wrote this file, that is how it got' +
        ' there: a heredoc halves a backslash, so \\b becomes a backspace and \\f a form feed.',
    ).toEqual([]);
  });
});
