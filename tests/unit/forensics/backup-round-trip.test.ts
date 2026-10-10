// A backup that CARRIES the history must also PUT IT BACK.
//
// `buildBackupBlob` writes `archives`, `salvage` and `historyCoverage` into
// the file (backup-covers-history.test.ts locks that half). `parseBackup`
// returned an object that carried none of them, and every restore path goes
// through it, so `backup.archives` was undefined by the time restore looked:
// the "put the history back where it belongs" block never ran once, and
// `archiveAnchors` was parsed and read by nothing.
//
// What that cost: a reinstall after a disk problem restores the full manual
// backup. The file physically holds every archived month, which on a
// long-running install is the large majority of the whole record. The active
// chain comes back, the months are parsed away in memory, and because the
// profile is fresh nothing was ever retired into a month database, so they
// stay empty. The screen reported a successful restore with a record count
// and no warning.
//
// These tests are the round trip end to end: build a backup over two archived
// months plus salvage, serialize it the way the product does, restore it into
// a fresh profile, and read the months back out. The IDB layer is faked in
// memory (vitest's node env has no IndexedDB and the project does not ship
// fake-indexeddb, the same pattern as backup-covers-history.test.ts). The
// fake is the archive's contract: append by id, read back what is there.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';

function rec(id: string, pos: number, timestamp: string): ForensicRecord {
  return {
    id,
    timestamp,
    platform: 'twitter',
    originalText: `text ${id}`,
    originalHash: `h-${id}`,
    originalLength: 6,
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    integrityHash: `ih-${id}`,
    chainPosition: pos,
  } as unknown as ForensicRecord;
}

// ─── The fake profile: month archives, salvage store, active chain ─────────
//
// One object shared by the reader mock and the writer mock, so a write really
// is readable afterwards and a test that asserts "readable" is asserting
// something. `blockedMonths` stands in for a month whose database will not
// take a write (quota, corruption, a locked file).

const profile = {
  months: new Map<string, ForensicRecord[]>(),
  salvage: [] as ForensicRecord[],
  active: [] as ForensicRecord[],
  blockedMonths: new Set<string>(),
};

function monthOf(record: ForensicRecord): string {
  const t = Date.parse(record.timestamp ?? '');
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 7) : '1970-01';
}

