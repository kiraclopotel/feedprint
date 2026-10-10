// @vitest-environment node
//
// "Empty slots = this browser was not on a covered platform during that
// window." One meaning, asserted as the only one, and it is the reassuring one.
//
// src/types/gap-marker.ts types TEN reasons a window can come back empty, among
// them recorder-down, context-invalidated and chain-lost, and the chain writes a
// signed marker for each. usage-band.ts bands every system marker to null, so
// the histogram discarded the chain's own evidence about the hole and the
// sentence underneath then told the reader the hole meant nobody was browsing.
// An hour holding proof that the recorder was dead drew identically to an hour
// somebody spent asleep.
//
// That is the defect a recipient cannot survive: a record that cannot tell
// "nothing happened" from "the recorder was not running" fails at the first
// question anybody asks of a timeline. Found 2026-09-18 by a stranger reading
// the dashboard, who noticed the Issues tab admits scans can "quietly degrade
// without an error" four panels away from the sentence claiming otherwise.

import { describe, it, expect } from 'vitest';
import { buildUsageBuckets } from '../../../../../src/ui/dashboard/components/UsageTimePanel';
import type { ForensicRecord } from '../../../../../src/types/forensic';

const NOW = Date.parse('2026-09-18T12:00:00Z');
const ONE_HOUR_AGO = Date.parse('2026-09-18T11:10:00Z');
const THREE_HOURS_AGO = Date.parse('2026-09-18T09:10:00Z');

function base(id: string, atMs: number): Record<string, unknown> {
  return {
    id, timestamp: new Date(atMs).toISOString(), platform: 'facebook',
    originalText: '', originalHash: 'h', originalLength: 0, neutralizedText: '',
    author: '@a', postUrl: '', techniques: [], overallScore: 0,
    userAgeCategory: 'adult', aiSource: 'cloud', feedSource: 'for-you',
    integrityHash: `hash-${id}`, signature: 'sig', publicKeyFingerprint: 'fp',
    chainPosition: 0,
  };
}

const impression = (id: string, atMs: number): ForensicRecord =>
  ({ ...base(id, atMs), kind: 'post', verdict: 'pass' }) as unknown as ForensicRecord;

/** What forensics/gap-marker.ts writes: kind 'gap-marker', chainAnchor 'gap'. */
const gapMarker = (id: string, atMs: number): ForensicRecord =>
  ({ ...base(id, atMs), kind: 'gap-marker', chainAnchor: 'gap', verdict: 'pass' }) as unknown as ForensicRecord;

function bucketAt(records: ForensicRecord[], atMs: number) {
  const buckets = buildUsageBuckets(records, 'day', NOW, 'en');
  const b = buckets.find((x) => atMs >= x.startMs && atMs < x.endMs);
  expect(b, 'the instant falls in a bucket of the day frame').toBeDefined();
  return b!;
}

describe('a gap is not an idle hour', () => {
  it('counts the signed gap marker instead of discarding it', () => {
    const b = bucketAt([gapMarker('g1', ONE_HOUR_AGO)], ONE_HOUR_AGO);
    expect(b.gaps, 'the chain said the recorder stopped and the panel heard it').toBe(1);
  });

  it('still shows nothing recorded, because a gap is not something the person saw', () => {
    const b = bucketAt([gapMarker('g1', ONE_HOUR_AGO)], ONE_HOUR_AGO);
    expect(b.count, 'a gap marker is not an impression').toBe(0);
    expect(b.pass + b.flagged + b.blocked + b.unjudged).toBe(0);
  });

  // The whole point: two empty bars that used to be indistinguishable.
  it('tells an hour the recorder was down from an hour nobody browsed', () => {
    const records = [gapMarker('g1', ONE_HOUR_AGO)];
    const down = bucketAt(records, ONE_HOUR_AGO);
    const asleep = bucketAt(records, THREE_HOURS_AGO);
    expect(down.count).toBe(0);
    expect(asleep.count).toBe(0);
    expect(down.gaps, 'one of them carries the chain’s own reason').toBe(1);
    expect(asleep.gaps, 'the other genuinely says nothing').toBe(0);
    expect(down.gaps === asleep.gaps, 'the two empty hours are no longer identical').toBe(false);
  });

  // The control. Ordinary records must be unaffected, and a gap sitting in an
  // hour that also has impressions must not deflate the bar.
  it('leaves an ordinary hour exactly as it was', () => {
    const b = bucketAt([impression('r1', ONE_HOUR_AGO), impression('r2', ONE_HOUR_AGO)], ONE_HOUR_AGO);
    expect(b.count).toBe(2);
    expect(b.pass).toBe(2);
    expect(b.gaps).toBe(0);
  });

  it('counts both when an hour holds impressions and a gap', () => {
    const b = bucketAt(
      [impression('r1', ONE_HOUR_AGO), gapMarker('g1', ONE_HOUR_AGO)], ONE_HOUR_AGO);
    expect(b.count, 'the gap did not become an impression').toBe(1);
    expect(b.gaps).toBe(1);
  });

  // Every other system marker stays out. The gap is admitted because it is
  // evidence ABOUT the window; a heartbeat or a rotation marker is not.
  it('admits the gap marker and no other housekeeping record', () => {
    const heartbeat = ({ ...base('h1', ONE_HOUR_AGO), kind: 'heartbeat-marker', chainAnchor: 'heartbeat', verdict: 'pass' }) as unknown as ForensicRecord;
    const rotation = ({ ...base('m1', ONE_HOUR_AGO), kind: 'month-rotation-marker', chainAnchor: 'month-rotation', verdict: 'pass' }) as unknown as ForensicRecord;
    const b = bucketAt([heartbeat, rotation], ONE_HOUR_AGO);
    expect(b.count).toBe(0);
    expect(b.gaps, 'only the gap marker is evidence about the hole').toBe(0);
  });
});
