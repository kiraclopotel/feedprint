// The extension carries no public key yet (ENTITLEMENTS_PUBLIC_KEY_JWK is null), so nothing it stores can be verified
// and the plan gate in the AI client changes nothing today: every paid key holds the reading, a free install holds
// nothing, whatever sits in storage. This runs the real module, with no mock, so the inert path is the one tested.
// The server is the gate meanwhile (feature_missing in worker/src/proxy.ts).
import { describe, expect, it } from 'vitest';

import {
  ENTITLEMENTS_PUBLIC_KEY_JWK,
  ENTITLEMENTS_STORAGE_KEY,
  READING_FEATURE,
  licenseHoldsFeature,
  readEntitlements,
} from '../../../src/storage/license-entitlements';
import { FREE_LICENSE, type LicenseInfo } from '../../../src/storage/license';
import { installChromeStorageStub } from '../../helpers/chrome-storage';

const PAID: LicenseInfo = { tier: 'starter', secret: 'a1b2c3d4e5f6' };

/** What storage could hold: nothing, a forged answer that turns nothing on, or garbage. */
const STORED: Array<[string, Record<string, unknown>]> = [
  ['nothing stored', {}],
  ['a forged answer naming no features', {
    [ENTITLEMENTS_STORAGE_KEY]: {
      payload: JSON.stringify({ v: 1, key_fp: 'x', features: [], issued_at: '2026-10-09T00:00:00Z', valid_until: '2999-01-01T00:00:00Z' }),
      sig: 'AAAA',
    },
  }],
  ['garbage', { [ENTITLEMENTS_STORAGE_KEY]: 'not an answer' }],
];

describe('with no public key the plan gate is inert', () => {
  it('the extension ships with no public key', () => {
    expect(ENTITLEMENTS_PUBLIC_KEY_JWK).toBeNull();
  });

  it.each(STORED)('a paid key holds the reading (%s)', async (_name, initial) => {
    installChromeStorageStub({ initial, sendMessage: () => undefined });
    expect(await licenseHoldsFeature(PAID, READING_FEATURE)).toBe(true);
  });

  it.each(STORED)('a free install holds nothing (%s)', async (_name, initial) => {
    installChromeStorageStub({ initial, sendMessage: () => undefined });
    expect(await licenseHoldsFeature(FREE_LICENSE, READING_FEATURE)).toBe(false);
  });

  it('the stored key reads as legacy: the reading, and nothing else', async () => {
    installChromeStorageStub({
      initial: { fw_license_key: `fw-${PAID.tier}-${PAID.secret}` },
      sendMessage: () => undefined,
    });
    expect(await readEntitlements()).toEqual({ kind: 'legacy', features: [READING_FEATURE] });
  });
});
