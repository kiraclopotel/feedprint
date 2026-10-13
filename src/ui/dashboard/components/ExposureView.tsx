// src/ui/dashboard/components/ExposureView.tsx
// Surface-ID: exposure-view
//
// Weekly Exposure Report — what the feed served this period versus the
// previous one, what FeelingWise did about it, and the repetition /
// late-night patterns worth a parent's attention.
//
// Every number is computed on-device from the signed record via the
// data-layer primitives (src/forensics/data-layer.ts). This file only renders;
// it adds no aggregation logic of its own beyond folding the existing
// primitive outputs into chart geometry. A week runs Sunday to Saturday
// (periodWindow, matching computeStats()), or Monday to Sunday where the reader's language counts it so.

import * as React from 'react';
import type { ForensicRecord } from '../../../types/forensic';
import {
  periodWindow,
  previousPeriodWindow,
  aggregateByTechnique,
  aggregateByHour,
  aggregateByActionFamily,
  aggregateByPlatform,
  topRepeatedRooms,
  comparePeriods,
  type PeriodWindow,
  type PeriodDelta,
  type ActionFamily,
} from '../../../forensics/data-layer';
import { canonicalizeTechniqueForStats } from '../../../forensics/store';
import { isActedOn, isBlockedItem, isFlaggedItem, isHiddenAsHarmful } from '../record-sets';
import { PLATFORM_LABELS, techniqueFill } from './color-maps';
import { TONE } from '../house-tones';
import { FileText } from '../../shared/icons/lucide';
import { useDashboardT, useUiLanguage } from '../../../i18n/react';
import { formatCount } from '../../shared/format-number';
import { formatDateLocal, formatDayMonthLocal, formatWeekdayNarrow } from '../../shared/format-time';
import { ArchivesPendingNote } from './ArchivesPendingNote';
import type { ResolvedUiLanguage } from '../../../i18n';
import type { DashboardStrings } from '../../../i18n/dashboard-strings';
import type { ActivityDrill } from './activity-drill';
import {
  KitRow, KitStack, KitLegend, KitCols, KitAxis, KitHero, KitDelta, stackedColumn,
} from './chart-kit';

// Verdicts where FeelingWise actually intervened. Legacy records with
// verdict=undefined are treated as flagged (store back-compat rule).
// skipped / pass / cancelled-* are witnessed but not acted on, so they are
// excluded from the "What FeelingWise did" counts — otherwise records FW
// could NOT act on (cap exhausted, stale DOM) would inflate the
// harmful-hidden count and overstate protection.
const isIntervention = isActedOn;

// Flagged-set convention shared with ActivityTab / computeStats(): flagged,
// flagged-hidden, and legacy-undefined records carry technique attribution.
// Advertising is not in it: a sponsored post is a paid placement, never a
// finding, and it counts on the ads bar of the same panel instead (standing
// decision 1, 2026-09-14).
const isFlagged = isFlaggedItem;

// Hidden = the rewrite was too harmful to show, so FeelingWise removed the
// item from the feed entirely (distinct from a plain flag, which stays
// visible for the child to read). An ad hidden by the user's own rule is not
// this, so it is out here too.
const isHidden = (r: ForensicRecord): boolean => isHiddenAsHarmful(r) && isFlaggedItem(r);

// Blocked = a rule hid it. An ad belongs on this side of the verdict bar, not
// the flagged side: it is hidden by the user's own Block Ads rule, which is
// what "blocked" has always meant here.
const isBlocked = isBlockedItem;

function deltaPhrase(d: PeriodDelta, t: DashboardStrings): string {
  if (d.baselineTotal === 0) return t.expoDeltaNothing;
  if (d.deltaAbs === 0) return t.expoDeltaSame(d.baselineTotal);
  return d.deltaAbs > 0
    ? t.expoDeltaMore(Math.abs(d.deltaAbs), d.baselineTotal)
    : t.expoDeltaFewer(Math.abs(d.deltaAbs), d.baselineTotal);
}

// Display labels live in the strings table (t.expoActionLabels), keyed by the
// stable ActionFamily id.
// 'pass' and 'not-judged' are excluded because this chart is about actions
// FeelingWise TOOK. Nothing was done to a passed post, and nothing was even
// looked at on a skipped one; giving either a bar would read as an action.
const ACTION_ROWS: { key: Exclude<ActionFamily, 'pass' | 'not-judged'>; color: string }[] = [
  // What was taken out is noise; flagged is the warn colour it has on every page (12 Oct 2026); the rest are tones of
  // ink, told apart by their labels.
  { key: 'ads',        color: TONE.noise },
  { key: 'house-rule', color: TONE.mid },
  { key: 'detection',  color: TONE.flagged },
  { key: 'ai-block',   color: TONE.noiseSoft },
];

