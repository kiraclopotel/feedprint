// The repair file: what it may say and how it is read (11 Oct 2026).
//
// A site changes its page; a selector or a word in one of our finders stops matching, or starts matching too much. Until
// now the repair was a code change, a build and a store review. This is the other road: a small file, fetched by
// Feedprint and signed by us, that adds a selector to a named finder, takes one out, or switches a finder off. It is
// DATA. Chrome allows data fetched at run time and forbids an interpreter for fetched commands, so the vocabulary here
// is closed: strings, numbers, booleans and names the packaged code already knows. There is no expression, no regular
// expression, no code. A repair names a finder family that the package registered (families.ts); a name the package
// does not know is skipped. Everything a repair causes still passes the door and the size check, and a selector must be
// specific and sane when it is applied (families.ts), so a mistake in a file costs a missed hide, not a broken page.
//
// The file is wrapped: { payload: "<the JSON text below>", signature: "<base64 Ed25519 over the payload bytes>",
// keyId: "<which packaged key>" }. The signature covers the payload text exactly as sent, so no re-encoding can change
// what was signed.
//
// payload = { v: 1, version: <integer, rises with every release>, issuedAt: <ISO date>, expiresAt?: <ISO date>,
//             entries: [{ family, add?: string[], remove?: string[], off?: boolean, note?: string }] }

export interface RepairEntry {
  readonly family: string;
  readonly add: readonly string[];
  readonly remove: readonly string[];
  readonly off: boolean;
}

export interface RepairFile {
  readonly version: number;
  readonly issuedAt: string;
  readonly expiresAt: string | null;
  readonly entries: readonly RepairEntry[];
}

export interface RepairEnvelope {
  readonly payload: string;
  readonly signature: string;
  readonly keyId: string;
}

const MAX_PAYLOAD_CHARS = 60_000;
const MAX_ENTRIES = 80;
const MAX_PER_LIST = 20;
const MAX_ITEM_CHARS = 240;
const FAMILY_ID = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;
const FAMILY_ID_MAX = 60;
const MAX_VERSION = 1_000_000_000;

// Controls, braces, a semicolon, an angle bracket, a backslash, an at-sign and a slash have no place in a selector this
// file may carry. A class that needs a backslash to be written is not one a repair can name.
const SELECTOR_CHARS = /^[A-Za-z0-9_\-[\]="'*^$|~:(),>+ #.%]+$/;
// A repair selector names something: an attribute, a class, an id or a custom element (a tag with a hyphen).
const NAMES_SOMETHING = /\[[A-Za-z_-]|\.[A-Za-z_]|#[A-Za-z_]|(^|[\s>+~(,])[a-z][a-z0-9]*-[a-z0-9-]+/;
// A parenthesis in a selector belongs to one of these pseudo-classes and to nothing else (no url(), no function call).
const PSEUDO_BEFORE_PAREN = /:(?:has|not|is|where|nth-child|nth-last-child|nth-of-type|nth-last-of-type)$/;
const BARE_TAGS: ReadonlySet<string> = new Set([
  '*', 'html', 'body', 'main', 'div', 'span', 'a', 'button', 'svg', 'img', 'ul', 'ol', 'li', 'p', 'nav', 'header', 'footer',
  'section', 'article', 'aside', 'form', 'input', 'textarea', 'video', 'h1', 'h2', 'h3', 'label', 'table', 'tr', 'td',
]);

/** A word a repair may add to a word list: letters, digits, spaces and a little punctuation, short. */
const WORD_CHARS = /^[\p{L}\p{N} .,'’&+/-]+$/u;
const WORD_MAX = 60;

/** Brackets and parentheses close in order and quotes pair up. A browser would close the rest at the end; a file should not rely on that. */
function isBalanced(s: string): boolean {
  const open: string[] = [];
  let quote = '';
  for (const ch of s) {
    if (quote) { if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[' || ch === '(') open.push(ch);
    else if (ch === ']') { if (open.pop() !== '[') return false; }
    else if (ch === ')') { if (open.pop() !== '(') return false; }
  }
  return open.length === 0 && quote === '';
}

function isControlFree(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) < 32) return false;
  return true;
}

/** True for a selector text a repair may carry: closed characters, specific, not a bare tag. Compiling is checked by the caller where a document exists. */
export function isSafeRepairSelector(selector: string): boolean {
  if (typeof selector !== 'string') return false;
  const s = selector.trim();
  if (s.length < 3 || s.length > MAX_ITEM_CHARS || !SELECTOR_CHARS.test(s)) return false;
  if (!NAMES_SOMETHING.test(s) || !isBalanced(s)) return false;
  for (let i = s.indexOf('('); i >= 0; i = s.indexOf('(', i + 1)) {
    if (!PSEUDO_BEFORE_PAREN.test(s.slice(0, i))) return false;
  }
  for (const part of s.split(',')) if (BARE_TAGS.has(part.trim().toLowerCase())) return false;
  return true;
}

/** True for a word or phrase a repair may add to a word list. */
export function isSafeRepairWord(word: string, minLength = 2): boolean {
  if (typeof word !== 'string') return false;
  const w = word.trim();
  return w.length >= minLength && w.length <= WORD_MAX && WORD_CHARS.test(w);
}

function isoDate(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 40) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? value : null;
}

function stringList(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_PER_LIST) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0 || item.length > MAX_ITEM_CHARS || !isControlFree(item)) return null;
    out.push(item.trim());
  }
  return out;
}

