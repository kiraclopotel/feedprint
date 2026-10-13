// FeelingWise — unified user-facing data layer
//
// Composable query primitives over the existing forensic store; does NOT
// replace getRecords() or computeStats().
//
// Consumed by:
//   - Naming layer (V1) — per-record technique → kid-language
//   - HTML verifier (V1) — page-1 summary template
//   - Algorithm-mirror dashboard (V1.5)
//   - Parent pattern dashboard + conversation library (V1.5)
//
// Surgical changes per Karpathy §3 — this layer creates primitives; the four
// consuming surfaces are updated in their own tiers. Existing Dashboard.tsx
// untouched in this Tier.
//
// Verdict-filter convention: defaults to 'flagged' to match computeStats() in
// src/forensics/store.ts, which counts manipulation presence.
// Legacy records with verdict=undefined are treated as 'flagged'
// per the legacy back-compat rule.

import { ForensicRecord } from '../types/forensic';
import { flagProvenance } from '../forensics/flag-provenance';
import { isPaidPlacement } from '../forensics/paid-placement';

// ─── Period bucketing ──────────────────────────────────────────────────

export type Period = 'day' | 'week' | 'month';

export interface PeriodWindow {
  startISO: string;
  /** Exclusive end (matches half-open interval convention). */
  endISO: string;
}

/** Window containing `anchor`. Week starts Sunday (matches computeStats() in
 *  src/forensics/store.ts); month starts day 1. */
