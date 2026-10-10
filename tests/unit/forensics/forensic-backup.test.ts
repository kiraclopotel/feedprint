// FeelingWise — forensic backup/restore PURE logic.
//
// The IDB orchestration (buildBackupBlob / restoreFromBackup) is live-verified
// on a real machine — vitest's Node env has no IndexedDB and the project does
// not ship fake-indexeddb (same pattern as chain-rotation.test.ts). These tests
// lock the correctness-critical PURE logic: parse/validate, schema-version
// gating, and id-based dedup (idempotent restore).

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { repoPath } from '../../helpers/repo-root';
import {
  BACKUP_SCHEMA_VERSION,
  assembleBackup,
  parseBackup,
  decodeBackupPayload,
  selectNewAnchors,
  backupHasWrappedKey,
  restoreNeedsConfirmation,
  isResetMarker,
  countRealChainRecords,
  type ForensicBackup,
} from '../../../src/forensics/backup';
import { sealBackupJson, SEALED_BACKUP_VERSION } from '../../../src/forensics/backup-envelope';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';
import type { ForensicRecord } from '../../../src/types/forensic';
import type { ChainAnchor } from '../../../src/forensics/chain-anchor-store';

// Minimal type-valid record — the pure functions only read `.id`, so the rest
// is filler. Cast keeps the fixture compact without weakening the id checks.
function rec(id: string): ForensicRecord {
  return { id, signature: `sig-${id}`, integrityHash: `hash-${id}`, chainPosition: 0 } as unknown as ForensicRecord;
}
function anchor(id: string): ChainAnchor {
  return { id, anchoredChainPosition: 0 } as unknown as ChainAnchor;
}

const BACKUP_PATH = 'src/forensics/backup.ts';

const emptyParts = {
  exportedAt: '2026-06-05T00:00:00.000Z',
  publicKeyJwk: { kty: 'EC' } as JsonWebKey,
  fingerprint: 'fp-abc',
  records: [] as ForensicRecord[],
  anchors: [] as ChainAnchor[],
  parentFeedback: [],
};

