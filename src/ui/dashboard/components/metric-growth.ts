// Engagement GROWTH between sightings — the data behind "Update Metrics".
//
// The forensic chain is append-only: an "Update Metrics" recheck re-opens the
// original and writes a NEW signed record with fresh engagement counts. So a
// post/comment's growth is derived by pairing records that share a STABLE
// identity and comparing the earliest capture to the latest sighting
// (capture-time → now). Pure + unit-testable; no DOM, no i18n, no formatting.

import type { ForensicRecord, RecordMetrics } from '../../../types/forensic';

// Numeric engagement keys we track for growth (post + comment shapes).
export type GrowthKey =
  | 'primary_likes' | 'likes' | 'views' | 'shares'
  | 'comments_count' | 'reply_count' | 'retweets' | 'quote_tweets' | 'bookmarks';

const GROWTH_KEYS: readonly GrowthKey[] = [
  'primary_likes', 'likes', 'views', 'shares',
  'comments_count', 'reply_count', 'retweets', 'quote_tweets', 'bookmarks',
] as const;

interface MetricDelta { key: GrowthKey; from: number; to: number; delta: number; }

export interface MetricGrowth {
  /** Timestamp of the first capture the latest sighting is compared against. */
  sinceTs: string;
  /** Timestamp of the latest sighting (whose metrics are the current numbers). */
  latestTs: string;
  /** How many metric-bearing sightings of this item exist. */
  sightings: number;
  /** The latest sighting's metrics — the current numbers to display. */
  latest: RecordMetrics;
  /** Non-zero per-metric changes from first capture to latest, in display order. */
  deltas: MetricDelta[];
}

function nonEmpty(u: string | undefined): string | null {
  return u && u.trim().length > 0 ? u : null;
}

// A bare platform-root URL ("https://www.facebook.com/") is not a stable item
// identity — different posts collapse onto it. Treat it as no-identity so two
// unrelated posts never pair into a fake "growth".
function isBareOrigin(u: string): boolean {
  try {
    const p = new URL(u);
    const path = p.pathname.replace(/\/+$/, '');
    return (path === '' || path === '/home' || path === '/foryou') && !p.search;
  } catch {
    return false;
  }
}

/**
 * A stable cross-sighting identity for a record, or null when the item can't be
 * paired (and so can't show growth). Comments key on `anchorUrl` (the exact-
 * comment deep-link); posts/videos key on `parentVideoId` (most stable) or a
 * non-bare `postUrl`. The `c:` / `p:` prefix keeps a comment from ever pairing
 * with its parent post (different metric shapes).
 */
export function growthIdentity(r: ForensicRecord): string | null {
  const isComment = r.kind === 'comment' || r.kind === 'reply' || r.kind === 'reply-to-reply';
  if (isComment) {
    const a = nonEmpty(r.anchorUrl);
    return a ? 'c:' + a : null;
  }
  if (r.parentVideoId) return 'p:' + r.parentVideoId;
  const u = nonEmpty(r.postUrl);
  return u && !isBareOrigin(u) ? 'p:' + u : null;
}

function hasMetrics(m: RecordMetrics | undefined): m is RecordMetrics {
  return !!m && GROWTH_KEYS.some((k) => typeof m[k] === 'number');
}

function deltasBetween(from: RecordMetrics, to: RecordMetrics): MetricDelta[] {
  const out: MetricDelta[] = [];
  for (const key of GROWTH_KEYS) {
    const a = from[key];
    const b = to[key];
    if (typeof a === 'number' && typeof b === 'number' && b - a !== 0) {
      out.push({ key, from: a, to: b, delta: b - a });
    }
  }
  return out;
}

/**
 * recordId → growth. Every metric-bearing sighting of an item maps to the SAME
 * growth (latest-vs-first), so whichever sighting the card happens to render,
 * the lookup hits. Items with fewer than two metric-bearing sightings, or with
 * no net change, produce no entry.
 */
export function buildGrowthByRecordId(records: ForensicRecord[]): Map<string, MetricGrowth> {
  const groups = new Map<string, ForensicRecord[]>();
  for (const r of records) {
    if (!hasMetrics(r.metrics)) continue;
    const id = growthIdentity(r);
    if (!id) continue;
    const arr = groups.get(id);
    if (arr) arr.push(r);
    else groups.set(id, [r]);
  }

  const out = new Map<string, MetricGrowth>();
  for (const arr of groups.values()) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const first = arr[0];
    const last = arr[arr.length - 1];
    const deltas = deltasBetween(first.metrics as RecordMetrics, last.metrics as RecordMetrics);
    if (deltas.length === 0) continue;
    const growth: MetricGrowth = {
      sinceTs: first.timestamp,
      latestTs: last.timestamp,
      sightings: arr.length,
      latest: last.metrics as RecordMetrics,
      deltas,
    };
    for (const r of arr) out.set(r.id, growth);
  }
  return out;
}
