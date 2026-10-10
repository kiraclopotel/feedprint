// FeelingWise - Read-only served-sequence STRUCTURE analytics
//
// Pure functions that read the shape of WHAT A PLATFORM SERVED a user over
// time, derived ONLY from the signed forensic chain. ADDITIVE + READ-ONLY:
// nothing here mutates a record, touches a write path, or alters a canonical
// payload. Every output derives from fields already on the signed record
// (`timestamp`, `platform`, `techniques`, `feedSource`), so a verifier holding
// the same chain can recompute every number independently. No network, no IDB
// coupling, no new dependency — pure TypeScript math.
//
// HONESTY FRAMING (read before citing any output):
//   These describe the OBSERVED structure of the served stream FOR THIS USER.
//   They do NOT recover the platform's algorithm and do NOT claim a causal
//   "why" — only the shape of what arrived and in what order.
//   • computeExposureSkew measures skew vs a UNIFORM (equal-share) baseline,
//     NOT vs "what a neutral feed would serve" — FW has no such ground truth.
//   • computePeriodicity reports autocorrelation of a self-observed per-day
//     series; a peak at lag 7 is a weekly RHYTHM in what the user saw, not
//     proof the platform schedules content weekly.
//   • computeRuns describes ordering structure in the records FW happened to
//     capture; gaps in capture (skipped scans, offline periods) are not
//     modelled.
//
// FUTURE UPGRADES (NOT implemented here, noted so they aren't reinvented):
//   • augurs (Rust) MSTL seasonal-trend decomposition + Bayesian changepoint
//     detection — proper multi-seasonal periodicity + regime-shift detection
//     beyond naive ACF.
//   • Kleinberg burst detection — infinite-state automaton over the arrival
//     stream to flag statistically significant bursts of a technique, stronger
//     than the consecutive-run heuristic in computeRuns.
//   • Embedding-based topic fingerprints — cluster served items in semantic
//     space to track topic drift, richer than the technique/feedSource
//     categorical axes used here.

import type { ForensicRecord } from '../types/forensic';
import { isExposureRecord, severityWeight, bucketKey } from './analytics';

// ─── Shared sequence helpers ─────────────────────────────────────────────────

/**
 * Dominant technique of one record = the HIGHEST-SEVERITY technique's name
 * (ties broken by array order, i.e. the first at that severity). Returns null
 * when the record carries no usable technique. Severity is read verbatim from
 * the signed record (no re-scoring). This is the single per-record state used
 * by computeRuns and the technique axis of computeExposureSkew, so both agree
 * on "what this record is about."
 */
export function dominantTechnique(r: ForensicRecord): string | null {
  if (!Array.isArray(r.techniques)) return null;
  let best: { name: string; severity: number } | null = null;
  for (const t of r.techniques) {
    if (!t || !t.name) continue;
    const sev = typeof t.severity === 'number' && Number.isFinite(t.severity) ? t.severity : 0;
    if (best === null || sev > best.severity) best = { name: t.name, severity: sev };
  }
  return best ? best.name : null;
}

/**
 * Exposure records sorted ascending by timestamp, dropping records with an
 * unparseable timestamp (legacy / corrupt). Stable: equal timestamps keep
 * input order. Shared by every order-sensitive function below so they all walk
 * the same time-ordered sequence.
 */
function orderedExposure(records: ForensicRecord[]): ForensicRecord[] {
  return records
    .filter((r) => isExposureRecord(r) && Number.isFinite(Date.parse(r.timestamp)))
    .slice()
    .sort((a, b) => {
      const da = Date.parse(a.timestamp);
      const db = Date.parse(b.timestamp);
      return da - db;
    });
}

/**
 * KL divergence D(observed ‖ uniform) in NATS over a set of category counts.
 * observed = count/total; uniform = 1/k where k = number of categories present.
 * Categories with zero observed share contribute nothing (0·log0 ≡ 0). Returns
 * 0 when k ≤ 1 (a single category cannot be "lopsided"; uniform == observed).
 * This is divergence from an EQUAL-SHARE baseline only — see module header.
 */
