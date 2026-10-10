// Positive extraction monitoring — overlayCanary (src/diagnostics/selector-health.ts).
// Newest canary signal wins: a recent success lifts FB/IG/TikTok out of
// "not monitored" and clears a stale cold-start warning (X "looks broken" with
// thousands of hits); a newer warning still wins as "broken".

import { describe, it, expect } from 'vitest';
import {
  overlayCanary,
  assessPlatformDrift,
  type PlatformDrift,
  type SelectorHealthCounter,
  type SelectorHealthSnapshot,
} from '../../../src/diagnostics/selector-health';
import type { ExtractionCanarySnapshot } from '../../../src/diagnostics/extraction-canary';

const drift = (platform: string, status: PlatformDrift['status']): PlatformDrift => ({
  platform: platform as PlatformDrift['platform'],
  status,
  total: 0,
  missPct: 0,
  fallbackPct: 0,
  siteCount: 0,
});

const OLD = '2026-06-07T07:35:00.000Z';
const NEW = '2026-06-07T11:42:00.000Z';

describe('overlayCanary', () => {
  it('clears a stale cold-start warning when extraction succeeded more recently (X)', () => {
    const snap: ExtractionCanarySnapshot = {
      date: '2026-06-07',
      warnings: { twitter: { kind: 'cold-start', at: OLD } },
      successes: { twitter: { at: NEW } },
    };
    expect(overlayCanary([drift('twitter', 'broken')], snap)[0].status).toBe('healthy');
  });

  it('lifts a label-less platform out of not-monitored when it is extracting (Facebook), but not all the way to healthy', () => {
    // 2026-08-24: this used to lift straight to 'healthy' — same green dot,
    // same "OK" text as a real selector-counter-backed platform, with zero
    // selector counters behind it. The canary is real evidence (the platform
    // IS extracting) but a different, weaker instrument than a counter match,
    // so it gets its own status.
    const snap: ExtractionCanarySnapshot = {
      date: '2026-06-07',
      warnings: {},
      successes: { facebook: { at: NEW } },
    };
    expect(overlayCanary([drift('facebook', 'not-monitored')], snap)[0].status).toBe('confirmed-by-canary');
  });

  it('keeps not-monitored when a platform has no canary signal at all (IG/TikTok unused today)', () => {
    const snap: ExtractionCanarySnapshot = { date: '2026-06-07', warnings: {}, successes: {} };
    const out = overlayCanary([drift('instagram', 'not-monitored'), drift('tiktok', 'not-monitored')], snap);
    expect(out.map(d => d.status)).toEqual(['not-monitored', 'not-monitored']);
  });

  it('marks broken when a warning is the most recent signal', () => {
    const snap: ExtractionCanarySnapshot = {
      date: '2026-06-07',
      warnings: { youtube: { kind: 'cold-start', at: NEW } },
      successes: { youtube: { at: OLD } },
    };
    expect(overlayCanary([drift('youtube', 'not-monitored')], snap)[0].status).toBe('broken');
  });

  it('warning with no success at all → broken', () => {
    const snap: ExtractionCanarySnapshot = {
      date: '2026-06-07',
      warnings: { youtube: { kind: 'cold-start', at: OLD } },
    };
    expect(overlayCanary([drift('youtube', 'not-monitored')], snap)[0].status).toBe('broken');
  });

  it('does not override a finer selector-health verdict (drifting) on a healthy canary', () => {
    const snap: ExtractionCanarySnapshot = {
      date: '2026-06-07',
      warnings: {},
      successes: { twitter: { at: NEW } },
    };
    // selector-health saw real fallback drift — keep it, don't flatten to healthy.
    expect(overlayCanary([drift('twitter', 'drifting')], snap)[0].status).toBe('drifting');
  });

  it('leaves the verdict untouched when there is no canary signal', () => {
    const snap: ExtractionCanarySnapshot = { date: '2026-06-07', warnings: {} };
    expect(overlayCanary([drift('twitter', 'healthy')], snap)[0].status).toBe('healthy');
  });
});

describe('assessPlatformDrift + overlayCanary: 2026-08-24 01:07 dashboard capture', () => {
  // The owner's live capture, quoted verbatim from the audit brief:
  //   "The panel rendered a green OK dot for X, Facebook, Instagram and
  //    TikTok, plus the summary line: 'All page selectors matched on the
  //    primary path today: no DOM drift detected (2 sites watched).'
  //    The underlying selectorHealth.counters object contained exactly two
  //    entries, both Twitter: twitter.post-profile-link (primary 129, all
  //    fallbacks 0, miss 0) and twitter.post-status-link (primary 129, all
  //    fallbacks 0, miss 0). Facebook, Instagram and TikTok had NO selector
  //    counters at all. The panel showed them green anyway."
  //
  // assessPlatformDrift alone cannot produce 'healthy' for a zero-counter
  // platform (its total===0 branch only ever returns 'not-monitored' or
  // 'not-instrumented') — overlayCanary is the only code path that can turn
  // that into a green "OK" dot, so a canary success for each of the three
  // blind platforms is the only way the observed render is reachable. The
  // brief does not quote the canary snapshot itself; this reconstructs the
  // minimal one consistent with the observed render.
  function counter(label: string, primary: number): SelectorHealthCounter {
    return {
      label, primary, fallback1: 0, fallback2: 0, fallbackDeep: 0, miss: 0,
      lastSeenAt: '2026-08-24T01:00:00.000Z',
    };
  }
  const selectorHealth: SelectorHealthSnapshot = {
    date: '2026-08-24',
    counters: {
      'twitter.post-profile-link': counter('twitter.post-profile-link', 129),
      'twitter.post-status-link': counter('twitter.post-status-link', 129),
    },
  };
  const canary: ExtractionCanarySnapshot = {
    date: '2026-08-24',
    warnings: {},
    successes: {
      facebook: { at: '2026-08-24T00:50:00.000Z' },
      instagram: { at: '2026-08-24T00:50:00.000Z' },
      tiktok: { at: '2026-08-24T00:50:00.000Z' },
    },
  };

  it('does not render Facebook, Instagram and TikTok with the same verdict as counter-backed Twitter', () => {
    const byPlatform = Object.fromEntries(
      overlayCanary(assessPlatformDrift(selectorHealth), canary).map(d => [d.platform, d.status]),
    );
    // Twitter: real counters, no drift → genuinely 'healthy'.
    expect(byPlatform.twitter).toBe('healthy');
    // Facebook / Instagram / TikTok: zero selector counters, canary-only
    // evidence → a DIFFERENT status from 'healthy', not the same green dot.
    expect(byPlatform.facebook).toBe('confirmed-by-canary');
    expect(byPlatform.instagram).toBe('confirmed-by-canary');
    expect(byPlatform.tiktok).toBe('confirmed-by-canary');
    expect(byPlatform.facebook).not.toBe('healthy');
    expect(byPlatform.instagram).not.toBe('healthy');
    expect(byPlatform.tiktok).not.toBe('healthy');
  });

  it('YouTube with no counters and no canary signal stays a visible blind spot, never green', () => {
    const byPlatform = Object.fromEntries(
      overlayCanary(assessPlatformDrift(selectorHealth), canary).map(d => [d.platform, d.status]),
    );
    expect(byPlatform.youtube).toBe('not-monitored');
  });
});
