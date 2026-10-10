// The pure half of folding housekeeping records in the Activity list: which
// records fold, where a run starts and stops, what the line counts, and that a
// run never produces a time divider of its own. The mounted half is
// the-activity-list-folds-heartbeats.test.ts.

import { describe, it, expect } from 'vitest';
import {
  foldMarkerRunGroups, foldMarkerRunRecords, countMarkerKinds, markerRunSpan, isMarkerRunGroup,
} from '../../../../../src/ui/dashboard/components/marker-runs';
import { groupRecordsByPost } from '../../../../../src/ui/dashboard/components/group-records';
import { computeFeedDividers } from '../../../../../src/ui/dashboard/components/activity-drill';
import { SYSTEM_MARKER_KINDS } from '../../../../../src/forensics/system-records';
import { EN } from '../../../../../src/i18n/dashboard/en';
import { RO } from '../../../../../src/i18n/dashboard/ro';
import type { ForensicRecord } from '../../../../../src/types/forensic';

let n = 0;
function rec(partial: Partial<ForensicRecord>): ForensicRecord {
  n += 1;
  return {
    id: `r${n}`,
    platform: 'tiktok',
    kind: 'post',
    verdict: 'pass',
    timestamp: '2026-09-24T01:00:00.000Z',
    techniques: [],
    author: 'a',
    originalText: '',
    chainPosition: n,
    ...partial,
  } as unknown as ForensicRecord;
}
const hb = (ts: string) => rec({ kind: 'heartbeat-marker', platform: 'twitter', timestamp: ts });
const gap = (ts: string) => rec({ kind: 'gap-marker', platform: 'twitter', timestamp: ts });

describe('foldMarkerRunRecords', () => {
  it('folds consecutive housekeeping records and leaves content and gaps alone', () => {
    const p1 = rec({});
    const a = hb('2026-09-24T03:00:00.000Z');
    const b = hb('2026-09-24T03:15:00.000Z');
    const prune = rec({ kind: 'prune-marker', platform: 'twitter', timestamp: '2026-09-24T03:20:00.000Z' });
    const g = gap('2026-09-24T04:00:00.000Z');
    const c = hb('2026-09-24T05:00:00.000Z');
    const p2 = rec({});
    const items = foldMarkerRunRecords([p1, a, b, prune, g, c, p2]);
    expect(items.map((i) => i.key)).toEqual([p1.id, `markers:${a.id}`, g.id, `markers:${c.id}`, p2.id]);
    expect(items[1].run).toEqual([a, b, prune]);
    expect(items[3].run).toEqual([c]);
    expect(items[2].record).toBe(g);
    // Nothing is dropped: the rows still hold every record, which is what the
    // "Showing N of M" line counts.
    const held = items.reduce((k, i) => k + (i.run ? i.run.length : 1), 0);
    expect(held).toBe(7);
  });

  it('returns content-only lists unchanged, one item per record', () => {
    const list = [rec({}), rec({}), rec({})];
    expect(foldMarkerRunRecords(list).map((i) => i.record)).toEqual(list);
  });
});

describe('foldMarkerRunGroups', () => {
  it('merges neighbouring marker-only groups into one, keeping the order of what surrounds them', () => {
    const records = [
      rec({ surfaceSessionId: 's1', timestamp: '2026-09-24T01:00:00.000Z' }),
      hb('2026-09-24T03:00:00.000Z'),
      hb('2026-09-24T03:15:00.000Z'),
      hb('2026-09-24T03:30:00.000Z'),
      rec({ surfaceSessionId: 's2', timestamp: '2026-09-24T06:00:00.000Z' }),
    ];
    const folded = foldMarkerRunGroups(groupRecordsByPost(records));
    expect(folded).toHaveLength(3);
    const run = folded[1];
    expect(isMarkerRunGroup(run)).toBe(true);
    expect(run.children).toHaveLength(3);
    expect(run.firstSeenAt).toBe('2026-09-24T03:00:00.000Z');
    expect(run.lastSeenAt).toBe('2026-09-24T03:30:00.000Z');
    expect(isMarkerRunGroup(folded[0])).toBe(false);
  });

  it('never folds a gap marker: it stays a group of its own', () => {
    const records = [hb('2026-09-24T03:00:00.000Z'), gap('2026-09-24T04:00:00.000Z'), hb('2026-09-24T05:00:00.000Z')];
    const folded = foldMarkerRunGroups(groupRecordsByPost(records));
    expect(folded).toHaveLength(3);
    expect(folded.map((g) => isMarkerRunGroup(g))).toEqual([true, false, true]);
  });
});

describe('computeFeedDividers over folded groups', () => {
  it('draws no divider on a marker line and measures the gap between the posts around it', () => {
    const records = [
      rec({ surfaceSessionId: 's1', timestamp: '2026-09-24T01:00:00.000Z' }),
      hb('2026-09-24T03:00:00.000Z'),
      hb('2026-09-24T03:15:00.000Z'),
      rec({ surfaceSessionId: 's2', timestamp: '2026-09-24T06:00:00.000Z', platform: 'instagram' }),
    ];
    const groups = foldMarkerRunGroups(groupRecordsByPost(records));
    const dividers = computeFeedDividers(groups);
    // Newest first: the instagram post, the run, the tiktok post.
    expect(dividers[1]).toBeNull();
    expect(dividers[0]).toMatchObject({ kind: 'session', gapSeconds: 5 * 3600, fromPlatform: 'tiktok', toPlatform: 'instagram' });
  });
});

describe('countMarkerKinds and markerRunSpan', () => {
  it('counts each kind, most first, and spans earliest to latest whatever the order', () => {
    const run = [
      hb('2026-09-24T09:00:00.000Z'),
      rec({ kind: 'month-rotation-marker', platform: 'twitter', timestamp: '2026-09-24T03:00:00.000Z' }),
      hb('2026-09-24T06:00:00.000Z'),
    ];
    expect(countMarkerKinds(run)).toEqual([
      { kind: 'heartbeat-marker', count: 2 },
      { kind: 'month-rotation-marker', count: 1 },
    ]);
    expect(markerRunSpan(run)).toEqual({ from: '2026-09-24T03:00:00.000Z', to: '2026-09-24T09:00:00.000Z' });
  });
});

describe('the words for each kind', () => {
  it('has an everyday name for every housekeeping kind in English and Romanian, singular and plural', () => {
    for (const kind of SYSTEM_MARKER_KINDS) {
      for (const t of [EN, RO]) {
        const one = t.feedMarkerKindWord(kind, 1);
        const many = t.feedMarkerKindWord(kind, 12);
        expect(one.length).toBeGreaterThan(0);
        expect(many.length).toBeGreaterThan(0);
        expect(one).not.toMatch(/marker/i);
      }
    }
    expect(EN.feedMarkerKindWord('heartbeat-marker', 12)).toBe('record heartbeats');
    expect(EN.feedMarkerKindWord('heartbeat-marker', 1)).toBe('record heartbeat');
    // Romanian puts "de" before the noun from twenty up.
    expect(RO.feedMarkerKindWord('heartbeat-marker', 20)).toMatch(/^de /);
  });
});
