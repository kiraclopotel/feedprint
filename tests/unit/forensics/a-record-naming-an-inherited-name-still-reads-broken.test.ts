// @vitest-environment node
//
// The chain walk looks records up by the hashes other records name, and those names are text anyone
// can type into a file. A name such as "constructor" or "__proto__" is one every plain JavaScript
// object already answers to, so a lookup table built from a plain object finds something there that
// no record put in it. The checker must read such a file as it reads any other edited record, BROKEN
// at that record, and never stop with no verdict.
//
// The file is vector 02, a real signed export with its manifest removed, so that nothing but the
// records decides the reading. It is run the way a recipient runs it: the built checker as a child
// process with --json.

import { describe, expect, it, beforeAll, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SPAWN_TIMEOUT_MS } from '../../helpers/spawn-timeout';
import { CHECKER_PATH, REPO_ROOT, checkFile, editPayload } from '../../helpers/export-tamper-corpus.mjs';
import { VERIFIER_CORE_FNS_SOURCE } from '../../../src/forensics/verifier-core-source';

vi.setConfig({ testTimeout: SPAWN_TIMEOUT_MS });

type Chain = { ok: boolean; branches: number; restarts: number; outside: number; setAside: number };
const core = new Function(
  `"use strict";${VERIFIER_CORE_FNS_SOURCE}\n return { verifyChain, verificationState };`,
)() as {
  verifyChain(records: unknown[], perRecord?: unknown[]): Promise<Chain>;
  verificationState(perRecord: unknown[], chain: Chain): string;
};

const INHERITED = ['constructor', '__proto__', 'toString', 'hasOwnProperty'];
const GENESIS = 'feelingwise-chain-genesis-v1';

describe('a name every object answers to is read as a name, not as something already there', () => {
  let dir: string;
  let vector: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'fw-inherited-name-'));
    vector = readFileSync(join(REPO_ROOT, 'verifier', 'vectors', '02-no-manifest.html'), 'utf8');
  });

  for (const name of ['constructor', '__proto__']) {
    it(`the third record of a file with no manifest, its predecessor edited to "${name}", reads FAILED at that record`, () => {
      const edited = editPayload(vector, (data) => {
        const records = data.records as Array<Record<string, unknown>>;
        records[2].prevRecordHash = name;
      });
      const file = join(dir, `02-${name}.html`);
      writeFileSync(file, edited);
      const reading = checkFile(CHECKER_PATH, file);
      expect(reading).toMatchObject({ code: 2, state: 'failed', manifest: 'missing', reason: 'tampered' });
    });
  }

  it('the chain walk finishes over records that name, or are named by, such a word', async () => {
    for (const name of INHERITED) {
      const records = [
        { id: 'a0', integrityHash: 'a0', prevRecordHash: GENESIS, chainPosition: 0 },
        { id: 'a1', integrityHash: name, prevRecordHash: 'a0', chainPosition: 1 },
        { id: 'a2', integrityHash: 'a2', prevRecordHash: name, chainPosition: 2 },
        { id: 'm', integrityHash: 'm', prevRecordHash: GENESIS, chainPosition: 0, kind: 'reset-marker', priorChainHash: name },
        { id: 'b1', integrityHash: 'b1', prevRecordHash: 'm', chainPosition: 1 },
      ];
      const chain = await core.verifyChain(records, records.map(() => ({ ok: true })));
      expect(chain.ok, name).toBe(true);
    }
  });

  it('a record naming such a word, which no record in the file carries, names a predecessor that is missing', async () => {
    for (const name of INHERITED) {
      const records = [
        { id: 'a0', integrityHash: 'a0', prevRecordHash: GENESIS, chainPosition: 0 },
        { id: 'a1', integrityHash: 'a1', prevRecordHash: 'a0', chainPosition: 1 },
        { id: 'a5', integrityHash: 'a5', prevRecordHash: name, chainPosition: 5 },
      ];
      const per = records.map(() => ({ ok: true }));
      const chain = await core.verifyChain(records, per);
      expect(chain.outside, name).toBe(1);
      expect(core.verificationState(per, chain), name).toBe('partial');
    }
  });
});
