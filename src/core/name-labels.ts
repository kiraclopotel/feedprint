// Letters in place of account names in what one AI call reads, and the names put back into what
// comes out. The people in a call (the post's author, the thread above, the commenters as shown)
// get tokens "@user_A", "@user_B" ... "@user_Z", "@user_AA" in order of first appearance, so a token
// says only who is who inside that one call and links nobody across calls. The map lives in the
// caller's closure from the prompt build to the restore and is never stored.
//
// The token carries "user_" because bare letters are words in Spanish, Portuguese and Romanian, and
// because the frozen rewrite checks reject a sentence that opens "The user ..." but not "@user_A":
// the word boundary after "user" does not fire before an underscore.
//
// This file sits in core and imports only its siblings, so the prompt builders, the batch scorer,
// the pipeline and the AI client can all reach it without an upward import.

import { detectLanguage } from './lang-detect';

export interface NameLabelEntry {
  /** "@user_A" and so on. */
  token: string;
  /** The account name as the page gave it, without a leading "@"; '' for an unknown writer. */
  handle: string;
  displayName?: string;
  /** True when the page gave no name (the marker the adapter or the bridge wrote instead). */
  unknown: boolean;
}

export interface NameLabelMap {
  /** In token order. */
  readonly entries: readonly NameLabelEntry[];
  /** Folded handle or display name -> entry, for the people the page named. */
  readonly byKey: ReadonlyMap<string, NameLabelEntry>;
  /** Author objects seen when the map was built -> entry, so an unknown writer keeps its own token. */
  readonly byAuthor: WeakMap<object, NameLabelEntry>;
  /** What the callAI check looks for in the finished request: "@handle" and display names. */
  readonly identifiers: readonly string[];
  /** The language the answer comes back in, when the caller knows it. */
  readonly outputLanguage?: string;
}

/** Placeholders the adapters, the bridge and the runners write when a page shows no name. */
const UNKNOWN_MARKERS: ReadonlySet<string> = new Set(['', 'unknown', 'u', 'corpus']);

const ZERO_WIDTH_OR_CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‍⁠﻿‪-‮⁦-⁩]/;
const WORD_CHAR_RE = /[\p{L}\p{N}_]/u;

/** The one key function: strip every leading "@", drop invisible characters, fold case and accents. */
export function foldName(raw: string): string {
  return foldWithMap(raw.trim().replace(/^@+/, '')).folded;
}

/**
 * The key the repeat-poster count uses; null for a marker, so three comments with no name never
 * read as one person writing three times.
 */
export function authorKey(handle: string | undefined | null): string | null {
  const stripped = (handle ?? '').trim().replace(/^@+/, '');
  if (UNKNOWN_MARKERS.has(stripped.toLowerCase())) return null;
  const folded = foldName(stripped);
  return folded.length > 0 ? folded : null;
}

/** Fold a string and remember which original index each folded character came from. */
function foldWithMap(text: string): { folded: string; at: number[] } {
  let folded = '';
  const at: number[] = [];
  let i = 0;
  for (const ch of text) {
    if (!ZERO_WIDTH_OR_CONTROL_RE.test(ch)) {
      const out = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
      for (const o of out) {
        folded += o;
        // One entry per UTF-16 unit: an emoji is two units, and the indexes after it must stay in step.
        for (let k = 0; k < o.length; k += 1) at.push(i);
      }
    }
    i += ch.length;
  }
  at.push(text.length);
  return { folded, at };
}

// ─── The switch the runners set ────────────────────────────────────────────

let stepOn = true;

/**
 * Turns the step off for a measurement arm, so a corpus run can compare the prompt with letters
 * against the prompt with names on the same commit. Nothing in src calls it: a test reads src and
 * says so, so production cannot flip it from a setting, a message or storage.
 */
export function setNameLabelStep(step: 'on' | 'off'): void {
  stepOn = step === 'on';
}

export function isNameLabelStepOn(): boolean {
  return stepOn;
}

// ─── Counts, kept in memory and read by the debug surfaces and the runners ─

