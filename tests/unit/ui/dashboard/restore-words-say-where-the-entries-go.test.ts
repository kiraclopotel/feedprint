// A restore files the entries it takes off the record into the monthly archive, and every export of
// the whole record carries that archive, so an entry the backup lacks stays in the file and makes it
// read partly verified once the record carries on. The words around a restore must say so, not that
// the entries were replaced.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/forensics/signing', () => ({
  signHash: vi.fn(async () => 'signed'),
  verifyHash: vi.fn(async () => true),
  getPublicKeyFingerprint: vi.fn(async () => 'fp-current'),
  getPublicKeyJWK: vi.fn(async () => ({ kty: 'EC', crv: 'P-256', x: 'x', y: 'y' })),
  getSigningKeyCreatedAt: vi.fn(async () => null),
  exportWrappedPrivateKey: vi.fn(),
  prepareSigningKeyRestore: vi.fn(),
  commitSigningKeyRestore: vi.fn(),
}));
vi.mock('../../../../src/forensics/chain-anchor-store', () => ({ getAnchors: vi.fn(async () => []) }));
vi.mock('../../../../src/forensics/known-keys', () => ({ rememberPublicKeys: vi.fn(async () => undefined) }));
vi.mock('../../../../src/forensics/key-genesis', () => ({
  getKeyGenesis: vi.fn(async () => null),
  restoreKeyGenesis: vi.fn(async () => undefined),
}));
vi.mock('../../../../src/forensics/delivery-outbox', () => ({
  getForensicDeliveryStatus: vi.fn(async () => ({ pendingCount: 0 })),
}));
vi.mock('../../../../src/storage/settings', () => ({
  getSettings: vi.fn(async () => ({ mode: 'adult' })),
  getSettingsForAttestation: vi.fn(async () => ({ mode: 'adult', readFailed: false })),
  resetUsageStats: vi.fn(async () => undefined),
}));

import type { ForensicRecord } from '../../../../src/types/forensic';
import { DASHBOARD_STRINGS } from '../../../../src/i18n/dashboard-strings';
import { I18N } from '../../../../src/i18n/export-strings';
import { assembleBackup, restoreFromBackup } from '../../../../src/forensics/backup';
import { getRecordsOrThrow, openDB } from '../../../../src/forensics/store';
import { compressRecord } from '../../../../src/forensics/record-compression';
import { computeRecordIntegrityHash } from '../../../../src/forensics/canonical-payload';
import { CHAIN_GENESIS_HASH } from '../../../../src/forensics/chain-integrity';
import { archiveDbName } from '../../../../src/forensics/archive-naming';
import { deleteDbs } from '../../../helpers/indexeddb';
import { installChromeStorageStub, type ChromeStorageStub } from '../../../helpers/chrome-storage';
import { storageTestRecord } from '../../../helpers/faulty-indexeddb';

type Lang = keyof typeof DASHBOARD_STRINGS;
const LANGS = Object.keys(DASHBOARD_STRINGS) as Lang[];

/** The verdict word the export itself prints when it reads partly verified, in that language. */
const partialVerdict = (lang: Lang): string => I18N[lang].chainPartial.split(': ').pop()!;

/** Where the entries go, what carries them, and why the export reads partly verified. */
const SAYS: Record<Lang, { archive: string; wholeExport: string; why: string; restoreOrEdit: string }> = {
  en: {
    archive: 'monthly archive',
    wholeExport: 'every export of the whole record',
    why: 'two endings',
    restoreOrEdit: 'cannot tell whether a restore or an edit made them',
  },
  es: {
    archive: 'archivo mensual',
    wholeExport: 'cada exportación de todo el registro',
    why: 'dos finales',
    restoreOrEdit: 'no pueden saber si eso vino de una restauración o de alguien que cambió el registro',
  },
  'pt-BR': {
    archive: 'arquivo mensal',
    wholeExport: 'cada exportação do registro inteiro',
    why: 'dois finais',
    restoreOrEdit: 'não têm como saber se isso veio de uma restauração ou de alguém que alterou o registro',
  },
  ro: {
    archive: 'arhiva lunară',
    wholeExport: 'fiecare export al întregului registru',
    why: 'două finaluri',
    restoreOrEdit: 'nu se poate spune dacă asta vine dintr-o restaurare sau de la cineva care a modificat registrul',
  },
};

