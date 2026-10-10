// The why, as words on the page. One place turns a policy row into the
// fragment the notice shows, in the reader's interface language, with the
// household's own matched rule quoted after it when there is one (R1 only;
// core/policy/why.ts never returns a match for anything else).

import type { ResolvedUiLanguage } from '../../i18n';
import { whyWords } from '../../i18n/why-words';
import type { Why } from '../../core/policy/why';

export function whyFragment(lang: ResolvedUiLanguage, why: Why): string {
  const base = whyWords(lang, why.row, why.family) ?? why.row;
  return why.match ? `${base} ("${why.match}")` : base;
}

/** `<sentence>: <why>` when a why exists, the bare sentence otherwise. */
export function withWhy(sentence: string, lang: ResolvedUiLanguage, why: Why | null): string {
  return why ? `${sentence}: ${whyFragment(lang, why)}` : sentence;
}
