/** @vitest-environment jsdom */
//
// Off's first start reads settings before its filters run. If the person walks
// into a private conversation during that read, the start stops the filters
// again, which is right. It also has to leave the watch behind that starts them
// when the person walks back out to the feed; without it Off stays off in that
// tab until the page is reloaded.
//
// Every start after a conversation also watches for the recorder, which is how
// Off stands down when the recorder arrives. One watch is enough however many
// times the person goes in and out.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PRIVATE_SURFACE_POLL_MS } from '../../../src/products/off/private-surface-watch';
import { RECORDER_STAMP } from '../../../src/products/off/stand-down';

const page = vi.hoisted(() => ({
  isPrivate: false,
  pendingStarts: [] as Array<(stop: () => void) => void>,
}));

vi.mock('../../../src/content/platforms/adapter', () => ({
  detectCurrentPlatform: () => (page.isPrivate ? null : 'twitter'),
  isPrivateMessageSurface: () => page.isPrivate,
}));

const initEngagementControl = vi.hoisted(() => vi.fn(() => new Promise<() => void>((resolve) => {
  page.pendingStarts.push(resolve);
})));
vi.mock('../../../src/content/engagement/controller', () => ({ initEngagementControl }));

async function loadOff(): Promise<void> {
  await import('../../../src/products/off/content');
  await vi.advanceTimersByTimeAsync(0);
}

/** Settings arrive: the start that is waiting gets its filters' stop function. */
async function finishStart(stop: () => void): Promise<void> {
  const resolve = page.pendingStarts.shift();
  if (!resolve) throw new Error('no start is waiting');
  resolve(stop);
  await vi.advanceTimersByTimeAsync(0);
}

async function tick(): Promise<void> {
  await vi.advanceTimersByTimeAsync(PRIVATE_SURFACE_POLL_MS + 1);
}

let logs: string[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  initEngagementControl.mockClear();
  page.isPrivate = false;
  page.pendingStarts.length = 0;
  document.documentElement.removeAttribute(RECORDER_STAMP);
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { logs.push(args.join(' ')); });
});

afterEach(() => {
  document.documentElement.removeAttribute(RECORDER_STAMP);
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Off comes back after a conversation opened while it was starting', () => {
  it('starts again when the person walks back out to the feed', async () => {
    await loadOff();
    expect(initEngagementControl).toHaveBeenCalledTimes(1);

    page.isPrivate = true;
    const firstStop = vi.fn();
    await finishStart(firstStop);
    expect(firstStop, 'the filters do not run in the conversation').toHaveBeenCalledTimes(1);

    page.isPrivate = false;
    await tick();

    expect(initEngagementControl, 'the feed gets its filters back').toHaveBeenCalledTimes(2);
  });

  it('keeps one watch for the recorder however many times the person goes in and out', async () => {
    await loadOff();
    let stop = vi.fn();
    await finishStart(stop);

    for (let visit = 0; visit < 3; visit++) {
      page.isPrivate = true;
      await tick();
      page.isPrivate = false;
      await tick();
      stop = vi.fn();
      await finishStart(stop);
    }

    document.documentElement.setAttribute(RECORDER_STAMP, '1');
    await vi.advanceTimersByTimeAsync(0);

    expect(stop, 'Off stands down when the recorder arrives').toHaveBeenCalledTimes(1);
    expect(logs.filter((line) => line.includes('(the recorder) started'))).toHaveLength(1);
  });
});