// Period switcher options. 'week' reuses t.expoThisWeek; the other two have
// no string in the shared table (finding 6: the old code mangled
// expoDeltaSame(0) into "same as last week" and borrowed "Last 14 days" for a
// 28-day window). Their labels live here, per language, until the shared
// table grows the keys. The active option also shows its resolved range.
export type PeriodChoice = 'week' | 'last-week' | '4-weeks';

const PERIOD_CHOICES: PeriodChoice[] = ['week', 'last-week', '4-weeks'];

const PERIOD_LABELS: Record<ResolvedUiLanguage, Record<Exclude<PeriodChoice, 'week'>, string>> = {
  'en': { 'last-week': 'Last week', '4-weeks': 'Last 4 weeks (28 days)' },
  'ro': { 'last-week': 'Săptămâna trecută', '4-weeks': 'Ultimele 4 săptămâni (28 de zile)' },
  'es': { 'last-week': 'La semana pasada', '4-weeks': 'Últimas 4 semanas (28 días)' },
  'pt-BR': { 'last-week': 'Semana passada', '4-weeks': 'Últimas 4 semanas (28 dias)' },
};

// Exported for tests: the label each switcher option prints.
function periodChoiceLabel(choice: PeriodChoice, lang: ResolvedUiLanguage, t: DashboardStrings): string {
  if (choice === 'week') return t.expoThisWeek;
  return (PERIOD_LABELS[lang] ?? PERIOD_LABELS.en)[choice];
}

/**
 * The sentence under the headline, for the one period the shared string cannot
 * describe.
 *
 * `expoThisWeekSub` ends "Week runs Sunday to Saturday", which is true of both
 * week windows and false of the 28-day one. It was printed under every period
 * until 2026-09-19, beside a heading that also said "This week" whatever the
 * switcher was set to. The headline figure of the tab, in four languages,
 * naming a period it was not showing.
 *
 * Kept here rather than in the shared table for the same reason the switcher's
 * own labels are, which the comment above says: these keys do not exist yet in
 * the four language files, and inventing them in a component is how the table
 * and the screen drift apart. Moving them together is one job for later.
 */
const FOUR_WEEK_SUB: Record<ResolvedUiLanguage, string> = {
  'en': 'Everything Feedprint saw on covered platforms, over the last 28 days.',
  'ro': 'Tot ce a văzut Feedprint pe platformele acoperite, în ultimele 28 de zile.',
  'es': 'Todo lo que Feedprint vio en las plataformas cubiertas, durante los últimos 28 días.',
  'pt-BR': 'Tudo o que o Feedprint viu nas plataformas cobertas, nos últimos 28 dias.',
};

function periodSub(choice: PeriodChoice, lang: ResolvedUiLanguage, t: DashboardStrings): string {
  return choice === '4-weeks' ? (FOUR_WEEK_SUB[lang] ?? FOUR_WEEK_SUB.en) : t.expoThisWeekSub;
}

// Local fallbacks for the failure branch (finding 28). t.loadFailedTitle and
// t.retry exist in the shared table and are used; only the one-line body
// specific to this view lives here.
const LOAD_FAILED_BODY: Record<ResolvedUiLanguage, string> = {
  'en': 'The exposure report could not be computed from the record. Nothing was changed.',
  'ro': 'Raportul de expunere nu a putut fi calculat din registru. Nimic nu a fost modificat.',
  'es': 'El informe de exposición no se pudo calcular a partir del registro. No se cambió nada.',
  'pt-BR': 'O relatório de exposição não pôde ser calculado a partir do registro. Nada foi alterado.',
};

// Records inside a half-open window [startISO, endISO). endISO is exclusive
// (PeriodWindow contract), and previous.endISO === current.startISO, so an
// inclusive compare counted a midnight record in both windows (finding 18).
// Exported for tests.
function sliceWindow(records: ForensicRecord[], w: PeriodWindow): ForensicRecord[] {
  return records.filter((r) => r.timestamp >= w.startISO && r.timestamp < w.endISO);
}

// Late-night hours, wrap-around: 22:00 through 01:59. The hour filter
// accepts [lo, hi] with lo > hi as a wrap-around range.
const LATE_NIGHT_RANGE: [number, number] = [22, 1];

