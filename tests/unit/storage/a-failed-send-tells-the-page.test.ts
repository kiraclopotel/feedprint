/** @vitest-environment jsdom */
// The page is told the extension went away through the listeners that
// markContextInvalidated runs; that is how a Child cover changes from
// "checking this content" to saying what happened. A message send or the post
// queue can be the first to notice, and when either one set the dead flag by
// itself, the listeners never ran. Every later read then saw the dead flag and
// returned early, so nothing told the page afterwards either.
//
// The flag is one-way module state, so each case gets a fresh copy of the module.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Guard = typeof import('../../../src/storage/context-guard');

async function freshGuard(): Promise<Guard> {
  vi.resetModules();
  return import('../../../src/storage/context-guard');
}

const DEAD = 'Extension context invalidated.';

let info: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  info = vi.spyOn(console, 'info').mockImplementation(() => {});
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  info.mockRestore();
  warn.mockRestore();
  delete (globalThis as { chrome?: unknown }).chrome;
});

function stubSendMessage(sendMessage: unknown): void {
  (globalThis as unknown as { chrome: unknown }).chrome = { runtime: { sendMessage } };
}

describe('whichever path finds the extension gone first, the page is told', () => {
  it('a message send that rejects because the extension was reloaded', async () => {
    const guard = await freshGuard();
    let told = 0;
    guard.onContextInvalidated(() => { told++; });
    stubSendMessage(vi.fn(() => Promise.reject(new Error(DEAD))));

    await guard.safeSendMessage({ type: 'PING' });

    expect(guard.isContextAlive()).toBe(false);
    expect(told, 'the Child covers are told').toBe(1);
  });

  it('a message send that throws before it returns', async () => {
    const guard = await freshGuard();
    let told = 0;
    guard.onContextInvalidated(() => { told++; });
    stubSendMessage(vi.fn(() => { throw new Error(DEAD); }));

    expect(guard.safeSendMessage({ type: 'PING' })).toBeUndefined();

    expect(guard.isContextAlive()).toBe(false);
    expect(told, 'the Child covers are told').toBe(1);
  });

  it('a message send that finds the runtime already removed', async () => {
    const guard = await freshGuard();
    let told = 0;
    guard.onContextInvalidated(() => { told++; });
    (globalThis as unknown as { chrome: unknown }).chrome = {};

    expect(guard.safeSendMessage({ type: 'PING' })).toBeUndefined();

    expect(guard.isContextAlive()).toBe(false);
    expect(told, 'the Child covers are told').toBe(1);
  });

  it('the post queue giving up after repeated dead-extension errors', async () => {
    const guard = await freshGuard();
    let told = 0;
    guard.onContextInvalidated(() => { told++; });

    expect(guard.reportProcessingError(new Error(DEAD))).toBe(false);
    expect(guard.reportProcessingError(new Error(DEAD))).toBe(false);
    expect(told, 'not before the queue gives up').toBe(0);
    expect(guard.reportProcessingError(new Error(DEAD))).toBe(true);

    expect(guard.isContextAlive()).toBe(false);
    expect(told, 'the Child covers are told').toBe(1);
  });

  it('an ordinary failed send leaves the extension alive and tells the page nothing', async () => {
    const guard = await freshGuard();
    let told = 0;
    guard.onContextInvalidated(() => { told++; });
    stubSendMessage(vi.fn(() => Promise.reject(new Error('the handler threw'))));

    await guard.safeSendMessage({ type: 'PING' });

    expect(guard.isContextAlive()).toBe(true);
    expect(told).toBe(0);
  });
});
