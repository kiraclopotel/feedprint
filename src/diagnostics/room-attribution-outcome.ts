// FeelingWise — comment-room attribution mutation tally.
//
// SCOPE (read this before trusting the numbers): the caller records the room
// values actually applied to a pending comment batch. Known author/URL
// conflicts and real→default regressions are held at the first observed room;
// default→real fills still apply. Historical persisted tallies may contain
// pre-guard room-changed events. This instrument cannot detect a future adapter
// filing a comment under the wrong parentVideoId at enqueue time; the known
// TikTok empty-caption cross-container path is prevented at extraction. A parent arriving after
// a flush now seeds later batches through the bounded identity cache, but no
// code can retroactively repair an already-emitted room-less record.
//
// A comment bucket carries ONE shared room (author + caption + URL) read at
// flush onto successful comment records and onto the ENVIRONMENT_LOG. This module
// classifies each applied in-place mutation and, on the two re-attributing
// outcomes, records the number of comments in the bucket at mutation time.
// That count is an UPPER BOUND: the flush
// viewport + no-sink gates (index.ts:940-989) may drop some of those comments
// before any record is written, so it overstates true damage. It is paired with
// a bounded ring of exemplars (from/to values) so every count is auditable
// rather than a bare integer. Measure before the fix; do not weaken honesty of
// the labels to make the number look decisive.

const ROOM_MUTATION_STORAGE_KEY = 'commentRoomMutations';
/** Bounded exemplar ring size — enough to spot-check, small enough to stay cheap. */
export const ROOM_MUTATION_EXAMPLES_MAX = 8;
/** Captions in exemplars are truncated to this so the ring stays small. */
const EXAMPLE_CAPTION_MAX = 80;

/** A comment bucket's room fields, as they sit on the bucket / on an incoming
 *  video record. Defaults are author 'unknown', url '', caption ''. */
export interface RoomFields {
  author: string;
  url: string;
  caption: string;
}

export type RoomField = 'author' | 'url' | 'caption';

/**
 * What one in-place bucket-room overwrite did:
 *  - room-changed:   a real field value became a DIFFERENT real value → prior
 *                    comments in the bucket are re-attributed to the new room.
 *  - room-regressed: a real field value was clobbered back to a default → prior
 *                    comments lose a room they had.
 *  - filled:         a default field was filled with a real value, no
 *                    change/regress → benign enrichment (the expected case).
 *  - idempotent:     nothing meaningfully changed (equal reals or both-default).
 * Only room-changed and room-regressed re-attribute already-bucketed comments.
 */
export type RoomMutationOutcome = 'room-changed' | 'room-regressed' | 'filled' | 'idempotent';

/** Fixed enumeration — also the display order (most-concerning first). */
const ALL_ROOM_MUTATION_OUTCOMES: readonly RoomMutationOutcome[] = [
  'room-changed',
  'room-regressed',
  'filled',
  'idempotent',
] as const;

const ALL_ROOM_FIELDS: readonly RoomField[] = ['author', 'url', 'caption'] as const;

/** Plain-English debug labels — these ride in the Copy-diagnostics JSON, not
 *  parent-facing UI, so they stay plain English debug prose. */
const ROOM_MUTATION_LABEL: Record<RoomMutationOutcome, string> = {
  'room-changed': 'a real room value was replaced by a different real value (already-bucketed comments re-attributed)',
  'room-regressed': 'a real room value was clobbered back to a default (unknown author / empty url or caption)',
  filled: 'a default room field was filled with a real value (benign: video record arrived after the first comments)',
  idempotent: 'the overwrite changed nothing (equal values or both default)',
};

/** One audited overwrite that re-attributed comments — the raw evidence behind
 *  a room-changed / room-regressed tick, so a count can be spot-checked. Raw
 *  values live ONLY in the persisted tally (`RoomMutationTally.recentChanges`,
 *  local to this device); they never leave this module — see
 *  `RoomMutationExampleRedacted`, the shape that actually rides in
 *  `RoomMutationSummary` (and from there into the Copy-diagnostics clipboard
 *  export). DASH-1: this ring used to be exported with the raw values still
 *  attached, the one summarizer in the clipboard JSON that wasn't
 *  content-free. */
interface RoomMutationExample {
  ts: string;
  key: string;
  outcome: 'room-changed' | 'room-regressed';
  fields: RoomField[];
  from: RoomFields;
  to: RoomFields;
  /** Comments in the bucket at overwrite time (upper bound; pre flush gates). */
  bucketed: number;
}

