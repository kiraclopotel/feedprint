// The dashboard's words, one file per language.
//
// This file was 6,489 lines: the interface, then the same interface answered in English, Romanian,
// Spanish and Brazilian Portuguese. Split on 2026-09-16 (PLAN-2026-09-16 item 10.2) so a person
// working on one language opens one language. The interface lives in ./dashboard/types, each
// language in ./dashboard/<code>, and this file keeps its name and its exports, so nothing that
// reads the strings had to change.
//
// Adding a key to one language and not the others is still a compile error: every language file
// declares itself as DashboardStrings.

import type { ResolvedUiLanguage } from '../types/ui-language';
import type { DashboardStrings } from './dashboard/types';
import { EN } from './dashboard/en';
import { RO } from './dashboard/ro';
import { ES } from './dashboard/es';
import { PT_BR } from './dashboard/pt-br';

export type {
  DashboardStrings,
  MetricWord,
  FeedMediaStatusKey,
  FeedCommentStatusKey,
  FeedBehaviorLens,
} from './dashboard/types';

export const DASHBOARD_STRINGS: Record<ResolvedUiLanguage, DashboardStrings> = {
  en: EN,
  ro: RO,
  es: ES,
  'pt-BR': PT_BR,
};
