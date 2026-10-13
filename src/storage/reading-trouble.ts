// The reading service does not answer: a 5xx, a dropped connection, a call that ran out of time, several in a row.
//
// The consent pause (storage/reading-pause.ts) covers the relay saying "not started yet" and the 429 pause covers "too
// fast". What was left was the relay failing outright (the Tester's full test, 11 Oct 2026): every post stays as written,
// with no dot and no word why, while the popup still shows the licence as fine. This marker is what makes that visible:
//   - it is written when this page has met a few failures in a row with no answer between them, and removed by the first
//     answer from the relay (any answer, an error status below 500 included: the relay is there);
//   - the popup's Home tab says so, the dashboard's Issues tab has a card, and the toolbar icon shows an amber "!";
//   - it asks nothing of the person and stops nothing: calls keep being tried, so the first one that gets through ends it.
//
// Kept in storage so the popup, the dashboard and the worker can read it; a marker whose last failure is old counts as
// gone (readingTroubleStands), so a person who closes the laptop in an outage does not find a "!" a week later.

/** Storage key. Value: ReadingTroubleMarker. */
export const READING_TROUBLE_STORAGE_KEY = 'readingTrouble';

/** Failures in a row, with no answer between them, before the marker is written. */
export const READING_TROUBLE_AFTER = 4;
/** Failures further apart than this do not add up. */
export const READING_TROUBLE_GAP_MS = 2 * 60 * 1000;
/** A marker counts as standing for this long after its last failure. */
export const READING_TROUBLE_FRESH_MS = 15 * 60 * 1000;
/** The marker is rewritten at most this often while the trouble goes on. */
const WRITE_EVERY_MS = 60 * 1000;
/** An answer looks in storage for a marker another page wrote at most this often. */
const CLEAR_CHECK_EVERY_MS = 30 * 1000;

export interface ReadingTroubleMarker {
  /** When the first failure of this stretch happened, epoch milliseconds. */
  since: number;
  /** The latest failure. */
  at: number;
  failures: number;
}

export function readingTroubleStands(value: unknown, now: number = Date.now()): boolean {
  const v = value as Partial<ReadingTroubleMarker> | null | undefined;
  return !!v && typeof v.at === 'number' && typeof v.since === 'number' && now - v.at <= READING_TROUBLE_FRESH_MS;
}

let count = 0;
let firstAt = 0;
let lastAt = 0;
let lastWriteAt = 0;
let lastClearCheckAt = 0;
let written = false;

function area(): chrome.storage.LocalStorageArea | null {
  try {
    return typeof chrome !== 'undefined' && chrome?.storage?.local ? chrome.storage.local : null;
  } catch {
    return null;
  }
}

/** The relay did not answer a call (a failure status of 500 or more, a dropped connection, the deadline). */
export function noteReadingFailure(now: number = Date.now()): void {
  if (count === 0 || now - lastAt > READING_TROUBLE_GAP_MS) {
    count = 0;
    firstAt = now;
  }
  count += 1;
  lastAt = now;
  if (count < READING_TROUBLE_AFTER) return;
  if (written && now - lastWriteAt < WRITE_EVERY_MS) return;
  if (!written) console.warn('[FeelingWise] the reading service has not answered several calls in a row; posts stay as written until it does');
  written = true;
  lastWriteAt = now;
  const marker: ReadingTroubleMarker = { since: firstAt, at: now, failures: count };
  const a = area();
  if (!a) return;
  try {
    void Promise.resolve(a.set({ [READING_TROUBLE_STORAGE_KEY]: marker })).catch(() => undefined);
  } catch { /* the marker is best-effort */ }
}

/** The relay answered a call, whatever the answer: it is there. */
export function noteReadingAnswered(now: number = Date.now()): void {
  count = 0;
  const mustLook = written || now - lastClearCheckAt >= CLEAR_CHECK_EVERY_MS;
  if (!mustLook) return;
  lastClearCheckAt = now;
  const a = area();
  if (!a) return;
  const clear = (): void => {
    written = false;
    try { void Promise.resolve(a.remove(READING_TROUBLE_STORAGE_KEY)).catch(() => undefined); } catch { /* best-effort */ }
  };
  if (written) { clear(); return; }
  try {
    void Promise.resolve(a.get(READING_TROUBLE_STORAGE_KEY))
      .then((stored) => { if (stored?.[READING_TROUBLE_STORAGE_KEY]) clear(); })
      .catch(() => undefined);
  } catch { /* best-effort */ }
}

export function _resetReadingTroubleForTests(): void {
  count = 0; firstAt = 0; lastAt = 0; lastWriteAt = 0; lastClearCheckAt = 0; written = false;
}
