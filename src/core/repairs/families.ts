// Finder families: the lists a repair file may change (11 Oct 2026).
//
// A finder family is a named list a finder reads: the selectors that find YouTube's count text, the words that mark an
// ad. The code keeps its list as the default and reads it through selectorFamily or wordFamily; a signed repair file
// (format.ts, signed.ts) may add to a family, take an entry out, or switch it off, and nothing else. The merged list is
// what the finder uses from then on.
//
// What an "add" has to be, checked when it is first read on a page and not before:
//   - a selector: closed characters, specific, compiles here, matches at most MAX_MATCHES elements on this page, and
//     none of them is the page, a landmark or holds one. A selector that fails any of these is dropped for this page and
//     counted in the finder ledger.
//   - a word: letters, digits, spaces and a little punctuation, short.
// A "remove" must name an entry the default list holds, exactly. A family registered as protective takes additions only,
// so a repair can widen a protection and never narrow it. A family a package does not read is ignored.

import { LANDMARK_SELECTOR } from '../hide-sanity';
import { isSafeRepairSelector, isSafeRepairWord, type RepairEntry, type RepairFile } from './format';

type FamilyKind = 'selector' | 'word';

interface Registered {
  readonly kind: FamilyKind;
  readonly protective: boolean;
  /** The shortest word a repair may add; a stem matched inside text needs more than a whole-label word. */
  readonly minLength: number;
  /** The list the code ships, kept so a report can say what the repair changed. */
  readonly defaults: readonly string[];
}

// Where the families say what a repair did (added, removed, refused). The layer above this one connects it to the finder
// ledger; core may not import diagnostics.
let sink: (key: string) => void = () => {};

/** Connect the events a repair causes to the finder ledger (or to a test). */
export function setRepairEventSink(next: (key: string) => void): void {
  sink = next;
}

/** A selector from a repair that matches more than this many elements on one page is too broad. */
const MAX_MATCHES = 300;

const registry = new Map<string, Registered>();
const merged = new Map<string, readonly string[]>();
let entries: ReadonlyMap<string, RepairEntry> = new Map();
let activeVersion = 0;

function selectorIsSane(selector: string): boolean {
  if (!isSafeRepairSelector(selector)) return false;
  if (typeof document === 'undefined') return false;
  try {
    const hits = document.querySelectorAll(selector);
    if (hits.length > MAX_MATCHES) return false;
    const landmark = LANDMARK_SELECTOR;
    for (const el of Array.from(hits)) {
      if (el === document.body || el === document.documentElement) return false;
      if (el.matches(landmark) || el.querySelector(landmark)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function mergeFamily(id: string, defaults: readonly string[], info: Registered): readonly string[] {
  const entry = entries.get(id);
  if (!entry) return defaults;
  if (entry.off && !info.protective) {
    sink(`repaired.${id}.off`);
    return [];
  }
  let list = defaults;
  if (entry.remove.length > 0 && !info.protective) {
    const gone = new Set(entry.remove.filter((r) => defaults.includes(r)));
    if (gone.size > 0) {
      list = defaults.filter((d) => !gone.has(d));
      sink(`repaired.${id}.removed`);
    }
  }
  const accepted: string[] = [];
  for (const candidate of entry.add) {
    const ok = info.kind === 'selector' ? selectorIsSane(candidate) : isSafeRepairWord(candidate, info.minLength);
    if (!ok) { sink(`repaired.${id}.refused`); continue; }
    if (!list.includes(candidate) && !accepted.includes(candidate)) accepted.push(candidate);
  }
  if (accepted.length > 0) sink(`repaired.${id}.added`);
  return accepted.length > 0 ? [...list, ...accepted] : list;
}

// Called on hot paths (every candidate element of a scan), so a family nobody repaired costs two map lookups and
// allocates nothing.
function read(id: string, defaults: readonly string[], kind: FamilyKind, protective: boolean, minLength: number): readonly string[] {
  if (!registry.has(id)) registry.set(id, { kind, protective, minLength, defaults });
  if (!entries.has(id)) return defaults;
  const hit = merged.get(id);
  if (hit) return hit;
  const list = mergeFamily(id, defaults, registry.get(id)!);
  merged.set(id, list);
  return list;
}

/** The selectors of family `id`: the defaults, changed by the repair file in force. */
export function selectorFamily(id: string, defaults: readonly string[]): readonly string[] {
  return read(id, defaults, 'selector', false, 0);
}

export interface WordFamilyOptions {
  /** A protective list takes additions only: a repair can widen a protection and never narrow it. */
  readonly protective?: boolean;
  /** The shortest word a repair may add. Defaults to 2; a list of stems matched inside text should ask for more. */
  readonly minLength?: number;
}

/** The words of family `id`. */
export function wordFamily(id: string, defaults: readonly string[], options: WordFamilyOptions = {}): readonly string[] {
  return read(id, defaults, 'word', options.protective === true, options.minLength ?? 2);
}

/**
 * Put a verified repair file in force (null clears it). A file with a lower version than the one in force is ignored, so
 * an old copy cannot undo a newer repair. Returns whether it was applied.
 */
export function applyRepairFile(file: RepairFile | null): boolean {
  if (file === null) {
    entries = new Map();
    activeVersion = 0;
    merged.clear();
    return true;
  }
  if (file.version < activeVersion) return false;
  const next = new Map<string, RepairEntry>();
  for (const entry of file.entries) next.set(entry.family, entry);
  entries = next;
  activeVersion = file.version;
  merged.clear();
  return true;
}

/** The version of the repair file in force, 0 when none. */
export function activeRepairVersion(): number {
  return activeVersion;
}

/** Every family a finder has read so far, with its kind. For the report and the tests. */
export function knownFamilies(): ReadonlyMap<string, FamilyKind> {
  return new Map(Array.from(registry, ([id, info]) => [id, info.kind] as const));
}

export interface FamilyLists {
  readonly id: string;
  readonly kind: FamilyKind;
  readonly defaults: readonly string[];
  /** The list in force: the defaults, changed by the repair file when one names this family. */
  readonly active: readonly string[];
}

/** The lists of every family a finder has read so far, as shipped and as in force. For the page report. */
export function describeFamilies(): FamilyLists[] {
  return Array.from(registry, ([id, info]) => ({
    id,
    kind: info.kind,
    defaults: info.defaults,
    active: entries.has(id) ? (merged.get(id) ?? info.defaults) : info.defaults,
  }));
}

/** Test hook: back to no repair, no family known. */
export function __resetRepairsForTest(): void {
  entries = new Map();
  activeVersion = 0;
  merged.clear();
  registry.clear();
}
