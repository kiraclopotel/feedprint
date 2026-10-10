// FeelingWise — re-serve pattern analytics (behavioral-signals design,
// docs/research/BEHAVIORAL_SIGNALS_DESIGN.md §2 — the one founder ask that
// survived the VISION triage).
//
// A platform re-serving an item — inserting the SAME content into the feed
// again on a later session/day — is platform behavior, visible in the
// signed chain as repeated `originalHash` values. This module reads it out.
//
// HONESTY FRAME (binding for consumers): outputs describe DELIVERY ("the
// platform served this N times across M days"), never attention or
// engagement — "you kept seeing it" is about the person and is banned
// phrasing. No new data is captured anywhere: every input field is already
// signed on the chain, the computation is deterministic, and a verifier
// can recompute it from an export.
//
// PURE read-side: no IDB, no chrome, no writes, no new record fields.

import type { ForensicRecord } from '../types/forensic';

/** 30-minute session gap — same value as the dashboard ledger's
 * SESSION_GAP_MIN (Dashboard.tsx); keep the two consistent. */
const SESSION_GAP_MS = 30 * 60_000;

export interface ReserveInstance {
  /** SHA-256 of originalText — the signed content fingerprint. */
  contentHash: string;
  /** First-seen text, truncated for display (never stores more than the chain). */
  sampleText: string;
  author: string;
  platform: ForensicRecord['platform'];
  /** PROVENANCE — every claim drills to these, in timestamp order. */
  recordIds: string[];
  timestamps: string[];
  serveCount: number;
  /** Serves separated by >30-min gaps. */
  distinctSessions: number;
  /** Distinct calendar days on the caller's clock: the stricter display unit (design Q2 default). */
  distinctDays: number;
  /** Calendar days between first and last serve. */
  daySpan: number;
  techniqueProfile: { name: string; maxSeverity: number; occurrences: number }[];
}

/**
 * How a timestamp becomes a calendar day, when the caller does not say.
 *
 * UTC, because this file sits in the forensics layer and everything here must
 * give the same answer on every machine. A DASHBOARD caller passes localDayKey
 * instead: a person reading "served 6 times across 2 days" means 2 of their own
 * days, and the Overview beside it has counted local days since the clock pass
 * of 2026-09-18. Two panels on one screen may not hold two definitions of a
 * day, so the choice is named at the call site rather than assumed here.
 */
const utcDayKey = (ts: string): string => ts.slice(0, 10);

/** What a caller passes to bucket by a day that is not UTC. */
export type DayKeyOf = (ts: string) => string;

/**
 * Calendar days from the first day key to the last, inclusive of neither end:
 * two serves on consecutive days span 1, two serves on the same day span 0.
 *
 * It used to be Math.round((last - first) / 86400000) over the raw instants,
 * which is elapsed 24-hour periods and not what the field says it is: 20 hours
 * across midnight is one calendar day and rounded to 1 by luck, while 13 hours
 * inside one afternoon is zero calendar days and rounded to 1 wrongly. Day
 * keys are calendar dates, so they are read back at noon, the only hour that
 * survives every offset (see dayKeyAsLocalDate in format-time.ts).
 */
