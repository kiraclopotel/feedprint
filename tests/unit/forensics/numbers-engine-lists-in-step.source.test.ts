// The numbers engine is written twice, and its three lists must say the same thing.
//
// src/forensics/export-numbers.ts is the module the dashboard uses. The exported HTML cannot
// import it: the export runs from inline scripts in the recipient's browser, so the same engine is
// restated as plain ES5 inside a template string in src/forensics/export-numbers-inline.ts. The
// duplication is required and stays.
//
// export-numbers-filters.test.ts already runs both copies over the same records and requires the
// same answers. That catches a rule that changed. It cannot catch a list that grew, because its
// fixtures are fixed: add a tenth marker kind to the module and not to the inline copy and every
// existing fixture still agrees, while the export quietly counts the new marker as something a
// person saw. Nine marker kinds are the difference between "20 impressions" and "21 impressions"
// on a document that goes to a lawyer.
//
// So the lists are compared as text, the way the two copies of X's post operations are
// (tests/unit/content/page-world/x-operations-in-step.source.test.ts). Found on 2026-09-16 while
// writing the held-over items of PLAN-2026-09-16 section 6 into OUTBOX/NEXT-UPDATE.md.
import { describe, expect, it } from 'vitest';

import { readSource } from '../../helpers/read-source';

const MODULE = 'src/forensics/export-numbers.ts';
const INLINE = 'src/forensics/export-numbers-inline.ts';

/**
 * The string literals of the array assigned to `name`, in the order written. The search starts at
 * the declaration and then at the `=`, so a `[` inside a type annotation (PLATFORM_ORDER's
 * `ReadonlyArray<ForensicRecord['platform']>`) is not mistaken for the opening bracket.
 */
function listOf(source: string, name: string): string[] {
  const at = source.search(new RegExp(`(?:const|var)\\s+${name}\\b`));
  expect(at, `${name} is declared`).toBeGreaterThan(-1);
  const rest = source.slice(at);
  const eq = rest.search(/=\s*\[/);
  expect(eq, `${name} is assigned a list`).toBeGreaterThan(-1);
  const from = rest.indexOf('[', eq);
  return [...rest.slice(from, rest.indexOf(']', from)).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('the numbers engine, written twice', () => {
  const module_ = readSource(MODULE);
  const inline = readSource(INLINE);

  it.each([
    ['SYSTEM_MARKER_KINDS', 9],
    ['PLATFORM_ORDER', 5],
    ['USER_RULE_LABELS', 6],
  ])('%s is the same list in both copies, in the same order', (name, count) => {
    const fromModule = listOf(module_, name);
    expect(fromModule.length, `${name} has its ${count} entries`).toBe(count);
    expect(listOf(inline, name)).toEqual(fromModule);
  });

  it('the sitting gap is the same number in both copies', () => {
    // Whitespace removed before comparing: the module is written `30 * 60 * 1000` and the inline
    // ES5 `30*60*1000`, which is the same half hour.
    const readGap = (source: string) =>
      /SITTING_GAP_MS\s*=\s*([0-9*\s]+)/.exec(source)?.[1].replace(/\s+/g, '');
    const fromModule = readGap(module_);
    expect(fromModule, 'the module states a sitting gap').toBeTruthy();
    expect(readGap(inline)).toBe(fromModule);
  });

  it('the inline copy still cannot import, which is why the lists are written twice', () => {
    // If this ever fails the duplication is no longer required and the lists should become one.
    const body = inline.slice(inline.indexOf('EXPORT_NUMBERS_INLINE_SOURCE'));
    expect(body).not.toMatch(/\bimport\s/);
    expect(body).toMatch(/var FWN=\(function\(\)\{/);
  });
});
