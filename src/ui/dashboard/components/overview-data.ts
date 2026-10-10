// FeelingWise — Overview tab data derivation (pure, deterministic, unit-tested).
//
// Every aggregate here is recomputable from the signed records alone; nothing
// is stored. Semantics contracts:
// - The balance pool/verdict split MUST mirror StatisticsTab.tsx (the two
//   surfaces answer the same question and must never disagree).
// - Sessions use the 30-minute quiet-gap rule (the wiring-contract default,
//   same threshold as the Activity/session dividers).
// - Deltas are shown only when the prior window really has data (>= 4 of the
//   6 prior days carry records); otherwise the UI names the gap instead.
// Design source: docs/redesign/mockups/2026-07-15/overview-home.html
// (browser-verified on the real chain before this port).

import type { ForensicRecord } from '../../../types/forensic';
import { isBalanceContent, isBlockedItem, isFlaggedItem, isHiddenAsHarmful, itemOutcomeOf } from '../record-sets';
import { harmSeverityOf, isPaidPlacement } from '../../../forensics/paid-placement';
import { localDayKey } from '../../shared/format-time';

const isCheckedVideo = (r: ForensicRecord): boolean => r.kind === 'video' && itemOutcomeOf(r) !== 'notChecked';

export const SESSION_GAP_MS = 30 * 60 * 1000;
const DELTA_MIN_PRIOR_ACTIVE_DAYS = 4;

/**
 * A whole-number share that never rounds away the thing it is describing.
 *
 * The headline reads "{pct}% of everything decided passed." With 199 of 200
 * passed, a plain Math.round printed 100, and the bar beneath it, which rounds
 * each segment on its own, printed "flagged 1 (1%)" on the same screen: 101%
 * between them, and an absolute the records contradict two lines lower. The
 * same line sat in StatisticsTab, so both read this now (2026-09-19).
 *
 * 100 is reserved for part === whole and 0 for part === 0, which is the only
 * honest use of either: a reader takes them as statements that there were none
 * of the other kind, and on this headline that is exactly what they mean.
 */
export function honestPct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  if (part <= 0) return 0;
  if (part >= whole) return 100;
  const pct = Math.round((part / whole) * 100);
  if (pct >= 100) return 99;
  if (pct <= 0) return 1;
  return pct;
}

// NOTE: blocked verdicts stay OUT of every count labeled "flagged"
// (types/forensic.ts keeps them distinct; SOL review 2026-07-15 finding 5).
// Blocked appears only in the balance bar, where it has its own segment.

// The local calendar day a record belongs to. One implementation, shared with
// StatisticsTab, in src/ui/shared/format-time.ts.
const dayKeyOf = localDayKey;

export interface OverviewSession {
  start: number;
  end: number;
  count: number;
  flaggedTimes: number[];
  platforms: Array<[string, number]>; // sorted desc by count
  recordIds: string[];
}

export interface OverviewKpi {
  key: 'items' | 'flagged' | 'hidden' | 'sessions' | 'platforms' | 'videos';
  value: number;
  series: number[]; // 7 daily values ending at the focus day
  /** null when the prior window lacks coverage (UI names the gap instead). */
  deltaPct: number | null;
}

interface OverviewSurfaceRow {
  key: string; // feedSource value ('unknown' for missing)
  count: number;
  flagged: number;
  recordIds: string[];
}

interface OverviewSourceRow {
  author: string;
  platform: ForensicRecord['platform'];
  accountType?: string;
  count: number;
  flagged: number;
  recordIds: string[];
}

interface OverviewAttentionRow {
  record: ForensicRecord;
  severity: number;
  technique: string;
}

export interface OverviewModel {
  /** Calendar day the brief describes: the latest day with content records. */
  focusDayKey: string;
  focusDate: Date;
  brief: {
    items: number;
    passed: number;
    flagged: number;
    hidden: number;
    sessions: number;
    /** Focus-day platforms with their focus-day record ids, so a chip's
     *  displayed count and its drill result are the same set. */
    platforms: Array<{ platform: string; count: number; recordIds: string[] }>;
  };
  kpis: OverviewKpi[];
  priorActiveDays: number;
  /**
   * For each of the seven days a KPI series covers, whether anything at all was
   * recorded that day. A day with no record is not a day with a value of zero,
   * and drawing it as one turns "the recorder was not installed yet" into a
   * line climbing off the floor. The delta above it has been gated on the
   * number of days on record since it was written; the line was not.
   */
  daysOnRecord: boolean[];
  balance: {
    passed: number;
    flagged: number;
    blocked: number;
    decided: number;
    passedPct: number;
    flaggedVisible: number;
    flaggedHidden: number;
    /** Per-day pass share for the 7-day window (0..1; null = no records). */
    days: Array<{ dayKey: string; passShare: number | null; decided: number }>;
  };
  sessions: OverviewSession[];
  surfaces: OverviewSurfaceRow[];
  surfaceTotal: number;
  sources: OverviewSourceRow[];
  sourceTotal: number;
  attention: OverviewAttentionRow[];
  /** 7 rows (oldest first, ending at focus day) x 24 hourly counts. */
  heat: Array<{ dayKey: string; hours: number[] }>;
  heatMax: number;
}

