// Verify-session diagnostic helper.
//
// Pure transformation: ForensicRecord[] → ChainDebugStatsResponse. Lives
// outside service-worker.ts so the unit test can target it directly without
// mocking chrome.runtime. The SW handler at service-worker.ts is a thin
// dispatcher that calls getRecords() then this function, then sends the
// result back via sendResponse.

import type { ForensicRecord } from '../types/forensic';
import type { ChainDebugStatsResponse } from '../types/messages';
import type { AIFailure } from '../ai/ai-error';
import { getRecords } from './store';
import { isSystemMarkerRecord } from './system-records';

const ORIGINAL_TEXT_PREVIEW_CHARS = 50;
const LAST_RECORDS_COUNT = 10;

export function buildChainDebugStatsResponse(
  records: ForensicRecord[],
): ChainDebugStatsResponse {
  const verdictCounts: ChainDebugStatsResponse['verdictCounts'] = {
    flagged: 0,
    'flagged-hidden': 0,
    blocked: 0,
    pass: 0,
    'flagged-undefined': 0,
    other: 0,
  };
  for (const r of records) {
    const v = r.verdict;
    if (v === undefined) verdictCounts['flagged-undefined']++;
    else if (v === 'flagged') verdictCounts.flagged++;
    else if (v === 'flagged-hidden') verdictCounts['flagged-hidden']++;
    else if (v === 'blocked') verdictCounts.blocked++;
    else if (v === 'pass') verdictCounts.pass++;
    else verdictCounts.other++;
  }

  // Newest-first by ISO timestamp string compare. Empty timestamps sort
  // last (`localeCompare` of '' is well-defined; missing timestamps are a
  // legacy edge case but the chain stamps timestamp on write).
  const sorted = [...records].sort((a, b) =>
    (b.timestamp || '').localeCompare(a.timestamp || ''),
  );
  const last10Records = sorted.slice(0, LAST_RECORDS_COUNT).map(r => ({
    verdict: r.verdict ?? 'undefined',
    originalText: (r.originalText ?? '').slice(0, ORIGINAL_TEXT_PREVIEW_CHARS),
    author: r.author,
    technique: r.techniques?.[0]?.name,
    timestamp: r.timestamp,
  }));

  return {
    ok: true,
    totalRecords: records.length,
    verdictCounts,
    last10Records,
  };
}

// Operational Events aggregation per VISION §1.2 ("no silent degradation").
// Walks chain records and groups cancelled-batch / cap-exhausted / scan-purged
// events by time bucket so the dashboard can surface what previously wrote
// silently to IDB. Two visual categories: parent-controllable (cap-exhausted
// daily/monthly/tier-free — license-tier lever) and system-side (LLM failures,
// truncation, scan purge — Groq / system issues, no parent lever).

/**
 * Every failure name a chain record can carry, not just the provider's own
 * `AIFailure` set: records also stamp FeelingWise-side kinds (internal-error,
 * the video exits) and, since 2026-09-02, the two comment-batch parse states.
 * Narrowing this to `AIFailure['kind']` made the cast at the aggregation site
 * a lie and every unnamed failure fall to `network` in the parent's panel.
 */
export type AIFailureKind = NonNullable<ForensicRecord['failureKind']> | AIFailure['kind'];

export interface OperationalEventBucket {
  bucketStartMs: number;
  bucketEndMs: number;
  capExhausted: { daily: number; monthly: number; tierFree: number };
  llmFailure: Partial<Record<AIFailureKind, number>>;
  batchTruncated: number;
  scanPurged: number;
  /** Missed work in the hour: the four counts above. */
  total: number;
  /** Feed items recorded in the hour, missed or not; 0 means the browser was not on a feed, not that nothing was missed. */
  seen: number;
}

function emptyBucket(start: number, end: number): OperationalEventBucket {
  return {
    bucketStartMs: start,
    bucketEndMs: end,
    capExhausted: { daily: 0, monthly: 0, tierFree: 0 },
    llmFailure: {},
    batchTruncated: 0,
    scanPurged: 0,
    total: 0,
    seen: 0,
  };
}

