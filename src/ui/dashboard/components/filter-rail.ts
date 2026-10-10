// Activity filter rail — pure predicates + showing-line token derivation
// (redesign 2026-08-01, mockup B "filter rail", docs/redesign/mockups/2026-08-01/).
//
// The rail is an IA/presentation change over the EXISTING filter model
// (FeedFilter / platform / account / search / cross-tab drills). This module
// adds the two NEW axes (When, Severity) plus the record-kind axis, and the
// derivation of the "Showing N of M" trust-anchor tokens. Everything here is
// pure so the predicates and the token contract are unit-testable without
// mounting the React tree (tests/unit/ui/dashboard/components/filter-rail.test.ts).

import type { ForensicRecord } from '../../../types/forensic';
import type { FeedSource } from '../../../types/post';
import { authorProfileKey } from '../../../forensics/author-store';
import { isPaidPlacement } from '../../../forensics/paid-placement';
import type { AccountFilter, FeedFilter } from './feed-filters';
import { levelOfRecorded, type Level } from '../../../types/mode';

// ── When axis (NEW) — computed from record timestamps, local time ──────────
export type WhenPreset = 'any' | 'today' | 'yesterday' | 'last7' | 'evening';
export const WHEN_OPTIONS: readonly WhenPreset[] = [
  'any', 'today', 'yesterday', 'last7', 'evening',
] as const;

/**
 * A custom window [since, until), until exclusive, both ISO strings or null
 * for an open end. Carried by a cross-tab drill (an Exposure period bar keeps
 * the period it was counted over; wiring audit 13 Sep 2026, finding 5). It is
 * never a rail option: it renders only as a showing-line token with a remove
 * control.
 */
export interface WhenRange { since: string | null; until: string | null }
export type WhenFilter = WhenPreset | WhenRange;

export function isWhenRange(w: WhenFilter): w is WhenRange {
  return typeof w === 'object' && w !== null;
}

/** The drill's window as a WhenRange, or null when neither bound is set. */
export function whenRangeFromDrill(
  since: string | null | undefined, until: string | null | undefined,
): WhenRange | null {
  const s = since ?? null;
  const u = until ?? null;
  if (s === null && u === null) return null;
  return { since: s, until: u };
}

/** True when `r.timestamp` falls in the selected window (local time).
 *  'evening' = local hour 18-23 (the mockup's "Evening (18-24)").
 *  A custom range compares epoch ms: since inclusive, until exclusive.
 *  An unparseable timestamp matches only 'any' — never silently included. */
export function matchesWhen(r: ForensicRecord, when: WhenFilter, now: Date = new Date()): boolean {
  if (when === 'any') return true;
  const d = new Date(r.timestamp);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return false;
  if (isWhenRange(when)) {
    if (when.since !== null) {
      const lo = Date.parse(when.since);
      if (!Number.isFinite(lo) || ms < lo) return false;
    }
    if (when.until !== null) {
      const hi = Date.parse(when.until);
      if (!Number.isFinite(hi) || ms >= hi) return false;
    }
    return true;
  }
  switch (when) {
    case 'today':
      return d.getFullYear() === now.getFullYear()
        && d.getMonth() === now.getMonth()
        && d.getDate() === now.getDate();
    case 'yesterday': {
      const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      return d.getFullYear() === y.getFullYear()
        && d.getMonth() === y.getMonth()
        && d.getDate() === y.getDate();
    }
    case 'last7':
      return ms >= now.getTime() - 7 * 24 * 60 * 60 * 1000;
    case 'evening':
      return d.getHours() >= 18;
  }
}

// ── Severity axis (NEW) — bands over overallScore ──────────────────────────
// Same thresholds as the card severity classes (Dashboard.tsx severityClass):
// high >= 8, medium >= 5, low < 5.
export type SeverityBand = 'high' | 'medium' | 'low';
export const SEVERITY_OPTIONS: readonly SeverityBand[] = ['high', 'medium', 'low'] as const;

export function matchesSeverity(r: ForensicRecord, band: SeverityBand): boolean {
  // An ad has no severity to band, whatever number its record carries
  // (standing decision 1, 2026-09-14). A legacy sponsored-ad record scores 6
  // from the platform's marker, which filled "medium" with advertising and
  // made the rail's own count disagree with what the feed showed.
  if (isPaidPlacement(r)) return false;
  const s = r.overallScore;
  if (!Number.isFinite(s)) return false;
  switch (band) {
    case 'high':   return s >= 8;
    case 'medium': return s >= 5 && s < 8;
    case 'low':    return s < 5;
  }
}

// ── Kind-of-content axis — from record.kind ────────────────────────────────
export type KindFilter = 'posts' | 'comments' | 'videos' | 'images';
export const KIND_OPTIONS: readonly KindFilter[] = [
  'posts', 'comments', 'videos', 'images',
] as const;

