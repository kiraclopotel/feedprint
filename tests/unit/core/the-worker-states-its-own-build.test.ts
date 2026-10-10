// The worker states the build baked into its own file. The build id module is shared with the
// dashboard, so the bundler puts it in a chunk; the worker hands in its own baked id at start, and
// every reader in the worker then gets that one. The built file itself is held by
// scripts/check-sw-bundle.mjs gate 4, which finds exactly one id in service-worker.js.

import { describe, expect, it, vi } from 'vitest';
import { readSource } from '../../helpers/read-source';

async function fresh() {
  vi.resetModules();
  return import('../../../src/core/build-id');
}

describe('the worker states its own build', () => {
  it('an id handed in is the one every reader gets', async () => {
    const { getBuildId, provideBuildId } = await fresh();
    expect(getBuildId(), 'nothing baked under the tests').toBe('');
    provideBuildId('fwbid-mg1x2-abc123');
    expect(getBuildId()).toBe('fwbid-mg1x2-abc123');
  });

  it('an empty id leaves the module\'s own reading in place', async () => {
    const { getBuildId, provideBuildId } = await fresh();
    provideBuildId('');
    expect(getBuildId()).toBe('');
  });

  it('the worker hands in the id baked into its own file, at the top level, before any handler', () => {
    const src = readSource('src/background/service-worker.ts');
    const call = src.indexOf('provideBuildId(typeof __FW_BUILD_ID__');
    expect(call).toBeGreaterThan(0);
    expect(src.lastIndexOf('\n', call) + 1, 'a top-level statement').toBe(call);
    expect(call).toBeLessThan(src.indexOf('chrome.runtime.onMessage.addListener'));
  });
});
