// A restore puts back an older state of the record, and the entries written after the backup
// stay in the month archive, so a whole-record export holds them beside the line the record went
// on along. The checker must count those entries, once, and not every position the two lines share;
// and the genesis text a reset or rotation marker carries names no entry, so it is never a missing one.
//
// The layouts are the ones a whole-record export produces: the archive first, then the live
// chain. Hashes are labels and every record is passed as signed and verified, so what is measured
// here is the counting rule and the reading it leads to.

import { describe, it, expect } from 'vitest';
import { VERIFIER_CORE_FNS_SOURCE } from '../../../src/forensics/verifier-core-source';
import { I18N } from '../../../src/i18n/export-strings';

type Line = { position: number; n: number };
type Chain = {
  ok: boolean; branches: number; restarts: number; unattributed: number; outside: number;
  setAside: number; setAsideLines: Line[];
};
type Core = {
  verifyChain(records: unknown[], perRecord?: unknown[]): Promise<Chain>;
  coverageFromRecords(records: unknown[]): unknown;
  verificationState(perRecord: unknown[], chain: Partial<Chain> & { ok: boolean }, extra?: unknown): string;
  chainNotes(chain: Partial<Chain>, i18n: unknown, sel: unknown): string[];
};
const core = new Function(
  `"use strict";${VERIFIER_CORE_FNS_SOURCE}\n return { verifyChain, coverageFromRecords, verificationState, chainNotes };`,
)() as Core;

const GENESIS = 'feelingwise-chain-genesis-v1';
type Rec = {
  id: string; integrityHash: string; prevRecordHash: string; chainPosition: number;
  publicKeyFingerprint: string; kind?: string; priorChainHash?: string;
};

let serial = 0;
function run(label: string, count: number, from = 0, prev = GENESIS): Rec[] {
  const out: Rec[] = [];
  for (let p = from; p < from + count; p++) {
    const h = `${label}-${p}-${serial++}`;
    out.push({ id: h, integrityHash: h, prevRecordHash: prev, chainPosition: p, publicKeyFingerprint: 'k' });
    prev = h;
  }
  return out;
}
function marker(kind: 'reset-marker' | 'month-rotation-marker', priorChainHash?: string): Rec {
  const h = `${kind}-${serial++}`;
  return { id: h, integrityHash: h, prevRecordHash: GENESIS, chainPosition: 0, kind, priorChainHash, publicKeyFingerprint: 'k' };
}
const verified = (records: unknown[]): Array<Record<string, unknown>> => records.map(() => ({ ok: true }));

async function read(records: Rec[], perRecord: Array<Record<string, unknown>> = verified(records)) {
  const chain = await core.verifyChain(records, perRecord);
  const state = core.verificationState(perRecord, chain, { coverage: core.coverageFromRecords(records) });
  return { chain, state };
}

