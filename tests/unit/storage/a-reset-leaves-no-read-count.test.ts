// @vitest-environment jsdom
//
// B10-1 (critic 1, section 9): the data reset clears the read count with the rest.
//
// resetUsageStats zeroes every counter the product keeps about what it has done. The read count
// (readToday) is one of them, so a person who resets sees no count left behind, in storage or in
// the settings the popup reads next.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installCounterChrome, type FakeCounterChrome } from '../../helpers/fake-counter-chrome';

let fake: FakeCounterChrome;

beforeEach(() => {
  vi.resetModules();
});

describe('a reset leaves no readToday', () => {
  it('the stored count is gone after resetUsageStats', async () => {
    const settings = await import('../../../src/storage/settings');
    fake = installCounterChrome({
      lastResetDate: settings.utcDayKey(),
      lastResetMonth: settings.utcMonthKey(),
      readToday: { date: settings.utcDayKey(), twitter: { posts: 12, comments: 3, videos: 1 } },
    });
    await settings.resetUsageStats();
    expect('readToday' in fake.state).toBe(false);
  });

  it('the settings read straight after the reset show no count either', async () => {
    const settings = await import('../../../src/storage/settings');
    fake = installCounterChrome({
      lastResetDate: settings.utcDayKey(),
      lastResetMonth: settings.utcMonthKey(),
      readToday: { date: settings.utcDayKey(), youtube: { posts: 0, comments: 140, videos: 0 } },
    });
    expect((await settings.getSettings()).readToday).toBeDefined();
    await settings.resetUsageStats();
    expect((await settings.getSettings()).readToday).toBeUndefined();
  });

  it('a reset on an install that never counted writes no readToday key', async () => {
    const settings = await import('../../../src/storage/settings');
    fake = installCounterChrome({ lastResetDate: settings.utcDayKey(), lastResetMonth: settings.utcMonthKey() });
    await settings.resetUsageStats();
    expect('readToday' in fake.state).toBe(false);
  });
});