function klFromUniform(counts: Record<string, number>): number {
  const values = Object.values(counts).filter((c) => c > 0);
  const k = values.length;
  if (k <= 1) return 0;
  const total = values.reduce((s, c) => s + c, 0);
  if (total <= 0) return 0;
  const uniform = 1 / k;
  let kl = 0;
  for (const c of values) {
    const p = c / total;
    kl += p * Math.log(p / uniform);
  }
  // Guard tiny negative from floating error.
  return kl > 0 ? kl : 0;
}

// ─── 1. Exposure skew ────────────────────────────────────────────────────────

interface SkewAxis {
  /** Observed share per category (0..1), summing to ~1 over present categories. */
  shares: Record<string, number>;
  /** Raw counts per category. */
  counts: Record<string, number>;
  /** Number of distinct categories observed (k). */
  categories: number;
  /**
   * KL divergence (nats) of the observed distribution from a UNIFORM (1/k)
   * baseline. 0 = perfectly even across observed categories; higher = more
   * lopsided. NOT divergence from a "neutral feed" — FW has no such ground
   * truth. 0 when fewer than 2 categories.
   */
  divergenceFromUniform: number;
}

export interface ExposureSkew {
  /** Total exposure records that contributed to at least one axis. */
  total: number;
  /** Skew over the dominant technique per record. */
  byTechnique: SkewAxis;
  /** Skew over feedSource (the surface the item appeared on). */
  byFeedSource: SkewAxis;
}

function buildAxis(counts: Record<string, number>): SkewAxis {
  const total = Object.values(counts).reduce((s, c) => s + c, 0);
  const shares: Record<string, number> = {};
  if (total > 0) {
    for (const [k, c] of Object.entries(counts)) shares[k] = c / total;
  }
  return {
    shares,
    counts,
    categories: Object.keys(counts).length,
    divergenceFromUniform: klFromUniform(counts),
  };
}

/**
 * How lopsided the served stream is along two categorical axes: dominant
 * technique and feedSource. Returns per-category share + a KL-from-uniform
 * divergence score. See module header for the honest baseline framing.
 * Only exposure records participate. Tolerates empty / sparse / legacy input.
 */
export function computeExposureSkew(records: ForensicRecord[]): ExposureSkew {
  const techCounts: Record<string, number> = {};
  const feedCounts: Record<string, number> = {};
  let total = 0;

  for (const r of records) {
    if (!isExposureRecord(r)) continue;
    total++;
    const tech = dominantTechnique(r);
    if (tech !== null) techCounts[tech] = (techCounts[tech] ?? 0) + 1;
    const fs = r.feedSource ?? 'unknown';
    feedCounts[fs] = (feedCounts[fs] ?? 0) + 1;
  }

  return {
    total,
    byTechnique: buildAxis(techCounts),
    byFeedSource: buildAxis(feedCounts),
  };
}

// ─── 2. Periodicity (autocorrelation) ────────────────────────────────────────

export interface PeriodicityResult {
  /** True when too few observed days exist to compute the requested lags. */
  insufficient: boolean;
  /** Distinct UTC days that carried ≥1 exposure record. */
  daysObserved: number;
  /** Max lag (days) the ACF was computed up to. */
  maxLag: number;
  /**
   * Autocorrelation of the per-day severity-weighted exposure series at lags
   * 1..maxLag. acf[i] is the correlation at lag (i+1). Empty when insufficient.
   * Values in [-1, 1]; NaN-safe (a flat/zero-variance series yields []).
   */
  acf: number[];
  /**
   * Lags whose ACF is a local peak AND ≥ peakThreshold — candidate periods.
   * e.g. a 7 here ⇒ a weekly rhythm in the served stream. Empty when none.
   */
  peakLags: number[];
}

