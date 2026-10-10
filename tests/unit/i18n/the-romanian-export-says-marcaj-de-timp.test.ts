// The Romanian export and checker use the site's pair (the head, 9 Oct 2026): "marcaj de timp" for the signed stamp,
// "marcare a timpului" for the act and the services. "Amprentă" stays where it means a fingerprint (of a key, of a
// file), never for a time stamp. The walk reads every string at any depth (objects, lists, and what a function returns
// for a placeholder argument), so a nested table cannot hide one.

import { describe, expect, it } from 'vitest';
import { I18N, TECHNIQUE_OVERLAY } from '../../../src/i18n/export-strings';
import { VERIFIER_WORDS } from '../../../src/forensics/verifier-words';

function strings(value: unknown, path: string, out: Array<[string, string]>): Array<[string, string]> {
  if (typeof value === 'string') out.push([path, value]);
  else if (typeof value === 'function') strings((value as (...a: unknown[]) => unknown)('{x}', '{y}', '{z}'), `${path}()`, out);
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) strings(v, path ? `${path}.${k}` : k, out);
  return out;
}

const TABLES: Array<[string, unknown]> = [
  ['the export', I18N.ro],
  ['the technique names', TECHNIQUE_OVERLAY.ro],
  ['the checker', VERIFIER_WORDS.ro],
];

describe('the Romanian export and checker', () => {
  it.each(TABLES)('%s never calls a time stamp an "amprentă de timp", at any depth', (_name, table) => {
    const all = strings(table, '', []);
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter(([, v]) => /amprent\S* de timp/i.test(v)).map(([k]) => k)).toEqual([]);
  });

  it('the walk reaches nested strings', () => {
    expect(strings({ a: { b: ['amprentă de timp'] } }, '', [])).toEqual([['a.b[0]', 'amprentă de timp']]);
  });

  const RO = I18N.ro as unknown as Record<string, unknown>;
  it.each([
    ['anchorCheckFailed', 'Acest marcaj de timp nu a trecut verificarea'],
    ['keyGenesisIntro', 'Aceste marcaje de timp au fost luate asupra cheii'],
    ['keyGenesisNone', 'niciun marcaj de timp asupra cheii de semnare'],
  ])('%s says "marcaj de timp", agreed as a neuter noun', (key, phrase) => {
    expect(RO[key]).toContain(phrase);
  });
});