export interface NameLabelCounts {
  /** Name spans replaced by tokens in texts. */
  replaced: number;
  /** Input spans that looked like a token and were bent so they cannot pass for one. */
  labelShapedInput: number;
  restored: number;
  bent: number;
  unmatched: number;
  droppedRewrites: number;
  /** Times the last check at the AI client found a known identifier in a finished request. */
  identifierHits: number;
}

const counts: NameLabelCounts = {
  replaced: 0, labelShapedInput: 0, restored: 0, bent: 0, unmatched: 0, droppedRewrites: 0, identifierHits: 0,
};

export function readNameLabelCounts(): NameLabelCounts {
  return { ...counts };
}

export function resetNameLabelCountsForTests(): void {
  for (const k of Object.keys(counts) as Array<keyof NameLabelCounts>) counts[k] = 0;
}

export function noteIdentifierHits(n: number): void {
  counts.identifierHits += n;
}

// ─── Building the map ──────────────────────────────────────────────────────

/** "A" .. "Z", then "AA", "AB" ... */
export function tokenLetters(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function tokenFor(index: number): string {
  return `@user_${tokenLetters(index)}`;
}

interface AuthorLike {
  handle: string;
  display_name?: string;
}

class MapBuilder {
  readonly entries: NameLabelEntry[] = [];
  readonly byKey = new Map<string, NameLabelEntry>();
  readonly byAuthor = new WeakMap<object, NameLabelEntry>();

  add(author: AuthorLike): NameLabelEntry {
    const known = this.byAuthor.get(author);
    if (known) return known;
    const handle = (author.handle ?? '').trim().replace(/^@+/, '');
    const key = authorKey(handle);
    let entry = key === null ? undefined : this.byKey.get(key);
    if (!entry) {
      entry = {
        token: tokenFor(this.entries.length),
        handle: key === null ? '' : handle,
        displayName: author.display_name?.trim() || undefined,
        unknown: key === null,
      };
      this.entries.push(entry);
      if (key !== null) this.byKey.set(key, entry);
    }
    if (entry.displayName === undefined && author.display_name?.trim()) entry.displayName = author.display_name.trim();
    const nameKey = entry.displayName ? foldName(entry.displayName) : '';
    if (nameKey.length >= 3 && !this.byKey.has(nameKey)) this.byKey.set(nameKey, entry);
    this.byAuthor.set(author, entry);
    return entry;
  }

  finish(outputLanguage?: string): NameLabelMap {
    const identifiers: string[] = [];
    for (const e of this.entries) {
      if (e.unknown) continue;
      identifiers.push(`@${e.handle}`);
      if (e.displayName && e.displayName.length >= 3) identifiers.push(e.displayName);
    }
    return {
      entries: this.entries,
      byKey: this.byKey,
      byAuthor: this.byAuthor,
      identifiers,
      outputLanguage,
    };
  }
}

interface EncounterLike {
  post: { author: AuthorLike; text?: string };
  ancestors?: Array<{ author: AuthorLike; text?: string }>;
  focused?: { author: AuthorLike; text?: string };
  children: Array<{ author: AuthorLike; text?: string }>;
  output_language?: string;
}

/**
 * An @handle written in a text: not the tail of an address (a@b.com), not a label. The people who SPEAK in a call get
 * their tokens from the map's authors; the people only MENTIONED are named by whoever wrote the text, so they are found
 * here and get tokens of their own, or the consent screen's "a label such as @user_A in place of each account name" is
 * untrue for the very name an attack is aimed at (the Tester's full test, 11 Oct 2026).
 */
const MENTION_RE = /(?<![\p{L}\p{N}_@.])@([\p{L}\p{N}_][\p{L}\p{N}_.\-]{1,38})/gu;

function mentionsIn(text: string | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const m of text.matchAll(MENTION_RE)) {
    const handle = m[1].replace(/[.\-]+$/, '');
    // A span that already looks like one of our labels is bent by the replacement step; it names nobody.
    if (handle.length < 2 || /^user_[a-z]{1,3}$/i.test(handle)) continue;
    out.push(handle);
  }
  return out;
}

