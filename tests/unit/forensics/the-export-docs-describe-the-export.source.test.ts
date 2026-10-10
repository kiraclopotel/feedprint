// The export's own documentation and the checker's README have to say what the code and the
// published vectors do. The README is held against EXPECTED.json rather than against prose, so the
// vectors and its sentence cannot drift apart.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../../helpers/repo-root';
import { readSource } from '../../helpers/read-source';

const expected = (): Record<string, { state: string; unverified: Record<string, number>; redacted: number }> =>
  JSON.parse(readFileSync(join(REPO_ROOT, 'verifier/vectors/EXPECTED.json'), 'utf8'));

describe('the export docs describe the export (2026-09-19)', () => {
  it('a withheld record with no signature is not read like an ordinary unsigned one', () => {
    // The fact the README got wrong, stated as a measurement of the published
    // vectors rather than as a claim about intent.
    const e = expected();
    expect(e['20-withheld-unsigned.html'].state, 'withheld and unsigned').toBe('verified');
    expect(e['20-withheld-unsigned.html'].unverified.unsigned).toBe(0);
    expect(e['13-unsigned-record.html'].state, 'an ordinary unsigned record').toBe('partial');
    expect(e['13-unsigned-record.html'].unverified.unsigned).toBe(1);
    // And 20 reads exactly like 05, the plain withheld record.
    expect(e['20-withheld-unsigned.html'].state).toBe(e['05-withheld-record.html'].state);
    expect(e['20-withheld-unsigned.html'].redacted).toBe(e['05-withheld-record.html'].redacted);
  });

  it('the README no longer says those two readings are the same', () => {
    const readme = readSource('verifier/README.md');
    expect(readme).not.toContain('the same reading an unsigned ordinary record gets');
    expect(readme, 'and it says which vector to compare against').toContain('Compare 20 against 05');
  });

  it('the note about what is not measured is listed as signed, because it is', () => {
    const src = readSource('src/forensics/html-export.ts');
    expect(src, 'the builder marks it').toContain('data-fw-prov="notMeasure"');
    expect(src, 'and the rule paragraph no longer calls it unattributed')
      .not.toContain('not measure" note are not attributed');
  });
});
