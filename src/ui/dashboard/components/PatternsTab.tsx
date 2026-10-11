// src/ui/dashboard/components/PatternsTab.tsx
// Surface-ID: patterns-tab
//
// Sequence-analysis slice 3 (docs/research/SEQUENCE_ANALYSIS_DESIGN.md):
// the minimal Patterns surface — predominant themes + cross-day themes,
// with drill-down to the member records from day one. Render-only: all
// grouping comes from src/forensics/topics.ts (deterministic, on-device).
//
// COPY RULES (binding — design doc §UI):
//   • Subject is "the feed served / N items appeared" — never "the
//     algorithm decided/targets/wants".
//   • Every number names its denominator and date range.
//   • Every aggregate clicks down to its member records.
//   • Theme labels are quoted record words, marked as such.
//   • No emotion/intent adjectives. Litmus: every sentence must be
//     verifiable by re-reading the listed records and nothing else.

import * as React from 'react';
import { TONE } from '../house-tones';
import type { ForensicRecord } from '../../../types/forensic';
import { buildThemes, type Theme } from '../../../forensics/topics';
import { crossDayThemes, predominantThemes } from '../../../forensics/themes';
import { computeReservePatterns, computeTemplatePatterns, type ReserveInstance } from '../../../forensics/reserve';
import { isPaidPlacement } from '../../../forensics/paid-placement';
import { computeNarrativePressureSignals, type NarrativePressureSignals, type PlatformNarrativePressure } from '../../../forensics/sequence';
import { computePlatformSwitches, type PlatformSwitchSignal } from '../../../forensics/platform-switch';
import { readThemeCache, writeThemeCache } from '../../../forensics/theme-cache';
import { buildSwearLeagueTable, type SwearLeagueEntry } from './lexical-diet';
import { buildFeedComposition, type CompositionEntry } from './feed-composition';
import { buildFeedTone, type FeedTone } from './feed-tone';
import { computeFeedBehavior } from './feed-behavior-data';
import { FeedBehaviorLensBar, FeedBehaviorPanels } from './FeedBehaviorPanels';
import { PatternSection } from './PatternSection';
import { useDashboardT, useUiLanguage } from '../../../i18n/react';
import { formatDecimal } from '../../shared/format-number';
import { dayKeyAsLocalDate, formatDateLocal, formatDateTimeLocal, formatWeekdayNarrow, localDayKey } from '../../shared/format-time';
import { ArchivesPendingNote } from './ArchivesPendingNote';
import { shownText } from '../shown-text';
import type { FeedBehaviorLens } from '../../../i18n/dashboard-strings';

const PLATFORM_LABEL: Record<string, string> = {
  twitter: 'X', facebook: 'Facebook', instagram: 'Instagram',
  tiktok: 'TikTok', youtube: 'YouTube',
};

// Platform → CSS-token color for the per-theme platform dots (matches the
// new design's colored-dot row; tokens defined in src/ui/shared/tokens.css).
const PLATFORM_COLOR: Record<string, string> = {
  twitter: 'var(--fw-platform-twitter)',
  facebook: 'var(--fw-platform-facebook)',
  instagram: 'var(--fw-platform-instagram)',
  tiktok: 'var(--fw-platform-tiktok)',
  youtube: 'var(--fw-platform-youtube)',
};

const MS_PER_DAY = 86_400_000;

type RangeKey = 'week' | 'fourWeeks';
const RANGE_DAYS: Record<RangeKey, number> = { week: 7, fourWeeks: 28 };

/**
 * The reader's own calendar day.
 *
 * It cut ts.slice(0, 10) until 2026-09-18, which is UTC, while the Overview
 * beside it has cut local since the clock pass. The same two serves were one
 * day on one tab and two on the other, the range filter below DROPPED records
 * by comparing a UTC key against a UTC cut of a local instant, and the streak
 * grid's seven columns were indexed by one definition while the theme's own
 * perDayCounts were built on the other.
 */
const isoDay = localDayKey;

interface ThemesResult {
  themes: Theme[];
  assignment: Map<string, string>;
  fingerprintCount: number;
  /** The windowed record list these themes were computed over. */
  forWindow: ForensicRecord[];
}

/**
 * Most-recent record timestamp across the set (anchors the date-range window
 * + the 7-day streak grid). Empty set → null.
 */
function latestTimestamp(records: ForensicRecord[]): string | null {
  if (records.length === 0) return null;
  let latest = records[0].timestamp;
  for (const r of records) if (r.timestamp > latest) latest = r.timestamp;
  return latest;
}

