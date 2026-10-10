// FeelingWise - reconciling the record against the platform's own export
// (evidence-gap register item 10, 2026-09-06).
//
// Everything the chain does - signing, chaining, anchoring - operates over
// bytes this device produced, so none of it can answer "did this post exist on
// the platform". The platform's own GDPR export can: the parent requests it,
// the platform sends it, and it is the one corroborating document the parent
// cannot make or alter. This module joins such an export to the chain locally.
// The archive is read in the page and never stored, never uploaded, and
// nothing from it enters a record; what survives the join is counts.
//
// Three corrections to the register's plan, from reading what these archives
// actually contain rather than what would be convenient:
//
// 1. There is no post id to join on. The chain stores author, postUrl,
//    platform and timestamp and no platform post id, and Meta's "posts you've
//    seen" list carries an author and an instant and usually no link at all.
//    So the join is: a permalink when both sides have one, and otherwise the
//    author plus a time window, stated in the output and never hidden.
// 2. No recall number is emitted. Meta's list is partial by Meta's own
//    admission and its retention is short, so "chain records over items the
//    archive says were served" would be a made-up denominator that reads as a
//    measurement. Counts are reported, each with the window it was counted in,
//    and the corroborated count is a floor.
// 3. X's archive is recognised and reconciles nothing. It carries the
//    account's own tweets and its ad impressions, not a list of what the feed
//    served, so there is nothing there to join a viewed post against. That is
//    said in the output rather than shipped as an empty section that looks
//    like a failure to match.
//
// Formats, by documented shape and never by file name (a renamed file is still
// what it is, and a file named posts_viewed.json need not be one):
//   Meta (Facebook and Instagram "Download your information", JSON)
//     any key beginning impressions_history_, whose entries carry
//     string_map_data with an author-ish label and a unix timestamp.
//   Meta, the same export in HTML (the format the owner's own request came
//     back in on 2026-09-06, 575 feed impressions, no JSON offered on the
//     download screen): one <section> per entry holding a table of label
//     and value cells (Event, URL, Time in an English export; labels follow
//     the export language). The time is a wall-clock string in the account's
//     zone, read here as this computer's zone; the note says so.
//   TikTok ("Download your data", JSON)
//     Activity -> "Video Browsing History" -> VideoList [{Date, Link}].
//   X (archive, JS-wrapped JSON)
//     window.YTD.<name>.part0 = [...]  - recognised, joins nothing.
//
// Measured on one real Facebook export in HTML against the whole record that
// account's install kept (the counts-only reconcile-on-archive script among the
// private research tools): 162 files outside the export's viewing log passed
// the HTML shape test and added the account's own activity as sightings, and
// the viewing log named a few hundred items over months in which the record
// held tens of thousands, so "not mentioned" described the platform's partial
// list and not the record.
// The dashboard therefore offers no comparison. This file stays for the
// measurement script and the tests; a record that already carries a
// reconciliation marker still prints it in the export.

import type { ForensicRecord } from '../types/forensic';
import { isSystemMarkerRecord } from './system-records';

type ArchivePlatform = 'facebook' | 'instagram' | 'tiktok' | 'twitter';

/** One thing the platform says the account saw. */
interface ArchiveItem {
  platform: ArchivePlatform;
  /** The author as the archive spells it; empty when the archive names none. */
  author: string;
  /** The platform's own permalink, when the archive carries one. */
  url?: string;
  /** The platform's own instant. */
  atISO: string;
  /** Which file and which list it came from, so a reader can find it again. */
  source: string;
}

interface RecognisedFile {
  name: string;
  shape: 'meta-impressions' | 'meta-html' | 'tiktok-browsing-history' | 'x-archive';
  items: number;
  /** Set when the shape is understood and carries nothing to join against. */
  note?: string;
}

