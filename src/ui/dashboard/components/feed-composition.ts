// Patterns-tab data layer — feed composition ("what the feed was made of").
//
// DETERMINISTIC + FREE: re-derives content-label tallies from labels already
// stored on the forensic chain — no AI call, no new capture. Two distinct
// label axes, deliberately NOT merged (they answer different questions):
//   • TOPIC  — what the post was ABOUT (environment.topicLabels, the closed
//     TOPIC_LABELS vocabulary assigned by the comment-room call).
//   • FORMAT — what form the item TOOK (videoContext.contentType /
//     imageContext.contentType, each its own closed vocabulary from the
//     vision prompts: music-dance, meme-humor, news-format, …).
// Both axes are AI interpretation, not verbatim record words — the render
// side must frame them as such (same rule as technique chips).
//
// Also computes label COVERAGE: how many content records carry any label at
// all. "Knowing what we have" requires knowing what is still unlabeled —
// typed posts and comments have no topic-label path yet, and this number
// keeps that gap visible instead of letting the panel imply full coverage.
//
// Pure transform: ForensicRecord[] -> FeedComposition. Unit-testable without
// mounting React (same pattern as lexical-diet.ts / group-records.ts).

import type { ForensicRecord } from '../../../types/forensic';
import { entryKindOf } from '../record-sets';

export interface CompositionEntry {
  /** Closed-vocabulary label key, verbatim (e.g. 'comedy-memes', 'news-format'). */
  label: string;
  /** Records carrying the label (each record counts once per label). */
  count: number;
  /** Distinct record ids carrying the label, newest-first (drill-down members). */
  recordIds: string[];
  /** ISO timestamp of the most recent record carrying the label. */
  lastSeen: string;
  /** Distinct platforms the label was seen on, sorted. */
  platforms: string[];
}

export interface FeedComposition {
  /** TOPIC axis — from environment.topicLabels (multi-label per record). */
  topics: CompositionEntry[];
  /** FORMAT axis — from video/image contentType (one label per record). */
  formats: CompositionEntry[];
  /**
   * ROOM axis — the comment-room call's RELATIONAL verdict about the post and
   * its comment section (claimVsReaction, commentManipulation,
   * audienceDistress). Its own axis because it answers a different question
   * from "what was this about": "the comments ignore the post's claim" is a
   * finding, not a topic, and the same call emits both. Folding it into the
   * topic axis turned it into a failed topic classification and buried it in
   * the `other` bucket, which is the opposite of what reading the comments was
   * for. Keys are prefixed (`claim:` / `crowd:` / `distress`) so they can never
   * collide with a TOPIC_LABELS value.
   */
  rooms: CompositionEntry[];
  /** Content records carrying at least one label from either label axis. */
  labeled: number;
  /** Entries seen in range (record-sets.ts 'seen': items and comment-section summaries, markers excluded). */
  eligible: number;
  /** Comment-section summaries in range: the only entries a topic label comes from. */
  roomSummaries: number;
  /** Records that carry a structured room reading (the room call succeeded). */
  roomsRead: number;
  /** Records whose only topic is `other` but which DO carry a room reading. */
  otherWithRoomVerdict: number;
}

export interface FeedCompositionOptions {
  /** Lower bound (ISO). Records with timestamp < since are skipped. */
  since?: string;
  /** Upper bound (ISO). Records with timestamp > until are skipped. */
  until?: string;
}

interface Tally {
  label: string;
  recordTs: Map<string, string>;
  lastSeen: string;
  platforms: Set<string>;
}


// Format values that mean "the classifier could not place this" — they are shown
// in the breakdown (a large `other` mass is the evidence for widening the vocab)
// but they must NOT count as a meaningful label for coverage, or the coverage
// number lies (on a real feed 74% of video formats came back `other`, which would
// inflate "labeled" to ~4x the honest figure). Analyst ritual: name the unlabeled
// remainder honestly.
const UNCLASSIFIED_FORMATS: ReadonlySet<string> = new Set(['other']);

