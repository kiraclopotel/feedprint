// A source-text scan, not an import: this checks the caller in
// src/content/post-path/result-apply.ts, and the file under test never runs here.
//
// 2026-09-20: the collapse/hide caller built `applied` from `appliedFor(kind, visualApplied)`,
// which folds a hide or collapse that did not land back to 'mark', but it did not tell
// decisionForJudge that the row's own action had not landed either. decisionForJudge could then
// only compare applied to the row's action, and a hide that stayed on the page (rank lower than
// the row's collapse) read the same as a hide that had gone further than the row asked. The fix
// adds a `landed` field the caller must fill from the same `visualApplied` boolean it already
// computed; this guard fails if that call ever drops the argument again.
import { describe, expect, it } from 'vitest';

import { readSource } from '../../../helpers/read-source';

const PATH = 'src/content/post-path/result-apply.ts';
const CALL_MARKER = 'decisionForJudge({';
const APPLIED_FOR_VISUAL = 'applied: appliedFor(kind, visualApplied)';
const LANDED_FIELD = /landed:\s*visualApplied\s*,/;

describe('the collapse/hide caller tells the judge record whether the intervention landed', () => {
  it('the decisionForJudge call whose applied is appliedFor(kind, visualApplied) also passes landed: visualApplied', () => {
    const source = readSource(PATH);

    const blocks: string[] = [];
    let at = source.indexOf(CALL_MARKER);
    while (at !== -1) {
      blocks.push(source.slice(at, at + 700));
      at = source.indexOf(CALL_MARKER, at + 1);
    }
    expect(blocks.length, `${PATH} calls decisionForJudge at least once; none were found`).toBeGreaterThan(0);

    const visualCalls = blocks.filter((b) => b.includes(APPLIED_FOR_VISUAL));
    expect(
      visualCalls.length,
      `expected exactly one decisionForJudge call built from ${APPLIED_FOR_VISUAL} in ${PATH}; `
      + 'found a different count, so this guard no longer matches the caller it was written for '
      + 'and needs to move with it',
    ).toBe(1);

    expect(
      visualCalls[0],
      'the collapse/hide decisionForJudge call must also pass landed: visualApplied, or a hide '
      + 'or collapse that did not land can be signed as though the legacy path had acted',
    ).toMatch(LANDED_FIELD);
  });
});