/** The post's author first, then the thread above, then the commenters as shown. */
export function buildNameLabelMapForEncounter(encounter: EncounterLike): NameLabelMap {
  const b = new MapBuilder();
  b.add(encounter.post.author);
  for (const a of encounter.ancestors ?? []) b.add(a.author);
  if (encounter.focused && encounter.focused.author !== encounter.post.author) b.add(encounter.focused.author);
  for (const c of encounter.children) b.add(c.author);
  const texts = [encounter.post.text, ...(encounter.ancestors ?? []).map((a) => a.text), encounter.focused?.text, ...encounter.children.map((c) => c.text)];
  for (const text of texts) for (const handle of mentionsIn(text)) b.add({ handle });
  return b.finish(encounter.output_language);
}

/**
 * A caption's context lines are "• @name: text"; the name before the first ": " is a person present.
 * TikTok writes the name as shown, so it can hold spaces and emoji.
 */
const CONTEXT_LINE_HANDLE_RE = /^[ \t]*•[ \t]*@(.{1,64}?):[ \t]/gmu;
const CONTEXT_LINE_HEAD_RE = /^[ \t]*•[ \t]*(?:@.{1,64}?:[ \t])?/u;
/** The adapter cuts each context comment at this many characters before the engine reads it. */
const CONTEXT_BODY_CUT = 280;

export interface PostNameLabels extends NameLabelMap {
  /** What the judge's AUTHOR line gets: the author's token, or 'unknown' when the page gave none. */
  readonly authorValue: string;
}

/** The post path: the author first, then the people quoted in the caption context, in order. */
export function buildNameLabelMapForPost(
  author: string | undefined,
  context: string | undefined,
  /** The texts the call sends besides the context (the post, the post it answers): names only mentioned in them get tokens too. */
  texts: ReadonlyArray<string | undefined> = [],
): PostNameLabels {
  const b = new MapBuilder();
  const authorEntry = b.add({ handle: author ?? '' });
  for (const m of (context ?? '').matchAll(CONTEXT_LINE_HANDLE_RE)) b.add({ handle: m[1] });
  for (const text of texts) for (const handle of mentionsIn(text)) b.add({ handle });
  // The context's own bodies, without the "• @name:" heads (those are the speakers, added above). A handle the adapter's
  // 280-character cut left half-written at the end of a body is a name already known, and the replacement step owns it.
  for (const line of (context ?? '').split('\n')) {
    const body = line.replace(CONTEXT_LINE_HEAD_RE, '');
    for (const handle of mentionsIn(body)) {
      const cutAtEnd = body.length >= CONTEXT_BODY_CUT - 1 && body.toLowerCase().endsWith(`@${handle.toLowerCase()}`);
      if (cutAtEnd && b.entries.some((e) => !e.unknown && e.handle.length > handle.length && foldName(e.handle).startsWith(foldName(handle)))) continue;
      b.add({ handle });
    }
  }
  const map = b.finish();
  return { ...map, authorValue: authorEntry.unknown ? 'unknown' : authorEntry.token };
}

/** The token for a node's author. An author the map never saw gets a fresh token rather than a name. */
export function tokenForAuthor(map: NameLabelMap, author: AuthorLike): string {
  const known = map.byAuthor.get(author);
  if (known) return known.token;
  const key = authorKey(author.handle);
  const byKey = key === null ? undefined : map.byKey.get(key);
  if (byKey) return byKey.token;
  const entry: NameLabelEntry = {
    token: tokenFor(map.entries.length),
    handle: key === null ? '' : author.handle.trim().replace(/^@+/, ''),
    unknown: key === null,
  };
  (map.entries as NameLabelEntry[]).push(entry);
  if (key !== null) (map.byKey as Map<string, NameLabelEntry>).set(key, entry);
  map.byAuthor.set(author, entry);
  return entry.token;
}

// ─── Replacing names inside texts ──────────────────────────────────────────

interface NameSpan { start: number; end: number; index: number }