const DEFAULT_MAX_LAG = 14;
/** ACF must clear this to count as a candidate period (heuristic, not a test). */
const PEAK_THRESHOLD = 0.3;

/**
 * Builds a CONTIGUOUS per-UTC-day severity-weighted exposure series (zero-fills
 * gap days between the first and last observed day) and computes the
 * autocorrelation function at lags 1..maxLag (default 14). Returns the ACF plus
 * any peak lags (local maxima ≥ PEAK_THRESHOLD) as candidate periods.
 *
 * Requires at least 2×maxLag observed days (calendar span, including zero-fill);
 * otherwise returns { insufficient: true } and never fabricates a period from
 * too few days. The series is severity-weighted (each day = sum of per-record
 * severityWeight), so a quiet day with one mild item differs from a heavy day.
 * Only exposure records participate. See module header: a peak is a rhythm in
 * what the user SAW, not proof of a platform schedule.
 */
export function computePeriodicity(
  records: ForensicRecord[],
  opts?: { maxLagDays?: number },
): PeriodicityResult {
  const maxLag = Math.max(1, Math.floor(opts?.maxLagDays ?? DEFAULT_MAX_LAG));

  // Per-day severity sum keyed by 'YYYY-MM-DD' (UTC).
  const perDay = new Map<string, number>();
  for (const r of records) {
    if (!isExposureRecord(r)) continue;
    const key = bucketKey(r.timestamp, 'day');
    if (key === null) continue;
    perDay.set(key, (perDay.get(key) ?? 0) + severityWeight(r));
  }

  const daysObserved = perDay.size;
  if (daysObserved < 2 * maxLag) {
    return { insufficient: true, daysObserved, maxLag, acf: [], peakLags: [] };
  }

  // Build a contiguous, zero-filled daily series across the observed span so
  // a lag of N days means N CALENDAR days, not N populated days.
  const keys = [...perDay.keys()].sort();
  const firstMs = Date.parse(keys[0] + 'T00:00:00.000Z');
  const lastMs = Date.parse(keys[keys.length - 1] + 'T00:00:00.000Z');
  const DAY_MS = 86_400_000;
  const spanDays = Math.round((lastMs - firstMs) / DAY_MS) + 1;
  const series: number[] = new Array(spanDays).fill(0);
  for (const [k, v] of perDay) {
    const idx = Math.round((Date.parse(k + 'T00:00:00.000Z') - firstMs) / DAY_MS);
    if (idx >= 0 && idx < spanDays) series[idx] = v;
  }

  const acf = autocorrelation(series, maxLag);
  const peakLags = detectPeaks(acf, PEAK_THRESHOLD);

  return { insufficient: false, daysObserved, maxLag, acf, peakLags };
}

/**
 * Sample autocorrelation of a numeric series at lags 1..maxLag. Standard
 * normalized ACF: r_k = Σ(x_t-μ)(x_{t+k}-μ) / Σ(x_t-μ)². Returns [] for a
 * zero-variance (flat) series — autocorrelation is undefined there, and we
 * refuse to invent a value. lags beyond series length are skipped.
 */
function autocorrelation(series: number[], maxLag: number): number[] {
  const n = series.length;
  if (n < 2) return [];
  const mean = series.reduce((s, x) => s + x, 0) / n;
  let variance = 0;
  for (const x of series) variance += (x - mean) ** 2;
  if (variance <= 0) return []; // flat series: ACF undefined.

  const out: number[] = [];
  for (let lag = 1; lag <= maxLag && lag < n; lag++) {
    let cov = 0;
    for (let t = 0; t + lag < n; t++) {
      cov += (series[t] - mean) * (series[t + lag] - mean);
    }
    out.push(cov / variance);
  }
  return out;
}

/**
 * Local maxima in the ACF (acf[i] strictly greater than its neighbours) that
 * also clear `threshold`. Endpoints count when they beat their single neighbour.
 * Returns the corresponding LAGS (1-indexed), ascending.
 */