function expectSaysWhereTheyGo(text: string, lang: Lang, label: string, withRestoreOrEdit: boolean): void {
  const says = SAYS[lang];
  expect(text, `${lang} ${label}: the archive`).toContain(says.archive);
  expect(text, `${lang} ${label}: every whole-record export`).toContain(says.wholeExport);
  expect(text, `${lang} ${label}: the export's own verdict word`).toContain(partialVerdict(lang));
  expect(text, `${lang} ${label}: why`).toContain(says.why);
  if (withRestoreOrEdit) expect(text, `${lang} ${label}: a restore or an edit`).toContain(says.restoreOrEdit);
  expect(text, `${lang} ${label}`).not.toContain('—');
}

describe('the words before and after a restore say where the entries go', () => {
  it('the table covers every language the dashboard ships', () => {
    expect(Object.keys(SAYS).sort()).toEqual([...LANGS].sort());
  });

  it('the backup card says it before anyone presses a button', () => {
    for (const lang of LANGS) {
      expectSaysWhereTheyGo(DASHBOARD_STRINGS[lang].backupIntro, lang, 'backupIntro', true);
    }
  });

  it('the confirmation says it with the count, and for a single entry too', () => {
    for (const lang of LANGS) {
      const table = DASHBOARD_STRINGS[lang];
      const many = table.restoreReplaceConfirm(8);
      expect(many, lang).toContain('8');
      expectSaysWhereTheyGo(many, lang, 'restoreReplaceConfirm(8)', true);
      expectSaysWhereTheyGo(table.restoreReplaceConfirm(1), lang, 'restoreReplaceConfirm(1)', true);
    }
  });

  it('the message after the restore says it again, with both counts', () => {
    for (const lang of LANGS) {
      const table = DASHBOARD_STRINGS[lang];
      const done = table.restoreDoneNotice(6, 8);
      expect(done, lang).toContain('6');
      expect(done, lang).toContain('8');
      expectSaysWhereTheyGo(done, lang, 'restoreDoneNotice(6, 8)', false);
      expectSaysWhereTheyGo(table.restoreDoneNotice(1, 1), lang, 'restoreDoneNotice(1, 1)', false);
    }
  });

  it('after a restore that took nothing off the record, the message stops at what came back', () => {
    // The restore after a reinstall lands in an empty record, and a backup with no entries swaps
    // nothing, so there are no earlier entries to talk about and no verdict to promise either way.
    for (const lang of LANGS) {
      const table = DASHBOARD_STRINGS[lang];
      const verified = I18N[lang].chainVerified.split(': ').pop()!;
      for (const restored of [50, 1, 0]) {
        const label = `${lang} restoreDoneNotice(${restored}, 0)`;
        const done = table.restoreDoneNotice(restored, 0);
        expect(table.restoreDoneNotice(restored, 2).startsWith(`${done} `), `${label}: only the opening sentence`).toBe(true);
        expect(done, label).toContain(String(restored));
        expect(done, `${label}: the archive`).not.toContain(SAYS[lang].archive);
        expect(done, `${label}: every whole-record export`).not.toContain(SAYS[lang].wholeExport);
        expect(done, `${label}: the partial verdict`).not.toContain(partialVerdict(lang));
        expect(done, `${label}: the verified verdict`).not.toContain(verified);
      }
    }
  });

  it('the English says the entries are not deleted, and no longer that a restore replaces them', () => {
    const t = DASHBOARD_STRINGS.en;
    for (const text of [t.backupIntro, t.restoreReplaceConfirm(8), t.restoreReplaceConfirm(1), t.restorePinRequired]) {
      expect(text).not.toMatch(/restoring replaces/i);
    }
    expect(t.backupIntro).toContain('not deleted');
    expect(t.restoreReplaceConfirm(8)).toContain('not deleted');
    expect(t.restoreReplaceConfirm(1)).toContain('not deleted');
  });
});