/** Whole-token occurrences of `needle` in the folded text, as spans of the original. */
function findFolded(
  folded: string,
  at: number[],
  needle: string,
  opts: { withAt: boolean },
): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  if (needle.length === 0) return out;
  let from = 0;
  for (;;) {
    const idx = folded.indexOf(needle, from);
    if (idx < 0) break;
    from = idx + 1;
    const before = idx > 0 ? folded[idx - 1] : '';
    const after = idx + needle.length < folded.length ? folded[idx + needle.length] : '';
    if (after && WORD_CHAR_RE.test(after)) continue;
    if (opts.withAt) {
      if (before !== '@') continue;
      const beforeAt = idx > 1 ? folded[idx - 2] : '';
      if (beforeAt && (WORD_CHAR_RE.test(beforeAt) || beforeAt === '@')) continue;
      out.push({ start: at[idx - 1], end: at[idx + needle.length] });
    } else {
      if (before && (WORD_CHAR_RE.test(before) || before === '@')) continue;
      out.push({ start: at[idx], end: at[idx + needle.length] });
    }
  }
  return out;
}

/** The name spans of `text`, in order, the longer one kept where two overlap, each with its person's index. */
function nameSpans(map: NameLabelMap, text: string): NameSpan[] {
  const { folded, at } = foldWithMap(text);
  const spans: NameSpan[] = [];
  map.entries.forEach((entry, index) => {
    if (entry.unknown) return;
    const handleKey = foldName(entry.handle);
    for (const s of findFolded(folded, at, handleKey, { withAt: true })) spans.push({ ...s, index });
    if (handleKey.length >= 3) {
      for (const s of findFolded(folded, at, handleKey, { withAt: false })) spans.push({ ...s, index });
    }
    const nameKey = entry.displayName ? foldName(entry.displayName) : '';
    if (nameKey.length >= 3) {
      for (const s of findFolded(folded, at, nameKey, { withAt: false })) spans.push({ ...s, index });
      for (const s of findFolded(folded, at, nameKey, { withAt: true })) spans.push({ ...s, index });
    }
  });
  spans.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const kept: NameSpan[] = [];
  let cursor = 0;
  for (const s of spans) {
    if (s.start < cursor) continue;
    kept.push(s);
    cursor = s.end;
  }
  return kept;
}

/** Each person's name as `source` wrote it, in order: "@pat_99", "Pat" or "pat_99". */
function formsIn(map: NameLabelMap, source: string | undefined): Map<NameLabelEntry, string[]> {
  const forms = new Map<NameLabelEntry, string[]>();
  if (!source) return forms;
  for (const s of nameSpans(map, source)) {
    const entry = map.entries[s.index];
    const list = forms.get(entry) ?? [];
    list.push(source.slice(s.start, s.end));
    forms.set(entry, list);
  }
  return forms;
}

const LABEL_SHAPED_RE = /(?<![\p{L}\p{N}_@])@?user_[a-z]{1,3}(?![\p{L}\p{N}_])/giu;

const PLACEHOLDER_OPEN = '\u0000';
const PLACEHOLDER_CLOSE = '\u0001';

/**
 * A copy of `text` with every known handle, @mention and display name replaced by that person's
 * token. Handles match with their "@" at any length and bare from three characters; display names
 * from three. An input span that already looks like a token gets its underscore bent to a hyphen,
 * so the restorer cannot mistake it for one this call issued. The original is never changed.
 */
export function replaceNamesInText(map: NameLabelMap, text: string): string {
  if (!text) return text;
  const spans = nameSpans(map, text);
  let cursor = 0;
  let out = '';
  for (const s of spans) {
    out += text.slice(cursor, s.start) + `${PLACEHOLDER_OPEN}${s.index}${PLACEHOLDER_CLOSE}`;
    cursor = s.end;
  }
  out += text.slice(cursor);
  counts.replaced += spans.length;

  let bentInput = 0;
  out = out.replace(LABEL_SHAPED_RE, (m) => { bentInput += 1; return m.replace('_', '-'); });
  counts.labelShapedInput += bentInput;

  return out.replace(/\u0000(\d+)\u0001/g, (_m, idx: string) => map.entries[Number(idx)].token);
}

/**
 * The caption context with its names replaced, line by line. A comment the adapter already cut can
 * end in the first letters of a present person's name ("@viewer_t"), which no whole-name match
 * finds, so three or more such letters at the end of a cut comment are replaced too.
 */
