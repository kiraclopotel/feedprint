// FeelingWise — month-rotation helpers + cross-month verification.
//
// IDB-side rotation is exercised on a real machine (vitest's Node env has
// no real IndexedDB and the project doesn't ship fake-indexeddb). This file
// covers the pure logic: UTC month math, archive DB naming, and the
// cross-month chain-of-chains walk.

import { describe, it, expect } from 'vitest';
import {
  utcMonthKey,
  previousUtcMonthKey,
  archiveDbName,
  parseArchiveDbName,
  ACTIVE_DB_VERSION,
} from '../../../src/forensics/chain-rotation';
import {
  verifyChainIntegrityAcrossMonths,
  CHAIN_GENESIS_HASH,
} from '../../../src/forensics/chain-integrity';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import { FORENSIC_DB_VERSION } from '../../../src/forensics/store';
import type { ForensicRecord } from '../../../src/types/forensic';

// ─── DB-version single-source-of-truth (regression: F-1) ───
// chain-rotation opens the SAME IndexedDB ('feelingwise-forensics') that
// store.ts created. If it opens at a LOWER version than store's current
// schema, indexedDB.open fires a VersionError and rotation silently never
// runs (chain grows unbounded, oldest evidence FIFO-deleted with no archive).
// These two constants MUST be identical — assert it so they can never drift.
describe('forensic DB version is single-sourced', () => {
  it('chain-rotation ACTIVE_DB_VERSION equals store FORENSIC_DB_VERSION', () => {
    expect(ACTIVE_DB_VERSION).toBe(FORENSIC_DB_VERSION);
  });
});

// ─── UTC month math ───

describe('utcMonthKey', () => {
  it('formats UTC year + zero-padded month', () => {
    expect(utcMonthKey(new Date(Date.UTC(2026, 4, 21)))).toBe('2026-05');
    expect(utcMonthKey(new Date(Date.UTC(2026, 0, 1)))).toBe('2026-01');
    expect(utcMonthKey(new Date(Date.UTC(2026, 11, 31, 23, 59, 59)))).toBe('2026-12');
  });

  it('is timezone-independent (UTC, not local)', () => {
    // Local-time midnight on the 1st of May in PST = April 30 UTC. The key
    // must reflect UTC, not local — otherwise crossing timezones would
    // shift the rotation boundary spuriously.
    const localMidnightMay1PST = new Date('2026-05-01T07:00:00.000Z'); // 00:00 PDT
    expect(utcMonthKey(localMidnightMay1PST)).toBe('2026-05');
  });
});

describe('previousUtcMonthKey', () => {
  it('returns the prior calendar month', () => {
    expect(previousUtcMonthKey(new Date(Date.UTC(2026, 4, 21)))).toBe('2026-04');
  });

  it('handles January (rolls to December of prior year)', () => {
    expect(previousUtcMonthKey(new Date(Date.UTC(2026, 0, 15)))).toBe('2025-12');
  });

  it('handles March 31 (no Feb 31 — Date.UTC normalizes)', () => {
    // Date.UTC(2026, 1, 31) normalizes to March 3, 2026. The prior-month
    // helper uses (month - 1), so the test confirms that branch is robust
    // to the same normalization quirk.
    expect(previousUtcMonthKey(new Date(Date.UTC(2026, 2, 15)))).toBe('2026-02');
  });
});

describe('archiveDbName / parseArchiveDbName', () => {
  it('round-trips month key through DB name', () => {
    const name = archiveDbName('2026-05');
    expect(name).toBe('feelingwise-forensics-2026-05');
    expect(parseArchiveDbName(name)).toBe('2026-05');
  });

  it('rejects non-archive names', () => {
    expect(parseArchiveDbName('feelingwise-forensics')).toBeNull();
    expect(parseArchiveDbName('feelingwise-scans')).toBeNull();
    expect(parseArchiveDbName('feelingwise-forensics-202605')).toBeNull(); // no dash
    expect(parseArchiveDbName('feelingwise-forensics-2026-5')).toBeNull(); // month not zero-padded
  });
});

// ─── Cross-month verification ───

async function makeChainRecord(
  position: number,
  prevHash: string,
  overrides: Partial<ForensicRecord> = {},
): Promise<ForensicRecord> {
  const partial: Omit<ForensicRecord, 'integrityHash' | 'signature'> = {
    id: `fr-test-${position}`,
    timestamp: new Date(Date.UTC(2026, 4, 1 + position)).toISOString(),
    platform: 'twitter',
    originalText: `record at position ${position}`,
    originalHash: 'a'.repeat(64),
    originalLength: 20,
    neutralizedText: '',
    author: 'tester',
    postUrl: 'https://x.com/tester/status/1',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'unknown',
    prevRecordHash: prevHash,
    chainPosition: position,
    verdict: 'pass',
    kind: 'post',
    ...overrides,
  };
  const integrityHash = await computeRecordIntegrityHash(partial);
  return { ...partial, integrityHash };
}

