// An install or an update fetches what the stored key turns on, so a paid key's first reading after an update
// does not wait for the next popup open; a Chrome update or a shared module update fetches nothing.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const refreshes = vi.hoisted(() => ({ count: 0, fail: false }));

vi.mock('../../../src/storage/license-entitlements', () => ({
  refreshEntitlements: vi.fn(async () => {
    refreshes.count++;
    if (refreshes.fail) throw new Error('offline');
    return 'stored';
  }),
}));

import { refreshEntitlementsOnInstall } from '../../../src/background/entitlements-on-install';

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  refreshes.count = 0;
  refreshes.fail = false;
});

describe('the key is checked when the extension is installed or updated', () => {
  it.each(['install', 'update'])('%s fetches once', async (reason) => {
    refreshEntitlementsOnInstall(reason);
    await flush();
    expect(refreshes.count).toBe(1);
  });

  it.each(['chrome_update', 'shared_module_update'])('%s fetches nothing', async (reason) => {
    refreshEntitlementsOnInstall(reason);
    await flush();
    expect(refreshes.count).toBe(0);
  });

  it('a failed fetch is swallowed: the install goes on', async () => {
    refreshes.fail = true;
    expect(() => refreshEntitlementsOnInstall('update')).not.toThrow();
    await flush();
    expect(refreshes.count).toBe(1);
  });
});
