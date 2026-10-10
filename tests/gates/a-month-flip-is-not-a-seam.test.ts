// An ordinary month change must not cost a file its verdict.
//
// Found 2026-09-20 by exporting, with the product's own code, a chain of ten records on
// 31 August, the product's own month rotation on 1 September, and six records after it.
// The standalone checker read it as PARTIALLY VERIFIED, 17 records, with 7 chain seams (the
// install signed records at positions it had already used, or restarted) and 1 record naming
// a predecessor that is not in the file. Nothing had been lost and nothing restarted.
// Positions restart at 0 every month by design, the marker that opens the new month carries
// the last hash of the old one inside its signed payload, and the checker read neither. So
// every install's whole-record export stopped reading VERIFIED after its first month.
//
// EXPECTED.json is written BY the checker, so it cannot hold this on its own: a checker
// that went back to counting the new month as branches would simply write "partial" there
// and the vector gate would agree with it. These cases say what the two files must read.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { VECTORS_DIR } from '../../scripts/build-verifier-vectors';
import { STANDALONE_VERIFIER_PATH } from '../../scripts/build-standalone-verifier';

type Reading = {
  state: string;
  notes: string[];
  chain: { branches: number; restarts: number; outside: number; setAside: number; setAsideLines: Array<{ position: number; n: number }> };
};

async function read(name: string): Promise<Reading> {
  const mod = await import(pathToFileURL(STANDALONE_VERIFIER_PATH).href) as {
    verifyExportText(text: string): Promise<Reading>;
  };
  return mod.verifyExportText(readFileSync(join(VECTORS_DIR, name), 'utf8'));
}

describe('a month rotation is a linked run, not a seam', () => {
  it('two months joined by a rotation marker that names a record in the file read VERIFIED', async () => {
    const r = await read('21-month-rotation-linked.html');
    expect(r.chain.branches).toBe(0);
    expect(r.chain.restarts).toBe(0);
    expect(r.chain.outside).toBe(0);
    expect(r.state).toBe('verified');
  });

  it('a rotation marker that names a record NOT in the file earns nothing: the reused positions still count', async () => {
    const r = await read('22-month-rotation-unlinked.html');
    // Positions 0, 1 and 2 are each held twice, and nothing shows the second run follows the first.
    expect(r.chain.branches).toBe(3);
    expect(r.state).toBe('partial');
  });

  it('a marker that names a record in the middle of the earlier run sets the records after it aside, and the file stays partial', async () => {
    const r = await read('23-month-rotation-names-a-middle-record.html');
    expect(r.chain.setAside).toBe(2);
    expect(r.chain.setAsideLines).toEqual([{ position: 0, n: 2 }]);
    expect(r.chain.branches).toBe(0);
    expect(r.chain.outside).toBe(0);
    expect(r.state).toBe('partial');
    expect(r.notes.join('\n')).toContain('2 record(s) continue from position 0 on a line the record did not keep');
  });

  it('a marker nobody signed may not erase branch counts by being present', async () => {
    const r = await read('24-month-rotation-marker-unsigned.html');
    expect(r.chain.branches).toBe(3);
    expect(r.state).toBe('partial');
  });

  it('a position really held twice inside one run is still a branch', async () => {
    const r = await read('15-seam-and-branch.html');
    expect(r.chain.branches).toBe(1);
    expect(r.chain.restarts).toBe(1);
    expect(r.state).toBe('partial');
  });
});
