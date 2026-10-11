// Echo groups: the same wording from several accounts inside a few days (the owner's idea, 11 Oct 2026).
//
// A fixed rule over what every record already holds, the text, the author and the time. No model, no network, no new
// data. Two items are echoes when their wording overlaps: the share of three-word runs they have in common is at least
// 0.6 (the evidence run on the owner's own record found 0 to 2 groups' difference between 0.6 and 0.8), and both have at
// least eight words, so a greeting or a slogan of three words never counts. Links and @names are taken out first and
// letter case and punctuation do not matter, so a post and its copy with a different link are the same wording.
//
//   - a GROUP is echoes from three or more different accounts inside 72 hours;
//   - a PAIR is echoes from exactly two accounts inside 72 hours, a second output, because two thirds of pairs are word
//     for word copies (a share, a quote) and a person reads them differently;
//   - one account saying the same thing twice is a different finding (repetition) and is not counted here: an account's
//     same wording seen again counts once.
//
// What it says is "this wording came from N accounts in H hours", never bot, network or campaign: many innocent things echo
// (a headline posted by several outlets, a meme, a quote of a viral post), and a count is a lower bound that depends on whom
// the person follows. The result holds no text, only ids, counts, times and word counts, so it can be exported or shown
// without carrying anyone's words.

export interface EchoItem {
  id: string;
  platform: string;
  /** Who said it, as the page names them. An item with no author is left out: it cannot be told from another. */
  author: string;
  /** When it was posted, or failing that when it was seen, in epoch milliseconds. */
  atMs: number;
  text: string;
}

export interface EchoOptions {
  /** Echoes must fall inside this span. Default 72 hours. */
  windowMs?: number;
  /** Items with fewer words are not compared. Default 8. */
  minWords?: number;
  /** Share of three-word runs two items must have in common. Default 0.6. */
  overlap?: number;
  /** Different accounts a group needs. Default 3. */
  minAccounts?: number;
  /** A three-word run found in more than this many items is boilerplate and links nothing. Default 60. */
  commonRunCap?: number;
}

export interface EchoGroup {
  accounts: number;
  /** The ids of the items inside the group's window, in time order. */
  ids: string[];
  firstMs: number;
  lastMs: number;
  platforms: string[];
  /** The shortest and longest wording, in words: the spread "11 to 19 words". */
  wordsMin: number;
  wordsMax: number;
  /** How many different wordings the group holds; 1 means every member is word for word the same. */
  wordings: number;
}

export interface EchoResult {
  groups: EchoGroup[];
  pairs: EchoGroup[];
  /** Items that were long enough, had an author and were not the same account's same wording again. */
  comparable: number;
}

const HOUR_MS = 60 * 60 * 1000;
const URL_RE = /https?:\/\/\S+|www\.\S+/giu;
const MENTION_RE = /@[\p{L}\p{N}_]+/gu;
const NON_WORD_RE = /[^\p{L}\p{N}\s]|_/gu;