/** Per-field "was this a real value or the default" shape — content-free by
 *  construction (booleans, never the actual author/url/caption text). */
interface RoomFieldPresence {
  author: boolean;
  url: boolean;
  caption: boolean;
}

/** The public, content-free counterpart of `RoomMutationExample`: same
 *  metadata (when, which key, which outcome, which fields, how many comments
 *  were bucketed) but `from`/`to` are reduced to real-vs-default booleans.
 *  This is the shape that leaves `summarizeRoomMutations()` and therefore the
 *  only shape the dashboard UI / Copy-diagnostics clipboard ever sees. */
interface RoomMutationExampleRedacted {
  ts: string;
  /** An ordinal within this summary ('room-1', 'room-2'), never the platform's
   *  own id: enough to see that two changes hit the same room, and nothing a
   *  URL can be rebuilt from (M90a). */
  key: string;
  outcome: 'room-changed' | 'room-regressed';
  fields: RoomField[];
  from: RoomFieldPresence;
  to: RoomFieldPresence;
  bucketed: number;
}

/** The event a caller folds in: the classify result plus the raw values needed
 *  to build an exemplar and the bucket size at overwrite time. */
export interface RoomMutationEvent {
  outcome: RoomMutationOutcome;
  changedFields: RoomField[];
  from: RoomFields;
  to: RoomFields;
  key: string;
  bucketedComments: number;
}

export interface RoomMutationTally {
  /** ISO-8601 of the first overwrite folded into this window. */
  since: string;
  counts: Record<RoomMutationOutcome, number>;
  /** Sum of comments in the bucket over all room-changed + room-regressed
   *  events. UPPER BOUND — flush gates may drop some before a record is written. */
  commentsAtRoomChange: number;
  /** Worst single room-changed / room-regressed event's bucket size. */
  maxCommentsAtRoomChange: number;
  /** How often each field drove a change/regress (which signal drifts). */
  fieldChanges: Record<RoomField, number>;
  /** Bounded ring of the most recent re-attributing events, newest first. */
  recentChanges: RoomMutationExample[];
}

export interface RoomMutationSummary {
  /** Total overwrite events observed (includes benign idempotent re-fires). */
  total: number;
  since: string;
  roomChanged: number;
  roomRegressed: number;
  /** Rounded % of ALL overwrites that were a genuine mid-window room change.
   *  Denominator includes idempotent re-fires, so read it alongside the raw
   *  counts and the exemplars, not on its own. */
  roomChangedPct: number;
  commentsAtRoomChange: number;
  maxCommentsAtRoomChange: number;
  fieldChanges: Record<RoomField, number>;
  /** Content-free — real-vs-default shape only, never the raw author/url/
   *  caption text (DASH-1). This is what rides in Copy-diagnostics. */
  recentChanges: RoomMutationExampleRedacted[];
  /** Non-zero outcomes, most frequent first. */
  breakdown: { outcome: RoomMutationOutcome; label: string; count: number; pct: number }[];
}

const isRealAuthor = (v: string): boolean => v.length > 0 && v !== 'unknown';
const isRealText = (v: string): boolean => v.length > 0;
const isReal = (field: RoomField, v: string): boolean =>
  field === 'author' ? isRealAuthor(v) : isRealText(v);

type FieldVerdict = 'change' | 'regress' | 'fill' | 'none';

function fieldVerdict(field: RoomField, oldVal: string, newVal: string): FieldVerdict {
  const oldReal = isReal(field, oldVal);
  const newReal = isReal(field, newVal);
  if (oldReal && newReal) return oldVal === newVal ? 'none' : 'change';
  if (oldReal && !newReal) return 'regress';
  if (!oldReal && newReal) return 'fill';
  return 'none';
}

/**
 * Classify one in-place bucket-room overwrite (existing bucket room vs the
 * incoming video/caption record's room). Pure — the caller passes primitives so
 * this stays Node-testable. `changedFields` lists only the fields that a
 * real→different-real or real→default transition touched (the ones that
 * re-attribute prior comments); fills are benign and never listed.
 */
