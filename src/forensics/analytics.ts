// FeelingWise - Read-only forensic analytics
//
// Pure aggregation functions that turn the signed chain into the interpretive
// views parents / lawyers / judges need. ADDITIVE + READ-ONLY: nothing here
// mutates a record, touches a write path, or alters a canonical payload. Every
// number derives ONLY from fields already on the signed record, so a verifier
// holding the same chain can recompute every output independently.
//
// All functions take `records: ForensicRecord[]` as input (no IDB coupling) so
// they are unit-testable in isolation. A thin store-side wrapper may call
// getRecords() and pass the result through. Every function tolerates sparse /
// legacy records (missing metrics / environment / verdict / sourceCategory)
// without throwing.

import type { ForensicRecord, RecordMetrics } from '../types/forensic';
import { authorProfileKey, type AuthorProfile } from './author-store';
import { isPaidPlacement } from './paid-placement';
import { carriesFlagVerdict, isRepeatMarkOnly } from './flag-verdict';

// ─── Shared helpers ─────────────────────────────────────────────────────────

/**
 * Verdicts that count as a real manipulation/harm EXPOSURE event for the
 * interpretive views. Mirrors computeStats() in store.ts: an undefined verdict
 * is a flagged record written before the field existed; 'flagged-hidden' is a
 * slur-tier comment FW removed from the child's view, still an exposure event
 * because the platform served it even though FW hid it.
 * Everything else (pass / skipped / blocked / cancelled-* / educational-
 * reframe / environment markers) is pipeline trace, not exposure, and is
 * excluded from exposure-oriented aggregation.
 *
 * Advertising is excluded too, whatever verdict it carries (standing decision
 * 1, 2026-09-14). The child and teen pipeline records a sponsored post as
 * flagged-hidden with technique consumer-rapid-frame at severity 6 from the
 * platform's ad marker alone; on a real export that was half of
 * everything the app acted on, and the adult reader fired on none of it. An ad
 * is a paid placement, not an exposure event: it leaves the timeline, the
 * severity sums and the technique tallies here. The record is untouched.
 */
export function isExposureRecord(r: ForensicRecord): boolean {
  if (isPaidPlacement(r)) return false;
  // A repeat-exposure mark alone is "seen a lot", not a flag (the Head, 10 Oct 2026): it leaves the bars, the streak,
  // the rhythm and the technique tallies, as it already left the export's judged count.
  if (isRepeatMarkOnly(r)) return false;
  return carriesFlagVerdict(r);
}

/**
 * Severity-weighted contribution of one record: sum of per-technique severity.
 * Empty / missing techniques contribute 0. Severity values are taken verbatim
 * from the signed record (no re-scoring).
 *
 * An ad weighs 0 whatever its record says (standing decision 1): the severity 6
 * on a legacy sponsored-ad record is the ad marker's certainty, never a reading
 * of harm, and reading it as one put advertising at the head of every
 * severity-ranked surface.
 */
export function severityWeight(r: ForensicRecord): number {
  if (isPaidPlacement(r)) return 0;
  // Its 6 is fixed by the rule, not read from the content.
  if (isRepeatMarkOnly(r)) return 0;
  if (!Array.isArray(r.techniques)) return 0;
  let sum = 0;
  for (const t of r.techniques) {
    if (t && typeof t.severity === 'number' && Number.isFinite(t.severity)) sum += t.severity;
  }
  return sum;
}

/**
 * UTC bucket key for a timestamp. 'day' → 'YYYY-MM-DD'; 'week' → the ISO date
 * of the Monday that starts that week ('YYYY-MM-DD'). UTC throughout so the
 * bucketing is deterministic and recomputable regardless of the viewer's
 * timezone. Returns null for an unparseable timestamp (legacy / corrupt).
 */
export function bucketKey(timestamp: string, bucket: 'day' | 'week'): string | null {
  const ms = Date.parse(timestamp);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (bucket === 'day') {
    return d.toISOString().slice(0, 10);
  }
  // Week: roll back to Monday (UTC). getUTCDay(): 0=Sun..6=Sat.
  const day = d.getUTCDay();
  const daysFromMonday = (day + 6) % 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysFromMonday));
  return monday.toISOString().slice(0, 10);
}

/** Reads the best-available "view count" off a record's metrics. */
function recordViews(m: RecordMetrics | undefined): number | undefined {
  if (!m) return undefined;
  return typeof m.views === 'number' && Number.isFinite(m.views) ? m.views : undefined;
}

/**
 * Reads the best-available "like count" off a record's metrics. Posts carry
 * `primary_likes`; comments carry `likes`. Prefer whichever is present.
 */