function calendarDaysBetween(firstKey: string, lastKey: string): number {
  const a = Date.parse(`${firstKey}T12:00:00Z`);
  const b = Date.parse(`${lastKey}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Find exact re-serves: records sharing one originalHash across >= 2
 * distinct sessions (within-session repeats are extraction noise, not a
 * re-serve signal). Sorted by serveCount desc, then daySpan desc.
 */
export function computeReservePatterns(
  records: ForensicRecord[],
  opts?: { minSessions?: number; top?: number; dayKeyOf?: DayKeyOf },
): ReserveInstance[] {
  const minSessions = opts?.minSessions ?? 2;
  const top = opts?.top ?? 20;
  const dayKeyOf = opts?.dayKeyOf ?? utcDayKey;

  const byHash = new Map<string, ForensicRecord[]>();
  for (const r of records) {
    if (!r.originalHash || !r.originalText?.trim()) continue;
    const list = byHash.get(r.originalHash);
    if (list) list.push(r);
    else byHash.set(r.originalHash, [r]);
  }

  const out: ReserveInstance[] = [];
  for (const [contentHash, group] of byHash) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));

    // Distinct sessions over THIS content's serve timestamps.
    let sessions = 0;
    let lastMs = -Infinity;
    const days = new Set<string>();
    for (const r of group) {
      const ms = Date.parse(r.timestamp);
      if (!Number.isFinite(ms)) continue;
      if (ms - lastMs > SESSION_GAP_MS) sessions++;
      lastMs = ms;
      days.add(dayKeyOf(r.timestamp));
    }
    if (sessions < minSessions) continue;

    const techniques = new Map<string, { maxSeverity: number; occurrences: number }>();
    for (const r of group) {
      if (!Array.isArray(r.techniques)) continue;
      for (const t of r.techniques) {
        if (!t?.name) continue;
        const cur = techniques.get(t.name) ?? { maxSeverity: 0, occurrences: 0 };
        cur.occurrences++;
        if (typeof t.severity === 'number' && t.severity > cur.maxSeverity) cur.maxSeverity = t.severity;
        techniques.set(t.name, cur);
      }
    }

    const first = group[0];
    const dayKeys = [...days].sort();
    out.push({
      contentHash,
      sampleText: (first.originalText ?? '').slice(0, 200),
      author: first.author ?? 'unknown',
      platform: first.platform,
      recordIds: group.map((r) => r.id),
      timestamps: group.map((r) => r.timestamp),
      serveCount: group.length,
      distinctSessions: sessions,
      distinctDays: days.size,
      daySpan: dayKeys.length ? calendarDaysBetween(dayKeys[0], dayKeys[dayKeys.length - 1]) : 0,
      techniqueProfile: Array.from(techniques.entries())
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.occurrences - a.occurrences || b.maxSeverity - a.maxSeverity),
    });
  }

  out.sort((a, b) => b.serveCount - a.serveCount || b.daySpan - a.daySpan || a.contentHash.localeCompare(b.contentHash));
  return out.slice(0, top);
}

// ── Near-duplicate re-serves (capability audit 2026-09-06, P1 item 7) ────────
//
// The exact re-serve above needs the same bytes. A template is the same item
// with a different number, link, handle or spacing: "Day 41 of ...", a fresh
// tracking link, a new @mention. Those never share a hash, so they were
// invisible next to the exact count. The template key normalises exactly
// those four things and nothing else; it is kept beside the exact hash, never
// merged into it, and a group whose records all share one hash is left to the
// exact panel. Same session rule, same day units, same provenance.

export interface TemplateInstance extends ReserveInstance {
  /** The normalised text the group shares. */
  templateKey: string;
  /** Distinct originalHash values in the group (always 2 or more). */
  variants: number;
}

const TEMPLATE_MIN_CHARS = 24;

/**
 * Normalise a text to its template: lowercase; links, @handles and digit runs
 * become placeholders; punctuation and whitespace collapse to single spaces.
 * Returns '' when what is left is too short to be a template rather than a
 * coincidence ("ok", "lol", a bare link).
 */
export function templateKey(text: string): string {
  const key = text
    .toLowerCase()
    .replace(/https?:\/\/\S+|www\.\S+/g, ' <link> ')
    .replace(/@[\w.]+/g, ' <handle> ')
    .replace(/\d[\d.,:]*/g, ' <n> ')
    .replace(/[^\p{L}\p{N}<>\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const letters = key.replace(/<link>|<handle>|<n>|\s/g, '');
  return letters.length >= TEMPLATE_MIN_CHARS ? key : '';
}

/**
 * Near-duplicate re-serves: records by one author whose template key matches
 * across 2 or more distinct originalHash values and 2 or more sittings.
 * Sorted like the exact re-serves.
 */
export function computeTemplatePatterns(
  records: ForensicRecord[],
  opts?: { minSessions?: number; top?: number; dayKeyOf?: DayKeyOf },
): TemplateInstance[] {
  const minSessions = opts?.minSessions ?? 2;
  const top = opts?.top ?? 20;
  const dayKeyOf = opts?.dayKeyOf ?? utcDayKey;

  const byKey = new Map<string, ForensicRecord[]>();
  for (const r of records) {
    if (!r.originalHash || !r.originalText?.trim()) continue;
    const key = templateKey(r.originalText);
    if (!key) continue;
    const groupKey = `${(r.author ?? '').toLowerCase()}\u0000${key}`;
    const list = byKey.get(groupKey);
    if (list) list.push(r);
    else byKey.set(groupKey, [r]);
  }

  const out: TemplateInstance[] = [];
  for (const [groupKey, group] of byKey) {
    const hashes = new Set(group.map((r) => r.originalHash));
    if (hashes.size < 2) continue; // one hash: the exact panel's case, not this one
    group.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));

    let sessions = 0;
    let lastMs = -Infinity;
    const days = new Set<string>();
    for (const r of group) {
      const ms = Date.parse(r.timestamp);
      if (!Number.isFinite(ms)) continue;
      if (ms - lastMs > SESSION_GAP_MS) sessions++;
      lastMs = ms;
      days.add(dayKeyOf(r.timestamp));
    }
    if (sessions < minSessions) continue;

    const techniques = new Map<string, { maxSeverity: number; occurrences: number }>();
    for (const r of group) {
      if (!Array.isArray(r.techniques)) continue;
      for (const t of r.techniques) {
        if (!t?.name) continue;
        const cur = techniques.get(t.name) ?? { maxSeverity: 0, occurrences: 0 };
        cur.occurrences++;
        if (typeof t.severity === 'number' && t.severity > cur.maxSeverity) cur.maxSeverity = t.severity;
        techniques.set(t.name, cur);
      }
    }

    const first = group[0];
    const dayKeys = [...days].sort();
    out.push({
      contentHash: first.originalHash,
      templateKey: groupKey.slice(groupKey.indexOf('\u0000') + 1),
      variants: hashes.size,
      sampleText: (first.originalText ?? '').slice(0, 200),
      author: first.author ?? 'unknown',
      platform: first.platform,
      recordIds: group.map((r) => r.id),
      timestamps: group.map((r) => r.timestamp),
      serveCount: group.length,
      distinctSessions: sessions,
      distinctDays: days.size,
      daySpan: dayKeys.length ? calendarDaysBetween(dayKeys[0], dayKeys[dayKeys.length - 1]) : 0,
      techniqueProfile: Array.from(techniques.entries())
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.occurrences - a.occurrences || b.maxSeverity - a.maxSeverity),
    });
  }

  out.sort((a, b) => b.serveCount - a.serveCount || b.daySpan - a.daySpan || a.templateKey.localeCompare(b.templateKey));
  return out.slice(0, top);
}
