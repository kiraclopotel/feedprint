// A file exported before 2026-09-18 must still read VERIFIED (2026-09-18).
//
// On 18 September a tamper corpus measured what the checker actually refuses
// and found four single-place edits that survived a VERIFIED reading, all of
// them in text rendered on the page rather than inside a record. The cause was
// that the provenance digest covered seven of about eighteen rows, so a file
// could show a different signing key fingerprint than the key that signed it,
// and the sentence "It does not establish who made the file" could be turned
// into its opposite, and the checker would say nothing.
//
// The fix widened what the BUILDER marks, from seven rows to sixteen, and left
// the checker reading whatever set the file itself carries. That is the whole
// reason old files keep working: the checker does not look for a fixed list, it
// recomputes the digest over the rows that are marked in the file in front of
// it. Widening the checker instead would have refused every file already in
// somebody's hands, which for this product is the worst outcome available: the
// files are the evidence, they are held by other people, and they cannot be
// re-exported.
//
// Once the vectors were regenerated, no old-shape signed file was left anywhere
// in the tree, so that compatibility was proven once at one commit and then
// nothing held it. This fixture is a real export carrying the older seven rows,
// taken from the vector set as it stood before the change. It is never
// regenerated. If a later change to the digest, the reader or the canonical
// order breaks it, this is the test that says so, and the thing it is
// protecting is somebody else's copy of their own evidence.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURE = join(process.cwd(), 'tests/fixtures/export-shapes/older-provenance-coverage.html');
const CHECKER = join(process.cwd(), 'verifier/verify-export.mjs');

function check(path: string): Record<string, unknown> {
  let out: string;
  try {
    out = execFileSync(process.execPath, [CHECKER, path, '--json'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  } catch (err) {
    out = (err as { stdout: string }).stdout;
  }
  return JSON.parse(out) as Record<string, unknown>;
}

describe('an export written before the coverage widened', () => {
  it('still reads VERIFIED under the current checker', () => {
    const result = check(FIXTURE);
    expect(result.state, 'a file somebody already holds stopped verifying').toBe('verified');
    expect(result.manifest).toBe('ok');
    expect(result.records).toBe(3);
    expect(result.failures).toEqual([]);
  });

  it('carries the older, narrower set of marked rows, which is what makes it the right fixture', () => {
    const html = readFileSync(FIXTURE, 'utf8');
    const marked = html.match(/data-fw-prov=/g)?.length ?? 0;
    // Seven on a single-key export before the change, sixteen after. If this
    // fixture is ever regenerated it stops being evidence of anything, so the
    // count is pinned rather than left to drift.
    expect(marked, 'this fixture was regenerated and no longer carries the old shape').toBeLessThan(10);
    expect(marked).toBeGreaterThan(0);
  });

  it('a file built today carries the wider set, so the two really are different shapes', () => {
    const today = readFileSync(join(process.cwd(), 'verifier/vectors/01-verified.html'), 'utf8');
    const old = readFileSync(FIXTURE, 'utf8');
    const countIn = (s: string) => s.match(/data-fw-prov=/g)?.length ?? 0;
    expect(countIn(today)).toBeGreaterThan(countIn(old));
  });
});