describe('assembleBackup', () => {
  it('stamps the current schema version and carries the parts through', () => {
    const b = assembleBackup({ ...emptyParts, records: [rec('a')] });
    expect(b.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(b.fingerprint).toBe('fp-abc');
    expect(b.records.map((r) => r.id)).toEqual(['a']);
  });
});

describe('parseBackup', () => {
  it('accepts a valid object', () => {
    const b = assembleBackup({ ...emptyParts, records: [rec('a')] });
    const r = parseBackup(b);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.backup.records.map((x) => x.id)).toEqual(['a']);
  });

  it('accepts a valid JSON string (round-trip)', () => {
    const b = assembleBackup({ ...emptyParts, records: [rec('a'), rec('b')] });
    const r = parseBackup(JSON.stringify(b));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.backup.records.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('rejects non-JSON text', () => {
    const r = parseBackup('}{ not json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/json/i);
  });

  it('rejects a non-object payload', () => {
    expect(parseBackup(42).ok).toBe(false);
    expect(parseBackup(null).ok).toBe(false);
  });

  it('rejects a payload with no schemaVersion (not a FW backup)', () => {
    const r = parseBackup({ records: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/schemaVersion/);
  });

  it('refuses a NEWER schema version rather than mis-restoring', () => {
    const r = parseBackup({ schemaVersion: BACKUP_SCHEMA_VERSION + 1, records: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/newer/i);
  });

  it('rejects a payload missing the records array', () => {
    const r = parseBackup({ schemaVersion: BACKUP_SCHEMA_VERSION });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/records/);
  });

  it('tolerates missing anchors / parentFeedback (defaults to empty)', () => {
    const r = parseBackup({ schemaVersion: BACKUP_SCHEMA_VERSION, records: [] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.backup.anchors).toEqual([]);
      expect(r.backup.parentFeedback).toEqual([]);
    }
  });
});

describe('isResetMarker / countRealChainRecords (replace-semantics gate)', () => {
  it('recognizes a reset marker by kind, detectionMode, or originalText shape', () => {
    expect(isResetMarker({ ...rec('m1'), kind: 'reset-marker' })).toBe(true);
    expect(isResetMarker({ ...rec('m2'), detectionMode: 'reset-marker' })).toBe(true);
    expect(isResetMarker({ ...rec('m3'), originalText: '[reset-marker @ 2026-06-11T00:00:00.000Z]' })).toBe(true);
  });

  it('does not flag a real evidence record as a marker', () => {
    expect(isResetMarker({ ...rec('r1'), originalText: 'a normal post', detectionMode: 'combined-detect-neutralize' })).toBe(false);
  });

  it('counts only real chained records — markers and pre-chain rows do not count', () => {
    const marker = { ...rec('m'), kind: 'reset-marker' as const, chainPosition: 0 };
    const real = { ...rec('a'), chainPosition: 1 };
    const preChain = { ...rec('p'), chainPosition: -1 };
    expect(countRealChainRecords([marker])).toBe(0);
    expect(countRealChainRecords([marker, preChain])).toBe(0);
    expect(countRealChainRecords([marker, real])).toBe(1);
    expect(countRealChainRecords([])).toBe(0);
  });
});

describe('selectNewAnchors (idempotent restore)', () => {
  it('dedups anchors by id', () => {
    const existing = new Set(['x']);
    const { toAdd, skipped } = selectNewAnchors(existing, [anchor('x'), anchor('y')]);
    expect(toAdd.map((a) => a.id)).toEqual(['y']);
    expect(skipped).toBe(1);
  });
});

describe('wrapped-key (Option A) passthrough', () => {
  const wrapped = { v: 1, kdf: 'PBKDF2', hash: 'SHA-256', iterations: 310000, salt: 'c2FsdA==', iv: 'aXY=', ciphertext: 'Y3Q=' };

  it('parseBackup preserves wrappedPrivateKey + keyCreatedAt when present', () => {
    const obj = { schemaVersion: BACKUP_SCHEMA_VERSION, records: [], wrappedPrivateKey: wrapped, keyCreatedAt: '2026-01-01T00:00:00.000Z' };
    const r = parseBackup(JSON.stringify(obj));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.backup.wrappedPrivateKey).toEqual(wrapped);
      expect(r.backup.keyCreatedAt).toBe('2026-01-01T00:00:00.000Z');
      expect(backupHasWrappedKey(r.backup)).toBe(true);
    }
  });

  it('a records-only backup reports no wrapped key', () => {
    const r = parseBackup({ schemaVersion: BACKUP_SCHEMA_VERSION, records: [] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.backup.wrappedPrivateKey).toBeUndefined();
      expect(backupHasWrappedKey(r.backup)).toBe(false);
    }
  });
});

describe('restoreNeedsConfirmation (collision guard)', () => {
  it('warns when the current chain is non-empty AND the restore would add records', () => {
    expect(restoreNeedsConfirmation(5, 10)).toBe(true);
  });
  it('does NOT warn when restoring into an empty chain (fresh reinstall)', () => {
    expect(restoreNeedsConfirmation(0, 10)).toBe(false);
  });
  it('does NOT warn when nothing new would be added (idempotent re-import)', () => {
    expect(restoreNeedsConfirmation(5, 0)).toBe(false);
  });
});

describe('decodeBackupPayload (G1 sealed envelopes + legacy plaintext)', () => {
  const backup = assembleBackup({ ...emptyParts, records: [rec('a'), rec('b')] });
  const noSecret = async () => undefined;
  const deviceSecret = 'device-secret-of-this-install';
  const withSecret = async () => deviceSecret;

  it('legacy plaintext JSON string still restores (string path unchanged)', async () => {
    const r = await decodeBackupPayload(JSON.stringify(backup), undefined, noSecret);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.backup.records.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('legacy plaintext object passes through to parseBackup', async () => {
    const r = await decodeBackupPayload(backup, undefined, noSecret);
    expect(r.ok).toBe(true);
  });

  it('still rejects non-JSON text the same way', async () => {
    const r = await decodeBackupPayload('}{ not json', undefined, noSecret);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/json/i);
  });

  it('opens a passphrase-sealed envelope with the right passphrase', async () => {
    const sealed = await sealBackupJson(JSON.stringify(backup), 'family-pass', 'passphrase');
    const r = await decodeBackupPayload(JSON.stringify(sealed), 'family-pass', noSecret);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.backup.records.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('asks for the passphrase when a passphrase-sealed envelope arrives without one', async () => {
    const sealed = await sealBackupJson(JSON.stringify(backup), 'family-pass', 'passphrase');
    const r = await decodeBackupPayload(sealed, undefined, noSecret);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/passphrase/i);
  });

  it('rejects a wrong passphrase without yielding garbage', async () => {
    const sealed = await sealBackupJson(JSON.stringify(backup), 'family-pass', 'passphrase');
    const r = await decodeBackupPayload(sealed, 'not-it', noSecret);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/wrong passphrase|corrupted/i);
  });

  it('opens a device-key envelope with the install secret (automatic backups)', async () => {
    const sealed = await sealBackupJson(JSON.stringify(backup), deviceSecret, 'device-key');
    const r = await decodeBackupPayload(sealed, undefined, withSecret);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.backup.records.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('explains a device-key envelope when no install secret exists (post-uninstall)', async () => {
    const sealed = await sealBackupJson(JSON.stringify(backup), deviceSecret, 'device-key');
    const r = await decodeBackupPayload(sealed, undefined, noSecret);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Back up now/);
  });

  it("explains a device-key envelope sealed by a DIFFERENT install (secret mismatch)", async () => {
    const sealed = await sealBackupJson(JSON.stringify(backup), 'someone-elses-secret', 'device-key');
    const r = await decodeBackupPayload(sealed, undefined, withSecret);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/different FeelingWise install/i);
  });

  // W78: the two device-key failures are the moment a parent decides their
  // record is gone. Neither may end without the other-install next step: the
  // Web Store copy and a developer build are separate extensions holding
  // separate seal keys, so the file is often openable one install away.
  it('points a no-secret device-key failure at the other install before the fallback', async () => {
    const sealed = await sealBackupJson(JSON.stringify(backup), deviceSecret, 'device-key');
    const r = await decodeBackupPayload(sealed, undefined, noSecret);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/other one/i);
      expect(r.error).toMatch(/separate/i);
      expect(r.error).toMatch(/Back up now/);
    }
  });

  it('points a secret-mismatch device-key failure at the other install before the fallback', async () => {
    const sealed = await sealBackupJson(JSON.stringify(backup), 'someone-elses-secret', 'device-key');
    const r = await decodeBackupPayload(sealed, undefined, withSecret);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/different FeelingWise install/i);
      expect(r.error).toMatch(/other one/i);
      expect(r.error).toMatch(/Back up now/);
    }
  });

  it('never leaves a device-key failure without a next step to try', async () => {
    const mismatched = await sealBackupJson(JSON.stringify(backup), 'someone-elses-secret', 'device-key');
    const orphaned = await sealBackupJson(JSON.stringify(backup), deviceSecret, 'device-key');
    for (const r of [
      await decodeBackupPayload(mismatched, undefined, withSecret),
      await decodeBackupPayload(orphaned, undefined, noSecret),
    ]) {
      expect(r.ok).toBe(false);
      // Two distinct routes offered, so the message is never a dead end.
      if (!r.ok) expect(/other one/i.test(r.error) && /Back up now/.test(r.error)).toBe(true);
    }
  });

  // W81: the message a RO parent reads at the seal mismatch was hardcoded
  // English. backup.ts now types the cause (`reason`) and the dashboard maps
  // it to DASHBOARD_STRINGS where the locale lives; the English `error` stays
  // as the fallback for callers with no string table.
  it('types the no-secret failure so the UI can localize it', async () => {
    const sealed = await sealBackupJson(JSON.stringify(backup), deviceSecret, 'device-key');
    const r = await decodeBackupPayload(sealed, undefined, noSecret);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('device-key-missing');
  });

  it('types the secret-mismatch failure so the UI can localize it', async () => {
    const sealed = await sealBackupJson(JSON.stringify(backup), 'someone-elses-secret', 'device-key');
    const r = await decodeBackupPayload(sealed, undefined, withSecret);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('device-key-mismatch');
  });

  // W82 SUPERSEDES W81's boundary here. W81 typed only the two seal causes and
  // this test pinned "everything else stays untyped" as a forward guard. W82's
  // assignment is exactly to extend the route to the rest of the path, so the
  // boundary moves: non-seal failures now carry their own reason too, and the
  // English `error` stays beside it as the fallback.
  it('types non-seal failures as well, keeping the English error as fallback', async () => {
    const wrongPass = await sealBackupJson(JSON.stringify(backup), 'family-pass', 'passphrase');
    const cases: Array<[Awaited<ReturnType<typeof decodeBackupPayload>>, string]> = [
      [await decodeBackupPayload('}{ not json', undefined, noSecret), 'not-json'],
      [await decodeBackupPayload(wrongPass, 'not-it', noSecret), 'passphrase-wrong'],
      [await decodeBackupPayload(wrongPass, undefined, noSecret), 'passphrase-required'],
    ];
    for (const [r, expected] of cases) {
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toBe(expected);
        expect(r.error.length, `${expected}: English fallback kept`).toBeGreaterThan(0);
      }
    }
  });

  it('types the structural refusals parseBackup raises', () => {
    const cases: Array<[unknown, string]> = [
      ['}{ not json', 'not-json'],
      [42, 'not-an-object'],
      [{ records: [] }, 'missing-schema-version'],
      [{ schemaVersion: BACKUP_SCHEMA_VERSION + 1, records: [] }, 'schema-too-new'],
      [{ schemaVersion: BACKUP_SCHEMA_VERSION }, 'no-records-array'],
    ];
    for (const [input, expected] of cases) {
      const r = parseBackup(input);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe(expected);
    }
  });

  it('carries the numbers the localized version refusals interpolate', async () => {
    const tooNew = parseBackup({ schemaVersion: BACKUP_SCHEMA_VERSION + 3, records: [] });
    expect(tooNew.ok).toBe(false);
    if (!tooNew.ok) {
      expect(tooNew.detail?.fileVersion).toBe(BACKUP_SCHEMA_VERSION + 3);
      expect(tooNew.detail?.supportedVersion).toBe(BACKUP_SCHEMA_VERSION);
    }
    const sealed = await sealBackupJson(JSON.stringify(backup), 'pass-word-1', 'passphrase');
    const newEnvelope = await decodeBackupPayload(
      { ...sealed, fwSealedBackup: SEALED_BACKUP_VERSION + 1 }, 'pass-word-1', noSecret,
    );
    expect(newEnvelope.ok).toBe(false);
    if (!newEnvelope.ok) {
      expect(newEnvelope.reason).toBe('seal-format-too-new');
      expect(newEnvelope.detail?.fileVersion).toBe(SEALED_BACKUP_VERSION + 1);
    }
  });

  it('carries both locales for the seal failures, recovery route in W78 order', () => {
    for (const locale of ['en', 'ro'] as const) {
      const t = DASHBOARD_STRINGS[locale];
      expect(t.restoreSealedKeyMissing, `${locale}: lead (no key here)`).toBeTruthy();
      expect(t.restoreSealedOtherInstall, `${locale}: lead (other install)`).toBeTruthy();
      const route = t.restoreSealedRecoveryRoute;
      const fallback = locale === 'en' ? 'Back up now' : 'Salvează o copie acum';
      const otherInstall = locale === 'en' ? 'separate extensions' : 'extensii separate';
      expect(route, `${locale}: route names the other install`).toContain(otherInstall);
      expect(route, `${locale}: route keeps the passphrase fallback`).toContain(fallback);
      expect(route.indexOf(otherInstall), `${locale}: other install comes first`)
        .toBeLessThan(route.indexOf(fallback));
    }
  });

  // W82: the mapping lives in the pure restore-status-text module (13 causes
  // do not belong in a ternary chain); what it produces is asserted in
  // restore-status-text.test.ts, and that the Export tab renders a typed
  // refusal through it is a behavior test on the mounted tab,
  // tests/unit/forensics/export-tab-render.test.ts. This guard keeps W81's rule.
  it('backup.ts holds no locale import', () => {
    const backupSrc = readFileSync(repoPath(...BACKUP_PATH.split(String.fromCharCode(47))), 'utf8');
    expect(backupSrc).not.toContain('dashboard-strings');
    expect(backupSrc).not.toContain('i18n');
  });

  it('refuses a NEWER envelope version rather than mis-restoring', async () => {
    const sealed = await sealBackupJson(JSON.stringify(backup), 'pass-word-1', 'passphrase');
    const r = await decodeBackupPayload({ ...sealed, fwSealedBackup: SEALED_BACKUP_VERSION + 1 }, 'pass-word-1', noSecret);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/newer/i);
  });

  it('inner payload still goes through parseBackup validation (schema gate holds)', async () => {
    const inner = JSON.stringify({ schemaVersion: BACKUP_SCHEMA_VERSION + 1, records: [] });
    const sealed = await sealBackupJson(inner, 'pass-word-1', 'passphrase');
    const r = await decodeBackupPayload(sealed, 'pass-word-1', noSecret);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/newer/i);
  });
});

describe('full round-trip shape', () => {
  it('build -> stringify -> parse preserves record ids and key material', () => {
    const original: ForensicBackup = assembleBackup({
      ...emptyParts,
      records: [rec('a'), rec('b'), rec('c')],
      anchors: [anchor('x')],
    });
    const parsed = parseBackup(JSON.stringify(original));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.backup.records.map((r) => r.id)).toEqual(['a', 'b', 'c']);
      expect(parsed.backup.anchors.map((a) => a.id)).toEqual(['x']);
      expect(parsed.backup.fingerprint).toBe('fp-abc');
      expect(parsed.backup.publicKeyJwk).toEqual({ kty: 'EC' });
    }
  });
});