/** The record's own peak, and 0 for a paid placement: the severity 6 a legacy
 *  sponsored-ad record carries is the ad marker's certainty, not a reading of
 *  harm, and "worth a look" filled with advertising while it counted. */
function severityOf(r: ForensicRecord): number {
  return harmSeverityOf(r);
}

export function splitSessions(dayRecords: ForensicRecord[]): OverviewSession[] {
  const sessions: OverviewSession[] = [];
  let cur: (Omit<OverviewSession, 'platforms'> & { platforms: Map<string, number> }) | null = null;
  const flush = () => {
    if (cur) {
      sessions.push({ ...cur, platforms: [...cur.platforms.entries()].sort((a, b) => b[1] - a[1]) });
    }
  };
  for (const r of dayRecords) {
    const t = new Date(r.timestamp).getTime();
    // >= mirrors ActivityTab's SESSION_GAP_MIN semantics (a gap of exactly
    // 30 minutes starts a new session there too).
    if (!cur || t - cur.end >= SESSION_GAP_MS) {
      flush();
      cur = { start: t, end: t, count: 0, flaggedTimes: [], platforms: new Map(), recordIds: [] };
    }
    cur.end = t;
    cur.count++;
    cur.recordIds.push(r.id);
    cur.platforms.set(r.platform, (cur.platforms.get(r.platform) ?? 0) + 1);
    if (isFlaggedItem(r)) cur.flaggedTimes.push(t);
  }
  flush();
  return sessions;
}

