// Exposure counters — the intervention that counts instead of scoring.
//
// Rationale and thresholds: docs/audits/2026-08-25-true-judgement/NARRATOR.md.
// IDB round-trips are not exercisable in this env (no IndexedDB, same
// constraint as author-store-profile-key.test), which is why the counting
// rules live in the pure `applyExposureSighting` rather than inline in
// `updateAuthorProfile`.

import { describe, it, expect } from 'vitest';
import {
  applyExposureSighting,
  getExposurePressure,
  creativeHash,
  EXPOSURE_DISTINCT_DAYS,
  EXPOSURE_SAME_CREATIVE,
  type AuthorProfile,
} from '../../../src/forensics/author-store';

function profile(over: Partial<AuthorProfile> = {}): AuthorProfile {
  return {
    profileKey: '@src@facebook',
    handle: '@src',
    platform: 'facebook',
    totalSeen: 0,
    totalFlagged: 0,
    techniques: {},
    firstSeen: '2026-05-25T00:00:00.000Z',
    lastSeen: '2026-05-25T00:00:00.000Z',
    ...over,
  };
}

describe('creativeHash', () => {
  it('is stable for the same copy', () => {
    expect(creativeHash('Buy the thing')).toBe(creativeHash('Buy the thing'));
  });

  it('ignores case and whitespace shape, which is how one advert re-renders', () => {
    expect(creativeHash('  Buy   THE thing \n')).toBe(creativeHash('buy the thing'));
  });

  it('separates different copy', () => {
    expect(creativeHash('Buy the thing')).not.toBe(creativeHash('Buy the other thing'));
  });
});

describe('applyExposureSighting — days', () => {
  it('counts a new day', () => {
    const p = profile();
    applyExposureSighting(p, '2026-05-25');
    expect(p.distinctDays).toBe(1);
    expect(p.lastSeenDay).toBe('2026-05-25');
  });

  it('counts a day once however many posts it carried', () => {
    const p = profile();
    for (let i = 0; i < 50; i++) applyExposureSighting(p, '2026-05-25');
    expect(p.distinctDays).toBe(1);
  });

  it('accumulates across days', () => {
    const p = profile();
    for (const d of ['2026-05-25', '2026-05-26', '2026-05-27']) {
      applyExposureSighting(p, d);
    }
    expect(p.distinctDays).toBe(3);
  });

  it('an out-of-order or replayed sighting cannot inflate the count', () => {
    const p = profile();
    applyExposureSighting(p, '2026-05-26');
    applyExposureSighting(p, '2026-05-25');
    expect(p.distinctDays).toBe(1);
    expect(p.lastSeenDay).toBe('2026-05-26');
  });

  it('leaves counters untouched when no day is supplied', () => {
    const p = profile();
    applyExposureSighting(p);
    expect(p.distinctDays).toBeUndefined();
  });
});

describe('applyExposureSighting — creatives', () => {
  it('counts sightings of one piece of copy', () => {
    const p = profile();
    const h = creativeHash('same advert');
    for (let i = 0; i < 4; i++) applyExposureSighting(p, undefined, h);
    expect(p.creatives?.[h]).toBe(4);
  });

  it('bounds the tracked set', () => {
    const p = profile();
    for (let i = 0; i < 40; i++) applyExposureSighting(p, undefined, `hash-${i}`);
    expect(Object.keys(p.creatives ?? {}).length).toBeLessThanOrEqual(20);
  });

  it('a long-running advert is never evicted by churn', () => {
    const p = profile();
    const advert = creativeHash('the campaign');
    for (let i = 0; i < 9; i++) applyExposureSighting(p, undefined, advert);
    // 100 one-off posts churn through the bounded map.
    for (let i = 0; i < 100; i++) applyExposureSighting(p, undefined, `oneoff-${i}`);
    expect(p.creatives?.[advert]).toBe(9);
  });
});

describe('getExposurePressure', () => {
  it('does not fire on an unknown source', () => {
    expect(getExposurePressure(null).fired).toBe(false);
  });

  it('does not fire one below the day threshold', () => {
    const p = profile({ distinctDays: EXPOSURE_DISTINCT_DAYS - 1 });
    expect(getExposurePressure(p).fired).toBe(false);
  });

  it('fires at the day threshold, naming the reason', () => {
    const p = profile({ distinctDays: EXPOSURE_DISTINCT_DAYS });
    const e = getExposurePressure(p);
    expect(e.fired).toBe(true);
    expect(e.reason).toBe('days');
    expect(e.distinctDays).toBe(EXPOSURE_DISTINCT_DAYS);
  });

  it('does not fire one below the creative threshold', () => {
    const h = creativeHash('advert');
    const p = profile({ creatives: { [h]: EXPOSURE_SAME_CREATIVE - 1 } });
    expect(getExposurePressure(p, h).fired).toBe(false);
  });

  it('fires on one piece of copy repeating, even from an otherwise rare source', () => {
    const h = creativeHash('advert');
    const p = profile({ distinctDays: 1, creatives: { [h]: EXPOSURE_SAME_CREATIVE } });
    const e = getExposurePressure(p, h);
    expect(e.fired).toBe(true);
    expect(e.reason).toBe('creative');
  });

  it('does not carry one creative\'s count over to a different post', () => {
    const seen = creativeHash('advert');
    const p = profile({ creatives: { [seen]: 99 } });
    expect(getExposurePressure(p, creativeHash('something else')).fired).toBe(false);
  });

  it('thresholds sit above the measured 95th percentile on every platform', () => {
    // NARRATOR.md: distinct days p95 = 2 (X, Instagram), 4 (Facebook), 1 (TikTok);
    // sightings of one creative p95 = 2-3 everywhere. Locking these so a future
    // edit that quietly lowers them has to argue with the measurement.
    expect(EXPOSURE_DISTINCT_DAYS).toBeGreaterThan(4);
    expect(EXPOSURE_SAME_CREATIVE).toBeGreaterThan(3);
  });
});
