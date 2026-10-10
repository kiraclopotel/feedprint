/** @vitest-environment jsdom */
// Q24 — settings-attestation seam. Chain-writing marker paths must read
// settings through getSettingsForAttestation so a fail-closed synthetic
// snapshot (storage unreadable, getSettings returns mode:'child' +
// readFailedFallback) is NAMED in the hashed record instead of silently
// attested as a real child install.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const STORE_PATH = 'src/forensics/store.ts';
const CHAIN_ROTATION_PATH = 'src/forensics/chain-rotation.ts';
const MANUAL_FLAG_PATH = 'src/forensics/manual-flag.ts';

describe('getSettingsForAttestation', () => {
  beforeEach(() => vi.resetModules());

  it('surfaces readFailed=true on the fail-closed path', async () => {
    // No chrome at all: getSettings' read throws, no cached snapshot, so the
    // synthetic fail-closed child snapshot with readFailedFallback comes back.
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: () => Promise.reject(new Error('storage down')),
          set: () => Promise.resolve(),
        },
      },
    };
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { getSettingsForAttestation } = await import('../../../src/storage/settings');
    const a = await getSettingsForAttestation();
    expect(a.readFailed).toBe(true);
    expect(a.mode).toBe('child');
    logSpy.mockRestore();
    delete (globalThis as any).chrome;
  });

  it('surfaces readFailed=false on a healthy read', async () => {
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: () => Promise.resolve({ mode: 'adult', settingsSchemaVersion: '12' }),
          set: () => Promise.resolve(),
        },
      },
    };
    const { getSettingsForAttestation } = await import('../../../src/storage/settings');
    const a = await getSettingsForAttestation();
    expect(a.readFailed).toBe(false);
    expect(a.mode).toBe('adult');
    delete (globalThis as any).chrome;
  });
});

// Source-lock: no chain-writing marker path may read raw getSettings().
describe('marker writers use the seam', () => {
  const files = [STORE_PATH, CHAIN_ROTATION_PATH, MANUAL_FLAG_PATH];
  it('reset/rotation/manual-flag/prune all route through getSettingsForAttestation', () => {
    for (const f of files) {
      const src = readFileSync(join(process.cwd(), f), 'utf8');
      expect(src, f).toContain('getSettingsForAttestation');
      // Raw getSettings() must not appear in these chain writers at all.
      expect(src.includes('(await getSettings()).mode'), f).toBe(false);
    }
  });

  it('each writer names the fail-closed state in hashed content', () => {
    const store = readFileSync(join(process.cwd(), STORE_PATH), 'utf8');
    expect(store.match(/settings-read-failed/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    const rotation = readFileSync(join(process.cwd(), CHAIN_ROTATION_PATH), 'utf8');
    expect(rotation).toContain('settings-read-failed');
    const manual = readFileSync(join(process.cwd(), MANUAL_FLAG_PATH), 'utf8');
    expect(manual).toContain("'manual:settings-read-failed'");
  });
});