async function makeRotationMarker(
  archivedMonth: string,
  priorChainHash: string,
): Promise<ForensicRecord> {
  const partial: Omit<ForensicRecord, 'integrityHash' | 'signature'> = {
    id: `fr-rotation-${archivedMonth}`,
    timestamp: new Date(Date.UTC(2026, 5, 1)).toISOString(),
    platform: 'twitter',
    originalText: `[month-rotation @ ${archivedMonth}]`,
    originalHash: 'b'.repeat(64),
    originalLength: 40,
    neutralizedText: '',
    author: '',
    postUrl: '',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'local',
    feedSource: 'unknown',
    prevRecordHash: CHAIN_GENESIS_HASH,
    chainPosition: 0,
    chainAnchor: 'month-rotation',
    verdict: 'pass',
    kind: 'month-rotation-marker',
    priorChainHash,
  };
  const integrityHash = await computeRecordIntegrityHash(partial);
  return { ...partial, integrityHash };
}

describe('verifyChainIntegrityAcrossMonths', () => {
  it('returns valid for a single-month chain (no archives)', async () => {
    const r0 = await makeChainRecord(0, CHAIN_GENESIS_HASH);
    const r1 = await makeChainRecord(1, r0.integrityHash);
    const result = await verifyChainIntegrityAcrossMonths([r0, r1], []);
    expect(result.valid).toBe(true);
    expect(result.chainLength).toBe(2);
    expect(result.perMonth).toHaveLength(1);
    expect(result.perMonth[0].monthKey).toBe('current');
  });

  it('verifies the rotation link from archive to current', async () => {
    // Archive month: r0 → r1 → r2 (terminal hash = r2.integrityHash).
    const a0 = await makeChainRecord(0, CHAIN_GENESIS_HASH);
    const a1 = await makeChainRecord(1, a0.integrityHash);
    const a2 = await makeChainRecord(2, a1.integrityHash);
    // Current month: Rotation Marker references a2.integrityHash.
    const rotation = await makeRotationMarker('2026-05', a2.integrityHash);
    const c1 = await makeChainRecord(1, rotation.integrityHash);

    const result = await verifyChainIntegrityAcrossMonths(
      [rotation, c1],
      [{ monthKey: '2026-05', records: [a0, a1, a2] }],
    );
    expect(result.valid).toBe(true);
    expect(result.perMonth).toHaveLength(2);
    expect(result.perMonth[0].monthKey).toBe('2026-05');
    expect(result.perMonth[1].monthKey).toBe('current');
    expect(result.perMonth[1].linkToPreviousOk).toBe(true);
    // The field is on the LATER month and reads backward. Named linkToNextOk
    // until 2026-09-19, with a docblock describing the forward link, so the
    // flag on month N said whether N linked back to N-1 while its own
    // description said the opposite. Both readers had privately corrected for
    // it. These two lines are what the name now has to survive: the oldest
    // month has no previous chain and carries nothing, and the current chain
    // does carry it, because a rotation marker opens it like any other month.
    expect(result.perMonth[0].linkToPreviousOk, 'the oldest month links from nothing').toBeUndefined();
  });

  it('flags a broken cross-month link (priorChainHash wrong)', async () => {
    const a0 = await makeChainRecord(0, CHAIN_GENESIS_HASH);
    const a1 = await makeChainRecord(1, a0.integrityHash);
    // Rotation Marker claims a wrong prior hash.
    const rotation = await makeRotationMarker('2026-05', 'wrong-hash');
    const c1 = await makeChainRecord(1, rotation.integrityHash);

    const result = await verifyChainIntegrityAcrossMonths(
      [rotation, c1],
      [{ monthKey: '2026-05', records: [a0, a1] }],
    );
    expect(result.valid).toBe(false);
    expect(result.brokenKind).toBe('chain-link-mismatch');
    expect(result.perMonth[1].linkToPreviousOk).toBe(false);
  });

  it('propagates a broken archive chain (tampered record)', async () => {
    const a0 = await makeChainRecord(0, CHAIN_GENESIS_HASH);
    const a1 = await makeChainRecord(1, a0.integrityHash);
    // Tamper: mutate originalText on a1 without re-hashing.
    const a1Tampered: ForensicRecord = { ...a1, originalText: 'tampered text' };
    const rotation = await makeRotationMarker('2026-05', a1.integrityHash);

    const result = await verifyChainIntegrityAcrossMonths(
      [rotation],
      [{ monthKey: '2026-05', records: [a0, a1Tampered] }],
    );
    expect(result.valid).toBe(false);
    expect(result.brokenKind).toBe('tampered');
    expect(result.perMonth[0].result.valid).toBe(false);
  });

  it('handles missing archive gracefully (no false-positive link break)', async () => {
    // Caller didn't pass the archive records (maybe the user deleted the
    // archive DB). The cross-month link can't be established but that's
    // a UX concern, not chain tampering — don't flag as broken.
    const rotation = await makeRotationMarker('2026-05', 'unknown-hash');
    const c1 = await makeChainRecord(1, rotation.integrityHash);
    const result = await verifyChainIntegrityAcrossMonths([rotation, c1], []);
    expect(result.valid).toBe(true);
    expect(result.perMonth).toHaveLength(1);
  });

  it('sums chain lengths across months', async () => {
    const a0 = await makeChainRecord(0, CHAIN_GENESIS_HASH);
    const a1 = await makeChainRecord(1, a0.integrityHash);
    const rotation = await makeRotationMarker('2026-05', a1.integrityHash);
    const c1 = await makeChainRecord(1, rotation.integrityHash);
    const c2 = await makeChainRecord(2, c1.integrityHash);

    const result = await verifyChainIntegrityAcrossMonths(
      [rotation, c1, c2],
      [{ monthKey: '2026-05', records: [a0, a1] }],
    );
    expect(result.chainLength).toBe(5); // 2 archive + 3 current
  });
});
