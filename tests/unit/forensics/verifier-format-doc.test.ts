// verifier/FORMAT.md is the record format written for a stranger, and it is
// normative. These locks keep it true to the code it describes: the canonical
// field list in the document is the hasher's list in the hasher's order; the
// nine marker kinds it names are the nine the code knows; the manifest's
// canonical array and the envelope's canonical array are the ones the signer
// and the checker use; and the document never uses the words the public voice
// forbids.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE, VERIFIER_CORE_FNS_SOURCE } from '../../../src/forensics/verifier-core-source';
import { SYSTEM_MARKER_KINDS } from '../../../src/forensics/system-records';

import { REPO_ROOT as PROJECT_ROOT } from '../../helpers/repo-root';
const doc = readFileSync(resolve(PROJECT_ROOT, 'verifier', 'FORMAT.md'), 'utf8');

function fence(name: string): string[] {
  const m = new RegExp('```' + name + '\\n([\\s\\S]*?)```').exec(doc);
  expect(m, `fenced block ${name} missing`).not.toBeNull();
  return m![1].trim().split('\n').map((l) => l.trim()).filter(Boolean);
}

describe('verifier/FORMAT.md against the code', () => {
  it('lists the canonical fields in the hasher\'s order', () => {
    // The embedded hasher's object literal, key by key, in source order.
    const body = VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE.slice(VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE.indexOf('JSON.stringify({') + 'JSON.stringify({'.length);
    const keys = [...body.matchAll(/(?:^\s*|[,{]\s*)([a-zA-Z]+):/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(40);
    expect(fence('canonical-fields')).toEqual(keys);
  });

  it('states the version as the code holds it: the canonical field count, and the tokens the pool tools write', async () => {
    const body = VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE.slice(VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE.indexOf('JSON.stringify({') + 'JSON.stringify({'.length);
    const keys = [...body.matchAll(/(?:^\s*|[,{]\s*)([a-zA-Z]+):/g)].map((m) => m[1]);
    // Appending a field is a minor version (section 0), so the count in the version line has to move with it.
    expect(doc).toContain(`with exactly the ${keys.length} fields listed there`);
    expect(doc.slice(0, doc.indexOf(String.fromCharCode(10)))).toBe('# Feed Observation Record, version 1.0');
    // @ts-expect-error - the shipped tool is plain JavaScript with no types
    const pool = await import('../../../verifier/pool.mjs');
    expect(pool.RECORD_FORMAT).toBe('feed-observation-record/1.0');
    expect(doc).toContain('`' + pool.RECORD_FORMAT + '`');
    expect(doc).toContain('`' + pool.POOL_FORMAT + '`');
  });

  it('names every marker kind the code knows, and no other', () => {
    const named = [...doc.matchAll(/^- `([a-z-]+-marker)`:/gm)].map((m) => m[1]);
    expect(named.sort()).toEqual([...SYSTEM_MARKER_KINDS].sort());
    expect(doc).toContain('Nine marker kinds');
  });

  it('states the manifest and envelope canonical arrays as the checker computes them', () => {
    const manifest = /function manifestCanonical\(m\)\{return JSON\.stringify\(\[([^\]]+)\]\);\}/.exec(VERIFIER_CORE_FNS_SOURCE)![1]
      .split(',').map((s) => s.trim().replace(/^m\./, ''));
    const docManifest = /`digest` over `JSON\.stringify\(\[([^\]]+)\]\)`/.exec(doc)![1].split(',').map((s) => s.trim());
    expect(docManifest).toEqual(manifest);
    const envelope = /function envelopeCanonical\(d\)\{return JSON\.stringify\(\[([^\]]+)\]\);\}/.exec(VERIFIER_CORE_FNS_SOURCE)![1]
      .split(',').map((s) => s.trim().replace(/^nz\(d\.(.*)\)$/, '$1'));
    const docEnvelope = /`envelopeDigest` over `JSON\.stringify\(\[([^\]]+)\]\)`/.exec(doc)![1].split(',').map((s) => s.trim());
    expect(docEnvelope).toEqual(envelope);
  });

  it('names the failure reasons the checker emits', () => {
    for (const reason of ['redaction-unattested', 'tampered', 'key-mismatch', 'prior-key', 'unsigned', 'carriedKey']) {
      expect(doc).toContain('`' + reason + '`');
    }
  });

  it('keeps the public voice: no proof, no tamper-proof, no court', () => {
    for (const banned of ['tamper-proof', 'tamperproof', 'court-ready', 'legal evidence', 'chain of custody', 'proves that', 'self-verifying']) {
      expect(doc.toLowerCase()).not.toContain(banned);
    }
    expect(doc).toContain('none of it proof');
  });
});
