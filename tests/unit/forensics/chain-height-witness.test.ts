// M186's open half (2026-09-18): the chain height witness.
//
// M186 was closed halfway. `unlimitedStorage` and `persist()` stop Chrome
// evicting the origin; neither of them notices an install whose record is
// already gone, and the shape of that failure is a database that re-opens EMPTY
// and SUCCEEDING, which every screen in the product read as a record holding
// nothing. This file drives the comparison that turns that silence into a
// statement, and locks the places that must call it.
//
// Three of the cases below exist because an adversarial read of the first draft
// broke it before it shipped, and each is marked where it appears:
//   - a heartbeat lands on the fresh chain first, so "is the chain empty" is
//     defeated and the check would have disarmed itself for good
//   - a month rotation erased the only record that a loss had ever happened
//   - a reset whose marker never landed blinded the install to every later loss

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assessChainHeight,
  isChainHeightWitness,
  statedLossFacts,
  CHAIN_HEIGHT_WITNESS_KEY,
  CHAIN_RESTART_ORIGIN_KINDS,
  type ChainHeightFacts,
  type ChainHeightWitness,
} from '../../../src/forensics/chain-height-witness';
import { gapMarkerSummary, gapMarkerText, isGapMarkerInput } from '../../../src/forensics/gap-marker';
import { SYSTEM_MARKER_KINDS } from '../../../src/forensics/system-records';

const NOW = '2026-09-18T04:00:00.000Z';
const EARLIER = '2026-09-18T03:45:00.000Z';

function facts(over: Partial<ChainHeightFacts>): ChainHeightFacts {
  return { witness: null, nextPosition: 0, originKind: null, archives: null, nowISO: NOW, ...over };
}

function witnessAt(highestNextPosition: number, over: Partial<ChainHeightWitness> = {}): ChainHeightWitness {
  return { v: 1, highestNextPosition, seenAtISO: EARLIER, ...over };
}

describe('assessChainHeight', () => {
  it('adopts the current height on a fresh install, with no loss claimed', () => {
    const verdict = assessChainHeight(facts({ witness: null }));
    expect(verdict.kind).toBe('ok');
    if (verdict.kind !== 'ok') throw new Error('unreachable');
    expect(verdict.witness.highestNextPosition).toBe(0);
    expect(verdict.witness.stated).toBeUndefined();
  });

  it('raises the note as the record grows, and writes nothing when it has not moved', () => {
    const grew = assessChainHeight(facts({ witness: witnessAt(100), nextPosition: 143 }));
    expect(grew.kind).toBe('ok');
    if (grew.kind !== 'ok') throw new Error('unreachable');
    expect(grew.changed).toBe(true);
    expect(grew.witness.highestNextPosition).toBe(143);

    const still = assessChainHeight(facts({ witness: witnessAt(143), nextPosition: 143 }));
    expect(still.kind).toBe('ok');
    if (still.kind !== 'ok') throw new Error('unreachable');
    expect(still.changed).toBe(false);
  });

  // THE DEFECT. Before this module existed the product had no answer here: the
  // database came back empty, every read of it succeeded, and the dashboard
  // said the record held nothing.
  it('calls a chain shorter than the note, with nothing at position 0, a loss', () => {
    const verdict = assessChainHeight(facts({ witness: witnessAt(4213), nextPosition: 0, originKind: null }));
    expect(verdict.kind).toBe('loss');
    if (verdict.kind !== 'loss') throw new Error('unreachable');
    expect(verdict.loss.heldPositions).toBe(4213);
    expect(verdict.sinceISO).toBe(EARLIER);
    expect(verdict.witness.stated?.heldPositions).toBe(4213);
  });

  // Found by an adversarial read before this shipped. A heartbeat tick or one
  // captured post lands on the fresh chain within seconds, so a rule that asked
  // "is the chain empty" would have re-based the note to 1 and disarmed the
  // tripwire permanently on exactly the install it was built for.
  it('still calls it a loss when a heartbeat has already written on the fresh chain', () => {
    const verdict = assessChainHeight(facts({
      witness: witnessAt(4213), nextPosition: 1, originKind: 'heartbeat-marker',
    }));
    expect(verdict.kind).toBe('loss');
    if (verdict.kind !== 'loss') throw new Error('unreachable');
    expect(verdict.loss.heldPositions).toBe(4213);
  });

  it.each([...CHAIN_RESTART_ORIGIN_KINDS])(
    'treats a chain restarted by %s as a restart and writes no marker',
    (originKind) => {
      const verdict = assessChainHeight(facts({ witness: witnessAt(4213), nextPosition: 1, originKind }));
      expect(verdict.kind).toBe('restarted');
      if (verdict.kind !== 'restarted') throw new Error('unreachable');
      expect(verdict.witness.highestNextPosition).toBe(1);
      expect(verdict.witness.stated).toBeUndefined();
    },
  );

  it('every restart marker kind it trusts is a real system marker kind', () => {
    for (const kind of CHAIN_RESTART_ORIGIN_KINDS) expect(SYSTEM_MARKER_KINDS.has(kind)).toBe(true);
  });

  it('states a loss once and not on every wake after it', () => {
    const first = assessChainHeight(facts({ witness: witnessAt(4213), nextPosition: 0 }));
    if (first.kind !== 'loss') throw new Error('expected a loss');
    expect(assessChainHeight(facts({ witness: first.witness, nextPosition: 0 })).kind).toBe('ok');
    expect(assessChainHeight(facts({ witness: first.witness, nextPosition: 12 })).kind).toBe('ok');
  });

  // Found by an adversarial read before this shipped: the re-base branch built
  // a fresh note and dropped `stated`, so the next month rotation erased the
  // only record that the loss had ever happened.
  it('keeps a stated loss through a later restart', () => {
    const loss = assessChainHeight(facts({ witness: witnessAt(4213), nextPosition: 0 }));
    if (loss.kind !== 'loss') throw new Error('expected a loss');
    const rotated = assessChainHeight(facts({
      witness: { ...loss.witness, highestNextPosition: 900 },
      nextPosition: 1,
      originKind: 'month-rotation-marker',
    }));
    expect(rotated.kind).toBe('restarted');
    expect(statedLossFacts(rotated.witness)?.heldPositions).toBe(4213);
  });

  it('does not call an empty record a loss when it was never above zero', () => {
    expect(assessChainHeight(facts({ witness: witnessAt(0), nextPosition: 0 })).kind).toBe('ok');
  });
});