export function bucketizeOperationalEvents(
  records: ForensicRecord[],
  bucketSizeMs: number,
  windowEndMs: number,
  windowDurationMs: number,
): OperationalEventBucket[] {
  const windowStartMs = windowEndMs - windowDurationMs;
  const bucketCount = Math.max(1, Math.ceil(windowDurationMs / bucketSizeMs));
  const buckets: OperationalEventBucket[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const start = windowStartMs + i * bucketSizeMs;
    const end = Math.min(start + bucketSizeMs, windowEndMs);
    buckets.push(emptyBucket(start, end));
  }

  for (const r of records) {
    const tsMs = r.timestamp ? Date.parse(r.timestamp) : NaN;
    if (!Number.isFinite(tsMs)) continue;
    if (tsMs < windowStartMs || tsMs >= windowEndMs) continue;
    const idx = Math.min(
      bucketCount - 1,
      Math.floor((tsMs - windowStartMs) / bucketSizeMs),
    );
    const b = buckets[idx];
    if (!isSystemMarkerRecord(r)) b.seen++;

    if (r.verdict === 'skipped' && r.skipReason === 'cap-exhausted') {
      const cap = r.cap ?? 'daily';
      if (cap === 'daily') b.capExhausted.daily++;
      else if (cap === 'monthly') b.capExhausted.monthly++;
      else b.capExhausted.tierFree++;
      b.total++;
    } else if (
      r.verdict === 'cancelled-batch-llm-failure'
      || r.verdict === 'cancelled-post-llm-failure'
      || r.verdict === 'cancelled-video-unjudged'
      || r.verdict === 'cancelled-image-unjudged'
    ) {
      // Same event class through two doors: a comment batch that could not be
      // scored, and a single post that could not be judged. The parent cares
      // that content went unjudged, not which code path lost it.
      const kind: AIFailureKind = r.failureKind ?? 'network';
      // Cap-exhausted surfaces as a cancelled-batch-llm-failure with
      // failureKind='cap-exhausted' (parent-controllable license-tier lever),
      // not as a separate event-type. Route to the capExhausted bucket so
      // VISION §1.2 "your account vs system-side" distinction holds.
      if (kind === 'cap-exhausted') {
        const cap = r.cap ?? 'daily';
        if (cap === 'daily') b.capExhausted.daily++;
        else if (cap === 'monthly') b.capExhausted.monthly++;
        else b.capExhausted.tierFree++;
      } else {
        b.llmFailure[kind] = (b.llmFailure[kind] ?? 0) + 1;
      }
      b.total++;
    } else if (r.verdict === 'cancelled-batch-truncated') {
      b.batchTruncated++;
      b.total++;
    } else if (r.skipReason === 'scan-purged') {
      // Forward-compat: scan-purged is reserved for future scan-log eviction
      // events. Match on skipReason so when emission lands the dashboard
      // already counts it without a follow-up code change.
      b.scanPurged++;
      b.total++;
    }
  }

  return buckets;
}

/**
 * The figures the Issues tab prints under its all-clear: of the hours with feed items recorded, those with nothing missed
 * (a bucket's total counts only missed work: a cap reached, a reading that failed, a comment batch cut short, a scan
 * purged), and the comment batches cut short. An hour with no feed items was not checked, so it is never counted as clean.
 */
export function allClearFigures(buckets: readonly OperationalEventBucket[]): { cleanHours: number; activeHours: number; cutShort: number } {
  const active = buckets.filter((b) => b.seen > 0 || b.total > 0);
  return {
    cleanHours: active.filter((b) => b.total === 0).length,
    activeHours: active.length,
    cutShort: buckets.reduce((n, b) => n + b.batchTruncated, 0),
  };
}

export async function aggregateOperationalEvents(
  bucketSizeMs: number,
  windowEndMs: number = Date.now(),
  windowDurationMs: number = 24 * 60 * 60 * 1000,
): Promise<OperationalEventBucket[]> {
  // Static import: this module is reachable from the service worker, and a
  // dynamic import here carries Vite's DOM preload helper into the
  // document-free worker realm (known-issues M40 crash class).
  const records = await getRecords();
  return bucketizeOperationalEvents(records, bucketSizeMs, windowEndMs, windowDurationMs);
}
