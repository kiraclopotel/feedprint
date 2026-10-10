// FeelingWise — the one place a date or a time becomes a string.
//
// ── Why there are two clocks ───────────────────────────────────────────────
//
// FW's surfaces answer two different questions with the same field.
//
//   "When was I looking at this?"  The reader is placing a record against
//   their own day: the evening they scrolled, the morning the feed turned.
//   That question is answered in the reader's own local time, in the reader's
//   own interface language. Every reading surface (Activity, Exposure,
//   Overview, Statistics, Patterns, Issues) is on this clock.
//
//   "What instant is sealed in the chain?"  A recipient of the record (a
//   lawyer, a regulator, a second reader in another country) is placing a
//   record against an outside event. That question is answered in UTC, in a
//   fixed ISO shape, identical on every machine that opens the export. The
//   forensic surfaces (the Record ledger, a record's forensic detail, the
//   chain banners) are on this clock.
//
// Both clocks can appear on one screen, so they are told apart by one rule
// and not by a suffix a reader can miss:
//
//   A bare time on a FeelingWise surface is ALWAYS the reader's local time.
//   A UTC instant is ALWAYS wrapped in words that say so (t.utcStamp, or the
//   ledger's own clock note), never in a bare "UTC" suffix.
//
// ── Which formatter to reach for ───────────────────────────────────────────
//
//   a reading surface, an instant  → formatDateTimeLocal / formatDateLocal /
//                                    formatDayMonthLocal / formatTimeLocal
//   a reading surface, a chart axis → formatWeekdayShort / formatWeekdayNarrow
//                                    / formatMonthShort / formatHourAxis /
//                                    formatDayOfMonth
//   an evidence surface            → formatUtcStamp / formatUtcTime, then wrap
//                                    the result in t.utcStamp
//   a "YYYY-MM-DD" bucket key      → dayKeyAsLocalDate, then a local formatter
//   you need to CUT a local day key → localDayKey
//
// Every local formatter takes the RESOLVED interface language and passes it
// through intlLocaleFor. None of them reads navigator.language: the reader
// picked a language in FW's own settings, and a Spanish interface that prints
// 9/18/2026 because the browser is US English is the defect this module
// exists to close (2026-09-18 cold read of the dashboard).
//
// The banned alternatives (a bare toLocaleString(), a hand-rolled
// `${d.getDate()}/${d.getMonth() + 1}`, a sliced toISOString()) are held out
// of src/ui by tests/repo/one-clock-per-surface.test.ts.

import { intlLocaleFor, type ResolvedUiLanguage } from '../../i18n';

/** Anything a call site already holds: an ISO string, epoch ms, or a Date. */
export type Instant = string | number | Date;

function toDate(at: Instant): Date | null {
  const d = at instanceof Date ? at : new Date(at);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * What a formatter prints when the value does not parse. The raw value, never
 * "Invalid Date": a timestamp FW cannot read is a fact about the record, and
 * hiding it behind a placeholder loses it.
 */
function raw(at: Instant): string {
  return at instanceof Date ? at.toISOString() : String(at);
}

// Intl.DateTimeFormat construction is the expensive part, so each
// (language, shape) pair is built once and reused.
const cache = new Map<string, Intl.DateTimeFormat>();

function fmt(lang: ResolvedUiLanguage, key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const id = `${lang}|${key}`;
  let f = cache.get(id);
  if (!f) {
    f = new Intl.DateTimeFormat(intlLocaleFor(lang), options);
    cache.set(id, f);
  }
  return f;
}

// Times are printed on a 24-hour clock in every language, on purpose. A
// reader comparing a local time against the ledger's UTC stamp is doing
// arithmetic, and "5:51 PM" against "14:50:44" makes that arithmetic harder
// than it needs to be.
const H23 = 'h23' as const;

// ── The reader's clock, the reader's language ──────────────────────────────

/** A full instant a person reads: "Sep 18, 2026, 23:50" / "18 sept. 2026, 23:50". */
export function formatDateTimeLocal(at: Instant, lang: ResolvedUiLanguage): string {
  const d = toDate(at);
  if (!d) return raw(at);
  return fmt(lang, 'dateTime', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: H23,
  }).format(d);
}

/** A day named in full, for a heading: "Friday, September 18". */
export function formatDateLongLocal(at: Instant, lang: ResolvedUiLanguage): string {
  const d = toDate(at);
  if (!d) return raw(at);
  return fmt(lang, 'dateLong', { weekday: 'long', month: 'long', day: 'numeric' }).format(d);
}

