// The popup's words, one file per language.
//
// This file held the interface and then the same interface answered in English, Romanian, Spanish
// and Brazilian Portuguese. Split on 2026-09-16 (PLAN-2026-09-16 item 10.2) so a person working on
// one language opens one language. The interface lives in ./popup/types, each language in
// ./popup/<code>, and this file keeps its name and its exports, so nothing that reads the strings
// had to change.

import type { ResolvedUiLanguage } from '../types/ui-language';
import type { PopupStrings } from './popup/types';
import { EN } from './popup/en';
import { RO } from './popup/ro';
import { ES } from './popup/es';
import { PT_BR } from './popup/pt-br';

export type { PopupStrings } from './popup/types';

export const POPUP_STRINGS: Record<ResolvedUiLanguage, PopupStrings> = {
  en: EN,
  ro: RO,
  es: ES,
  'pt-BR': PT_BR,
};
