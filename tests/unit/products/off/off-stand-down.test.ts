// @vitest-environment jsdom
//
// Off stands down where the recorder runs (products/off/stand-down.ts): the
// recorder stamps the root element, Off reads it at start and watches for
// it after, so two copies of the engagement code never share a page.

import { describe, expect, it } from 'vitest';
import { RECORDER_STAMP, recorderPresent, watchRecorder } from '../../../../src/products/off/stand-down';

describe('stand-down', () => {
  it('sees the stamp at once, and a later stamp through the watcher, once', async () => {
    const root = document.createElement('div');
    expect(recorderPresent(root)).toBe(false);
    let calls = 0;
    const stop = watchRecorder(() => { calls++; }, root);
    expect(calls).toBe(0);
    root.setAttribute(RECORDER_STAMP, '2.3.0');
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(1);
    root.setAttribute(RECORDER_STAMP, '2.3.1');
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(1);
    stop();
    expect(recorderPresent(root)).toBe(true);
    const stamped = document.createElement('div');
    stamped.setAttribute(RECORDER_STAMP, '1');
    let now = 0;
    watchRecorder(() => { now++; }, stamped);
    expect(now).toBe(1);
  });
});