export function PatternsTab({ records, archivesPending, readingOffered = true }: {
  records: ForensicRecord[];
  /** Tone and composition are the AI's reading; a free install, which is not offered it, never sees those panels (ai-wording.ts). */
  readingOffered?: boolean;
  /** The archived months are still being read; the window below covers the active chain only until they land. */
  archivesPending?: boolean;
}) {
  const t = useDashboardT();
  const lang = useUiLanguage();
  const [computed, setResult] = React.useState<ThemesResult | null>(null);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [range, setRange] = React.useState<RangeKey>('week');
  const [lens, setLens] = React.useState<FeedBehaviorLens>('parent');

  // Window the record set to the selected date range BEFORE computing themes,
  // anchored to the most recent record (not wall-clock — the dashboard reads a
  // saved chain that may not be "today"). Recompute when the toggle flips.
  const anchor = React.useMemo(() => latestTimestamp(records), [records]);
  const windowed = React.useMemo(() => {
    if (anchor === null) return records;
    const anchorMs = Date.parse(anchor);
    if (!Number.isFinite(anchorMs)) return records;
    const cutoff = anchorMs - (RANGE_DAYS[range] - 1) * MS_PER_DAY;
    const cutoffDay = isoDay(cutoff);
    return records.filter((r) => isoDay(r.timestamp) >= cutoffDay);
  }, [records, anchor, range]);

  // Q41 (W48): a compute failure must not wear the empty state. "Not enough
  // recorded content yet" over 400 records because IDB or crypto threw is a
  // false claim about the child's feed.
  const [computeFailed, setComputeFailed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setComputeFailed(false);
    (async () => {
      // Sidecar cache (slice 4): instant on repeat opens; any change to the
      // record set or the algorithm version recomputes from scratch.
      const cached = await readThemeCache(windowed);
      if (cached) {
        if (!cancelled) setResult({ themes: cached.themes, assignment: cached.assignment, fingerprintCount: cached.fingerprintCount, forWindow: windowed });
        return;
      }
      const r = await buildThemes(windowed, { dayKeyOf: isoDay });
      if (cancelled) return;
      setResult({ themes: r.themes, assignment: r.assignment, fingerprintCount: r.fingerprintCount, forWindow: windowed });
      void writeThemeCache(windowed, r.themes, r.assignment, r.fingerprintCount);
    })().catch((e) => {
      console.error('[fw] patterns compute failed', e);
      if (!cancelled) {
        setComputeFailed(true);
        setResult({ themes: [], assignment: new Map(), fingerprintCount: 0, forWindow: windowed });
      }
    });
    return () => { cancelled = true; };
  }, [windowed]);

  // Themes computed for another range are not shown under this one: after a
  // range toggle the previous themes, and their member records from outside the
  // new range, stood under the new dates until the recompute landed (wiring
  // audit 13 Sep, D2-26). Until then the tab says it is computing.
  const result = computed && computed.forWindow === windowed ? computed : null;

  // Every list and drill on this tab resolves ids against the WINDOWED records,
  // so nothing outside the selected range can be opened from it (D2-26).
  const byId = React.useMemo(() => {
    const m = new Map<string, ForensicRecord>();
    for (const r of windowed) m.set(r.id, r);
    return m;
  }, [windowed]);

  // The lexical league is a synchronous, deterministic read of the windowed
  // chain — it does NOT wait on the async theme compute, so it renders
  // immediately above the theme sections (which stream in below).
  const league = React.useMemo(() => buildSwearLeagueTable(windowed), [windowed]);

  // Feed composition (topic + format labels) is likewise a synchronous,
  // deterministic read of labels already stored on the windowed chain.
  const composition = React.useMemo(() => buildFeedComposition(windowed), [windowed]);

  // Feed tone — deterministic aggregate of the room sentiment already on the
  // chain; answers "was the feed only negative?" (also synchronous).
  const tone = React.useMemo(() => buildFeedTone(windowed), [windowed]);

  // Feed behavior (the deep half): runs, in-sitting skew, quiet-gap returns,
  // amplification, technique hand-offs, recurring voices, and the rule-gated
  // cautious reading. Deterministic and synchronous over the windowed chain.
  const behavior = React.useMemo(() => computeFeedBehavior(windowed), [windowed]);
  // Platform switches (capability audit 2026-09-06, P1 item 6): pure over the
  // windowed chain, time order, the Statistics content and flag rule.
  const switches = React.useMemo(() => computePlatformSwitches(windowed), [windowed]);

  const themes = result?.themes ?? [];
  const themeLabels = React.useMemo(() => new Map(themes.map((theme) => [theme.id, theme.label])), [themes]);
  const narrative = React.useMemo(() => result
    ? computeNarrativePressureSignals(windowed, {
        themeAssignment: result.assignment,
        themeLabels,
      })
    : null,
  [windowed, result, themeLabels]);
  const top = predominantThemes(themes);
  const recurring = crossDayThemes(themes);
  // Memoised like its neighbours: it walked the whole window on every render (D2-23).
  // dayKeyOf: the two panels print "across N days"; N is N of the reader's own
  // days, the same ones the Overview's columns count (2026-09-18).
  const reserves = React.useMemo(() => computeReservePatterns(windowed, { top: 8, dayKeyOf: isoDay }), [windowed]);
  const templates = React.useMemo(() => computeTemplatePatterns(windowed, { top: 8, dayKeyOf: isoDay }), [windowed]);
  const start = windowed.length ? isoDay(windowed.reduce((a, r) => (r.timestamp < a ? r.timestamp : a), windowed[0].timestamp)) : '';
  const end = windowed.length ? isoDay(windowed.reduce((a, r) => (r.timestamp > a ? r.timestamp : a), windowed[0].timestamp)) : '';

  // Sunday-anchored 7-day window for the per-theme streak grid, ending on the
  // week that contains the most recent record (design: "Day squares run Sunday
  // to Saturday").
  const weekDays: string[] = [];
  if (anchor !== null) {
    // Stepped as CALENDAR dates, not as milliseconds: a local day is 23 or 25
    // hours on a transition day, so adding 86,400,000 seven times lands on the
    // wrong date for a reader whose clock moved that week. dayKeyAsLocalDate
    // anchors at local noon, the only hour that survives every offset.
    const anchorDate = dayKeyAsLocalDate(isoDay(anchor));
    for (let i = 0; i < 7; i++) {
      const d = new Date(anchorDate);
      d.setDate(d.getDate() - anchorDate.getDay() + i);
      weekDays.push(isoDay(d));
    }
  }

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };


  const segBase: React.CSSProperties = {
    padding: '5px 12px', fontSize: 12, borderRadius: 0, border: 'none',
    background: 'transparent', color: 'var(--fw-muted)', cursor: 'pointer',
  };
  const segActive: React.CSSProperties = {
    ...segBase, fontWeight: 600, background: 'var(--fw-trust-bar-bg)', color: 'var(--fw-text)',
  };

  return (
    <div>
      <ArchivesPendingNote pending={archivesPending} />
      <div className="fb-head" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <div className="fb-range" style={{
          display: 'flex', gap: 2, background: 'var(--fw-card)',
          border: '1px solid var(--fw-border)', borderRadius: 2, padding: 3,
        }}>
          <button
            type="button"
            onClick={() => setRange('week')}
            style={range === 'week' ? segActive : segBase}
          >
            {t.patDays(RANGE_DAYS.week)}
          </button>
          <button
            type="button"
            onClick={() => setRange('fourWeeks')}
            style={range === 'fourWeeks' ? segActive : segBase}
          >
            {t.patDays(RANGE_DAYS.fourWeeks)}
          </button>
        </div>
        <span style={{ flex: 1 }} />
        <p className="fb-intro" style={{ fontSize: 13, margin: 0 }}>
          {t.patIntro(windowed.length, start && formatDateLocal(dayKeyAsLocalDate(start), lang), end && formatDateLocal(dayKeyAsLocalDate(end), lang))}
        </p>
      </div>

      {behavior !== null && (
        <>
          <FeedBehaviorLensBar lens={lens} onChange={setLens} />
          <FeedBehaviorPanels model={behavior} lens={lens} />
        </>
      )}

      {readingOffered && <FeedTonePanel tone={tone} />}

      {readingOffered && (
        <FeedCompositionPanel
          composition={composition}
          byId={byId}
          days={RANGE_DAYS[range]}
          endLabel={anchor ? formatDateLocal(anchor, lang) : ''}
        />
      )}

      <LexicalLeague
        entries={league}
        byId={byId}
        start={start ? formatDateLocal(dayKeyAsLocalDate(start), lang) : ''}
        end={end ? formatDateLocal(dayKeyAsLocalDate(end), lang) : ''}
      />

      {result === null ? (
        <p style={{ color: 'var(--fw-muted)', fontSize: 13 }}>{t.patComputing}</p>
      ) : (
      <>
      <NarrativePressurePanel signals={narrative} />
      <PlatformSwitchPanel signal={switches} />

      <PatternSection
        title={t.patThemesTitle}
        sub={t.patThemesSub}
        empty={!computeFailed && top.length === 0 ? t.patEmpty : undefined}
      >
        {computeFailed ? (
          <p style={{ fontSize: 13, color: 'var(--fw-amber)' }}>{t.patComputeFailed}</p>
        ) : top.length === 0 ? (
          <></>
        ) : (
          top.map((theme) => (
            <ThemeCard
              key={theme.id}
              theme={theme}
              byId={byId}
              weekDays={weekDays}
              expanded={expanded.has(theme.id)}
              onToggle={() => toggle(theme.id)}
            />
          ))
        )}
      </PatternSection>

      <PatternSection
        title={t.patReserveTitle}
        sub={t.patReserveSub}
        empty={reserves.length === 0 ? t.patReserveEmpty : undefined}
      >
        {reserves.length === 0 ? (
          <></>
        ) : (
          <>
            {reserves.map((r) => (
              <ReserveRow key={r.contentHash} instance={r} byId={byId} />
            ))}
            {/* Level 2 lens caption (the re-serve panel is the pressure
                surface the Feed behavior lens bar also speaks to). */}
            <div className="fb-lens-cap">{t.fbReserveCap(lens)}</div>
          </>
        )}
      </PatternSection>

      <PatternSection
        title={t.patTemplateTitle}
        sub={t.patTemplateSub}
        empty={templates.length === 0 ? t.patTemplateEmpty : undefined}
      >
        {templates.length === 0 ? (
          <></>
        ) : (
          templates.map((r) => (
            <ReserveRow key={r.templateKey} instance={r} byId={byId}
              line={t.patTemplateLine(r.serveCount, r.distinctDays, r.variants)} />
          ))
        )}
      </PatternSection>

      <PatternSection
        title={t.patCrossDayTitle}
        sub={t.patCrossDaySub}
        empty={recurring.length === 0 ? t.patCrossDayEmpty : undefined}
      >
        {recurring.length === 0 ? (
          <></>
        ) : (
          recurring.map((theme) => (
            <div key={theme.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--fw-border)', fontSize: 13 }}>
              {/* Accessibility audit found 2026-09-18: RO/PT-BR theme labels and
                  the cross-day sentence run 1.2-3x the English length, so the
                  fixed-width ellipsis clip and the forced single line were
                  cutting or overflowing translated content. Both now wrap;
                  the row grows instead of losing the text. */}
              <span style={{ fontWeight: 600, flex: 1, minWidth: 0 }}>{theme.label}</span>
              <StreakGrid perDayCounts={theme.perDayCounts} weekDays={weekDays} />
              <span style={{ color: 'var(--fw-muted)' }}>
                {t.patCrossDayLine(theme.daysActive, theme.recordCount)}
              </span>
            </div>
          ))
        )}
      </PatternSection>
      </>
      )}

      {/* Honesty footer — moved to the bottom per the redesign (the page opens
          with the data, closes with the caveat). */}
      <p style={{ fontSize: 12, color: 'var(--fw-muted)', padding: '0 2px', margin: 0 }}>{t.patHonesty}</p>
    </div>
  );
}