describe('the archives are watched as their own dimension', () => {
  // The active chain is capped and re-based every month, so its height can
  // never describe more than the current month. Without this dimension the
  // marker would have said "the chain had reached 3 positions" while every
  // archived month went with it.
  it('calls archived months falling to zero a loss even while the chain is fine', () => {
    const verdict = assessChainHeight(facts({
      witness: witnessAt(50, { highestArchives: { months: 14, records: 301_882 } }),
      nextPosition: 50,
      archives: { months: 0, records: 0 },
    }));
    expect(verdict.kind).toBe('loss');
    if (verdict.kind !== 'loss') throw new Error('unreachable');
    expect(verdict.loss.heldArchivedMonths).toBe(14);
    expect(verdict.loss.heldArchivedRecords).toBe(301_882);
    expect(verdict.loss.heldPositions).toBe(0);
  });

  it('never reads an archive it could not read as an archive that is gone', () => {
    const verdict = assessChainHeight(facts({
      witness: witnessAt(50, { highestArchives: { months: 14, records: 301_882 } }),
      nextPosition: 50,
      archives: null,
    }));
    expect(verdict.kind).toBe('ok');
  });

  it('never lowers the archive mark on a count that came back short', () => {
    const verdict = assessChainHeight(facts({
      witness: witnessAt(50, { highestArchives: { months: 14, records: 301_882 } }),
      nextPosition: 50,
      archives: { months: 14, records: 11 },
    }));
    expect(verdict.kind).toBe('ok');
    if (verdict.kind !== 'ok') throw new Error('unreachable');
    expect(verdict.witness.highestArchives).toEqual({ months: 14, records: 301_882 });
  });

  it('carries an uncounted archive as uncounted rather than as zero', () => {
    const verdict = assessChainHeight(facts({
      witness: witnessAt(50, { highestArchives: { months: 3, records: null } }),
      nextPosition: 50,
      archives: { months: 0, records: 0 },
    }));
    if (verdict.kind !== 'loss') throw new Error('expected a loss');
    expect(verdict.loss.heldArchivedRecords).toBeNull();
  });
});

