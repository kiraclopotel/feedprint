// Topics the person chose not to see (Topics U1, 13 Oct 2026): a written list of words, phrases and brand names per
// topic, matched with no model and no network, the same way the household's own word list is. One switch per topic
// (`topic-gambling`), off in every preset, so a person who never opens the Topics fold pays nothing: `activeTopics`
// returns nothing and the matcher is never built.
//
// The lists are written per language (tests/fixtures/topic-lists, built into src/core/topic-lists by the list generator). A post is checked against every language's list whatever the interface language is,
// because a person who reads in Romanian still meets English and Spanish posts. One guard keeps that honest: words
// that are ordinary English ("the odds", "hit the jackpot", "aviator sunglasses", "I bet you") are not applied to a post
// that shows any English function word and no Romanian one; only the English list and the brand names (which are one
// distinct token each) are. A Spanish or Portuguese post almost never contains "the", "and", "is" or "with", so the
// guard costs next to no recall there, and an English sentence is never hidden for a Portuguese slang word.
//
// Matching is the household matcher's: both sides lowercased and stripped of diacritics, tokens split on anything that
// is not a letter or digit, a phrase matches only on whole tokens, and a word that is not marked `exact` also reaches
// endings and run-together forms under the guard in profanity-filter.ts `matchUserWordInToken`. Never a raw substring
// ("bet" must not hide "better"). Pure: no DOM, no chrome, no network.

import { detectLanguage } from '../lang-detect';
import { matchUserWordInToken } from '../profanity-filter';
import gamblingList from '../topic-lists/gambling-v1.json';
import { TOPIC_FEATURE, TOPIC_IDS, type TopicId } from '../../types/topic-id';

/** The household matcher's fold (parent-blocklist.ts): diacritics stripped, lower-cased, tokens split on anything not a letter or digit. */
function foldToTokenString(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

type TopicTermKind = 'word' | 'phrase' | 'brand';
/** [folded term, kind, exact]: an exact term matches only the whole word; the others also reach endings and run-together forms. */
type TopicTerm = readonly [term: string, kind: TopicTermKind, exact: boolean];
const GAMBLING_V1 = gamblingList as unknown as Readonly<Record<'en' | 'ro' | 'es' | 'pt-BR', readonly TopicTerm[]>>;

export interface TopicMatch {
  topic: TopicId;
  /** The listed term that matched, folded. Goes into the record, never onto the page. */
  term: string;
  kind: TopicTermKind;
  /** Where it matched: the author's own words, or the card around them (a quoted post, a link card). */
  scope: 'own' | 'card';
}

/** What a post's card carries beyond the author's words; see src/content/record/card-context.ts. */
export interface TopicCard {
  text?: string;
}

interface Hit {
  term: string;
  kind: TopicTermKind;
}

interface TopicIndex {
  /** Whole-token terms: marked exact, and brand names. */
  whole: Map<string, TopicTermKind>;
  /** Single-token terms that also reach endings and run-together forms (one array, so the matcher indexes it once). */
  stems: string[];
  stemKinds: Map<string, TopicTermKind>;
  /** Padded with a space each side, so `includes` matches whole tokens only. */
  phrases: Array<{ padded: string; term: string; kind: TopicTermKind }>;
}

interface TopicLexicon {
  /** The English list: always applied. */
  en: TopicIndex;
  /** Romanian, Spanish and Portuguese: applied unless the post reads as English (brand names always). */
  others: TopicIndex;
}

function buildIndex(lists: ReadonlyArray<readonly TopicTerm[]>): TopicIndex {
  const whole = new Map<string, TopicTermKind>();
  const stemKinds = new Map<string, TopicTermKind>();
  const phrases: TopicIndex['phrases'] = [];
  const seenPhrase = new Set<string>();
  for (const list of lists) {
    for (const [raw, kind, exact] of list) {
      const term = foldToTokenString(raw);
      if (term.length === 0) continue;
      if (term.includes(' ')) {
        if (!seenPhrase.has(term)) {
          seenPhrase.add(term);
          phrases.push({ padded: ` ${term} `, term, kind });
        }
      } else if (exact || kind === 'brand') {
        if (!whole.has(term)) whole.set(term, kind);
      } else if (!stemKinds.has(term)) {
        stemKinds.set(term, kind);
      }
    }
  }
  return { whole, stems: [...stemKinds.keys()], stemKinds, phrases };
}

const lexicons = new Map<TopicId, TopicLexicon>();

function lexiconFor(topic: TopicId): TopicLexicon {
  let lex = lexicons.get(topic);
  if (!lex) {
    const lists = GAMBLING_V1;
    lex = { en: buildIndex([lists.en]), others: buildIndex([lists.ro, lists.es, lists['pt-BR']]) };
    lexicons.set(topic, lex);
  }
  return lex;
}

function matchIndex(index: TopicIndex, tokens: ReadonlySet<string>, padded: string, brandsOnly: boolean): Hit | null {
  for (const token of tokens) {
    const kind = index.whole.get(token);
    if (kind && (!brandsOnly || kind === 'brand')) return { term: token, kind };
  }
  if (brandsOnly) {
    for (const p of index.phrases) if (p.kind === 'brand' && padded.includes(p.padded)) return { term: p.term, kind: p.kind };
    return null;
  }
  for (const token of tokens) {
    const kind = index.stemKinds.get(token);
    if (kind) return { term: token, kind };
  }
  for (const token of tokens) {
    const stem = matchUserWordInToken(token, index.stems);
    if (stem) return { term: stem, kind: index.stemKinds.get(stem) ?? 'word' };
  }
  for (const p of index.phrases) if (padded.includes(p.padded)) return { term: p.term, kind: p.kind };
  return null;
}

function matchText(lex: TopicLexicon, text: string): Hit | null {
  const normalized = foldToTokenString(text);
  if (normalized.length === 0) return null;
  const tokens = new Set(normalized.split(' '));
  const padded = ` ${normalized} `;
  const english = matchIndex(lex.en, tokens, padded, false);
  if (english) return english;
  // Only a post that reads as English is spared the other languages' ordinary words; the check runs on a candidate
  // hit only, so a post that matches nothing never pays for it.
  const candidate = matchIndex(lex.others, tokens, padded, false);
  if (!candidate) return null;
  if (candidate.kind === 'brand') return candidate;
  return readsAsEnglish(text) ? matchIndex(lex.others, tokens, padded, true) : candidate;
}

/** Any English function word and no Romanian one (src/core/lang-detect.ts keeps both word lists). */
function readsAsEnglish(text: string): boolean {
  const seen = detectLanguage(text);
  return seen.en_score > 0 && seen.ro_score === 0;
}

/** The topics whose switch is on, read straight off `settings.features` like the household list. */
export function activeTopics(features: unknown): TopicId[] {
  if (!features || typeof features !== 'object') return [];
  const out: TopicId[] = [];
  for (const topic of TOPIC_IDS) {
    const entry = (features as Record<string, unknown>)[TOPIC_FEATURE[topic]];
    if (entry && typeof entry === 'object' && (entry as { enabled?: unknown }).enabled === true) out.push(topic);
  }
  return out;
}

/** The first topic in `topics` that the post (or the card around it) is about, or null. */
export function matchTopics(topics: readonly TopicId[], text: string, card?: TopicCard): TopicMatch | null {
  for (const topic of topics) {
    const lex = lexiconFor(topic);
    const own = matchText(lex, text);
    if (own) return { topic, ...own, scope: 'own' };
    if (card?.text) {
      const onCard = matchText(lex, card.text);
      if (onCard) return { topic, ...onCard, scope: 'card' };
    }
  }
  return null;
}