function detectPeaks(acf: number[], threshold: number): number[] {
  const peaks: number[] = [];
  for (let i = 0; i < acf.length; i++) {
    if (acf[i] < threshold) continue;
    const leftOk = i === 0 || acf[i] > acf[i - 1];
    const rightOk = i === acf.length - 1 || acf[i] > acf[i + 1];
    if (leftOk && rightOk) peaks.push(i + 1); // lag is 1-indexed.
  }
  return peaks;
}

// ─── 3. Runs / streaks ───────────────────────────────────────────────────────

export interface SequenceRun {
  /**
   * What the run is OF: a dominant-technique name, or the literal
   * 'high-severity' for a streak of records whose severityWeight ≥ 6.
   */
  kind: string;
  /** Number of consecutive records in the run (≥ 2). */
  length: number;
  /** Timestamp of the run's first record (ISO, as stored). */
  startTs: string;
  /** Timestamp of the run's last record (ISO, as stored). */
  endTs: string;
}

const HIGH_SEVERITY_FLOOR = 6;

/**
 * Over the time-ordered exposure sequence, detect two kinds of streak:
 *   • TECHNIQUE runs — consecutive records sharing the same dominant technique.
 *   • HIGH-SEVERITY runs — consecutive records with severityWeight ≥ 6
 *     (the same "high" floor analytics.ts bands on), regardless of technique.
 * Returns runs of length ≥ 2 only, longest first (ties: earlier startTs first).
 * The two run families are computed independently and merged, so a stretch can
 * appear once as a technique run and once as a high-severity run.
 * Tolerates empty / single / legacy input (records with no dominant technique
 * simply break technique-runs).
 */
export function computeRuns(records: ForensicRecord[]): SequenceRun[] {
  const seq = orderedExposure(records);
  const runs: SequenceRun[] = [];

  // Technique runs: group consecutive equal dominant-technique (skip nulls).
  let i = 0;
  while (i < seq.length) {
    const tech = dominantTechnique(seq[i]);
    if (tech === null) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < seq.length && dominantTechnique(seq[j]) === tech) j++;
    if (j - i >= 2) {
      runs.push({ kind: tech, length: j - i, startTs: seq[i].timestamp, endTs: seq[j - 1].timestamp });
    }
    i = j;
  }

  // High-severity runs: consecutive records with severityWeight ≥ floor.
  i = 0;
  while (i < seq.length) {
    if (severityWeight(seq[i]) < HIGH_SEVERITY_FLOOR) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < seq.length && severityWeight(seq[j]) >= HIGH_SEVERITY_FLOOR) j++;
    if (j - i >= 2) {
      runs.push({ kind: 'high-severity', length: j - i, startTs: seq[i].timestamp, endTs: seq[j - 1].timestamp });
    }
    i = j;
  }

  return runs.sort((a, b) => (b.length - a.length) || (a.startTs < b.startTs ? -1 : a.startTs > b.startTs ? 1 : 0));
}

// --- 4. Narrative pressure signals -----------------------------------------

type NarrativeMotifAxis = 'theme' | 'technique' | 'feedSource';

export interface NarrativePressureOptions {
  /**
   * Optional recordId -> themeId map from topics.ts buildThemes(). When present,
   * motif analytics prefer the actual theme over the fallback technique axis.
   */
  themeAssignment?: Map<string, string> | Record<string, string>;
  /** Optional themeId -> display label map for theme-backed motif output. */
  themeLabels?: Map<string, string> | Record<string, string>;
  /** Rolling-window size for Shannon entropy. Defaults to 12 exposures. */
  entropyWindow?: number;
  /** Minimum records for a motif before escalation is considered. Defaults to 3. */
  minMotifRecords?: number;
  /** Minimum quiet gap before a return is reported. Defaults to 6 hours. */
  quietGapHours?: number;
  /** Max rows returned for escalation and quiet-gap lists. Defaults to 8. */
  top?: number;
}