describe('what a restore sets aside is counted once, and the reading stays partial', () => {
  it('a reset alone sets nothing aside and reads verified', async () => {
    const old = run('a', 8);
    const m = marker('reset-marker', old[7].integrityHash);
    const { chain, state } = await read([...old, m, ...run('b', 12, 1, m.integrityHash)]);
    expect(chain).toMatchObject({ setAside: 0, branches: 0, restarts: 0, outside: 0 });
    expect(state).toBe('verified');
  });

  it('the walk\'s layout, a restore to position 5 and then a reset, sets 2 aside, not 8 seams, and nothing is outside', async () => {
    const old = run('a', 8);
    const m = marker('reset-marker', old[5].integrityHash);
    const { chain, state } = await read([...old, m, ...run('b', 12, 1, m.integrityHash)]);
    expect(chain.setAside).toBe(2);
    expect(chain.setAsideLines).toEqual([{ position: 5, n: 2 }]);
    expect(chain.branches).toBe(0);
    expect(chain.outside).toBe(0);
    expect(state).toBe('partial');
  });

  it('a restore that recording carried on from, with no reset, still reads 2 and partial', async () => {
    // No marker says which line the record kept, so the two records at positions 6 and 7 are
    // read as positions held twice, which is what this file can show.
    const old = run('a', 8);
    const { chain, state } = await read([...old, ...run('c', 2, 6, old[5].integrityHash)]);
    expect(chain).toMatchObject({ branches: 2, setAside: 0, outside: 0 });
    expect(state).toBe('partial');
  });

  it('the count is the line that was set aside, not the length of the chain before the reset', async () => {
    const old = run('a', 5000);
    const m = marker('reset-marker', old[4989].integrityHash);
    const { chain, state } = await read([...old, m, ...run('b', 6000, 1, m.integrityHash)]);
    expect(chain).toMatchObject({ setAside: 10, branches: 0, outside: 0 });
    expect(chain.setAsideLines).toEqual([{ position: 4989, n: 10 }]);
    expect(state).toBe('partial');
  });

  it('a restore after a reset counts that reset and its records, when the next reset names the same record', async () => {
    // A backup at position 5, a reset by mistake and three records, then the backup restored and a
    // reset again. The restore files the first reset's line in the archive, so two resets name position 5.
    const old = run('a', 6);
    const first = marker('reset-marker', old[5].integrityHash);
    const lost = run('b', 3, 1, first.integrityHash);
    const second = marker('reset-marker', old[5].integrityHash);
    const { chain, state } = await read([...old, first, ...lost, second, ...run('d', 4, 1, second.integrityHash)]);
    expect(chain).toMatchObject({ setAside: 4, branches: 0, outside: 0 });
    expect(chain.setAsideLines).toEqual([{ position: 5, n: 4 }]);
    expect(state).toBe('partial');
  });

  it('a reset on the line a restore set aside is counted with that line', async () => {
    // A backup at position 5, two more records, a reset naming position 7 and three records, then the
    // backup restored and a reset naming position 5: all six records after position 5 are off the kept line.
    const old = run('a', 8);
    const first = marker('reset-marker', old[7].integrityHash);
    const lost = run('b', 3, 1, first.integrityHash);
    const second = marker('reset-marker', old[5].integrityHash);
    const { chain, state } = await read([...old, first, ...lost, second, ...run('d', 4, 1, second.integrityHash)]);
    expect(chain).toMatchObject({ setAside: 6, branches: 0, outside: 0 });
    expect(chain.setAsideLines).toEqual([{ position: 5, n: 6 }]);
    expect(state).toBe('partial');
  });

  it('records set aside that come before the reset in the file are not counted again as positions held twice', async () => {
    // Two restores to one backup at position 5 with records written between them, then a reset.
    const old = run('a', 8);
    const again = run('c', 2, 6, old[5].integrityHash);
    const m = marker('reset-marker', old[5].integrityHash);
    const { chain, state } = await read([...old, ...again, m, ...run('b', 12, 1, m.integrityHash)]);
    expect(chain).toMatchObject({ setAside: 4, branches: 0, restarts: 0, outside: 0 });
    expect(chain.setAsideLines).toEqual([{ position: 5, n: 4 }]);
    expect(core.chainNotes(chain, I18N.en, null)).toHaveLength(1);
    expect(state).toBe('partial');
  });

  it('a restore to a later backup, taken on the line an earlier restore left, sets aside the line in between, however long recording goes on', async () => {
    // Backups at positions 5 and 7. The one at 5 is restored and a reset follows with four records;
    // then the one at 7 is restored and a reset follows. The record goes on from position 7, so what
    // is off the kept line is the first reset and its four records.
    const old = run('a', 8);
    const first = marker('reset-marker', old[5].integrityHash);
    const left = run('d', 4, 1, first.integrityHash);
    const second = marker('reset-marker', old[7].integrityHash);
    for (const more of [3, 30]) {
      const { chain, state } = await read([...old, first, ...left, second, ...run('e', more, 1, second.integrityHash)]);
      expect(chain, `${more}`).toMatchObject({ setAside: 5, branches: 0, outside: 0 });
      expect(chain.setAsideLines, `${more}`).toEqual([{ position: 5, n: 5 }]);
      expect(state, `${more}`).toBe('partial');
    }
  });

  it('the same when recording carries on from the later backup with no reset', async () => {
    const old = run('a', 8);
    const first = marker('reset-marker', old[5].integrityHash);
    const left = run('d', 4, 1, first.integrityHash);
    for (const more of [2, 20]) {
      const { chain, state } = await read([...old, first, ...left, ...run('e', more, 8, old[7].integrityHash)]);
      expect(chain, `${more}`).toMatchObject({ setAside: 5, branches: 0, outside: 0 });
      expect(chain.setAsideLines, `${more}`).toEqual([{ position: 5, n: 5 }]);
      expect(state, `${more}`).toBe('partial');
    }
  });

  it('three restores, the last to a backup on the line the second one left, count each line off the kept one once', async () => {
    // As above, then a backup taken at the first reset's position 2 is restored and a reset follows.
    // Kept: positions 0 to 5, the first reset, its positions 1 and 2, the third reset and its run.
    const old = run('a', 8);
    const first = marker('reset-marker', old[5].integrityHash);
    const left = run('d', 4, 1, first.integrityHash);
    const second = marker('reset-marker', old[7].integrityHash);
    const other = run('e', 3, 1, second.integrityHash);
    const third = marker('reset-marker', left[1].integrityHash);
    const { chain, state } = await read([...old, first, ...left, second, ...other, third, ...run('f', 2, 1, third.integrityHash)]);
    expect(chain).toMatchObject({ setAside: 8, branches: 0, outside: 0 });
    expect(chain.setAsideLines).toEqual([{ position: 5, n: 6 }, { position: 2, n: 2 }]);
    expect(state).toBe('partial');
  });

  it('where the newest record does not lead back to the record a marker names, the marker keeps its own run', async () => {
    // The walk's layout with one record of the new run missing, so the line cannot be read back from the end.
    const old = run('a', 8);
    const m = marker('reset-marker', old[5].integrityHash);
    const after = run('b', 12, 1, m.integrityHash);
    const { chain, state } = await read([...old, m, ...after.slice(0, 3), ...after.slice(4)]);
    expect(chain).toMatchObject({ setAside: 2, branches: 0, outside: 1 });
    expect(chain.setAsideLines).toEqual([{ position: 5, n: 2 }]);
    expect(state).toBe('partial');
  });

  it('the file\'s order decides which line was kept: a side line put after the live chain is read as the one kept', async () => {
    // Nothing signed says which line the record kept. The product writes the live chain last, so a
    // file that puts the other line last is read as keeping that one, and the reset's run is counted.
    const old = run('a', 6);
    const m = marker('reset-marker', old[5].integrityHash);
    const after = run('b', 12, 1, m.integrityHash);
    const side = run('s', 2, 6, old[5].integrityHash);
    const { chain, state } = await read([...old, m, ...after, ...side]);
    expect(chain).toMatchObject({ setAside: 13, branches: 0, outside: 0 });
    expect(chain.setAsideLines).toEqual([{ position: 5, n: 13 }]);
    expect(state).toBe('partial');
  });

  it('a rotation marker that names a record in the middle of its month still leaves every record after it counted', async () => {
    const month = run('a', 3);
    const m = marker('month-rotation-marker', month[0].integrityHash);
    const { chain, state } = await read([...month, m, ...run('b', 2, 1, m.integrityHash)]);
    expect(chain).toMatchObject({ setAside: 2, branches: 0, outside: 0 });
    expect(chain.setAsideLines).toEqual([{ position: 0, n: 2 }]);
    expect(state).toBe('partial');
  });

  it('records set aside keep the file partial even where a stated selection would excuse a missing link', () => {
    const chain = { ok: true, branches: 0, restarts: 0, unattributed: 0, outside: 0, setAside: 2, setAsideLines: [{ position: 5, n: 2 }] };
    const selection = { included: 10, totalSource: 60, leftOut: 50 };
    expect(core.verificationState(verified(Array(10)), chain, { selection })).toBe('partial');
  });

  it('a cut before a reset has nothing to set aside: the record the reset names is gone, and that one missing record is what the file shows', async () => {
    // The last two of 50 records are missing and the reset names the last one. The file carries
    // no position for a record it does not hold, so how many were cut cannot be read from it.
    const old = run('a', 50);
    const m = marker('reset-marker', old[49].integrityHash);
    const { chain, state } = await read([...old.slice(0, 48), m, ...run('b', 60, 1, m.integrityHash)]);
    expect(chain.setAside).toBe(0);
    expect(chain.outside).toBe(1);
    // Nothing links the two runs, so their shared positions are compared as for any unlinked marker.
    expect(chain.branches).toBe(48);
    expect(state).toBe('partial');
  });
});

