// The word a reader sees on an export, by kind of file. Three texts once said a report reads "PARTIALLY VERIFIED" by
// design, while the checker reads a report that states its selection under its signature as "VERIFIED as a report".
// Every text that tells a person which word to expect is written from these rows, so the rows are the words the
// committed checker prints, not its internal states (verifier-vectors.test.ts holds those).
import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { SPAWN_TIMEOUT_MS } from '../helpers/spawn-timeout';
import { VECTORS_DIR } from '../../scripts/build-verifier-vectors';
import { STANDALONE_VERIFIER_PATH } from '../../scripts/build-standalone-verifier';

vi.setConfig({ testTimeout: SPAWN_TIMEOUT_MS });

function read(file: string): { out: string; code: number } {
  try {
    return { out: execFileSync(process.execPath, [STANDALONE_VERIFIER_PATH, file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }), code: 0 };
  } catch (err) {
    const e = err as { stdout: string; status: number };
    return { out: e.stdout, code: e.status };
  }
}

const vector = (name: string) => join(VECTORS_DIR, name);

describe('the word an export reads', () => {
  it('a report that states under its signature how many records it left out reads VERIFIED as a report', () => {
    const { out, code } = read(vector('10-report-selection.html'));
    expect(out).toContain('VERIFIED as a report of 2 of 3 records');
    expect(out).not.toContain('PARTIALLY VERIFIED');
    expect(code).toBe(0);
  });

  // A whole record with the AI reading off reads the same (the checker never reads a verdict); the site's 320-record
  // example holds that case, in tests/private/site/example-export-verifies.test.ts, since the public copy lacks it.
  it('a whole record reads VERIFIED', () => {
    for (const file of [vector('01-verified.html')]) {
      const { out, code } = read(file);
      expect(out, file).toMatch(/\bVERIFIED: \d+ record/);
      expect(out, file).not.toContain('PARTIALLY VERIFIED');
      expect(code, file).toBe(0);
    }
  });

  it('a whole record across a month boundary reads VERIFIED when the marker names a record the file holds', () => {
    const { out, code } = read(vector('21-month-rotation-linked.html'));
    expect(out).not.toContain('PARTIALLY VERIFIED');
    expect(code).toBe(0);
  });

  it.each([
    ['an older file with no signed manifest', '02-no-manifest.html'],
    ['a record signed by a key the file does not carry', '07-prior-key-missing.html'],
    ['an unsigned record', '13-unsigned-record.html'],
    ['a month marker naming a record not in the file', '22-month-rotation-unlinked.html'],
    ['a month marker naming a middle record', '23-month-rotation-names-a-middle-record.html'],
    ['an unsigned month marker', '24-month-rotation-marker-unsigned.html'],
  ])('%s reads PARTIALLY VERIFIED', (_why, name) => {
    const { out, code } = read(vector(name));
    expect(out).toContain('PARTIALLY VERIFIED');
    expect(code).toBe(1);
  });

  it.each([
    ['an edited record', '03-record-edited.html'],
    ['an edited manifest', '04-manifest-edited.html'],
    ['a forged signature', '12-forged-signature.html'],
  ])('%s reads neither word: the check fails', (_why, name) => {
    const { out, code } = read(vector(name));
    expect(out).not.toMatch(/\bVERIFIED\b(?! as)/);
    expect(code).toBe(2);
  });

  // The exporter writes every time stamp into a report (src/forensics/exporter.ts), and a stamp over a record the
  // report left out reads PARTIALLY VERIFIED whatever the selection says. No vector holds such a report yet; one
  // built by the product's own export button settles which word real reports read.
  it.todo('a report with a time stamp over a record it left out reads PARTIALLY VERIFIED');
});