function PlatformSwitchPanel({ signal }: { signal: PlatformSwitchSignal }) {
  const t = useDashboardT();
  const label = (p: string) => PLATFORM_LABEL[p] ?? p;
  const share = (sh: PlatformSwitchSignal['window']) =>
    sh ? t.patSwitchShare(sh.k, sh.n, sh.pct, sh.lowerPct, sh.upperPct) : null;
  return (
    <PatternSection
      title={t.patSwitchTitle}
      sub={t.patSwitchSub}
      empty={signal.switches === 0 ? t.patSwitchEmpty : undefined}
    >
      {signal.switches === 0 ? (
        <></>
      ) : (
        <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
          <div><strong>{t.patSwitchCount(signal.switches, signal.content)}</strong></div>
          <div style={{ color: 'var(--fw-text-secondary)', fontFamily: 'var(--fw-font-mono)', fontSize: 12 }}>
            {signal.pairs.slice(0, 6).map((p) => t.patSwitchPair(label(p.from), label(p.to), p.count)).join(' · ')}
          </div>
          <div>
            <span style={{ color: 'var(--fw-muted)' }}>{t.patSwitchWindow(signal.windowSize)}: </span>
            {share(signal.window)}
          </div>
          <div>
            <span style={{ color: 'var(--fw-muted)' }}>{t.patSwitchBaseline}: </span>
            {share(signal.baseline)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--fw-muted)' }}>{t.patSwitchNote}</div>
        </div>
      )}
    </PatternSection>
  );
}

