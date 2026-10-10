// Activity list: runs of housekeeping records drawn as one line.
//
// The recorder writes a heartbeat up to every fifteen minutes while a feed is
// open, so a night of browsing left dozens of them between the posts, each a
// card of its own. They are evidence about the record, not about the feed, and
// the Record tab lists each one; here a run of them only needs to say that it
// is there, how many, of what kind and over what time. Folding changes the
// drawing, never the listing: every record stays in the list the "Showing N of
// M" line counts, some of them inside a run.
//
// A gap marker is never folded. It says the recorder was off, which the reader
// needs to see at the place in the list where it happened, so it keeps its own
// line and splits the runs on either side of it.

import type { ForensicRecord } from '../../../types/forensic';
import { isMarker, MARKER_KINDS } from '../record-sets';
import type { RecordGroup } from './PostGroupCard';

function isFoldableMarker(r: ForensicRecord): boolean {
  return isMarker(r) && r.kind !== 'gap-marker';
}

function groupMembers(g: RecordGroup): ForensicRecord[] {
  return g.postRecord ? [g.postRecord, ...g.children] : g.children;
}

/** A group made only of housekeeping records, gap markers included: nothing a feed served. */
export function isMarkerOnlyGroup(g: RecordGroup): boolean {
  const all = groupMembers(g);
  return all.length > 0 && all.every(isMarker);
}

/** A group the list draws as one folded line. */
export function isMarkerRunGroup(g: RecordGroup): boolean {
  const all = groupMembers(g);
  return all.length > 0 && all.every(isFoldableMarker);
}

/**
 * Merges each run of neighbouring marker-only groups into one group whose
 * children are the run's records, in the order they were drawn. The run keeps
 * the serve bounds of what it holds so anything that sorts or measures by them
 * still reads it right; its key is stable while its newest record is.
 */
export function foldMarkerRunGroups(groups: readonly RecordGroup[]): RecordGroup[] {
  const out: RecordGroup[] = [];
  let run: RecordGroup[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const children = run.flatMap(groupMembers);
    const span = markerRunSpan(children);
    const key = `markers:${run[0].key}`;
    out.push({
      key,
      postRecord: null,
      roomAuthor: '',
      roomCaption: '',
      roomUrl: '',
      platform: run[0].platform,
      latestTs: span.to,
      firstSeenAt: span.from,
      lastSeenAt: span.to,
      sessionKey: `solo:${key}`,
      children,
      flaggedCount: 0,
      blockedCount: 0,
    });
    run = [];
  };
  for (const g of groups) {
    if (isMarkerRunGroup(g)) {
      run.push(g);
    } else {
      flush();
      out.push(g);
    }
  }
  flush();
  return out;
}

/** One row of the flat list: a record drawn as itself, or a folded run. */
export type FlatFeedItem =
  | { key: string; record: ForensicRecord; run?: undefined }
  | { key: string; run: ForensicRecord[]; record?: undefined };

export function foldMarkerRunRecords(records: readonly ForensicRecord[]): FlatFeedItem[] {
  const out: FlatFeedItem[] = [];
  let run: ForensicRecord[] = [];
  const flush = () => {
    if (run.length === 0) return;
    out.push({ key: `markers:${run[0].id}`, run });
    run = [];
  };
  for (const r of records) {
    if (isFoldableMarker(r)) {
      run.push(r);
    } else {
      flush();
      out.push({ key: r.id, record: r });
    }
  }
  flush();
  return out;
}

const KIND_ORDER: readonly string[] = MARKER_KINDS;

/** How many of each kind the run holds, the commonest first. */
export function countMarkerKinds(run: readonly ForensicRecord[]): Array<{ kind: string; count: number }> {
  const counts = new Map<string, number>();
  for (const r of run) {
    const kind = r.kind ?? '';
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return Array.from(counts, ([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

/** The run's earliest and latest write times. A flat list is newest first and a tree is not, so this never trusts the order. */
export function markerRunSpan(run: readonly ForensicRecord[]): { from: string; to: string } {
  let from = '';
  let to = '';
  for (const r of run) {
    if (!from || r.timestamp < from) from = r.timestamp;
    if (!to || r.timestamp > to) to = r.timestamp;
  }
  return { from, to };
}