export function matchesKind(r: ForensicRecord, kind: KindFilter): boolean {
  switch (kind) {
    case 'posts':    return r.kind === 'post';
    case 'videos':   return r.kind === 'video';
    case 'images':   return r.kind === 'image';
    case 'comments':
      return r.kind === 'comment' || r.kind === 'top-comment'
        || r.kind === 'reply' || r.kind === 'reply-to-reply';
  }
}

// ── Mode axis — from record.userAgeCategory (on every record) ──────────────
// Capability audit 2026-09-06, P0 item 4: mode and model are conditions a
// verdict was reached under; a reader has to be able to hold one fixed.
// By level: a record written before the levels counts under the level its old setting became.
export type ModeFilter = Level;
export const MODE_OPTIONS: readonly ModeFilter[] = ['relaxed', 'moderate', 'strict'] as const;
export function matchesMode(r: ForensicRecord, mode: ModeFilter): boolean {
  return levelOfRecorded(r.userAgeCategory) === mode;
}

// ── Model axis — from record.aiModel (dynamic: the models the chain names) ──
// The option list is derived from the records at hand (modelOptions); a
// record with no aiModel (rules, none, pre-field) sits under MODEL_NONE.
export const MODEL_NONE = '__no-model__';
export function modelKey(r: ForensicRecord): string {
  return r.aiModel && r.aiModel.length > 0 ? r.aiModel : MODEL_NONE;
}
export function matchesModel(r: ForensicRecord, model: string): boolean {
  return modelKey(r) === model;
}
/** Distinct model keys in the set, most records first; MODEL_NONE last when present. */
export function modelOptions(records: readonly ForensicRecord[]): string[] {
  const counts = new Map<string, number>();
  for (const r of records) { const k = modelKey(r); counts.set(k, (counts.get(k) ?? 0) + 1); }
  return [...counts].sort((a, b) =>
    a[0] === MODEL_NONE ? 1 : b[0] === MODEL_NONE ? -1 : b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k]) => k);
}

// ── "What happened" group — the FeedFilter values the rail exposes ─────────
// The kind-shaped FeedFilter values (posts/video/comments/replies) are served
// by the Kind axis instead. 'blocked' is both the #blocked deep-link value
// and a normal rail option, so a removed token can be put back (wiring audit
// 13 Sep 2026, finding 20).
export const RAIL_WHAT_OPTIONS: readonly FeedFilter[] = [
  'all', 'flagged', 'hidden', 'blocked', 'rewritten', 'ai', 'passed',
  'ads', 'repeat-offenders', 'disputed',
] as const;

// ── Surface axis — from record.feedSource (the surface the item sat on) ───
// Only the values present in the record set become rail options.
const SURFACE_OPTIONS: readonly FeedSource[] = [
  'for-you', 'following', 'profile', 'permalink', 'search', 'video', 'manual', 'unknown',
] as const;
export function surfaceKey(r: ForensicRecord): FeedSource {
  const fs = r.feedSource as string | undefined;
  // Older records spell the for-you page without the hyphen.
  if (fs === 'foryou') return 'for-you';
  return (SURFACE_OPTIONS as readonly string[]).includes(fs ?? '') ? (fs as FeedSource) : 'unknown';
}
export function matchesSurface(r: ForensicRecord, surface: FeedSource): boolean {
  return surfaceKey(r) === surface;
}
/** Distinct surfaces present, in SURFACE_OPTIONS order. */
export function surfaceOptions(records: readonly ForensicRecord[]): FeedSource[] {
  const present = new Set<FeedSource>();
  for (const r of records) present.add(surfaceKey(r));
  return SURFACE_OPTIONS.filter((s) => present.has(s));
}

// ── Session axis — record.surfaceSessionId, one content-script load ───────
export function matchesSession(r: ForensicRecord, sessionId: string): boolean {
  return r.surfaceSessionId === sessionId;
}

// ── Seen-before axis — the same originalHash on an earlier record ─────────
// Computed once over the WHOLE record array (chain order), before any filter,
// so "seen before" means "the chain already holds this text", not "an earlier
// row in the current narrowing holds it".
export type SeenFilter = 'repeat' | 'first';
export const SEEN_OPTIONS: readonly SeenFilter[] = ['repeat', 'first'] as const;
export function computeSeenBeforeIds(records: readonly ForensicRecord[]): Set<string> {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const r of records) {
    const h = r.originalHash;
    if (!h) continue;
    if (seen.has(h)) out.add(r.id); else seen.add(h);
  }
  return out;
}
export function matchesSeen(r: ForensicRecord, seen: SeenFilter, seenBeforeIds: ReadonlySet<string>): boolean {
  return seen === 'repeat' ? seenBeforeIds.has(r.id) : !seenBeforeIds.has(r.id);
}