export function replaceNamesInCaptionContext(map: NameLabelMap, context: string): string {
  if (!context) return context;
  return context.split('\n').map((line) => {
    const body = line.slice((line.match(CONTEXT_LINE_HEAD_RE)?.[0] ?? '').length);
    const cut = body.length >= CONTEXT_BODY_CUT ? cutNameAtEnd(map, line) : null;
    if (!cut) return replaceNamesInText(map, line);
    counts.replaced += 1;
    return replaceNamesInText(map, line.slice(0, cut.start)) + map.entries[cut.index].token;
  }).join('\n');
}

/** Where the longest start (three letters or more) of a known name sits at the very end of `line`. */
function cutNameAtEnd(map: NameLabelMap, line: string): { start: number; index: number } | null {
  if (nameSpans(map, line).some((s) => s.end === line.length)) return null;
  const { folded, at } = foldWithMap(line);
  let best: { start: number; index: number; length: number } | null = null;
  for (const [index, entry] of map.entries.entries()) {
    if (entry.unknown) continue;
    for (const key of [foldName(entry.handle), entry.displayName ? foldName(entry.displayName) : '']) {
      for (let k = key.length - 1; k >= 3; k -= 1) {
        if (!folded.endsWith(key.slice(0, k))) continue;
        let idx = folded.length - k;
        if (idx > 0 && WORD_CHAR_RE.test(folded[idx - 1])) continue;
        if (idx > 0 && folded[idx - 1] === '@') idx -= 1;
        if (best === null || k > best.length) best = { start: at[idx], index, length: k };
        break;
      }
    }
  }
  return best;
}

/** Whole-token hits of the call's identifiers in a finished request, for the last check at the client. */
export function countIdentifierHits(text: string, identifiers: readonly string[]): number {
  let hits = 0;
  const lower = text.toLowerCase();
  for (const id of identifiers) {
    if (id.length < 2) continue;
    const isHandle = id.startsWith('@');
    const hay = isHandle ? lower : text;
    const needle = isHandle ? id.toLowerCase() : id;
    let from = 0;
    for (;;) {
      const idx = hay.indexOf(needle, from);
      if (idx < 0) break;
      from = idx + 1;
      const before = idx > 0 ? hay[idx - 1] : '';
      const after = idx + needle.length < hay.length ? hay[idx + needle.length] : '';
      if (before && (WORD_CHAR_RE.test(before) || before === '@')) continue;
      if (after && WORD_CHAR_RE.test(after)) continue;
      // A label ("@user_A") is not the handle "user_a" it happens to spell: that handle, when named,
      // was itself replaced by its own label.
      if (isHandle && /^@user_[A-Z]{1,3}$/.test(text.slice(idx, idx + needle.length))) continue;
      hits += 1;
    }
  }
  return hits;
}

// ─── Restoring names in what comes back ────────────────────────────────────

export interface RestoreCounts {
  restored: number;
  bent: number;
  unmatched: number;
}

export interface RestoreResult {
  /** The text with names back; null when a rewrite still held a token nobody issued. */
  text: string | null;
  counts: RestoreCounts;
}

type Lang = 'en' | 'es' | 'pt' | 'ro';

/**
 * The forms a token comes back in, by the language each is written in, each with one capture group
 * for the letters. Every form is tried whatever language the call named, because the post path names
 * none. Only the exact form counts as "restored"; every form here counts as "bent". A form written
 * with a hyphen is never a token: that is what an input span that looked like a token was bent into.
 * A `spaced` form has a word, a space and the letters, which can be ordinary words; `leftover` forms
 * are the ones that still mean a label when their letters were never issued.
 */
