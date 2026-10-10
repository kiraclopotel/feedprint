// Read a source file for a test that scans its text (PLAN-2026-09-16 item 7.2).
//
// A source-text test is only as good as the file it read. Two ways it can pass while checking
// nothing:
//
//   1. The file moved or was renamed, the read threw, and the test caught it (or the scan ran over
//      an empty string). readSource throws loudly instead.
//   2. The file was split, and what is left at the old path is a one-line re-export. Every
//      "this string must appear" test then passes trivially against a file with no content, which
//      is exactly what wave 10 of this plan does to html-export.ts and the string tables.
//      readSource refuses a file that is only re-exports, and refuses one under a floor size, so a
//      split has to point its tests at the file that now holds the text.
//
// The caller can raise the floor when it knows the file is large: readSource(path, { minBytes }).

import { readFileSync } from 'node:fs';
import { repoPath } from './repo-root';

/** Below this, a file is too small to be the subject of a source scan. */
const DEFAULT_MIN_BYTES = 400;

/**
 * True when a file is nothing but comments, imports and re-exports.
 *
 * Line by line on purpose. The first version was one regular expression with a repeated group, and
 * on a 200 KB file it backtracked until the test worker died (found while splitting html-export.ts,
 * PLAN-2026-09-16 item 10.1). A scan is linear, and it reads plainly.
 */
function isReExportOnly(text: string): boolean {
  let inBlockComment = false;
  let sawSomething = false;
  for (const raw of text.split('\n')) {
    let line = raw.trim();
    if (inBlockComment) {
      const end = line.indexOf('*/');
      if (end === -1) continue;
      inBlockComment = false;
      line = line.slice(end + 2).trim();
    }
    if (line === '' || line.startsWith('//')) continue;
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlockComment = true;
      continue;
    }
    sawSomething = true;
    const isPassThrough =
      /^import\s/.test(line)
      || /^export\s+(type\s+)?\*/.test(line)
      || /^export\s+(type\s+)?\{/.test(line)
      || /^\}\s+from\s+'[^']+';$/.test(line)
      || /^[A-Za-z_$][\w$]*,?$/.test(line);
    if (!isPassThrough) return false;
  }
  return sawSomething;
}

export interface ReadSourceOptions {
  /** Refuse a file smaller than this. Default 400 bytes. */
  minBytes?: number;
}

/**
 * The text of a repository file, with the two silent-pass modes refused. `path` is relative to the
 * repository root, in posix form: readSource('src/forensics/html-export.ts').
 */
export function readSource(path: string, options: ReadSourceOptions = {}): string {
  const minBytes = options.minBytes ?? DEFAULT_MIN_BYTES;
  const text = readFileSync(repoPath(...path.split('/')), 'utf8');
  if (text.length < minBytes) {
    throw new Error(
      `${path} is ${text.length} bytes, under the ${minBytes}-byte floor for a source scan: `
      + 'the file this test reads has been emptied, split or renamed, so the scan below would pass '
      + 'against nothing. Point the test at the file that now holds the text.',
    );
  }
  if (isReExportOnly(text)) {
    throw new Error(
      `${path} is only imports and re-exports, so a text scan of it checks nothing. `
      + 'Point the test at the file that now holds the text.',
    );
  }
  return text;
}