export interface ArchiveIndex {
  items: ArchiveItem[];
  recognised: RecognisedFile[];
  /** Files whose shape was not recognised, named so nothing is ignored silently. */
  unrecognised: string[];
  /**
   * The platforms the recognised files speak for, by the rule the parsers use. A recognised
   * file that lists nothing still covers its platform: the export was asked about it and said
   * nothing, which is what 'not mentioned in it' means (2026-09-20). Optional so an index
   * built by hand in a test reads as one that covers what its items name.
   */
  coveredPlatforms?: string[];
  /** The window the archive itself covers, from the items it carried. */
  fromISO?: string;
  toISO?: string;
}

export interface ArchiveFile { name: string; text: string }

const MAX_ARCHIVE_CHARS = 64 * 1024 * 1024;

/** Read one or more archive files into a flat index. Never throws on bad input. */
export function parseArchiveFiles(files: ReadonlyArray<ArchiveFile>): ArchiveIndex {
  const items: ArchiveItem[] = [];
  const recognised: RecognisedFile[] = [];
  const unrecognised: string[] = [];
  const covered = new Set<ArchivePlatform>();
  for (const file of files) {
    if (file.text.length > MAX_ARCHIVE_CHARS) { unrecognised.push(file.name); continue; }
    const parsed = parseOne(file);
    if (!parsed) { unrecognised.push(file.name); continue; }
    const platform: ArchivePlatform = parsed.shape === 'x-archive' ? 'twitter'
      : parsed.shape === 'tiktok-browsing-history' ? 'tiktok'
        : /instagram/i.test(file.name) ? 'instagram' : 'facebook';
    covered.add(platform);
    recognised.push({ name: file.name, shape: parsed.shape, items: parsed.items.length, ...(parsed.note ? { note: parsed.note } : {}) });
    items.push(...parsed.items);
  }
  items.sort((a, b) => (a.atISO < b.atISO ? -1 : a.atISO > b.atISO ? 1 : 0));
  return {
    items,
    recognised,
    unrecognised,
    coveredPlatforms: [...covered].sort(),
    ...(items.length > 0 ? { fromISO: items[0].atISO, toISO: items[items.length - 1].atISO } : {}),
  };
}

interface ParsedFile { shape: RecognisedFile['shape']; items: ArchiveItem[]; note?: string }

function parseOne(file: ArchiveFile): ParsedFile | null {
  const x = parseXArchive(file);
  if (x) return x;
  if (/^\s*<(!doctype|html)/i.test(file.text)) return parseMetaHtml(file.name, file.text);
  let json: unknown;
  try {
    json = JSON.parse(file.text);
  } catch {
    return null;
  }
  return parseMetaImpressions(file.name, json) ?? parseTikTokBrowsingHistory(file.name, json);
}

// --- Meta -----------------------------------------------------------------

/**
 * Meta writes each viewing history under its own `impressions_history_*` key.
 * An entry carries `string_map_data`, a label-to-value map whose labels are
 * localised, so the author is taken from the first label that reads like one
 * and the instant from whatever timestamp the entry carries.
 */
function parseMetaImpressions(name: string, json: unknown): ParsedFile | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const obj = json as Record<string, unknown>;
  const keys = Object.keys(obj).filter(k => k.startsWith('impressions_history_') && Array.isArray(obj[k]));
  if (keys.length === 0) return null;
  const platform: ArchivePlatform = /instagram/i.test(name) ? 'instagram' : 'facebook';
  const items: ArchiveItem[] = [];
  for (const key of keys) {
    for (const entry of obj[key] as unknown[]) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      const at = unixToISO(findTimestamp(e));
      if (!at) continue;
      const url = metaUrl(e);
      items.push({
        platform,
        author: metaAuthor(e),
        ...(url ? { url } : {}),
        atISO: at,
        source: `${name}:${key}`,
      });
    }
  }
  if (items.length === 0) return null;
  return { shape: 'meta-impressions', items };
}