vi.mock('../../../src/forensics/store', () => ({
  getRecordsOrThrow: vi.fn(async () => profile.active),
  // The reader the restore's re-verify uses (M212, 2026-09-18): it answers
  // with what it read AND what it could not, so a row that will not decode
  // cannot pass as a row that was never written. This fake profile stores
  // records as objects rather than gzip envelopes, so nothing here can fail to
  // decode and `complete` is true by construction; the partial read itself is
  // driven over a real store in restore-keeps-signature-bytes.test.ts. Listed
  // because a module mock replaces the whole module: an export left out of it
  // is `undefined` at the call site, not the real function.
  getRecordsDetailed: vi.fn(async () => ({ records: profile.active, complete: true, unreadable: [] })),
  getRecords: vi.fn(async () => profile.active),
  getAllParentFeedback: vi.fn(async () => new Map()),
  replaceBackupStateUnderChainLock: vi.fn(async (records: ForensicRecord[]) => {
    profile.active = [...records];
    return { recordsAdded: records.length, anchorsAdded: 0, feedbackRestored: 0 };
  }),
}));
vi.mock('../../../src/forensics/chain-anchor-store', () => ({ getAnchors: vi.fn(async () => []) }));
vi.mock('../../../src/forensics/signing', () => ({
  getPublicKeyJWK: vi.fn(async () => ({ kty: 'EC', crv: 'P-256', x: 'x', y: 'y' })),
  getPublicKeyFingerprint: vi.fn(async () => 'fp0000000000abcd'),
  getSigningKeyCreatedAt: vi.fn(async () => null),
  exportWrappedPrivateKey: vi.fn(),
  prepareSigningKeyRestore: vi.fn(),
  commitSigningKeyRestore: vi.fn(),
}));
vi.mock('../../../src/forensics/known-keys', () => ({ rememberPublicKeys: vi.fn(async () => undefined) }));
vi.mock('../../../src/forensics/key-genesis', () => ({
  getKeyGenesis: vi.fn(async () => null),
  restoreKeyGenesis: vi.fn(async () => undefined),
}));
vi.mock('../../../src/forensics/delivery-outbox', () => ({
  getForensicDeliveryStatus: vi.fn(async () => ({ pendingCount: 0 })),
}));
vi.mock('../../../src/forensics/chain-integrity', () => ({
  verifyChainStructure: vi.fn(async () => ({ valid: true })),
  verifyChainIntegrity: vi.fn(async () => ({ valid: true })),
}));
vi.mock('../../../src/forensics/backup-folder-wire', () => ({
  getBackupFolderWireStatus: vi.fn(async () => ({ state: 'none' })),
  writeBackupToWiredFolder: vi.fn(),
  LATEST_BACKUP_FILENAME: 'feelingwise-latest.json',
  RESTORE_KEY_FILENAME: 'feelingwise-restore.key',
  restoreKeyFileContents: vi.fn((s: string) => s),
}));
vi.mock('../../../src/forensics/archive-reader', () => ({
  loadArchivesOldestFirst: vi.fn(async () =>
    Array.from(profile.months.keys()).sort().map(monthKey => ({
      monthKey,
      records: profile.months.get(monthKey) ?? [],
      anchors: [],
    })),
  ),
  readArchiveRecords: vi.fn(async (monthKey: string) => profile.months.get(monthKey) ?? []),
  readArchiveRecordsDetailed: vi.fn(async (monthKey: string) => ({
    records: profile.months.get(monthKey) ?? [],
    unreadable: [],
  })),
  countArchivedRecords: vi.fn(async () =>
    Array.from(profile.months.values()).reduce((n, m) => n + m.length, 0),
  ),
}));
vi.mock('../../../src/forensics/archive-writer', () => ({
  archiveEvictedRecords: vi.fn(async (items: Array<{ key: unknown; record: ForensicRecord }>) => {
    const archivedKeys: unknown[] = [];
    const written = new Set<string>();
    let blocked: string | undefined;
    for (const item of items) {
      const month = monthOf(item.record);
      if (profile.blockedMonths.has(month)) { blocked = month; continue; }
      const bucket = profile.months.get(month) ?? [];
      if (!bucket.some(r => r.id === item.record.id)) bucket.push(item.record);
      profile.months.set(month, bucket);
      written.add(month);
      archivedKeys.push(item.key);
    }
    if (archivedKeys.length === 0) return { ok: false, reason: `archive ${blocked} write refused` };
    return { ok: true, archivedKeys, months: Array.from(written) };
  }),
}));
vi.mock('../../../src/forensics/salvage-store', () => ({
  readSalvagedRecords: vi.fn(async () => profile.salvage),
  importSalvagedRecords: vi.fn(async (records: ForensicRecord[]) => {
    let imported = 0;
    for (const r of records) {
      if (profile.salvage.some(s => s.id === r.id)) continue;
      profile.salvage.push(r);
      imported++;
    }
    return { imported, alreadyPresent: records.length - imported, rejectedUnverified: 0, rejectedBadSignature: 0, epochs: [], importedIds: [] };
  }),
}));

import { buildBackupBlob, restoreFromBackup, parseBackup } from '../../../src/forensics/backup';

const JUNE = [rec('jun-0', 0, '2026-06-02T00:00:00.000Z'), rec('jun-1', 1, '2026-06-09T00:00:00.000Z')];
const JULY = [rec('jul-0', 2, '2026-07-03T00:00:00.000Z')];
const SALVAGED = [rec('salv-0', 0, '2026-05-01T00:00:00.000Z')];
const ACTIVE = [rec('active-0', 3, '2026-08-01T00:00:00.000Z'), rec('active-1', 4, '2026-08-02T00:00:00.000Z')];

/** The install the backup is taken from: two retired months, salvage, an active chain. */
function loadLongRunningInstall(): void {
  profile.months = new Map([['2026-06', [...JUNE]], ['2026-07', [...JULY]]]);
  profile.salvage = [...SALVAGED];
  profile.active = [...ACTIVE];
  profile.blockedMonths = new Set();
}