export const BENT_FORMS: ReadonlyArray<{ lang: 'any' | Lang; re: RegExp; spaced?: true; leftover?: true }> = [
  // Case, spacing and brackets: "@USER_A", "@ user_A", "[user_A]", "(@user_A)"; and "@user A",
  // "user A" with the letters in capitals, so "ask the user a question" is left alone.
  { lang: 'any', leftover: true, re: /(?<![\p{L}\p{N}_])[[(]?(?:@\s?)?[Uu](?:ser|SER)_([A-Za-z]{1,3})[\])]?(?![\p{L}\p{N}_])/gu },
  { lang: 'any', leftover: true, spaced: true, re: /(?<![\p{L}\p{N}_])[[(]?(?:@\s?)?[Uu](?:ser|SER) ([A-Z]{1,3})[\])]?(?![\p{L}\p{N}_])/gu },
  // The "@" kept and the "user_" dropped: "@A", "@AA".
  { lang: 'any', re: /(?<![\p{L}\p{N}_])@([A-Z]{1,3})(?![\p{L}\p{N}_])/gu },
  { lang: 'es', leftover: true, spaced: true, re: /(?<![\p{L}\p{N}_])[Uu]suari[oa]\s+([A-Z]{1,3})(?![\p{L}\p{N}_])/gu },
  { lang: 'pt', leftover: true, spaced: true, re: /(?<![\p{L}\p{N}_])(?:[Uu]su[aá]ri[oa]|[Uu]tilizador(?:a)?)\s+([A-Z]{1,3})(?![\p{L}\p{N}_])/gu },
  { lang: 'ro', leftover: true, spaced: true, re: /(?<![\p{L}\p{N}_])(?:[Uu]tilizatoru?l(?:ui)?|[Uu]tilizatoare[ai]?|[Uu]tilizatori(?:i|lor)?)\s+([A-Z]{1,3})(?![\p{L}\p{N}_])/gu },
];

/**
 * Letters that follow "user" and a space in ordinary writing ("As a user I think", "User ID"). In a
 * spaced form with no "@" they are read as words, never as a label.
 */
const WORDS_AFTER_USER: ReadonlySet<string> = new Set(['I', 'ID', 'IP', 'UI', 'UX', 'OK', 'AI', 'API', 'PIN', 'VIP', 'PRO']);

/** Sentences a native reader would expect each bent form in; the rule-8 test runs them through the frozen checks. */
export const BENT_FORM_SAMPLES: Record<Lang, ReadonlyArray<(letters: string) => string>> = {
  en: [
    (l) => `user ${l} is mocking the rest of the thread.`,
    (l) => `@user_${l}'s reply piles onto the same person.`,
    (l) => `I think @user_${l} has a point, even if it is put harshly.`,
  ],
  es: [
    (l) => `El usuario ${l} se burla del resto del hilo.`,
    (l) => `Creo que @user_${l} tiene razón, aunque lo diga con dureza.`,
  ],
  pt: [
    (l) => `O usuário ${l} zomba do resto da conversa.`,
    (l) => `Acho que @user_${l} tem razão, mesmo dizendo com dureza.`,
  ],
  ro: [
    (l) => `Utilizatorul ${l} își bate joc de restul firului.`,
    (l) => `Cred că @user_${l} are dreptate, chiar dacă o spune dur.`,
    (l) => `Răspunsul lui @user_${l} se alătură atacului.`,
  ],
};

const EXACT_TOKEN_RE = /(?<![\p{L}\p{N}_@])@user_([A-Z]{1,3})(?![\p{L}\p{N}_])/gu;
/** A Romanian case ending glued to a token with a hyphen ("@user_A-ului"); dropped and counted as bent. */
const RO_ENDING_RE = /^-(?:ului|ul|lui|ei|i|a)(?![\p{L}\p{N}_])/u;

export const NEUTRAL_WORD: Record<Lang, string> = {
  en: 'someone', es: 'alguien', pt: 'alguém', ro: 'cineva',
};

export function languageOf(outputLanguage: string | undefined, text: string): Lang {
  const l = (outputLanguage ?? '').toLowerCase();
  if (/rom[aâ]n|^ro\b/.test(l)) return 'ro';
  if (/spa|espa|^es\b/.test(l)) return 'es';
  if (/portug|^pt/.test(l)) return 'pt';
  if (/engl|^en\b/.test(l)) return 'en';
  return detectLanguage(text).language === 'ro' ? 'ro' : 'en';
}

function nameFor(entry: NameLabelEntry, lang: Lang, forms: string[] | undefined, nth: number): string {
  if (entry.unknown) return NEUTRAL_WORD[lang];
  // The item's own forms come back in the order it wrote them, so a display name or a bare handle
  // is not turned into an @handle the writer never typed.
  if (forms && forms.length > 0) return forms[Math.min(nth, forms.length - 1)];
  // A shown name with spaces (Facebook) goes back as written; a handle goes back with one "@".
  return /\s/.test(entry.handle) ? entry.handle : `@${entry.handle}`;
}

