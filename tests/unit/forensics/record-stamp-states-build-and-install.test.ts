// Every record says which build wrote it and how the extension was installed.
//
// The two facts are the extension's own statement about itself, written in one place
// (finalizeRecord) so every record kind carries them: content records, the manual flag and
// the nine markers alike. Absent means "not stated": a build with nothing baked in, or a
// browser that would not say how the extension was installed, writes no value rather than
// a guessed one, and never "normal".

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import type { ForensicRecord } from '../../../src/types/forensic';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const buildId = vi.hoisted(() => ({ value: '' }));
vi.mock('../../../src/core/build-id', () => ({ getBuildId: () => buildId.value }));

type Unhashed = Omit<ForensicRecord, 'integrityHash' | 'signature'>;

function partial(): Unhashed {
  return {
    id: 'fr-stamp-1',
    timestamp: '2026-10-07T05:00:00.000Z',
    platform: 'twitter',
    originalText: 'a post',
    originalHash: 'h',
    originalLength: 6,
    neutralizedText: '',
    author: '@a',
    postUrl: '',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'adult',
    aiSource: 'none',
    feedSource: 'unknown',
    verdict: 'pass',
    chainPosition: 3,
    publicKeyFingerprint: 'fp',
  } as unknown as Unhashed;
}

function withInstallType(installType: string | Error) {
  const getSelf = vi.fn(() => (installType instanceof Error ? Promise.reject(installType) : Promise.resolve({ installType })));
  vi.stubGlobal('chrome', { management: { getSelf } });
  return getSelf;
}

async function fresh() {
  vi.resetModules();
  return import('../../../src/forensics/record-stamp');
}

beforeEach(() => { buildId.value = ''; });
afterEach(() => { vi.unstubAllGlobals(); });

describe('the stamp every record carries', () => {
  it('names the build that wrote it and the install type', async () => {
    buildId.value = 'fwbid-0e6a9d81aaaa-r2517';
    withInstallType('normal');
    const { finalizeRecord } = await fresh();
    const record = await finalizeRecord(partial());
    expect(record.stamp).toEqual({ recorderBuildId: 'fwbid-0e6a9d81aaaa-r2517', installType: 'normal' });
  });

  it('a copy loaded by hand says so', async () => {
    buildId.value = 'fwbid-mg1x2-abc123';
    withInstallType('development');
    const { finalizeRecord } = await fresh();
    expect((await finalizeRecord(partial())).stamp?.installType).toBe('development');
  });

  it('states nothing it does not know: no baked build, no answer from the browser', async () => {
    withInstallType(new Error('no management'));
    const { finalizeRecord } = await fresh();
    const record = await finalizeRecord(partial());
    expect('stamp' in record).toBe(false);
  });

  it('never writes a value Chrome did not give', async () => {
    buildId.value = 'fwbid-a-b';
    withInstallType('something-new');
    const { finalizeRecord } = await fresh();
    expect((await finalizeRecord(partial())).stamp).toEqual({ recorderBuildId: 'fwbid-a-b' });
  });

  it('asks the browser once per worker life', async () => {
    const getSelf = withInstallType('normal');
    const { finalizeRecord } = await fresh();
    await finalizeRecord(partial());
    await finalizeRecord(partial());
    expect(getSelf).toHaveBeenCalledTimes(1);
  });

  it('a browser call that failed is asked again on the next record', async () => {
    const getSelf = vi.fn()
      .mockRejectedValueOnce(new Error('busy'))
      .mockResolvedValue({ installType: 'normal' });
    vi.stubGlobal('chrome', { management: { getSelf } });
    const { finalizeRecord } = await fresh();
    expect('stamp' in (await finalizeRecord(partial()))).toBe(false);
    expect((await finalizeRecord(partial())).stamp).toEqual({ installType: 'normal' });
  });

  it('a browser that never answers does not hold the record up', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      vi.stubGlobal('chrome', { management: { getSelf: vi.fn(() => new Promise(() => {})) } });
      buildId.value = 'fwbid-a-b';
      const { finalizeRecord } = await fresh();
      const pending = finalizeRecord(partial());
      await vi.advanceTimersByTimeAsync(2000);
      expect((await pending).stamp).toEqual({ recorderBuildId: 'fwbid-a-b' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('the stamp is inside the hash', async () => {
    buildId.value = 'fwbid-a-b';
    withInstallType('normal');
    const { finalizeRecord } = await fresh();
    const { computeRecordIntegrityHash } = await import('../../../src/forensics/canonical-payload');
    const record = await finalizeRecord(partial());
    expect(record.integrityHash).toBe(await computeRecordIntegrityHash(record));
    expect(record.integrityHash).not.toBe(await computeRecordIntegrityHash(partial()));
  });
});