/** The profile after a reinstall: nothing was ever retired here, so nothing is in the months. */
function loadFreshProfile(): void {
  profile.months = new Map();
  profile.salvage = [];
  profile.active = [];
  profile.blockedMonths = new Set();
}

/** Written and read the way the product does: the file on disk is JSON text. */
async function backupFileText(): Promise<string> {
  return JSON.stringify(await buildBackupBlob());
}

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as { chrome?: unknown }).chrome = {
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) } },
    runtime: { id: 'test' },
  };
});

describe('parseBackup carries the history', () => {
  it('keeps archives, salvage and the coverage claim through a JSON round trip', async () => {
    loadLongRunningInstall();
    const parsed = parseBackup(await backupFileText());

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(Object.keys(parsed.backup.archives ?? {})).toEqual(['2026-06', '2026-07']);
    expect(parsed.backup.archives?.['2026-06'].map(r => r.id)).toEqual(['jun-0', 'jun-1']);
    expect(parsed.backup.salvage?.map(r => r.id)).toEqual(['salv-0']);
    expect(parsed.backup.historyCoverage).toBe('full');
  });
});

describe('restoreFromBackup puts the archived months back', () => {
  it('leaves every archived month readable in the fresh profile afterwards', async () => {
    loadLongRunningInstall();
    const file = await backupFileText();
    loadFreshProfile();

    const result = await restoreFromBackup(file, undefined, true);

    expect(result.ok).toBe(true);
    const { readArchiveRecords } = await import('../../../src/forensics/archive-reader');
    expect((await readArchiveRecords('2026-06')).map(r => r.id)).toEqual(['jun-0', 'jun-1']);
    expect((await readArchiveRecords('2026-07')).map(r => r.id)).toEqual(['jul-0']);
    expect(profile.salvage.map(r => r.id)).toEqual(['salv-0']);
    expect(result.archivedRestored).toBe(3);
    expect(result.salvageRestored).toBe(1);
  });

  it('restores the active chain as well, which is what it always did', async () => {
    loadLongRunningInstall();
    const file = await backupFileText();
    loadFreshProfile();

    await restoreFromBackup(file, undefined, true);

    expect(profile.active.map(r => r.id)).toEqual(['active-0', 'active-1']);
  });
});

describe('a month that will not take the write is stated, not swallowed', () => {
  it('reports the shortfall instead of a clean restore', async () => {
    loadLongRunningInstall();
    const file = await backupFileText();
    loadFreshProfile();
    profile.blockedMonths = new Set(['2026-06']);

    const result = await restoreFromBackup(file, undefined, true);

    // The active chain is back and the July month landed: a partial recovery
    // is better than none, which is why this is not a refusal.
    expect(profile.active.map(r => r.id)).toEqual(['active-0', 'active-1']);
    expect(result.archivedRestored).toBe(1);
    // What the file carried, so the gap is a subtraction anyone can check.
    expect(result.archivedExpected).toBe(3);
    expect(result.historyRestored).toBe(false);
    expect(result.historyNote).toMatch(/2026-06/);
    // The screen renders exactly one note line on a successful restore. A
    // record missing two thirds of itself must not print the intact sentence.
    expect(result.chainVerified).toBe(false);
    expect(result.chainError).toMatch(/archived/i);
  });

  it('says so when the whole history was dropped', async () => {
    loadLongRunningInstall();
    const file = await backupFileText();
    loadFreshProfile();
    profile.blockedMonths = new Set(['2026-06', '2026-07']);

    const result = await restoreFromBackup(file, undefined, true);

    expect(result.archivedRestored).toBe(0);
    expect(result.archivedExpected).toBe(3);
    expect(result.historyRestored).toBe(false);
    expect(result.chainVerified).toBe(false);
  });
});

describe('a backup with no history at all', () => {
  it('reports history as restored rather than inventing a loss', async () => {
    loadFreshProfile();
    profile.active = [...ACTIVE];
    const file = await backupFileText();
    loadFreshProfile();

    const result = await restoreFromBackup(file, undefined, true);

    expect(result.ok).toBe(true);
    expect(result.historyRestored).toBe(true);
    expect(result.archivedExpected).toBe(0);
    expect(result.chainVerified).toBe(true);
  });
});