describe('the genesis text of a position-0 marker is never a missing record', () => {
  it('an unsigned marker naming a record that is in the file links nothing, and names nothing missing', async () => {
    const month = run('a', 3);
    const m = marker('month-rotation-marker', month[2].integrityHash);
    const records = [...month, m, ...run('b', 2, 1, m.integrityHash)];
    const perRecord = verified(records);
    perRecord[3] = { ok: true, unverified: true, unsigned: true, reason: 'unsigned' };
    const { chain, state } = await read(records, perRecord);
    expect(chain.outside).toBe(0);
    expect(chain.branches).toBe(3);
    expect(state).toBe('partial');
  });

  it('a reset of an empty chain names nothing, so nothing is outside the file', async () => {
    const before = run('a', 3);
    const m = marker('reset-marker');
    const { chain } = await read([...before, m, ...run('b', 2, 1, m.integrityHash)]);
    expect(chain.outside).toBe(0);
  });

  it('a marker naming a record that is not in the file counts that record, once', async () => {
    const month = run('a', 3);
    const m = marker('month-rotation-marker', 'a-record-that-is-not-here');
    const { chain } = await read([...month, m, ...run('b', 2, 1, m.integrityHash)]);
    expect(chain.outside).toBe(1);
    expect(chain.setAside).toBe(0);
  });
});

