// FeelingWise — Feed behavior data derivation (pure, deterministic, unit-tested).
//
// The deep half of the Patterns tab: what the feed DID, at the five levels of
// the reader-lens contract (docs/design/READER_LENSES.md). Level 1 sequence
// (runs, in-sitting position), level 2 pressure (the return after quiet),
// level 3 amplification (room readings + advertiser placement), level 4
// narrative (technique hand-offs, recurring voices), level 5 the cautious
// reading (rule-gated interpretation, every line carrying its evidence).
//
// Every aggregate is recomputable from the signed records alone; nothing is
// stored, nothing claims platform intent. Semantics contracts:
// - Verdict buckets and the 30-minute sitting rule mirror overview-data.ts
//   (the two surfaces must never disagree on what "flagged" or "a sitting" is).
// - Cautions and the prediction are RULE-GATED: a line renders only when its
//   evidence threshold is met, so the interpretation card can never outrun
//   the record.
// Design source: docs/redesign/mockups/2026-07-15/feed-behavior.html
// (browser-verified on the real chain, both themes, before this port).

import type { ForensicRecord } from '../../../types/forensic';
import { localDayKey } from '../../shared/format-time';
import { splitSessions, type OverviewSession } from './overview-data';
import { isFlaggedItem, isItem, isRoomSummary } from '../record-sets';

/** A quiet gap this long (or longer) makes the next item a "return" item. */
const RETURN_GAP_MS = 2 * 3600 * 1000;
/** Sittings need at least this many items before thirds are meaningful. */
const SKEW_MIN_SESSION_ITEMS = 6;
/** Caution gates (level 5 renders a line only when its gate passes). */
export const CAUTION_RUN_MIN = 5;
export const CAUTION_RETURN_MIN_SAMPLES = 3;
const CAUTION_AMP_HIGH_SHARE = 0.25;
export const CAUTION_CHAIN_MIN = 10;

/**
 * The uncategorised residual technique. 'combined' is what the judge's
 * free-text concern falls to when it matches no technique enum
 * (mapConcernToTechnique, src/core/neutralizer.ts) — it names nothing, and it
 * is the single most common value on a real chain. A "what follows what" row
 * built on it would assert a narrative over an empty bucket, which is the same
 * defect class as a status light showing green with no data behind it. The
 * per-record surfaces can still show the model's own words (techniques[].why);
 * this aggregate cannot, so it counts the bucket and discloses it instead.
 */
const UNNAMED_TECHNIQUE = 'combined';

/**
 * Technique ids kept out of the narrative rows. 'genuine-opinion' because it
 * is a benign verdict rather than a pattern; UNNAMED_TECHNIQUE because it
 * carries no meaning to chain. Both still count in `totalPairs`, so the
 * provenance line stays the honest denominator.
 */
const CHAIN_ROW_EXCLUDED: ReadonlySet<string> = new Set(['genuine-opinion', UNNAMED_TECHNIQUE]);

export function pct1(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : 0;
}

export interface ChainPair {
  a: string;
  b: string;
  n: number;
  sustained: boolean;
}

interface VoiceRow {
  author: string;
  platform: ForensicRecord['platform'];
  accountType?: string;
  days: number;
  seen: number;
  flagged: number;
}

export type Caution =
  /**
   * `endAt` is the raw ISO timestamp the run ended on, not a formatted clock
   * time. The model used to carry a hand-rolled "HH:MM" cut in local time,
   * which meant this data layer decided a rendering (and could not know the
   * reader's language). The panel formats it; see src/ui/shared/format-time.ts.
   */
  | { kind: 'run'; length: number; endAt: string }
  | { kind: 'return'; flagged: number; total: number; pct: number; basePct: number }
  | { kind: 'amplification'; high: number; total: number; pct: number }
  | { kind: 'chain'; a: string; b: string; n: number };

export interface FeedBehaviorModel {
  contentCount: number;
  rangeStart: string; // ISO day of the earliest content record in the set
  rangeEnd: string;
  flaggedCount: number;
  baseRatePct: number;
  /** `endAt` is a raw ISO timestamp; the panel formats it (see Caution). */
  runs: { length: number; endAt: string | null };
  skew: {
    bigSessions: number;
    totalSessions: number;
    openFlagged: number;
    openTotal: number;
    closeFlagged: number;
    closeTotal: number;
    openPct: number;
    closePct: number;
  };
  returns: { flagged: number; total: number; pct: number };
  amplification: { high: number; normal: number; low: number; unknown: number; total: number };
  advertiser: { forYou: number; total: number };
  chains: {
    handoffs: ChainPair[];
    sustained: ChainPair[];
    totalPairs: number;
    /** Adjacent pairs with UNNAMED_TECHNIQUE on either side: excluded from the
     *  rows above, disclosed in the panel so the reader sees the share. */
    unnamedPairs: number;
  };
  voices: VoiceRow[];
  namedSources: number;
  cautions: Caution[];
  predictionClauses: Array<'run' | 'return'>;
}

