// The demonstration the export has to survive.
//
// From the 2026-09-04 evidence audit's cross-examination, written by an agent
// briefed as the expert for the other side:
//
//   "I hand them a file I made at lunch and ask them to open it and click
//    their own Verify button. It says VERIFIED. Then I hand them their own
//    exhibit with four records deleted from the middle. VERIFIED. Then their
//    exhibit with the last four records removed - VERIFIED, no footnote at
//    all, because deleting the tail leaves no successor to notice."
//
// Two of those three were true. `verifyChain` counted a record whose stated
// predecessor was absent into `outside`, and `verificationState` never read
// `outside`, so an export with records cut out of it printed the strongest
// claim in the document. Tail truncation left nothing behind at all.
//
// These tests run the EXACT functions a recipient's browser runs
// (VERIFIER_CORE_FNS_SOURCE, the same source the export inlines) against
// chains built with real hashes.
//
// The third case in that quote, a wholly fabricated file, is NOT closed by
// anything here and cannot be: a file signed by a key it also carries is
// internally consistent by construction. What answers it is the independent
// timestamp, which is why the anchor cross-check below matters more than the
// coverage arithmetic.

import { describe, it, expect, beforeAll } from 'vitest';
import { webcrypto } from 'node:crypto';
import { VERIFIER_CORE_FNS_SOURCE } from '../../../src/forensics/html-export';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import type { ForensicRecord } from '../../../src/types/forensic';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

interface Verdict { ok: boolean; unverified?: boolean }
interface Coverage {
  present: number;
  firstPosition?: number;
  lastPosition?: number;
  missingBefore: number;
  gapsInside: number;
}
interface AnchorInfo {
  checked: number;
  notInFile: number;
  beyondTail: number;
  beyondPosition: number;
  lastPosition: number;
}
interface Verifier {
  verifyChain(records: unknown[], perRecord: Verdict[]): Promise<{ ok: boolean; outside: number; branches: number; restarts: number }>;
  verificationState(perRecord: Verdict[], chain: unknown, extra?: unknown): string;
  coverageFromRecords(records: unknown[]): Coverage;
  anchorFindings(records: unknown[], anchors: unknown[]): AnchorInfo;
  isManualRecord(r: unknown): boolean;
}

let verifier: Verifier;

beforeAll(() => {
  verifier = new Function(
    `"use strict";${VERIFIER_CORE_FNS_SOURCE}
     return { verifyChain, verificationState, coverageFromRecords, anchorFindings, isManualRecord };`,
  )() as Verifier;
});

function base(position: number, over: Partial<ForensicRecord> = {}): Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'> {
  return {
    id: `r-${position}`,
    timestamp: `2026-09-0${(position % 9) + 1}T10:00:00.000Z`,
    platform: 'twitter',
    originalText: `post ${position}`,
    originalHash: `h${position}`,
    originalLength: 6,
    neutralizedText: '',
    author: '@someone',
    postUrl: `https://x.com/someone/status/${position}`,
    techniques: [],
    overallScore: 0.1,
    userAgeCategory: 'adult',
    aiSource: 'cloud',
    feedSource: 'for-you',
    chainPosition: position,
    ...over,
  };
}

/** A real hash-linked chain: each record's prevRecordHash is its predecessor's hash. */
async function buildChain(n: number, over: Partial<ForensicRecord> = {}): Promise<ForensicRecord[]> {
  const out: ForensicRecord[] = [];
  let prev = '';
  for (let i = 0; i < n; i++) {
    const body = { ...base(i, over), prevRecordHash: prev };
    const integrityHash = await computeRecordIntegrityHash(body);
    out.push({ ...body, integrityHash, signature: 'sig' } as ForensicRecord);
    prev = integrityHash;
  }
  return out;
}

const signed = (n: number): Verdict[] => Array.from({ length: n }, () => ({ ok: true }));

