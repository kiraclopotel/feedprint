// The one reader of the count text the platforms print next to a post or a comment: "966", "1,200" (English) or
// "1.200" (Romanian) for a plain number, and "1.2K", "3M", "3 mil", "1,2 mil." for a shortened one. Facebook,
// Instagram, X and the comment extractors each had their own copy; the copies disagreed (Instagram read "1.2K" as
// 12000, Facebook read every "mil" as a million), so a record could carry a count a thousand times off.
//
// A shortened count is read with the language of the page, because the same word means different sizes:
// Spanish and Portuguese "mil" is a thousand ("mi" and "M" a million), Romanian "mil." is a million ("mii" a
// thousand). A "mil" on a page whose language is not one of those records NO count (undefined), and so does any
// other word that begins with "mil" (milhões, milioane): a count a thousand times off in a signed record is worse
// than none. A word after the number that is not a size ("comments", "likes") is only a label: the number is the count.

/** The page's language, its first two letters in lower case; '' when the page names none or there is no page. */
export function pageLanguage(): string {
  if (typeof document === 'undefined') return '';
  return (document.documentElement?.lang ?? '').slice(0, 2).toLowerCase();
}

/** The size a word after the number stands for, or undefined when it is a size this reader will not guess. */
function sizeOf(word: string, lang: string): number | undefined {
  switch (word) {
    case '': return 1;
    case 'k': return 1e3;
    case 'm': return 1e6;
    case 'b': return 1e9;
    case 'mii': return 1e3;
    case 'mln': return 1e6;
    case 'mil': return lang === 'es' || lang === 'pt' ? 1e3 : lang === 'ro' ? 1e6 : undefined;
    case 'mi': return lang === 'es' || lang === 'pt' ? 1e6 : undefined;
    default: return word.startsWith('mil') ? undefined : 1;
  }
}

/**
 * The number a count text stands for, or undefined when there is none or its size cannot be read.
 * `lang` is the page's language (the default reads it from the page).
 */
export function parseCountText(text: string | null | undefined, lang: string = pageLanguage()): number | undefined {
  if (!text) return undefined;
  const t = text.trim();
  if (!t) return undefined;
  const m = t.match(/(\d[\d.,\s]*)\s*(\p{L}[\p{L}.]*)?/u);
  if (!m) return undefined;
  const mult = sizeOf((m[2] ?? '').toLowerCase().replace(/\.+$/, ''), lang);
  if (mult === undefined) return undefined;
  const numStr = m[1].replace(/\s/g, '').replace(/[.,]+$/, '');
  if (!numStr) return undefined;
  // Shortened ("1.2K", "1,2 mil"): the separator is a DECIMAL point, so a comma reads as a dot and the number is scaled.
  // Plain ("966", "1,200", "1.200"): the separators are thousands groupings (English comma, Romanian dot) and go.
  const value = mult > 1 ? parseFloat(numStr.replace(',', '.')) : parseInt(numStr.replace(/[.,]/g, ''), 10);
  if (!Number.isFinite(value)) return undefined;
  return Math.round(value * mult);
}
