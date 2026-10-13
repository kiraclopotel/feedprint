// The gate in types/reading-gate.ts, with the stored agreement read for it (the lookup lives with the reading, apart from
// ui/popup/reading-gate.ts, which only asks whether a key turns the AI words on). The agreement is looked up
// only where the gate asks for it (Strict, with a paid key, and Strict allowed to read), so the levels
// that never ask for it, and Strict while it reads nothing, pay no storage read.

import type { FWSettings } from '../storage/settings';
import type { LicenseInfo } from '../storage/license';
import { getLicense } from '../storage/license';
import { bearerOf, getReadingConsent } from '../storage/reading-consent';
import { levelMakesNoCalls } from '../types/mode';
import { levelMayCallOut, mayCallOut, readingActive, type GateSettings } from '../types/reading-gate';

type SettingsLike = Pick<FWSettings, 'mode' | 'levelChosen' | 'aiAnalysisEnabled'> | GateSettings;

async function consentWhereAsked(settings: SettingsLike, license: LicenseInfo): Promise<object | null | undefined> {
  if (!levelMakesNoCalls(settings) || !levelMayCallOut(settings) || license.tier === 'free') return undefined;
  try {
    return await getReadingConsent(bearerOf(license));
  } catch {
    return null; // an unreadable agreement is no agreement
  }
}

/** readingActive, with the stored agreement read where it is needed. */
export async function readingActiveNow(settings: SettingsLike, license: LicenseInfo): Promise<boolean> {
  return readingActive(settings, license, await consentWhereAsked(settings, license));
}

/** Why the gate says no, in a word a log can carry (never a key, a name or a post). */
export type GateRefusal = 'level-not-chosen' | 'closed' | 'switch-off' | 'no-key' | 'no-agreement';

/**
 * Why a call may not go out now, or null when it may: mayCallOut, with the licence and the agreement read where they
 * are needed. The worker hands the word back to the page that asked (background/relay-fetch.ts), so a refused reading
 * call names its cause instead of reading as a dropped connection.
 */
export async function gateRefusal(settings: SettingsLike, license?: LicenseInfo): Promise<GateRefusal | null> {
  const chosen = (settings as GateSettings).levelChosen !== false;
  if (!levelMakesNoCalls(settings) && chosen) return null;
  if (!chosen) return 'level-not-chosen';
  if (!levelMayCallOut(settings)) return 'closed';
  const held = license ?? (await getLicense());
  if (mayCallOut(settings, held, await consentWhereAsked(settings, held))) return null;
  if ((settings as GateSettings).aiAnalysisEnabled === false) return 'switch-off';
  if (held.tier === 'free') return 'no-key';
  return 'no-agreement';
}

/** mayCallOut, with the licence and the agreement read where they are needed. */
export async function mayCallOutNow(settings: SettingsLike, license?: LicenseInfo): Promise<boolean> {
  return (await gateRefusal(settings, license)) === null;
}
