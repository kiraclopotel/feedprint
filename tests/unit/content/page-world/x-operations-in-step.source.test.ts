// The two copies of X's post-carrying operation names say the same thing.
//
// The page-world interceptor ships as its own bundle and runs in the page's JS realm before any
// content script can patch fetch, so it has zero imports on purpose: its own file header calls that
// CRITICAL. The wire parser needs the same fifteen operation names and does import, so the list is
// written out twice, and until now the only thing keeping the copies in step was a comment asking
// whoever edited one to remember the other (PLAN-2026-09-16 item 12.1).
//
// A comment cannot fail. This can. If a session widens one list and not the other, X's posts are
// either intercepted and not parsed, or parsed and never intercepted, and nothing says so.
import { describe, expect, it } from 'vitest';

import { readSource } from '../../../helpers/read-source';

const INTERCEPTOR = 'src/content/page-world/fetch-interceptor.ts';
const WIRE = 'src/content/platforms/wire/x.ts';

/** The string literals inside the bracketed list that follows an anchor, in the order written. */
function listAfter(source: string, anchor: RegExp): string[] {
  const at = source.search(anchor);
  expect(at, `anchor not found: ${anchor}`).toBeGreaterThan(-1);
  // The bracket that opens the list, matched as part of the assignment, so the one inside a type
  // like `readonly string[]` is not mistaken for it.
  const rest = source.slice(at);
  const open = rest.search(/(?:=|include:)\s*\[/);
  expect(open, 'a list follows the anchor').toBeGreaterThan(-1);
  const from = rest.indexOf('[', open);
  return [...rest.slice(from, rest.indexOf(']', from)).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('X post operations: one list, written twice', () => {
  it('the interceptor and the wire parser name the same operations, in the same order', () => {
    const interceptor = listAfter(readSource(INTERCEPTOR), /platform: 'twitter',\s*\n\s*include:/);
    const wire = listAfter(readSource(WIRE), /const X_POST_OPERATIONS/);

    expect(wire.length, 'the wire parser lists some operations').toBeGreaterThan(10);
    expect(interceptor).toEqual(wire);
  });

  it('the interceptor still has no imports, which is why the list is written twice', () => {
    const source = readSource(INTERCEPTOR);
    expect(source).toMatch(/^\/\/ CRITICAL: this file has ZERO imports\./m);
    expect(source).not.toMatch(/^import\s/m);
  });
});
