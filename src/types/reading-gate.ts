// Who may send something out, in one place. makesNoOutsideCall (mode.ts) says what it always said: a
// fresh install whose level nobody has chosen, and Strict (Silent on the screens), send nothing. This file adds the one
// case where Strict is let through: an adult who holds a key that covers the reading, has the master switch
// on and has agreed once (the reading consent, kept per key). Without all of that, or with
// STRICT_READS_WITH_A_KEY shut, every answer here is the answer makesNoOutsideCall gave.
//
// The places that send ask here, so the sentence the screens print is true of the whole extension:
//   readingActive    the reading of a post or a comment (and what follows it: the time stamp, the relay's
//                    worker, the repair file, a refresh of the plan), because they travel with the reading
//   levelMayCallOut  the level alone: used where a key is already known to exist (the licence check)
//   mayCallOut       every place that asked makesNoOutsideCall before: today's answer, and Strict's too
//                    once its reading is active
// What stays with the callers, as it was: the daily allowance, the key the relay refused, the pause for
// the go-ahead, the plan's own feature list. They end a reading in the local result at every level.

import { levelMakesNoCalls, makesNoOutsideCall, type Mode } from './mode';
import { STRICT_READS_WITH_A_KEY } from './strict-reads-switch';

export interface GateSettings {
  mode: Mode;
  levelChosen?: boolean;
  aiAnalysisEnabled?: boolean;
}

export interface GateLicense {
  tier: string;
}

/**
 * The reading consent as the gate sees it: anything stored for this key, or null when the adult has not
 * agreed, or undefined when the caller did not look. Only Strict asks for it here; Moderate and Relaxed
 * carry it to the relay, which refuses a reading that lacks it (worker/src/proxy.ts consentGate).
 */
export type GateConsent = object | null | undefined;

/** The level alone may send: a level that was chosen, and not Strict unless Strict reads. */
export function levelMayCallOut(settings: GateSettings): boolean {
  if (settings.levelChosen === false) return false;
  if (levelMakesNoCalls(settings)) return STRICT_READS_WITH_A_KEY;
  return true;
}

/**
 * The reading goes out now: the level may send, the master switch is on, the key is a paid one, and at
 * Strict the adult has agreed. The plan's feature list and the allowance are the callers' checks.
 */
export function readingActive(settings: GateSettings, license: GateLicense, consent: GateConsent): boolean {
  if (!levelMayCallOut(settings)) return false;
  if (settings.aiAnalysisEnabled === false) return false;
  if (license.tier === 'free') return false;
  if (levelMakesNoCalls(settings)) return consent !== null && consent !== undefined;
  return true;
}

/** Every place that asked makesNoOutsideCall before: the same answer, except Strict with its reading active. */
export function mayCallOut(settings: GateSettings, license: GateLicense, consent: GateConsent): boolean {
  return !makesNoOutsideCall(settings) || readingActive(settings, license, consent);
}
