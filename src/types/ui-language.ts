// The four languages the interface speaks, resolved (never 'auto').
//
// It was declared in src/i18n/index.ts, and the types layer needs it: the export's string table is
// typed per language and types may not import i18n (PLAN-2026-09-16 items 8.11 and 10.1). i18n
// re-exports the name, so every existing import keeps working.

export type ResolvedUiLanguage = 'en' | 'ro' | 'es' | 'pt-BR';