export type ExposureDrill = Omit<ActivityDrill, 'seq'>;

// Drill payload builders. Every drill carries the selected window as
// since/until (until exclusive) so the feed opened is the set the bar
// counted (finding 5). Exported for tests.
function techniqueDrill(name: string, w: PeriodWindow): ExposureDrill {
  return { platform: 'all', technique: name, since: w.startISO, until: w.endISO };
}
function platformDrill(platform: ForensicRecord['platform'], w: PeriodWindow): ExposureDrill {
  return { platform, technique: null, since: w.startISO, until: w.endISO };
}
function hourDrill(range: [number, number], w: PeriodWindow): ExposureDrill {
  return { platform: 'all', technique: null, hourRange: range, since: w.startISO, until: w.endISO };
}
function roomDrill(url: string, w: PeriodWindow): ExposureDrill {
  return { platform: 'all', technique: null, roomUrl: url, since: w.startISO, until: w.endISO };
}

// Resolve a choice to its current window + the same-length baseline window.
// `4-weeks` is the 28-day span ending at the current week's end; baseline is
// the 28 days before that. `last-week` re-anchors to the previous week.
// Exported for tests (F3c — DST-boundary pin).
/** Romanian and Spanish weeks start on Monday; US English and Brazilian Portuguese weeks on Sunday. */
export function weekStartsMonday(lang: ResolvedUiLanguage): boolean {
  return lang === 'ro' || lang === 'es';
}

// periodWindow's week starts on Sunday; a Monday week is the same window moved one day on, or six days back on a Sunday.
function mondayWeek(sundayWeek: PeriodWindow, anchor: Date): PeriodWindow {
  const sun = new Date(sundayWeek.startISO);
  const start = new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() + (anchor.getDay() === 0 ? -6 : 1));
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

export function windowsFor(choice: PeriodChoice, mondayFirst = false): { current: PeriodWindow; previous: PeriodWindow } {
  const now = new Date();
  const thisWeek = mondayFirst ? mondayWeek(periodWindow('week', now), now) : periodWindow('week', now);
  if (choice === 'last-week') {
    const current = previousPeriodWindow(thisWeek);
    return { current, previous: previousPeriodWindow(current) };
  }
  if (choice === '4-weeks') {
    // DST-safe day span (SOL finding 2 — the same class OverviewTab fixed):
    // 28 LOCAL CALENDAR days ending at the week's end, never a fixed
    // 28 × 86,400,000 ms. Local days are 23–25h on transition days, so the
    // fixed-ms form started a spring-forward-crossing window at 23:00 the
    // wrong calendar day — the boundary drifted an hour against
    // bucketByDay's local-midnight columns and the record filter.
    // thisWeek.endISO is a local midnight (periodWindow's calendar-date
    // arithmetic), so the same idiom lands the start on a local midnight.
    const endDate = new Date(thisWeek.endISO);
    const start = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() - 28);
    const current: PeriodWindow = { startISO: start.toISOString(), endISO: thisWeek.endISO };
    return { current, previous: previousPeriodWindow(current) };
  }
  return { current: thisWeek, previous: previousPeriodWindow(thisWeek) };
}

// Day + month for the switcher chips / footer. It used to be a hand-rolled
// `${d.getDate()}/${d.getMonth() + 1}`, which is day-first in every language:
// a US-English reader saw `13/9` on one line and `9/18/2026` on the next and
// could not parse the first (cold read of the dashboard, 2026-09-18).
function rangeLabel(w: PeriodWindow, lang: ResolvedUiLanguage): string {
  // endISO is exclusive; show the last included day.
  const end = new Date(new Date(w.endISO).getTime() - 1);
  // A day and its month stay on one line: "12 oct." must not break after the 12.
  const keepTogether = (s: string): string => s.replace(/ /g, String.fromCharCode(0xa0));
  return `${keepTogether(formatDayMonthLocal(w.startISO, lang))}–${keepTogether(formatDayMonthLocal(end, lang))}`;
}

interface WeekData {
  current: ForensicRecord[];
  previous: ForensicRecord[];
}

interface Derived {
  delta: PeriodDelta;
  families: Record<ActionFamily, number>;
  topTechniques: [string, number][];
  repeated: ReturnType<typeof topRepeatedRooms>;
  lateNight: number;
  byHour: Record<number, number>;
  byDay: DayBucket[];
  platforms: [string, number][];
  flaggedCount: number;
  hiddenCount: number;
  blockedCount: number;
  passCount: number;
}