interface EscalatingMotif {
  motifKey: string;
  motifLabel: string;
  axis: NarrativeMotifAxis;
  count: number;
  firstSeverity: number;
  lastSeverity: number;
  delta: number;
  slopePerExposure: number;
  firstTs: string;
  lastTs: string;
  recordIds: string[];
}

interface EntropyWindow {
  startTs: string;
  endTs: string;
  recordCount: number;
  entropy: number;
  normalizedEntropy: number;
  counts: Record<string, number>;
}

interface DiversityCollapseSignal {
  windowSize: number;
  windows: EntropyWindow[];
  startEntropy: number | null;
  endEntropy: number | null;
  minEntropy: number | null;
  dropFromStart: number;
  normalizedDropFromStart: number;
}

interface QuietGapReturn {
  motifKey: string;
  motifLabel: string;
  axis: NarrativeMotifAxis;
  gapHours: number;
  previousTs: string;
  returnedTs: string;
  previousSeverity: number;
  returnSeverity: number;
  recordIds: [string, string];
}

interface TriggerVolatilitySignal {
  /** Switches are measured over theme when available, else dominant technique, else feedSource. */
  axis: 'theme-or-technique';
  transitionCount: number;
  switchCount: number;
  switchRate: number;
  distinctStates: number;
  longestStableRun: number;
  stateCounts: Record<string, number>;
}

export interface PlatformNarrativePressure {
  platform: ForensicRecord['platform'];
  exposureCount: number;
  escalatingMotifs: EscalatingMotif[];
  diversityCollapse: DiversityCollapseSignal;
  quietGapReturns: QuietGapReturn[];
  triggerVolatility: TriggerVolatilitySignal;
}

export interface NarrativePressureSignals {
  /**
   * One independent analysis per platform. Deliberately no all-platform rollup:
   * platform feeds are different surfaces and should not be blended by default.
   */
  platforms: PlatformNarrativePressure[];
}

interface MotifState {
  key: string;
  label: string;
  axis: NarrativeMotifAxis;
}

const DEFAULT_ENTROPY_WINDOW = 12;
const DEFAULT_MIN_MOTIF_RECORDS = 3;
const DEFAULT_QUIET_GAP_HOURS = 6;
const DEFAULT_NARRATIVE_TOP = 8;
const HOUR_MS = 60 * 60_000;

function lookupString(
  source: Map<string, string> | Record<string, string> | undefined,
  key: string,
): string | null {
  if (!source) return null;
  if (source instanceof Map) return source.get(key) ?? null;
  return source[key] ?? null;
}

function motifForRecord(r: ForensicRecord, opts: NarrativePressureOptions): MotifState {
  const themeId = lookupString(opts.themeAssignment, r.id);
  if (themeId) {
    const label = lookupString(opts.themeLabels, themeId);
    return {
      key: `theme:${themeId}`,
      label: label ?? `theme:${themeId.slice(0, 12)}`,
      axis: 'theme',
    };
  }

  const tech = dominantTechnique(r);
  if (tech !== null) {
    return { key: `technique:${tech}`, label: tech, axis: 'technique' };
  }

  const feedSource = r.feedSource ?? 'unknown';
  return { key: `feedSource:${feedSource}`, label: feedSource, axis: 'feedSource' };
}

function motifGroups(
  seq: ForensicRecord[],
  opts: NarrativePressureOptions,
): Map<string, { state: MotifState; records: ForensicRecord[] }> {
  const groups = new Map<string, { state: MotifState; records: ForensicRecord[] }>();
  for (const r of seq) {
    const state = motifForRecord(r, opts);
    const cur = groups.get(state.key);
    if (cur) cur.records.push(r);
    else groups.set(state.key, { state, records: [r] });
  }
  return groups;
}

function linearSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - meanX;
    num += dx * (values[i] - meanY);
    den += dx * dx;
  }
  return den > 0 ? num / den : 0;
}

function shannonEntropy(counts: Record<string, number>): number {
  const values = Object.values(counts).filter((n) => n > 0);
  const total = values.reduce((s, n) => s + n, 0);
  if (total <= 0) return 0;
  let entropy = 0;
  for (const n of values) {
    const p = n / total;
    entropy -= p * Math.log(p);
  }
  return entropy;
}

function computeEscalatingMotifs(
  seq: ForensicRecord[],
  opts: NarrativePressureOptions,
): EscalatingMotif[] {
  const minRecords = Math.max(2, Math.floor(opts.minMotifRecords ?? DEFAULT_MIN_MOTIF_RECORDS));
  const top = Math.max(1, Math.floor(opts.top ?? DEFAULT_NARRATIVE_TOP));
  const out: EscalatingMotif[] = [];

  for (const { state, records } of motifGroups(seq, opts).values()) {
    if (records.length < minRecords) continue;
    const severities = records.map(severityWeight);
    const firstSeverity = severities[0] ?? 0;
    const lastSeverity = severities[severities.length - 1] ?? 0;
    const delta = lastSeverity - firstSeverity;
    const slopePerExposure = linearSlope(severities);
    if (delta <= 0 || slopePerExposure <= 0) continue;
    out.push({
      motifKey: state.key,
      motifLabel: state.label,
      axis: state.axis,
      count: records.length,
      firstSeverity,
      lastSeverity,
      delta,
      slopePerExposure,
      firstTs: records[0].timestamp,
      lastTs: records[records.length - 1].timestamp,
      recordIds: records.map((r) => r.id),
    });
  }

  return out
    .sort((a, b) =>
      b.slopePerExposure - a.slopePerExposure ||
      b.delta - a.delta ||
      b.count - a.count ||
      a.motifKey.localeCompare(b.motifKey),
    )
    .slice(0, top);
}

function computeDiversityCollapse(
  seq: ForensicRecord[],
  opts: NarrativePressureOptions,
): DiversityCollapseSignal {
  const windowSize = Math.max(2, Math.floor(opts.entropyWindow ?? DEFAULT_ENTROPY_WINDOW));
  const windows: EntropyWindow[] = [];
  if (seq.length >= windowSize) {
    for (let i = 0; i + windowSize <= seq.length; i++) {
      const slice = seq.slice(i, i + windowSize);
      const counts: Record<string, number> = {};
      for (const r of slice) {
        const state = motifForRecord(r, opts);
        counts[state.key] = (counts[state.key] ?? 0) + 1;
      }
      const entropy = shannonEntropy(counts);
      const categories = Object.keys(counts).length;
      windows.push({
        startTs: slice[0].timestamp,
        endTs: slice[slice.length - 1].timestamp,
        recordCount: slice.length,
        entropy,
        normalizedEntropy: categories > 1 ? entropy / Math.log(categories) : 0,
        counts,
      });
    }
  }

  const first = windows[0] ?? null;
  const last = windows[windows.length - 1] ?? null;
  const minEntropy = windows.length
    ? Math.min(...windows.map((w) => w.entropy))
    : null;
  const dropFromStart = first && last ? Math.max(0, first.entropy - last.entropy) : 0;
  const normalizedDropFromStart = first && last
    ? Math.max(0, first.normalizedEntropy - last.normalizedEntropy)
    : 0;

  return {
    windowSize,
    windows,
    startEntropy: first?.entropy ?? null,
    endEntropy: last?.entropy ?? null,
    minEntropy,
    dropFromStart,
    normalizedDropFromStart,
  };
}

