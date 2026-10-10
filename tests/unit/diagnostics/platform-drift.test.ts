// FeelingWise — per-platform drift verdict (regression harness). Pure rollup of
// the per-site selector-health counters into a platform-level status a non-coder
// can act on. A platform reporting NO data is a blind spot, and a blind spot is
// itself a signal.
//
// RECON F3a (2026-08-18) split that no-data case in two, because the old single
// verdict answered a question it had not asked. 'not-monitored' now means the
// platform IS instrumented and reported nothing today, which usually means it was
// not visited. 'not-instrumented' means no selector-health label exists for it
// anywhere in the code, so it could not have reported even while being browsed.
// Facebook was rendering the second as the first and reporting a surface was
// quiet on a day it had been scrolled for hours. The registry that decides which is
// which is guarded in selector-health-instrumentation.test.ts.

import { describe, it, expect } from 'vitest';
import {
  assessPlatformDrift,
  MONITORED_PLATFORMS,
  type SelectorHealthSnapshot,
  type SelectorHealthCounter,
} from '../../../src/diagnostics/selector-health';

function counter(label: string, p: Partial<SelectorHealthCounter>): SelectorHealthCounter {
  return { label, primary: 0, fallback1: 0, fallback2: 0, fallbackDeep: 0, miss: 0, lastSeenAt: '2026-06-05T00:00:00Z', ...p };
}
function snap(counters: SelectorHealthCounter[]): SelectorHealthSnapshot {
  return { date: '2026-06-05', counters: Object.fromEntries(counters.map(c => [c.label, c])) };
}
const drift = (s: SelectorHealthSnapshot) => Object.fromEntries(assessPlatformDrift(s).map(d => [d.platform, d]));

describe('assessPlatformDrift', () => {
  it('always returns an entry for every monitored platform', () => {
    const d = assessPlatformDrift(snap([]));
    expect(d.map(x => x.platform).sort()).toEqual([...MONITORED_PLATFORMS].sort());
  });

  it('an instrumented platform with no data is not-monitored (the blind-spot signal)', () => {
    const d = drift(snap([counter('twitter.post-text', { primary: 100 })]));
    expect(d.facebook.status).toBe('not-monitored');
    expect(d.tiktok.status).toBe('not-monitored');
  });

  it('an uninstrumented platform with no data says so instead of claiming a quiet day', () => {
    const d = drift(snap([counter('twitter.post-text', { primary: 100 })]));
    expect(d.instagram.status).toBe('not-instrumented');
  });

  it('healthy when every query hits the primary selector', () => {
    const d = drift(snap([counter('twitter.post-text', { primary: 200 }), counter('twitter.comment', { primary: 50 })]));
    expect(d.twitter.status).toBe('healthy');
    expect(d.twitter.missPct).toBe(0);
    expect(d.twitter.siteCount).toBe(2);
  });

  it('drifting when there are any misses or heavy fallback', () => {
    expect(drift(snap([counter('youtube.community', { primary: 95, miss: 5 })])).youtube.status).toBe('drifting');
    expect(drift(snap([counter('youtube.community', { primary: 70, fallback1: 30 })])).youtube.status).toBe('drifting'); // 30% fallback
  });

  it('broken when at least half the queries miss (platform substantially down)', () => {
    const d = drift(snap([counter('twitter.post-text', { primary: 40, miss: 60 })]));
    expect(d.twitter.status).toBe('broken');
    expect(d.twitter.missPct).toBe(60);
  });

  it('will not call a platform broken off a single observation', () => {
    // The owner's 2026-08-20 dump: facebook.count-chips had primary 0, miss 1
    // — one look, one miss, "100% miss". Only the canary overlay stopped that
    // reaching him as a red BROKEN verdict, and a canary is not a guarantee.
    // Below SELECTOR_MIN_DENOM the miss is still shown, just not as a break.
    const d = drift(snap([counter('facebook.count-chips', { miss: 1 })]));
    expect(d.facebook.missPct).toBe(100);
    expect(d.facebook.status).toBe('drifting');
  });

  it('still calls a platform broken once the miss rate rests on real observations', () => {
    const d = drift(snap([counter('facebook.count-chips', { primary: 1, miss: 5 })]));
    expect(d.facebook.total).toBe(6);
    expect(d.facebook.status).toBe('broken');
  });

  it('aggregates multiple sites of one platform (sanity)', () => {
    const d = drift(snap([
      counter('facebook.article', { primary: 100 }),
      counter('facebook.comment', { primary: 50, miss: 50 }),
    ]));
    // 150 primary-ish + 50 miss = 200 total, 50 miss => 25% miss => drifting (not broken)
    expect(d.facebook.total).toBe(200);
    expect(d.facebook.missPct).toBe(25);
    expect(d.facebook.status).toBe('drifting');
    expect(d.facebook.siteCount).toBe(2);
  });
});
