// The observer rate breaker (src/content/post-path/churn-breaker.ts). A burst that
// ends inside the sustain period never trips; a rate that stays hot for the
// whole period trips once, stays open for the cooldown, and closes on its own.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ChurnBreaker } from '../../../../src/content/post-path/churn-breaker';

import { REPO_ROOT as ROOT } from '../../../helpers/repo-root';
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8');

describe('the two observers consult their breaker first, stand down as a signed gap, and re-arm (source locks)', () => {
  it('the interceptor: the note is the first statement of the observer callback; a trip disconnects, notes a gap in events, re-observes after the cooldown, and stop clears the re-arm', () => {
    const src = read('src/content/post-path/dom-interceptor.ts');
    const cb = src.indexOf('this.observer = new MutationObserver((mutations) => {');
    expect(cb).toBeGreaterThan(-1);
    const head = src.slice(cb, cb + 400);
    expect(head).toContain('const churn = this.churn.note();');
    expect(head.indexOf('this.churn.note()')).toBeLessThan(head.indexOf('mutations.some('));
    const trip = src.slice(src.indexOf('private tripChurnBreaker(count: number): void {'));
    expect(trip).toContain("noteGap('churn-breaker', count, 'events');");
    expect(trip).toContain('this.observer.observe(document.body, { childList: true, subtree: true });');
    expect(trip.indexOf('this.observer?.disconnect();')).toBeLessThan(trip.indexOf("noteGap('churn-breaker'"));
    // And the re-arm looks at the page once. A MutationObserver reports what
    // happens next, never what happened while it was detached, so without this
    // everything the page added during the cooldown was invisible for good on
    // YouTube, which has no safety rescan of its own.
    expect(trip).toContain("this.catchUpScan('churn');");
    expect(trip.indexOf('this.observer.observe(document.body')).toBeLessThan(trip.indexOf("this.catchUpScan('churn')"));
    const stop = src.slice(src.indexOf('  stop(): void {'));
    expect(stop).toContain('clearTimeout(this.churnRearmId)');
  });

  it('the watch comments: scheduleScan notes first; a trip disconnects, notes a gap in events, re-attaches only if still armed; disarm clears the re-arm', () => {
    const src = read('src/content/platforms/yt-watch-comments.ts');
    const sched = src.slice(src.indexOf('function scheduleScan(): void {'), src.indexOf('function tripChurnBreaker('));
    expect(sched.indexOf('churn.note()')).toBeLessThan(sched.indexOf('setTimeout('));
    const trip = src.slice(src.indexOf('function tripChurnBreaker(count: number): void {'));
    expect(trip).toContain("noteGap('churn-breaker', count, 'events');");
    expect(trip).toContain('if (!armed) return;');
    expect(trip).toContain('if (container) attachObserver(container);');
    const disarm = src.slice(src.indexOf('function disarm(clearState: boolean): void {'));
    expect(disarm.indexOf('clearTimeout(churnRearmId)')).toBeLessThan(disarm.indexOf('observer?.disconnect();'));
  });

  it('the gap marker knows both new reasons and the events unit', () => {
    const marker = read('src/forensics/gap-marker.ts');
    expect(marker).toContain("'churn-breaker',");
    expect(marker).toContain("'heap-valve',");
    expect(marker).toContain("g.unit === 'events'");
  });
});

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('ChurnBreaker', () => {
  it('never trips below the threshold, however long it runs', () => {
    const c = clock();
    const b = new ChurnBreaker({ maxPerMinute: 100, sustainMs: 60_000, cooldownMs: 60_000, now: c.now });
    // 90 callbacks a minute for ten minutes.
    for (let i = 0; i < 900; i++) { expect(b.note().tripped).toBe(false); c.advance(667); }
    expect(b.tripCount).toBe(0);
    expect(b.isOpen()).toBe(false);
  });

  it('a hydration burst that ends inside the sustain period does not trip', () => {
    const c = clock();
    const b = new ChurnBreaker({ maxPerMinute: 100, sustainMs: 60_000, cooldownMs: 60_000, now: c.now });
    for (let i = 0; i < 500; i++) { expect(b.note().tripped).toBe(false); c.advance(20); }   // 500 in 10 s
    c.advance(120_000);                                                                        // then quiet
    expect(b.note().tripped).toBe(false);
    expect(b.tripCount).toBe(0);
  });

  it('a stream that stays hot for the sustain period trips once with its count, stays open for the cooldown, then closes', () => {
    const c = clock();
    const b = new ChurnBreaker({ maxPerMinute: 100, sustainMs: 60_000, cooldownMs: 30_000, now: c.now });
    let tripped: { tripped: boolean; count: number } | null = null;
    // 200 callbacks a minute, steadily, for two minutes.
    for (let i = 0; i < 400 && !tripped; i++) {
      const n = b.note();
      if (n.tripped) tripped = n;
      c.advance(300);
    }
    expect(tripped).not.toBeNull();
    expect(tripped!.count).toBeGreaterThanOrEqual(100);
    expect(b.tripCount).toBe(1);
    expect(b.isOpen()).toBe(true);
    expect(b.remainingMs()).toBeGreaterThan(0);
    // While open, callbacks count for nothing and cannot trip again.
    for (let i = 0; i < 300; i++) { expect(b.note().tripped).toBe(false); c.advance(50); }
    expect(b.tripCount).toBe(1);
    c.advance(30_000);
    expect(b.isOpen()).toBe(false);
    expect(b.remainingMs()).toBe(0);
    // Closed and cold: a single callback is nothing.
    expect(b.note()).toEqual({ tripped: false, count: 0 });
  });

  it('a rate that dips below the threshold resets the sustain clock', () => {
    const c = clock();
    const b = new ChurnBreaker({ maxPerMinute: 100, sustainMs: 60_000, cooldownMs: 60_000, now: c.now });
    // Hot for 40 s, cold for 70 s, hot for 40 s: never a full hot minute.
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < 200; i++) { expect(b.note().tripped).toBe(false); c.advance(200); }
      c.advance(70_000);
    }
    expect(b.tripCount).toBe(0);
  });
});
