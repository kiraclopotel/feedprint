// FeelingWise — React plumbing for interface language.
//
// One context carries the RESOLVED language ('en' | 'ro'); each surface
// pulls its own typed string table from it. The provider value comes from
// settings.uiLanguage at the surface root (Popup / Dashboard), so a
// language change re-renders every consumer — no per-component storage
// listeners needed.

import { createContext, useContext, type ReactNode } from 'react';
import { resolveUiLanguage, type ResolvedUiLanguage } from './index';
import { POPUP_STRINGS, type PopupStrings } from './popup-strings';
import { DASHBOARD_STRINGS, type DashboardStrings } from './dashboard-strings';

const I18nContext = createContext<ResolvedUiLanguage>(resolveUiLanguage('auto'));

export function I18nProvider({ lang, children }: { lang: ResolvedUiLanguage; children: ReactNode }) {
  return <I18nContext.Provider value={lang}>{children}</I18nContext.Provider>;
}

export function useUiLanguage(): ResolvedUiLanguage {
  return useContext(I18nContext);
}

export function usePopupT(): PopupStrings {
  return POPUP_STRINGS[useContext(I18nContext)];
}

export function useDashboardT(): DashboardStrings {
  return DASHBOARD_STRINGS[useContext(I18nContext)];
}