export function classifyRoomMutation(
  existing: RoomFields,
  incoming: RoomFields,
): { outcome: RoomMutationOutcome; changedFields: RoomField[] } {
  const verdicts = ALL_ROOM_FIELDS.map((f) => ({ field: f, verdict: fieldVerdict(f, existing[f], incoming[f]) }));
  const changedFields = verdicts
    .filter((v) => v.verdict === 'change' || v.verdict === 'regress')
    .map((v) => v.field);
  let outcome: RoomMutationOutcome;
  if (verdicts.some((v) => v.verdict === 'change')) outcome = 'room-changed';
  else if (verdicts.some((v) => v.verdict === 'regress')) outcome = 'room-regressed';
  else if (verdicts.some((v) => v.verdict === 'fill')) outcome = 'filled';
  else outcome = 'idempotent';
  return { outcome, changedFields };
}

function zeroCounts(): Record<RoomMutationOutcome, number> {
  const out = {} as Record<RoomMutationOutcome, number>;
  for (const o of ALL_ROOM_MUTATION_OUTCOMES) out[o] = 0;
  return out;
}

function zeroFieldChanges(): Record<RoomField, number> {
  const out = {} as Record<RoomField, number>;
  for (const f of ALL_ROOM_FIELDS) out[f] = 0;
  return out;
}

const safeNonNeg = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;

const truncate = (s: string, max: number): string =>
  s.length > max ? s.slice(0, max) + '…' : s;

/** Coerce a persisted (possibly partial / stale-shaped) tally into a full one. */
function normalizeTally(tally: RoomMutationTally | null, ts: string): RoomMutationTally {
  const counts = zeroCounts();
  if (tally && tally.counts && typeof tally.counts === 'object') {
    for (const o of ALL_ROOM_MUTATION_OUTCOMES) counts[o] = safeNonNeg((tally.counts as Record<string, unknown>)[o]);
  }
  const fieldChanges = zeroFieldChanges();
  if (tally && tally.fieldChanges && typeof tally.fieldChanges === 'object') {
    for (const f of ALL_ROOM_FIELDS) fieldChanges[f] = safeNonNeg((tally.fieldChanges as Record<string, unknown>)[f]);
  }
  const recentChanges = Array.isArray(tally?.recentChanges)
    ? tally.recentChanges.filter((e): e is RoomMutationExample => !!e && typeof e === 'object').slice(0, ROOM_MUTATION_EXAMPLES_MAX)
    : [];
  const since = tally && typeof tally.since === 'string' && tally.since ? tally.since : ts;
  return {
    since,
    counts,
    commentsAtRoomChange: safeNonNeg(tally?.commentsAtRoomChange),
    maxCommentsAtRoomChange: safeNonNeg(tally?.maxCommentsAtRoomChange),
    fieldChanges,
    recentChanges,
  };
}

/** Reduce a raw room-fields snapshot to real-vs-default booleans — the
 *  content-free shape that is allowed to leave this module. */
const redactRoomFields = (f: RoomFields): RoomFieldPresence => ({
  author: isReal('author', f.author),
  url: isReal('url', f.url),
  caption: isReal('caption', f.caption),
});

/**
 * Redact one exemplar for export (DASH-1): keeps every non-content field
 * (ts/outcome/fields/bucketed), collapses `from`/`to` to booleans, and
 * replaces the bucket key with an ordinal.
 *
 * The key is `post.parentVideoId ?? post.id` (comment-batch/queue.ts), which
 * is the platform's own id for a video or a post: enough to rebuild a URL and
 * name what somebody watched. It was travelling raw inside the summary this
 * module exists to make content-free, and that summary is what a parent copies
 * out of Copy Diagnostics and pastes to a stranger (register item M90a).
 *
 * An ordinal keeps the only thing the key was read for - telling whether two
 * changes were the same room - and drops the identifier. It is assigned per
 * summary, in first-seen order, so it means nothing outside the summary that
 * carries it. The stored exemplar keeps its real key; that never leaves the
 * device.
 */
const redactExample = (e: RoomMutationExample, ordinals: Map<string, string>): RoomMutationExampleRedacted => {
  let ordinal = ordinals.get(e.key);
  if (ordinal === undefined) {
    ordinal = `room-${ordinals.size + 1}`;
    ordinals.set(e.key, ordinal);
  }
  return {
    ts: e.ts,
    key: ordinal,
    outcome: e.outcome,
    fields: e.fields,
    from: redactRoomFields(e.from),
    to: redactRoomFields(e.to),
    bucketed: e.bucketed,
  };
};