function NarrativePressurePanel({ signals }: { signals: NarrativePressureSignals | null }) {
  const t = useDashboardT();
  const platforms = signals?.platforms.slice(0, 5) ?? [];

  return (
    <PatternSection
      title={t.patPressureTitle}
      sub={t.patPressureSub}
      empty={platforms.length === 0 ? t.patPressureEmpty : undefined}
    >
      {platforms.length === 0 ? (
        <></>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {platforms.map((p) => (
            <NarrativePressurePlatform key={p.platform} platform={p} />
          ))}
        </div>
      )}
    </PatternSection>
  );
}

function NarrativePressurePlatform({ platform }: { platform: PlatformNarrativePressure }) {
  const t = useDashboardT();
  const lang = useUiLanguage();
  const escalation = platform.escalatingMotifs[0] ?? null;
  const gap = platform.quietGapReturns[0] ?? null;
  const collapse = platform.diversityCollapse;
  const volatility = platform.triggerVolatility;
  const platformLabel = PLATFORM_LABEL[platform.platform] ?? platform.platform;
  const entropyLine = collapse.startEntropy === null || collapse.endEntropy === null
    ? t.patPressureEntropyPending(collapse.windowSize)
    : t.patPressureEntropy(formatDecimal(collapse.dropFromStart, lang, 2), collapse.windowSize);

  return (
    <div style={{ borderTop: '1px solid var(--fw-border)', paddingTop: 9, fontSize: 13 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ width: 7, height: 7, borderRadius: 0, background: PLATFORM_COLOR[platform.platform] ?? 'var(--fw-muted)' }} />
        <strong>{platformLabel}</strong>
        <span style={{ color: 'var(--fw-muted)', fontFamily: 'var(--fw-font-mono)', fontSize: 12 }}>
          {t.patPressureExposureCount(platform.exposureCount)}
        </span>
      </div>
      <div style={{ display: 'grid', gap: 4, marginTop: 7, color: 'var(--fw-text-secondary)' }}>
        <span>
          <strong style={{ color: 'var(--fw-text)' }}>{t.patPressureEscLabel}</strong>
          {escalation
            ? t.patPressureEscalation(escalation.motifLabel, formatDecimal(escalation.delta, lang, 1), escalation.count)
            : t.patPressureNoEscalation}
        </span>
        <span>
          <strong style={{ color: 'var(--fw-text)' }}>{t.patPressureEntropyLabel}</strong>
          {entropyLine}
        </span>
        <span>
          <strong style={{ color: 'var(--fw-text)' }}>{t.patPressureGapLabel}</strong>
          {gap
            ? t.patPressureGap(gap.motifLabel, Math.round(gap.gapHours))
            : t.patPressureNoGap}
        </span>
        <span>
          <strong style={{ color: 'var(--fw-text)' }}>{t.patPressureSwitchLabel}</strong>
          {t.patPressureSwitch(
            Math.round(volatility.switchRate * 100),
            volatility.switchCount,
            volatility.transitionCount,
          )}
        </span>
      </div>
    </div>
  );
}

/**
 * 7 grid squares (Sun→Sat) for the week containing the most recent record.
 * A square is "active" (teal) when that day had >=1 member record. Derived
 * from theme.perDayCounts (ISO-day keyed) — no fabricated data.
 */
function StreakGrid({ perDayCounts, weekDays }: { perDayCounts: Record<string, number>; weekDays: string[] }) {
  const lang = useUiLanguage();
  if (weekDays.length === 0) return null;
  return (
    <span style={{ display: 'flex', gap: 3 }} aria-hidden="true">
      {weekDays.map((day, i) => {
        const active = (perDayCounts[day] ?? 0) > 0;
        return (
          <span
            key={day}
            title={formatWeekdayNarrow(dayKeyAsLocalDate(day), lang)}
            style={{
              width: 12, height: 12, borderRadius: 0,
              background: active ? 'var(--fw-teal)' : 'var(--fw-border)',
              opacity: active ? 0.8 : 1,
            }}
          />
        );
      })}
    </span>
  );
}

/**
 * Colored severity-coded technique chip (matches the new design's
 * "fear appeal" / "false urgency" pills). Red >= 7, amber >= 4, neutral below.
 */
