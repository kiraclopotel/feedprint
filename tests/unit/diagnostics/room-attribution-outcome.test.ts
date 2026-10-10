// room-attribution-outcome — the "did a late video/caption record re-stamp a
// comment bucket's room mid-window?" tally (defect B measurement). Pure logic
// only: classify one bucket overwrite, fold it into a tally that tracks the
// blast radius AND a bounded ring of exemplars (so the counts are auditable),
// and summarize. No storage here.

import { describe, it, expect } from 'vitest';
import {
  classifyRoomMutation,
  foldRoomMutation,
  summarizeRoomMutations,
  ROOM_MUTATION_EXAMPLES_MAX,
  type RoomMutationTally,
  type RoomMutationEvent,
  type RoomFields,
} from '../../../src/diagnostics/room-attribution-outcome';

const room = (author: string, url: string, caption: string): RoomFields => ({ author, url, caption });

const ev = (
  outcome: RoomMutationEvent['outcome'],
  changedFields: RoomMutationEvent['changedFields'],
  bucketedComments: number,
  extra: Partial<RoomMutationEvent> = {},
): RoomMutationEvent => ({
  outcome,
  changedFields,
  bucketedComments,
  key: extra.key ?? 'k1',
  from: extra.from ?? room('@a', 'https://x/1', 'capA'),
  to: extra.to ?? room('@b', 'https://x/2', 'capB'),
});

describe('classifyRoomMutation', () => {
  it('same real values on every field is idempotent, nothing changed', () => {
    const r = classifyRoomMutation(room('@creator', 'https://x/1', 'hi'), room('@creator', 'https://x/1', 'hi'));
    expect(r.outcome).toBe('idempotent');
    expect(r.changedFields).toEqual([]);
  });

  it('a bucket seeded from defaults being filled by the real video record is filled, not a change', () => {
    const r = classifyRoomMutation(room('unknown', '', ''), room('@creator', 'https://x/1', 'a caption'));
    expect(r.outcome).toBe('filled');
    expect(r.changedFields).toEqual([]);
  });

  it('a real author replaced by a DIFFERENT real author is room-changed (the misattribution event)', () => {
    const r = classifyRoomMutation(room('@creatorA', 'https://x/1', 'cap'), room('@creatorB', 'https://x/1', 'cap'));
    expect(r.outcome).toBe('room-changed');
    expect(r.changedFields).toEqual(['author']);
  });

  it('a real author clobbered back to unknown is room-regressed', () => {
    const r = classifyRoomMutation(room('@creator', 'https://x/1', 'cap'), room('unknown', 'https://x/1', 'cap'));
    expect(r.outcome).toBe('room-regressed');
    expect(r.changedFields).toEqual(['author']);
  });

  it('detects a url change even when the author is idempotent', () => {
    const r = classifyRoomMutation(room('@creator', 'https://x/1', 'cap'), room('@creator', 'https://x/2', 'cap'));
    expect(r.outcome).toBe('room-changed');
    expect(r.changedFields).toEqual(['url']);
  });

  it('detects a caption change', () => {
    const r = classifyRoomMutation(room('@creator', 'https://x/1', 'old caption'), room('@creator', 'https://x/1', 'new caption'));
    expect(r.outcome).toBe('room-changed');
    expect(r.changedFields).toEqual(['caption']);
  });

  it('a change on one field outranks a fill on another (change wins)', () => {
    const r = classifyRoomMutation(room('@creatorA', '', 'cap'), room('@creatorB', 'https://x/1', 'cap'));
    expect(r.outcome).toBe('room-changed');
    expect(r.changedFields).toEqual(['author']);
  });

  it('both-default fields never register as a change', () => {
    const r = classifyRoomMutation(room('unknown', '', ''), room('unknown', '', ''));
    expect(r.outcome).toBe('idempotent');
    expect(r.changedFields).toEqual([]);
  });

  it('reports multiple changed fields together', () => {
    const r = classifyRoomMutation(room('@creatorA', 'https://x/1', 'capA'), room('@creatorB', 'https://x/2', 'capB'));
    expect(r.outcome).toBe('room-changed');
    expect(r.changedFields).toEqual(['author', 'url', 'caption']);
  });
});

