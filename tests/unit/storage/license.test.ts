/** @vitest-environment jsdom */
// FeelingWise — license tier resolution contract.
//
// Locks the V1 lean license behavior:
//   - parseLicenseKey accepts fw-<tier>-<secret>; rejects everything else.
//   - getLicense falls back to FREE_LICENSE silently on missing/corrupt storage.
//   - setLicense rejects malformed keys before persisting.
//   - clearLicense removes the stored key.
//   - dailyCapForTier maps Free=0, paid=2500.

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  FREE_LICENSE,
  DAILY_CAP_BY_TIER,
  LicenseInfo,
  parseLicenseKey,
  isValidLicenseKey,
  getLicense,
  hasStoredPaidLicenseKey,
  setLicense,
  clearLicense,
  dailyCapForTier,
  isUncappedTier,
  MONTHLY_USD_CAP_BY_TIER,
} from '../../../src/storage/license';

// Minimal chrome.storage.local stub mirroring the shape used by the production
// code. Same pattern as tests/unit/enable-v2-platforms-flag.test.ts.
function installStorageStub(): { state: Record<string, unknown> } {
  const state: Record<string, unknown> = {};
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: (keys: string | string[]) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of arr) {
            if (k in state) out[k] = state[k];
          }
          return Promise.resolve(out);
        },
        set: (obj: Record<string, unknown>) => {
          Object.assign(state, obj);
          return Promise.resolve();
        },
        remove: (keys: string | string[]) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          for (const k of arr) delete state[k];
          return Promise.resolve();
        },
      },
    },
  };
  return { state };
}

describe('license — parseLicenseKey', () => {
  it('parses a valid Starter key', () => {
    const out = parseLicenseKey('fw-starter-abc123def456');
    expect(out).toEqual<LicenseInfo>({ tier: 'starter', secret: 'abc123def456' }); // gitleaks:allow - deterministic parser fixture
  });

  it('parses a valid Family key', () => {
    expect(parseLicenseKey('fw-family-9x3k7p2m')).toEqual({
      tier: 'family',
      secret: '9x3k7p2m',
    });
  });

  it('parses a valid Extended key', () => {
    expect(parseLicenseKey('fw-extended-aaaa1111bbbb2222')).toEqual({
      tier: 'extended',
      secret: 'aaaa1111bbbb2222',
    });
  });

  it('rejects fw-free-* keys (free tier needs no key — silent UI green + zero AI cap was the failure mode)', () => {
    // Pre-CYCLE-N+27 the regex accepted `fw-free-*` and parseLicenseKey
    // returned `{ tier: 'free', secret: '...' }`. A parent typing such
    // a key got the "valid" UI confirmation followed by silent
    // degradation: DAILY_CAP_BY_TIER.free === 0 means no AI calls
    // happen at all. Bug 28 narrowed the regex to paid tiers only; the
    // free tier is implicit (storage empty → FREE_LICENSE fallback in
    // getLicense).
    expect(parseLicenseKey('fw-free-12345678')).toBeNull();
  });

  it('is case-insensitive on tier and secret', () => {
    expect(parseLicenseKey('FW-STARTER-ABC123DEF456')).toEqual({
      tier: 'starter',
      secret: 'abc123def456', // gitleaks:allow - deterministic parser fixture
    });
    expect(parseLicenseKey('Fw-Family-9X3K7P2M')).toEqual({
      tier: 'family',
      secret: '9x3k7p2m',
    });
  });

  it('trims surrounding whitespace', () => {
    expect(parseLicenseKey('  fw-starter-abc12345  ')).toEqual({
      tier: 'starter',
      secret: 'abc12345',
    });
  });

  it('rejects null, undefined, empty', () => {
    expect(parseLicenseKey(null)).toBeNull();
    expect(parseLicenseKey(undefined)).toBeNull();
    expect(parseLicenseKey('')).toBeNull();
  });

  it('rejects unknown tier', () => {
    expect(parseLicenseKey('fw-pro-abc12345')).toBeNull();
    expect(parseLicenseKey('fw-business-abc12345')).toBeNull();
    expect(parseLicenseKey('fw-trial-abc12345')).toBeNull();
  });

  it('rejects missing prefix', () => {
    expect(parseLicenseKey('starter-abc12345')).toBeNull();
    expect(parseLicenseKey('abc12345')).toBeNull();
  });

  it('rejects secret too short (<8 chars)', () => {
    expect(parseLicenseKey('fw-starter-abc1234')).toBeNull();
    expect(parseLicenseKey('fw-starter-x')).toBeNull();
  });

  it('rejects secret too long (>32 chars)', () => {
    expect(parseLicenseKey('fw-starter-' + 'a'.repeat(33))).toBeNull();
  });

  it('rejects secret with disallowed characters', () => {
    expect(parseLicenseKey('fw-starter-abc-def-12')).toBeNull();
    expect(parseLicenseKey('fw-starter-abc def12')).toBeNull();
    expect(parseLicenseKey('fw-starter-abc!1234')).toBeNull();
  });

  it('rejects malformed structure (extra parts, missing parts)', () => {
    expect(parseLicenseKey('fw-starter')).toBeNull();
    expect(parseLicenseKey('fw-starter-')).toBeNull();
    expect(parseLicenseKey('fw-starter-abc12345-extra')).toBeNull();
  });
});

