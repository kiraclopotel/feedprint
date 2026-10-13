// Exposure counters - the intervention that counts instead of scoring.
//
// Rationale and thresholds: docs/audits/2026-08-25-true-judgement/NARRATOR.md. Rebuilt 13 Oct 2026 after the owner's
// export showed the notice on a channel he follows: only the recommended feed counts, the count is the last 30 days,
// a visit the person made themselves starts it again, and a source it already spoke for today stays quiet on any tab
// (SEEN-A-LOT-2026-10-13.md in the crew's reading folder).
// IDB round-trips are not exercisable in this env (no IndexedDB, same constraint as author-store-profile-key.test),
// which is why the counting rules live in the pure `applyExposureSighting` rather than inline in `updateAuthorProfile`.

import { describe, it, expect } from 'vitest';
import {
  applyExposureSighting,
  getExposurePressure,
  creativeHash,
  isRecommendedSurface,
  isSoughtSurface,
  EXPOSURE_DISTINCT_DAYS,
  EXPOSURE_SAME_CREATIVE,
  EXPOSURE_WINDOW_DAYS,
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

/** `YYYY-MM-DD` n days after 2026-09-01. */
function day(n: number): string {
  return new Date(Date.UTC(2026, 8, 1 + n)).toISOString().slice(0, 10);
}

/** A source the feed pushed on `n` consecutive days from day 0. */
function pushedFor(n: number): AuthorProfile {
  const p = profile();
  for (let i = 0; i < n; i++) applyExposureSighting(p, day(i), undefined, 'for-you');
  return p;
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

describe('which surfaces count', () => {
  it('only the feed that chose for the person is recommended', () => {
    expect(isRecommendedSurface('for-you')).toBe(true);
    for (const s of ['following', 'profile', 'permalink', 'search', 'video', 'manual', 'unknown', undefined]) {
      expect(isRecommendedSurface(s)).toBe(false);
    }
  });

  it('a followed feed, a profile, a thread, a search and a watch page are places the person went to', () => {
    for (const s of ['following', 'profile', 'permalink', 'search', 'video']) expect(isSoughtSurface(s)).toBe(true);
    for (const s of ['for-you', 'unknown', 'manual', undefined]) expect(isSoughtSurface(s)).toBe(false);
  });
});

describe('applyExposureSighting - days', () => {
  it('counts a recommended day', () => {
    const p = profile();
    applyExposureSighting(p, '2026-09-01', undefined, 'for-you');
    expect(p.recDays).toEqual(['2026-09-01']);
  });

  it('counts a day once however many posts it carried', () => {
    const p = profile();
    for (let i = 0; i < 50; i++) applyExposureSighting(p, '2026-09-01', undefined, 'for-you');
    expect(p.recDays).toEqual(['2026-09-01']);
  });

  it('accumulates across days, ascending', () => {
    const p = profile();
    for (const d of ['2026-09-03', '2026-09-01', '2026-09-02']) applyExposureSighting(p, d, undefined, 'for-you');
    expect(p.recDays).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
  });

  it('an out-of-order or replayed sighting cannot inflate the count', () => {
    const p = profile();
    applyExposureSighting(p, '2026-09-02', undefined, 'for-you');
    applyExposureSighting(p, '2026-09-01', undefined, 'for-you');
    applyExposureSighting(p, '2026-09-02', undefined, 'for-you');
    expect(p.recDays).toEqual(['2026-09-01', '2026-09-02']);
  });

  it('leaves the counters untouched when no day is supplied', () => {
    const p = profile();
    applyExposureSighting(p, undefined, 'h', 'for-you');
    expect(p.recDays).toBeUndefined();
    expect(p.creativeDays).toBeUndefined();
  });

  it('forgets days older than the window as new days arrive', () => {
    const p = profile();
    applyExposureSighting(p, day(0), undefined, 'for-you');
    applyExposureSighting(p, day(EXPOSURE_WINDOW_DAYS - 1), undefined, 'for-you');
    expect(p.recDays).toEqual([day(0), day(EXPOSURE_WINDOW_DAYS - 1)]);
    applyExposureSighting(p, day(EXPOSURE_WINDOW_DAYS), undefined, 'for-you');
    expect(p.recDays).toEqual([day(EXPOSURE_WINDOW_DAYS - 1), day(EXPOSURE_WINDOW_DAYS)]);
  });

  it('never writes the old for-ever counters', () => {
    const p = profile({ distinctDays: 12, lastSeenDay: '2026-09-01', creatives: { x: 3 } });
    applyExposureSighting(p, '2026-09-05', 'h', 'for-you');
    expect(p.distinctDays).toBe(12);
    expect(p.lastSeenDay).toBe('2026-09-01');
    expect(p.creatives).toEqual({ x: 3 });
  });
});

describe('applyExposureSighting - the surface', () => {
  it('a sighting with no surface, or an unknown one, is not counted', () => {
    const p = profile();
    applyExposureSighting(p, '2026-09-01', 'h');
    applyExposureSighting(p, '2026-09-02', 'h', 'unknown');
    applyExposureSighting(p, '2026-09-03', 'h', 'manual');
    expect(p.recDays).toBeUndefined();
    expect(p.creativeDays).toBeUndefined();
  });

  it.each(['following', 'profile', 'permalink', 'search', 'video'])('a sighting on %s is not counted', (surface) => {
    const p = profile();
    applyExposureSighting(p, '2026-09-01', 'h', surface);
    expect(p.recDays ?? []).toEqual([]);
    expect(p.creativeDays).toBeUndefined();
  });

  it('a visit the person made starts the count again', () => {
    const p = pushedFor(6);
    expect(p.recDays).toHaveLength(6);
    applyExposureSighting(p, day(6), undefined, 'video');
    expect(p.recDays).toEqual([]);
    applyExposureSighting(p, day(7), undefined, 'for-you');
    expect(p.recDays).toEqual([day(7)]);
  });

  it('a visit does not clear what was said about one exact post', () => {
    const p = profile();
    for (let i = 0; i < 3; i++) applyExposureSighting(p, day(i), 'same', 'for-you');
    applyExposureSighting(p, day(3), 'same', 'following');
    expect(p.creativeDays?.same).toHaveLength(3);
  });
});

describe('applyExposureSighting - creatives', () => {
  it('counts sightings of one piece of copy, a day repeating', () => {
    const p = profile();
    const h = creativeHash('same advert');
    for (let i = 0; i < 4; i++) applyExposureSighting(p, '2026-09-01', h, 'for-you');
    expect(p.creativeDays?.[h]).toEqual(['2026-09-01', '2026-09-01', '2026-09-01', '2026-09-01']);
  });

  it('keeps the last few sightings only', () => {
    const p = profile();
    const h = creativeHash('same advert');
    for (let i = 0; i < 12; i++) applyExposureSighting(p, day(i), h, 'for-you');
    expect(p.creativeDays?.[h]).toHaveLength(EXPOSURE_SAME_CREATIVE);
    expect(p.creativeDays?.[h]?.at(-1)).toBe(day(11));
  });

  it('bounds the tracked set', () => {
    const p = profile();
    for (let i = 0; i < 40; i++) applyExposureSighting(p, '2026-09-01', `hash-${i}`, 'for-you');
    expect(Object.keys(p.creativeDays ?? {}).length).toBeLessThanOrEqual(20);
  });

  it('a long-running advert is never evicted by churn', () => {
    const p = profile();
    const advert = creativeHash('the campaign');
    for (let i = 0; i < 4; i++) applyExposureSighting(p, day(i), advert, 'for-you');
    // 100 one-off posts churn through the bounded map on later days.
    for (let i = 0; i < 100; i++) applyExposureSighting(p, day(5 + (i % 3)), `oneoff-${i}`, 'for-you');
    expect(p.creativeDays?.[advert]).toHaveLength(4);
  });

  it('forgets a piece of copy last seen outside the window', () => {
    const p = profile();
    applyExposureSighting(p, day(0), 'old', 'for-you');
    applyExposureSighting(p, day(EXPOSURE_WINDOW_DAYS + 2), 'new', 'for-you');
    expect(p.creativeDays?.old).toBeUndefined();
    expect(p.creativeDays?.new).toHaveLength(1);
  });
});

describe('getExposurePressure', () => {
  const today = day(20);

  it('does not fire on an unknown source', () => {
    expect(getExposurePressure(null, undefined, today, 'for-you').fired).toBe(false);
  });

  it('does not fire one below the day threshold', () => {
    const p = pushedFor(EXPOSURE_DISTINCT_DAYS - 1);
    expect(getExposurePressure(p, undefined, day(EXPOSURE_DISTINCT_DAYS), 'for-you').fired).toBe(false);
  });

  it('fires at the day threshold, naming the reason, the count and the surface', () => {
    const p = pushedFor(EXPOSURE_DISTINCT_DAYS);
    const e = getExposurePressure(p, undefined, day(EXPOSURE_DISTINCT_DAYS), 'for-you');
    expect(e.fired).toBe(true);
    expect(e.reason).toBe('days');
    expect(e.distinctDays).toBe(EXPOSURE_DISTINCT_DAYS);
    expect(e.surface).toBe('for-you');
  });

  it('counts the last 30 days, not every day there has been', () => {
    // Seven days, then a quiet month: the line is not crossed any more.
    const p = pushedFor(EXPOSURE_DISTINCT_DAYS);
    expect(getExposurePressure(p, undefined, day(EXPOSURE_DISTINCT_DAYS + 5), 'for-you').fired).toBe(true);
    const later = day(EXPOSURE_DISTINCT_DAYS + EXPOSURE_WINDOW_DAYS);
    const e = getExposurePressure(p, undefined, later, 'for-you');
    expect(e.fired).toBe(false);
    expect(e.distinctDays).toBeLessThan(EXPOSURE_DISTINCT_DAYS);
  });

  it('never speaks on a post met anywhere but the recommended feed, even over the line', () => {
    const p = pushedFor(EXPOSURE_DISTINCT_DAYS + 2);
    const t = day(EXPOSURE_DISTINCT_DAYS + 2);
    for (const s of ['following', 'profile', 'permalink', 'search', 'video', 'unknown', undefined]) {
      expect(getExposurePressure(p, undefined, t, s).fired).toBe(false);
    }
    expect(getExposurePressure(p, undefined, t, 'for-you').fired).toBe(true);
  });

  it('is quiet for a source it already spoke for today, and speaks again tomorrow', () => {
    const p = { ...pushedFor(EXPOSURE_DISTINCT_DAYS + 2), lastNoticedDay: day(EXPOSURE_DISTINCT_DAYS + 2) };
    expect(getExposurePressure(p, undefined, day(EXPOSURE_DISTINCT_DAYS + 2), 'for-you').fired).toBe(false);
    expect(getExposurePressure(p, undefined, day(EXPOSURE_DISTINCT_DAYS + 3), 'for-you').fired).toBe(true);
  });

  it('a source the person went to is quiet until the feed has pushed it on enough days since', () => {
    const p = pushedFor(EXPOSURE_DISTINCT_DAYS + 1);
    const visit = day(EXPOSURE_DISTINCT_DAYS + 1);
    applyExposureSighting(p, visit, undefined, 'video');
    expect(getExposurePressure(p, undefined, visit, 'for-you').fired).toBe(false);
    for (let i = 1; i <= EXPOSURE_DISTINCT_DAYS; i++) {
      applyExposureSighting(p, day(EXPOSURE_DISTINCT_DAYS + 1 + i), undefined, 'for-you');
    }
    expect(getExposurePressure(p, undefined, day(EXPOSURE_DISTINCT_DAYS * 2 + 2), 'for-you').fired).toBe(true);
  });

  it('does not fire one below the creative threshold', () => {
    const h = creativeHash('advert');
    const p = profile();
    for (let i = 0; i < EXPOSURE_SAME_CREATIVE - 1; i++) applyExposureSighting(p, day(i), h, 'for-you');
    expect(getExposurePressure(p, h, day(10), 'for-you').fired).toBe(false);
  });

  it('fires on one piece of copy repeating, even from an otherwise rare source', () => {
    const h = creativeHash('advert');
    const p = profile();
    for (let i = 0; i < EXPOSURE_SAME_CREATIVE; i++) applyExposureSighting(p, day(0), h, 'for-you');
    const e = getExposurePressure(p, h, day(1), 'for-you');
    expect(e.fired).toBe(true);
    expect(e.reason).toBe('creative');
    expect(e.creativeCount).toBe(EXPOSURE_SAME_CREATIVE);
  });

  it('the same post counts only its sightings in the last 30 days', () => {
    const h = creativeHash('advert');
    const p = profile();
    for (let i = 0; i < EXPOSURE_SAME_CREATIVE; i++) applyExposureSighting(p, day(0), h, 'for-you');
    expect(getExposurePressure(p, h, day(EXPOSURE_WINDOW_DAYS + 3), 'for-you').fired).toBe(false);
  });

  it('does not carry one creative\'s count over to a different post', () => {
    const seen = creativeHash('advert');
    const p = profile();
    for (let i = 0; i < 9; i++) applyExposureSighting(p, day(0), seen, 'for-you');
    expect(getExposurePressure(p, creativeHash('something else'), day(1), 'for-you').fired).toBe(false);
  });

  it('a profile written before this change starts from empty counts', () => {
    const old = profile({ distinctDays: 40, lastSeenDay: '2026-09-30', creatives: { x: 30 } });
    expect(getExposurePressure(old, 'x', day(30), 'for-you').fired).toBe(false);
  });

  it('thresholds sit above the measured 95th percentile on every platform', () => {
    // NARRATOR.md: distinct days p95 = 2 (X, Instagram), 4 (Facebook), 1 (TikTok);
    // sightings of one creative p95 = 2-3 everywhere. Locking these so a future
    // edit that quietly lowers them has to argue with the measurement.
    expect(EXPOSURE_DISTINCT_DAYS).toBeGreaterThan(4);
    expect(EXPOSURE_SAME_CREATIVE).toBeGreaterThan(3);
    expect(EXPOSURE_WINDOW_DAYS).toBe(30);
  });
});
