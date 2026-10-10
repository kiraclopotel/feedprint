// Patterns-tab data layer — feed tone ("was the feed only negative?").
//
// DETERMINISTIC + FREE: aggregates the sentiment percentages already stored on
// environment (comment-room) records — no AI call, no new capture. Directly
// answers the standing complaint that the dashboard "shows mainly negativity":
// the per-card sentiment split existed only inside each room's drawer and was
// never summed, so the whole-feed tone (which includes the positive + neutral
// rooms) was invisible. This surfaces it.
//
// The numbers are AI INTERPRETATION of the comment section (the scoreRoom call),
// NOT verbatim and NOT a claim about the child's own mood — it is the tone of
// the ROOMS FeelingWise read. The render side must frame it that way.
//
// Comment-weighted: each room contributes in proportion to how many comments
// were actually scored (`sampled`), so a 500-comment pile-on outweighs a
// 3-comment thread. Rooms with no sampled count fall back to weight 1 so a
// room still counts; the honest denominator (rooms + comments scored) rides
// along so the panel can name what it covers.
//
// Pure transform: ForensicRecord[] -> FeedTone. Unit-testable without React
// (same pattern as feed-composition.ts / lexical-diet.ts).

import type { ForensicRecord } from '../../../types/forensic';

interface ToneSplit {
  positivePct: number;
  neutralPct: number;
  negativePct: number;
}

interface PlatformTone extends ToneSplit {
  platform: string;
  rooms: number;
  commentsScored: number;
}

export interface FeedTone extends ToneSplit {
  /** Environment records carrying sentiment in range. */
  rooms: number;
  /** Sum of `sampled` across those rooms (the comment-weight denominator). */
  commentsScored: number;
  /** Per-platform split, most-rooms first. */
  platforms: PlatformTone[];
  /** True when at least one room carried sentiment (else the panel is empty). */
  hasData: boolean;
}

export interface FeedToneOptions {
  since?: string;
  until?: string;
}

interface Accum { pos: number; neu: number; neg: number; weight: number; rooms: number; commentsScored: number }

function newAccum(): Accum {
  return { pos: 0, neu: 0, neg: 0, weight: 0, rooms: 0, commentsScored: 0 };
}

/** A room's sentiment is usable only when the three fields are finite numbers. */
function roomSentiment(r: ForensicRecord): ToneSplit | null {
  const env = r.environment;
  if (!env) return null;
  const { positivePct, neutralPct, negativePct } = env;
  if (![positivePct, neutralPct, negativePct].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return null;
  }
  return { positivePct, neutralPct, negativePct };
}

function addRoom(acc: Accum, split: ToneSplit, sampled: number): void {
  // Weight by comments scored; a missing/zero count still counts as one room.
  const weight = sampled > 0 ? sampled : 1;
  acc.pos += split.positivePct * weight;
  acc.neu += split.neutralPct * weight;
  acc.neg += split.negativePct * weight;
  acc.weight += weight;
  acc.rooms += 1;
  acc.commentsScored += sampled > 0 ? sampled : 0;
}

/** Weighted averages, rounded and normalized so the three shares sum to 100. */
function resolveSplit(acc: Accum): ToneSplit {
  if (acc.weight === 0) return { positivePct: 0, neutralPct: 0, negativePct: 0 };
  const pos = (acc.pos / acc.weight);
  const neu = (acc.neu / acc.weight);
  const neg = (acc.neg / acc.weight);
  // Largest-remainder rounding to guarantee the rendered shares sum to 100.
  const raw = [pos, neu, neg];
  const floors = raw.map((n) => Math.floor(n));
  let remainder = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((n, i) => ({ i, frac: n - Math.floor(n) }))
    .sort((a, b) => b.frac - a.frac);
  const out = [...floors];
  for (let k = 0; k < order.length && remainder > 0; k++) { out[order[k].i]++; remainder--; }
  return { positivePct: out[0], neutralPct: out[1], negativePct: out[2] };
}

export function buildFeedTone(records: ForensicRecord[], opts: FeedToneOptions = {}): FeedTone {
  const overall = newAccum();
  const perPlatform = new Map<string, Accum>();

  for (const r of records) {
    if (opts.since && r.timestamp < opts.since) continue;
    if (opts.until && r.timestamp > opts.until) continue;
    const split = roomSentiment(r);
    if (!split) continue;
    const sampled = typeof r.environment?.sampled === 'number' ? r.environment.sampled : 0;
    addRoom(overall, split, sampled);
    if (r.platform) {
      let p = perPlatform.get(r.platform);
      if (!p) { p = newAccum(); perPlatform.set(r.platform, p); }
      addRoom(p, split, sampled);
    }
  }

  const platforms: PlatformTone[] = [...perPlatform.entries()]
    .map(([platform, acc]) => ({
      platform,
      ...resolveSplit(acc),
      rooms: acc.rooms,
      commentsScored: acc.commentsScored,
    }))
    .sort((a, b) => b.rooms - a.rooms || a.platform.localeCompare(b.platform));

  return {
    ...resolveSplit(overall),
    rooms: overall.rooms,
    commentsScored: overall.commentsScored,
    platforms,
    hasData: overall.rooms > 0,
  };
}