const exampleFrom = (event: RoomMutationEvent, ts: string): RoomMutationExample => ({
  ts,
  key: event.key,
  outcome: event.outcome as 'room-changed' | 'room-regressed',
  fields: event.changedFields,
  from: { ...event.from, caption: truncate(event.from.caption, EXAMPLE_CAPTION_MAX) },
  to: { ...event.to, caption: truncate(event.to.caption, EXAMPLE_CAPTION_MAX) },
  bucketed: safeNonNeg(event.bucketedComments),
});

/** Fold one overwrite into the tally (pure; storage I/O lives in the recorder).
 *  Blast radius + an exemplar are recorded only on room-changed / room-regressed. */
export function foldRoomMutation(
  tally: RoomMutationTally | null,
  event: RoomMutationEvent,
  ts: string,
): RoomMutationTally {
  const next = normalizeTally(tally, ts);
  next.counts[event.outcome] += 1;
  if (event.outcome === 'room-changed' || event.outcome === 'room-regressed') {
    const n = safeNonNeg(event.bucketedComments);
    next.commentsAtRoomChange += n;
    if (n > next.maxCommentsAtRoomChange) next.maxCommentsAtRoomChange = n;
    for (const f of event.changedFields) next.fieldChanges[f] += 1;
    next.recentChanges = [exampleFrom(event, ts), ...next.recentChanges].slice(0, ROOM_MUTATION_EXAMPLES_MAX);
  }
  return next;
}

/** Roll the tally into a display summary (pure). Null when nothing recorded. */
export function summarizeRoomMutations(tally: RoomMutationTally | null): RoomMutationSummary | null {
  if (!tally) return null;
  const norm = normalizeTally(tally, tally.since);
  const counts = norm.counts;
  const total = ALL_ROOM_MUTATION_OUTCOMES.reduce((s, o) => s + counts[o], 0);
  if (total === 0) return null;
  const breakdown = ALL_ROOM_MUTATION_OUTCOMES.map((o) => ({
    outcome: o,
    label: ROOM_MUTATION_LABEL[o],
    count: counts[o],
    pct: Math.round((counts[o] / total) * 100),
  }))
    .filter((b) => b.count > 0)
    .sort((a, b) => b.count - a.count);
  return {
    total,
    since: norm.since,
    roomChanged: counts['room-changed'],
    roomRegressed: counts['room-regressed'],
    roomChangedPct: Math.round((counts['room-changed'] / total) * 100),
    commentsAtRoomChange: norm.commentsAtRoomChange,
    maxCommentsAtRoomChange: norm.maxCommentsAtRoomChange,
    fieldChanges: norm.fieldChanges,
    recentChanges: (() => { const ordinals = new Map<string, string>(); return norm.recentChanges.map(e => redactExample(e, ordinals)); })(),
    breakdown,
  };
}

/**
 * Classify + persist one bucket-room overwrite. Never throws; storage
 * unavailability drops the entry (telemetry never blocks the extraction path).
 * NOTE: read-modify-write on chrome.storage.local is not serialized, so bursts
 * of overwrites (rapid scroll, multiple tabs) can lose a tick. The counts are a
 * lower bound on frequency; the exemplars remain individually trustworthy.
 */
export async function recordRoomMutation(
  existing: RoomFields,
  incoming: RoomFields,
  bucketedComments: number,
  key: string,
): Promise<void> {
  try {
    if (typeof chrome === 'undefined' || !chrome?.storage?.local) return;
    const { outcome, changedFields } = classifyRoomMutation(existing, incoming);
    const ts = new Date().toISOString();
    const stored = await chrome.storage.local.get(ROOM_MUTATION_STORAGE_KEY);
    const prev = stored?.[ROOM_MUTATION_STORAGE_KEY] as RoomMutationTally | undefined;
    const event: RoomMutationEvent = { outcome, changedFields, from: existing, to: incoming, key, bucketedComments };
    await chrome.storage.local.set({
      [ROOM_MUTATION_STORAGE_KEY]: foldRoomMutation(prev ?? null, event, ts),
    });
  } catch {
    // best-effort
  }
}

/** Dashboard read: the raw tally. Never throws. */
export async function readRoomMutations(): Promise<RoomMutationTally | null> {
  try {
    if (typeof chrome === 'undefined' || !chrome?.storage?.local) return null;
    const stored = await chrome.storage.local.get(ROOM_MUTATION_STORAGE_KEY);
    const t = stored?.[ROOM_MUTATION_STORAGE_KEY];
    return t && typeof t === 'object' ? (t as RoomMutationTally) : null;
  } catch {
    return null;
  }
}