describe('the restore itself asks in the same words the screen shows', () => {
  const DB = 'feelingwise-forensics';
  const MONTH = '2026-08';
  let storage: ChromeStorageStub;

  async function chain(count: number): Promise<ForensicRecord[]> {
    const out: ForensicRecord[] = [];
    let prev = CHAIN_GENESIS_HASH;
    for (let i = 0; i < count; i++) {
      const partial = storageTestRecord({
        id: `r${i}`,
        chainPosition: i,
        timestamp: new Date(Date.UTC(2026, 7, 10, 12, i)).toISOString(),
        prevRecordHash: prev,
        publicKeyFingerprint: 'fp-current',
      } as Partial<ForensicRecord> & { id: string });
      const integrityHash = await computeRecordIntegrityHash(partial);
      out.push({ ...partial, integrityHash, signature: 'signed' } as ForensicRecord);
      prev = integrityHash;
    }
    return out;
  }

  async function seed(records: ForensicRecord[]): Promise<void> {
    const envelopes = await Promise.all(records.map((r) => compressRecord(r)));
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite');
      for (const e of envelopes) tx.objectStore('records').add(e);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('seed aborted'));
    });
    db.close();
  }

  function backupOf(records: ForensicRecord[]): string {
    return JSON.stringify(assembleBackup({
      exportedAt: new Date().toISOString(),
      publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
      fingerprint: 'fp-current',
      records,
      anchors: [],
      parentFeedback: [],
      historyCoverage: 'active-chain-only',
    }));
  }

  beforeEach(async () => {
    storage = installChromeStorageStub();
    await deleteDbs(DB, archiveDbName(MONTH));
  });

  afterEach(async () => {
    await deleteDbs(DB, archiveDbName(MONTH));
    storage.restore();
  });

  it('pauses over entries already in the record with the English sentence the dashboard prints', async () => {
    const records = await chain(3);
    await seed(records);

    const result = await restoreFromBackup(backupOf(records.slice(0, 2)), undefined, false);

    expect(result.needsConfirm).toBe(true);
    expect(result.existingRealCount).toBe(3);
    expect(result.confirmMessage).toBe(DASHBOARD_STRINGS.en.restoreReplaceConfirm(3));
    // Asking changed nothing.
    expect((await getRecordsOrThrow()).map((r) => r.id)).toEqual(['r0', 'r1', 'r2']);
  });

  it('says the singular the same way', async () => {
    const records = await chain(1);
    await seed(records);

    const result = await restoreFromBackup(backupOf(records), undefined, false);

    expect(result.needsConfirm).toBe(true);
    expect(result.confirmMessage).toBe(DASHBOARD_STRINGS.en.restoreReplaceConfirm(1));
  });

  it('a restore into an empty record reports nothing taken off it', async () => {
    const records = await chain(3);

    const result = await restoreFromBackup(backupOf(records), undefined, false);

    expect(result.ok).toBe(true);
    expect(result.needsConfirm).toBeFalsy();
    expect(result.recordsAdded).toBe(3);
    expect(result.existingRealCount).toBe(0);
    expect(DASHBOARD_STRINGS.en.restoreDoneNotice(result.recordsAdded, result.existingRealCount!))
      .toBe('Restore finished: 3 entries are back in the record.');
  });

  it('a backup with no entries leaves the record as it was and reports nothing taken off it', async () => {
    const records = await chain(3);
    await seed(records);

    const result = await restoreFromBackup(backupOf([]), undefined, false);

    expect(result.ok).toBe(true);
    expect(result.needsConfirm).toBeFalsy();
    expect(result.recordsAdded).toBe(0);
    // The entries are still the live record, so the message must not send anyone to the archive for them.
    expect((await getRecordsOrThrow()).map((r) => r.id)).toEqual(['r0', 'r1', 'r2']);
    expect(result.existingRealCount).toBe(0);
    expect(DASHBOARD_STRINGS.en.restoreDoneNotice(result.recordsAdded, result.existingRealCount!))
      .toBe('Restore finished: 0 entries are back in the record.');
  });
});
