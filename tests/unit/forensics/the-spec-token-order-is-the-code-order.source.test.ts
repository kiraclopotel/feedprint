// FORMAT.md's manifest-token table is normative, and nothing held it to the
// code, so it drifted.
//
// The table is introduced with "One token, the first check that fails, in this
// order", and it exists so a lab, a court expert or an NGO can build its own
// checker without trusting ours. On 2026-09-19 the reference moved the
// manifest's own `digest` and its signature ABOVE the bare-envelope early
// return, because every digest below them is computed from the file's own data
// and so recomputes for anyone who edited the file and recomputed: the
// signature is the only thing binding the manifest to the key that signed it.
// Skipping it made "remove some records and recompute" a clean pass on a bare
// JSON envelope, which is an input form this very document tells implementers
// to accept.
//
// The table was not moved with it. A second implementer building from the
// table returns `no-rows` and never reaches the signature at all, reproducing
// the hole on the day it was closed here. Found 2026-09-19 by a read of the
// export and the checker against their spec.
//
// This reads the order out of both sides and compares them, so the next change
// to `checkManifest` fails here until the table follows it. It is a source
// read on both sides, which is what the name says.

import { describe, expect, it } from 'vitest';
import { readSource } from '../../helpers/read-source';

/** The tokens `checkManifest` can return, in the order its returns appear. */
function codeOrder(): string[] {
  const src = readSource('src/forensics/verifier-core-source.ts');
  const from = src.indexOf('async function checkManifest(');
  expect(from, 'checkManifest is where this expects it').toBeGreaterThan(0);
  // The function ends at the return of the all-clear token.
  const end = src.indexOf("return 'ok';", from);
  expect(end, 'checkManifest ends on its all-clear').toBeGreaterThan(from);
  const body = src.slice(from, end);
  const seen: string[] = [];
  for (const m of body.matchAll(/return '([a-z-]+)';/g)) {
    if (!seen.includes(m[1])) seen.push(m[1]);
  }
  return [...seen, 'ok'];
}

/** The tokens FORMAT.md's normative table lists, in the order it lists them. */
function specOrder(): string[] {
  const doc = readSource('verifier/FORMAT.md');
  const head = doc.indexOf('One token, the first check that fails, in this order.');
  expect(head, 'the normative table is where this expects it').toBeGreaterThan(0);
  const table = doc.slice(head, doc.indexOf('\n\n', doc.indexOf('| `ok`', head)));
  const rows: string[] = [];
  for (const m of table.matchAll(/^\| `([a-z-]+)` +\| /gm)) rows.push(m[1]);
  return rows;
}

describe('the spec token order is the code order (2026-09-19)', () => {
  it('both sides name the same tokens', () => {
    expect([...specOrder()].sort()).toEqual([...codeOrder()].sort());
  });

  it('and name them in the same order', () => {
    expect(specOrder()).toEqual(codeOrder());
  });

  it('the signature is checked before a bare envelope may decline the row read', () => {
    // The point of the 2026-09-19 move, stated as its own case so that a future
    // reorder that keeps both sides agreeing but restores the hole still fails.
    const order = codeOrder();
    expect(order.indexOf('signature'), 'signature is checked').toBeGreaterThanOrEqual(0);
    expect(order.indexOf('signature')).toBeLessThan(order.indexOf('no-rows'));
    expect(order.indexOf('digest')).toBeLessThan(order.indexOf('no-rows'));
  });

  it('the spec says why that order matters, not only what it is', () => {
    // A table a reader can reorder without noticing is a table that drifts.
    // The prose wraps, so match a phrase that sits on one line of it.
    const doc = readSource('verifier/FORMAT.md');
    expect(doc).toContain('reaches the signature at all');
  });
});
