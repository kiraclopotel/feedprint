/** @vitest-environment jsdom */
//
// An outage became an idle hour the moment its month was archived.
//
// On 2026-09-18 the usage panel learned to draw a gap marker apart from an
// empty hour, and the field it counts them into says why: "An hour holding the
// chain's own proof that the recorder was down drew identically to an hour
// somebody spent asleep... A record that cannot tell 'nothing happened' from
// 'the recorder was dead' is the record a recipient must not rely on."
//
// That fix reached the live window and stopped there. `UsageHour`, the shape a
// summarised month carries, had five fields and none of them was gaps, and the
// panel's archived-summary loop folded those five. So every gap older than the
// loaded window was gone, silently, and the exact ambiguity the panel had just
// been taught to refuse came back for everything but the present.
//
// Version 3 of the summary carries gaps. A reader recomputes a version it does
// not know, so no stored summary is left answering a question it was never
// asked.

import { describe, it, expect } from 'vitest';
import type { ForensicRecord } from '../../../../../src/types/forensic';
import {
  addRecordsToSummary,
  emptyMonthSummary,
  hourKeyOf,
  MONTH_SUMMARY_VERSION,
} from '../../../../../src/forensics/archive-summary';

let seq = 0;
function rec(over: Partial<ForensicRecord> = {}): ForensicRecord {
  seq += 1;
  return {
    id: `r-${seq}`,
    timestamp: '2026-07-14T09:30:00.000Z',
    platform: 'twitter',
    originalText: 'something',
    originalHash: 'h',
    originalLength: 9,
    neutralizedText: '',
    author: '@someone',
    postUrl: '',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'adult',
    aiSource: 'cloud',
    feedSource: 'for-you',
    integrityHash: 'deadbeef',
    signature: 'sig',
    publicKeyFingerprint: 'fp',
    chainPosition: seq,
    kind: 'post',
    verdict: 'pass',
    ...over,
  } as unknown as ForensicRecord;
}

const HOUR = '2026-07-14T09';

describe('a gap survives being archived (2026-09-19)', () => {
  it('a gap marker is counted in the month it happened in', () => {
    const summary = emptyMonthSummary('2026-07');
    addRecordsToSummary(summary, [rec({ kind: 'gap-marker', verdict: undefined })]);

    expect(hourKeyOf('2026-07-14T09:30:00.000Z')).toBe(HOUR);
    expect(summary.usageByHour[HOUR]?.gaps, 'the outage is in the month').toBe(1);
  });

  it('and is not counted as something the person was shown', () => {
    const summary = emptyMonthSummary('2026-07');
    addRecordsToSummary(summary, [rec({ kind: 'gap-marker', verdict: undefined })]);
    const u = summary.usageByHour[HOUR]!;

    expect(u.n, 'a gap is not a thing the feed served').toBe(0);
    expect(u.pass + u.flagged + u.blocked + u.unjudged).toBe(0);
  });

  it('an hour with both keeps them apart', () => {
    const summary = emptyMonthSummary('2026-07');
    addRecordsToSummary(summary, [
      rec(),
      rec({ verdict: 'flagged', techniques: [{ name: 'fear-appeal', severity: 6, confidence: 1 }] } as Partial<ForensicRecord>),
      rec({ kind: 'gap-marker', verdict: undefined }),
    ]);
    const u = summary.usageByHour[HOUR]!;

    expect(u.n, 'two records were served').toBe(2);
    expect(u.gaps, 'and the recorder was also down').toBe(1);
  });

  it('an empty hour and an hour with an outage are different rows', () => {
    // The whole point, stated as the comparison a reader makes.
    const quiet = emptyMonthSummary('2026-07');
    addRecordsToSummary(quiet, []);
    const down = emptyMonthSummary('2026-07');
    addRecordsToSummary(down, [rec({ kind: 'gap-marker', verdict: undefined })]);

    expect(quiet.usageByHour[HOUR], 'nothing happened').toBeUndefined();
    expect(down.usageByHour[HOUR]?.gaps, 'the recorder was dead').toBe(1);
  });

  it('the version moved, so older summaries are recomputed rather than misread', () => {
    // A stored version-2 summary has no gaps field at all. The store only
    // accepts a summary whose version it knows, so those are rebuilt from the
    // archive instead of being folded in with a hole in them.
    expect(MONTH_SUMMARY_VERSION).toBeGreaterThanOrEqual(3);
    expect(emptyMonthSummary('2026-07').version).toBe(MONTH_SUMMARY_VERSION);
  });

  it('every other system marker still bands to nothing', () => {
    // gap-marker is the one marker that is evidence about its own window.
    const summary = emptyMonthSummary('2026-07');
    for (const kind of ['reset-marker', 'prune-marker', 'heartbeat-marker', 'month-rotation-marker']) {
      addRecordsToSummary(summary, [rec({ kind, verdict: undefined } as Partial<ForensicRecord>)]);
    }
    expect(summary.usageByHour[HOUR], 'housekeeping is not an outage').toBeUndefined();
  });
});
