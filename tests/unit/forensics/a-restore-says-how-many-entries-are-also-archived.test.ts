// After "Start a new record" the whole chain moves into the monthly archives, and a restore puts it back in the active chain, so the
// same entries stand in both places (the tester, 11 Oct 2026: "Restored 371 entries (0 already present)" while the same 371 sat in the
// archives). The export of the whole record already carries each once; what was missing was the sentence. The restore now says how many
// of the restored entries are also in the archives, and says nothing when it cannot read them. Read-only: nothing is deleted.
//
// The profile is faked in memory the way backup-round-trip.test.ts fakes it.

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


const CHAIN = [rec('a-0', 0, '2026-08-01T00:00:00.000Z'), rec('a-1', 1, '2026-08-02T00:00:00.000Z'), rec('a-2', 2, '2026-08-03T00:00:00.000Z')];

/** The install the backup comes from, then the same install after a reset: the chain sits in the archives, the active chain is empty. */
async function backupThenReset(): Promise<string> {
  profile.months = new Map();
  profile.salvage = [];
  profile.active = [...CHAIN];
  profile.blockedMonths = new Set();
  const file = JSON.stringify(await buildBackupBlob());
  profile.months = new Map([['2026-08', [...CHAIN]]]);
  profile.active = [];
  return file;
}

describe('a restore after a reset says how many entries stand in both places', () => {
  it('counts the restored entries that are also in the archives', async () => {
    const file = await backupThenReset();
    const result = await restoreFromBackup(file, undefined, true);
    expect(result.ok).toBe(true);
    expect(result.recordsAdded).toBe(3);
    expect(result.recordsAlsoArchived).toBe(3);
  });

  it('counts only the ones that are, when the archives hold some of them', async () => {
    const file = await backupThenReset();
    profile.months = new Map([['2026-08', [CHAIN[0]]]]);
    const result = await restoreFromBackup(file, undefined, true);
    expect(result.recordsAlsoArchived).toBe(1);
  });

  it('is zero for a restore into a profile whose archives hold none of them', async () => {
    const file = await backupThenReset();
    profile.months = new Map();
    const result = await restoreFromBackup(file, undefined, true);
    expect(result.recordsAlsoArchived).toBe(0);
  });

  it('is left unsaid when the archives cannot be read (not zero, which would say there is no overlap)', async () => {
    const file = await backupThenReset();
    const { loadArchivesOldestFirst } = await import('../../../src/forensics/archive-reader');
    vi.mocked(loadArchivesOldestFirst).mockRejectedValueOnce(new Error('archive database would not open'));
    const result = await restoreFromBackup(file, undefined, true);
    expect(result.ok).toBe(true);
    expect(result.recordsAlsoArchived).toBeUndefined();
  });

  it('deletes nothing: the archives still hold every entry afterwards', async () => {
    const file = await backupThenReset();
    await restoreFromBackup(file, undefined, true);
    expect(profile.months.get('2026-08')!.map((r) => r.id)).toEqual(['a-0', 'a-1', 'a-2']);
  });
});

describe('the words say it, in the four languages', () => {
  it('the restore message names the overlap only when there is one', async () => {
    const { DASHBOARD_STRINGS } = await import('../../../src/i18n/dashboard-strings');
    for (const lang of ['en', 'es', 'pt-BR', 'ro'] as const) {
      const t = DASHBOARD_STRINGS[lang];
      const plain = t.restoredMsg(371, 0, 0, 'x', '');
      const withOverlap = t.restoredMsg(371, 0, 0, 'x', '', 371);
      expect(withOverlap, lang).not.toBe(plain);
      expect(withOverlap, lang).toContain('371');
      expect(t.restoredMsg(371, 0, 0, 'x', '', 0), lang).toBe(plain);
    }
  });

  it('the count line says how many are in both and counted once, only when some are', async () => {
    const { DASHBOARD_STRINGS } = await import('../../../src/i18n/dashboard-strings');
    for (const lang of ['en', 'es', 'pt-BR', 'ro'] as const) {
      const t = DASHBOARD_STRINGS[lang];
      expect(t.everythingIncludes(371, 372, 371), lang).not.toBe(t.everythingIncludes(371, 372));
      expect(t.everythingIncludes(371, 372, 0), lang).toBe(t.everythingIncludes(371, 372));
    }
  });
});
