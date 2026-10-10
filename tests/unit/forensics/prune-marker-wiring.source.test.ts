// Source-lock (house idiom, see dashboard-load-failed.test.ts): the FIFO
// cap prune was the one destructive chain path with no marker, so a pruned
// chain was indistinguishable from hostile deletion of a date range
// (wiring Q23). The prune must append a SIGNED marker to the live chain
// carrying the deleted count, the position range, and the newest deleted
// record's integrityHash, with the details inside originalText so the
// canonical hash covers them. Since 2026-09-06 (register item 9) the marker
// precedes the deletion and a marker that cannot be signed aborts the prune.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSource } from '../../helpers/read-source';

const STORE_PATH = 'src/forensics/store.ts';
const source = readSource(STORE_PATH);

describe('prune marker wiring', () => {
  it('the marker is written before the deletion, and a marker failure aborts the prune', () => {
    // Evidence-gap register item 9 (2026-09-06): the marker used to follow the
    // deletion, best-effort, so a failed marker left an unexplained hole that
    // the verifier (anchored at the lowest survivor) could not see. Now the
    // signed marker is pass 3 and the delete is pass 4; if signing fails,
    // nothing is deleted.
    const markerCall = source.indexOf('await appendPruneMarker(evictable.length');
    const deletePass = source.indexOf('// PASS 4: delete exactly the archived keys');
    expect(markerCall).toBeGreaterThan(0);
    expect(deletePass).toBeGreaterThan(markerCall);
    const abortBlock = source.slice(markerCall, deletePass);
    expect(abortBlock).toContain('prune marker could not be signed; nothing deleted');
    expect(abortBlock).toContain('return 0;');
    // The old best-effort-after-deletion path is gone.
    expect(source).not.toContain('prune marker write failed (prune itself completed)');
  });

  it('the marker joins the LIVE chain and is hash-covered', () => {
    const markerBlock = source.match(/async function appendPruneMarker[\s\S]{0,3000}/)?.[0] ?? '';
    // Live-chain join, not a genesis restart.
    expect(markerBlock).toContain('getChainState()');
    expect(markerBlock).toContain('chainPosition: nextPosition');
    expect(markerBlock).toContain('prevRecordHash');
    // Details ride in originalText (canonical-hashed), plus the provenance
    // fields the reset marker set the precedent for.
    expect(markerBlock).toMatch(/deleted=\$\{deleted\} cap=\$\{cap\}/);
    expect(markerBlock).toContain('priorChainHash');
    expect(markerBlock).toContain("kind: 'prune-marker'");
    expect(markerBlock).toContain("chainAnchor: 'cap-prune'");
    // Signed via the normal append path (addRecord signs + wraps).
    expect(markerBlock).toContain('await addRecord(');
    // Fail-closed settings honesty: unreadable settings are named in the
    // hashed text instead of silently attesting a child install, via the
    // Q24 attestation seam.
    expect(markerBlock).toContain('getSettingsForAttestation()');
    expect(markerBlock).toContain('attestation.readFailed');
  });
});