describe('the stored note is untrusted input', () => {
  it('refuses anything that is not a note this build wrote', () => {
    expect(isChainHeightWitness(witnessAt(5))).toBe(true);
    expect(isChainHeightWitness(witnessAt(5, { highestArchives: { months: 2, records: null } }))).toBe(true);
    expect(isChainHeightWitness(null)).toBe(false);
    expect(isChainHeightWitness({})).toBe(false);
    expect(isChainHeightWitness({ v: 2, highestNextPosition: 5, seenAtISO: NOW })).toBe(false);
    expect(isChainHeightWitness({ v: 1, highestNextPosition: -1, seenAtISO: NOW })).toBe(false);
    expect(isChainHeightWitness({ v: 1, highestNextPosition: 1.5, seenAtISO: NOW })).toBe(false);
    expect(isChainHeightWitness({ v: 1, highestNextPosition: 5, seenAtISO: 'not a date' })).toBe(false);
    expect(isChainHeightWitness({ v: 1, highestNextPosition: 5, seenAtISO: NOW, highestArchives: { months: -1, records: 0 } })).toBe(false);
  });

  it('a corrupt note reads as no note, which adopts the current height rather than claiming a loss', () => {
    expect(assessChainHeight(facts({ witness: null, nextPosition: 0 })).kind).toBe('ok');
  });
});

describe('the chain-lost gap marker', () => {
  const input = {
    reason: 'chain-lost' as const,
    platform: 'unknown' as const,
    count: 4213,
    unit: 'records' as const,
    fromISO: EARLIER,
    toISO: NOW,
    lost: { chainPositions: 4213, archivedMonths: 0, archivedRecords: 0 },
  };

  it('is a valid gap marker input at the realm boundary', () => {
    expect(isGapMarkerInput(input)).toBe(true);
  });

  it('states the breakdown in the hashed line, so the signature covers it', () => {
    const text = gapMarkerText(input, NOW, false);
    expect(text).toContain('reason=chain-lost');
    expect(text).toContain('chainPositions=4213');
    expect(text).toContain('archivedMonths=0');
  });

  // The breakdown is appended only when present, so no marker written before
  // the field existed hashes any differently.
  it('leaves every other marker byte identical to what it was', () => {
    const { lost: _lost, ...withoutBreakdown } = input;
    const plain = gapMarkerText({ ...withoutBreakdown, reason: 'recorder-down' }, NOW, false);
    expect(plain).not.toContain('chainPositions');
    expect(plain).toBe(
      `[gap-marker @ ${NOW}] reason=recorder-down platform=unknown count=4213 unit=records from=${EARLIER} to=${NOW}`,
    );
  });

  it('says an uncounted archive is uncounted, in the hashed line and in the sentence', () => {
    const uncounted = { ...input, lost: { chainPositions: 0, archivedMonths: 3, archivedRecords: null } };
    expect(gapMarkerText(uncounted, NOW, false)).toContain('archivedRecords=uncounted');
    expect(gapMarkerSummary(uncounted)).toContain('never counted');
    expect(gapMarkerSummary(uncounted)).not.toMatch(/0 records/);
  });

  // A signed record is permanent. An earlier draft asserted a CAUSE the install
  // never established, which is the first clause a hostile reader would break.
  it('states only what the install observed, and never a cause', () => {
    const summary = gapMarkerSummary(input);
    expect(summary).toContain('4213 positions');
    expect(summary).toContain('backup');
    expect(summary).toContain('not knowable from here');
    expect(summary).not.toMatch(/whole[- ]origin clear|evicted|Chrome deleted|destroyed by/i);
    // It must never claim the entries can come back by themselves.
    expect(summary).not.toMatch(/can be recovered|restored automatically|we will recover/i);
  });

  it('says one position, not one positions', () => {
    expect(gapMarkerSummary({ ...input, lost: { chainPositions: 1, archivedMonths: 0, archivedRecords: 0 } }))
      .toContain('1 position ');
  });
});

