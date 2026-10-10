// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';

vi.mock('../../../src/storage/settings', () => ({
  getSettings: vi.fn(async () => ({ mode: 'adult' })),
  getSettingsForAttestation: vi.fn(async () => ({ mode: 'adult', readFailed: false })),
}));

vi.mock('../../../src/forensics/store', () => ({
  addRecord: vi.fn(async () => undefined),
  getChainState: vi.fn(async () => ({ nextPosition: 4, prevRecordHash: 'prev-hash' })),
}));

vi.mock('../../../src/forensics/signing', () => ({
  getPublicKeyFingerprint: vi.fn(async () => 'fp-test'),
}));

vi.mock('../../../src/forensics/hasher', () => ({
  sha256: vi.fn(async (text: string) => `hash-${text.length}`),
}));

vi.mock('../../../src/forensics/canonical-payload', () => ({
  computeRecordIntegrityHash: vi.fn(async () => 'integrity-test'),
}));

vi.mock('../../../src/forensics/chain-write-lock', () => ({
  sharedChainWriteLock: async <T>(work: () => Promise<T>): Promise<T> => work(),
}));

import { flagPostManually } from '../../../src/forensics/manual-flag';
import { addRecord } from '../../../src/forensics/store';
import { getPublicKeyFingerprint } from '../../../src/forensics/signing';

describe('flagPostManually mode fidelity', () => {
  it('stamps the active mode on the manual forensic record', async () => {
    const result = await flagPostManually(
      'https://x.com/example/status/123',
      'parent-reviewed item',
    );

    const stored = vi.mocked(addRecord).mock.calls[0][0] as ForensicRecord;
    expect(result.record.userAgeCategory).toBe('relaxed');
    expect(stored.userAgeCategory).toBe('relaxed');
  });

  it('does not write a manual record when its signing identity is unavailable', async () => {
    vi.mocked(addRecord).mockClear();
    vi.mocked(getPublicKeyFingerprint).mockRejectedValueOnce(new Error('key unavailable'));

    await expect(flagPostManually(
      'https://x.com/example/status/456',
      'parent-reviewed item',
    )).rejects.toThrow('key unavailable');

    expect(addRecord).not.toHaveBeenCalled();
  });
});