// Same rule on the TOPIC axis. `other` is the model saying nothing in the
// closed vocabulary fit; the row has always told the reader it counts as
// unlabeled, while the coverage arithmetic quietly counted it as labeled. The
// row was right. A record labelled ['other','news'] still counts: it has a
// real topic beside the residual.
const UNCLASSIFIED_TOPICS: ReadonlySet<string> = new Set(['other']);

function addLabel(tallies: Map<string, Tally>, label: string, r: ForensicRecord): void {
  let t = tallies.get(label);
  if (!t) {
    t = { label, recordTs: new Map(), lastSeen: r.timestamp, platforms: new Set() };
    tallies.set(label, t);
  }
  t.recordTs.set(r.id, r.timestamp);
  if (r.timestamp > t.lastSeen) t.lastSeen = r.timestamp;
  if (r.platform) t.platforms.add(r.platform);
}

function toEntries(tallies: Map<string, Tally>): CompositionEntry[] {
  return [...tallies.values()]
    .map((t) => ({
      label: t.label,
      count: t.recordTs.size,
      recordIds: [...t.recordTs.entries()]
        .sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0))
        .map(([id]) => id),
      lastSeen: t.lastSeen,
      platforms: [...t.platforms].sort(),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function buildFeedComposition(
  records: ForensicRecord[],
  opts: FeedCompositionOptions = {},
): FeedComposition {
  const topicTallies = new Map<string, Tally>();
  const formatTallies = new Map<string, Tally>();
  const roomTallies = new Map<string, Tally>();
  let labeled = 0;
  let eligible = 0;
  let roomSummaries = 0;
  let roomsRead = 0;
  let otherWithRoomVerdict = 0;

  for (const r of records) {
    if (opts.since && r.timestamp < opts.since) continue;
    if (opts.until && r.timestamp > opts.until) continue;
    const entryKind = entryKindOf(r);
    if (entryKind === 'marker') continue;
    eligible++;
    if (entryKind === 'roomSummary') roomSummaries++;

    const topics = r.environment?.topicLabels ?? [];
    const format = r.videoContext?.contentType || r.imageContext?.contentType || '';

    // A record is meaningfully labeled if it carries a topic OR a format that
    // actually classifies it. An `other`/unclassified label is shown in the
    // breakdown but does NOT count toward coverage (else the number lies).
    const meaningfulFormat = !!format && !UNCLASSIFIED_FORMATS.has(format);
    const meaningfulTopic = topics.some((l) => !UNCLASSIFIED_TOPICS.has(l));
    if (meaningfulTopic || meaningfulFormat) labeled++;

    for (const label of topics) addLabel(topicTallies, label, r);
    if (format) addLabel(formatTallies, format, r);

    // ── ROOM axis: the relational verdict, kept off the topic axis ──
    const env = r.environment;
    // `claimVsReaction` is written only when the structured room call
    // succeeded; the older summary-only records carry none of these fields.
    const hasRoomVerdict = !!env && env.claimVsReaction !== undefined;
    if (!hasRoomVerdict) continue;
    roomsRead++;
    if (!meaningfulTopic && topics.length > 0) otherWithRoomVerdict++;
    addLabel(roomTallies, `claim:${env.claimVsReaction}`, r);
    // 'none' is the absence of a finding, not a finding — same rule the
    // per-comment gate uses. Counting it would pad the axis with non-events.
    if (env.commentManipulation && env.commentManipulation !== 'none') {
      addLabel(roomTallies, `crowd:${env.commentManipulation}`, r);
    }
    if (env.audienceDistress) addLabel(roomTallies, 'distress', r);
  }

  return {
    topics: toEntries(topicTallies),
    formats: toEntries(formatTallies),
    rooms: toEntries(roomTallies),
    labeled,
    eligible,
    roomSummaries,
    roomsRead,
    otherWithRoomVerdict,
  };
}
