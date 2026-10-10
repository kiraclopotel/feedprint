// The three settings. Their ids once named ages; they are now the internal names of three levels
// and are never shown to anyone. About seventy branches read the ids, and two of them coerce an
// unknown id without a sound (settings-shape.ts, content/index.ts), so the ids stay and the level's
// name is one function.
export type Mode = 'child' | 'teen' | 'adult';

/** What a person sets and sees, and what a new record signs. */
export type Level = 'strict' | 'moderate' | 'relaxed';

/** The level a setting is: child is strict, teen is moderate, adult is relaxed. */
export function levelOf(mode: Mode): Level {
  return mode === 'child' ? 'strict' : mode === 'teen' ? 'moderate' : 'relaxed';
}

/**
 * Strict makes no outside call of any kind: no reading, no licence check, no time stamp of the record.
 * The screens ask this to say so; the places that send something out ask makesNoOutsideCall below.
 */
export function levelMakesNoCalls(settings: { mode: Mode }): boolean {
  return levelOf(settings.mode) === 'strict';
}

/**
 * What every place that can send something out asks first, so the sentence the popup and the site
 * print about Strict is true of the whole extension and not only of the switches Strict sets. An
 * install whose level nobody has chosen yet makes no call either: it starts at Moderate's defaults,
 * and a call made before the person picks Strict would make that sentence untrue for them. Kept
 * apart from levelMakesNoCalls so the screens do not call an unchosen Moderate install Strict.
 */
export function makesNoOutsideCall(settings: { mode: Mode; levelChosen?: boolean }): boolean {
  // Only an explicit false waits, and only a fresh install writes one (noteLevelChosenOnInstall).
  return levelMakesNoCalls(settings) || settings.levelChosen === false;
}

/**
 * A signed mode field's value. Records written before the levels carry the old ids and are never
 * rewritten, since the value is inside the hash; new records carry the level.
 */
export type RecordedMode = Mode | Level;

/** The level a signed value names, whichever side of the change it was written on; null for anything else. */
export function levelOfRecorded(value: string | undefined): Level | null {
  if (value === 'strict' || value === 'moderate' || value === 'relaxed') return value;
  if (value === 'child' || value === 'teen' || value === 'adult') return levelOf(value);
  return null;
}

/** True for a value written before the levels, which a screen marks as the old setting. */
export function isBeforeLevels(value: string | undefined): value is Mode {
  return value === 'child' || value === 'teen' || value === 'adult';
}