const ENTRY_KEYS: ReadonlySet<string> = new Set(['family', 'add', 'remove', 'off', 'note']);

function parseEntry(raw: unknown): RepairEntry | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  for (const key of Object.keys(o)) if (!ENTRY_KEYS.has(key)) return null;
  if (typeof o.family !== 'string' || o.family.length > FAMILY_ID_MAX || !FAMILY_ID.test(o.family)) return null;
  const add = stringList(o.add);
  const remove = stringList(o.remove);
  if (add === null || remove === null) return null;
  if (o.off !== undefined && typeof o.off !== 'boolean') return null;
  if (o.note !== undefined && (typeof o.note !== 'string' || o.note.length > 120)) return null;
  return { family: o.family, add, remove, off: o.off === true };
}

/**
 * Read a payload text into a repair file, or null when it is not one. Strict where it matters: a wrong version, a
 * date that is not a date, a list too long. An entry that is not understood is skipped (an older package meets a
 * newer file); the rest of the file still stands.
 */
export function parseRepairPayload(text: string, now: number = Date.now()): RepairFile | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_PAYLOAD_CHARS) return null;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return null;
  if (typeof o.version !== 'number' || !Number.isInteger(o.version) || o.version < 0 || o.version > MAX_VERSION) return null;
  const issuedAt = isoDate(o.issuedAt);
  if (issuedAt === null) return null;
  let expiresAt: string | null = null;
  if (o.expiresAt !== undefined) {
    expiresAt = isoDate(o.expiresAt);
    if (expiresAt === null) return null;
    if (Date.parse(expiresAt) <= now) return null;
  }
  if (!Array.isArray(o.entries) || o.entries.length > MAX_ENTRIES) return null;
  const entries: RepairEntry[] = [];
  for (const item of o.entries) {
    const entry = parseEntry(item);
    if (entry) entries.push(entry);
  }
  return { version: o.version, issuedAt, expiresAt, entries };
}

/** Read the wrapper text, or null. The signature itself is checked in signed.ts. */
export function parseRepairEnvelope(text: string): RepairEnvelope | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_PAYLOAD_CHARS + 2_000) return null;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.payload !== 'string' || typeof o.signature !== 'string' || typeof o.keyId !== 'string') return null;
  if (o.signature.length > 200 || o.keyId.length > 40) return null;
  return { payload: o.payload, signature: o.signature, keyId: o.keyId };
}