// The reader's own calendar day, not UTC. This panel's range line sits on the
// same screen as the Overview's day columns, and a person comparing them means
// one thing by "Thursday". It cut ts.slice(0, 10) until 2026-09-18, so every
// reader away from Greenwich read two different Thursdays on one screen.
const isoDay = localDayKey;

function firstTechnique(r: ForensicRecord): string | null {
  const name = r.techniques?.[0]?.name;
  return name ? String(name) : null;
}

export function computeFeedBehavior(records: ForensicRecord[]): FeedBehaviorModel | null {
  const content = records
    .filter((r) => isItem(r) && r.timestamp)
    .slice()
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  if (content.length === 0) return null;

  const flaggedCount = content.filter(isFlaggedItem).length;
  const baseRatePct = pct1(flaggedCount, content.length);
  const sessions: OverviewSession[] = splitSessions(content);
  // Re-derive per-session member records (splitSessions returns ids; the run
  // and chain reads below need the records themselves, in served order).
  const byId = new Map(content.map((r) => [r.id, r]));
  const sessionItems: ForensicRecord[][] = sessions.map((s) =>
    s.recordIds.map((id) => byId.get(id)).filter((r): r is ForensicRecord => r !== undefined));

  // ── Level 1a: longest unbroken flagged run (whole-set serve order) ──
  let run = 0;
  let bestLen = 0;
  let bestEnd: string | null = null;
  for (const r of content) {
    if (isFlaggedItem(r)) {
      run++;
      if (run > bestLen) {
        bestLen = run;
        bestEnd = r.timestamp;
      }
    } else {
      run = 0;
    }
  }

  // ── Level 1b: in-sitting position skew (thirds; 6+ item sittings only) ──
  let openFlagged = 0, openTotal = 0, closeFlagged = 0, closeTotal = 0, bigSessions = 0;
  for (const items of sessionItems) {
    if (items.length < SKEW_MIN_SESSION_ITEMS) continue;
    bigSessions++;
    const third = Math.floor(items.length / 3);
    for (const r of items.slice(0, third)) {
      openTotal++;
      if (isFlaggedItem(r)) openFlagged++;
    }
    for (const r of items.slice(-third)) {
      closeTotal++;
      if (isFlaggedItem(r)) closeFlagged++;
    }
  }

  // ── Level 2: the return after quiet (first item after a 2h+ gap) ──
  let returnTotal = 0, returnFlagged = 0;
  for (let i = 1; i < content.length; i++) {
    const gap = new Date(content[i].timestamp).getTime() - new Date(content[i - 1].timestamp).getTime();
    if (gap >= RETURN_GAP_MS) {
      returnTotal++;
      if (isFlaggedItem(content[i])) returnFlagged++;
    }
  }

  // ── Level 3: amplification readings + advertiser placement ──
  const amplification = { high: 0, normal: 0, low: 0, unknown: 0, total: 0 };
  for (const r of records) {
    if (!isRoomSummary(r) || !r.environment) continue;
    amplification.total++;
    const a = r.environment.algorithmicAmplification;
    if (a === 'high' || a === 'normal' || a === 'low') amplification[a]++;
    else amplification.unknown++;
  }
  let advTotal = 0, advForYou = 0;
  for (const r of content) {
    if (r.accountType !== 'advertiser') continue;
    advTotal++;
    if (r.feedSource === 'for-you') advForYou++;
  }

  // ── Level 4a: technique hand-offs within a sitting ──
  const pairCounts = new Map<string, number>();
  for (const items of sessionItems) {
    let prev: string | null = null;
    for (const r of items) {
      // A pair is two FLAGGED items, which is what the panel's sentence over these rows
      // says. Until 2026-09-20 any record with a first technique was taken, so starred
      // swearing, a pass below the cut and a button reading were paired as flagged items
      // (same rule, same day, in the export's copy of this step).
      if (!isFlaggedItem(r)) continue;
      const tech = firstTechnique(r);
      if (!tech) continue;
      if (prev) {
        const key = `${prev}\x00${tech}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
      prev = tech;
    }
  }
  const pairs: ChainPair[] = [...pairCounts.entries()].map(([key, n]) => {
    const [a, b] = key.split('\x00');
    return { a, b, n, sustained: a === b };
  });
  const totalPairs = pairs.reduce((acc, p) => acc + p.n, 0);
  const unnamedPairs = pairs.reduce(
    (acc, p) => acc + (p.a === UNNAMED_TECHNIQUE || p.b === UNNAMED_TECHNIQUE ? p.n : 0), 0);
  const handoffs = pairs
    .filter((p) => !p.sustained && !CHAIN_ROW_EXCLUDED.has(p.a) && !CHAIN_ROW_EXCLUDED.has(p.b))
    .sort((x, y) => y.n - x.n)
    .slice(0, 5);
  const sustained = pairs
    .filter((p) => p.sustained && !CHAIN_ROW_EXCLUDED.has(p.a))
    .sort((x, y) => y.n - x.n)
    .slice(0, 3);

  // ── Level 4b: recurring voices (accounts served on 3+ distinct days) ──
  const voiceMap = new Map<string, { author: string; platform: ForensicRecord['platform']; accountType?: string; days: Set<string>; seen: number; flagged: number }>();
  for (const r of content) {
    const author = (r.author ?? '').trim();
    if (!author || author.toLowerCase() === 'unknown') continue;
    const key = `${r.platform}\x00${author}`;
    let v = voiceMap.get(key);
    if (!v) {
      v = { author, platform: r.platform, accountType: r.accountType, days: new Set(), seen: 0, flagged: 0 };
      voiceMap.set(key, v);
    }
    v.days.add(isoDay(r.timestamp));
    v.seen++;
    if (r.accountType) v.accountType = r.accountType;
    if (isFlaggedItem(r)) v.flagged++;
  }
  const voices: VoiceRow[] = [...voiceMap.values()]
    .filter((v) => v.days.size >= 3)
    .sort((a, b) => b.days.size - a.days.size || b.seen - a.seen)
    .slice(0, 8)
    .map((v) => ({ author: v.author, platform: v.platform, accountType: v.accountType, days: v.days.size, seen: v.seen, flagged: v.flagged }));

  // ── Level 5: the cautious reading (rule-gated interpretation) ──
  const returnPct = pct1(returnFlagged, returnTotal);
  const cautions: Caution[] = [];
  const predictionClauses: Array<'run' | 'return'> = [];
  if (bestLen >= CAUTION_RUN_MIN && bestEnd) {
    cautions.push({ kind: 'run', length: bestLen, endAt: bestEnd });
    predictionClauses.push('run');
  }
  if (returnTotal >= CAUTION_RETURN_MIN_SAMPLES && returnPct > 2 * baseRatePct) {
    cautions.push({ kind: 'return', flagged: returnFlagged, total: returnTotal, pct: returnPct, basePct: baseRatePct });
    predictionClauses.push('return');
  }
  if (amplification.total > 0 && amplification.high / amplification.total > CAUTION_AMP_HIGH_SHARE) {
    cautions.push({ kind: 'amplification', high: amplification.high, total: amplification.total, pct: pct1(amplification.high, amplification.total) });
  }
  if (handoffs.length > 0 && handoffs[0].n >= CAUTION_CHAIN_MIN) {
    cautions.push({ kind: 'chain', a: handoffs[0].a, b: handoffs[0].b, n: handoffs[0].n });
  }

  return {
    contentCount: content.length,
    rangeStart: isoDay(content[0].timestamp),
    rangeEnd: isoDay(content[content.length - 1].timestamp),
    flaggedCount,
    baseRatePct,
    runs: { length: bestLen, endAt: bestLen > 0 && bestEnd ? bestEnd : null },
    skew: {
      bigSessions,
      totalSessions: sessions.length,
      openFlagged,
      openTotal,
      closeFlagged,
      closeTotal,
      openPct: pct1(openFlagged, openTotal),
      closePct: pct1(closeFlagged, closeTotal),
    },
    returns: { flagged: returnFlagged, total: returnTotal, pct: returnPct },
    amplification,
    advertiser: { forYou: advForYou, total: advTotal },
    chains: { handoffs, sustained, totalPairs, unnamedPairs },
    voices,
    namedSources: voiceMap.size,
    cautions,
    predictionClauses,
  };
}
