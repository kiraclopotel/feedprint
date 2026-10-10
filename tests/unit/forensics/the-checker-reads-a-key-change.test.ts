// The checker reads where the signing key changes inside a file, and whether the record says why.
//
// A change the install stated (a key-replaced marker signed by the new key, naming the old key and
// the new one) is told as such. A change nothing on the record states is told too, in its own
// words, because records written before the marker existed show it, and in a newer file it is a
// line from another recorder or a change the install failed to state. Neither changes the reading:
// whether the signatures and links hold is decided elsewhere, and this only says what changed.

import { describe, expect, it } from 'vitest';
import { VERIFIER_CORE_FNS_SOURCE } from '../../../src/forensics/verifier-core-source';
import { EVIDENCE_STRINGS } from '../../../src/forensics/export-evidence-strings';

type Chain = {
  ok: boolean; branches: number; restarts: number; outside: number;
  keyChangesStated: number; keyChangesUnstated: number;
};
type Core = {
  verifyChain(records: unknown[], perRecord?: unknown[]): Promise<Chain>;
  verificationState(perRecord: unknown[], chain: Partial<Chain> & { ok: boolean }, extra?: unknown): string;
  chainNotes(chain: Partial<Chain>, i18n: unknown, sel: unknown): string[];
};
const core = new Function(
  `"use strict";${VERIFIER_CORE_FNS_SOURCE}\n return { verifyChain, verificationState, chainNotes };`,
)() as Core;

const GENESIS = 'feelingwise-chain-genesis-v1';
type Rec = {
  id: string; integrityHash: string; prevRecordHash: string; chainPosition: number;
  publicKeyFingerprint: string; kind?: string; originalText?: string;
};

function chain(keys: string[], markerAt?: { index: number; text: string }): Rec[] {
  const out: Rec[] = [];
  let prev = GENESIS;
  keys.forEach((fp, p) => {
    const h = `r-${p}`;
    const r: Rec = { id: h, integrityHash: h, prevRecordHash: prev, chainPosition: p, publicKeyFingerprint: fp };
    if (markerAt && markerAt.index === p) { r.kind = 'gap-marker'; r.originalText = markerAt.text; }
    out.push(r);
    prev = h;
  });
  return out;
}
const line = (prev: string, next: string, origin = 'generated-storage-empty') =>
  `[gap-marker @ 2026-10-07T05:00:00.000Z] reason=key-replaced platform=unknown count=0 unit=records from=2026-10-07T05:00:00.000Z to=2026-10-07T05:00:00.000Z previousKey=${prev} newKey=${next} origin=${origin}`;
const verified = (records: unknown[]) => records.map(() => ({ ok: true }));
const A = 'aaaaaaaaaaaaaaaa', B = 'bbbbbbbbbbbbbbbb', X = 'cccccccccccccccc';

describe('the checker reads a key change', () => {
  it('one key throughout: nothing to say', async () => {
    const records = chain([A, A, A]);
    const c = await core.verifyChain(records, verified(records));
    expect(c).toMatchObject({ keyChangesStated: 0, keyChangesUnstated: 0 });
  });

  it('a change the record states is counted as stated, and the reading does not move', async () => {
    const records = chain([A, A, B, B], { index: 2, text: line(A, B) });
    const per = verified(records);
    const c = await core.verifyChain(records, per);
    expect(c).toMatchObject({ keyChangesStated: 1, keyChangesUnstated: 0 });
    expect(core.verificationState(per, c)).toBe('verified');
    const notes = core.chainNotes(c, EVIDENCE_STRINGS.en, null);
    expect(notes.some(n => n.includes('1'))).toBe(true);
  });

  it('a change with no marker is counted as unstated and said in its own words', async () => {
    const records = chain([A, A, B, B]);
    const per = verified(records);
    const c = await core.verifyChain(records, per);
    expect(c).toMatchObject({ keyChangesStated: 0, keyChangesUnstated: 1 });
    expect(core.verificationState(per, c)).toBe('verified');
    const notes = core.chainNotes(c, EVIDENCE_STRINGS.en, null);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toBe(EVIDENCE_STRINGS.en.chainNoteKeyUnstated.replace('{n}', '1'));
  });

  it('a marker naming other keys than the ones that changed does not explain the change', async () => {
    const records = chain([A, A, B, B], { index: 2, text: line(X, B) });
    const c = await core.verifyChain(records, verified(records));
    expect(c).toMatchObject({ keyChangesStated: 0, keyChangesUnstated: 1 });
  });

  it('a marker whose own signature did not verify does not explain the change', async () => {
    const records = chain([A, A, B, B], { index: 2, text: line(A, B) });
    const per = verified(records) as Array<Record<string, unknown>>;
    per[2] = { ok: true, unverified: true };
    const c = await core.verifyChain(records, per);
    expect(c).toMatchObject({ keyChangesStated: 0, keyChangesUnstated: 1 });
  });

  it('a marker written late, after records the new key already signed, still states that change', async () => {
    // The marker's first write failed; the next worker start wrote it after two new-key records.
    const records = chain([A, A, B, B, B], { index: 4, text: line(A, B) });
    const c = await core.verifyChain(records, verified(records));
    expect(c).toMatchObject({ keyChangesStated: 1, keyChangesUnstated: 0 });
  });

  it('one statement explains one change, and a marker signed by another key than the one it names explains none', async () => {
    const twice = chain([A, B, A, B], { index: 1, text: line(A, B) });
    expect(await core.verifyChain(twice, verified(twice))).toMatchObject({ keyChangesStated: 1, keyChangesUnstated: 2 });
    const wrongSigner = chain([A, A, B, X], { index: 3, text: line(A, B) });
    expect(await core.verifyChain(wrongSigner, verified(wrongSigner))).toMatchObject({ keyChangesStated: 0, keyChangesUnstated: 2 });
  });

  it('words carried inside another marker cannot pose as a key-replaced line', async () => {
    const planted = '[gap-marker @ 2026-10-07T05:00:00.000Z] reason=retry-overflow platform=twitter count=1 unit=records from=2026-10-07T05:00:00.000Z to=2026-10-07T05:00:00.000Z x' + line(A, B).slice(line(A, B).indexOf(' reason='));
    const records = chain([A, A, B, B], { index: 2, text: planted });
    const c = await core.verifyChain(records, verified(records));
    expect(c).toMatchObject({ keyChangesStated: 0, keyChangesUnstated: 1 });
  });

  it('a file from before these notes existed prints none of them', async () => {
    const c = { ok: true, keyChangesStated: 1, keyChangesUnstated: 1 };
    expect(core.chainNotes(c, {}, null)).toEqual([]);
  });

  it('every language has both notes with their count slot', () => {
    for (const [locale, s] of Object.entries(EVIDENCE_STRINGS)) {
      expect(s.chainNoteKeyStated, locale).toContain('{n}');
      expect(s.chainNoteKeyUnstated, locale).toContain('{n}');
    }
  });
});