function TechniqueChip({ name, severity }: { name: string; severity: number }) {
  // The chip says the technique in the reader's words, the same ones every panel uses; the id is a code.
  const t = useDashboardT();
  let dot = 'var(--fw-muted)';
  let cls = 'fc-ai-tag';
  if (severity >= 7) { dot = TONE.ink; cls = 'fc-ai-tag neg'; }
  else if (severity >= 4) { dot = TONE.mid; }
  return (
    <span className={cls} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 6, height: 6, borderRadius: 0, background: dot }} />
      {t.techniqueLabel(name)}
    </span>
  );
}

/** Platform color dots for a theme's platform mix (replaces the text list). */
function PlatformDots({ platforms }: { platforms: Record<string, number> }) {
  const ordered = Object.entries(platforms).sort((a, b) => b[1] - a[1]);
  if (ordered.length === 0) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      {ordered.map(([p]) => (
        <span
          key={p}
          title={`${PLATFORM_LABEL[p] ?? p} · ${platforms[p]}`}
          style={{ width: 6, height: 6, borderRadius: 0, background: PLATFORM_COLOR[p] ?? 'var(--fw-muted)' }}
        />
      ))}
    </span>
  );
}

/** Monospace #chainPosition record-id chip; placeholder when not chain-linked. */
function ChainPositionChip({ record }: { record: ForensicRecord }) {
  const linked = typeof record.chainPosition === 'number' && record.chainPosition >= 0;
  return (
    <span
      style={{
        fontFamily: 'var(--fw-font-mono)', fontSize: 12,
        color: linked ? 'var(--fw-text-secondary)' : 'var(--fw-muted)',
        border: '1px solid var(--fw-border)', borderRadius: 0,
        padding: '1px 6px', whiteSpace: 'nowrap',
      }}
    >
      {linked ? `#${record.chainPosition}` : '#—'}
    </span>
  );
}

