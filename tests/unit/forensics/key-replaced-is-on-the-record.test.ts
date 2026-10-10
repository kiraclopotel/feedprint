// A signing key that changes under a chain says so on the chain, before any record is signed
// with the new key, and the checker reads it.
//
// A key changes in two ways: the browser lost the stored key while the record survived (a new
// key is made on the next write), or a backup brought another key back. Either way the records
// before and after are signed by different keys, and without a marker the file cannot say
// whether that is the install's own doing or a second recorder spliced in.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GapMarkerInput } from '../../../src/types/gap-marker';

const state = vi.hoisted(() => ({
  tipFingerprint: undefined as string | undefined,
  current: 'fp-new',
  origins: [] as Array<{ fingerprint: string; origin: string; at: string }>,
  written: [] as GapMarkerInput[],
  chainReadFails: false,
  fingerprintAsked: 0,
  emptyChain: false,
  markerWriteFails: false,
  storage: {} as Record<string, unknown>,
}));

vi.mock('../../../src/forensics/store', () => ({
  getChainState: async () => {
    if (state.chainReadFails) throw new Error('idb');
    if (state.emptyChain) return { nextPosition: 0, prevRecordHash: 'genesis' };
    return { nextPosition: 5, prevRecordHash: 'h', tipFingerprint: state.tipFingerprint };
  },
}));
vi.mock('../../../src/forensics/signing', () => ({
  getPublicKeyFingerprint: async () => { state.fingerprintAsked++; return state.current; },
  getSigningKeyOrigins: async () => state.origins,
}));
vi.mock('../../../src/forensics/gap-marker', async (orig) => ({
  ...(await orig<typeof import('../../../src/forensics/gap-marker')>()),
  appendGapMarkerUnderChainLock: async (input: GapMarkerInput) => {
    if (state.markerWriteFails) throw new Error('quota');
    state.written.push(input);
  },
}));

import { stateKeyReplacement } from '../../../src/forensics/key-continuity';
import { gapMarkerSummary, gapMarkerText, isGapMarkerInput } from '../../../src/forensics/gap-marker';
import { readSource } from '../../helpers/read-source';

beforeEach(() => {
  state.tipFingerprint = undefined;
  state.current = 'fp-new';
  state.origins = [];
  state.written = [];
  state.chainReadFails = false;
  state.fingerprintAsked = 0;
  state.emptyChain = false;
  state.markerWriteFails = false;
  state.storage = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (k: string) => (k in state.storage ? { [k]: state.storage[k] } : {}),
        set: async (items: Record<string, unknown>) => { Object.assign(state.storage, items); },
        remove: async (k: string) => { delete state.storage[k]; },
      },
    },
  });
});