function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(URL_RE, ' ')
    .replace(MENTION_RE, ' ')
    .replace(NON_WORD_RE, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/** FNV-1a over a string: a small, stable number for a three-word run. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function runsOf(words: string[]): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i + 3 <= words.length; i++) out.add(hash(`${words[i]} ${words[i + 1]} ${words[i + 2]}`));
  return out;
}

function intersection(a: Set<number>, b: Set<number>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let n = 0;
  for (const r of small) if (large.has(r)) n++;
  return n;
}

interface Candidate {
  item: EchoItem;
  author: string;
  words: number;
  wording: string;
  runs: Set<number>;
}

class Components {
  private readonly parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number): void {
    this.parent[this.find(a)] = this.find(b);
  }
}

/** The span of at most `windowMs` that holds the most different accounts, earliest first on a tie. */
function bestWindow(members: Candidate[], windowMs: number): Candidate[] {
  const sorted = [...members].sort((a, b) => a.item.atMs - b.item.atMs);
  const inside = new Map<string, number>();
  let lo = 0;
  let best: { lo: number; hi: number; accounts: number } = { lo: 0, hi: 0, accounts: 0 };
  for (let hi = 0; hi < sorted.length; hi++) {
    inside.set(sorted[hi].author, (inside.get(sorted[hi].author) ?? 0) + 1);
    while (sorted[hi].item.atMs - sorted[lo].item.atMs > windowMs) {
      const left = sorted[lo].author;
      const n = (inside.get(left) ?? 1) - 1;
      if (n === 0) inside.delete(left);
      else inside.set(left, n);
      lo++;
    }
    if (inside.size > best.accounts) best = { lo, hi, accounts: inside.size };
  }
  return sorted.slice(best.lo, best.hi + 1);
}

function describe(window: Candidate[]): EchoGroup {
  const accounts = new Set(window.map((c) => c.author)).size;
  const words = window.map((c) => c.words);
  return {
    accounts,
    ids: window.map((c) => c.item.id),
    firstMs: window[0].item.atMs,
    lastMs: window[window.length - 1].item.atMs,
    platforms: [...new Set(window.map((c) => c.item.platform))].sort(),
    wordsMin: Math.min(...words),
    wordsMax: Math.max(...words),
    wordings: new Set(window.map((c) => c.wording)).size,
  };
}

export function findEchoGroups(items: readonly EchoItem[], options: EchoOptions = {}): EchoResult {
  const windowMs = options.windowMs ?? 72 * HOUR_MS;
  const minWords = options.minWords ?? 8;
  const overlap = options.overlap ?? 0.6;
  const minAccounts = options.minAccounts ?? 3;
  const commonRunCap = options.commonRunCap ?? 60;

  // In time order, so that an account's same wording seen again keeps its first sighting.
  const ordered = [...items].filter((it) => Number.isFinite(it.atMs)).sort((a, b) => a.atMs - b.atMs);
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const item of ordered) {
    const author = (item.author ?? '').trim().toLowerCase();
    if (!author) continue;
    const words = wordsOf(item.text ?? '');
    if (words.length < minWords) continue;
    const wording = words.join(' ');
    const key = `${author}\u0000${wording}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ item, author, words: words.length, wording, runs: runsOf(words) });
  }

  // How many items hold each run; a run in too many is boilerplate and is not used to find partners.
  const frequency = new Map<number, number>();
  for (const c of candidates) for (const r of c.runs) frequency.set(r, (frequency.get(r) ?? 0) + 1);
  const index = new Map<number, number[]>();
  for (let i = 0; i < candidates.length; i++) {
    for (const r of candidates[i].runs) {
      if ((frequency.get(r) ?? 0) > commonRunCap) continue;
      const list = index.get(r);
      if (list) list.push(i);
      else index.set(r, [i]);
    }
  }

  const parts = new Components(candidates.length);
  const linked = new Set<number>();
  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i];
    const shared = new Map<number, number>();
    for (const r of a.runs) {
      const list = index.get(r);
      if (!list) continue;
      for (const j of list) if (j > i) shared.set(j, (shared.get(j) ?? 0) + 1);
    }
    for (const [j, found] of shared) {
      // Two runs in common through the rare ones is a partner worth measuring; the measure itself counts every run.
      if (found < 2) continue;
      const b = candidates[j];
      if (b.item.atMs - a.item.atMs > windowMs) continue;
      if (b.author === a.author) continue;
      const count = intersection(a.runs, b.runs);
      const union = a.runs.size + b.runs.size - count;
      if (union > 0 && count / union >= overlap) {
        parts.union(i, j);
        linked.add(i);
        linked.add(j);
      }
    }
  }

  const byRoot = new Map<number, Candidate[]>();
  for (const i of linked) {
    const root = parts.find(i);
    const list = byRoot.get(root);
    if (list) list.push(candidates[i]);
    else byRoot.set(root, [candidates[i]]);
  }

  const groups: EchoGroup[] = [];
  const pairs: EchoGroup[] = [];
  for (const members of byRoot.values()) {
    const window = bestWindow(members, windowMs);
    const group = describe(window);
    if (group.accounts >= minAccounts) groups.push(group);
    else if (group.accounts === 2) pairs.push(group);
  }
  const bySize = (a: EchoGroup, b: EchoGroup): number => b.accounts - a.accounts || b.ids.length - a.ids.length || a.firstMs - b.firstMs;
  groups.sort(bySize);
  pairs.sort(bySize);
  return { groups, pairs, comparable: candidates.length };
}
