/** @vitest-environment jsdom */
//
// With both extensions on one profile, Off keeps running the switches Receipts does not have and leaves
// it the ones its stamp names, whether Receipts was on the page first or arrived after Off started.
// Beside a recorder whose stamp names nothing (Receipts up to 2.5.17, which runs every switch), Off still
// stands down whole.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RECORDER_STAMP } from '../../../src/products/off/stand-down';
import { RECEIPTS_RUNS, RECORDER_RUNS_ATTR } from '../../../src/content/engagement/recorder-runs';

const pending = vi.hoisted(() => [] as Array<(stop: () => void) => void>);
vi.mock('../../../src/content/platforms/adapter', () => ({
  detectCurrentPlatform: () => 'facebook',
  isPrivateMessageSurface: () => false,
}));
const initEngagementControl = vi.hoisted(() => vi.fn((_p: string, _o?: { leaveToRecorder?: ReadonlySet<string> }) =>
  new Promise<() => void>((resolve) => { pending.push(resolve); })));
vi.mock('../../../src/content/engagement/controller', () => ({ initEngagementControl }));

const root = document.documentElement;
async function loadOff(): Promise<void> {
  await import('../../../src/products/off/content');
  await vi.advanceTimersByTimeAsync(0);
}
async function finishStart(stop: () => void): Promise<void> {
  const resolve = pending.shift();
  if (!resolve) throw new Error('no start is waiting');
  resolve(stop);
  await vi.advanceTimersByTimeAsync(0);
}
const stampReceipts = (named: boolean) => {
  if (named) root.setAttribute(RECORDER_RUNS_ATTR, RECEIPTS_RUNS.join(' '));
  root.setAttribute(RECORDER_STAMP, '2.5.18');
};
const leftWith = (call: number) => [...(initEngagementControl.mock.calls[call]?.[1]?.leaveToRecorder ?? [])].sort();

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  initEngagementControl.mockClear();
  pending.length = 0;
  root.removeAttribute(RECORDER_STAMP);
  root.removeAttribute(RECORDER_RUNS_ATTR);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  root.removeAttribute(RECORDER_STAMP);
  root.removeAttribute(RECORDER_RUNS_ATTR);
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Off beside Receipts', () => {
  it('starts on a page Receipts already runs, leaving it the ads and the words', async () => {
    stampReceipts(true);
    await loadOff();
    expect(initEngagementControl).toHaveBeenCalledTimes(1);
    expect(leftWith(0)).toEqual(['ads', 'words']);
    const stop = vi.fn();
    await finishStart(stop);
    expect(stop, 'its own watch does not stop it').not.toHaveBeenCalled();
  });

  it('starts again from the new list when Receipts rewrites what it runs', async () => {
    root.setAttribute(RECORDER_RUNS_ATTR, 'ads slurs swearing');
    root.setAttribute(RECORDER_STAMP, '2.5.19');
    await loadOff();
    expect(leftWith(0)).toEqual(['ads', 'slurs', 'swearing']);
    const first = vi.fn();
    await finishStart(first);
    // The person turned Strict language and Block ads off in Receipts.
    root.setAttribute(RECORDER_RUNS_ATTR, 'slurs');
    await vi.advanceTimersByTimeAsync(0);
    expect(first).toHaveBeenCalledTimes(1);
    expect(initEngagementControl).toHaveBeenCalledTimes(2);
    expect(leftWith(1)).toEqual(['slurs']);
    const second = vi.fn();
    await finishStart(second);
    expect(second).not.toHaveBeenCalled();
  });

  it('starts again from the new list even when a filter does not stop cleanly', async () => {
    root.setAttribute(RECORDER_RUNS_ATTR, 'ads');
    root.setAttribute(RECORDER_STAMP, '2.5.19');
    await loadOff();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await finishStart(() => { throw new Error('a stop that throws'); });
    root.setAttribute(RECORDER_RUNS_ATTR, '');
    await vi.advanceTimersByTimeAsync(0);
    expect(initEngagementControl).toHaveBeenCalledTimes(2);
    expect(leftWith(1)).toEqual([]);
  });

  it('takes everything back when Receipts goes away under the open tab, and leaves it again when Receipts returns', async () => {
    root.setAttribute(RECORDER_RUNS_ATTR, 'ads');
    root.setAttribute(RECORDER_STAMP, '2.5.19');
    await loadOff();
    const first = vi.fn();
    await finishStart(first);
    // Receipts was updated or switched off: its stamp leaves first, then its list.
    root.removeAttribute(RECORDER_STAMP);
    root.removeAttribute(RECORDER_RUNS_ATTR);
    await vi.advanceTimersByTimeAsync(0);
    expect(first).toHaveBeenCalledTimes(1);
    expect(initEngagementControl).toHaveBeenCalledTimes(2);
    expect(initEngagementControl.mock.calls[1]?.[1]?.leaveToRecorder, 'nothing left to a recorder that is gone').toBeUndefined();
    await finishStart(vi.fn());
    root.setAttribute(RECORDER_RUNS_ATTR, 'ads');
    root.setAttribute(RECORDER_STAMP, '2.5.19');
    await vi.advanceTimersByTimeAsync(0);
    expect(initEngagementControl).toHaveBeenCalledTimes(3);
    expect(leftWith(2)).toEqual(['ads']);
  });

  it('starts again without the ads and the words when Receipts arrives after it', async () => {
    await loadOff();
    expect(leftWith(0)).toEqual([]);
    const first = vi.fn();
    await finishStart(first);
    stampReceipts(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(first).toHaveBeenCalledTimes(1);
    expect(initEngagementControl).toHaveBeenCalledTimes(2);
    expect(leftWith(1)).toEqual(['ads', 'words']);
    const second = vi.fn();
    await finishStart(second);
    expect(second).not.toHaveBeenCalled();
  });

  it('stands down whole when a recorder that names nothing arrives, even when a filter does not stop cleanly', async () => {
    await loadOff();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await finishStart(() => { throw new Error('a stop that throws'); });
    stampReceipts(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(initEngagementControl).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('standing down'));
  });

  it('stands down whole beside a recorder that names nothing', async () => {
    stampReceipts(false);
    await loadOff();
    expect(initEngagementControl).not.toHaveBeenCalled();
  });
});
