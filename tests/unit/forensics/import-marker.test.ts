// Evidence-gap register item 15 (2026-09-06): the import marker.
//
// The register asked for relegation to be an append. Nothing in the tree
// relegates an active record any more; the one writer of the pre-rekey flag
// is the salvage import, and the chain said nothing about an import. Now one
// signed record per import pass carries the counts, the generations and a
// digest over exactly the ids that entered, inside the hashed text. This file
// pins the line, the realm-boundary shape check (two-sided), the digest, that
// the salvage import reports its ids, and the wiring by source.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { SPAWN_TIMEOUT_MS } from '../../helpers/spawn-timeout';
import {
  importIdsDigest,
  importMarkerSummary,
  importMarkerText,
  isImportMarkerInput,
} from '../../../src/forensics/import-marker';
import type { ImportMarkerInput } from '../../../src/types/import-marker';
import { SYSTEM_MARKER_KINDS } from '../../../src/forensics/system-records';
import { sha256 } from '../../../src/forensics/hasher';

// This file starts child processes, so its tests do not fit vitest's 5s
// default under a 546-file parallel run. See tests/helpers/spawn-timeout.ts.
vi.setConfig({ testTimeout: SPAWN_TIMEOUT_MS });

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const DIGEST = 'a'.repeat(64);
const sample: ImportMarkerInput = {
  imported: 412, alreadyPresent: 3, rejected: 2, epochs: ['fd3577e462c42ebc', 'c77cfc0df6327079'], idsDigest: DIGEST,
};

describe('import marker text', () => {
  it('the hashed line carries the counts, the keys sorted and the digest', () => {
    expect(importMarkerText(sample, '2026-09-06T03:00:00.000Z', false)).toBe(
      `[import-marker @ 2026-09-06T03:00:00.000Z] imported=412 alreadyPresent=3 rejected=2 keys=c77cfc0df6327079,fd3577e462c42ebc idsDigest=${DIGEST}`,
    );
    expect(importMarkerText({ ...sample, epochs: [] }, 't', true)).toContain(' keys=none ');
    expect(importMarkerText(sample, 't', true)).toMatch(/ settings-read-failed$/);
  });

  it('the reader line', () => {
    expect(importMarkerSummary(sample)).toBe('import: 412 records recovered from a file entered the record under 2 signing keys; 2 refused');
    expect(importMarkerSummary({ ...sample, imported: 1, epochs: ['fd3577e462c42ebc'], rejected: 0 })).toBe(
      'import: 1 record recovered from a file entered the record under 1 signing key; 0 refused',
    );
  });

  it('the digest is order-independent and binds the exact id set', async () => {
    const a = await importIdsDigest(['sv-2', 'sv-0', 'sv-1']);
    expect(a).toBe(await importIdsDigest(['sv-0', 'sv-1', 'sv-2']));
    expect(a).toBe(await sha256('sv-0\nsv-1\nsv-2'));
    expect(a).not.toBe(await importIdsDigest(['sv-0', 'sv-1']));
  });

  it('is a system marker', () => {
    expect(SYSTEM_MARKER_KINDS.has('import-marker')).toBe(true);
  });
});

describe('isImportMarkerInput (realm boundary, two-sided)', () => {
  const accept: unknown[] = [sample, { ...sample, epochs: [] }, { ...sample, imported: 1, alreadyPresent: 0, rejected: 0 }];
  const reject: unknown[] = [
    null,
    { ...sample, imported: 0 },
    { ...sample, imported: -1 },
    { ...sample, imported: 1.5 },
    { ...sample, rejected: '2' },
    { ...sample, epochs: ['not a fingerprint!'] },
    { ...sample, epochs: 'fd3577e462c42ebc' },
    { ...sample, idsDigest: 'abc' },
    { ...sample, idsDigest: DIGEST.toUpperCase() },
  ];
  it.each(accept.map((x, i) => [i, x]))('accepts case %i', (_i, x) => { expect(isImportMarkerInput(x)).toBe(true); });
  it.each(reject.map((x, i) => [i, x]))('rejects case %i', (_i, x) => { expect(isImportMarkerInput(x)).toBe(false); });
});

describe('wiring (source lock)', () => {
  it('the salvage import reports the ids it added', () => {
    const src = read('src/forensics/salvage-store.ts');
    expect(src).toContain('importedIds: string[];');
    expect(src).toContain('result.importedIds = fresh.map(r => r.id);');
  });

  it('the Export tab sends IMPORT_MARKER after an import that added records, and the worker writes it on the chain lock', () => {
    const tab = read('src/ui/dashboard/components/ExportTab.tsx');
    expect(tab).toContain('if (result.imported > 0) await writeImportMarker(result);');
    expect(tab).toContain("type: 'IMPORT_MARKER'");
    const sw = read('src/background/service-worker.ts');
    expect(sw).toContain("if (message.type === 'IMPORT_MARKER')");
    expect(sw).toContain('isImportMarkerInput(message.payload)');
    const writer = read('src/forensics/import-marker.ts');
    const block = writer.slice(writer.indexOf('export function appendImportMarker'));
    expect(block).toContain('sharedChainWriteLock(');
    expect(block).toContain('originalText: text');
    expect(block).toContain("kind: 'import-marker'");
    expect(block).toContain('await addRecord(');
  });

  it('no live path relegates an active record: markRelegated has no caller in src', () => {
    let out = '';
    try {
      out = execFileSync('git', ['grep', '-l', 'markRelegated(', '--', 'src'], { encoding: 'utf8' });
    } catch (e) {
      out = (e as { stdout?: string }).stdout ?? '';
    }
    const files = out.split('\n').filter(Boolean);
    expect(files).toEqual(['src/forensics/store.ts']);
    expect(read('src/forensics/store.ts').match(/markRelegated\(/g)?.length).toBe(1);
  });
});
