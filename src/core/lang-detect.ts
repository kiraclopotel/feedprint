// English, Romanian, mixed or unknown for a thread's locale hint, without a detection library. A
// wrong call still gives valid output, since the prompt falls back to both languages on 'mixed' or
// 'unknown', so this favours speed and never claims a language it is unsure of: one side must
// outscore the other three to one, or it is 'mixed'. Romanian diacritics weigh double, since
// English almost never has them.

// The words from 'nici' on are written without a diacritic and are absent from Spanish and
// Portuguese, so they open the shared words below; not 'asta', which Spanish comments write for
// "hasta", nor 'doar', Portuguese for "to donate".
const RO_WORDS = [
  'și', 'nu', 'sunt', 'care', 'cu', 'pe', 'pentru',
  'mai', 'dacă', 'când', 'din', 'mă', 'îmi', 'îți', 'ce', 'foarte',
  'bine', 'sau', 'fi', 'fost', 'avem', 'aveți', 'acum',
  'nici', 'iar', 'acest', 'acesta', 'aceasta', 'nimic', 'poate', 'trebuie', 'aici', 'acolo',
];
// Spanish and Portuguese use these as much as Romanian does, so they count only beside a Romanian
// letter or word, which keeps a comment with one diacritic ("politicieni corupți de la putere").
// With neither, as in the same comment typed without the ț, the text is 'unknown' and a rewrite of
// it skips the Romanian language check.
const RO_WORDS_SHARED = ['de', 'la', 'se', 'dar', 'este'];
const EN_WORDS = [
  'the', 'and', 'is', 'are', 'not', 'this', 'that', 'of', 'in', 'on',
  'for', 'with', 'you', 'have', 'was', 'were', 'can', 'will', 'would',
  'they', 'their', 'there', 'what', 'who', 'when', 'how',
];

// Both the comma (Ș Ț) and the older cedilla (Ş Ţ) forms, which some TikTok comments still use.
const RO_DIACRITIC_RE = /[ăâîșțşţĂÂÎȘȚŞŢ]/g;

const DIACRITIC_WEIGHT = 2;
const WORD_WEIGHT = 1;
const MIN_SIGNAL = 3;
const DOMINANCE_RATIO = 3;

type DetectedLanguage = 'en' | 'ro' | 'mixed' | 'unknown';

export interface LangDetectResult {
  language: DetectedLanguage;
  ro_score: number;
  en_score: number;
}

export function detectLanguage(text: string): LangDetectResult {
  if (!text || text.trim().length === 0) {
    return { language: 'unknown', ro_score: 0, en_score: 0 };
  }

  const normalized = text.toLowerCase();

  const diacriticMatches = normalized.match(RO_DIACRITIC_RE);
  const ro_diacritic_hits = diacriticMatches ? diacriticMatches.length : 0;
  const ro_own_word_hits = countWordHits(normalized, RO_WORDS);
  const ro_shared_word_hits = ro_diacritic_hits > 0 || ro_own_word_hits > 0
    ? countWordHits(normalized, RO_WORDS_SHARED)
    : 0;
  const ro_word_hits = ro_own_word_hits + ro_shared_word_hits;
  const en_word_hits = countWordHits(normalized, EN_WORDS);

  const ro_score = ro_diacritic_hits * DIACRITIC_WEIGHT + ro_word_hits * WORD_WEIGHT;
  const en_score = en_word_hits * WORD_WEIGHT;

  let language: DetectedLanguage;
  if (ro_score < MIN_SIGNAL && en_score < MIN_SIGNAL) {
    language = 'unknown';
  } else if (ro_score >= en_score * DOMINANCE_RATIO) {
    language = 'ro';
  } else if (en_score >= ro_score * DOMINANCE_RATIO) {
    language = 'en';
  } else {
    language = 'mixed';
  }

  return { language, ro_score, en_score };
}

/** A TikTok post is often only hashtags, so the comments carry the thread's language. */
export function detectThreadLanguage(postText: string, commentTexts: string[]): LangDetectResult {
  const joined = [postText, ...commentTexts.slice(0, 10)].join(' \n ');
  return detectLanguage(joined);
}

/**
 * The language name for the batch prompt's language slot ("Italian", "Brazilian Portuguese"). The
 * model follows a named language but ignores "in the same language as the input", as a live test
 * on Romanian Facebook comments showed. A language the parent picked wins; with 'auto' or a code
 * that does not resolve, it is detected with Chrome's own detector and named with
 * Intl.DisplayNames, so no language needs code of its own. When detection is unsure or
 * unavailable, the "same language" phrase is sent instead: a best effort beats naming the wrong
 * language.
 */
export async function resolvePromptLanguage(
  userPick: string | undefined,
  postText: string,
  commentTexts: string[],
): Promise<string> {
  if (userPick && userPick !== 'auto') {
    try {
      const displayNames = new Intl.DisplayNames(['en'], { type: 'language' });
      const name = displayNames.of(userPick);
      // An unknown code comes back unchanged, and the prompt would say "Output in xx-YY.".
      if (name && name.length > 0 && name !== userPick) {
        return name;
      }
    } catch {
      // Detect instead.
    }
  }
  return detectPromptLanguageDisplayName(postText, commentTexts);
}

async function detectPromptLanguageDisplayName(
  postText: string,
  commentTexts: string[],
): Promise<string> {
  const FALLBACK = 'the same language as the original input';

  // The service worker and non-extension contexts have no chrome.i18n.
  if (
    typeof chrome === 'undefined' ||
    !chrome ||
    !chrome.i18n ||
    typeof chrome.i18n.detectLanguage !== 'function'
  ) {
    return FALLBACK;
  }

  // Cut at 4,000 characters so detection returns quickly on a long thread.
  const text = [postText, ...commentTexts.slice(0, 10)].join('\n').slice(0, 4000);
  if (!text.trim()) return FALLBACK;

  const detection = await new Promise<chrome.i18n.LanguageDetectionResult | null>(
    (resolve) => {
      try {
        chrome.i18n.detectLanguage(text, (result) => {
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          resolve(result ?? null);
        });
      } catch {
        resolve(null);
      }
    },
  );

  if (!detection || !detection.isReliable || detection.languages.length === 0) {
    return FALLBACK;
  }
  const top = detection.languages[0];
  // Under 50% on the top guess is a mix of languages; better not to commit to one.
  if (!top || top.percentage < 50) return FALLBACK;

  try {
    const displayNames = new Intl.DisplayNames(['en'], { type: 'language' });
    const name = displayNames.of(top.language);
    // As above: an unknown code comes back unchanged.
    if (name && name.length > 0 && name !== top.language) {
      return name;
    }
  } catch {
    // Use the phrase.
  }
  return FALLBACK;
}

// Each list's patterns, built the first time the list is used and kept. String.match with a g flag
// starts from the beginning each time, so a kept pattern gives the same hits as a fresh one.
const WORD_PATTERNS = new Map<string[], RegExp[]>();

function wordPatterns(words: string[]): RegExp[] {
  let patterns = WORD_PATTERNS.get(words);
  if (!patterns) {
    patterns = words.map((w) => {
      // Not \b, which counts 'ș' as a non-letter. The check also stops "nu" matching in "nuclear".
      const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(?:^|[^\\p{L}])${escaped}(?:$|[^\\p{L}])`, 'giu');
    });
    WORD_PATTERNS.set(words, patterns);
  }
  return patterns;
}

function countWordHits(normalizedLower: string, words: string[]): number {
  let count = 0;
  for (const pattern of wordPatterns(words)) {
    const matches = normalizedLower.match(pattern);
    if (matches) count += matches.length;
  }
  return count;
}