describe('records removed from an export no longer read as verified', () => {
  it('a whole chain is verified', async () => {
    const chain = await buildChain(6);
    const walked = await verifier.verifyChain(chain, signed(6));
    expect(verifier.verificationState(signed(6), walked)).toBe('verified');
  });

  it('four records cut out of the middle stop the green banner', async () => {
    const chain = await buildChain(10);
    const gutted = [...chain.slice(0, 3), ...chain.slice(7)];
    const walked = await verifier.verifyChain(gutted, signed(gutted.length));
    expect(walked.outside).toBeGreaterThan(0);
    expect(verifier.verificationState(signed(gutted.length), walked)).toBe('partial');
  });

  it('and the recomputed coverage says how many positions are gone', async () => {
    const chain = await buildChain(10);
    const gutted = [...chain.slice(0, 3), ...chain.slice(7)];
    const cov = verifier.coverageFromRecords(gutted);
    expect(cov.present).toBe(6);
    expect(cov.gapsInside).toBe(4);
    expect(cov.missingBefore).toBe(0);
  });

  it('records removed from the front are counted, not silently accepted', async () => {
    const chain = await buildChain(10);
    const cov = verifier.coverageFromRecords(chain.slice(4));
    expect(cov.missingBefore).toBe(4);
    expect(cov.firstPosition).toBe(4);
  });

  it('a month rotation that legitimately restarts at zero is not counted as missing', async () => {
    // Two runs, the second starting again at 0. computeChainCoverage splits
    // runs at every position reset for exactly this reason; the verifier's copy
    // has to agree or a routine rotation would read as a hole.
    const first = await buildChain(4);
    const second = await buildChain(3, { id: 'second' });
    const cov = verifier.coverageFromRecords([...first, ...second]);
    expect(cov.missingBefore).toBe(0);
    expect(cov.gapsInside).toBe(0);
  });
});

describe('an independent timestamp is what catches a truncated tail', () => {
  it('an anchor past the last record present reports the missing tail', async () => {
    const chain = await buildChain(10);
    const truncated = chain.slice(0, 6);
    const info = verifier.anchorFindings(truncated, [{
      anchoredChainPosition: 9,
      anchoredIntegrityHash: chain[9].integrityHash,
    }]);
    expect(info.beyondTail).toBe(4);
    expect(info.beyondPosition).toBe(9);
    expect(info.notInFile).toBe(1);
    expect(verifier.verificationState(signed(6), { ok: true, outside: 0, branches: 0, restarts: 0 }, { anchors: info }))
      .toBe('partial');
  });

  it('an anchor whose record is present and unchanged reports nothing', async () => {
    const chain = await buildChain(10);
    const info = verifier.anchorFindings(chain, [{
      anchoredChainPosition: 9,
      anchoredIntegrityHash: chain[9].integrityHash,
    }]);
    expect(info.checked).toBe(1);
    expect(info.notInFile).toBe(0);
    expect(info.beyondTail).toBe(0);
    expect(verifier.verificationState(signed(10), { ok: true, outside: 0, branches: 0, restarts: 0 }, { anchors: info }))
      .toBe('verified');
  });

  it('an anchor over a record that was edited reports it, because the hash moved', async () => {
    const chain = await buildChain(10);
    const info = verifier.anchorFindings(chain, [{
      anchoredChainPosition: 5,
      anchoredIntegrityHash: 'a'.repeat(64),
    }]);
    expect(info.notInFile).toBe(1);
  });

  it('two authorities over one head count as one missing record, not two', async () => {
    // A round asks two authorities about the same chain head, so both anchors
    // name the same record hash. Counting anchors would report one missing
    // record twice.
    const chain = await buildChain(10);
    const truncated = chain.slice(0, 6);
    const info = verifier.anchorFindings(truncated, [
      { anchoredChainPosition: 9, anchoredIntegrityHash: chain[9].integrityHash },
      { anchoredChainPosition: 9, anchoredIntegrityHash: chain[9].integrityHash },
    ]);
    expect(info.checked).toBe(2);
    expect(info.notInFile).toBe(1);
    expect(info.beyondTail).toBe(4);
  });

  it('no anchors means no anchor findings, and the verdict is unaffected', async () => {
    const chain = await buildChain(4);
    const info = verifier.anchorFindings(chain, []);
    expect(info.checked).toBe(0);
    expect(verifier.verificationState(signed(4), { ok: true, outside: 0, branches: 0, restarts: 0 }, { anchors: info }))
      .toBe('verified');
  });
});