/**
 * Put the names back into one free-text field of the answer. Only tokens this call issued are
 * restored: exact whole tokens first, then case, spacing and brackets, then the bent forms of
 * each language. Each person comes back in the form `source` (the item's own text) wrote them,
 * or as the account line gives them. A form that `source` or any of `otherTexts` (the rest of
 * what the call sent) wrote is someone's own words and stays as written; those texts never
 * choose a name's form. What is still token-shaped becomes the neutral word of the answer's
 * language in a reason or a summary, and drops the whole rewrite, so no label reaches the screen.
 */
export function restoreNames(
  map: NameLabelMap,
  text: string,
  field: 'reason' | 'rewrite',
  source?: string,
  otherTexts: readonly string[] = [],
): RestoreResult {
  const c: RestoreCounts = { restored: 0, bent: 0, unmatched: 0 };
  if (!text) return { text, counts: c };
  const lang = languageOf(map.outputLanguage, text);
  const byLetters = new Map<string, NameLabelEntry>();
  for (const e of map.entries) byLetters.set(e.token.slice('@user_'.length), e);

  const endingLength = (rest: string): number => {
    const m = rest.match(RO_ENDING_RE);
    return m ? m[0].length : 0;
  };

  // Every form is read on the text as it came back, never on a text already restored, so a real
  // handle shaped like a label is not read a second time as one.
  const found: Array<{ start: number; end: number; entry?: NameLabelEntry; exact: boolean }> = [];
  const written = source ? [source, ...otherTexts] : otherTexts;
  const scan = (re: RegExp, kind: 'exact' | 'bent' | 'leftover', spaced: boolean): void => {
    for (const m of text.matchAll(re)) {
      if (m.index === undefined) continue;
      const letters = m[1].toUpperCase();
      if (spaced && !m[0].includes('@') && WORDS_AFTER_USER.has(letters)) continue;
      // A form the item itself wrote ("IS THIS USER A BOT") is the writer's words, not a label.
      // So is one another text of the call wrote, which a summary or a reason may quote.
      const bare = m[0].replace(/^[[(]|[\])]$/g, '');
      if (kind !== 'exact' && written.some((s) => s.includes(bare))) continue;
      const entry = kind === 'leftover' ? undefined : byLetters.get(letters);
      if (kind !== 'leftover' && !entry) continue;
      const ending = entry ? endingLength(text.slice(m.index + m[0].length)) : 0;
      const start = m.index;
      const end = start + m[0].length + ending;
      if (found.some((f) => start < f.end && end > f.start)) continue;
      found.push({ start, end, entry, exact: kind === 'exact' && ending === 0 });
    }
  };
  scan(EXACT_TOKEN_RE, 'exact', false);
  for (const form of BENT_FORMS) scan(form.re, 'bent', form.spaced === true);
  for (const form of BENT_FORMS) if (form.leftover) scan(form.re, 'leftover', form.spaced === true);
  found.sort((a, b) => a.start - b.start);

  for (const f of found) {
    if (!f.entry) c.unmatched += 1;
    else if (f.exact) c.restored += 1;
    else c.bent += 1;
  }
  counts.restored += c.restored;
  counts.bent += c.bent;
  counts.unmatched += c.unmatched;
  if (c.unmatched > 0 && field === 'rewrite') {
    counts.droppedRewrites += 1;
    return { text: null, counts: c };
  }

  const forms = formsIn(map, source);
  const nth = new Map<NameLabelEntry, number>();
  let out = '';
  let cursor = 0;
  for (const f of found) {
    let name = NEUTRAL_WORD[lang];
    if (f.entry) {
      const k = nth.get(f.entry) ?? 0;
      nth.set(f.entry, k + 1);
      name = nameFor(f.entry, lang, forms.get(f.entry), k);
    }
    out += text.slice(cursor, f.start) + name;
    cursor = f.end;
  }
  return { text: out + text.slice(cursor), counts: c };
}