describe('license — isValidLicenseKey', () => {
  it('mirrors parseLicenseKey on valid + invalid inputs', () => {
    expect(isValidLicenseKey('fw-starter-abc12345')).toBe(true);
    expect(isValidLicenseKey('not-a-key')).toBe(false);
    expect(isValidLicenseKey(null)).toBe(false);
  });
});

describe('license — getLicense', () => {
  beforeEach(() => {
    installStorageStub();
  });

  it('returns FREE_LICENSE when storage is empty', async () => {
    expect(await getLicense()).toEqual(FREE_LICENSE);
  });

  it('returns parsed license when storage has a valid key', async () => {
    await chrome.storage.local.set({ fw_license_key: 'fw-starter-abc12345' });
    expect(await getLicense()).toEqual({ tier: 'starter', secret: 'abc12345' });
  });

  it('falls back to FREE_LICENSE when stored value is corrupt', async () => {
    await chrome.storage.local.set({ fw_license_key: 'this-is-garbage' });
    expect(await getLicense()).toEqual(FREE_LICENSE);
  });

  it('falls back to FREE_LICENSE when storage value is non-string', async () => {
    await chrome.storage.local.set({ fw_license_key: 12345 as any });
    expect(await getLicense()).toEqual(FREE_LICENSE);
  });

  // M24 — distinguish the expected silent-FREE path (missing key) from a thrown
  // chrome.storage error. A thrown read error means a paid user's tier read
  // failed and the AI classifier silently turned off; that must be warn-logged
  // so the cause is visible in the extension error log. A missing key is a
  // fresh/free install and must stay silent.
  it('warn-logs and returns FREE_LICENSE when storage.local.get throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (globalThis as any).chrome.storage.local.get = () =>
      Promise.reject(new Error('storage IO error'));

    expect(await getLicense()).toEqual(FREE_LICENSE);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toMatch(/storage read failed/i);
    warnSpy.mockRestore();
  });

  it('returns FREE_LICENSE silently (no warn) when the key is missing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await getLicense()).toEqual(FREE_LICENSE);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // Regression: a dev/paid user under heavy video I/O must NOT collapse to FREE
  // on a transient storage blip. A single momentary read failure is retried and
  // recovers the real license — no warn, no free fallback.
  it('recovers a dev license when the first read blips, then succeeds (retry)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await chrome.storage.local.set({ fw_license_key: 'fw-dev-founder01' });
    let calls = 0;
    const realGet = (globalThis as any).chrome.storage.local.get;  
    (globalThis as any).chrome.storage.local.get = (keys: string | string[]) => {
      calls++;
      if (calls === 1) return Promise.reject(new Error('storage IO error'));
      return realGet(keys);
    };
    expect(await getLicense()).toEqual({ tier: 'dev', secret: 'founder01' });
    expect(calls).toBeGreaterThanOrEqual(2); // proves it retried
    expect(warnSpy).not.toHaveBeenCalled(); // recovered → no scary log
    warnSpy.mockRestore();
  });

  // When the blip persists past every retry, the last-known paid/dev license is
  // returned (the in-memory cache), NOT FREE — so the AI/video features stay on.
  it('falls back to the last-known dev license when the read fails persistently', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await chrome.storage.local.set({ fw_license_key: 'fw-dev-founder01' });
    // Warm the in-memory cache with one good read.
    expect(await getLicense()).toEqual({ tier: 'dev', secret: 'founder01' });
    // Now every read fails (non-context) — the cache must keep the user dev.
    (globalThis as any).chrome.storage.local.get = () =>
      Promise.reject(new Error('storage IO error'));
    expect(await getLicense()).toEqual({ tier: 'dev', secret: 'founder01' });
    expect(warnSpy).toHaveBeenCalledTimes(1); // surfaced once, but stayed dev
    warnSpy.mockRestore();
  });
});