describe('the check is wired where it can fire', () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

  // Found by an adversarial read before this shipped: the heartbeat writes a
  // record of its own, so a check running after it sees a chain of one instead
  // of a chain of none.
  it('runs before anything else writes to the chain on a fresh worker realm', () => {
    const sw = read('src/background/service-worker.ts');
    // Written as a pattern, not as a quoted specifier: the repository's path
    // resolver reads a quoted relative path in any file as a real import and
    // reported this assertion's string as a broken one.
    expect(sw).toMatch(/import \{ checkChainHeight, checkChainHeightOnRealmStart \} from '\.\/chain-height'/);
    // The two other module-scope chain writers must sit INSIDE the check's
    // continuation, not beside it. Matching the block is what proves the order;
    // counting occurrences does not, because the delivery pump is also kicked
    // from the alarm handler further up the file.
    expect(sw).toMatch(
      // `checkChainHeightOnRealmStart` since 2026-09-19: the shallow read still
      // happens on every realm, and only the archive half of it is throttled.
      // What this case is about is the ORDER, which is unchanged.
      /void checkChainHeightOnRealmStart\(\)\.then\(\(\) => \{[\s\S]{0,900}kickForensicDeliveryPump\(\);[\s\S]{0,900}runHeartbeat\('start'\);[\s\S]{0,40}\}\);/,
    );
    // And nothing may start a chain write at module scope outside that block.
    expect(sw).not.toMatch(/^void kickForensicDeliveryPump\(\);$/m);
    expect(sw).not.toMatch(/^void runHeartbeat\('start'\);$/m);
  });

  it('runs before the heartbeat on the alarm path too', () => {
    const sw = read('src/background/service-worker.ts');
    expect(sw).toMatch(/checkChainHeight\(\)\s*\n\s*\.then\(\(\) => runHeartbeat\('alarm'\)\)/);
  });

  it('never states a loss it could not establish: a record it failed to read is not a short one', () => {
    const runner = read('src/background/chain-height.ts');
    // Both of these throw on a read failure exactly so the two are never
    // confused; the runner must let that reach its own catch and report failed.
    expect(runner).toContain('getChainState(), getChainOriginKind()');
    expect(runner).toMatch(/status: 'failed'/);
  });

  // Found by an adversarial read before this shipped: an MV3 worker runs module
  // scope and the alarm that woke it in the same realm, so two unsynchronised
  // copies would each read the note before either wrote it.
  it('runs one check at a time per realm, so a loss cannot be stated twice', () => {
    const runner = read('src/background/chain-height.ts');
    expect(runner).toMatch(/let queue: Promise<ChainHeightOutcome>/);
    expect(runner).toMatch(/queue = queue\.then\(/);
  });

  it('writes the marker before it marks the note as stated, so one bad write retries instead of losing the statement', () => {
    const runner = read('src/background/chain-height.ts');
    const marker = runner.indexOf('appendGapMarker');
    const persist = runner.lastIndexOf('writeChainHeightWitness(verdict.witness)');
    expect(marker).toBeGreaterThan(-1);
    expect(persist).toBeGreaterThan(marker);
  });

  it('the acts that legitimately shorten the chain re-base the note, and await it', () => {
    const store = read('src/forensics/store.ts');
    const rotation = read('src/forensics/chain-rotation.ts');
    // A reset whose marker never landed did not clear anything, so re-basing
    // there would blind the install to every later loss.
    expect(store).toContain("if (resetMarkerWritten) await rebaseChainHeightWitness('reset', 1)");
    expect(store).toContain("await rebaseChainHeightWitness('restore'");
    expect(store).not.toContain("void rebaseChainHeightWitness(");
    expect(rotation).toContain("await rebaseChainHeightWitness('month-rotation', 1)");
  });

  it('keeps the note out of the record database, which is the whole point', () => {
    const witness = read('src/forensics/chain-height-witness.ts');
    expect(witness).toContain('chrome.storage.local');
    // A note inside the record's own database would be destroyed by the same
    // event it exists to detect, so this module never opens one.
    expect(witness).not.toContain('indexedDB.open');
    expect(witness).not.toMatch(/from '\.\/store'/);
    expect(CHAIN_HEIGHT_WITNESS_KEY).toBe('fw_chain_height_witness');
  });

  it('is not evidence and never claims to be: nothing signs, hashes or exports the note', () => {
    const witness = read('src/forensics/chain-height-witness.ts');
    expect(witness).not.toContain('computeRecordIntegrityHash');
    expect(witness).not.toContain('getPublicKeyFingerprint');
    expect(witness).not.toContain('sha256');
  });

  // The storage premise was overstated in the first draft and corrected against
  // Chrome's own documentation. The file must keep saying what it cannot catch,
  // because that limit is the honest part of the claim.
  it('states in the module itself what it cannot catch', () => {
    const witness = read('src/forensics/chain-height-witness.ts');
    expect(witness).toContain('unlimitedStorage');
    expect(witness).toMatch(/cannot survive an uninstall/);
    expect(witness).toMatch(/narrower claim/);
  });
});
