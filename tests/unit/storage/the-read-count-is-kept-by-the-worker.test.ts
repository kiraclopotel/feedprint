// @vitest-environment jsdom
//
// B10-1: Receipts counts what it read, on the device. The stored count and how it is kept.
//
// Found 30 Sep 2026 (out/auditor/A3-READ-COUNT.md): the only stored count was the scan log, which
// counts items the reading pipeline finished. It missed every comment, items the queue dropped and
// items answered from the session caches, so a quiet feed read "0 handled" and one YouTube video
// with 140 comments left a count of 2.
//
// The count is one key, readToday, written only by the service worker (the single writer of the
// usage counters), batched per page, reset by UTC day. Numbers only: no id, no author, no text.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as settings from '../../../src/storage/settings';
import { installCounterChrome, leaves, type FakeCounterChrome } from '../../helpers/fake-counter-chrome';

const { utcDayKey, utcMonthKey } = settings;

type ReadToday = { date: string } & Record<string, { posts: number; comments: number; videos: number } | string>;

let fake: FakeCounterChrome;
const read = (): ReadToday => fake.state.readToday as ReadToday;

beforeEach(() => {
  fake = installCounterChrome({ lastResetDate: utcDayKey(), lastResetMonth: utcMonthKey() });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the read count is one stored key, written by the worker', () => {
  it('items read on a platform are added by kind under today', async () => {
    await settings.applyUsageIncrement({ kind: 'items-read', platform: 'twitter', posts: 3, comments: 0, videos: 0 } as never);
    await settings.applyUsageIncrement({ kind: 'items-read', platform: 'twitter', posts: 2, comments: 4, videos: 1 } as never);
    await settings.applyUsageIncrement({ kind: 'items-read', platform: 'youtube', posts: 0, comments: 7, videos: 0 } as never);

    expect(read().date).toBe(utcDayKey());
    expect(read().twitter).toEqual({ posts: 5, comments: 4, videos: 1 });
    expect(read().youtube).toEqual({ posts: 0, comments: 7, videos: 0 });
  });

  it('two tabs counting at the same instant lose no increment', async () => {
    await Promise.all([
      settings.applyUsageIncrement({ kind: 'items-read', platform: 'facebook', posts: 10, comments: 0, videos: 0 } as never),
      settings.applyUsageIncrement({ kind: 'items-read', platform: 'facebook', posts: 15, comments: 0, videos: 0 } as never),
    ]);
    expect(read().facebook).toEqual({ posts: 25, comments: 0, videos: 0 });
  });

  it('the next day the count starts at 0 and the old day is not kept', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T22:00:00.000Z'));
    fake = installCounterChrome({ lastResetDate: utcDayKey(), lastResetMonth: utcMonthKey() });
    await settings.applyUsageIncrement({ kind: 'items-read', platform: 'twitter', posts: 9, comments: 0, videos: 0 } as never);
    expect(read().date).toBe('2026-09-15');

    vi.setSystemTime(new Date('2026-09-16T00:00:30.000Z'));
    await settings.applyUsageIncrement({ kind: 'items-read', platform: 'twitter', posts: 1, comments: 0, videos: 0 } as never);

    expect(read().date).toBe('2026-09-16');
    expect(read().twitter).toEqual({ posts: 1, comments: 0, videos: 0 });
    expect(Object.keys(read()).sort()).toEqual(['date', 'twitter']);
  });

  it('only numbers and the date are stored', async () => {
    await settings.applyUsageIncrement({ kind: 'items-read', platform: 'tiktok', posts: 2, comments: 3, videos: 4 } as never);
    for (const leaf of leaves(read())) {
      if (leaf.path === '.date') expect(leaf.value).toBe(utcDayKey());
      else expect(typeof leaf.value, leaf.path).toBe('number');
    }
  });

  it('a page batches: a hundred items read make one message, not a hundred', async () => {
    vi.useFakeTimers();
    for (let i = 0; i < 100; i++) (settings as unknown as { recordItemRead: (p: string, k: string) => void }).recordItemRead('twitter', 'post');
    await (settings as unknown as { flushItemsRead: () => Promise<void> }).flushItemsRead();

    const messages = fake.sent.filter((m) => m.type === 'USAGE_INCREMENT');
    expect(messages).toHaveLength(1);
    expect(read().twitter).toEqual({ posts: 100, comments: 0, videos: 0 });
  });

  it('a page counts posts, comments and videos apart', async () => {
    vi.useFakeTimers();
    const s = settings as unknown as { recordItemRead: (p: string, k: string) => void; flushItemsRead: () => Promise<void> };
    s.recordItemRead('tiktok', 'video');
    s.recordItemRead('tiktok', 'video');
    s.recordItemRead('tiktok', 'comment');
    s.recordItemRead('tiktok', 'post');
    await s.flushItemsRead();
    expect(read().tiktok).toEqual({ posts: 1, comments: 1, videos: 2 });
  });
});