/** A calendar date: "Sep 18, 2026" / "18 sept. 2026". */
export function formatDateLocal(at: Instant, lang: ResolvedUiLanguage): string {
  const d = toDate(at);
  if (!d) return raw(at);
  return fmt(lang, 'date', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

/**
 * A day and month written out, for a sentence: "September 18" / "18 septembrie".
 * The long month is not decoration: this is the record-window note, which is
 * prose, and an abbreviation inside a sentence reads as a truncation.
 */
export function formatDayMonthLongLocal(at: Instant, lang: ResolvedUiLanguage): string {
  const d = toDate(at);
  if (!d) return raw(at);
  return fmt(lang, 'dayMonthLong', { day: 'numeric', month: 'long' }).format(d);
}

/** A date with the year dropped, for a chip or a range: "Sep 18" / "18 sept.". */
export function formatDayMonthLocal(at: Instant, lang: ResolvedUiLanguage): string {
  const d = toDate(at);
  if (!d) return raw(at);
  return fmt(lang, 'dayMonth', { day: 'numeric', month: 'short' }).format(d);
}

/** A wall-clock time: "23:50", or "23:50:44" with `withSeconds`. */
export function formatTimeLocal(at: Instant, lang: ResolvedUiLanguage, withSeconds = false): string {
  const d = toDate(at);
  if (!d) return raw(at);
  return withSeconds
    ? fmt(lang, 'timeSec', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: H23 }).format(d)
    : fmt(lang, 'time', { hour: '2-digit', minute: '2-digit', hourCycle: H23 }).format(d);
}

/** A weekday for a column label: "Fri" / "vin.". */
export function formatWeekdayShort(at: Instant, lang: ResolvedUiLanguage): string {
  const d = toDate(at);
  if (!d) return raw(at);
  return fmt(lang, 'weekdayShort', { weekday: 'short' }).format(d);
}

/** A weekday initial for a dense 7-column axis: "F" / "V". */
export function formatWeekdayNarrow(at: Instant, lang: ResolvedUiLanguage): string {
  const d = toDate(at);
  if (!d) return raw(at);
  return fmt(lang, 'weekdayNarrow', { weekday: 'narrow' }).format(d);
}

/** A month for a 12-column axis: "Sep" / "sept.". */
export function formatMonthShort(at: Instant, lang: ResolvedUiLanguage): string {
  const d = toDate(at);
  if (!d) return raw(at);
  return fmt(lang, 'monthShort', { month: 'short' }).format(d);
}

/**
 * A 24-column hour-of-day axis label: "20h". Deliberately a bare number in
 * every language, because a 24-slot axis has no room for "8 PM" and the
 * histogram beside it is already read as hours.
 */
export function formatHourAxis(at: Instant): string {
  const d = toDate(at);
  if (!d) return raw(at);
  return `${String(d.getHours()).padStart(2, '0')}h`;
}

/**
 * A 30-column day-of-month axis label: "18". A bare number for the same
 * reason as formatHourAxis.
 */
export function formatDayOfMonth(at: Instant): string {
  const d = toDate(at);
  if (!d) return raw(at);
  return String(d.getDate());
}

// ── Calendar-day keys ──────────────────────────────────────────────────────

/**
 * The reader's local calendar day, as the "YYYY-MM-DD" key the dashboard's
 * per-day buckets are indexed by. One implementation, because three surfaces
 * had written the same three getters out by hand.
 */
export function localDayKey(at: Instant): string {
  const d = toDate(at);
  if (!d) return raw(at).slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * A "YYYY-MM-DD" key read back as a Date, so a local formatter can name it.
 *
 * Anchored at local NOON, never at midnight: a day key is a calendar date and
 * not an instant, and parsing it at midnight puts it one date out for every
 * reader whose offset runs the wrong way. Noon is the only hour that survives
 * every offset and every DST transition.
 */
export function dayKeyAsLocalDate(dayKey: string): Date {
  const [y, m, d] = dayKey.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return new Date(NaN);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

// ── The record's own clock ─────────────────────────────────────────────────

/**
 * An instant as the chain seals it: "2026-09-18 14:50:44". UTC, fixed shape,
 * no language, so two readers in two countries quoting the same record quote
 * the same string.
 *
 * It carries no "UTC" suffix of its own. The caller wraps it in t.utcStamp,
 * which names the clock in words; a suffix is the thing a reader skips.
 */
export function formatUtcStamp(at: Instant): string {
  const d = toDate(at);
  if (!d) return raw(at);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * The clock part of the same instant: "14:50:44", or "14:50" without seconds.
 * For the ledger, where the date sits on the day divider above the rows and
 * repeating it on every line would bury the times.
 */
export function formatUtcTime(at: Instant, withSeconds = true): string {
  const d = toDate(at);
  if (!d) return raw(at);
  const iso = d.toISOString();
  return withSeconds ? iso.slice(11, 19) : iso.slice(11, 16);
}
