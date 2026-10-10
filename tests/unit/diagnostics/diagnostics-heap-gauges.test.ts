// @vitest-environment jsdom
//
// Registry sizes at every heap peak (src/diagnostics/diagnostics.ts,
// registerHeapGauge). After the 4 GB heap on youtube.com of 2026-09-06 the
// samples said "climbing" and nothing else. Now every registry that can pin
// memory reports its live size, and at each new peak those sizes, the DOM
// node count and the count of the extension's own nodes are written into
// the gauges as `atPeak.*`, so a pasted Copy Diagnostics names which
// registry grew with the heap, or that none did.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  _getDiagnosticCountersForTesting, _getGaugesForTesting, _resetDiagnosticsForTesting, _sampleHeapForTesting,
  HEAP_VALVE_MB, registerHeapGauge, registerHeapValve, unregisterHeapValve,
} from '../../../src/diagnostics/diagnostics';

import { REPO_ROOT as ROOT } from '../../helpers/repo-root';

let heapMB = 100;

beforeEach(() => {
  _resetDiagnosticsForTesting();
  vi.stubGlobal('chrome', { storage: { local: { get: async () => ({}), set: async () => undefined } } });
  Object.defineProperty(performance, 'memory', { configurable: true, get: () => ({ usedJSHeapSize: heapMB * 1024 * 1024 }) });
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
  _resetDiagnosticsForTesting();
});

describe('registry sizes at the heap peak', () => {
  it('records every registered gauge, the DOM node count and the fw node count when the peak rises', () => {
    let size = 3;
    registerHeapGauge('test.registry', () => size);
    document.body.innerHTML = '<div><span class="fw-marker"></span><p data-fw-neutralized="1">x</p><p>y</p></div>';
    heapMB = 100;
    _sampleHeapForTesting();
    let g = _getGaugesForTesting();
    expect(g['atPeak.test.registry']).toBe(3);
    expect(g['atPeak.fwNodes']).toBe(2);
    expect(g['atPeak.domNodes']).toBeGreaterThanOrEqual(6);

    // The heap falls: the peak stands and the recorded sizes do not move.
    size = 9;
    heapMB = 80;
    _sampleHeapForTesting();
    g = _getGaugesForTesting();
    expect(g['atPeak.test.registry']).toBe(3);

    // The heap rises past the peak: the sizes are the ones at that moment.
    size = 42;
    heapMB = 500;
    document.body.innerHTML += '<span class="fw-marker"></span>';
    _sampleHeapForTesting();
    g = _getGaugesForTesting();
    expect(g['atPeak.test.registry']).toBe(42);
    expect(g['atPeak.fwNodes']).toBe(3);
  });

  it('a gauge that throws is left out and does not stop the sample or the other gauges', () => {
    registerHeapGauge('test.broken', () => { throw new Error('no'); });
    registerHeapGauge('test.fine', () => 7);
    heapMB = 300;
    _sampleHeapForTesting();
    const g = _getGaugesForTesting();
    expect(g['atPeak.test.fine']).toBe(7);
    expect('atPeak.test.broken' in g).toBe(false);
  });

  it('the heap valve trips once past the threshold, calls every handler with the heap, counts and gauges itself, and never trips again on this page', () => {
    const calls: number[] = [];
    registerHeapValve((mb) => { calls.push(mb); });
    registerHeapValve(() => { throw new Error('one bad handler'); });
    const late: number[] = [];
    registerHeapValve((mb) => { late.push(mb); });
    heapMB = HEAP_VALVE_MB - 1;
    _sampleHeapForTesting();
    expect(calls).toEqual([]);
    heapMB = HEAP_VALVE_MB;
    _sampleHeapForTesting();
    expect(calls).toEqual([HEAP_VALVE_MB]);
    expect(late).toEqual([HEAP_VALVE_MB]);
    expect(_getDiagnosticCountersForTesting()['heap.valve']).toBe(1);
    expect(_getGaugesForTesting()['heap.valve.mb']).toBe(HEAP_VALVE_MB);
    heapMB = HEAP_VALVE_MB + 500;
    _sampleHeapForTesting();
    _sampleHeapForTesting();
    expect(calls).toEqual([HEAP_VALVE_MB]);
    expect(_getDiagnosticCountersForTesting()['heap.valve']).toBe(1);
  });

  it('an unregistered handler is not called', () => {
    const calls: number[] = [];
    const h = (mb: number) => { calls.push(mb); };
    registerHeapValve(h);
    unregisterHeapValve(h);
    heapMB = HEAP_VALVE_MB + 1;
    _sampleHeapForTesting();
    expect(calls).toEqual([]);
  });

  it('the interceptor registers its valve handler in start and removes it in stop; the handler disconnects, drops the backlog and writes the heap-valve gap; the watch-comments module disarms (source locks)', () => {
    const src = readFileSync(resolve(ROOT, 'src/content/post-path/dom-interceptor.ts'), 'utf8');
    const start = src.slice(src.indexOf('  start(): void {'), src.indexOf('this.chatOverlayActive = hasActiveChatOverlay();'));
    expect(start).toContain('registerHeapValve(this.onHeapValve);');
    const stop = src.slice(src.indexOf('  stop(): void {'));
    expect(stop).toContain('unregisterHeapValve(this.onHeapValve);');
    const handler = src.slice(src.indexOf('private readonly onHeapValve = '), src.indexOf('private tripChurnBreaker('));
    expect(handler).toContain('this.observer?.disconnect();');
    expect(handler).toContain('this._pendingNodes.clear();');
    expect(handler).toContain("noteGap('heap-valve', 1, 'events');");
    const yt = readFileSync(resolve(ROOT, 'src/content/platforms/yt-watch-comments.ts'), 'utf8');
    expect(yt).toContain('registerHeapValve(() => disarm(false));');
  });

  it('the five registries the content script keeps are registered by their modules', async () => {
    await import('../../../src/content/post-path/dom-interceptor');
    await import('../../../src/content/platforms/yt-watch-comments');
    await import('../../../src/content/engagement/ai-content-blocker');
    await import('../../../src/content/engagement/reels-blocker');
    heapMB = 1000;
    _sampleHeapForTesting();
    const g = _getGaugesForTesting();
    for (const name of ['ytWatch.seenCommentKeys', 'aiBlock.mediaObservers', 'aiBlock.blockedContainers', 'reels.containerMuteObservers']) {
      expect(g[`atPeak.${name}`], name).toBe(0);
    }
    // The interceptor registers per instance, in its constructor; without one there is no gauge yet.
    expect('atPeak.interceptor.pendingNodes' in g).toBe(false);
  });
});
