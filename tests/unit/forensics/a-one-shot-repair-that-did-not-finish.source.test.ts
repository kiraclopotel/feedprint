// The one-shot position repair stamped itself done without checking the write.
//
// repairRelegatedPositions recovers a chainPosition that a pre-2026-06-11 bug
// stripped, accepting a candidate only when recomputing the record's hash with
// it reproduces the already-stored integrityHash. That part is sound: it can
// restore self-consistency and can never fabricate content.
//
// What it did not do was look at what it asked for. rewriteRecordsInPlace
// returns the number of records its cursor actually updated, and that return
// was discarded. The heal log then reported recovered.size, the count computed
// as recoverable, and set healed from unrecoveredIds alone. A record pruned or
// evicted between the read and the write does not match the cursor, which is
// not an error, so the catch never fired.
//
// The stamp was written straight after, and the stamp is what makes this a
// one-shot: once set, the migration never runs again. So a record whose repair
// never landed kept its damaged position permanently, under a log line saying
// it had been healed.
//
// This reads the source rather than driving IndexedDB: what changed is which
// value is reported and whether the stamp is written, and both are one line
// each. Driving it would need a fake IDB whose cursor matches fewer records
// than it is given, which is worth building when somebody next touches this
// file, not at the cost of leaving it unheld tonight.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT as ROOT } from '../../helpers/repo-root';

const SRC = readFileSync(join(ROOT, 'src/forensics/auto-heal.ts'), 'utf8');

/** The repair function's body, so a match elsewhere in the file cannot pass. */
const body = (() => {
  const i = SRC.indexOf('export async function repairRelegatedPositions');
  expect(i, 'the repair is still declared').toBeGreaterThan(-1);
  return SRC.slice(i);
})();

describe('a one-shot repair that did not finish is not stamped (2026-09-19)', () => {
  it('keeps the count the write returned', () => {
    expect(body, 'the return is read, not discarded').toContain('written = await rewriteRecordsInPlace(');
    expect(body, 'and it is what the outcome reports').toContain('repairedCount: written');
    expect(body, 'the computed count is no longer reported as repaired')
      .not.toContain('repairedCount: recovered.size');
  });

  it('counts the difference as unrepaired rather than losing it', () => {
    expect(body).toContain('const shortfall = intended - written;');
    expect(body).toContain('unrepairedCount: unrecoveredIds.length + shortfall');
  });

  it('only calls itself healed when nothing was left behind on either count', () => {
    expect(body).toContain('healed: unrecoveredIds.length === 0 && shortfall === 0');
  });

  it('writes the one-shot stamp only when the write landed in full', () => {
    // There are two writes of this key and only one of them is the subject.
    // The first drafts of this case matched the key's READ, and then the OTHER
    // write, and failed twice for their own reasons before saying this.
    //
    //   1. nothing damaged at all: stamped unconditionally, correctly, because
    //      a migration with nothing to do is finished.
    //   2. records were repaired: stamped only if every one of them landed.
    const writes = [...body.matchAll(/^.*chrome\.storage\.local\.set\(\{ \[REPAIR_STAMP_KEY\].*$/gm)]
      .map((m) => m[0].trim());
    expect(writes, 'both paths still stamp').toHaveLength(2);
    expect(writes.some((l) => l.startsWith('if (shortfall === 0)')), 'the repair path is guarded').toBe(true);
    expect(writes.some((l) => l.startsWith('await chrome.storage')), 'the nothing-to-do path is not').toBe(true);
  });

  it('still stamps on the ordinary path, or it would run forever', () => {
    // The other half: a repair that finished must close, or every wake redoes
    // the whole scan.
    expect(body).toContain('await chrome.storage.local.set({ [REPAIR_STAMP_KEY]: now })');
  });

  it('the write it trusts really does return a count', () => {
    // The premise. If rewriteRecordsInPlace ever stops returning the number it
    // updated, everything above becomes decoration.
    const store = readFileSync(join(ROOT, 'src/forensics/store.ts'), 'utf8');
    expect(store).toContain('export async function rewriteRecordsInPlace(records: ForensicRecord[]): Promise<number>');
  });
});
