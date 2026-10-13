// Operational Events surface for VISION §1.2 ("no silent degradation"). The
// chain has been writing cap-exhausted / cancelled-batch-llm-failure /
// cancelled-batch-truncated / scan-purged records since the cancel-event
// pipeline landed, but the dashboard had no surface to count or filter them —
// parents read silence as "everything's fine" when in reality their license
// cap was hit or Groq was rate-limiting. This panel groups those events into
// two visual categories: parent-controllable (cap exhausted — license-tier
// lever) and system-side (Groq failures, truncation, scan purge — no parent
// lever).

import { offersReading } from '../ai-wording';
import { PRODUCT_NAME, dashboardWords } from '../dashboard-words';
import { useEffect, useRef, useState } from 'react';
import { bakedBuildId, readBuildHistory, type BuildRunRow } from '../build-history-read';
import { buildDiagnosticsProvenance } from '../diagnostics-provenance';
import {
  aggregateOperationalEvents,
  allClearFigures,
  OperationalEventBucket,
  AIFailureKind,
} from '../../../forensics/chain-debug-stats';
import { readSelectorHealth, SelectorHealthSnapshot, assessPlatformDrift, overlayCanary, type PlatformDrift } from '../../../diagnostics/selector-health';
import { readExtractionCanary, type ExtractionCanarySnapshot } from '../../../diagnostics/extraction-canary';
import { readDiagnosticsResult, summarizeHeapTrend, MIN_SAMPLES_FOR_CLIMBING, type DiagnosticsSnapshot } from '../../../diagnostics/diagnostics';
import {
  readProtectionHealth,
  summarizeProtectionIssues,
  type ProtectionHealthSnapshot,
} from '../../../diagnostics/protection-health';
import { readRecords as readPerfRecords, readPerfPersistFailures } from '../../../diagnostics/perf-trace';
import { summarizePerfRecords, perfEmptyStateReason, type PerfSummary, type StagePerfStats } from '../../../diagnostics/perf-summary';
import { isFeatureEnabled } from '../../../storage/feature-flags';
import { getScanEvents } from '../../../forensics/scan-log';
import { summarizeScanActivity, type ScanActivitySummary } from '../../../forensics/scan-activity';
import { readGroqTelemetry } from '../../../ai/telemetry';
import { summarizeGroqTelemetry, type GroqTelemetrySummary } from '../../../ai/telemetry-summary';
import { TEXT_CAP_STORAGE_KEY } from '../../../ai/client';
import { READING_PAUSED_STORAGE_KEY } from '../../../storage/reading-pause';
import { READING_TROUBLE_STORAGE_KEY, readingTroubleStands } from '../../../storage/reading-trouble';
import { readNeutralizerDiagnostics } from '../../../forensics/neutralizer-diagnostics';
import { readRoomMutations, summarizeRoomMutations, type RoomMutationSummary } from '../../../diagnostics/room-attribution-outcome';
import { getLicense, type LicenseTier } from '../../../storage/license';
import { getSettings } from '../../../storage/settings';
import { bearerOf, getReadingConsent } from '../../../storage/reading-consent';
import { levelMakesNoCalls } from '../../../types/mode';
import { getRecordsDetailed } from '../../../forensics/store';
import { verifyChainIntegrity, type IntegrityResult } from '../../../forensics/chain-integrity';
import { summarizeForensicIntegrity, type ForensicIntegritySummary } from '../../../forensics/integrity-summary';
import { summarizeRecordIdentity, type RecordIdentityHealth, type IdentityHealthState } from '../../../forensics/record-identity-health';
import { readHealLog, type HealEvent } from '../../../forensics/auto-heal';
import { getForensicDeliveryStatus, type ForensicDeliveryStatus } from '../../../forensics/delivery-outbox';
import { useDashboardT, useUiLanguage } from '../../../i18n/react';
import { formatCount } from '../../shared/format-number';
import { formatDateTimeLocal, formatTimeLocal } from '../../shared/format-time';

import { BUCKET_SIZE_MS, ISSUE_ACKS_KEY, WINDOW_DURATION_MS, ownerActionableLlmFailures, partitionSelectorDrift, platformDriftDot, rebaseAcks, sanitizeDiagnosticsForClipboard, sumLlmFailure } from './operational-events-helpers';

// The arithmetic moved to ./operational-events-helpers (PLAN-2026-09-16 item 10.3). The names
// tests and other components read are re-exported here, so no import anywhere else changed.
export { ownerActionableLlmFailures, partitionSelectorDrift, platformDriftDot, rebaseAcks, sanitizeDiagnosticsForClipboard } from './operational-events-helpers';
interface PanelProps {
  /** Override aggregator for testing. */
  fetchBuckets?: typeof aggregateOperationalEvents;
  /** Override selector-health reader for testing. */
  fetchSelectorHealth?: typeof readSelectorHealth;
  /** Synchronous seeds used by SSR rendering tests. */
  initialBuckets?: OperationalEventBucket[];
  initialDiagnostics?: DiagnosticsSnapshot;
  initialProtectionHealth?: ProtectionHealthSnapshot;
  /**
   * Q25: the Dashboard's already-computed chain-integrity verdict. When
   * present, the panel reuses it instead of running a SECOND full O(N)
   * crypto walk on mount (multi-second on long chains). Null/undefined =
   * no current verdict (unverified since the last refresh, W13): the panel
   * falls back to its own walk so it never renders a stale summary.
   */
  integrity?: IntegrityResult | null;
}