function recordLikes(m: RecordMetrics | undefined): number | undefined {
  if (!m) return undefined;
  if (typeof m.primary_likes === 'number' && Number.isFinite(m.primary_likes)) return m.primary_likes;
  if (typeof m.likes === 'number' && Number.isFinite(m.likes)) return m.likes;
  return undefined;
}

// ─── 1. Exposure timeline ────────────────────────────────────────────────────

interface ExposureBucket {
  /** Bucket key: 'YYYY-MM-DD' (day, or the week's Monday). */
  bucket: string;
  /** Exposure-record count in this bucket. */
  count: number;
  /** Sum of per-technique severity across the bucket's records. */
  severitySum: number;
  /** Per-technique exposure counts (raw technique name as stored). */
  byTechnique: Record<string, number>;
  /** Per-platform exposure counts. */
  byPlatform: Record<string, number>;
  /** Per-feedSource exposure counts. */
  byFeedSource: Record<string, number>;
}

export interface ExposureTimeline {
  bucketSize: 'day' | 'week';
  /** Buckets sorted ascending by key. */
  buckets: ExposureBucket[];
  /** Total exposure records placed in a bucket. */
  total: number;
  /** Records dropped because their timestamp was unparseable. */
  undatedCount: number;
}

/**
 * Time-bucketed exposure: per bucket, count + severity-sum, broken down by
 * technique, platform, feedSource. The "shame-attacks tripled this week" view.
 * Only exposure records (flagged / flagged-hidden / legacy-undefined) count.
 */
export function computeExposureTimeline(
  records: ForensicRecord[],
  opts?: { bucket?: 'day' | 'week' },
): ExposureTimeline {
  const bucketSize = opts?.bucket ?? 'day';
  const map = new Map<string, ExposureBucket>();
  let total = 0;
  let undatedCount = 0;

  for (const r of records) {
    if (!isExposureRecord(r)) continue;
    const key = bucketKey(r.timestamp, bucketSize);
    if (key === null) {
      undatedCount++;
      continue;
    }
    let b = map.get(key);
    if (!b) {
      b = { bucket: key, count: 0, severitySum: 0, byTechnique: {}, byPlatform: {}, byFeedSource: {} };
      map.set(key, b);
    }
    b.count++;
    total++;
    b.severitySum += severityWeight(r);

    if (r.platform) b.byPlatform[r.platform] = (b.byPlatform[r.platform] ?? 0) + 1;
    const fs = r.feedSource ?? 'unknown';
    b.byFeedSource[fs] = (b.byFeedSource[fs] ?? 0) + 1;
    if (Array.isArray(r.techniques)) {
      for (const t of r.techniques) {
        if (!t || !t.name) continue;
        b.byTechnique[t.name] = (b.byTechnique[t.name] ?? 0) + 1;
      }
    }
  }

  const buckets = [...map.values()].sort((a, b) => (a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0));
  return { bucketSize, buckets, total, undatedCount };
}

// ─── 2. Amplification trend ──────────────────────────────────────────────────

interface AmplificationBucket {
  bucket: string;
  /**
   * Distribution of the record-level `environment.algorithmicAmplification`
   * label across exposure records in this bucket. Records lacking the field
   * (no environment, or environment without the label) fall into `unknown`.
   */
  amplificationLabels: { high: number; normal: number; low: number; unknown: number };
  /**
   * views÷likes ratio averaged over records that carry BOTH a view count and a
   * non-zero like count. null when no record in the bucket had both. This is
   * the recomputable form of the platform's amplification proxy (the same
   * ratio environment.algorithmicAmplification bands on).
   */
  meanViewsPerLike: number | null;
  /** How many records contributed to meanViewsPerLike. */
  ratioSampleSize: number;
}

interface AmplifiedPost {
  postUrl: string;
  /** Number of exposure sightings of this URL. */
  sightings: number;
  /** Max views÷likes ratio observed across sightings (null if never both-present). */
  maxViewsPerLike: number | null;
  /** Worst (most-amplified) label observed: high > normal > low > unknown. */
  worstLabel: 'high' | 'normal' | 'low' | 'unknown';
}

export interface AmplificationTrend {
  buckets: AmplificationBucket[];
  /**
   * Posts seen 2+ times as exposure records, sorted by maxViewsPerLike desc
   * (nulls last). The "the platform pushed this at 140x organic" repeat-push
   * view. Empty when no URL recurred.
   */
  repeatedPosts: AmplifiedPost[];
}

function emptyLabelDist(): AmplificationBucket['amplificationLabels'] {
  return { high: 0, normal: 0, low: 0, unknown: 0 };
}

const LABEL_RANK: Record<'high' | 'normal' | 'low' | 'unknown', number> = {
  high: 3, normal: 2, low: 1, unknown: 0,
};

