// A level in Receipts sets Receipts' own switches. The switches that moved to Off keep what the install
// stored for them, schedules and per-site overrides included: Receipts reads them as off and never
// rewrites them, and a level change is no exception.

import { describe, expect, it } from 'vitest';
import { adultPreset, childPreset } from '../../../src/storage/presets';
import { OFF_ONLY_FEATURE_IDS, presetKeepingOffOnly, receiptsFeatures, withFeedprintScope } from '../../../src/storage/switch-scope';
import type { FWSettings } from '../../../src/storage/settings';

function storedByAnOlderInstall() {
  const f = adultPreset();
  f['block-reels'] = { enabled: true };
  f['media-timeout'] = { enabled: false, perPlatform: { tiktok: { enabled: true, value: { schedule: [{ from: '21:00', to: '07:00' }] } } } };
  return f;
}

describe('a level change in Receipts', () => {
  it("sets Receipts' switches from the preset and keeps Off's as stored", () => {
    const stored = storedByAnOlderInstall();
    const grid = presetKeepingOffOnly(childPreset(), stored);
    expect(grid['soften-swearing']).toEqual(childPreset()['soften-swearing']);
    for (const id of OFF_ONLY_FEATURE_IDS) expect(grid[id], id).toEqual(stored[id]);
  });

  it('writes nothing for an Off switch the install never stored, whatever the preset says', () => {
    const stored = storedByAnOlderInstall();
    delete (stored as Partial<typeof stored>)['hide-stories'];
    const grid = presetKeepingOffOnly(childPreset(), stored);
    expect('hide-stories' in grid).toBe(false);
  });

  it('reads every Off switch as off with no value, and leaves the stored object alone', () => {
    const stored = storedByAnOlderInstall();
    const before = JSON.stringify(stored);
    const scoped = receiptsFeatures(stored);
    for (const id of OFF_ONLY_FEATURE_IDS) expect(scoped[id], id).toEqual({ enabled: false });
    expect(scoped['block-ads']).toEqual(stored['block-ads']);
    expect(JSON.stringify(stored)).toBe(before);
    const settings = { features: stored, pickedBlocks: [{ id: 'p' }] } as unknown as FWSettings;
    expect(withFeedprintScope(settings).pickedBlocks).toEqual([]);
    expect(settings.pickedBlocks).toHaveLength(1);
  });
});
