// The chain walk reads the first record's link as well.
//
// FORMAT.md section 4: "every prevRecordHash is resolved against every record in the file".
// The loop skipped index 0. Found 2026-09-20 on a report of 10 records drawn from a chain of
// 71 by the product's own gate: every one of the ten named a record the report had left
// out, and both the page and the standalone checker said "9 record(s) link to records this
// report left out on purpose". The tenth was the first record in the file.

import { describe, it, expect } from 'vitest';
import { VERIFIER_CORE_FNS_SOURCE } from '../../../src/forensics/verifier-core-source';

type Chain = { outside: number; branches: number; restarts: number };
const core = new Function(`"use strict";${VERIFIER_CORE_FNS_SOURCE}\n return { verifyChain: verifyChain };`)() as {
  verifyChain(records: unknown[], perRecord?: unknown[]): Promise<Chain>;
};

const r = (chainPosition: number, integrityHash: string, prevRecordHash: string) =>
  ({ chainPosition, integrityHash, prevRecordHash, publicKeyFingerprint: 'fp' });

describe('the first record in a file names a predecessor too', () => {
  it('a report whose every record names a left-out predecessor counts every one, the first included', async () => {
    const chain = await core.verifyChain([r(3, 'h3', 'h2'), r(6, 'h6', 'h5'), r(9, 'h9', 'h8')]);
    expect(chain.outside).toBe(3);
    expect(chain.restarts).toBe(0);
  });

  it('a first record at position 0 names nobody, whether it says so with nothing or with the genesis constant', async () => {
    expect((await core.verifyChain([r(0, 'h0', ''), r(1, 'h1', 'h0')])).outside).toBe(0);
    expect((await core.verifyChain([r(0, 'h0', 'feelingwise-chain-genesis-v1'), r(1, 'h1', 'h0')])).outside).toBe(0);
  });

  it('a first record above position 0 whose predecessor is absent is one outside the file, never a seam', async () => {
    const chain = await core.verifyChain([r(500, 'h500', 'h499'), r(501, 'h501', 'h500')]);
    expect(chain.outside).toBe(1);
    expect(chain.restarts).toBe(0);
    expect(chain.branches).toBe(0);
  });
});
