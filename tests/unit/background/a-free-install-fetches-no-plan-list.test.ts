// The install fetch through the real module, with a public key set as a shipped build will carry: a free install
// and a key at Strict make no network call at all; a paid key away from Strict asks once. The free return comes
// before the key check and before the fetch (src/storage/license-entitlements.ts, refreshEntitlements).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CURRENT_SETTINGS_SCHEMA_VERSION, utcDayKey, utcMonthKey } from '../../../src/storage/settings';
import { installChromeStorageStub } from '../../helpers/chrome-storage';

const BASE = { settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION, lastResetDate: utcDayKey(), lastResetMonth: utcMonthKey() };
const PAID_KEY = 'fw-starter-abc12345';

let publicKey: JsonWebKey;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
  publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey);
  fetchSpy = vi.fn(async () => ({ status: 503, json: async () => ({}) }));
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const settled = () => new Promise((r) => setTimeout(r, 20));

/** Fresh modules for each test: the settings and licence reads keep what they read first. */
async function install(reason: string): Promise<void> {
  vi.resetModules();
  const { refreshEntitlementsOnInstall } = await import('../../../src/background/entitlements-on-install');
  refreshEntitlementsOnInstall(reason, publicKey);
  await settled();
}

describe('the install fetch, with a public key set', () => {
  it('a free install makes no call, and clears whatever list was kept', async () => {
    installChromeStorageStub({ initial: { ...BASE, fw_entitlements: { payload: 'x', sig: 'y' } }, sendMessage: () => undefined });
    await install('install');
    // A missing key is read again a few times before the install counts as free, so wait for the clear itself.
    await vi.waitFor(async () => expect(await chrome.storage.local.get('fw_entitlements')).toEqual({}), { timeout: 5000 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a paid key at Strict makes no call', async () => {
    installChromeStorageStub({ initial: { ...BASE, fw_license_key: PAID_KEY, mode: 'child', levelChosen: true }, sendMessage: () => undefined });
    await install('update');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a paid key away from Strict asks once', async () => {
    installChromeStorageStub({ initial: { ...BASE, fw_license_key: PAID_KEY, mode: 'teen', levelChosen: true }, sendMessage: () => undefined });
    await install('update');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