describe('foldRoomMutation', () => {
  it('seeds a fresh tally with the timestamp as the window start', () => {
    const t = foldRoomMutation(null, ev('filled', [], 0), '2026-07-06T10:00:00.000Z');
    expect(t.since).toBe('2026-07-06T10:00:00.000Z');
    expect(t.counts.filled).toBe(1);
    expect(t.counts['room-changed']).toBe(0);
    expect(t.commentsAtRoomChange).toBe(0);
    expect(t.recentChanges).toEqual([]);
  });

  it('accrues blast radius only on room-changed / room-regressed', () => {
    let t = foldRoomMutation(null, ev('room-changed', ['author'], 5), '2026-07-06T10:00:00.000Z');
    t = foldRoomMutation(t, ev('room-regressed', ['url'], 2), '2026-07-06T10:01:00.000Z');
    // filled event with 9 already-bucketed comments must NOT count as re-attribution
    t = foldRoomMutation(t, ev('filled', [], 9), '2026-07-06T10:02:00.000Z');
    expect(t.counts['room-changed']).toBe(1);
    expect(t.counts['room-regressed']).toBe(1);
    expect(t.commentsAtRoomChange).toBe(7); // 5 + 2, the filled 9 excluded
    expect(t.maxCommentsAtRoomChange).toBe(5);
    expect(t.fieldChanges.author).toBe(1);
    expect(t.fieldChanges.url).toBe(1);
    expect(t.since).toBe('2026-07-06T10:00:00.000Z');
  });

  it('captures a newest-first exemplar for each changed/regressed event, but not for filled/idempotent', () => {
    let t = foldRoomMutation(null, ev('room-changed', ['author'], 5, { key: 'vidA', from: room('@a', 'https://x/1', 'ca'), to: room('@b', 'https://x/1', 'ca') }), '2026-07-06T10:00:00.000Z');
    t = foldRoomMutation(t, ev('filled', [], 0), '2026-07-06T10:01:00.000Z');
    t = foldRoomMutation(t, ev('idempotent', [], 0), '2026-07-06T10:02:00.000Z');
    t = foldRoomMutation(t, ev('room-regressed', ['url'], 1, { key: 'vidB' }), '2026-07-06T10:03:00.000Z');
    expect(t.recentChanges).toHaveLength(2);
    // newest first
    expect(t.recentChanges[0].key).toBe('vidB');
    expect(t.recentChanges[0].outcome).toBe('room-regressed');
    expect(t.recentChanges[1].key).toBe('vidA');
    expect(t.recentChanges[1].from.author).toBe('@a');
    expect(t.recentChanges[1].to.author).toBe('@b');
    expect(t.recentChanges[1].bucketed).toBe(5);
  });

  it('caps the exemplar ring and truncates long captions', () => {
    let t: RoomMutationTally | null = null;
    const longCap = 'x'.repeat(500);
    for (let i = 0; i < ROOM_MUTATION_EXAMPLES_MAX + 5; i++) {
      t = foldRoomMutation(t, ev('room-changed', ['caption'], 1, { key: `v${i}`, to: room('@b', 'https://x/1', longCap) }), '2026-07-06T10:00:00.000Z');
    }
    expect(t!.recentChanges).toHaveLength(ROOM_MUTATION_EXAMPLES_MAX);
    expect(t!.counts['room-changed']).toBe(ROOM_MUTATION_EXAMPLES_MAX + 5); // count is uncapped
    expect(t!.recentChanges[0].to.caption.length).toBeLessThanOrEqual(90); // truncated well under 500
  });

  it('repairs a partial / garbage persisted tally instead of trusting it', () => {
    const stale = {
      since: '2026-07-01T00:00:00.000Z',
      counts: { 'room-changed': 3, bogus: 9, filled: -2 },
      commentsAtRoomChange: -4,
      recentChanges: 'not-an-array',
    } as unknown as RoomMutationTally;
    const t = foldRoomMutation(stale, ev('filled', [], 0), '2026-07-06T00:00:00.000Z');
    expect(t.counts['room-changed']).toBe(3);
    expect(t.counts.filled).toBe(1);
    expect((t.counts as Record<string, number>).bogus).toBeUndefined();
    expect(t.commentsAtRoomChange).toBe(0); // negative repaired to 0
    expect(t.recentChanges).toEqual([]);    // garbage ring repaired to empty
    expect(t.since).toBe('2026-07-01T00:00:00.000Z');
  });
});

