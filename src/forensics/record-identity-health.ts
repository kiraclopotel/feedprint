// FeelingWise — record-identity (provenance completeness) health summarizer (pure).
//
// The extraction-canary (src/diagnostics/extraction-canary.ts) catches TOTAL
// breakage: "0 extracted despite live content." The real-world failure mode
// after a platform rotates its DOM is DEGRADED capture, not zero capture
// (OPERATING_POINT.md M66, X virtualized slots): records are still WRITTEN, but
// hollow — no author, no source URL, therefore no real platform id
// ("anonymous, synthetic, parentless, and URL-less"). A record's whole value is
// its completeness + provenance, so silently saving identity-less records
// erodes the record leg (Promise 1) while the zero-capture canary stays green.
//
// This reduces the chain's recent content records to a provenance-completeness
// rate, PER PLATFORM. A rotation usually hits one platform, so a per-platform
// rate is the sharp instrument: an all-anonymous X would dilute to a benign
// overall percentage if averaged against healthy Facebook/TikTok volume — the
// same "worst wins" discipline the canary + protection-health already use.
//
// PURE: takes the records the panel already read via getRecords() and reduces
// them. No IDB, no crypto, no write path — a read-only health instrument, never
// a change to extraction logic.

import type { ForensicRecord } from '../types/forensic';
import { isSystemMarkerRecord } from './system-records';

// Records that legitimately carry no per-item author/URL and so must NOT count
// as "content records" for provenance: the room aggregate and every chain
// marker (the shared predicate in system-records.ts; a private three-kind list
// here counted six marker kinds as hollow content, wiring audit 2026-09-13
// C12). Everything else (post/video/comment/reply/image, and legacy records
// with kind undefined) represents a real captured item that SHOULD name who
// posted it and link where.

// A per-platform rate needs enough recent records to be meaningful; below this a
// single hollow record would read as an alarming percentage. Platforms under the
// floor report 'insufficient' and never raise the alarm.
export const IDENTITY_MIN_DENOM = 20;

// Degraded capture is a NOW condition — a platform rotated its DOM today. Only
// records captured in this trailing window count toward the live rate, so a
// clean historical chain neither dilutes nor masks a fresh break.
export const IDENTITY_WINDOW_MS = 24 * 60 * 60 * 1000;

// Rate thresholds on a platform's recent anonymous share.
export const IDENTITY_DEGRADED_PCT = 10; // amber: provenance slipping
export const IDENTITY_BROKEN_PCT = 40;   // red: identity capture largely gone

export type IdentityHealthState = 'ok' | 'degraded' | 'broken' | 'insufficient';

interface PlatformIdentityHealth {
  platform: string;
  /** Content records for this platform inside the window. */
  contentRecords: number;
  /** Records with neither an author nor any source URL (the alarm class). */
  anonymous: number;
  /** Records missing an author (softer signal; superset of anonymous). */
  missingAuthor: number;
  /** Records missing any source URL (softer signal; superset of anonymous). */
  missingUrl: number;
  /** anonymous / contentRecords as a whole percentage (0 when denom 0). */
  anonymousPct: number;
  state: IdentityHealthState;
}

export interface RecordIdentityHealth {
  windowMs: number;
  /** Content records across all platforms inside the window. */
  contentRecords: number;
  anonymous: number;
  missingAuthor: number;
  missingUrl: number;
  /** anonymous / contentRecords across all platforms, whole percent. */
  anonymousPct: number;
  /**
   * The same floor the per-platform rows obey, applied to the total
   * (2026-09-19).
   *
   * stateFor gates every platform row on IDENTITY_MIN_DENOM and the panel
   * prints "not enough to tell" for the ones below it. The headline above those
   * rows had no floor at all: it printed anonymousPct off any total above zero.
   * So two content records with one anonymous read "1 of 2 records anonymous
   * (50%)" over a list in which every row said there was not enough to tell.
   *
   * One number, two treatments, on one panel, from one module that defines the
   * floor at the top of itself.
   */
  state: IdentityHealthState;
  /** Platforms with ≥1 content record in the window, worst-first. */
  platforms: PlatformIdentityHealth[];
  /** Highest-severity platform that met the denominator floor, else null. */
  worst: PlatformIdentityHealth | null;
  /** Overall alarm = the worst platform's state; 'insufficient' → 'ok'. */
  alarm: 'ok' | 'degraded' | 'broken';
}

