// @vitest-environment node
//
// One record, two calendar days, depending on which panel you are looking at.
//
// The Overview cuts its day keys in the reader's local time (overview-data.ts
// uses localDayKey). The Patterns tab, the feed-behavior read under it, the
// Statistics provenance line, the account ledger and the reserve panel all cut
// theirs out of the raw ISO string with `ts.slice(0, 10)`, which is UTC. So the
// same two serves are "one day" on one panel and "two days" on another, and the
// Overview's Thursday column and the Patterns tab's Thursday square hold
// different records.
//
// This is not a rendering difference. distinctDays is a NUMBER the panel prints
// ("served 6 times across 2 days"), the streak grid is indexed BY the key, and
// the Patterns range filter DROPS records by comparing one against the other.
// A reader east or west of Greenwich gets a different count from the same
// chain, and no two panels agree on which.
//
// Named by the clock sweep of 2026-09-18 and deliberately left then, because
// the rendering pass could not fix a value.
//
// TZ pinning: Node >= 16 honours a runtime process.env.TZ reassignment; the
// repo already relies on this in exposure-window-dst.test.ts. Pacific/Kiritimati
// is UTC+14 all year, so there is no DST to reason about and every disagreement
// is a full calendar day wide. The offset assertion below fails loudly if
// pinning ever stops working, so this file can never pass vacuously.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { localDayKey } from '../../../../src/ui/shared/format-time';
import { computeOverview } from '../../../../src/ui/dashboard/components/overview-data';
import { computeFeedBehavior } from '../../../../src/ui/dashboard/components/feed-behavior-data';
import { computeAccountLedger } from '../../../../src/ui/dashboard/components/account-ledger';
import { computeReservePatterns } from '../../../../src/forensics/reserve';
import type { ForensicRecord } from '../../../../src/types/forensic';

let savedTZ: string | undefined;

beforeAll(() => {
  savedTZ = process.env.TZ;
  process.env.TZ = 'Pacific/Kiritimati';
});

afterAll(() => {
  if (savedTZ === undefined) delete process.env.TZ;
  else process.env.TZ = savedTZ;
});

// Both instants fall on 2026-09-18 in UTC. In Kiritimati the first is
// 2026-09-18 23:00 and the second is 2026-09-19 10:00: one UTC day, two local
// days, which is the whole disagreement in two timestamps.
const EVENING = '2026-09-18T09:00:00Z';
const NEXT_MORNING = '2026-09-18T20:00:00Z';

function record(id: string, timestamp: string, over: Partial<ForensicRecord> = {}): ForensicRecord {
  return {
    id,
    timestamp,
    platform: 'facebook',
    originalText: 'the same post, served twice',
    originalHash: 'same-content-hash',
    originalLength: 27,
    neutralizedText: '',
    author: '@repeater',
    postUrl: 'https://facebook.com/p/1',
    techniques: [{ name: 'outrage-bait', severity: 4, why: 'x' }],
    overallScore: 4,
    userAgeCategory: 'adult',
    aiSource: 'cloud',
    feedSource: 'for-you',
    integrityHash: `hash-${id}`,
    signature: 'sig',
    publicKeyFingerprint: 'fp',
    chainPosition: 0,
    kind: 'post',
    verdict: 'flagged',
    ...over,
  } as unknown as ForensicRecord;
}

describe('two surfaces, one day', () => {
  it('is pinned to a zone where the two clocks disagree', () => {
    expect(new Date(EVENING).getTimezoneOffset(), 'Kiritimati is UTC+14').toBe(-840);
    expect(EVENING.slice(0, 10), 'the two instants are one day in UTC').toBe(NEXT_MORNING.slice(0, 10));
    expect(localDayKey(EVENING), 'and two days where the reader is').not.toBe(localDayKey(NEXT_MORNING));
  });

  // The Overview is the reference: it has cut local since the clock pass.
  it('the Overview buckets both records into the reader’s own days', () => {
    const model = computeOverview([record('a', EVENING), record('b', NEXT_MORNING)]);
    expect(model).not.toBeNull();
    const keys = model!.balance.days.map((d) => d.dayKey);
    expect(keys, 'every key the Overview prints is a local calendar day')
      .toEqual(keys.map((k) => k).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)));
    expect(keys).toContain(localDayKey(NEXT_MORNING));
  });

  it('the feed-behavior range names the same first day the Overview does', () => {
    const behavior = computeFeedBehavior([record('a', EVENING), record('b', NEXT_MORNING)]);
    expect(behavior).not.toBeNull();
    expect(behavior!.rangeStart, 'the Patterns range line and the Overview columns agree')
      .toBe(localDayKey(EVENING));
    expect(behavior!.rangeEnd).toBe(localDayKey(NEXT_MORNING));
  });

  // The recurring-voices panel has a THRESHOLD: an account is listed once it has
  // been served on 3 or more distinct days. The three instants below fall on
  // three of the reader's days and only two UTC ones, so under the old cut the
  // account was not merely miscounted, it was absent from the panel entirely.
  it('lists a voice served on three of the reader’s days', () => {
    const behavior = computeFeedBehavior([
      record('a', '2026-09-17T09:00:00Z'), // local 09-17 23:00
      record('b', '2026-09-17T20:00:00Z'), // local 09-18 10:00
      record('c', '2026-09-18T20:00:00Z'), // local 09-19 10:00
    ]);
    const utcDays = new Set(['2026-09-17', '2026-09-17', '2026-09-18']);
    expect(utcDays.size, 'two UTC days, which is under the panel’s threshold').toBe(2);
    const voice = behavior!.voices.find((v) => v.author === '@repeater');
    expect(voice, 'the account reached the panel at all').toBeDefined();
    expect(voice!.days, 'three of the reader’s days').toBe(3);
  });

  it('the account ledger counts the reader’s days', () => {
    const rows = computeAccountLedger([record('a', EVENING), record('b', NEXT_MORNING)]);
    const row = rows.find((r) => r.author === '@repeater');
    expect(row, 'the author has a ledger row').toBeDefined();
    expect(row!.distinctDays, '"seen on N days" is N of the reader’s days').toBe(2);
  });

  it('the reserve panel counts the reader’s days', () => {
    const instances = computeReservePatterns(
      [record('a', EVENING), record('b', NEXT_MORNING)],
      { top: 8, minSessions: 1, dayKeyOf: localDayKey },
    );
    expect(instances.length, 'the same content served twice is a reserve').toBeGreaterThan(0);
    expect(instances[0].distinctDays, '"across N days" is N of the reader’s days').toBe(2);
  });

  // The control. Two serves inside one LOCAL day must stay one day on every
  // panel, or the fix has merely moved the disagreement rather than closed it.
  it('leaves two serves inside one local day as one day everywhere', () => {
    const morning = '2026-09-18T20:00:00Z'; // local 09-19 10:00
    const evening = '2026-09-19T05:00:00Z'; // local 09-19 19:00
    expect(localDayKey(morning)).toBe(localDayKey(evening));

    const records = [record('a', morning), record('b', evening)];
    expect(computeFeedBehavior(records)!.rangeStart).toBe(computeFeedBehavior(records)!.rangeEnd);
    expect(computeAccountLedger(records).find((r) => r.author === '@repeater')!.distinctDays).toBe(1);
    expect(computeReservePatterns(records, { top: 8, minSessions: 1, dayKeyOf: localDayKey })[0].distinctDays).toBe(1);
  });
});