export function OperationalEventsPanel({
  fetchBuckets,
  fetchSelectorHealth,
  initialBuckets,
  initialDiagnostics,
  initialProtectionHealth,
  integrity,
}: PanelProps = {}) {
  const t = useDashboardT();
  const uiLang = useUiLanguage();
  const [buckets, setBuckets] = useState<OperationalEventBucket[]>(initialBuckets ?? []);
  const [loading, setLoading] = useState(initialBuckets === undefined);
  const [error, setError] = useState<string | null>(null);
  const [selectorHealth, setSelectorHealth] = useState<SelectorHealthSnapshot | null>(null);
  const [canary, setCanary] = useState<ExtractionCanarySnapshot | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot | null>(initialDiagnostics ?? null);
  const [diagnosticCounterTotals, setDiagnosticCounterTotals] = useState<Record<string, number>>(
    initialDiagnostics?.counters ?? {},
  );
  // When each counter was first bumped today. Without it, a counter shipped an
  // hour ago and a counter running since midnight read as the same kind of
  // number, and comparing them fabricated two defects on 2026-08-02.
  const [diagnosticCounterFirstSeen, setDiagnosticCounterFirstSeen] = useState<Record<string, string>>({});
  const [protectionHealth, setProtectionHealth] = useState<ProtectionHealthSnapshot | null>(initialProtectionHealth ?? null);
  const [perfSummary, setPerfSummary] = useState<PerfSummary | null>(null);
  // null = not read yet. Read alongside perfSummary so the empty-state copy
  // can tell "the flag is off" apart from "the flag is on and writes are
  // failing" instead of asserting the wrong one (2026-08-24).
  const [captureV2MetricsEnabled, setCaptureV2MetricsEnabled] = useState<boolean | null>(null);
  const [perfWriteFailures, setPerfWriteFailures] = useState(0);
  const [perfWriteLastError, setPerfWriteLastError] = useState('');
  const [scanActivity, setScanActivity] = useState<ScanActivitySummary | null>(null);
  const [groqSummary, setGroqSummary] = useState<GroqTelemetrySummary | null>(null);
  const [roomMutationSummary, setRoomMutationSummary] = useState<RoomMutationSummary | null>(null);
  // Judge-path counters. Written since the module was built, read by nothing
  // until now, so its reason codes answered no one's question. Carried into the
  // clipboard payload only (no rendered card): these are for a reader
  // diagnosing the pipeline, not a parent reading the dashboard.
  const [neutralizerCounters, setNeutralizerCounters] =
    useState<Record<string, number> | null>(null);
  const [licenseTier, setLicenseTier] = useState<LicenseTier | null>(null);
  // Whether the level is Silent, null until the settings are read: until then no reading card shows, because a
  // Silent install without a key has no reading to fail and an old marker of one would be shown as a fault for as long
  // as the licence takes to be read (a missing key is read again twice, about 150 ms).
  const [strictLevel, setStrictLevel] = useState<boolean | null>(null);
  // At Silent with a key: whether the agreement is stored (null until read). Silent reads only once it is given.
  const [strictAgreed, setStrictAgreed] = useState<boolean | null>(null);
  const [forensicIntegrity, setForensicIntegrity] = useState<ForensicIntegritySummary | null>(null);
  // Whether a verdict from the dashboard has reached the panel. The panel's own
  // walk of the chain runs only while none has, and never overwrites one.
  const verdictReachedRef = useRef(false);
  const [recordIdentity, setRecordIdentity] = useState<RecordIdentityHealth | null>(null);
  const [forensicDeliveryStatus, setForensicDeliveryStatus] = useState<ForensicDeliveryStatus | null>(null);
  const [forensicDeliveryReadFailed, setForensicDeliveryReadFailed] = useState(false);
  const [buildHistory, setBuildHistory] = useState<BuildRunRow[]>([]);
  const [healLog, setHealLog] = useState<HealEvent[]>([]);
  const [textCapPeriod, setTextCapPeriod] = useState<'daily' | 'monthly' | null>(null);
  // The relay asked for the reading's go-ahead and nothing has answered since (storage/reading-pause.ts).
  const [readingPaused, setReadingPaused] = useState(false);
  // The reading service has not answered several calls in a row (storage/reading-trouble.ts).
  const [readingTrouble, setReadingTrouble] = useState(false);
  const [copied, setCopied] = useState(false);
  // Acknowledged (cleared) counter-card baselines, keyed by card key. A card
  // whose count is at or below its baseline stays hidden; when the counter
  // grows past the baseline the problem RECURRED and the card returns.
  // Not date-scoped (wiring audit 13 Sep, D2-34): the card counters are
  // rolling windows and live queue counts, not day totals, so dropping the acks
  // at midnight brought back every cleared card with nothing new behind it.
  // Instead a baseline follows its counter DOWN when the window rolls old
  // events out (rebaseAcks), so a later rise is new events, never the old ones.
  // Live-condition cards (chain broken, AI off, cover down) are never
  // clearable: hiding an active problem would be dishonest.
  const [issueAcks, setIssueAcks] = useState<Record<string, number>>({});
  const [showCleared, setShowCleared] = useState(false);

  useEffect(() => {
    let cancelled = false;
    try {
      chrome.storage.local.get(ISSUE_ACKS_KEY, (res) => {
        if (cancelled) return;
        const stored = res?.[ISSUE_ACKS_KEY] as { date?: string; acks?: Record<string, number> } | undefined;
        if (stored?.acks) setIssueAcks(stored.acks);
      });
    } catch { /* ack read is best-effort */ }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    readHealLog()
      .then(log => { if (!cancelled) setHealLog(log); })
      .catch(() => { /* heal log is best-effort */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = (): void => {
      void readDiagnosticsResult()
        .then(result => {
          if (cancelled) return;
          setDiagnostics(result.snapshot);
          setDiagnosticCounterTotals(result.counterTotals);
          setDiagnosticCounterFirstSeen(
            Object.fromEntries(
              Object.entries(result.counterFirstSeen).map(([k, ms]) => [k, new Date(ms).toISOString()]),
            ),
          );
        })
        .catch(() => { /* diagnostics are best-effort */ });
    };
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    readPerfRecords()
      .then(records => { if (!cancelled) setPerfSummary(summarizePerfRecords(records)); })
      .catch(() => { /* perf-trace is best-effort + gated off by default */ });
    isFeatureEnabled('captureV2Metrics')
      .then(enabled => { if (!cancelled) setCaptureV2MetricsEnabled(enabled); })
      .catch(() => { /* flag read is best-effort */ });
    readPerfPersistFailures()
      .then(log => {
        if (cancelled) return;
        setPerfWriteFailures(log.count);
        setPerfWriteLastError(log.lastError);
      })
      .catch(() => { /* failure log is best-effort */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    readBuildHistory()
      .then(runs => { if (!cancelled) setBuildHistory(runs); })
      .catch(() => { /* build history is a convenience, never required */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getScanEvents()
      .then(events => { if (!cancelled) setScanActivity(summarizeScanActivity(events)); })
      .catch(() => { /* scan-log is best-effort */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    readGroqTelemetry()
      .then(entries => { if (!cancelled) setGroqSummary(summarizeGroqTelemetry(entries)); })
      .catch(() => { /* telemetry is best-effort */ });
    getLicense()
      .then(lic => { if (!cancelled) setLicenseTier(lic.tier); })
      .catch(() => { /* license read is best-effort */ });
    // The level alone does not wait for the licence.
    getSettings()
      .then(st => { if (!cancelled) setStrictLevel(levelMakesNoCalls(st)); })
      .catch(() => { if (!cancelled) setStrictLevel(false); });
    Promise.all([getSettings(), getLicense()])
      .then(async ([st, lic]) => {
        if (cancelled) return;
        const silent = levelMakesNoCalls(st);
        if (!silent || lic.tier === 'free') return;
        // An unreadable agreement is no agreement (the gate reads it the same way).
        const agreed = await getReadingConsent(bearerOf(lic)).then(c => c !== null && c !== undefined, () => false);
        if (!cancelled) setStrictAgreed(agreed);
      })
      .catch(() => { /* the level only picks the card's wording */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    readRoomMutations()
      .then(tally => { if (!cancelled) setRoomMutationSummary(summarizeRoomMutations(tally)); })
      .catch(() => { /* room-mutation tally is best-effort */ });
    readNeutralizerDiagnostics()
      .then(d => { if (!cancelled) setNeutralizerCounters(d.counts); })
      .catch(() => { /* judge counters are best-effort */ });
    chrome.storage.local.get(TEXT_CAP_STORAGE_KEY)
      .then(stored => {
        const marker = stored[TEXT_CAP_STORAGE_KEY] as { cap?: 'daily' | 'monthly'; periodKey?: string } | undefined;
        if (!marker?.cap || !marker.periodKey) return;
        const now = new Date();
        // NOT-DISPLAYED: the cap marker's period key, matched against what the
        // background wrote. It is UTC because the cap window is UTC; changing
        // the clock here would change which day a cap belongs to.
        const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
        const expected = marker.cap === 'monthly' ? month : `${month}-${String(now.getUTCDate()).padStart(2, '0')}`;
        if (!cancelled && marker.periodKey === expected) setTextCapPeriod(marker.cap);
      })
      .catch(() => { /* marker is best-effort */ });
    chrome.storage.local.get(READING_PAUSED_STORAGE_KEY)
      .then(stored => { if (!cancelled && stored[READING_PAUSED_STORAGE_KEY]) setReadingPaused(true); })
      .catch(() => { /* marker is best-effort */ });
    chrome.storage.local.get(READING_TROUBLE_STORAGE_KEY)
      .then(stored => { if (!cancelled && readingTroubleStands(stored[READING_TROUBLE_STORAGE_KEY])) setReadingTrouble(true); })
      .catch(() => { /* marker is best-effort */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    // The dashboard's verdict is reused rather than walking the chain again on
    // every append. It is null for the seconds before the dashboard re-verifies,
    // and the panel keeps the summary it has through that gap.
    if (!integrity) return;
    verdictReachedRef.current = true;
    setForensicIntegrity(summarizeForensicIntegrity(integrity));
  }, [integrity]);

  useEffect(() => {
    let cancelled = false;
    // One chain read when the tab opens, in its own effect so a verdict that
    // arrives meanwhile cannot cancel it and leave the identity card loading.
    // The detailed reader: the plain one answers an empty list when one stored
    // row will not decode, which walked as an empty, verified chain.
    getRecordsDetailed()
      .then(read => {
        if (cancelled) return;
        setRecordIdentity(summarizeRecordIdentity(read.records));
        if (verdictReachedRef.current) return;
        return verifyChainIntegrity(read.records, read.unreadable).then(result => {
          if (!cancelled && !verdictReachedRef.current) setForensicIntegrity(summarizeForensicIntegrity(result));
        });
      })
      .catch(() => { /* record read is best-effort */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = (): void => {
      void readProtectionHealth()
        .then(snapshot => { if (!cancelled) setProtectionHealth(snapshot); })
        .catch(() => { /* protection health is best-effort */ });
    };
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getForensicDeliveryStatus()
      .then(status => { if (!cancelled) setForensicDeliveryStatus(status); })
      .catch(() => { if (!cancelled) setForensicDeliveryReadFailed(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    readExtractionCanary()
      .then(c => { if (!cancelled) setCanary(c); })
      .catch(() => { /* canary is best-effort; never block the panel */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetcher = fetchBuckets ?? aggregateOperationalEvents;
    // Anchor the window end to the next clock hour so every bucket starts on
    // a clock hour. With `Date.now()` as the end, the buckets were cut from
    // "now minus 24h", so the same events read "first seen 23:15" at one
    // capture and "22:27" at the next (owner screenshots, 2026-09-02).
    const windowEndMs = Math.ceil(Date.now() / BUCKET_SIZE_MS) * BUCKET_SIZE_MS;
    fetcher(BUCKET_SIZE_MS, windowEndMs, WINDOW_DURATION_MS)
      .then(b => { if (!cancelled) { setBuckets(b); setLoading(false); } })
      .catch(e => { if (!cancelled) { setError(String(e?.message ?? e)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [fetchBuckets]);

  useEffect(() => {
    let cancelled = false;
    const fetcher = fetchSelectorHealth ?? readSelectorHealth;
    fetcher()
      .then(s => { if (!cancelled) setSelectorHealth(s); })
      .catch(() => { /* selector-health is best-effort; never block the panel */ });
    return () => { cancelled = true; };
  }, [fetchSelectorHealth]);

  // The loading and error screens used to return here, above the
  // acknowledgement effect a few hundred lines below. That made the number of
  // hooks depend on the state: the first render returned early and never
  // reached the effect, the render after the buckets arrived did, and React
  // threw "rendered more hooks than during the previous render" and unmounted
  // the whole page. Opening the Issues tab blanked the dashboard (React error
  // 310, caught 2026-09-17 by the dashboard probe's own page-error log). Every
  // hook in this component now runs on every render; the two screens are
  // returned at the end, where a conditional return costs nothing. The work in
  // between is pure card building over state whose defaults are empty, and
  // `rebaseAcks` over no cards returns the acknowledgements unchanged, so a
  // render during loading computes nothing and decides nothing.

  const capDailyTotal = buckets.reduce((s, b) => s + b.capExhausted.daily, 0);
  const capMonthlyTotal = buckets.reduce((s, b) => s + b.capExhausted.monthly, 0);
  const capTierFreeTotal = buckets.reduce((s, b) => s + b.capExhausted.tierFree, 0);
  const capExhaustedTotal = capDailyTotal + capMonthlyTotal + capTierFreeTotal;
  const llmFailureBreakdown = sumLlmFailure(buckets);
  const llmFailureTotal = Object.values(llmFailureBreakdown).reduce((s, n) => s + (n ?? 0), 0);
  const batchTruncatedTotal = buckets.reduce((s, b) => s + b.batchTruncated, 0);
  const allClear = allClearFigures(buckets);
  const scanPurgedTotal = buckets.reduce((s, b) => s + b.scanPurged, 0);

  // DOM / extraction health — selector drift. The content script records which
  // tier of each selector chain matched (primary / fallback / miss) per query
  // site; heavy fallback or misses mean the platform rotated its DOM and FW's
  // extraction is silently degrading. This is the "catch DOM errors here"
  // surface — the data already accrues in chrome.storage; this reads it.
  const selectorCounters = selectorHealth ? Object.values(selectorHealth.counters) : [];
  const { rated: selectorDrift, unrated: selectorUnrated } = partitionSelectorDrift(selectorCounters);
  const totalSelectorMisses = selectorCounters.reduce((s, c) => s + c.miss, 0);

  // Per-platform rollup (regression harness): a plain status per platform so a
  // silent break is obvious at a glance. 'not-monitored' is itself a signal —
  // FW isn't watching that platform's extraction yet.
  const platformDrift: PlatformDrift[] = selectorHealth
    ? overlayCanary(assessPlatformDrift(selectorHealth), canary ?? { date: '', warnings: {} })
    : [];
  const PLATFORM_LABEL: Record<string, string> = {
    twitter: 'X', facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube',
  };
  const heapTrend = diagnostics ? summarizeHeapTrend(diagnostics.samples, diagnostics.peakMB) : null;
  // Why the perf panel is empty, when it is: distinguishes "flag really off"
  // from "flag on, nothing captured yet" from "flag on, writes are failing" —
  // see perfEmptyStateReason (core/perf-summary.ts).
  const perfEmptyReason = captureV2MetricsEnabled === null
    ? null
    : perfEmptyStateReason({ flagEnabled: captureV2MetricsEnabled, writeFailures: perfWriteFailures });
  const protectionIssues = summarizeProtectionIssues(protectionHealth);
  // Provenance is computed at COPY time, not render time, so `capturedAt` is
  // the instant the reader actually took the snapshot.
  const currentProvenance = () => buildDiagnosticsProvenance({
    capturedAt: new Date().toISOString(),
    buildId: bakedBuildId(),
    version: typeof chrome !== 'undefined' && chrome?.runtime?.getManifest
      ? chrome.runtime.getManifest().version
      : '',
    history: buildHistory,
    summaries: {
      diagnosticsDate: diagnostics?.date ?? null,
      roomSince: roomMutationSummary?.since ?? null,
      recordIdentityWindowMs: recordIdentity?.windowMs ?? null,
      chainLength: forensicIntegrity?.chainLength ?? null,
      // The buffer's cap is on tries, so whether it is full is read from tries, not calls.
      groqCalls: groqSummary?.attempts ?? null,
      groqFirstTs: groqSummary?.firstTs ?? null,
      groqLastTs: groqSummary?.lastTs ?? null,
      perfRecords: perfSummary?.totalRecords ?? null,
    },
  });

  const copyDiagnostics = () => {
    const payload = JSON.stringify({
      // FIRST key on purpose: a reader must see which build produced these
      // numbers, and over what period, before reading any of them.
      provenance: currentProvenance(),
      diagnostics: sanitizeDiagnosticsForClipboard(diagnostics),
      diagnosticCounterTotals,
      diagnosticCounterFirstSeen,
      // Judge-path counters (UTC-day scoped, reset on day flip). Read
      // 'combined-with-concern' against 'combined-no-concern' to see how much
      // of the uncategorised-residual bucket has the model's own phrase behind
      // it and how much is genuinely empty.
      neutralizerCounters,
      protectionHealth,
      canary,
      selectorHealth,
      perfSummary,
      scanActivity,
      licenseTier,
      groqSummary,
      roomMutationSummary,
      forensicIntegrity,
      recordIdentity,
      forensicDeliveryStatus,
      forensicDeliveryReadFailed,
    }, null, 2);
    void navigator.clipboard?.writeText(payload).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => { /* clipboard may be blocked; ignore */ });
  };

  // Plain-English meaning of each pipeline stage lives in the strings table
  // (t.opsStageHelp), keyed by V2Stage. Stage names themselves are data.
  const pct = (frac: number): string => `${Math.round(frac * 100)}%`;
  const perfStageRow = (st: StagePerfStats) => (
    <li key={st.stage} style={{ display: 'grid', gap: 2, padding: '6px 0', borderBottom: '1px solid var(--fw-border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontFamily: 'var(--fw-font-mono)', color: 'var(--fw-text)' }}>{st.stage}</span>
        <span style={{ color: st.p95 > 2000 ? 'var(--fw-red)' : st.p95 > 800 ? 'var(--fw-amber)' : 'var(--fw-green)' }}>
          p50 {st.p50}ms · p95 {st.p95}ms · p99 {st.p99}ms
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: 'var(--fw-muted)' }}>
        <span>{t.opsStageHelp[st.stage] ?? ''}</span>
        {/* Accessibility audit found 2026-09-18: a forced single line on this
            translated stat sentence overflows in RO/PT-BR. */}
        <span>
          {st.count}× · {t.opsPctOk(pct(st.successRate))}{st.cacheHitRate !== null ? t.opsPctCached(pct(st.cacheHitRate)) : ''}
        </span>
      </div>
    </li>
  );

  const driftDot = (s: PlatformDrift['status']) => platformDriftDot(s, t);

  const identityColor = (s: IdentityHealthState): string =>
    s === 'broken' ? 'var(--fw-red)'
    : s === 'degraded' ? 'var(--fw-amber)'
    : s === 'ok' ? 'var(--fw-green)'
    : 'var(--fw-muted)';

  const sectionStyle = {
    background: 'var(--fw-card)',
    border: '1px solid var(--fw-border)',
    borderRadius: 'var(--fw-radius-lg)',
    padding: 16,
    marginBottom: 12,
    fontFamily: 'var(--fw-font-sans)',
  } as const;

  const headingStyle = { fontSize: 13, fontWeight: 600, color: 'var(--fw-text)', margin: '0 0 8px' } as const;
  const lineStyle = { fontSize: 12, color: 'var(--fw-muted)', margin: '4px 0' } as const;

  // Silent with a key: the level that reads once the agreement is given; and Silent with nothing to read (no key, or a key
  // whose agreement is not given), which says so in the AI-health section instead of failing at anything.
  const strictWithKey = strictLevel === true && licenseTier !== null && licenseTier !== 'free';
  const strictOff = strictLevel === true && licenseTier !== null && (licenseTier === 'free' || strictAgreed === false);
  const strictPending = strictWithKey && strictAgreed === null;

  // Plain-language triage cards. Each card answers: what happened, what it
  // means for the child's protection, what (if anything) the parent should do.
  // "Protection reduced right now" items come first; informational items after.
  // Display-only: every card derives from state already read above.
  interface StatusCard {
    key: string;
    reduced: boolean;
    title: string;
    /** Absent where the title is the whole sentence (the Silent cards). */
    meaning?: string;
    action?: string;
    info?: boolean;
    /** A standing state the person has not chosen against, not a fault: plain
     *  border and heading, no live-condition chip (the AI reading being off on
     *  the free plan). */
    neutral?: boolean;
    /** Today's counter value for count-based cards. Present = clearable:
     *  the card hides once acknowledged and returns only when the counter
     *  grows (the problem recurred). Absent = a live NOW condition, never
     *  clearable. */
    measure?: number;
    /** Hour-bucket bounds of the first/last occurrence in the 24h window.
     *  Only bucket-derived counters carry these; diagnostics counters are
     *  day totals with no per-event time, so their cards honestly omit
     *  the line rather than invent one. */
    firstSeenAt?: number;
    lastSeenAt?: number;
  }
  // First/last non-zero bucket for one counter — gives count cards a real
  // time range instead of an undated "counted today".
  const bucketSeenRange = (
    pick: (b: (typeof buckets)[number]) => number,
  ): { firstSeenAt?: number; lastSeenAt?: number } => {
    let firstSeenAt: number | undefined;
    let lastSeenAt: number | undefined;
    for (const b of buckets) {
      if (pick(b) > 0) {
        if (firstSeenAt === undefined) firstSeenAt = b.bucketStartMs;
        lastSeenAt = b.bucketStartMs;
      }
    }
    return { firstSeenAt, lastSeenAt };
  };
  const llmBucketCount = (b: (typeof buckets)[number]): number =>
    Object.values(b.llmFailure).reduce((s: number, n) => s + (n ?? 0), 0);
  // Local wall-clock hour label for a bucket start ("20:00").
  const hourLabel = (ms: number): string => formatTimeLocal(ms, uiLang);
  const cards: StatusCard[] = [];
  if (protectionIssues.protectionState === 'broken') {
    cards.push({ key: 'cover-broken', reduced: true, title: t.opsCardCoverBrokenTitle, meaning: t.opsCardCoverBrokenMeaning, action: t.opsCardCoverBrokenAction });
  } else if (protectionIssues.protectionState === 'slow' && protectionHealth) {
    cards.push({ key: 'cover-slow', reduced: false, title: t.opsCardCoverSlowTitle, meaning: t.opsCardCoverSlowMeaning(Math.round(protectionHealth.oldestMs / 1000)), action: t.opsCardCoverSlowAction });
  } else if (protectionIssues.protectionState === 'checking' && protectionHealth && protectionHealth.visibleHosts > 0) {
    cards.push({
      key: 'cover-checking',
      reduced: false,
      info: true,
      title: t.opsCardCoverCheckingTitle(protectionHealth.visibleHosts),
      meaning: t.opsCardCoverCheckingMeaning(protectionHealth.owners.post),
    });
  }
  // A free install is told nothing about the AI reading (ai-wording.ts): no card saying it is off, no allowance, no AI health.
  if (offersReading(licenseTier) && capTierFreeTotal > 0) {
    cards.push({ key: 'tier-mismatch', reduced: true, title: t.opsCardTierMismatchTitle(capTierFreeTotal), meaning: t.opsCardTierMismatchMeaning, action: t.opsCardTierMismatchAction });
  }
  if (capDailyTotal + capMonthlyTotal > 0) {
    cards.push({ key: 'cap', reduced: true, measure: capDailyTotal + capMonthlyTotal, title: t.opsCardCapTitle(capDailyTotal + capMonthlyTotal), meaning: t.opsCardCapMeaning, action: t.opsCardCapAction, ...bucketSeenRange(b => b.capExhausted.daily + b.capExhausted.monthly) });
  }
  if (forensicIntegrity && !forensicIntegrity.valid) {
    cards.push({ key: 'chain', reduced: true, title: t.opsCardChainTitle, meaning: t.opsCardChainMeaning, action: forensicIntegrity.remediation });
  }
  if (forensicDeliveryStatus && forensicDeliveryStatus.pendingCount > 0) {
    cards.push({
      key: 'forensic-delivery',
      reduced: false,
      title: t.opsCardDeliveryPendingTitle(forensicDeliveryStatus.pendingCount),
      meaning: t.opsCardDeliveryPendingMeaning,
      action: t.opsCardDeliveryPendingAction,
    });
  } else if (forensicDeliveryReadFailed) {
    cards.push({
      key: 'forensic-delivery-unreadable',
      reduced: false,
      title: t.opsCardDeliveryReadFailedTitle,
      meaning: t.opsCardDeliveryReadFailedMeaning,
      action: t.opsCardDeliveryReadFailedAction,
    });
  }
  // Q77 (W68): quarantined deliveries are held evidence - loud, never silent.
  if (forensicDeliveryStatus && forensicDeliveryStatus.quarantinedCount > 0) {
    cards.push({
      key: 'forensic-delivery-quarantined',
      reduced: true,
      measure: forensicDeliveryStatus.quarantinedCount,
      title: t.opsCardDeliveryQuarantinedTitle(forensicDeliveryStatus.quarantinedCount),
      meaning: t.opsCardDeliveryQuarantinedMeaning,
      action: t.opsCardDeliveryQuarantinedAction,
    });
  }
  if (forensicDeliveryStatus && forensicDeliveryStatus.discardedRestoreCount > 0) {
    cards.push({
      key: 'forensic-delivery-discarded-restore',
      reduced: false,
      measure: forensicDeliveryStatus.discardedRestoreCount,
      title: t.opsCardDeliveryDiscardedTitle(forensicDeliveryStatus.discardedRestoreCount),
      meaning: t.opsCardDeliveryDiscardedMeaning,
      action: t.opsCardDeliveryDiscardedAction,
    });
  }
  if (recordIdentity && recordIdentity.alarm !== 'ok' && recordIdentity.worst) {
    const w = recordIdentity.worst;
    const name = PLATFORM_LABEL[w.platform] ?? w.platform;
    cards.push({
      key: 'record-identity',
      reduced: recordIdentity.alarm === 'broken',
      title: t.opsCardIdentityTitle(name, w.anonymousPct),
      meaning: t.opsCardIdentityMeaning,
      action: t.opsCardIdentityAction,
    });
  }
  for (const d of platformDrift) {
    const name = PLATFORM_LABEL[d.platform] ?? d.platform;
    if (d.status === 'broken') {
      cards.push({ key: `broken-${d.platform}`, reduced: true, title: t.opsCardPlatformBrokenTitle(name), meaning: t.opsCardPlatformBrokenMeaning(name), action: t.opsCardPlatformBrokenAction });
    } else if (d.status === 'drifting') {
      cards.push({ key: `drift-${d.platform}`, reduced: false, title: t.opsCardPlatformDriftTitle(name), meaning: t.opsCardPlatformDriftMeaning });
    }
  }
  if (strictLevel === null) {
    // The level is not read yet: no reading card for a level that may not read (see strictLevel above).
  } else if (strictLevel) {
    // Silent says what it does in its own one sentence each, because the cards below speak of posts that "stay as written"
    // and at Silent they are filtered on this computer. Silent without a key reads nothing, so it has no reading to fail.
    if (strictWithKey) {
      if (strictAgreed === false || readingPaused) {
        cards.push({ key: 'strict-no-agreement', reduced: true, title: t.strictNoAgreement });
      }
      if (readingTrouble) {
        cards.push({ key: 'strict-service-down', reduced: true, title: t.strictServiceDown });
      }
      if (textCapPeriod === 'daily') {
        cards.push({ key: 'strict-allowance-out', reduced: true, title: t.strictAllowanceOut });
      } else if (textCapPeriod) {
        cards.push({ key: `text-cap-${textCapPeriod}`, reduced: true, title: t.opsCardTextCapTitle(textCapPeriod), meaning: t.opsCardTextCapMeaning(textCapPeriod), action: t.opsCardTextCapAction(textCapPeriod) });
      }
    }
  } else {
    if (readingPaused) {
      cards.push({ key: 'reading-paused', reduced: true, title: t.opsCardReadingPausedTitle, meaning: t.opsCardReadingPausedMeaning, action: t.opsCardReadingPausedAction });
    }
    if (readingTrouble) {
      cards.push({ key: 'reading-trouble', reduced: true, title: t.opsCardReadingTroubleTitle, meaning: t.opsCardReadingTroubleMeaning, action: t.opsCardReadingTroubleAction });
    }
    if (textCapPeriod) {
      cards.push({ key: `text-cap-${textCapPeriod}`, reduced: true, title: t.opsCardTextCapTitle(textCapPeriod), meaning: t.opsCardTextCapMeaning(textCapPeriod), action: t.opsCardTextCapAction(textCapPeriod) });
    }
  }
  if (llmFailureTotal > 0) {
    // "This resolves on its own" is true of `network` and `transient-http`, and
    // FALSE of `auth-refusal` — which `src/ai/client.ts:320` itself calls a
    // "genuinely permanent" failure and refuses to retry. Owner's 2026-08-20
    // dump: 15 failures, 14 network + 1 auth-refusal, advised as self-healing.
    // A revoked / mis-tiered licence waits forever for a recovery that is not
    // coming, so the one kind he can act on gets its own advice.
    const authRefusals = ownerActionableLlmFailures(llmFailureBreakdown);
    cards.push({
      key: 'llm',
      reduced: false,
      measure: llmFailureTotal,
      title: t.opsCardLlmTitle(llmFailureTotal),
      meaning: t.opsCardLlmMeaning,
      action: authRefusals > 0 ? t.opsCardLlmAuthAction(authRefusals) : t.opsNoActionNeeded,
      ...bucketSeenRange(llmBucketCount),
    });
  }
  if (batchTruncatedTotal > 0) {
    cards.push({ key: 'truncated', reduced: false, measure: batchTruncatedTotal, title: t.opsCardTruncatedTitle(batchTruncatedTotal), meaning: t.opsCardTruncatedMeaning, action: t.opsNoActionNeeded, ...bucketSeenRange(b => b.batchTruncated) });
  }
  if (scanPurgedTotal > 0) {
    cards.push({ key: 'purged', reduced: false, measure: scanPurgedTotal, title: t.opsCardPurgedTitle(scanPurgedTotal), meaning: t.opsCardPurgedMeaning, ...bucketSeenRange(b => b.scanPurged) });
  }
  // Severity first (protection-reduced on top), then newest activity first.
  // Live NOW conditions carry no timestamp and rank as most recent.
  cards.sort((a, b) =>
    Number(b.reduced) - Number(a.reduced)
    || (b.lastSeenAt ?? Number.POSITIVE_INFINITY) - (a.lastSeenAt ?? Number.POSITIVE_INFINITY));

  // Split into visible vs acknowledged. Only counter cards (measure present)
  // can be cleared; a cleared card returns when its counter grows past the
  // acknowledged baseline, i.e. the problem happened AGAIN after clearing.
  // Lower a baseline to its counter when the rolling window dropped old events,
  // and keep that lowered baseline (D2-34).
  const measureSignature = cards.map(c => `${c.key}:${c.measure ?? ''}`).join('|');
  useEffect(() => {
    const next = rebaseAcks(issueAcks, cards);
    if (next === issueAcks) return;
    setIssueAcks(next);
    try {
      void chrome.storage.local.set({ [ISSUE_ACKS_KEY]: { acks: next } });
    } catch { /* ack write is best-effort */ }
    // Keyed on the measures, not the card objects rebuilt each render
  }, [measureSignature, issueAcks]);
  const visibleCards = cards.filter(c => c.measure === undefined || c.measure > (issueAcks[c.key] ?? -1));
  const clearedCards = cards.filter(c => c.measure !== undefined && c.measure <= (issueAcks[c.key] ?? -1));
  const clearableCount = visibleCards.filter(c => c.measure !== undefined).length;

  const clearIssues = (): void => {
    const next = { ...issueAcks };
    for (const c of cards) {
      if (c.measure !== undefined) next[c.key] = Math.max(next[c.key] ?? 0, c.measure);
    }
    setIssueAcks(next);
    try {
      // `void`: pre-existing no-floating-promises error at HEAD (line 705
      // there), surfaced by linting this file for the diagnostics repairs.
      // Behavior unchanged — the write was already fire-and-forget.
      void chrome.storage.local.set({
        [ISSUE_ACKS_KEY]: { acks: next },
      });
    } catch { /* ack write is best-effort */ }
  };

  if (loading) {
    return (
      <div style={{ color: 'var(--fw-muted)', fontFamily: 'var(--fw-font-sans)', fontSize: 13, padding: 12 }}>
        {t.opsLoading}
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ color: 'var(--fw-red)', fontFamily: 'var(--fw-font-sans)', fontSize: 13, padding: 12 }}>
        {t.opsLoadFailed(error)}
      </div>
    );
  }

  // Accessibility audit found 2026-09-18: forced single line on this
  // translated chip label (NOW / 24H / TODAY / CLEARED) overflowed the chip
  // in RO/PT-BR, whose short-label translations run 2-3x the English length.
  const eraChipStyle = {
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: '0.05em',
    color: 'var(--fw-muted)',
    border: '1px solid var(--fw-border)',
    borderRadius: 0,
    padding: '1px 5px',
    verticalAlign: 'middle',
    marginLeft: 8,
  };

  const statusCard = (c: StatusCard, cleared = false) => (
    <section key={c.key} style={{ ...sectionStyle, opacity: cleared ? 0.55 : 1, borderLeft: `3px solid ${cleared || c.neutral ? 'var(--fw-border)' : c.reduced ? 'var(--fw-red)' : c.info ? 'var(--fw-teal)' : 'var(--fw-amber)'}` }}>
      <h3 style={{ ...headingStyle, color: cleared ? 'var(--fw-muted)' : c.reduced ? 'var(--fw-red)' : c.info ? 'var(--fw-teal)' : 'var(--fw-text)' }}>
        {c.title}
        {c.neutral && !cleared ? null : <span style={eraChipStyle}>{cleared ? t.opsIssueChipCleared : c.measure === undefined ? t.opsIssueChipNow : c.firstSeenAt !== undefined ? t.opsIssueChip24h : t.opsIssueChipToday}</span>}
      </h3>
      {c.firstSeenAt !== undefined && c.lastSeenAt !== undefined && (
        <p style={{ fontSize: 12, color: 'var(--fw-muted)', margin: '2px 0 0' }}>
          {c.firstSeenAt === c.lastSeenAt
            ? t.opsIssueSeenAt(hourLabel(c.firstSeenAt))
            : t.opsIssueSeenRange(hourLabel(c.firstSeenAt), hourLabel(c.lastSeenAt))}
        </p>
      )}
      {c.meaning !== undefined && (
        <p style={lineStyle}><strong style={{ color: 'var(--fw-text)' }}>{t.opsWhatItMeansLabel}</strong>{c.meaning}</p>
      )}
      {c.action && !cleared && (
        <p style={lineStyle}><strong style={{ color: 'var(--fw-text)' }}>{t.opsWhatToDoLabel}</strong>{c.action}</p>
      )}
    </section>
  );

  // Provenance shown in the tab itself. Computed from the same helper the copy
  // payload uses, so the screen and the clipboard can never disagree.
  const shownProvenance = currentProvenance();
  const buildLabel = shownProvenance.build.id || t.opsBuildUnknown;
  const buildVersion = shownProvenance.build.version;
  const buildSince = shownProvenance.build.runningSince;
  const buildStraddles = shownProvenance.spansMultipleBuilds;

  return (
    <div className="ops-panel" style={{ fontFamily: 'var(--fw-font-sans)', color: 'var(--fw-text)' }}>
      <h2 className="ops-title" style={{ fontSize: 16, fontWeight: 600, margin: '0 0 8px' }}>
        {t.opsTitle}
      </h2>
      <p style={{ fontSize: 12, color: 'var(--fw-muted)', margin: '0 0 8px' }}>
        {offersReading(licenseTier) ? t.opsIntro : dashboardWords(uiLang).opsIntroNoAi(PRODUCT_NAME)}
      </p>

      {clearableCount > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button
            type="button"
            onClick={clearIssues}
            style={{
              fontFamily: 'var(--fw-font-sans)', fontSize: 12, fontWeight: 500,
              color: 'var(--fw-text-secondary)', background: 'transparent',
              border: '1px solid var(--fw-border)', borderRadius: 0,
              padding: '5px 12px', cursor: 'pointer',
            }}
          >
            {t.opsIssuesClear(clearableCount)}
          </button>
        </div>
      )}

      {visibleCards.length === 0 ? (
        // The healthy state reads like the head: the verdict, then the figures it rests on, from the scan log itself.
        <section className="ops-allgood" style={sectionStyle}>
          <div className="ops-allgood-head">
            <h3 style={headingStyle}>{t.opsStatusAllGoodTitle}</h3>
            <p style={lineStyle}>{clearedCards.length > 0 ? t.opsStatusAllClearedMeaning : t.opsStatusAllGoodMeaning}</p>
          </div>
          <dl className="ops-allgood-figures">
            {allClear.activeHours > 0 && (
              <div>
                <dt>{dashboardWords(uiLang).opsFigCleanHours}</dt>
                <dd>{formatCount(allClear.cleanHours, uiLang)} / {formatCount(allClear.activeHours, uiLang)}</dd>
              </div>
            )}
            {buckets.length > 0 && (
              <div>
                <dt>{dashboardWords(uiLang).opsFigCutShort}</dt>
                <dd>{formatCount(allClear.cutShort, uiLang)}</dd>
              </div>
            )}
            {scanActivity && scanActivity.totalScanned > 0 && (
              <>
                <div><dt>{dashboardWords(uiLang).opsFigLooked}</dt><dd>{formatCount(scanActivity.totalScanned, uiLang)}</dd></div>
                <div><dt>{dashboardWords(uiLang).opsFigActed}</dt><dd>{formatCount(scanActivity.actedOn, uiLang)}</dd></div>
                <div><dt>{dashboardWords(uiLang).opsFigUnfinished}</dt><dd>{formatCount(scanActivity.cancelled, uiLang)}</dd></div>
              </>
            )}
          </dl>
          {buckets.length > 0 && (
            // The day the verdict covers, one cell an hour, oldest first: an hour with anything missed in ink, an hour with no
            // feed items left blank, since nothing was there to check.
            <div className="ops-day" aria-hidden="true">
              <div className="ops-day-cells">
                {buckets.map((b) => <span key={b.bucketStartMs} className={b.total > 0 ? 'hit' : b.seen > 0 ? '' : 'idle'} />)}
              </div>
              <div className="ops-day-ticks">
                {buckets.filter((_, i) => i % 6 === 0).map((b) => <span key={b.bucketStartMs}>{formatTimeLocal(b.bucketStartMs, uiLang)}</span>)}
                <span>{dashboardWords(uiLang).opsDayNow}</span>
              </div>
            </div>
          )}
        </section>
      ) : (
        visibleCards.map(c => statusCard(c))
      )}

      {clearedCards.length > 0 && (
        <p style={{ fontSize: 12, color: 'var(--fw-muted)', margin: '8px 0 0' }}>
          {t.opsIssuesClearedNote(clearedCards.length)}{' '}
          <button
            type="button"
            onClick={() => setShowCleared(s => !s)}
            style={{ fontFamily: 'var(--fw-font-sans)', fontSize: 12, color: 'var(--fw-accent)', background: 'transparent', border: 0, padding: 0, cursor: 'pointer' }}
          >
            {showCleared ? t.opsIssuesHideCleared : t.opsIssuesShowCleared}
          </button>
        </p>
      )}
      {showCleared && clearedCards.map(c => statusCard(c, true))}

      <details style={{ marginTop: 16 }}>
        <summary style={{ fontSize: 12, fontWeight: 600, color: 'var(--fw-muted)', cursor: 'pointer', marginBottom: 12 }}>
          {t.opsTechDetails}
        </summary>

      {/* Build provenance, in the support fold: a parent has no use for a build id on the first screen, and whoever reads
          the numbers for a bug report needs to know which build made them, since after a rebuild they can straddle two. */}
      <div
        style={{
          fontSize: 12, color: 'var(--fw-muted)', margin: '0 0 16px',
          fontFamily: 'var(--fw-font-mono)', display: 'flex',
          flexWrap: 'wrap', gap: 8, alignItems: 'center',
        }}
      >
        <span>{t.opsBuildLine(buildLabel, buildVersion)}</span>
        {buildSince && <span>{t.opsBuildSince(formatDateTimeLocal(buildSince, uiLang))}</span>}
        {buildStraddles && (
          <span
            style={{
              color: 'var(--fw-amber)', border: '1px solid var(--fw-amber)',
              borderRadius: 0, padding: '1px 6px', fontFamily: 'var(--fw-font-sans)',
            }}
          >
            {t.opsBuildStraddleWarning}
          </span>
        )}
      </div>

      {offersReading(licenseTier) && (
      <section style={{ ...sectionStyle, borderLeft: '3px solid var(--fw-teal)' }}>
        <h3 style={headingStyle}>{t.opsYourAccount}</h3>
        <p style={lineStyle}>{t.opsCapExhausted(capExhaustedTotal)}</p>
        {capExhaustedTotal > 0 && (
          <p style={lineStyle}>
            {t.opsCapBreakdown(capDailyTotal, capMonthlyTotal, capTierFreeTotal)}
          </p>
        )}
      </section>
      )}

      {/* An orange edge reads as a warning, so this panel wears it only while one of its counts is above zero; the
          reference panels below wear the plain edge. */}
      <section style={{ ...sectionStyle, borderLeft: `3px solid ${(offersReading(licenseTier) ? llmFailureTotal : 0) + batchTruncatedTotal + scanPurgedTotal > 0 ? 'var(--fw-amber)' : 'var(--fw-border)'}` }}>
        <h3 style={headingStyle}>{t.opsSystemSide}</h3>
        {offersReading(licenseTier) && (
        <p style={lineStyle}>
          {t.opsLlmFailures(llmFailureTotal)}
        </p>
        )}
        {offersReading(licenseTier) && llmFailureTotal > 0 && (
          <p style={lineStyle}>
            {(Object.entries(llmFailureBreakdown) as [AIFailureKind, number][])
              .filter(([, n]) => n && n > 0)
              .map(([k, n]) => `${k}: ${n}`)
              .join(' · ')}
            .
          </p>
        )}
        <p style={lineStyle}>{t.opsBatchTruncated(batchTruncatedTotal)}</p>
        <p style={lineStyle}>{t.opsScanPurged(scanPurgedTotal)}</p>
      </section>

      {offersReading(licenseTier) && (
      <section style={{ ...sectionStyle, borderLeft: '3px solid var(--fw-border)' }}>
        <h3 style={headingStyle}>{t.opsAiHealthTitle}</h3>
        <p style={lineStyle}>
          {t.opsAiHealthSub}
        </p>

        {licenseTier === null || strictPending ? (
          <p style={lineStyle}>{t.opsLoadingShort}</p>
        ) : strictOff ? (
          <p style={lineStyle}>
            {licenseTier === 'free' ? t.opsAiOffStrict : t.opsAiOffStrictKey}
          </p>
        ) : licenseTier === 'free' ? (
          <p style={lineStyle}>{t.opsAiOff}</p>
        ) : capTierFreeTotal > 0 ? (
          <p style={{ ...lineStyle, color: 'var(--fw-red)', fontWeight: 600 }}>
            {t.opsTierMismatch1}<strong>{licenseTier}</strong>{t.opsTierMismatch2(capTierFreeTotal)}
          </p>
        ) : (
          <p style={{ ...lineStyle, color: 'var(--fw-green)' }}>
            {t.opsLicenseActive1}<strong>{licenseTier}</strong>{t.opsLicenseActive2}
          </p>
        )}

        {groqSummary && groqSummary.calls > 0 ? (
          <>
            <p style={lineStyle}>
              {t.opsGroqCalls(groqSummary.calls, groqSummary.okCalls, groqSummary.errorCalls, groqSummary.retriedCalls, groqSummary.attempts, groqSummary.latencyP50, groqSummary.latencyP95)}
            </p>
            <p style={lineStyle}>
              {t.opsGroqTokens(formatCount(groqSummary.promptTokens, uiLang), formatCount(groqSummary.completionTokens, uiLang))}
              {groqSummary.truncatedCalls > 0 ? t.opsGroqTruncated(groqSummary.truncatedCalls) : ''}
              {groqSummary.minRemainingTokens !== null ? t.opsGroqHeadroom(formatCount(groqSummary.minRemainingTokens, uiLang)) : ''}
              {groqSummary.lastRetryAfterMs !== null ? t.opsGroqRetryAfter(groqSummary.lastRetryAfterMs) : ''}
            </p>
            {groqSummary.statusBreakdown.length > 0 && (
              <p style={{ ...lineStyle, fontFamily: 'var(--fw-font-mono)', fontSize: 12 }}>
                {t.opsGroqStatusLine(groqSummary.statusBreakdown.map(s => `HTTP ${s.status}: ${s.count}`).join(' · '))}
              </p>
            )}
          </>
        ) : licenseTier !== null && licenseTier !== 'free' && !strictOff ? (
          <p style={lineStyle}>
            {t.opsNoAiCalls}
          </p>
        ) : null}
      </section>
      )}

      <section style={{ ...sectionStyle, borderLeft: '3px solid var(--fw-border)' }}>
        <h3 style={headingStyle}>{t.opsExtractionTitle}</h3>
        <p style={lineStyle}>
          {t.opsExtractionSub}
        </p>

        {platformDrift.length > 0 && (
          <ul style={{ margin: '0 0 10px', padding: 0, listStyle: 'none', display: 'grid', gap: 4, fontSize: 12 }}>
            {platformDrift.map(d => {
              const dot = driftDot(d.status);
              return (
                <li key={d.platform} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span><span style={{ color: dot.color }}>●</span> {PLATFORM_LABEL[d.platform] ?? d.platform}</span>
                  <span style={{ color: dot.color }}>
                    {dot.text}{d.status === 'drifting' || d.status === 'broken' ? ` · ${d.missPct > 0 ? t.opsMissPct(d.missPct) : t.opsFallbackPct(d.fallbackPct)}` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {selectorHealth === null ? (
          <p style={lineStyle}>{t.opsLoadingShort}</p>
        ) : selectorCounters.length === 0 ? (
          <p style={lineStyle}>{t.opsNoExtraction}</p>
        ) : selectorDrift.length === 0 ? (
          <>
            <p style={{ ...lineStyle, color: 'var(--fw-green)' }}>
              {t.opsSelectorsOk(selectorCounters.length)}
            </p>
            {selectorUnrated.length > 0 && (
              <p style={{ ...lineStyle, color: 'var(--fw-muted)' }}>
                {t.opsSelectorUnrated(selectorUnrated.length)}
              </p>
            )}
          </>
        ) : (
          <>
            <p style={lineStyle}>
              {t.opsDriftSummary(selectorDrift.length, totalSelectorMisses)}
            </p>
            {selectorUnrated.length > 0 && (
              <p style={{ ...lineStyle, color: 'var(--fw-muted)' }}>
                {t.opsSelectorUnrated(selectorUnrated.length)}
              </p>
            )}
            <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 4, fontSize: 12, color: 'var(--fw-muted)' }}>
              {selectorDrift.slice(0, 12).map(d => (
                <li key={d.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontFamily: 'var(--fw-font-mono)' }}>{d.label}</span>
                  <span style={{ color: d.missPct > 0 ? 'var(--fw-red)' : 'var(--fw-amber)' }}>
                    {d.missPct > 0 ? t.opsMissPct(d.missPct) : t.opsFallbackPct(d.fallbackPct)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section style={{ ...sectionStyle, borderLeft: '3px solid var(--fw-border)' }}>
        <h3 style={headingStyle}>{t.opsIdentityTitle}</h3>
        <p style={lineStyle}>{t.opsIdentitySub}</p>

        {recordIdentity === null ? (
          <p style={lineStyle}>{t.opsLoadingShort}</p>
        ) : recordIdentity.contentRecords === 0 ? (
          <p style={lineStyle}>{t.opsIdentityNoRecords}</p>
        ) : (
          <>
            <p style={{ ...lineStyle, color: identityColor(recordIdentity.state === 'insufficient' ? 'insufficient' : recordIdentity.alarm) }}>
              {/* The headline obeys the same floor as the rows under it
                  (2026-09-19). It used to print a percentage off any total
                  above zero, so a two-record day read "1 of 2 anonymous (50%)"
                  above a list where every row said there was not enough to
                  tell. Same sentence the rows use, so a reader meets one idea
                  rather than two. */}
              {recordIdentity.state === 'insufficient'
                ? t.opsIdentityInsufficient(recordIdentity.contentRecords)
                : recordIdentity.anonymous === 0
                  ? t.opsIdentityAllGood(recordIdentity.contentRecords)
                  : t.opsIdentityOverall(recordIdentity.anonymous, recordIdentity.contentRecords, recordIdentity.anonymousPct)}
            </p>
            <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 4, fontSize: 12 }}>
              {recordIdentity.platforms.map(p => (
                <li key={p.platform} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span><span style={{ color: identityColor(p.state) }}>●</span> {PLATFORM_LABEL[p.platform] ?? p.platform}</span>
                  <span style={{ color: identityColor(p.state) }}>
                    {p.state === 'insufficient'
                      ? t.opsIdentityInsufficient(p.contentRecords)
                      : t.opsIdentityRow(p.anonymous, p.contentRecords, p.anonymousPct)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section style={{ ...sectionStyle, borderLeft: '3px solid var(--fw-border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <h3 style={headingStyle}>{t.opsMemoryTitle}</h3>
          <button
            type="button"
            className="btn"
            onClick={copyDiagnostics}
          >
            {copied ? t.opsCopied : t.opsCopyDiagnostics}
          </button>
        </div>
        <p style={lineStyle}>{t.opsMemorySub}</p>

        {diagnostics === null ? (
          <p style={lineStyle}>{t.opsLoadingShort}</p>
        ) : !heapTrend || heapTrend.sampleCount === 0 ? (
          <p style={lineStyle}>{t.opsNoMemSamples}</p>
        ) : (
          <>
            <p style={{
              ...lineStyle,
              color: heapTrend.climbing
                ? 'var(--fw-red)'
                : heapTrend.sampleCount < MIN_SAMPLES_FOR_CLIMBING
                  ? 'var(--fw-muted)'
                  : 'var(--fw-green)',
            }}>
              {t.opsMemoryLine(heapTrend.lastMB, heapTrend.peakMB, heapTrend.firstMB)}
              {heapTrend.climbing
                ? t.opsMemClimbing(heapTrend.deltaMB)
                : heapTrend.sampleCount < MIN_SAMPLES_FOR_CLIMBING
                  ? t.opsMemTooFewSamples(heapTrend.sampleCount, MIN_SAMPLES_FOR_CLIMBING)
                  : t.opsMemStable}
              {t.opsMemSamples(heapTrend.sampleCount, diagnostics.host || t.opsThisSite)}
            </p>
            {(Object.keys(diagnosticCounterTotals).length > 0 || Object.keys(diagnostics.gauges).length > 0) && (
              <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 3, fontSize: 12, color: 'var(--fw-muted)', fontFamily: 'var(--fw-font-mono)' }}>
                {Object.entries(diagnosticCounterTotals).map(([k, v]) => (
                  <li key={`c-${k}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span>{k}</span><span>{formatCount(v, uiLang)}</span>
                  </li>
                ))}
                {Object.entries(diagnostics.gauges).map(([k, v]) => (
                  <li key={`g-${k}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span>{k}{t.opsPeakSuffix}</span><span>{formatCount(v, uiLang)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section style={{ ...sectionStyle, borderLeft: '3px solid var(--fw-border)' }}>
        <h3 style={headingStyle}>{t.opsScanTitle}</h3>
        <p style={lineStyle}>{t.opsScanSub}</p>

        {scanActivity === null ? (
          <p style={lineStyle}>{t.opsLoadingShort}</p>
        ) : scanActivity.totalScanned === 0 ? (
          <p style={lineStyle}>{t.opsNoScans}</p>
        ) : (
          <>
            <p style={lineStyle}>
              <strong style={{ color: 'var(--fw-text)' }}>{formatCount(scanActivity.totalScanned, uiLang)}</strong> {t.opsScannedWord} ·{' '}
              <strong style={{ color: 'var(--fw-text)' }}>{formatCount(scanActivity.actedOn, uiLang)}</strong> {t.opsActedWord(scanActivity.actedPct)} ·{' '}
              {t.opsLeftAsIs(formatCount(scanActivity.passed, uiLang))}
              {scanActivity.cancelled > 0 ? t.opsDidntFinish(formatCount(scanActivity.cancelled, uiLang)) : ''}
              {scanActivity.busiestHour !== null ? t.opsBusiest(String(scanActivity.busiestHour).padStart(2, '0')) : ''}.
            </p>
            {scanActivity.platforms.length > 0 && (
              <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 4, fontSize: 12, color: 'var(--fw-muted)' }}>
                {scanActivity.platforms.map(p => (
                  <li key={p.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span>{PLATFORM_LABEL[p.key] ?? p.key}</span>
                    <span>{t.opsPlatformScanRow(formatCount(p.scanned, uiLang), formatCount(p.actedOn, uiLang), p.actedPct)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {/* Timings exist only where timing capture is on, which a developer key turns on. Anyone else
          would read a flag name and stage ids with nothing they could do about them. */}
      {(captureV2MetricsEnabled === true || (perfSummary?.totalRecords ?? 0) > 0) && (
      <section data-fw-perf-timings style={{ ...sectionStyle, borderLeft: '3px solid var(--fw-border)' }}>
        <h3 style={headingStyle}>{t.opsPerfTitle}</h3>
        <p style={lineStyle}>{t.opsPerfSub}</p>

        {perfSummary === null || perfEmptyReason === null ? (
          <p style={lineStyle}>{t.opsLoadingShort}</p>
        ) : perfSummary.totalRecords === 0 || perfSummary.stages.length === 0 ? (
          // Distinguish "the flag is really off" from "the flag is on and
          // either nothing has run yet or writes are failing" — the panel
          // used to assert the flag was off unconditionally (2026-08-24),
          // which was actively wrong on a dev-tier build where the flag
          // auto-enables and every persist was failing silently.
          perfEmptyReason === 'flag-off' ? (
            <p style={lineStyle}>
              {t.opsPerfNoSamples1}<span style={{ fontFamily: 'var(--fw-font-mono)' }}>captureV2Metrics</span>{t.opsPerfNoSamples2}
            </p>
          ) : perfEmptyReason === 'flag-on-writes-failing' ? (
            <p style={{ ...lineStyle, color: 'var(--fw-red)' }}>
              {t.opsPerfOnWritesFailing(perfWriteFailures, perfWriteLastError)}
            </p>
          ) : (
            <p style={lineStyle}>{t.opsPerfOnNoData}</p>
          )
        ) : (
          <>
            <p style={lineStyle}>
              {t.opsPerfSamples(perfSummary.totalRecords, perfSummary.platforms.length > 0 ? perfSummary.platforms.map(p => PLATFORM_LABEL[p] ?? p).join(', ') : null)}
            </p>
            <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none', fontSize: 12 }}>
              {perfSummary.stages.map(perfStageRow)}
            </ul>
          </>
        )}
      </section>
      )}

      <section style={{
        ...sectionStyle,
        borderLeft: `3px solid ${
          forensicIntegrity?.verificationState === 'failed'
            ? 'var(--fw-red)'
            : forensicIntegrity?.verificationState === 'partial'
              ? 'var(--fw-amber)'
              : 'var(--fw-teal)'
        }`,
      }}>
        <h3 style={headingStyle}>{t.opsChainTitle}</h3>
        <p style={lineStyle}>{t.opsChainSub}</p>

        {forensicIntegrity === null ? (
          <p style={lineStyle}>{t.opsLoadingShort}</p>
        ) : forensicIntegrity.chainLength === 0 && forensicIntegrity.counts['pre-chain'] === 0 && forensicIntegrity.counts['pre-rekey'] === 0 ? (
          <p style={lineStyle}>{t.opsChainEmpty}</p>
        ) : (
          <>
            <p style={{
              ...lineStyle,
              color: forensicIntegrity.verificationState === 'verified'
                ? 'var(--fw-green)'
                : forensicIntegrity.verificationState === 'partial'
                  ? 'var(--fw-amber)'
                  : 'var(--fw-red)',
              fontWeight: 600,
            }}>
              ● {forensicIntegrity.verificationState === 'verified'
                ? t.opsChainVerified
                : forensicIntegrity.verificationState === 'partial'
                  ? t.opsChainPartial
                  : t.opsChainProblem(forensicIntegrity.brokenKind ?? 'unknown')}
              {t.opsChainCount(forensicIntegrity.chainLength)}
            </p>
            <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 3, fontSize: 12, color: 'var(--fw-muted)' }}>
              {forensicIntegrity.counts.verified > 0 && <li>{t.opsCountVerified(formatCount(forensicIntegrity.counts.verified, uiLang))}</li>}
              {forensicIntegrity.counts.unsigned > 0 && <li>{t.opsCountUnsigned(formatCount(forensicIntegrity.counts.unsigned, uiLang))}</li>}
              {forensicIntegrity.counts['pre-rekey'] > 0 && <li>{t.opsCountPreRekey(formatCount(forensicIntegrity.counts['pre-rekey'], uiLang))}</li>}
              {forensicIntegrity.counts['prior-key'] > 0 && <li>{t.opsCountPriorKey(formatCount(forensicIntegrity.counts['prior-key'], uiLang))}</li>}
              {forensicIntegrity.counts['pre-chain'] > 0 && <li>{t.opsCountPreChain(formatCount(forensicIntegrity.counts['pre-chain'], uiLang))}</li>}
              {forensicIntegrity.counts.broken > 0 && <li style={{ color: 'var(--fw-red)' }}>{t.opsCountBroken(formatCount(forensicIntegrity.counts.broken, uiLang))}</li>}
              {forensicIntegrity.uncheckedAfterBreak > 0 && <li>{t.opsUncheckedAfterBreak(forensicIntegrity.uncheckedAfterBreak)}</li>}
            </ul>
            <p style={{ ...lineStyle, marginTop: 8, color: forensicIntegrity.verificationState === 'verified' ? 'var(--fw-muted)' : 'var(--fw-text)' }}>
              {forensicIntegrity.verificationState === 'verified' ? t.opsChainVerifiedLine : forensicIntegrity.remediation}
            </p>
          </>
        )}
      </section>

      {healLog.length > 0 && (
        <section style={sectionStyle}>
          <h3 style={headingStyle}>{t.opsHealTitle}</h3>
          <p style={lineStyle}>{t.opsHealSub}</p>
          <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 3, fontSize: 12 }}>
            {healLog.map((e, i) => (
              <li key={`${e.at}-${i}`} style={{ color: e.healed ? 'var(--fw-green)' : 'var(--fw-red)' }}>
                {e.healed
                  ? t.opsHealHealed(formatDateTimeLocal(e.at, uiLang))
                  : t.opsHealFailed(formatDateTimeLocal(e.at, uiLang), e.error ?? '—')}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section style={sectionStyle}>
        <h3 style={headingStyle}>{t.opsHourlyTitle}</h3>
        <p style={{ ...lineStyle, marginBottom: 10 }}>{t.opsHourlySub}</p>

        <ul style={{ margin: '0 0 12px', padding: 0, listStyle: 'none', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12, color: 'var(--fw-muted)' }}>
          {/* The allowance and the provider's errors are the AI reading's; a free install is not offered it (ai-wording.ts). */}
          {offersReading(licenseTier) && <li><strong style={{ color: 'var(--fw-teal)' }}>{t.opsLegendCapTitle}</strong>{t.opsLegendCapBody}</li>}
          {offersReading(licenseTier) && <li><strong style={{ color: 'var(--fw-amber)' }}>{t.opsLegendLlmTitle}</strong>{t.opsLegendLlmBody}</li>}
          <li><strong style={{ color: 'var(--fw-amber)' }}>{t.opsLegendTruncTitle}</strong>{t.opsLegendTruncBody}</li>
          <li><strong style={{ color: 'var(--fw-amber)' }}>{t.opsLegendPurgedTitle}</strong>{t.opsLegendPurgedBody}</li>
        </ul>

        {capExhaustedTotal === 0 && llmFailureTotal === 0 && batchTruncatedTotal === 0 && scanPurgedTotal === 0 ? (
          <p style={{ ...lineStyle, padding: '12px 8px', textAlign: 'center', border: '1px solid var(--fw-line)', borderRadius: 0 }}>
            <span style={{ color: 'var(--fw-green)' }}>● </span>
            {t.opsAllQuiet}
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, color: 'var(--fw-muted)' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '4px 6px', borderBottom: `1px solid var(--fw-border)`, fontWeight: 500 }}>{t.opsColHour}</th>
                <th style={{ textAlign: 'right', padding: '4px 6px', borderBottom: `1px solid var(--fw-border)`, fontWeight: 500 }}>{t.opsLegendCapTitle}</th>
                <th style={{ textAlign: 'right', padding: '4px 6px', borderBottom: `1px solid var(--fw-border)`, fontWeight: 500 }}>{t.opsLegendLlmTitle}</th>
                <th style={{ textAlign: 'right', padding: '4px 6px', borderBottom: `1px solid var(--fw-border)`, fontWeight: 500 }}>{t.opsLegendTruncTitle}</th>
                <th style={{ textAlign: 'right', padding: '4px 6px', borderBottom: `1px solid var(--fw-border)`, fontWeight: 500 }}>{t.opsLegendPurgedTitle}</th>
              </tr>
            </thead>
            <tbody>
              {buckets.filter(b => b.total > 0).map(b => {
                const capTotal = b.capExhausted.daily + b.capExhausted.monthly + b.capExhausted.tierFree;
                const llmTotal = Object.values(b.llmFailure).reduce((s, n) => s + (n ?? 0), 0);
                const cell = { padding: '4px 6px', borderBottom: `1px solid var(--fw-border)` };
                return (
                  <tr key={b.bucketStartMs}>
                    <td style={cell}>
                      {hourLabel(b.bucketStartMs)}
                    </td>
                    <td style={{ ...cell, textAlign: 'right' }}>{capTotal || ''}</td>
                    <td style={{ ...cell, textAlign: 'right' }}>{llmTotal || ''}</td>
                    <td style={{ ...cell, textAlign: 'right' }}>{b.batchTruncated || ''}</td>
                    <td style={{ ...cell, textAlign: 'right' }}>{b.scanPurged || ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      </details>
    </div>
  );
}