export function periodWindow(period: Period, anchor: Date = new Date()): PeriodWindow {
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  const d = anchor.getDate();
  let start: Date;
  let end: Date;
  switch (period) {
    case 'day':
      start = new Date(y, m, d);
      end = new Date(y, m, d + 1);
      break;
    case 'week':
      // Sunday, to match computeStats() in src/forensics/store.ts. Romanian
      // weeks start on Monday, so a locale-aware week would need a
      // `weekStartsOn` parameter.
      start = new Date(y, m, d - anchor.getDay());
      end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
      break;
    case 'month':
      start = new Date(y, m, 1);
      end = new Date(y, m + 1, 1);
      break;
  }
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

/** Same-length window immediately preceding `current`.
 *
 *  DST-safe day span (G5, 2026-08-04 — the same drift class ExposureView's
 *  '4-weeks' window fixed in F3c): local calendar days are 23–25h on
 *  transition days, so subtracting the window's fixed-ms length landed a
 *  transition-crossing baseline at 23:00/01:00 the wrong side of local
 *  midnight, drifting an hour against bucketByDay's local-midnight columns.
 *  Instead, step back by LOCAL CALENDAR days — the same calendar-date
 *  arithmetic periodWindow itself uses — so midnight-aligned windows (the
 *  only kind periodWindow/windowsFor produce) stay midnight-aligned. */
export function previousPeriodWindow(current: PeriodWindow): PeriodWindow {
  const start = new Date(current.startISO);
  const end = new Date(current.endISO);
  // Round, don't truncate: a span crossing one transition is n×24h ± 1h.
  const daySpan = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  if (daySpan < 1) {
    // Sub-day window (no producer emits one today): calendar-day stepping
    // would collapse it to zero length, so keep fixed-ms subtraction.
    const length = end.getTime() - start.getTime();
    return {
      startISO: new Date(start.getTime() - length).toISOString(),
      endISO: current.startISO,
    };
  }
  const prevStart = new Date(
    start.getFullYear(), start.getMonth(), start.getDate() - daySpan,
    start.getHours(), start.getMinutes(), start.getSeconds(), start.getMilliseconds(),
  );
  return { startISO: prevStart.toISOString(), endISO: current.startISO };
}

// ─── Aggregation primitives ────────────────────────────────────────────

/** Multi-technique records contribute to each technique.
 *
 *  V1.5 extension point: `aggregateByCategory(records)` will mirror this
 *  shape once content-categorization lands (Decision 11 / ). Category
 *  is orthogonal to technique — body-image content may be benign workout
 *  post or manipulative #SkinnyTok; the categorization-vs-precision A/B
 *  test (pending fresh Groq key) determines whether category is added to
 *  the COMBINED prompt or fetched via separate LLM call. */
export function aggregateByTechnique(records: ForensicRecord[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of records) {
    // An ad names no technique here, whatever its record says (standing
    // decision 1, 2026-09-14): the child and teen pipeline stamps
    // consumer-rapid-frame on every sponsored post from the platform's marker
    // alone, which made "pressure to buy" the top pattern in a feed nobody had
    // read. The technique name is not the test, because the judge names
    // consumer-rapid-frame on organic posts too.
    if (isPaidPlacement(r)) continue;
    for (const t of r.techniques) {
      out[t.name] = (out[t.name] ?? 0) + 1;
    }
  }
  return out;
}

export function aggregateByPlatform(records: ForensicRecord[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of records) {
    out[r.platform] = (out[r.platform] ?? 0) + 1;
  }
  return out;
}

/** Count by local hour-of-day (0–23) from r.timestamp. Records with an
 *  unparseable timestamp are skipped. */
export function aggregateByHour(records: ForensicRecord[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const r of records) {
    const ts = new Date(r.timestamp);
    if (Number.isNaN(ts.getTime())) continue;
    const h = ts.getHours();
    out[h] = (out[h] ?? 0) + 1;
  }
  return out;
}

/** Top-n rooms (posts/videos) by how many records share the same caption.
 *  Grouped on the first 60 chars of roomCaption (denormalized captions are
 *  truncated server-side at ~200 chars; 60 absorbs ellipsis drift). Records
 *  without a caption are skipped. Display caption is the full first-seen
 *  value, capped at 120 chars. */
export function topRepeatedRooms(
  records: ForensicRecord[],
  n: number,
): Array<{ caption: string; count: number; url: string; platform: string; lastSeen: string }> {
  const groups = new Map<string, { caption: string; count: number; url: string; platform: string; lastSeen: string }>();
  for (const r of records) {
    const caption = r.roomCaption ?? '';
    const key = caption.slice(0, 60);
    if (!key) continue;
    const g = groups.get(key);
    const url = r.roomUrl || r.postUrl || '';
    if (g) {
      g.count++;
      if (!g.url && url) g.url = url;
      if (r.timestamp > g.lastSeen) g.lastSeen = r.timestamp;
    } else {
      groups.set(key, {
        caption: caption.slice(0, 120),
        count: 1,
        url,
        platform: r.platform,
        lastSeen: r.timestamp,
      });
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, n);
}

export type ActionFamily = 'ads' | 'house-rule' | 'ai-block' | 'detection' | 'pass' | 'not-judged';

/**
 * Classify a record into the parent-facing action family.
 *
 * The families are what a parent reads off the Exposure chart: `ads` is
 * advertising removed, `house-rule` is something this household chose,
 * `ai-block` is AI-generated content, and `detection` is the one that says
 * "FeelingWise judged this harmful". That last bar is the product's central
 * claim, so anything landing in it that no model judged is a lie told in the
 * loudest place.
 *
 * TWO GATES, in this order.
 *
 * First, provenance decides whether a record may be a detection AT ALL
 * (forensics/flag-provenance.ts, on the structured `aiSource` and
 * `overrideOrigin` fields). A rule-decided record is routed to a rule family
 * whatever its detection mode says, so an unrecognised or renamed mode falls
 * back to `house-rule` and can never inflate `detection`.
 *
 * That fallback is the whole point. This function used to key on detection-mode
 * prefixes alone, and the 2026-09-07 rename of `profanity-soften` to
 * `profanity-mask` silently orphaned its branch: the swear mask started
 * counting as an AI detection and nothing failed. Measured on the 2026-09-08
 * export, the `detection` bar read 227 where 119 records were judged by a model
 * — 1.9x — with 54 hashtag blocks, 21 blocklist hits, 13 swear masks and 8
 * profanity-tier hides inside it.
 *
 * Second, the mode names WHICH rule family, because only the mode knows whether
 * a rule was the ad marker, the AI-content marker, or the household's own list.
 * A mode that names none of them still cannot reach `detection`.
 */
export function aggregateByActionFamily(records: ForensicRecord[]): Record<ActionFamily, number> {
  const out: Record<ActionFamily, number> = {
    ads: 0, 'house-rule': 0, 'ai-block': 0, detection: 0, pass: 0, 'not-judged': 0,
  };
  for (const r of records) {
    if (r.verdict === 'pass') { out.pass++; continue; }
    // Observed, never judged (free tier, too short, no real prose, cap
    // exhausted). Its own family: falling through to the mode branches below
    // would count every unjudged post as a detection, which is the loudest way
    // to lie with this number. Cancelled records are the same case — the item
    // left the screen, or the provider never answered — and the caller filters
    // them today, but this function must not depend on being called correctly.
    if (r.verdict === 'skipped' || (r.verdict ?? '').startsWith('cancelled-')) { out['not-judged']++; continue; }
    const dm = r.detectionMode ?? '';
    // Advertising, by the whole-class predicate (forensics/paid-placement.ts):
    // 'sponsored-ad' child/teen pipeline verdicts, 'block:ads:' adult Block Ads
    // category events, the sponsored decision rail, and a record the adapter
    // proved was posted by an advertiser. One family: ads, never detection.
    // The class predicate rather than the mode prefixes, so a renamed or
    // unrecognised ad mode cannot reach the detection bar (standing decision 1,
    // 2026-09-14).
    if (isPaidPlacement(r)) { out.ads++; continue; }
    // The platform's own AI-generated-content marker.
    if (dm.startsWith('block:ai-label')) { out['ai-block']++; continue; }
    // The household's own choices: its word and account blocklist, its hashtag
    // blocklist, and swearing. `profanity-mask` is the name since 2026-09-07;
    // `profanity-soften` and `profanity:` are the names records already on
    // disk carry, so both stay listed. The identity-slur gate stays where it
    // has always been — a family product hides slurs on both modes whatever
    // the household picked, and moving it is a product decision, not a fix.
    if (
      dm.startsWith('blocklist')
      || dm.startsWith('topic:')
      || dm.startsWith('block:hashtag')
      || dm.startsWith('profanity')
      || dm.startsWith('pre-rewrite-hide')
      || dm.startsWith('slur')
    ) { out['house-rule']++; continue; }
    // Everything left is a detection only if a judge actually made it. A rule
    // with a mode this function does not recognise lands in house-rule, which
    // is wrong by one family; landing in `detection` would be wrong by the
    // whole claim.
    if (flagProvenance(r) === 'rule') { out['house-rule']++; continue; }
    out.detection++;
  }
  return out;
}

// ─── Period-over-period delta ──────────────────────────────────────────

export interface PeriodDelta {
  currentTotal: number;
  baselineTotal: number;
  deltaAbs: number;
  /** Null when baseline is 0 (ratio undefined). */
  deltaPct: number | null;
}

function computeDelta(current: number, baseline: number): PeriodDelta {
  return {
    currentTotal: current,
    baselineTotal: baseline,
    deltaAbs: current - baseline,
    deltaPct: baseline === 0 ? null : ((current - baseline) / baseline) * 100,
  };
}

export function comparePeriods(current: ForensicRecord[], baseline: ForensicRecord[]): PeriodDelta {
  return computeDelta(current.length, baseline.length);
}