/**
 * Meta's HTML export. Every entry is a <table> of rows; a labelled row is a
 * label cell followed by a value cell, and a URL row is a label cell spanning
 * both columns with the address in an anchor. The reader takes, per table,
 * the first value that reads as a time, the first anchor address, and the
 * first remaining text as the author, with the possessive tail ("X's post")
 * removed. A table with no readable time is not an entry. No other file of
 * the export has this row shape with a time, so a settings page or a media
 * index reads as nothing rather than as sightings.
 */
function parseMetaHtml(name: string, html: string): ParsedFile | null {
  if (!/<td class="_a6_q">/.test(html)) return null;
  const platform: ArchivePlatform = /instagram/i.test(name) ? 'instagram' : 'facebook';
  const items: ArchiveItem[] = [];
  const tables = html.split(/<table\b/i).slice(1);
  for (const table of tables) {
    const body = table.slice(0, table.indexOf('</table>') >= 0 ? table.indexOf('</table>') : table.length);
    let atISO: string | undefined;
    let url: string | undefined;
    let author = '';
    const pair = /<td class="_a6_q">([^<]*)<\/td>\s*<td class="_2piu _a6_r">([^<]*)<\/td>/g;
    let m: RegExpExecArray | null;
    while ((m = pair.exec(body)) !== null) {
      const value = decodeEntities(m[2]).replace(/\s+/g, ' ').trim();
      if (!value) continue;
      if (!atISO) { const t = metaWallClockToISO(value); if (t) { atISO = t; continue; } }
      if (!author) author = value.replace(/['’]s (post|video|photo|reel|story|comment|live video)\s*$/i, '').trim();
    }
    const link = /<td colspan="2" class="_a6_q">[^<]*<div><a [^>]*href="([^"]+)"/i.exec(body);
    if (link && /^https?:\/\//i.test(link[1])) url = decodeEntities(link[1]);
    if (!atISO) continue;
    items.push({ platform, author, ...(url ? { url } : {}), atISO, source: `${name}:html` });
  }
  if (items.length === 0) return null;
  return { shape: 'meta-html', items, note: "times are the export's wall clock, read in this computer's time zone" };
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

/** "Aug 31, 2026 10:03:20 pm" (Meta's HTML export) to ISO, as local time. Null for anything else. */
function metaWallClockToISO(value: string): string | undefined {
  const m = /^([A-Za-z]{3,4})\.? (\d{1,2}), (\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(value.trim());
  if (!m) return undefined;
  const month = MONTHS[m[1].toLowerCase()];
  if (month === undefined) return undefined;
  let hour = Number(m[4]);
  const ampm = m[7]?.toLowerCase();
  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  const d = new Date(Number(m[3]), month, Number(m[2]), hour, Number(m[5]), Number(m[6] ?? 0));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function decodeEntities(s: string): string {
  return s.replace(/&#0*39;|&#x27;|&apos;/gi, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

const AUTHOR_LABEL = /^(author|publisher|name|account|profile)$/i;
const URL_LABEL = /(link|url|permalink)/i;

function metaAuthor(entry: Record<string, unknown>): string {
  const map = entry.string_map_data;
  if (!map || typeof map !== 'object') return '';
  for (const [label, value] of Object.entries(map as Record<string, unknown>)) {
    if (!AUTHOR_LABEL.test(label)) continue;
    const v = (value as { value?: unknown })?.value;
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function metaUrl(entry: Record<string, unknown>): string | undefined {
  const map = entry.string_map_data;
  if (!map || typeof map !== 'object') return undefined;
  for (const [label, value] of Object.entries(map as Record<string, unknown>)) {
    if (!URL_LABEL.test(label)) continue;
    const v = (value as { value?: unknown })?.value;
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) return v;
  }
  return undefined;
}

/** The first unix timestamp anywhere in the entry; Meta puts it in several places. */
function findTimestamp(value: unknown, depth = 0): number | undefined {
  if (depth > 4 || !value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  const own = obj.timestamp;
  if (typeof own === 'number' && own > 0) return own;
  for (const v of Object.values(obj)) {
    const found = findTimestamp(v, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function unixToISO(seconds: number | undefined): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  // Meta writes seconds; a value large enough to be milliseconds is read as such.
  const ms = seconds > 1e12 ? seconds : seconds * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

// --- TikTok ---------------------------------------------------------------

/**
 * TikTok's browsing history is what the account WATCHED, which is a subset of
 * what it was served; it carries a link and a local-time date string and no
 * author. The date has no zone, so it is read as UTC and the time window
 * absorbs the difference - stated, not hidden.
 */
function parseTikTokBrowsingHistory(name: string, json: unknown): ParsedFile | null {
  if (!json || typeof json !== 'object') return null;
  const activity = (json as Record<string, unknown>).Activity;
  if (!activity || typeof activity !== 'object') return null;
  const items: ArchiveItem[] = [];
  for (const [listName, list] of Object.entries(activity as Record<string, unknown>)) {
    if (!list || typeof list !== 'object') continue;
    const videoList = (list as Record<string, unknown>).VideoList;
    if (!Array.isArray(videoList)) continue;
    for (const raw of videoList) {
      if (!raw || typeof raw !== 'object') continue;
      const v = raw as Record<string, unknown>;
      const at = tiktokDateToISO(typeof v.Date === 'string' ? v.Date : undefined);
      if (!at) continue;
      items.push({
        platform: 'tiktok',
        author: '',
        ...(typeof v.Link === 'string' && v.Link ? { url: v.Link } : {}),
        atISO: at,
        source: `${name}:${listName}`,
      });
    }
  }
  if (items.length === 0) return null;
  return { shape: 'tiktok-browsing-history', items };
}

function tiktokDateToISO(date: string | undefined): string | undefined {
  if (!date) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(date.trim());
  if (!m) return undefined;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

// --- X --------------------------------------------------------------------

/**
 * X's archive is JS: `window.YTD.<name>.part0 = [ ... ]`. It carries the
 * account's own tweets, its likes and its ad impressions - not a list of what
 * the timeline served - so it is recognised and reconciles nothing. Saying so
 * is the point; an empty section would read as a failure to match.
 */
function parseXArchive(file: ArchiveFile): ParsedFile | null {
  if (!/^\s*window\.YTD\./.test(file.text)) return null;
  return {
    shape: 'x-archive',
    items: [],
    note: "X's archive lists this account's own activity, not what its timeline served, so there is nothing here to reconcile a viewed post against.",
  };
}

// --- the join -------------------------------------------------------------

export const DEFAULT_WINDOW_MINUTES = 15;

export interface ReconcileOptions {
  /** How far apart an archive instant and a capture may be and still be the same sighting. */
  windowMinutes?: number;
}

interface ReconcileCounts {
  /** Records that matched an archive item on a permalink. */
  corroboratedByUrl: number;
  /** Records that matched on author and time only. */
  corroboratedByAuthorAndTime: number;
  /** Sightings inside the compared period that matched nothing. Housekeeping markers are not in here. */
  unmatchedRecords: number;
  /** Archive items inside the compared period that matched no record. */
  unmatchedArchiveItems: number;
  /** Records outside the window the archive covers; neither side can speak for these. */
  recordsOutsideWindow: number;
  /**
   * Archive items outside the period the recorder itself covers, and so
   * outside anything it could have contradicted. The symmetric partner of
   * recordsOutsideWindow, which had no counterpart before 2026-09-18.
   */
  archiveItemsOutsideCoverage: number;
  /**
   * Chain-housekeeping markers dropped before any counting, so the population
   * the other counts are over is stated rather than implied.
   */
  systemMarkersExcluded: number;
  /**
   * Records in the compared period that matched nothing, on a platform the archive
   * carried no item from. Until 2026-09-20 they were counted as unmatched, so compared
   * with one platform's export a record of another counted as "not mentioned in
   * it": on a chain built by the product, 8 of 11 such records were YouTube
   * records against an export that named another platform. Counted here so every
   * record is still in exactly one count. Not written into the signed marker,
   * whose text is fixed by FORMAT.md section 2.
   */
  recordsOnOtherPlatforms: number;
}

export interface ReconcileResult {
  counts: ReconcileCounts;
  windowMinutes: number;
  /** The window the archive itself covers. Not the period the counts are over. */
  fromISO?: string;
  toISO?: string;
  /**
   * The period the counts are actually over: the archive's own window met with
   * the recorder's own. Absent when the two do not overlap at all, which is
   * the honest reading of an export that predates the install.
   */
  comparedFromISO?: string;
  comparedToISO?: string;
  /** Per platform, so a platform that reconciles nothing is visibly not a failure. */
  byPlatform: Record<string, { records: number; archiveItems: number; corroborated: number }>;
  recognised: RecognisedFile[];
  unrecognised: string[];
  /** Ids of the corroborated records, for the export's per-card mark. */
  corroboratedIds: string[];
}

/**
 * Join the chain to the archive. A permalink match is taken first and is
 * exact; what is left is paired author-and-platform by smallest time
 * difference, each record and each item used once, so no count can exceed the
 * smaller of the two sets. Nothing from the archive is written anywhere.
 *
 * Two corrections from a read of the section's own sentences (2026-09-18),
 * both of which inflated the least flattering numbers on the page:
 *
 * 1. Every record entered the window, housekeeping markers included. A
 *    heartbeat, a gap, a prune, a rotation, a reset, an import, a repair, a
 *    redaction and an earlier reconciliation carry no author and no address,
 *    so none of them can ever match an archive item, and every one of them
 *    landed in unmatchedRecords, which the export presents as records the
 *    platform does not corroborate. They are evidence about the chain and
 *    never about the feed (system-records.ts says so for every other
 *    aggregation), so they are dropped before anything is counted and the
 *    number dropped is reported.
 * 2. Records were filtered to the archive's window and archive items were
 *    filtered to nothing. An install a week old against a ninety-day export
 *    counted eighty-three days of the platform's own impressions as things
 *    the recorder has no record of, which is true only in the sense that the
 *    recorder did not exist yet. Items are now held to the recorder's own
 *    coverage exactly as records are held to the archive's, and what falls
 *    outside is counted under its own name rather than folded into the
 *    unmatched figure.
 *
 * The join itself is unchanged. Both corrections are about which side of the
 * ledger a thing is written on, not about what matches what.
 */
export function reconcile(
  records: ReadonlyArray<ForensicRecord>,
  index: ArchiveIndex,
  options: ReconcileOptions = {},
): ReconcileResult {
  const windowMinutes = options.windowMinutes ?? DEFAULT_WINDOW_MINUTES;
  const windowMs = windowMinutes * 60 * 1000;
  const from = index.fromISO ? Date.parse(index.fromISO) : NaN;
  const to = index.toISO ? Date.parse(index.toISO) : NaN;

  const counts: ReconcileCounts = {
    corroboratedByUrl: 0,
    corroboratedByAuthorAndTime: 0,
    unmatchedRecords: 0,
    unmatchedArchiveItems: 0,
    recordsOutsideWindow: 0,
    archiveItemsOutsideCoverage: 0,
    systemMarkersExcluded: 0,
    recordsOnOtherPlatforms: 0,
  };
  const byPlatform: ReconcileResult['byPlatform'] = {};
  const bump = (p: string, field: 'records' | 'archiveItems' | 'corroborated'): void => {
    byPlatform[p] = byPlatform[p] ?? { records: 0, archiveItems: 0, corroborated: 0 };
    byPlatform[p][field]++;
  };
  for (const item of index.items) bump(item.platform, 'archiveItems');

  // The population the counts are over: sightings, never the chain's own
  // housekeeping. byPlatform counts it too, so the per-platform table and the
  // totals are over one set and not two.
  const population: ForensicRecord[] = [];
  for (const r of records) {
    if (isSystemMarkerRecord(r)) { counts.systemMarkersExcluded++; continue; }
    population.push(r);
  }

  const inWindow: ForensicRecord[] = [];
  for (const r of population) {
    const t = Date.parse(r.timestamp);
    if (!Number.isFinite(t) || !Number.isFinite(from) || !Number.isFinite(to) || t < from - windowMs || t > to + windowMs) {
      counts.recordsOutsideWindow++;
      continue;
    }
    inWindow.push(r);
    bump(r.platform, 'records');
  }

  // The recorder's own coverage, from the population's own timestamps. An item
  // further than the tolerance from either end is outside anything this
  // install could have contradicted. A record cannot fall outside this by
  // construction, which is why the record side needs no second gate.
  let coverageFrom = Number.POSITIVE_INFINITY;
  let coverageTo = Number.NEGATIVE_INFINITY;
  for (const r of population) {
    const t = Date.parse(r.timestamp);
    if (!Number.isFinite(t)) continue;
    if (t < coverageFrom) coverageFrom = t;
    if (t > coverageTo) coverageTo = t;
  }
  const hasCoverage = coverageFrom <= coverageTo;
  const itemInCoverage = index.items.map(item => {
    if (!hasCoverage) return false;
    const t = Date.parse(item.atISO);
    return Number.isFinite(t) && t >= coverageFrom - windowMs && t <= coverageTo + windowMs;
  });

  const usedItems = new Set<number>();
  const matched = new Set<string>();
  const corroboratedIds: string[] = [];

  // Pass 1: permalinks. An exact address on both sides is the strong match.
  const itemByUrl = new Map<string, number[]>();
  index.items.forEach((item, i) => {
    const key = urlKey(item.url);
    if (!key) return;
    const list = itemByUrl.get(key) ?? [];
    list.push(i);
    itemByUrl.set(key, list);
  });
  for (const r of inWindow) {
    const key = urlKey(r.postUrl);
    if (!key) continue;
    const candidates = itemByUrl.get(key);
    if (!candidates) continue;
    const free = candidates.find(i => !usedItems.has(i));
    if (free === undefined) continue;
    usedItems.add(free);
    matched.add(r.id);
    corroboratedIds.push(r.id);
    counts.corroboratedByUrl++;
    bump(r.platform, 'corroborated');
  }

  // Pass 2: same platform, same author, closest in time inside the window.
  const pairs: Array<{ diff: number; recordId: string; platform: string; item: number }> = [];
  for (const r of inWindow) {
    if (matched.has(r.id)) continue;
    const author = authorKey(r.author);
    if (!author) continue;
    const t = Date.parse(r.timestamp);
    index.items.forEach((item, i) => {
      if (usedItems.has(i)) return;
      if (item.platform !== r.platform) return;
      const itemAuthor = authorKey(item.author);
      if (!itemAuthor || itemAuthor !== author) return;
      const diff = Math.abs(Date.parse(item.atISO) - t);
      if (!Number.isFinite(diff) || diff > windowMs) return;
      pairs.push({ diff, recordId: r.id, platform: r.platform, item: i });
    });
  }
  pairs.sort((a, b) => a.diff - b.diff);
  for (const pair of pairs) {
    if (matched.has(pair.recordId) || usedItems.has(pair.item)) continue;
    matched.add(pair.recordId);
    usedItems.add(pair.item);
    corroboratedIds.push(pair.recordId);
    counts.corroboratedByAuthorAndTime++;
    bump(pair.platform, 'corroborated');
  }

  // A record that matched nothing, on a platform the archive carried no item from, is
  // not 'not mentioned in it': an export says nothing about another platform's feed. It
  // stays in the per-platform table, where a platform that reconciles nothing is visibly
  // not a failure, and an address may still corroborate across platforms above. It is
  // only kept out of the one number that reads as a finding.
  // A platform the archive covers: one it carried an item from, or one a recognised file
  // speaks for even when that file listed nothing.
  const archivePlatforms = new Set<string>([
    ...index.items.map((item) => item.platform),
    ...(index.coveredPlatforms ?? []),
  ]);
  let otherPlatform = 0;
  if (archivePlatforms.size > 0) {
    for (const r of inWindow) if (!matched.has(r.id) && !archivePlatforms.has(r.platform)) otherPlatform++;
  }
  counts.recordsOnOtherPlatforms = otherPlatform;
  counts.unmatchedRecords = inWindow.length - matched.size - otherPlatform;
  // Three buckets over one set, so they add up to every item the archive
  // carried: corroborated, unspoken for inside the overlap, and outside what
  // the recorder covers. A permalink match is allowed at any distance in time,
  // so a used item can sit outside the coverage window; it is corroborating
  // either way and is counted as neither of the other two.
  index.items.forEach((_item, i) => {
    if (usedItems.has(i)) return;
    if (itemInCoverage[i]) counts.unmatchedArchiveItems++;
    else counts.archiveItemsOutsideCoverage++;
  });

  // The period both sides could speak for. Where the two spans overlap it is
  // that overlap and nothing is added to it: the tolerance belongs to the
  // join, and padding a stated period by it would claim time neither side
  // carries anything from. Where they do not overlap the period is the gap
  // between them, and only while that gap is inside the tolerance, which is
  // the one case in which a capture and an entry could still have paired
  // across it. A wider gap means the export and this install never met, and
  // that is said by leaving the period out rather than by inventing one.
  // (Written first as the bare intersection, which reported nothing for a
  // capture thirty seconds past the archive's last entry although the join
  // had just paired the two.)
  const spanLo = Math.max(from, coverageFrom);
  const spanHi = Math.min(to, coverageTo);
  const spansMeet = spanLo <= spanHi;
  const bridged = !spansMeet && spanLo - spanHi <= windowMs;
  const comparedFrom = spansMeet ? spanLo : spanHi;
  const comparedTo = spansMeet ? spanHi : spanLo;
  const overlaps = hasCoverage && Number.isFinite(from) && Number.isFinite(to) && (spansMeet || bridged);

  return {
    counts,
    windowMinutes,
    ...(index.fromISO ? { fromISO: index.fromISO } : {}),
    ...(index.toISO ? { toISO: index.toISO } : {}),
    ...(overlaps ? { comparedFromISO: new Date(comparedFrom).toISOString(), comparedToISO: new Date(comparedTo).toISOString() } : {}),
    byPlatform,
    recognised: index.recognised,
    unrecognised: index.unrecognised,
    corroboratedIds: corroboratedIds.sort(),
  };
}

/**
 * The comparable form of a permalink: host without www, path without a
 * trailing slash, no query and no fragment. Platforms hang tracking
 * parameters off the same address and a match must survive them.
 */
export function urlKey(url: string | undefined): string | undefined {
  if (!url || !/^https?:\/\//i.test(url)) return undefined;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '');
    if (!path) return undefined;
    return `${host}${path}`;
  } catch {
    return undefined;
  }
}

/** The comparable form of an author: no leading @, lower case, collapsed spaces. */
export function authorKey(author: string | undefined): string | undefined {
  if (!author) return undefined;
  const key = author.trim().replace(/^@+/, '').replace(/\s+/g, ' ').toLowerCase();
  // 'unknown' is what the capture writes when it did not read one; it is not a
  // name and must never join two records together (register item 19).
  if (!key || key === 'unknown') return undefined;
  return key;
}