/**
 * Per time-bucket algorithmic-amplification distribution + the recomputable
 * views/likes ratio, plus per-URL repeat-push detection (URLs seen 2+ times).
 * FW's most distinctive signal: "the platform pushed this at 140x organic."
 * Day-bucketed (UTC). Only exposure records participate.
 */
export function computeAmplificationTrend(records: ForensicRecord[]): AmplificationTrend {
  const map = new Map<string, AmplificationBucket>();
  // postUrl → { sightings, maxRatio, worstRank }
  const perUrl = new Map<string, { sightings: number; maxRatio: number | null; worstLabel: AmplifiedPost['worstLabel'] }>();

  const bucketFor = (timestamp: string): AmplificationBucket | null => {
    const key = bucketKey(timestamp, 'day');
    if (key === null) return null;
    let b = map.get(key);
    if (!b) {
      b = { bucket: key, amplificationLabels: emptyLabelDist(), meanViewsPerLike: null, ratioSampleSize: 0 };
      map.set(key, b);
    }
    return b;
  };

  // The amplification LABEL lives on the environment record — one per comment
  // room — and nowhere else. This loop used to read it off exposure records,
  // which never carry an `environment` field, so every label resolved to
  // 'unknown' and the dashboard card, gated on high + normal + low being zero,
  // could only ever say "no data". The field name was always right; the record
  // filter was reading the wrong records.
  //
  // Environment records are written with verdict 'pass' (logger.ts), so
  // isExposureRecord excludes them by design — it is about what the reader was
  // exposed to, and a room verdict is not an item. Hence two passes over the
  // same records rather than one widened filter.
  for (const r of records) {
    if (r.kind !== 'environment' || !r.environment) continue;
    const b = bucketFor(r.timestamp);
    if (!b) continue;
    const label = r.environment.algorithmicAmplification ?? 'unknown';
    b.amplificationLabels[label] = (b.amplificationLabels[label] ?? 0) + 1;
  }

  for (const r of records) {
    if (!isExposureRecord(r)) continue;
    const b = bucketFor(r.timestamp);
    if (!b) continue;

    // The per-URL worst label is the room's, when this item's room was read.
    const label = r.environment?.algorithmicAmplification ?? 'unknown';

    const views = recordViews(r.metrics);
    const likes = recordLikes(r.metrics);
    let ratio: number | null = null;
    if (views !== undefined && likes !== undefined && likes > 0) {
      ratio = views / likes;
      // Accumulate mean incrementally on the bucket.
      const priorSum = (b.meanViewsPerLike ?? 0) * b.ratioSampleSize;
      b.ratioSampleSize++;
      b.meanViewsPerLike = (priorSum + ratio) / b.ratioSampleSize;
    }

    // Per-URL repeat tracking.
    if (r.postUrl) {
      let u = perUrl.get(r.postUrl);
      if (!u) {
        u = { sightings: 0, maxRatio: null, worstLabel: 'unknown' };
        perUrl.set(r.postUrl, u);
      }
      u.sightings++;
      if (ratio !== null && (u.maxRatio === null || ratio > u.maxRatio)) u.maxRatio = ratio;
      if (LABEL_RANK[label] > LABEL_RANK[u.worstLabel]) u.worstLabel = label;
    }
  }

  const buckets = [...map.values()].sort((a, b) => (a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0));

  const repeatedPosts: AmplifiedPost[] = [...perUrl.entries()]
    .filter(([, u]) => u.sightings >= 2)
    .map(([postUrl, u]) => ({ postUrl, sightings: u.sightings, maxViewsPerLike: u.maxRatio, worstLabel: u.worstLabel }))
    .sort((a, b) => {
      // maxViewsPerLike desc, nulls last.
      if (a.maxViewsPerLike === null && b.maxViewsPerLike === null) return b.sightings - a.sightings;
      if (a.maxViewsPerLike === null) return 1;
      if (b.maxViewsPerLike === null) return -1;
      return b.maxViewsPerLike - a.maxViewsPerLike;
    });

  return { buckets, repeatedPosts };
}

// ─── 3. Author escalation ────────────────────────────────────────────────────