// ── Author axis — one handle, exact and case-insensitive ──────────────────
// The value is either a bare handle ("@news" / "news") or a platform-scoped
// authorProfileKey ("@news@tiktok"); the Frequent flaggers panel hands over
// the scoped key so a same-handle account on another platform stays out
// (the M18 merge bug class). Never a substring match: "@news" must not open
// posts whose text mentions news (wiring audit 13 Sep 2026, finding 9).
function normalizeAuthorHandle(handle: string): string {
  return handle.trim().replace(/^@/, '').toLowerCase();
}
export function matchesAuthor(r: ForensicRecord, author: string): boolean {
  const a = r.author ?? '';
  if (a.length === 0) return false;
  const want = author.trim();
  if (want.length === 0) return false;
  if (want.toLowerCase() === authorProfileKey(a, r.platform).toLowerCase()) return true;
  const wantNorm = normalizeAuthorHandle(want);
  if (wantNorm.length === 0) return false;
  return normalizeAuthorHandle(a) === wantNorm;
}
/** The handle to print for an author filter value (profile key or handle). */
export function authorFilterHandle(author: string): string {
  const at = author.lastIndexOf('@');
  const handle = at > 0 ? author.slice(0, at) : author;
  return handle.startsWith('@') ? handle : '@' + handle;
}

// ── Showing-line token derivation (the trust anchor) ───────────────────────
// EVERY active narrowing — local rail picks AND drill filters arriving from
// other tabs — must land above the feed as a removable token. No hidden
// narrowing, ever (consideration strings S4 + S5).

type TokenAxis =
  | 'place' | 'what' | 'who' | 'when' | 'when-range' | 'severity' | 'kind' | 'mode' | 'model' | 'search'
  | 'surface' | 'seen' | 'author' | 'session'
  | 'technique' | 'hidden-category' | 'safety' | 'record-ids' | 'room' | 'hour';

export interface ShowingToken {
  axis: TokenAxis;
  /** Raw value for the axis (label resolution happens in the component). */
  value: string;
  /** Cross-tab drill filters render in purple (came from another tab). */
  drill: boolean;
}

export interface ShowingTokenState {
  filter: FeedFilter;
  platform: string;               // 'all' | platform id
  account: AccountFilter;
  when: WhenFilter;
  severity: SeverityBand | null;
  kind: KindFilter | null;
  mode: ModeFilter | null;
  model: string | null;
  search: string;
  surface: FeedSource | null;
  seen: SeenFilter | null;
  author: string | null;
  session: string | null;
  technique: string | null;
  hiddenCategory: string | null;
  safetyBucket: string | null;
  recordIdsCount: number | null;  // size of the drilled id set, or null
  roomUrl: string | null;
  hourRange: [number, number] | null;
}

export function formatHourRange([lo, hi]: [number, number]): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(lo)}:00-${p(hi)}:59`;
}

/** Token value for a custom window: "since..until" with the raw ISO bounds
 *  (empty for an open end). The component formats the dates for display. */
function whenRangeValue(w: WhenRange): string {
  return `${w.since ?? ''}..${w.until ?? ''}`;
}

export function deriveShowingTokens(s: ShowingTokenState): ShowingToken[] {
  const out: ShowingToken[] = [];
  if (s.platform !== 'all') out.push({ axis: 'place', value: s.platform, drill: false });
  if (s.filter !== 'all') out.push({ axis: 'what', value: s.filter, drill: false });
  if (s.account !== 'all') out.push({ axis: 'who', value: s.account, drill: false });
  if (isWhenRange(s.when)) out.push({ axis: 'when-range', value: whenRangeValue(s.when), drill: true });
  else if (s.when !== 'any') out.push({ axis: 'when', value: s.when, drill: false });
  if (s.severity) out.push({ axis: 'severity', value: s.severity, drill: false });
  if (s.kind) out.push({ axis: 'kind', value: s.kind, drill: false });
  if (s.mode) out.push({ axis: 'mode', value: s.mode, drill: false });
  if (s.model) out.push({ axis: 'model', value: s.model, drill: false });
  if (s.search.trim().length > 0) out.push({ axis: 'search', value: s.search.trim(), drill: false });
  if (s.surface) out.push({ axis: 'surface', value: s.surface, drill: false });
  if (s.seen) out.push({ axis: 'seen', value: s.seen, drill: false });
  if (s.author) out.push({ axis: 'author', value: s.author, drill: false });
  if (s.session) out.push({ axis: 'session', value: s.session, drill: true });
  if (s.technique) out.push({ axis: 'technique', value: s.technique, drill: true });
  if (s.hiddenCategory) out.push({ axis: 'hidden-category', value: s.hiddenCategory, drill: true });
  if (s.safetyBucket) out.push({ axis: 'safety', value: s.safetyBucket, drill: true });
  if (s.recordIdsCount !== null) out.push({ axis: 'record-ids', value: String(s.recordIdsCount), drill: true });
  if (s.roomUrl) out.push({ axis: 'room', value: s.roomUrl, drill: true });
  if (s.hourRange) out.push({ axis: 'hour', value: formatHourRange(s.hourRange), drill: true });
  return out;
}
