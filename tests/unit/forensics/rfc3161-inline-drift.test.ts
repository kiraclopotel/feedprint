// The HTML export carries its own copy of the RFC 3161 verifier, because the
// file has to check a time-stamp token on a recipient's machine with no network
// and no imports. That copy is generated from src/forensics/rfc3161.ts by
// scripts/gen-rfc3161-inline.mjs.
//
// Two things can go wrong and both are silent in production:
//   1. Someone edits the module and forgets to regenerate, so the export runs
//      last month's verifier while the extension runs this month's.
//   2. The generated bundle is syntactically fine but behaves differently from
//      the module under a real token.
//
// The first test regenerates and compares bytes. The second evaluates the
// generated text the way the export will and runs it against the same real
// authority tokens the module is tested on. A recipient's verdict and the
// extension's verdict must be the same verdict.

import { describe, it, expect } from 'vitest';
import { repoPath } from '../../helpers/repo-root';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { generate } from '../../../scripts/gen-rfc3161-inline.mjs';
import { RFC3161_VERIFIER_SOURCE } from '../../../src/forensics/rfc3161-inline.generated';
import { verifyAnchorBase64 } from '../../../src/forensics/rfc3161';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const FIXTURES = repoPath('tests', 'fixtures', 'rfc3161');
const FIXTURE_HASH = '7dfe00431171bc9572dc376aff313d9e25918f114e41efd066243572d9ed3cbe';
const OUT = repoPath('src', 'forensics', 'rfc3161-inline.generated.ts');

function fixtureB64(name: string): string {
  return readFileSync(join(FIXTURES, name)).toString('base64');
}

interface InlineApi {
  verifyAnchorBase64(
    input: { tst?: string | null; response?: string | null },
    expectedHashHex: string | null,
  ): Promise<{ ok: boolean; genTime: string | null; checks: { name: string; ok: boolean }[]; error: string | null }>;
}

/** Evaluate the generated bundle the way the export's <script> tag will. */
function loadInline(): InlineApi {
  const factory = new Function(`${RFC3161_VERIFIER_SOURCE}; return __FW_RFC3161__;`);
  return factory() as InlineApi;
}

describe('rfc3161 inline copy - drift', () => {
  it('the checked-in generated file matches what the generator produces now', async () => {
    const expected = await generate();
    const actual = readFileSync(OUT, 'utf8');
    expect(
      actual === expected,
      'src/forensics/rfc3161-inline.generated.ts is stale. Run: npm run gen:rfc3161',
    ).toBe(true);
  });

  it('exposes the entry points the export calls', () => {
    const api = loadInline() as unknown as Record<string, unknown>;
    expect(typeof api.verifyAnchorBase64).toBe('function');
    expect(typeof api.verifyTimeStampToken).toBe('function');
    expect(typeof api.parseTimeStampResp).toBe('function');
  });
});

describe('rfc3161 inline copy - same verdict as the module', () => {
  for (const name of ['freetsa-resp.der', 'digicert-resp.der']) {
    it(`agrees with the module on ${name}, right hash`, async () => {
      const b64 = fixtureB64(name);
      const mine = await verifyAnchorBase64({ response: b64 }, FIXTURE_HASH);
      const theirs = await loadInline().verifyAnchorBase64({ response: b64 }, FIXTURE_HASH);
      expect(theirs.error).toBe(mine.error);
      expect(theirs.ok).toBe(mine.ok);
      expect(theirs.genTime).toBe(mine.genTime);
      expect(theirs.checks.map(c => `${c.name}:${c.ok}`))
        .toEqual(mine.checks.map(c => `${c.name}:${c.ok}`));
    });

    it(`agrees with the module on ${name}, wrong hash`, async () => {
      const b64 = fixtureB64(name);
      const wrong = '0'.repeat(64);
      const mine = await verifyAnchorBase64({ response: b64 }, wrong);
      const theirs = await loadInline().verifyAnchorBase64({ response: b64 }, wrong);
      expect(theirs.ok).toBe(false);
      expect(theirs.ok).toBe(mine.ok);
      expect(theirs.checks.map(c => `${c.name}:${c.ok}`))
        .toEqual(mine.checks.map(c => `${c.name}:${c.ok}`));
    });
  }

  it('agrees with the module on garbage', async () => {
    const junk = Buffer.alloc(48, 0x41).toString('base64');
    const mine = await verifyAnchorBase64({ tst: junk }, FIXTURE_HASH);
    const theirs = await loadInline().verifyAnchorBase64({ tst: junk }, FIXTURE_HASH);
    expect(theirs.ok).toBe(false);
    expect(theirs.ok).toBe(mine.ok);
    expect(theirs.error).toBe(mine.error);
  });
});