function isContentRecord(record: ForensicRecord): boolean {
  return record.kind !== 'environment' && !isSystemMarkerRecord(record);
}

/**
 * The adapters write the literal string 'unknown' when they cannot read a
 * handle (src/forensics/payload-base.ts and every platform extractor), and
 * about one record in ten carries it. Counting that as an author present made
 * this monitor blind to the largest capture defect it exists to catch: it read
 * green while a tenth of the chain said nothing about who posted.
 */
function hasAuthor(record: ForensicRecord): boolean {
  const author = (record.author ?? '').trim().toLowerCase();
  return author.length > 0 && author !== 'unknown' && author !== '@unknown';
}

function hasSourceUrl(record: ForensicRecord): boolean {
  // postUrl carries the item/room URL; anchorUrl is the per-comment permalink.
  // Either one anchors the record to a real location (and thus a real platform
  // id). A record with neither is URL-less — no real id per M66.
  return (record.postUrl ?? '').trim().length > 0
    || (record.anchorUrl ?? '').trim().length > 0;
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

function stateFor(contentRecords: number, anonymous: number): IdentityHealthState {
  if (contentRecords < IDENTITY_MIN_DENOM) return 'insufficient';
  const p = (anonymous / contentRecords) * 100;
  if (p >= IDENTITY_BROKEN_PCT) return 'broken';
  if (p >= IDENTITY_DEGRADED_PCT) return 'degraded';
  return 'ok';
}

const SEVERITY: Record<IdentityHealthState, number> = {
  broken: 3,
  degraded: 2,
  ok: 1,
  insufficient: 0,
};

/**
 * Reduce the chain's records to a per-platform provenance-completeness rate over
 * the recent window. Pure — no IDB, no clock beyond the injected `now`.
 */
export function summarizeRecordIdentity(
  records: readonly ForensicRecord[],
  now = Date.now(),
): RecordIdentityHealth {
  const cutoff = now - IDENTITY_WINDOW_MS;
  const byPlatform = new Map<string, { content: number; anon: number; noAuthor: number; noUrl: number }>();

  for (const record of records) {
    if (!isContentRecord(record)) continue;
    const ts = Date.parse(record.timestamp);
    if (!Number.isFinite(ts) || ts < cutoff) continue;

    const author = hasAuthor(record);
    const url = hasSourceUrl(record);
    const bucket = byPlatform.get(record.platform)
      ?? { content: 0, anon: 0, noAuthor: 0, noUrl: 0 };
    bucket.content++;
    if (!author) bucket.noAuthor++;
    if (!url) bucket.noUrl++;
    if (!author && !url) bucket.anon++;
    byPlatform.set(record.platform, bucket);
  }

  const platforms: PlatformIdentityHealth[] = [];
  let totalContent = 0;
  let totalAnon = 0;
  let totalNoAuthor = 0;
  let totalNoUrl = 0;
  for (const [platform, b] of byPlatform) {
    totalContent += b.content;
    totalAnon += b.anon;
    totalNoAuthor += b.noAuthor;
    totalNoUrl += b.noUrl;
    platforms.push({
      platform,
      contentRecords: b.content,
      anonymous: b.anon,
      missingAuthor: b.noAuthor,
      missingUrl: b.noUrl,
      anonymousPct: pct(b.anon, b.content),
      state: stateFor(b.content, b.anon),
    });
  }

  platforms.sort((a, z) =>
    SEVERITY[z.state] - SEVERITY[a.state] || z.anonymousPct - a.anonymousPct);

  // Worst = highest-severity platform that actually met the denominator floor.
  // 'insufficient' platforms are excluded so a couple of hollow records on a
  // barely-browsed site can't raise a false alarm.
  const worst = platforms.find(p => p.state === 'broken' || p.state === 'degraded') ?? null;
  const alarm: RecordIdentityHealth['alarm'] =
    worst?.state === 'broken' ? 'broken' : worst?.state === 'degraded' ? 'degraded' : 'ok';

  return {
    windowMs: IDENTITY_WINDOW_MS,
    contentRecords: totalContent,
    anonymous: totalAnon,
    missingAuthor: totalNoAuthor,
    missingUrl: totalNoUrl,
    anonymousPct: pct(totalAnon, totalContent),
    state: stateFor(totalContent, totalAnon),
    platforms,
    worst,
    alarm,
  };
}