describe('the key replacement marker', () => {
  it('is written when the newest record was signed by another key, naming both and why', async () => {
    state.tipFingerprint = 'fp-old';
    state.origins = [{ fingerprint: 'fp-new', origin: 'generated-storage-empty', at: '2026-10-07T05:00:00.000Z' }];
    const outcome = await stateKeyReplacement();
    expect(outcome.status).toBe('stated');
    expect(state.written).toHaveLength(1);
    expect(state.written[0].reason).toBe('key-replaced');
    expect(state.written[0].key).toEqual({ previous: 'fp-old', next: 'fp-new', origin: 'generated-storage-empty' });
  });

  it('says nothing when the key is the one the chain was signed with', async () => {
    state.tipFingerprint = 'fp-new';
    expect((await stateKeyReplacement()).status).toBe('same-key');
    expect(state.written).toHaveLength(0);
  });

  it('says nothing on an install with no chain, and makes no key there', async () => {
    state.emptyChain = true;
    expect((await stateKeyReplacement()).status).toBe('no-chain');
    expect(state.written).toHaveLength(0);
    expect(state.fingerprintAsked).toBe(0);
  });

  it('a newest record that names no key is reported as such, not as an empty chain', async () => {
    expect((await stateKeyReplacement()).status).toBe('tip-unnamed');
    expect(state.written).toHaveLength(0);
  });

  it('a marker whose write failed is written at the next start, though the newest record now carries the new key', async () => {
    state.tipFingerprint = 'fp-old';
    state.markerWriteFails = true;
    expect((await stateKeyReplacement()).status).toBe('failed');
    expect(state.written).toHaveLength(0);
    // Records since were signed by the new key, so the chain alone no longer shows the change.
    state.tipFingerprint = 'fp-new';
    state.markerWriteFails = false;
    const outcome = await stateKeyReplacement();
    expect(outcome.status).toBe('stated');
    expect(state.written[0].key).toMatchObject({ previous: 'fp-old', next: 'fp-new' });
    // And only once.
    expect((await stateKeyReplacement()).status).toBe('same-key');
    expect(state.written).toHaveLength(1);
  });

  it('names the restore when the caller is the restore, and "unknown" when nothing says why', async () => {
    state.tipFingerprint = 'fp-old';
    await stateKeyReplacement('restored-from-backup');
    expect(state.written[0].key?.origin).toBe('restored-from-backup');
    state.written = [];
    await stateKeyReplacement();
    expect(state.written[0].key?.origin).toBe('unknown');
  });

  it('a failed chain read writes nothing and reports the failure', async () => {
    state.chainReadFails = true;
    expect((await stateKeyReplacement()).status).toBe('failed');
    expect(state.written).toHaveLength(0);
  });

  it('the hashed line carries both fingerprints and the origin', () => {
    const input: GapMarkerInput = {
      reason: 'key-replaced', platform: 'unknown', count: 0, unit: 'records',
      fromISO: '2026-10-07T05:00:00.000Z', toISO: '2026-10-07T05:00:00.000Z',
      key: { previous: 'aaaaaaaaaaaaaaaa', next: 'bbbbbbbbbbbbbbbb', origin: 'generated-storage-empty' },
    };
    const text = gapMarkerText(input, '2026-10-07T05:00:00.000Z', false);
    expect(text).toContain('reason=key-replaced');
    expect(text).toContain(' previousKey=aaaaaaaaaaaaaaaa newKey=bbbbbbbbbbbbbbbb origin=generated-storage-empty');
    expect(gapMarkerSummary(input)).toContain('aaaaaaaaaaaaaaaa');
    expect(gapMarkerSummary(input)).toContain('bbbbbbbbbbbbbbbb');
  });

  it('the clause is written only on a key-replaced marker, and only with values of the right shape', () => {
    const base = { platform: 'unknown' as const, count: 1, unit: 'records' as const, fromISO: '2026-10-07T05:00:00.000Z', toISO: '2026-10-07T05:00:00.000Z' };
    const smuggled = { ...base, reason: 'retry-overflow' as const, key: { previous: 'aaaaaaaaaaaaaaaa', next: 'bbbbbbbbbbbbbbbb', origin: 'unknown' as const } };
    expect(gapMarkerText(smuggled, base.fromISO, false)).not.toContain('previousKey=');
    const spaced = { ...base, reason: 'key-replaced' as const, key: { previous: 'aa x reason=key-replaced', next: 'bbbbbbbbbbbbbbbb', origin: 'unknown' as const } };
    expect(gapMarkerText(spaced, base.fromISO, false)).not.toContain('previousKey=');
  });

  it('the worker asks first on every start, before anything else can sign, and the restore asks after its swap', () => {
    const sw = readSource('src/background/service-worker.ts');
    const at = sw.indexOf('void stateKeyReplacement()');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(sw.indexOf('void writePendingUpdateGap();\n\nvoid checkChainHeightOnRealmStart()'));
    const backup = readSource('src/forensics/backup.ts');
    expect(backup).toContain("stateKeyReplacementUnderChainLock(keyRestored ? 'restored-from-backup' : 'records-restored')");
  });

  it('a page cannot claim a key replacement: content messages with that reason are refused', () => {
    expect(isGapMarkerInput({
      reason: 'key-replaced', platform: 'unknown', count: 0, unit: 'records',
      fromISO: '2026-10-07T05:00:00.000Z', toISO: '2026-10-07T05:00:00.000Z',
    })).toBe(false);
  });
});
