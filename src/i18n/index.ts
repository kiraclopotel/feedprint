import type { ResolvedUiLanguage } from '../types/ui-language';
// FeelingWise — UI language (interface localization).
//
// Scope: the language of FW's OWN surfaces (popup, dashboard, on-page
// marker chrome). Distinct from:
//   • settings.outputLanguage — the language AI rewrites/explanations are
//     written in (parent-picked, 'auto' = match the post's language).
//     Q65 ruling (2026-08-11, W60): this governs AI text shown to the
//     READER in-feed. AI-written EVIDENCE fields the parent reads
//     (image/video prompt scene+reason) deliberately follow uiLanguage
//     instead — the parent is their audience. Two audiences, two settings;
//     the image/video prompt builders' uiLanguage branch is correct.
//   • settings.locale — legacy 'en' pin threaded into the AI pipeline
//     cache key (pipeline.ts); not a UI concern, left untouched on purpose
//   • the forensic HTML export's own I18N table (export-strings.ts), which
//     is embedded in the standalone export file
//
// 'auto' (the default) follows the browser language, so a Spanish-locale
// browser gets a Spanish interface with zero configuration. String tables
// are per-surface (popup-strings.ts, …) and typed against a single
// interface so a missing translation is a compile error, not a runtime
// leftover.

export type UiLanguage = 'auto' | 'en' | 'ro' | 'es' | 'pt-BR';
export type { ResolvedUiLanguage } from '../types/ui-language';

/** Every language the interface actually ships, in picker order. */
export const UI_LANGUAGES: readonly ResolvedUiLanguage[] = ['en', 'es', 'pt-BR', 'ro'];

// Romanian numeral-noun agreement (Q63/W59). Counts of 0, or with a
// two-digit remainder of 00 or 20-99, take "de" before the noun
// ("3 elemente" but "20 de elemente"). One shared implementation for every
// RO string table; skipping it is the bug class the Q63 batch removed.
// The number is GROUPED the way Romanian writes it (2026-09-19). Every sibling
// call site in ro.ts already passed 'ro-RO' to toLocaleString; the ninety that
// come through this helper printed the raw number, so one Romanian sentence read
// "3278 intrari" beside another reading "3.278". The agreement rule below is
// decided on the raw number and never on the grouped string: "1.000" has a
// two-digit remainder of 00 and takes "de", which reading digits off the
// formatted text would get wrong the moment a separator appears.
export function roPlural(n: number, singular: string, plural: string): string {
  if (n === 1) return `1 ${singular}`;
  const rem = Math.abs(n) % 100;
  const needsDe = n !== 0 && (rem === 0 || rem >= 20);
  return `${n.toLocaleString(intlLocaleFor('ro'))} ${needsDe ? 'de ' : ''}${plural}`;
}

/** Word-only variant for call sites that render the number themselves. */
export function roPluralWord(n: number, singular: string, plural: string): string {
  if (n === 1) return singular;
  const rem = Math.abs(n) % 100;
  const needsDe = n !== 0 && (rem === 0 || rem >= 20);
  return `${needsDe ? 'de ' : ''}${plural}`;
}

// A browser tag matches a shipped language when it IS that language or is a
// regional variant of it ('es-PE' → es). The subtag boundary is the hyphen,
// never a bare prefix: 'ru-RU' must not resolve to Romanian.
function isTag(nav: string, base: string): boolean {
  return nav === base || nav.startsWith(base + '-');
}

/**
 * Browser language → the interface language FW will actually render.
 *
 * Portuguese resolves to pt-BR for every region, including pt-PT. The store
 * dashboard (2026-09-04) reports Portuguese users as Brazil, the table is
 * written in Brazilian Portuguese, and a European Portuguese reader is far
 * better served by pt-BR than by English. Naming the table 'pt-BR' rather
 * than 'pt' keeps that an honest label instead of a silent claim to both.
 */
export function resolveUiLanguage(
  pref: UiLanguage | string | undefined,
  navLang?: string,
): ResolvedUiLanguage {
  if (pref === 'en' || pref === 'ro' || pref === 'es' || pref === 'pt-BR') return pref;
  const nav = (
    navLang ??
    (typeof navigator !== 'undefined' ? navigator.language : 'en') ??
    'en'
  ).toLowerCase();
  if (isTag(nav, 'ro')) return 'ro';
  if (isTag(nav, 'es')) return 'es';
  if (isTag(nav, 'pt')) return 'pt-BR';
  return 'en';
}

/**
 * BCP-47 tag for Intl formatters. One place, because the old inline
 * `lang === 'ro' ? 'ro-RO' : 'en-US'` ternaries silently fell back to US
 * English for every language added after them.
 */
export function intlLocaleFor(lang: ResolvedUiLanguage): string {
  switch (lang) {
    case 'ro': return 'ro-RO';
    case 'es': return 'es-ES';
    case 'pt-BR': return 'pt-BR';
    default: return 'en-US';
  }
}

/** Endonym for the language picker. Never translated: a picker is read in the language it offers. */
export const UI_LANGUAGE_LABELS: Readonly<Record<ResolvedUiLanguage, string>> = {
  en: 'English',
  es: 'Español',
  'pt-BR': 'Português (Brasil)',
  ro: 'Română',
};