// Day buckets for the per-day stacked bar. Anchored on the local day so a
// 7-day week yields 7 columns and a 28-day span yields 28.
interface DayBucket { dayMs: number; total: number; flagged: number }

function bucketByDay(records: ForensicRecord[], w: PeriodWindow): DayBucket[] {
  const start = new Date(w.startISO);
  const end = new Date(w.endISO);
  const buckets: DayBucket[] = [];
  const map = new Map<number, DayBucket>();
  for (
    let d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    d < end;
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
  ) {
    const b: DayBucket = { dayMs: d.getTime(), total: 0, flagged: 0 };
    buckets.push(b);
    map.set(b.dayMs, b);
  }
  for (const r of records) {
    const ts = new Date(r.timestamp);
    if (Number.isNaN(ts.getTime())) continue;
    const key = new Date(ts.getFullYear(), ts.getMonth(), ts.getDate()).getTime();
    const b = map.get(key);
    if (!b) continue;
    b.total++;
    if (isFlagged(r)) b.flagged++;
  }
  return buckets;
}

// One-letter weekday initials, locale-neutral (English single letters double
// as universally readable day markers on the axis).

export function ExposureView({
  records,
  onDrill,
  archivesPending,
}: {
  /** Signed forensic records from the dashboard shell — the same set every sibling tab receives. */
  records: ForensicRecord[];
  /** Cross-tab drill-down: jump to the Activity feed pre-filtered (canonical technique names). */
  onDrill?: (d: ExposureDrill) => void;
  /** The archived months are still being read; the windows below cover the active chain only until they land. */
  archivesPending?: boolean;
}) {
  const t = useDashboardT();
  const lang = useUiLanguage();
  const [choice, setChoice] = React.useState<PeriodChoice>('week');
  // Bumped by Retry so the memo below recomputes after a failure (finding 28).
  const [attempt, setAttempt] = React.useState(0);
  const window_ = React.useMemo(() => windowsFor(choice, weekStartsMonday(lang)), [choice, lang]);

  // Same records the shell hands every sibling tab, sliced to each window
  // in-memory, over the half-open [start, end) window (finding 18). Computed
  // synchronously so the first paint already has the numbers; a throw from
  // any primitive lands in the failure branch instead of blanking the tab.
  const computed = React.useMemo((): { data: WeekData; error: null } | { data: null; error: string } => {
    void attempt;
    try {
      const { current: cur, previous: prev } = window_;
      return { data: { current: sliceWindow(records, cur), previous: sliceWindow(records, prev) }, error: null };
    } catch (e) {
      return { data: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [window_, records, attempt]);
  const data = computed.data;

  const derived = React.useMemo((): { value: Derived; error: null } | { value: null; error: string } => {
    if (!data) return { value: null, error: '' };
    try {
    const { current, previous } = data;
    const delta = comparePeriods(current, previous);
    const families = aggregateByActionFamily(current.filter(isIntervention));

    // Technique counts come from the data-layer primitive over the flagged
    // set, then fold raw names into their canonical buckets so the
    // PRETTY_TECHNIQUE parent-language labels apply (same canonicalization
    // the Activity tab's technique counter uses).
    const rawTechniques = aggregateByTechnique(current.filter(isFlagged));
    const techniques: Record<string, number> = {};
    for (const [name, n] of Object.entries(rawTechniques)) {
      const canon = canonicalizeTechniqueForStats(name);
      techniques[canon] = (techniques[canon] ?? 0) + n;
    }
    const topTechniques = Object.entries(techniques)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const repeated = topRepeatedRooms(current, 5).filter((g) => g.count > 1);

    const byHour = aggregateByHour(current);
    const lateNight = (byHour[22] ?? 0) + (byHour[23] ?? 0) + (byHour[0] ?? 0) + (byHour[1] ?? 0);

    // Verdict breakdown for the headline + segmented bar.
    const flaggedCount = current.filter(isFlagged).length;
    const hiddenCount = current.filter(isHidden).length;
    const blockedCount = current.filter(isBlocked).length;
    const passCount = current.filter((r) => r.verdict === 'pass').length;

    const byDay = bucketByDay(current, window_.current);
    const platforms = Object.entries(aggregateByPlatform(current)).sort((a, b) => b[1] - a[1]);

    return {
      value: {
        delta, families, topTechniques, repeated, lateNight, byHour, byDay, platforms,
        flaggedCount, hiddenCount, blockedCount, passCount,
      },
      error: null,
    };
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [data, window_]);

  // Failure branch (finding 28): the record could not be read into this
  // report. Say so and offer Retry, instead of sitting on "Reading..." for
  // ever. The loading branch below is now reachable only when a primitive
  // returns nothing at all.
  const failure = computed.error ?? derived.error;
  if (failure) {
    return (
      <div className="stats-grid">
        <PeriodSwitcher choice={choice} setChoice={setChoice} windows={window_} t={t} lang={lang} />
        <div className="stats-card full" role="alert" data-fw-expo-failed="1">
          <h3>{t.loadFailedTitle}</h3>
          <div className="stats-sub">{LOAD_FAILED_BODY[lang] ?? LOAD_FAILED_BODY.en}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{failure}</div>
          <button
            type="button"
            className="btn"
            style={{ marginTop: 10 }}
            onClick={() => setAttempt((n) => n + 1)}
          >
            {t.retry}
          </button>
        </div>
      </div>
    );
  }

  if (!data || !derived.value) {
    return (
      <div className="stats-grid">
        <div className="stats-card full" style={{ textAlign: 'center', color: 'var(--fw-muted)', padding: 40 }}>
          {t.expoLoading}
        </div>
      </div>
    );
  }

  const total = data.current.length;

  // Two empty states, because they are two different facts. Nothing in either
  // window used to print "FeelingWise hasn't witnessed enough yet", which is
  // true on a fresh install and false on a record holding thousands of items
  // that the reader has simply not browsed this week: a household coming back
  // from a holiday was told its recorder had seen nothing (2026-09-17). The
  // newest timestamp in the record is what tells them where to look.
  const newestInRecord = records.reduce<number>((newest, r) => {
    const at = Date.parse(r.timestamp ?? '');
    return Number.isFinite(at) && at > newest ? at : newest;
  }, 0);
  // Fresh-install empty state: nothing witnessed in either window.
  if (total === 0 && data.previous.length === 0) {
    return (
      <div className="stats-grid">
        {/* Period switcher stays available even when empty, so a parent can
            check an earlier window. */}
        <PeriodSwitcher choice={choice} setChoice={setChoice} windows={window_} t={t} lang={lang} />
        <div className="stats-card full">
          <div className="feed-empty">
            <FileText size={36} />
            <div>
              {newestInRecord > 0
                ? t.expoEmptyWindow(formatDateLocal(newestInRecord, lang))
                : t.expoEmpty}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const {
    delta, families, topTechniques, repeated, lateNight, byHour, byDay, platforms,
    flaggedCount, hiddenCount, blockedCount, passCount,
  } = derived.value;
  const win = window_.current;
  const actionMax = Math.max(1, ...ACTION_ROWS.map((row) => families[row.key]));
  const techMax = Math.max(1, ...topTechniques.map(([, n]) => n));
  const dayMax = Math.max(1, ...byDay.map((b) => b.total));
  const hourMax = Math.max(1, ...Array.from({ length: 24 }, (_, h) => byHour[h] ?? 0));
  const platMax = Math.max(1, ...platforms.map(([, n]) => n));

  // Served again and again: repeated threads. When some thread repeated, this is the first card of the
  // tab, above the period's headline: what the feed served over and over is what this tab is opened for.
  const repeatedCard = (
    <div className={repeated.length > 0 ? 'stats-card full' : 'stats-card pat-section-empty'}>
      <h3>{t.expoRepeatedTitle}</h3>
      <div className="stats-sub">{t.expoRepeatedSub}</div>
      {repeated.length === 0 ? (
        <div className="muted" style={{ fontSize: 12 }}>{t.expoNoRepeats}</div>
      ) : (
        repeated.map((g) => {
          // http(s) only, and never a bare platform root (the legacy
          // home-feed fallback URL: landing on facebook.com is misleading).
          const linkable = /^https?:\/\//.test(g.url)
            && !/^https?:\/\/[^/]+\/?(?:home|foryou)?\/?$/i.test(g.url);
          const dot = TONE.mid;
          // The row drills the feed to this room inside the selected
          // window (finding 16). The feed matches roomUrl ?? postUrl, the
          // same field topRepeatedRooms grouped on, so a row with no url
          // stays plain text rather than opening an unrelated feed.
          const drill = onDrill && g.url ? () => onDrill(roomDrill(g.url, win)) : undefined;
          return (
            <div
              key={g.caption}
              className={drill ? 'fwc-list-row drill' : 'fwc-list-row'}
              data-fw-room={g.url || undefined}
              role={drill ? 'button' : undefined}
              tabIndex={drill ? 0 : undefined}
              title={drill ? t.statsDrillHint : undefined}
              style={drill ? { cursor: 'pointer' } : undefined}
              onClick={drill}
              onKeyDown={drill
                ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); drill(); } }
                : undefined}
            >
              <span className="fwc-cap">
                <span className="fwc-dot" style={{ ['--sw' as never]: dot }} />
                {linkable ? (
                  // Accessibility audit found 2026-09-18: the fixed-width
                  // ellipsis clip on a room caption cut RO/PT-BR captions,
                  // which run longer than the English text this width was
                  // sized for. Let it wrap instead of losing the tail.
                  <a
                    href={g.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={g.url}
                    onClick={(e) => e.stopPropagation()}
                    style={{ flex: 1, color: 'var(--fw-text-secondary)', textDecoration: 'underline dotted' }}
                  >
                    {g.caption}
                  </a>
                ) : (
                  <span style={{ flex: 1 }}>
                    {g.caption}
                  </span>
                )}
              </span>
              <span className="fwc-pill">{t.expoSeenTimes(g.count)}</span>
            </div>
          );
        })
      )}
    </div>
  );

  return (
    <div className="stats-grid">
      {/* Period switcher — week / last week / 4 weeks. Bound to periodWindow. */}
      <PeriodSwitcher choice={choice} setChoice={setChoice} windows={window_} t={t} lang={lang} />
      <ArchivesPendingNote pending={archivesPending} />
      {repeated.length > 0 && repeatedCard}

      {/* Headline — items witnessed this period + delta + inline verdict
          breakdown + per-day stacked bar (total grey, flagged amber on top). */}
      <div className="stats-card full">
        <h3>{periodChoiceLabel(choice, lang, t)}</h3>
        <div className="stats-sub">{periodSub(choice, lang, t)}</div>
        <div
          style={{ display: 'flex', alignItems: 'flex-start', gap: 28, flexWrap: 'wrap', marginTop: 6 }}
        >
          <div>
            <KitHero
              num={formatCount(total, lang)}
              unit={t.expoItemsWitnessed}
              delta={
                <KitDelta dir={delta.baselineTotal === 0 || delta.deltaAbs === 0 ? 'flat' : delta.deltaAbs > 0 ? 'up' : 'down'}>
                  {deltaPhrase(delta, t)}
                </KitDelta>
              }
            />
            {/* Inline verdict breakdown — each count opens the filtered feed
                where a drill target exists; verdict-filtered drill is not yet
                in the onDrill contract, so these stay non-drilling text. */}
            {/* What was done, by family, in the rows' order and colours (12 Oct 2026): it read "Harmful content hidden or
                marked" for every acted-on item, house-rule items included. With nothing done, the shown-unchanged count. */}
            <KitLegend
              style={{ marginTop: 12 }}
              items={ACTION_ROWS.some((row) => families[row.key] > 0)
                ? ACTION_ROWS.filter((row) => families[row.key] > 0).map((row) => ({ color: row.color, strong: families[row.key], label: t.expoActionLabels[row.key] }))
                : [{ color: TONE.record, strong: formatCount(passCount, lang), label: t.expoShownUnchanged }]}
            />
          </div>
          <span style={{ flex: 1 }} />
          {/* Per-day column chart (mockup: 52px plot, 48px usable) */}
          <div style={{ minWidth: 260 }}>
            {/* The eyebrow names the resolved range, not a fixed "Last 14
                days": this column chart spans 7 or 28 days (finding 6). */}
            <div className="fwc-eyebrow">{rangeLabel(win, lang)}</div>
            <KitCols
              height={52}
              cols={byDay.map((b) => ({
                tip: t.statsDailyFlaggedOf(b.flagged, b.total),
                parts: stackedColumn(b.total, b.flagged, dayMax, 48, TONE.flagged),
              }))}
            />
            {byDay.length <= 7 && (
              <KitAxis perCol labels={byDay.map((b) => formatWeekdayNarrow(b.dayMs, lang))} />
            )}
          </div>
        </div>
        {/* Provenance (lens contract): count, resolved window, chain state. */}
        <div className="fb-prov">
          {/* The window's own bounds are LOCAL midnights (periodWindow does
              calendar-date arithmetic), so they are named on the local clock.
              Slicing their ISO form printed the UTC date of a local midnight,
              which is the previous day for every reader east of Greenwich
              (found 2026-09-18 while putting the page on one clock). */}
          {t.fbProv(
            'entries',
            total,
            formatDateLocal(window_.current.startISO, lang),
            formatDateLocal(new Date(window_.current.endISO).getTime() - 1, lang),
          )}
        </div>
      </div>

      {/* What FeelingWise did — segmented proportion bar + counts by family */}
      <div className="stats-card">
        <h3>{t.expoWhatFwDid}</h3>
        <div className="stats-sub">{t.expoWhatFwDidSub}</div>
        {/* The bar, the rows and the legend read one partition (row 9, 12 Oct 2026): the bar split flagged against
            hidden while the rows split by family, so 21 softened words sat in the bar and the legend as 21 harmful
            items beside a harmful row of 0. Shown unchanged, then each family in the rows' order and colour. */}
        <KitStack
          height={12}
          segs={[
            { n: passCount, color: TONE.record, title: `${t.expoShownUnchanged} ${passCount}` },
            ...ACTION_ROWS.map((row) => ({ n: families[row.key], color: row.color, title: `${t.expoActionLabels[row.key]} ${families[row.key]}` })),
          ]}
        />
        {ACTION_ROWS.map((row) => (
          <KitRow
            key={row.key}
            label={t.expoActionLabels[row.key]}
            color={row.color}
            width={(families[row.key] / actionMax) * 100}
            count={families[row.key]}
          />
        ))}
        {/* Split flagged-visible vs flagged-hidden + a pass row */}
        <div style={{ marginTop: 10, borderTop: '1px solid var(--fw-border)', paddingTop: 9 }}>
          {/* The legend in the bar's order, every segment that has items named (row 9): it read in the mirror order
              and left out the ads, so the noise swatch said "0 Hidden" beside seven ads hidden. */}
          <KitLegend
            items={[
              { color: TONE.record, strong: formatCount(passCount, lang), label: t.expoShownUnchanged },
              ...ACTION_ROWS.filter((row) => families[row.key] > 0).map((row) => ({ color: row.color, strong: families[row.key], label: t.expoActionLabels[row.key] })),
            ]}
          />
        </div>
      </div>

      {/* What the feed pushed — top techniques + ad share */}
      <div className="stats-card">
        <h3>{t.expoWhatPushed}</h3>
        <div className="stats-sub">{t.expoWhatPushedSub}</div>
        {topTechniques.length === 0 ? (
          <div className="muted" style={{ fontSize: 12 }}>{t.expoNoFlagged}</div>
        ) : (
          topTechniques.map(([name, n]) => (
            <KitRow
              key={name}
              label={t.techniqueLabel(name)}
              color={techniqueFill(name) ?? TONE.ink}
              width={(n / techMax) * 100}
              count={n}
              onClick={onDrill ? () => onDrill(techniqueDrill(name, win)) : undefined}
              title={onDrill ? t.statsDrillHint : undefined}
            />
          ))
        )}
        <div style={{ fontSize: 12, color: 'var(--fw-text-secondary)', marginTop: 12 }}>
          {t.expoAdsShare(families.ads, total)}
        </div>
      </div>

      {/* When — items served by hour of day (24 bars), late-night highlighted */}
      <div className="stats-card">
        <h3>{t.expoLateTitle}</h3>
        <div className="stats-sub">{t.expoLateSub}</div>
        {/* 24-hour column chart (mockup: 64px plot, 60px usable), late-night
            columns in teal. Each column drills the feed to that hour inside
            the selected window (finding 17); the kit's KitCols has no click
            hook, so the same markup is rendered here with button semantics. */}
        <div className="fwc-cols" style={{ ['--h' as never]: '64px' }}>
          {Array.from({ length: 24 }, (_, h) => {
            const n = byHour[h] ?? 0;
            const late = h >= 22 || h <= 1;
            const tip = `${String(h).padStart(2, '0')}:00 · ${n}`;
            const drill = onDrill && n > 0 ? () => onDrill(hourDrill([h, h], win)) : undefined;
            return (
              <span
                key={h}
                className={drill ? 'fwc-col drill' : 'fwc-col'}
                data-tip={tip}
                data-fw-hour={h}
                title={drill ? `${tip} · ${t.statsDrillHint}` : tip}
                role={drill ? 'button' : undefined}
                tabIndex={drill ? 0 : undefined}
                aria-label={drill ? `${tip} · ${t.statsDrillHint}` : undefined}
                style={drill ? { cursor: 'pointer' } : undefined}
                onClick={drill}
                onKeyDown={drill
                  ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); drill(); } }
                  : undefined}
              >
                <span
                  className={late ? 'fwc-part' : 'fwc-part fwc-base'}
                  style={{
                    height: n > 0 ? Math.max(3, Math.round((n / hourMax) * 60)) : 0,
                    ...(late ? { ['--c' as never]: 'var(--fw-teal)' } : {}),
                  }}
                />
              </span>
            );
          })}
        </div>
        <KitAxis labels={['00', '06', '12', '18', '23']} />
        <div style={{ marginTop: 12, borderTop: '1px solid var(--fw-border)', paddingTop: 9 }}>
          {/* The late-night figure drills with the wrap-around 22:00 to 01:59
              hour range over the selected window (finding 17). */}
          {onDrill ? (
            <button
              type="button"
              className="ov-link"
              data-fw-late-night="1"
              title={t.statsDrillHint}
              style={{ padding: 0, background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', textAlign: 'left' }}
              onClick={() => onDrill(hourDrill(LATE_NIGHT_RANGE, win))}
            >
              <KitLegend
                items={[{
                  color: 'var(--fw-teal)',
                  strong: formatCount(lateNight, lang),
                  label: <>{t.expoLateLabel} · {t.expoOfTotal(total)}</>,
                }]}
              />
            </button>
          ) : (
            <KitLegend
              items={[{
                color: 'var(--fw-teal)',
                strong: formatCount(lateNight, lang),
                label: <>{t.expoLateLabel} · {t.expoOfTotal(total)}</>,
              }]}
            />
          )}
        </div>
      </div>

      {/* Where — platform split (one bar per platform present) */}
      <div className="stats-card">
        <h3>{t.expoPlatformsTitle}</h3>
        <div className="stats-sub">{t.expoOfTotal(total)}</div>
        {platforms.length === 0 ? (
          <div className="muted" style={{ fontSize: 12 }}>{t.expoNoPlatforms}</div>
        ) : (
          platforms.map(([name, n]) => (
            <KitRow
              key={name}
              dot
              label={PLATFORM_LABELS[name] ?? name}
              color={TONE.mid}
              width={(n / platMax) * 100}
              count={n}
              onClick={onDrill ? () => onDrill(platformDrill(name as ForensicRecord['platform'], win)) : undefined}
              title={onDrill ? t.statsDrillHint : undefined}
            />
          ))
        )}
      </div>

      {/* Nothing repeated: the one-line empty card stays down here, since at the top it would push the
          headline down to say nothing. */}
      {repeated.length === 0 && repeatedCard}

      {/* Footer attribution — every number is computed on-device from the
          signed chain over the selected window. */}
      <div className="stats-card full" style={{ background: 'transparent', border: 'none', padding: '0 2px' }}>
        <div className="expo-footnote" style={{ fontSize: 12, color: 'var(--fw-muted)' }}>
          {periodSub(choice, lang, t)} <span style={{ whiteSpace: 'nowrap' }}>{rangeLabel(window_.current, lang)}</span> · {t.expoOfTotal(total)}
        </div>
      </div>
    </div>
  );
}

// Period switcher — week / last week / 4 weeks. Pure presentation over the
// existing periodWindow primitive; the active chip shows its resolved range.
function PeriodSwitcher({
  choice, setChoice, windows, t, lang,
}: {
  choice: PeriodChoice;
  setChoice: (c: PeriodChoice) => void;
  windows: { current: PeriodWindow; previous: PeriodWindow };
  t: DashboardStrings;
  lang: ResolvedUiLanguage;
}) {
  const label = (c: PeriodChoice): string => periodChoiceLabel(c, lang, t);
  return (
    <div className="stats-card full" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: '10px 14px' }}>
      <div className="fwc-seg-switch">
        {PERIOD_CHOICES.map((c) => {
          const active = c === choice;
          return (
            <button
              key={c}
              type="button"
              className={active ? 'active' : undefined}
              onClick={() => setChoice(c)}
            >
              {label(c)}
              {active && <span className="fwc-range">{rangeLabel(windows.current, lang)}</span>}
            </button>
          );
        })}
      </div>
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 12, color: 'var(--fw-muted)' }}>{t.statsDrillHint}</span>
    </div>
  );
}