describe('license — hasStoredPaidLicenseKey (diagnostics discriminator)', () => {
  beforeEach(() => {
    installStorageStub();
  });

  // Q50 (W52): tri-state. The old boolean reported false on a read FAILURE,
  // which read as "genuine free tier" during the exact storage-blip window
  // the diagnostic exists for.

  it("is 'absent' when no key is stored (genuine free user)", async () => {
    expect(await hasStoredPaidLicenseKey()).toBe('absent');
  });

  it("is 'absent' when a fw-free key is stored (regex rejects free)", async () => {
    await chrome.storage.local.set({ fw_license_key: 'fw-free-abc12345' });
    expect(await hasStoredPaidLicenseKey()).toBe('absent');
  });

  it("is 'present' when a paid key is stored", async () => {
    await chrome.storage.local.set({ fw_license_key: 'fw-starter-abc12345' });
    expect(await hasStoredPaidLicenseKey()).toBe('present');
  });

  it("is 'present' when a dev key is stored", async () => {
    await chrome.storage.local.set({ fw_license_key: 'fw-dev-founder01' });
    expect(await hasStoredPaidLicenseKey()).toBe('present');
  });

  it("is 'unreadable' (never throws, never claims free) when the read fails persistently", async () => {
    await chrome.storage.local.set({ fw_license_key: 'fw-dev-founder01' });
    (globalThis as any).chrome.storage.local.get = () =>
      Promise.reject(new Error('storage IO error'));
    expect(await hasStoredPaidLicenseKey()).toBe('unreadable');
  });
});

describe('license — setLicense', () => {
  beforeEach(async () => {
    installStorageStub();
    // Start from a cold in-memory license cache. getLicense no longer nulls
    // lastGoodPaidLicense on an empty read (that is now a transient-blip signal),
    // so a paid tier read from an earlier suite would otherwise leak in and mask
    // the empty-storage FREE expectation here. clearLicense() is the sanctioned reset.
    await clearLicense();
  });

  it('rejects malformed keys without persisting', async () => {
    const result = await setLicense('garbage');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/format invalid/i);
    }
    expect(await getLicense()).toEqual(FREE_LICENSE);
  });

  it('persists a valid key in canonical (lowercased+trimmed) form', async () => {
    const result = await setLicense('  FW-STARTER-ABC12345  ');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.license).toEqual({ tier: 'starter', secret: 'abc12345' });
    }
    const stored = await chrome.storage.local.get('fw_license_key');
    expect(stored.fw_license_key).toBe('fw-starter-abc12345');
  });

  it('overwrites a previously stored key', async () => {
    await setLicense('fw-starter-aaaa1111');
    await setLicense('fw-family-bbbb2222');
    expect(await getLicense()).toEqual({ tier: 'family', secret: 'bbbb2222' });
  });
});

describe('license — clearLicense', () => {
  beforeEach(() => {
    installStorageStub();
  });

  it('removes the stored key (next getLicense returns FREE_LICENSE)', async () => {
    await setLicense('fw-starter-abc12345');
    await clearLicense();
    expect(await getLicense()).toEqual(FREE_LICENSE);
  });

  it('is a no-op when no key is stored', async () => {
    await clearLicense();
    expect(await getLicense()).toEqual(FREE_LICENSE);
  });
});

describe('license — dailyCapForTier', () => {
  it('Free tier resolves to 0 (no AI calls)', () => {
    expect(dailyCapForTier('free')).toBe(0);
  });

  it('Starter tier resolves to 2000', () => {
    expect(dailyCapForTier('starter')).toBe(2000);
  });

  it('Family tier resolves to 2000 (per-user; multi-user enforcement is V2)', () => {
    expect(dailyCapForTier('family')).toBe(2000);
  });

  it('Extended tier resolves to 2000', () => {
    expect(dailyCapForTier('extended')).toBe(2000);
  });

  it('DAILY_CAP_BY_TIER exhausts the LicenseTier union', () => {
    // Defensive: if a new tier is added to the type, this test catches missing
    // map entries at TS-check time AND at runtime.
    const tiers: ReadonlyArray<keyof typeof DAILY_CAP_BY_TIER> = [
      'free',
      'starter',
      'family',
      'extended',
      'dev',
    ];
    for (const t of tiers) {
      expect(typeof DAILY_CAP_BY_TIER[t]).toBe('number');
    }
  });
});

describe('license — dev (founder) uncapped tier', () => {
  it('parses a fw-dev-<secret> key', () => {
    expect(parseLicenseKey('fw-dev-founder01')).toEqual({ tier: 'dev', secret: 'founder01' });
  });

  it('isUncappedTier is true only for dev', () => {
    expect(isUncappedTier('dev')).toBe(true);
    expect(isUncappedTier('starter')).toBe(false);
    expect(isUncappedTier('family')).toBe(false);
    expect(isUncappedTier('extended')).toBe(false);
    expect(isUncappedTier('free')).toBe(false);
  });

  it('dev caps sit far above any customer cap', () => {
    expect(dailyCapForTier('dev')).toBeGreaterThan(dailyCapForTier('starter'));
    expect(MONTHLY_USD_CAP_BY_TIER.dev).toBeGreaterThan(MONTHLY_USD_CAP_BY_TIER.starter);
  });

  it('persists + reloads a dev key through storage', async () => {
    const res = await setLicense('fw-dev-Founder01');
    expect(res.ok).toBe(true);
    expect(await getLicense()).toEqual({ tier: 'dev', secret: 'founder01' });
  });
});