function ReserveRow({ instance, byId, line }: { instance: ReserveInstance; byId: Map<string, ForensicRecord>; line?: string }) {
  const lang = useUiLanguage();
  const t = useDashboardT();
  const [expanded, setExpanded] = React.useState(false);
  const topTechnique = instance.techniqueProfile[0] ?? null;
  // A row with no name reads as the timeline card does: an ad as an ad, anything else as an unknown author.
  const first = byId.get(instance.recordIds[0]);
  const named = instance.author.trim() !== '' && instance.author.toLowerCase() !== 'unknown';
  const who = named ? instance.author : first && isPaidPlacement(first) ? t.feedAdAuthorNotShown : t.feedUnknownAuthor;
  // First-serve epoch (ms) for the "+N days later" deltas in the expanded list.
  const firstMs = instance.timestamps.length ? Date.parse(instance.timestamps[0]) : NaN;
  return (
    <div style={{ borderTop: '1px solid var(--fw-border)', padding: '8px 0', fontSize: 13 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, flex: 1, minWidth: 0 }}>
          <span style={{ width: 6, height: 6, borderRadius: 0, background: PLATFORM_COLOR[instance.platform] ?? 'var(--fw-muted)', flex: '0 0 auto' }} />
          {/* Accessibility audit found 2026-09-18: fixed-width ellipsis clip
              and forced single line on the author/sample text and the reserve
              sentence, both of which run longer in RO/PT-BR than English. */}
          <span>
            <strong>{who}</strong>
            {instance.sampleText && <span style={{ color: 'var(--fw-muted)' }}> · {instance.sampleText.slice(0, 90)}</span>}
          </span>
        </span>
        {topTechnique && <TechniqueChip name={topTechnique.name} severity={topTechnique.maxSeverity} />}
        <span style={{ fontFamily: 'var(--fw-font-mono)', color: 'var(--fw-muted)', fontSize: 12 }}>
          {line ?? t.patReserveLine(instance.serveCount, instance.distinctDays)}
        </span>
      </div>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        style={{ marginTop: 4, fontSize: 12, color: 'var(--fw-teal)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline' }}
      >
        {expanded ? t.patHideRecords : t.patShowRecords}
      </button>
      {expanded && (
        <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 6, borderLeft: '2px solid var(--fw-border)', paddingLeft: 12 }}>
          {instance.recordIds.map((rid, i) => {
            const r = byId.get(rid);
            const url = r?.postUrl && /^https?:\/\//.test(r.postUrl) ? r.postUrl : null;
            const ms = Date.parse(instance.timestamps[i] ?? '');
            // Whole-day delta from the first serve. Day 0 = "first serve".
            const dayDelta = Number.isFinite(ms) && Number.isFinite(firstMs)
              ? Math.round((ms - firstMs) / MS_PER_DAY)
              : null;
            return (
              <li key={rid} style={{ display: 'flex', gap: 10, fontSize: 12, alignItems: 'baseline' }}>
                {r && <ChainPositionChip record={r} />}
                <span style={{ fontFamily: 'var(--fw-font-mono)', fontSize: 12, color: 'var(--fw-muted)', whiteSpace: 'nowrap' }}>
                  {formatDateTimeLocal(instance.timestamps[i] ?? '', lang)}
                </span>
                {/* Language-neutral serve-delta token (no prose → no new i18n
                    key): first serve = +0d, later serves = +Nd from first. */}
                <span style={{ fontFamily: 'var(--fw-font-mono)', fontSize: 12, color: 'var(--fw-text-secondary)', whiteSpace: 'nowrap' }}>
                  {dayDelta !== null ? `+${dayDelta}d` : ''}
                </span>
                <span style={{ flex: 1 }} />
                {url && (
                  <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--fw-teal)', fontSize: 12 }}>
                    {t.patOpenPost}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ThemeCard({
  theme, byId, weekDays, expanded, onToggle,
}: {
  theme: Theme;
  byId: Map<string, ForensicRecord>;
  weekDays: string[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const t = useDashboardT();
  const lang = useUiLanguage();

  return (
    <div style={{ borderTop: '1px solid var(--fw-border)', padding: '10px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{theme.label}</span>
        <PlatformDots platforms={theme.platforms} />
        <span style={{ flex: 1 }} />
        <StreakGrid perDayCounts={theme.perDayCounts} weekDays={weekDays} />
        {/* Accessibility audit found 2026-09-18: forced single line on a
            two-sentence translated string overflows in RO/PT-BR. */}
        <span style={{ fontFamily: 'var(--fw-font-mono)', color: 'var(--fw-text-secondary)', fontSize: 12 }}>
          {t.patItems(theme.recordCount)} · {t.patDays(theme.daysActive)}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12, color: 'var(--fw-muted)', marginTop: 4, alignItems: 'center' }}>
        <span>{formatDateLocal(dayKeyAsLocalDate(isoDay(theme.dateSpan.start)), lang)} – {formatDateLocal(dayKeyAsLocalDate(isoDay(theme.dateSpan.end)), lang)}</span>
        {theme.flaggedCount > 0 && (
          <span style={{ color: 'var(--fw-amber)' }}>
            {t.patFlaggedShare(theme.flaggedCount, theme.recordCount)}
          </span>
        )}
        <span style={{ color: 'var(--fw-muted)' }}>{t.patGroupedBy}</span>
        {theme.topTerms.slice(0, 5).map((term) => (
          <span key={term.term} style={{
            display: 'inline-block', padding: '0 7px',
            border: '1px solid var(--fw-border)', borderRadius: 2,
            fontStyle: term.kind === 'word' ? 'normal' : 'italic',
          }}>
            {term.term}
          </span>
        ))}
      </div>
      <button
        type="button"
        onClick={onToggle}
        style={{
          marginTop: 6, fontSize: 12, color: 'var(--fw-teal)', background: 'none',
          border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline',
        }}
      >
        {expanded ? t.patHideRecords : t.patShowRecords}
      </button>
      {expanded && (
        <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 5, borderLeft: '2px solid var(--fw-border)', paddingLeft: 12 }}>
          {theme.memberRecordIds.map((rid) => {
            const r = byId.get(rid);
            if (!r) return null;
            const url = r.postUrl && /^https?:\/\//.test(r.postUrl) ? r.postUrl : null;
            return (
              <li key={rid} style={{ display: 'flex', gap: 10, fontSize: 12, alignItems: 'baseline' }}>
                <ChainPositionChip record={r} />
                <span style={{ fontFamily: 'var(--fw-font-mono)', fontSize: 12, color: 'var(--fw-muted)', whiteSpace: 'nowrap' }}>
                  {formatDateTimeLocal(r.timestamp, lang)}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--fw-muted)', fontSize: 12, whiteSpace: 'nowrap' }}>
                  <span style={{ width: 6, height: 6, borderRadius: 0, background: PLATFORM_COLOR[r.platform] ?? 'var(--fw-muted)' }} />
                  {PLATFORM_LABEL[r.platform] ?? r.platform}
                </span>
                {/* Accessibility audit found 2026-09-18: the fixed-width
                    ellipsis clip on this line hid overflowing text instead of
                    wrapping it; removed here for the same reason as the
                    theme-label and reserve-row instances above. */}
                <span style={{ flex: 1, minWidth: 0, color: 'var(--fw-text)' }}>
                  {shownText(r, lang).slice(0, 140)}
                </span>
                {url && (
                  <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--fw-teal)', fontSize: 12, whiteSpace: 'nowrap' }}>
                    {t.patOpenPost}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * The deterministic lexical league — profanity/slur terms counted verbatim over
 * the windowed chain (data layer: lexical-diet.ts). Terms render in mono (the
 * "quoted record words, marked as such" Patterns copy convention) and each row
 * drills down to its member records. No emotion/intent framing: every number is
 * re-verifiable by reading the listed records and nothing else.
 */
function LexicalLeague({
  entries, byId, start, end,
}: {
  entries: SwearLeagueEntry[];
  byId: Map<string, ForensicRecord>;
  start: string;
  end: string;
}) {
  const t = useDashboardT();
  return (
    <PatternSection
      title={t.patLexTitle}
      sub={t.patLexSub}
      empty={entries.length === 0 ? t.patLexEmpty : undefined}
    >
      {entries.length === 0 ? (
        <></>
      ) : (
        <>
          {entries.map((e) => (
            <LexLeagueRow key={`${e.tier}:${e.term}`} entry={e} byId={byId} />
          ))}
          {start && (
            <p style={{ fontSize: 12, color: 'var(--fw-muted)', margin: '8px 0 0' }}>{start} – {end}</p>
          )}
        </>
      )}
    </PatternSection>
  );
}

/**
 * Feed tone — the aggregate positive/neutral/negative split of the comment
 * rooms FeelingWise read (data layer: feed-tone.ts). Directly answers "was the
 * feed only negative?" from sentiment already on the chain. AI-interpretation,
 * comment-weighted, framed as the rooms' tone (never the child's mood).
 */
function FeedTonePanel({ tone }: { tone: FeedTone }) {
  const t = useDashboardT();
  const bands: Array<{ pct: number; label: string; color: string }> = [
    { pct: tone.positivePct, label: t.patTonePositive, color: TONE.light },
    { pct: tone.neutralPct, label: t.patToneNeutral, color: TONE.mid },
    { pct: tone.negativePct, label: t.patToneNegative, color: TONE.ink },
  ];
  return (
    <PatternSection
      title={t.patToneTitle}
      sub={t.patToneSub}
      empty={!tone.hasData ? t.patToneEmpty : undefined}
    >
      {!tone.hasData ? (
        <></>
      ) : (
        <>
          <div style={{ display: 'flex', height: 14, borderRadius: 0, overflow: 'hidden', border: '1px solid var(--fw-border)' }}>
            {bands.map((b) => b.pct > 0 && (
              <div key={b.label} style={{ width: `${b.pct}%`, background: b.color }} title={`${b.label} ${b.pct}%`} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
            {bands.map((b) => (
              <span key={b.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <span style={{ width: 9, height: 9, borderRadius: 0, background: b.color }} />
                <strong style={{ fontFamily: 'var(--fw-font-mono)' }}>{b.pct}%</strong>
                <span style={{ color: 'var(--fw-muted)' }}>{b.label}</span>
              </span>
            ))}
          </div>
          <p style={{ fontSize: 12, color: 'var(--fw-muted)', margin: '8px 0 0' }}>
            {t.patToneCoverage(tone.rooms, tone.commentsScored)}
          </p>
        </>
      )}
    </PatternSection>
  );
}

/**
 * Feed composition — the two content-label axes (topic + format) tallied over
 * the windowed chain (data layer: feed-composition.ts). Both axes are AI
 * interpretation from closed vocabularies, framed as such; the coverage line
 * names how much of the record set carries any label at all, so the panel
 * never implies the whole feed was classified.
 */
function FeedCompositionPanel({
  composition, byId, days, endLabel,
}: {
  composition: ReturnType<typeof buildFeedComposition>;
  byId: Map<string, ForensicRecord>;
  /** The range the tab is windowed to, which ends at the newest entry, not today. */
  days: number;
  endLabel: string;
}) {
  const t = useDashboardT();
  const headStyle: React.CSSProperties = {
    fontSize: 12, letterSpacing: 0.5,
    color: 'var(--fw-muted)', margin: '10px 0 2px',
  };
  const empty = composition.topics.length === 0
    && composition.formats.length === 0
    && composition.rooms.length === 0;
  return (
    <PatternSection
      title={t.patCompTitle}
      sub={t.patCompSub}
      empty={empty && composition.eligible === 0 ? t.patCompEmpty : undefined}
    >
      {composition.eligible > 0 && (
        <p style={{ fontSize: 12, color: 'var(--fw-text-secondary)', margin: '0 0 2px' }}>
          {t.patCompCoverage(composition.labeled, composition.eligible, composition.roomSummaries, days, endLabel)}
        </p>
      )}
      <p style={{ fontSize: 12, color: 'var(--fw-muted)', margin: '0 0 6px' }}>{t.patCompNotYet}</p>
      {empty ? (
        <p style={{ fontSize: 13, color: 'var(--fw-muted)' }}>{t.patCompEmpty}</p>
      ) : (
        <>
          {composition.topics.length > 0 && (
            <>
              <p style={headStyle}>{t.patCompTopicsHead}</p>
              {composition.topics.map((e) => (
                <CompositionRow
                  key={`topic:${e.label}`}
                  entry={e}
                  byId={byId}
                  note={e.label === 'other' && composition.otherWithRoomVerdict > 0
                    ? t.patCompOtherIsRoom(composition.otherWithRoomVerdict)
                    : undefined}
                />
              ))}
            </>
          )}
          {composition.formats.length > 0 && (
            <>
              <p style={headStyle}>{t.patCompFormatsHead}</p>
              {composition.formats.map((e) => (
                <CompositionRow key={`format:${e.label}`} entry={e} byId={byId} />
              ))}
            </>
          )}
          {composition.rooms.length > 0 && (
            <>
              <p style={headStyle}>{t.patCompRoomsHead}</p>
              <p style={{ fontSize: 12, color: 'var(--fw-muted)', margin: '0 0 2px' }}>
                {t.patCompRoomsCoverage(composition.roomsRead)}
              </p>
              {composition.rooms.map((e) => (
                <CompositionRow
                  key={`room:${e.label}`}
                  entry={e}
                  byId={byId}
                  labelText={t.patCompRoomLabel(e.label)}
                />
              ))}
            </>
          )}
        </>
      )}
    </PatternSection>
  );
}

function CompositionRow({ entry, byId, labelText, note }: {
  entry: CompositionEntry;
  byId: Map<string, ForensicRecord>;
  /** Readable text for a prefixed key (the ROOM axis); defaults to the label. */
  labelText?: string;
  /** Extra line under the chip, e.g. where the `other` rows really went. */
  note?: string;
}) {
  const t = useDashboardT();
  const lang = useUiLanguage();
  const [expanded, setExpanded] = React.useState(false);

  // Per-label platform mix, derived from the member records (not stored) so
  // the dots agree with the drill-down list exactly.
  const platforms: Record<string, number> = {};
  for (const id of entry.recordIds) {
    const p = byId.get(id)?.platform;
    if (p) platforms[p] = (platforms[p] ?? 0) + 1;
  }

  // `other` is the classifier punting, not a real category — render it muted with
  // an explicit note so it doesn't read as a content bucket, and so the gap between
  // the formats total and the coverage count is self-explaining.
  const unclassified = entry.label === 'other';

  return (
    <div style={{ borderTop: '1px solid var(--fw-border)', padding: '8px 0', fontSize: 13, opacity: unclassified ? 0.7 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="fc-ai-tag">{labelText ?? entry.label.replace(/-/g, ' ')}</span>
        {unclassified && (
          <span style={{ fontSize: 12, color: 'var(--fw-muted)', fontStyle: 'italic' }}>{t.patCompUnclassified}</span>
        )}
        <PlatformDots platforms={platforms} />
        <span style={{ flex: 1 }} />
        {/* Accessibility audit found 2026-09-18: forced single line overflows
            in RO/PT-BR, which run 1.2-3x the English length here. */}
        <span style={{ fontFamily: 'var(--fw-font-mono)', color: 'var(--fw-text-secondary)', fontSize: 12 }}>
          {t.patCompCount(entry.count)}
        </span>
      </div>
      {note && (
        <p style={{ fontSize: 12, color: 'var(--fw-muted)', margin: '3px 0 0' }}>{note}</p>
      )}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        style={{ marginTop: 4, fontSize: 12, color: 'var(--fw-teal)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline' }}
      >
        {expanded ? t.patHideRecords : t.patShowRecords}
      </button>
      {expanded && (
        <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 5, borderLeft: '2px solid var(--fw-border)', paddingLeft: 12 }}>
          {entry.recordIds.map((rid) => {
            const r = byId.get(rid);
            if (!r) return null;
            const url = r.postUrl && /^https?:\/\//.test(r.postUrl) ? r.postUrl : null;
            return (
              <li key={rid} style={{ display: 'flex', gap: 10, fontSize: 12, alignItems: 'baseline' }}>
                <ChainPositionChip record={r} />
                <span style={{ fontFamily: 'var(--fw-font-mono)', fontSize: 12, color: 'var(--fw-muted)', whiteSpace: 'nowrap' }}>
                  {formatDateTimeLocal(r.timestamp, lang)}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--fw-muted)', fontSize: 12, whiteSpace: 'nowrap' }}>
                  <span style={{ width: 6, height: 6, borderRadius: 0, background: PLATFORM_COLOR[r.platform] ?? 'var(--fw-muted)' }} />
                  {PLATFORM_LABEL[r.platform] ?? r.platform}
                </span>
                {/* Accessibility audit found 2026-09-18: the fixed-width
                    ellipsis clip on this line hid overflowing text instead of
                    wrapping it; removed here for the same reason as the
                    theme-label and reserve-row instances above. */}
                <span style={{ flex: 1, minWidth: 0, color: 'var(--fw-text)' }}>
                  {shownText(r, lang).slice(0, 140)}
                </span>
                {url && (
                  <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--fw-teal)', fontSize: 12, whiteSpace: 'nowrap' }}>
                    {t.patOpenPost}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function LexLeagueRow({ entry, byId }: { entry: SwearLeagueEntry; byId: Map<string, ForensicRecord> }) {
  const lang = useUiLanguage();
  const t = useDashboardT();
  const [expanded, setExpanded] = React.useState(false);

  // Per-term platform mix, derived from the member records (not stored) so the
  // dots agree with the drill-down list exactly.
  const platforms: Record<string, number> = {};
  for (const id of entry.recordIds) {
    const p = byId.get(id)?.platform;
    if (p) platforms[p] = (platforms[p] ?? 0) + 1;
  }

  return (
    <div style={{ borderTop: '1px solid var(--fw-border)', padding: '8px 0', fontSize: 13 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <code style={{
          fontFamily: 'var(--fw-font-mono)', fontWeight: 600,
          color: entry.tier === 'slur' ? 'var(--fw-red)' : 'var(--fw-text)',
        }}>{entry.term}</code>
        <span style={{
          fontSize: 12, letterSpacing: 0.4, color: 'var(--fw-muted)',
          border: '1px solid var(--fw-border)', borderRadius: 0, padding: '0 5px',
        }}>
          {entry.tier === 'slur' ? t.patLexTierSlur : t.patLexTierProfanity}
        </span>
        <PlatformDots platforms={platforms} />
        <span style={{ flex: 1 }} />
        {/* Accessibility audit found 2026-09-18: forced single line overflows
            in RO/PT-BR, which run 1.2-3x the English length here. */}
        <span style={{ fontFamily: 'var(--fw-font-mono)', color: 'var(--fw-text-secondary)', fontSize: 12 }}>
          {t.patLexCount(entry.count, entry.recordIds.length)}
        </span>
      </div>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        style={{ marginTop: 4, fontSize: 12, color: 'var(--fw-teal)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline' }}
      >
        {expanded ? t.patHideRecords : t.patShowRecords}
      </button>
      {expanded && (
        <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 5, borderLeft: '2px solid var(--fw-border)', paddingLeft: 12 }}>
          {entry.recordIds.map((rid) => {
            const r = byId.get(rid);
            if (!r) return null;
            const url = r.postUrl && /^https?:\/\//.test(r.postUrl) ? r.postUrl : null;
            return (
              <li key={rid} style={{ display: 'flex', gap: 10, fontSize: 12, alignItems: 'baseline' }}>
                <ChainPositionChip record={r} />
                <span style={{ fontFamily: 'var(--fw-font-mono)', fontSize: 12, color: 'var(--fw-muted)', whiteSpace: 'nowrap' }}>
                  {formatDateTimeLocal(r.timestamp, lang)}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--fw-muted)', fontSize: 12, whiteSpace: 'nowrap' }}>
                  <span style={{ width: 6, height: 6, borderRadius: 0, background: PLATFORM_COLOR[r.platform] ?? 'var(--fw-muted)' }} />
                  {PLATFORM_LABEL[r.platform] ?? r.platform}
                </span>
                {/* Accessibility audit found 2026-09-18: the fixed-width
                    ellipsis clip on this line hid overflowing text instead of
                    wrapping it; removed here for the same reason as the
                    theme-label and reserve-row instances above. */}
                <span style={{ flex: 1, minWidth: 0, color: 'var(--fw-text)' }}>
                  {shownText(r, lang).slice(0, 140)}
                </span>
                {url && (
                  <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--fw-teal)', fontSize: 12, whiteSpace: 'nowrap' }}>
                    {t.patOpenPost}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