export interface AuthorEscalation {
  handle: string;
  platform: string;
  /** From the AuthorProfile entity store. */
  seen: number;
  flagged: number;
  /** flagged ÷ seen, 0 when seen is 0. */
  flagRate: number;
  /**
   * Techniques sorted by frequency (descending) from the profile's per-
   * technique counts. Empty when the profile recorded none.
   */
  dominantTechniques: { name: string; count: number }[];
  /**
   * Severity trend derived from this author's chain records split at their
   * temporal midpoint: mean severity-weight of the later half minus the
   * earlier half. 'rising' / 'flat' / 'falling' by the stated threshold;
   * 'insufficient-data' when fewer than the minimum chain records exist.
   */
  severityTrend: 'rising' | 'flat' | 'falling' | 'insufficient-data';
  /** Raw later-minus-earlier mean-severity delta (null when insufficient). */
  severityDelta: number | null;
  /**
   * Escalation rule (stated): TRUE when the author is a known repeat offender
   * AND their per-record severity is trending up. Concretely:
   *   seen >= MIN_SIGHTINGS (5) AND flagRate >= 0.5 AND severityTrend === 'rising'.
   */
  escalating: boolean;
}

const MIN_SIGHTINGS = 5;
const ESCALATION_FLAG_RATE = 0.5;
/** Mean-severity delta above this (later minus earlier) counts as 'rising'. */
const RISING_DELTA = 1;

/**
 * Per author: seen / flagged / dominant techniques (from the AuthorProfile
 * entity store) + a severity trend computed from this author's own chain
 * exposure records, and an `escalating` boolean by the stated rule. The
 * repeat-offender view.
 *
 * Author matching: records are bucketed by the platform-scoped composite key
 * `authorProfileKey(author, platform)` — the M18 key author-store itself uses
 * — and each profile looks up `authorProfileKey(p.handle, p.platform)`. A raw
 * handle match would merge two real accounts sharing one handle on different
 * platforms into a single severity trend (the exact cross-platform merge bug
 * M18/DASH-3 fixed elsewhere). Profiles with no matching chain records still
 * appear (using profile counts) but get severityTrend='insufficient-data'.
 */
export function computeAuthorEscalation(
  records: ForensicRecord[],
  profiles: AuthorProfile[],
): AuthorEscalation[] {
  // Index exposure records by platform-scoped author key. We do NOT also
  // bucket by roomAuthor to avoid double-counting a single record under two
  // handles — author is the actor who wrote the item.
  const byAuthor = new Map<string, ForensicRecord[]>();
  for (const r of records) {
    if (!isExposureRecord(r)) continue;
    const a = r.author;
    if (!a) continue;
    const key = authorProfileKey(a, r.platform);
    const list = byAuthor.get(key);
    if (list) list.push(r);
    else byAuthor.set(key, [r]);
  }

  return (profiles ?? []).map((p) => {
    const seen = p.totalSeen ?? 0;
    const flagged = p.totalFlagged ?? 0;
    const flagRate = seen > 0 ? flagged / seen : 0;

    const dominantTechniques = Object.entries(p.techniques ?? {})
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    // Severity trend from this author's chain records (platform-scoped).
    const authorRecords = (byAuthor.get(authorProfileKey(p.handle, p.platform)) ?? [])
      .slice()
      .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));

    let severityTrend: AuthorEscalation['severityTrend'] = 'insufficient-data';
    let severityDelta: number | null = null;

    if (authorRecords.length >= 4) {
      const mid = Math.floor(authorRecords.length / 2);
      const earlier = authorRecords.slice(0, mid);
      const later = authorRecords.slice(mid);
      const meanEarlier = earlier.reduce((s, r) => s + severityWeight(r), 0) / earlier.length;
      const meanLater = later.reduce((s, r) => s + severityWeight(r), 0) / later.length;
      severityDelta = meanLater - meanEarlier;
      if (severityDelta >= RISING_DELTA) severityTrend = 'rising';
      else if (severityDelta <= -RISING_DELTA) severityTrend = 'falling';
      else severityTrend = 'flat';
    }

    const escalating =
      seen >= MIN_SIGHTINGS && flagRate >= ESCALATION_FLAG_RATE && severityTrend === 'rising';

    return {
      handle: p.handle,
      platform: p.platform,
      seen,
      flagged,
      flagRate,
      dominantTechniques,
      severityTrend,
      severityDelta,
      escalating,
    };
  });
}

// (Section 4, "Evidence summary" — SeverityBand / bandForSeverity /
// EvidenceSummary / computeEvidenceSummary — deleted 2026-07-14 per the
// simplify rule, closing D3. It was built as a legal-export rollup but the
// HTML export grew a SUPERIOR mechanism: the embedded EXPOSURE_SCRIPT in
// html-export.ts recomputes the same rollup CLIENT-SIDE from the exact
// records the verifier checks, so it can never drift from the payload. Its
// severity bands also differed from this function's (top-technique rating
// vs severity sum) — shipping both would have shown two conflicting "high"
// counts on one surface (the same-label-different-number bug class,
// docs/history/brain-2026-05-to-08/lessons/2026-05-25-webhook-handler-idempotency.md §B). Recover
// from git history if a build-time
// rollup ever earns a real consumer.)