function computeQuietGapReturns(
  seq: ForensicRecord[],
  opts: NarrativePressureOptions,
): QuietGapReturn[] {
  const quietGapHours = Math.max(0, opts.quietGapHours ?? DEFAULT_QUIET_GAP_HOURS);
  const top = Math.max(1, Math.floor(opts.top ?? DEFAULT_NARRATIVE_TOP));
  const out: QuietGapReturn[] = [];

  for (const { state, records } of motifGroups(seq, opts).values()) {
    if (records.length < 2) continue;
    for (let i = 1; i < records.length; i++) {
      const prev = records[i - 1];
      const cur = records[i];
      const prevMs = Date.parse(prev.timestamp);
      const curMs = Date.parse(cur.timestamp);
      if (!Number.isFinite(prevMs) || !Number.isFinite(curMs)) continue;
      const gapHours = (curMs - prevMs) / HOUR_MS;
      if (gapHours < quietGapHours) continue;
      out.push({
        motifKey: state.key,
        motifLabel: state.label,
        axis: state.axis,
        gapHours,
        previousTs: prev.timestamp,
        returnedTs: cur.timestamp,
        previousSeverity: severityWeight(prev),
        returnSeverity: severityWeight(cur),
        recordIds: [prev.id, cur.id],
      });
    }
  }

  return out
    .sort((a, b) =>
      b.gapHours - a.gapHours ||
      b.returnSeverity - a.returnSeverity ||
      a.returnedTs.localeCompare(b.returnedTs),
    )
    .slice(0, top);
}

function computeTriggerVolatility(
  seq: ForensicRecord[],
  opts: NarrativePressureOptions,
): TriggerVolatilitySignal {
  const states = seq.map((r) => motifForRecord(r, opts));
  const stateCounts: Record<string, number> = {};
  for (const s of states) stateCounts[s.key] = (stateCounts[s.key] ?? 0) + 1;

  let switchCount = 0;
  let longestStableRun = states.length > 0 ? 1 : 0;
  let currentRun = states.length > 0 ? 1 : 0;
  for (let i = 1; i < states.length; i++) {
    if (states[i].key === states[i - 1].key) {
      currentRun++;
      if (currentRun > longestStableRun) longestStableRun = currentRun;
    } else {
      switchCount++;
      currentRun = 1;
    }
  }

  const transitionCount = Math.max(0, states.length - 1);
  return {
    axis: 'theme-or-technique',
    transitionCount,
    switchCount,
    switchRate: transitionCount > 0 ? switchCount / transitionCount : 0,
    distinctStates: new Set(states.map((s) => s.key)).size,
    longestStableRun,
    stateCounts,
  };
}

/**
 * Worst-case-shape Narrative Constructor signals over the signed chain:
 * escalation trajectory, rolling entropy collapse, quiet-gap returns, and
 * trigger volatility. The function is read-only and computes one independent
 * result per platform, because a TikTok For You sequence and a YouTube comment
 * sequence are different surfaces and should not be blended by default.
 */
export function computeNarrativePressureSignals(
  records: ForensicRecord[],
  opts: NarrativePressureOptions = {},
): NarrativePressureSignals {
  const byPlatform = new Map<ForensicRecord['platform'], ForensicRecord[]>();
  for (const r of orderedExposure(records)) {
    const list = byPlatform.get(r.platform);
    if (list) list.push(r);
    else byPlatform.set(r.platform, [r]);
  }

  const platforms: PlatformNarrativePressure[] = [];
  for (const [platform, seq] of byPlatform) {
    platforms.push({
      platform,
      exposureCount: seq.length,
      escalatingMotifs: computeEscalatingMotifs(seq, opts),
      diversityCollapse: computeDiversityCollapse(seq, opts),
      quietGapReturns: computeQuietGapReturns(seq, opts),
      triggerVolatility: computeTriggerVolatility(seq, opts),
    });
  }

  return {
    platforms: platforms.sort((a, b) =>
      b.exposureCount - a.exposureCount ||
      String(a.platform).localeCompare(String(b.platform)),
    ),
  };
}