describe('a hand-typed entry is distinguishable from an observed one', () => {
  it('recognises every shape flagPostManually produces', () => {
    expect(verifier.isManualRecord({ feedSource: 'manual' })).toBe(true);
    expect(verifier.isManualRecord({ detectionMode: 'manual' })).toBe(true);
    expect(verifier.isManualRecord({ detectionMode: 'manual:settings-read-failed' })).toBe(true);
    expect(verifier.isManualRecord({ id: 'fr-manual-123' })).toBe(true);
  });

  it('does not mistake an observed record for one', () => {
    expect(verifier.isManualRecord({ feedSource: 'for-you', id: 'fr-1', detectionMode: 'comment-batch:negative' })).toBe(false);
    expect(verifier.isManualRecord(null)).toBe(false);
    expect(verifier.isManualRecord({})).toBe(false);
  });
});

// THE ARITHMETIC WAS COMPUTED AND NEVER CONSULTED. coverageFromRecords counts
// the positions absent before the first record a file holds and the holes
// inside it, and verificationState — which receives that object — never read
// it. The chain walk cannot see either: a missing head leaves nothing pointing
// at it, and each surviving link in a truncated run still resolves. So a file
// beginning at position 100 could read VERIFIED.
//
// CORRECTED 2026-09-20, M353: the walk sees half of that now. The head of a
// truncated file still names its predecessor, and that name is read.
describe('verificationState consults the coverage it is handed', () => {
  // CHANGED 2026-09-20, M353: the second assertion below said 'verified' and
  // called it a documented limitation of the walk. verifyChain skipped index 0
  // while FORMAT.md section 4 says every prevRecordHash is resolved, and a real
  // report of 10 records, each one naming a predecessor the report had left
  // out, told its reader that 9 did. The first record's link is read now, so
  // this file's missing head is one record outside the file, and the walk
  // alone is enough to take the banner. What the case protects is unchanged
  // and is the last assertion: the coverage arithmetic still stops the banner.
  // Coverage's own contribution, no longer isolated here because the two
  // agree on this file, is isolated by the `short` selection in the case
  // below: there the outside count is accounted for and only the coverage
  // branch is left to say partial.
  it('records missing before the first one stop the green banner', async () => {
    const chain = await buildChain(10);
    const tail = chain.slice(4);
    const walked = await verifier.verifyChain(tail, signed(tail.length));
    const coverage = verifier.coverageFromRecords(tail);
    expect(coverage.missingBefore).toBe(4);
    // One record names a predecessor that is not here, and it is the first one:
    // a missing head is never a seam, because there is nothing before it to be
    // consecutive with.
    expect(walked).toMatchObject({ outside: 1, restarts: 0, branches: 0 });
    expect(verifier.verificationState(signed(tail.length), walked)).toBe('partial');
    // And with the coverage in hand, which is the part that survives whatever
    // the walk can or cannot see.
    expect(verifier.verificationState(signed(tail.length), walked, { coverage })).toBe('partial');
  });

  // A filtered report drops passed records on purpose and states the count
  // under signature, so a hole it accounts for is not a hole in what the file
  // claims to be — the same allowance chain.outside already has.
  it('a stated selection accounts for its own holes', async () => {
    const chain = await buildChain(10);
    const tail = chain.slice(4);
    const walked = await verifier.verifyChain(tail, signed(tail.length));
    const coverage = verifier.coverageFromRecords(tail);
    const selection = { included: 6, totalSource: 10, leftOut: 4 };
    expect(verifier.verificationState(signed(tail.length), walked, { coverage, selection })).toBe('verified');
    // But not a selection too small to explain them.
    const short = { included: 6, totalSource: 8, leftOut: 2 };
    expect(verifier.verificationState(signed(tail.length), walked, { coverage, selection: short })).toBe('partial');
  });
});