export function computeOverview(records: ForensicRecord[]): OverviewModel | null {
  const content = records
    .filter((r) => isBalanceContent(r) && r.timestamp)
    .slice()
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  if (content.length === 0) return null;

  const byDay = new Map<string, ForensicRecord[]>();
  for (const r of content) {
    const k = dayKeyOf(r.timestamp);
    const arr = byDay.get(k);
    if (arr) arr.push(r);
    else byDay.set(k, [r]);
  }

  // Focus day: the latest day that has content records (today, on a live install).
  const dayKeys = [...byDay.keys()].sort();
  const focusDayKey = dayKeys[dayKeys.length - 1];
  const focusRecs = byDay.get(focusDayKey) ?? [];
  const focusDate = new Date(`${focusDayKey}T12:00:00`);

  // Trailing 7 calendar days ending at the focus day (missing days count 0).
  const trail: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(focusDate);
    d.setDate(d.getDate() - i);
    trail.push(dayKeyOf(d));
  }
  const daily = (pred: (r: ForensicRecord) => boolean): number[] =>
    trail.map((k) => (byDay.get(k) ?? []).filter(pred).length);
  const daysOnRecord = trail.map((k) => (byDay.get(k) ?? []).length > 0);
  const priorActiveDays = daysOnRecord.slice(0, 6).filter(Boolean).length;

  const sessions = splitSessions(focusRecs);
  const sessionsPerDay = trail.map((k) => splitSessions(byDay.get(k) ?? []).length);
  const platformsPerDay = trail.map((k) => new Set((byDay.get(k) ?? []).map((r) => r.platform)).size);

  const focusPassed = focusRecs.filter((r) => r.verdict === 'pass').length;
  const focusFlagged = focusRecs.filter(isFlaggedItem).length;
  // Hidden is an acted number, so advertising leaves it too: isFlaggedItem
  // carries the paid-placement rule for both halves of the pair.
  const isHiddenFinding = (r: ForensicRecord): boolean =>
    isHiddenAsHarmful(r) && isFlaggedItem(r);
  const focusHidden = focusRecs.filter(isHiddenFinding).length;
  const focusPlatformCounts = new Map<string, { count: number; recordIds: string[] }>();
  for (const r of focusRecs) {
    let e = focusPlatformCounts.get(r.platform);
    if (!e) { e = { count: 0, recordIds: [] }; focusPlatformCounts.set(r.platform, e); }
    e.count++;
    e.recordIds.push(r.id);
  }

  const mkKpi = (key: OverviewKpi['key'], value: number, series: number[]): OverviewKpi => {
    const prior = series.slice(0, 6);
    const avg = prior.reduce((a, b) => a + b, 0) / 6;
    const deltaPct =
      priorActiveDays >= DELTA_MIN_PRIOR_ACTIVE_DAYS && avg > 0
        ? Math.round(((value - avg) / avg) * 100)
        : null;
    return { key, value, series, deltaPct };
  };

  const kpis: OverviewKpi[] = [
    mkKpi('items', focusRecs.length, daily(() => true)),
    mkKpi('flagged', focusFlagged, daily(isFlaggedItem)),
    mkKpi('hidden', focusHidden, daily(isHiddenFinding)),
    mkKpi('sessions', sessions.length, sessionsPerDay),
    mkKpi('platforms', focusPlatformCounts.size, platformsPerDay),
    // The card says these were "watched and checked": a video seen but given no verdict is not counted as checked.
    mkKpi('videos', focusRecs.filter(isCheckedVideo).length, daily(isCheckedVideo)),
  ];

  // Balance over the 7-day window (StatisticsTab arithmetic on a named window).
  const winStart = new Date(`${trail[0]}T00:00:00`).getTime();
  const winEnd = new Date(`${focusDayKey}T23:59:59.999`).getTime();
  const pool = content.filter((r) => {
    const t = new Date(r.timestamp).getTime();
    return t >= winStart && t <= winEnd;
  });
  const bPassed = pool.filter((r) => r.verdict === 'pass').length;
  const bFlagged = pool.filter(isFlaggedItem).length;
  const bBlocked = pool.filter(isBlockedItem).length;
  const bHidden = pool.filter(isHiddenFinding).length;
  const decided = bPassed + bFlagged + bBlocked;
  const balanceDays = trail.map((dayKey) => {
    const rs = byDay.get(dayKey) ?? [];
    const dPassed = rs.filter((r) => r.verdict === 'pass').length;
    const dDecided = dPassed + rs.filter(isFlaggedItem).length + rs.filter(isBlockedItem).length;
    return { dayKey, decided: dDecided, passShare: dDecided > 0 ? dPassed / dDecided : null };
  });

  // Served-surface split (whole chain of content records).
  const surfMap = new Map<string, OverviewSurfaceRow>();
  for (const r of content) {
    const key = r.feedSource || 'unknown';
    let row = surfMap.get(key);
    if (!row) {
      row = { key, count: 0, flagged: 0, recordIds: [] };
      surfMap.set(key, row);
    }
    row.count++;
    row.recordIds.push(r.id);
    if (isFlaggedItem(r)) row.flagged++;
  }
  const surfaces = [...surfMap.values()].sort((a, b) => b.count - a.count);

  // Sources: every named account, most-served first.
  const srcMap = new Map<string, OverviewSourceRow>();
  for (const r of content) {
    const author = (r.author ?? '').trim();
    if (!author || author.toLowerCase() === 'unknown') continue;
    const key = `${r.platform}:${author}`;
    let row = srcMap.get(key);
    if (!row) {
      row = { author, platform: r.platform, accountType: r.accountType, count: 0, flagged: 0, recordIds: [] };
      srcMap.set(key, row);
    }
    row.count++;
    row.recordIds.push(r.id);
    if (r.accountType) row.accountType = r.accountType;
    if (isFlaggedItem(r)) row.flagged++;
  }
  const allSources = [...srcMap.values()].sort((a, b) => b.count - a.count);

  // Worth a look: strongest recent flags, one per source.
  const candidates = content
    .filter((r) => isFlaggedItem(r) && severityOf(r) >= 5)
    .sort((a, b) =>
      severityOf(b) - severityOf(a) ||
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const seen = new Set<string>();
  const attention: OverviewAttentionRow[] = [];
  for (const r of candidates) {
    const key = `${r.platform}:${r.author ?? '?'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    attention.push({ record: r, severity: severityOf(r), technique: r.techniques?.[0]?.name ?? '' });
    if (attention.length === 3) break;
  }

  // Rhythm heat: 7 days x 24 hours.
  const heat = trail.map((dayKey) => {
    const hours = new Array<number>(24).fill(0);
    for (const r of byDay.get(dayKey) ?? []) hours[new Date(r.timestamp).getHours()]++;
    return { dayKey, hours };
  });
  const heatMax = Math.max(1, ...heat.flatMap((h) => h.hours));

  return {
    focusDayKey,
    focusDate,
    brief: {
      items: focusRecs.length,
      passed: focusPassed,
      flagged: focusFlagged,
      hidden: focusHidden,
      sessions: sessions.length,
      platforms: [...focusPlatformCounts.entries()]
        .map(([platform, e]) => ({ platform, count: e.count, recordIds: e.recordIds }))
        .sort((a, b) => b.count - a.count),
    },
    kpis,
    priorActiveDays,
    daysOnRecord,
    balance: {
      passed: bPassed,
      flagged: bFlagged,
      blocked: bBlocked,
      decided,
      passedPct: honestPct(bPassed, decided),
      flaggedVisible: bFlagged - bHidden,
      flaggedHidden: bHidden,
      days: balanceDays,
    },
    sessions,
    surfaces,
    surfaceTotal: content.length,
    sources: allSources.slice(0, 8),
    sourceTotal: srcMap.size,
    attention,
    heat,
    heatMax,
  };
}
