// The parent's own words, phrases and accounts: the one rule in the product where the parent, not a
// model, decides. Pure (no DOM, no chrome, no network), and run as one more no-cost gate.
//
// Both sides are lowercased and stripped of diacritics, because a Romanian parent who types
// `slabit` means `slăbit`; the strip covers s-comma and t-comma too, checked. Never raw
// substrings, which is what a parent would expect and a trap: `diet` would hide `dietary`, `ass`
// would hide `class`. A one-word rule also reaches inflections (`fuck`, `fucking`) and run-together
// forms, but only when listed pieces account for the whole token, under the same guard as the
// built-in list in profanity-filter.ts. Words and phrases stay separate lists because they mean
// different things to a parent and the record names which one fired. An account matches the whole
// handle, so blocking `@kim` leaves `@kimberly` alone.
//
// No regular expressions from parents: easy to get wrong for this audience, and one that
// backtracks badly would stall a content script that runs on every post.

import { matchUserWordInToken } from './profanity-filter';

/** `FeatureToggle.value` of the `parent-blocklist` feature. */
export interface ParentBlocklistValue {
  words: string[];
  phrases: string[];
  accounts: string[];
}

type BlocklistMatchKind = 'word' | 'phrase' | 'account';

export interface BlocklistMatch {
  kind: BlocklistMatchKind;
  /** The parent's rule, normalized. Goes into the forensic evidence. */
  rule: string;
  /** Where the rule matched: the author's own words and handle, or the card around them (a quoted post, a link card, a "From" line). */
  scope: 'own' | 'card';
}

/** What a post's card carries beyond the author's words; see src/content/record/card-context.ts. */
export interface BlocklistCard {
  text?: string;
  accounts?: string[];
}

export const EMPTY_PARENT_BLOCKLIST: ParentBlocklistValue = {
  words: [],
  phrases: [],
  accounts: [],
};

/** The one normalization both the rules and the text go through. */
function foldForBlocklist(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function foldToTokenString(s: string): string {
  return foldForBlocklist(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function readList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const folded = foldToTokenString(entry);
    if (folded.length === 0) continue;
    if (!out.includes(folded)) out.push(folded);
  }
  return out;
}

/**
 * Entries come back already normalized, so the record carries the same form the matcher compared.
 */
export function readParentBlocklist(featureValue: unknown): ParentBlocklistValue {
  if (!featureValue || typeof featureValue !== 'object') return EMPTY_PARENT_BLOCKLIST;
  const v = featureValue as Partial<ParentBlocklistValue>;
  return {
    words: readList(v.words),
    phrases: readList(v.phrases),
    // `@kim` and `kim` are one rule.
    accounts: readList(v.accounts).map(a => a.replace(/^@+/, '')),
  };
}

export function isParentBlocklistEmpty(list: ParentBlocklistValue): boolean {
  return list.words.length === 0 && list.phrases.length === 0 && list.accounts.length === 0;
}

/**
 * Read straight off `settings.features`, not through `isFeatureEnabled` or `getFeatureValue`,
 * for two reasons: four pipeline test files mock storage/settings down to `getSettings` alone,
 * and a word a parent bans is banned everywhere, so there is no per-platform override to apply.
 */
export function activeParentBlocklist(features: unknown): ParentBlocklistValue {
  if (!features || typeof features !== 'object') return EMPTY_PARENT_BLOCKLIST;
  const entry = (features as Record<string, unknown>)['parent-blocklist'];
  if (!entry || typeof entry !== 'object') return EMPTY_PARENT_BLOCKLIST;
  const toggle = entry as { enabled?: unknown; value?: unknown };
  if (!toggle.enabled) return EMPTY_PARENT_BLOCKLIST;
  return readParentBlocklist(toggle.value);
}

/** The key of one rule's count in `settings.hiddenByFeature`: the word filter writes it, the rules editor reads it. */
export function ruleTallyKey(kind: BlocklistMatch['kind'], rule: string): string {
  return `rule:${kind}:${rule}`;
}

/**
 * First matching rule, or null. Accounts come first: naming an author is the parent's strongest
 * and cheapest statement.
 */
export function matchParentBlocklist(
  list: ParentBlocklistValue,
  text: string,
  author?: string,
  card?: BlocklistCard,
): BlocklistMatch | null {
  if (isParentBlocklistEmpty(list)) return null;

  if (list.accounts.length > 0) {
    const own = author ? foldToTokenString(author).replace(/^@+/, '') : '';
    if (own.length > 0 && list.accounts.includes(own)) {
      return { kind: 'account', rule: own, scope: 'own' };
    }
    // Accounts the card names beside the author (a quoted post's author, a video's "From"): a
    // parent who blocks a name means the person, not only their own posts.
    for (const named of card?.accounts ?? []) {
      const h = foldToTokenString(named).replace(/^@+/, '');
      if (h.length > 0 && list.accounts.includes(h)) {
        return { kind: 'account', rule: h, scope: 'card' };
      }
    }
  }

  const own = matchWords(list, text);
  if (own) return { ...own, scope: 'own' };
  if (card?.text) {
    const onCard = matchWords(list, card.text);
    if (onCard) return { ...onCard, scope: 'card' };
  }
  return null;
}

function matchWords(list: ParentBlocklistValue, text: string): { kind: 'word' | 'phrase'; rule: string } | null {
  const normalized = foldToTokenString(text);
  if (normalized.length === 0) return null;
  const tokens = new Set(normalized.split(' '));
  const padded = ` ${normalized} `;

  for (const rule of list.words) {
    const hit = rule.includes(' ') ? padded.includes(` ${rule} `) : tokens.has(rule);
    if (hit) return { kind: 'word', rule };
  }
  // A word inside a longer token, under the guard in matchUserWordInToken.
  for (const token of tokens) {
    const rule = matchUserWordInToken(token, list.words);
    if (rule) return { kind: 'word', rule };
  }
  for (const rule of list.phrases) {
    if (padded.includes(` ${rule} `)) return { kind: 'phrase', rule };
  }
  return null;
}