describe('summarizeRoomMutations', () => {
  it('returns null for no data', () => {
    expect(summarizeRoomMutations(null)).toBeNull();
    expect(summarizeRoomMutations({ since: 'x', counts: {} } as unknown as RoomMutationTally)).toBeNull();
  });

  it('computes the room-change rate, blast radius, exemplars, and a sorted breakdown', () => {
    let t: RoomMutationTally | null = null;
    const ts = '2026-07-06T10:00:00.000Z';
    for (let i = 0; i < 12; i++) t = foldRoomMutation(t, ev('idempotent', [], 0), ts);
    for (let i = 0; i < 5; i++) t = foldRoomMutation(t, ev('filled', [], 0), ts);
    t = foldRoomMutation(t, ev('room-changed', ['author'], 3), ts);
    t = foldRoomMutation(t, ev('room-changed', ['url'], 4), ts);
    t = foldRoomMutation(t, ev('room-regressed', ['author'], 1), ts);

    const s = summarizeRoomMutations(t)!;
    expect(s.total).toBe(20);
    expect(s.roomChanged).toBe(2);
    expect(s.roomRegressed).toBe(1);
    expect(s.roomChangedPct).toBe(10);
    expect(s.commentsAtRoomChange).toBe(8); // 3 + 4 + 1
    expect(s.maxCommentsAtRoomChange).toBe(4);
    expect(s.fieldChanges.author).toBe(2);
    expect(s.fieldChanges.url).toBe(1);
    expect(s.recentChanges).toHaveLength(3); // the 3 changed/regressed events
    expect(s.breakdown.map((b) => b.outcome)).toEqual(['idempotent', 'filled', 'room-changed', 'room-regressed']);
    expect(s.breakdown.map((b) => b.count)).toEqual([12, 5, 2, 1]);
    expect(s.breakdown.every((b) => b.label.length > 0)).toBe(true);
  });

  // DASH-1 (2026-07-13 dashboard-ui audit): the Copy-diagnostics clipboard
  // JSON embeds `roomMutationSummary` verbatim (OperationalEventsPanel.tsx),
  // and until this fix `recentChanges` carried the RAW author/url/caption —
  // real family browsing content and identity — into that export. Every
  // other summarizer riding in the same JSON is content-free (fixed enum
  // counts, bare hostnames at most); this locks `summarizeRoomMutations`
  // into matching that rule.
  describe('recentChanges is content-free (DASH-1)', () => {
    it('the same room keeps one ordinal and a different room gets another (M90a)', () => {
      let t: RoomMutationTally | null = null;
      t = foldRoomMutation(t, ev('room-changed', ['author'], 1, {
        key: 'video-alpha', from: room('@a', 'https://x/1', 'c'), to: room('@b', 'https://x/1', 'c'),
      }), '2026-07-06T10:00:00.000Z');
      t = foldRoomMutation(t, ev('room-changed', ['author'], 1, {
        key: 'video-beta', from: room('@a', 'https://x/1', 'c'), to: room('@b', 'https://x/1', 'c'),
      }), '2026-07-06T10:01:00.000Z');
      t = foldRoomMutation(t, ev('room-changed', ['author'], 1, {
        key: 'video-alpha', from: room('@a', 'https://x/1', 'c'), to: room('@b', 'https://x/1', 'c'),
      }), '2026-07-06T10:02:00.000Z');
      // The ring is newest first, so: alpha, beta, alpha.
      const keys = summarizeRoomMutations(t)!.recentChanges.map(e => e.key);
      expect(keys).toEqual(['room-1', 'room-2', 'room-1']);
      expect(JSON.stringify(keys)).not.toContain('video-');
    });

    it('never carries the real author, url, or caption text into the exported summary', () => {
      let t: RoomMutationTally | null = null;
      const ts = '2026-07-06T10:00:00.000Z';
      t = foldRoomMutation(t, ev('room-changed', ['author', 'url', 'caption'], 3, {
        key: 'video-42',
        from: room('@real_child_handle', 'https://tiktok.com/@real_child_handle/video/1234567890', 'a real caption that must never leave the device'),
        to: room('@another_real_handle', 'https://tiktok.com/@another_real_handle/video/9876543210', 'a different real caption'),
      }), ts);

      const s = summarizeRoomMutations(t)!;
      const json = JSON.stringify(s.recentChanges);

      expect(json).not.toContain('@real_child_handle');
      expect(json).not.toContain('@another_real_handle');
      expect(json).not.toContain('tiktok.com');
      expect(json).not.toContain('real caption');
      expect(json).not.toContain('different real caption');
    });

    it('keeps counts and content-free shape descriptors (real vs default) in place of the raw values', () => {
      let t: RoomMutationTally | null = null;
      const ts = '2026-07-06T10:00:00.000Z';
      t = foldRoomMutation(t, ev('room-changed', ['author', 'url', 'caption'], 3, {
        key: 'video-42',
        from: room('@real_child_handle', 'https://tiktok.com/1', 'real caption'),
        to: room('@another_real_handle', 'https://tiktok.com/2', 'another caption'),
      }), ts);

      const s = summarizeRoomMutations(t)!;
      const example = s.recentChanges[0];
      // M90a: the bucket key is the platform's own video/post id and used to
      // ride out raw in the summary a parent copies to a stranger. What leaves
      // is an ordinal within this summary.
      expect(example.key).toBe('room-1');
      expect(JSON.stringify(s)).not.toContain('video-42');
      expect(example.outcome).toBe('room-changed');
      expect(example.fields).toEqual(['author', 'url', 'caption']);
      expect(example.bucketed).toBe(3);
      expect(example.from).toEqual({ author: true, url: true, caption: true });
      expect(example.to).toEqual({ author: true, url: true, caption: true });
    });

    it('marks a real-to-default regression as real→default booleans, not the raw handle', () => {
      let t: RoomMutationTally | null = null;
      const ts = '2026-07-06T10:00:00.000Z';
      t = foldRoomMutation(t, ev('room-regressed', ['author'], 2, {
        key: 'video-7',
        from: room('@parent_visible_handle', 'https://x/1', 'cap'),
        to: room('unknown', 'https://x/1', 'cap'),
      }), ts);

      const s = summarizeRoomMutations(t)!;
      const example = s.recentChanges[0];
      expect(JSON.stringify(example)).not.toContain('@parent_visible_handle');
      expect(example.from.author).toBe(true);
      expect(example.to.author).toBe(false);
    });
  });
});
