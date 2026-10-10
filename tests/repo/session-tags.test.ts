// No new session tags in src comments (PLAN-2026-09-16 item 6.10).
//
// "turn 170", "tonight", "evening-9": a session numbering its own turns leaves the number in the
// code, and the next reader has no way to place it. A date does the same job for anyone. Twelve
// such comments were rewritten on 2026-09-16, each keeping what it measured and losing the tag.
//
// The two that remain are named below with the reason each is not a session tag. Anything else in a
// comment fails this test: write the date, or write what happened. Private: it reads private files
// only in the sense that it reads the whole source tree; it runs in the public copy too.
import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT as ROOT } from '../helpers/repo-root';
import { TREE_READ_TIMEOUT_MS } from '../helpers/spawn-timeout';

// Reads the whole tree or asks git, which outlasts the 5s default on a busy machine; see the helper.
vi.setConfig({ testTimeout: TREE_READ_TIMEOUT_MS });

const TAG = /\b(turn\s+\d+|tonight|evening-\d|just now|last night|this morning|earlier today|a moment ago)\b/i;
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;

/** Lines that read as a tag but are not one, each with why. */
const ALLOWED = new Set([
  // A lexicon comment: "ends tonight" is scarcity vocabulary the detector matches.
  'src/core/techniques/consumer-rapid-frame.ts',
  // "Enumerated a moment ago but gone now" describes the run, not a work session.
  'src/forensics/archive-reader.ts',
  // The flag file the frozen judge imports by path; no session edits it (PLAN section 2, rule 8).
  'src/storage/feature-flags.ts',
]);

// Git is asked and every source file read here, while vitest imports this file, because an import
// has no time limit and reading all of src can outlast the per-test limit on a busy machine.
const SOURCES = execFileSync('git', ['ls-files', 'src'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter((f) => /\.(ts|tsx)$/.test(f) && !ALLOWED.has(f))
  .map((f) => ({ file: f, text: readFileSync(join(ROOT, f), 'utf8') }));

describe('src comments carry dates, not session tags', () => {
  it('no comment names a turn, an evening or a tonight', () => {
    const hits: string[] = [];
    for (const { file: f, text } of SOURCES) {
      text.split('\n').forEach((line, i) => {
        if (COMMENT_LINE.test(line) && TAG.test(line)) hits.push(`${f}:${i + 1} ${line.trim().slice(0, 80)}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it('every allowed file is still in the tree, and still carries the line it was allowed for', () => {
    for (const f of ALLOWED) {
      const text = readFileSync(join(ROOT, f), 'utf8');
      const hit = text.split('\n').some((line) => COMMENT_LINE.test(line) && TAG.test(line));
      expect(hit, `${f} no longer needs its exception`).toBe(true);
    }
  });
});
