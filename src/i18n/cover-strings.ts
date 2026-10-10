// The one line Off writes on a page it covers whole: a site on break, a site in quiet hours, a Reels or
// Shorts page it blocks. Without it the page is plain black, and a person cannot tell it from a page that
// failed to load. Off is the only product that covers a page this way (storage/switch-scope.ts).

import type { ResolvedUiLanguage } from './index';
import type { Platform } from '../types/post';

export interface CoverStrings {
  onBreak: (site: string) => string;
  quietHours: (site: string) => string;
  /** `kind` is "Shorts" on YouTube and "Reels" elsewhere: the platforms' own names, not translated. */
  shortVideos: (kind: string) => string;
}

const EN: CoverStrings = {
  onBreak: (site) => `${site} is on break. Off keeps it closed until you turn the break off.`,
  quietHours: (site) => `Quiet hours: Off keeps ${site} closed until they end.`,
  shortVideos: (kind) => `Off blocks ${kind} on this page.`,
};

const ES: CoverStrings = {
  onBreak: (site) => `${site} está en pausa. Off lo mantiene cerrado hasta que quites la pausa.`,
  quietHours: (site) => `Horario de silencio: Off mantiene ${site} cerrado hasta que termine.`,
  shortVideos: (kind) => `Off bloquea los ${kind} en esta página.`,
};

const PT_BR: CoverStrings = {
  onBreak: (site) => `O ${site} está em pausa. O Off mantém o site fechado até você desligar a pausa.`,
  quietHours: (site) => `Horário de silêncio: o Off mantém o ${site} fechado até ele terminar.`,
  shortVideos: (kind) => `O Off bloqueia os ${kind} nesta página.`,
};

const RO: CoverStrings = {
  onBreak: (site) => `${site} e pe pauză. Off îl ține închis până oprești pauza.`,
  quietHours: (site) => `Orele de liniște: Off ține ${site} închis până se termină.`,
  shortVideos: (kind) => `Off blochează ${kind} pe această pagină.`,
};

export const COVER_STRINGS: Record<ResolvedUiLanguage, CoverStrings> = { en: EN, es: ES, 'pt-BR': PT_BR, ro: RO };

/** The sites' own names, the same in every language. */
export const COVER_SITE_NAMES: Record<Platform, string> = {
  twitter: 'X', facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube',
};