describe('the note says what the file shows, in each language', () => {
  const chain = { ok: true, branches: 0, restarts: 0, unattributed: 0, outside: 0, setAside: 2, setAsideLines: [{ position: 5, n: 2 }] };

  it('in English it names the count, the position, and both things that make such a line', () => {
    const notes = core.chainNotes(chain, I18N.en, null);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('2 records continue from position 5 on a line the record did not keep');
    expect(notes[0]).toContain('restore');
    expect(notes[0]).toContain('same key');
    expect(notes[0]).toContain('cannot say which');
  });

  it('every language fills both numbers and prints no seam and no missing record for this file', () => {
    for (const locale of Object.keys(I18N) as Array<keyof typeof I18N>) {
      const notes = core.chainNotes(chain, I18N[locale], null);
      expect(notes, locale).toHaveLength(1);
      expect(notes[0], locale).toContain('2');
      expect(notes[0], locale).toContain('5');
      expect(notes[0], locale).not.toMatch(/[{}]/);
      expect(notes[0], locale).not.toContain('—');
    }
  });

  it('one note per line set aside', () => {
    const two = { ...chain, setAside: 5, setAsideLines: [{ position: 5, n: 2 }, { position: 40, n: 3 }] };
    const notes = core.chainNotes(two, I18N.en, null);
    expect(notes).toHaveLength(2);
    expect(notes[1]).toContain('3 records continue from position 40');
  });
});
