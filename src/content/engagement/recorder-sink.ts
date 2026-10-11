// Where the engagement modules hand a blocked item, when anyone is listening (PLAN-2026-09-16
// item 9.2).
//
// The filter hides things in both products: Reels and Shorts, feed ads, AI-labelled content, media
// past a timeout. In Feedprint each of those is also a record; in Off there is no record at all.
// The modules used to reach for the recorder's send path directly and that path asked
// `isOffProduct()` and returned early, which put the question "which product am I" inside the
// filter and put the recorder's module graph inside Off's bundle.
//
// Now the entry point decides: Feedprint installs a sink at start-up, Off installs nothing, and the
// filter just hands the payload over. Nothing here imports the recorder, so nothing pulls it in.

import type { BlockedEventInput } from '../../types/logger-events';

type BlockedSink = (payload: BlockedEventInput) => void;

let sink: BlockedSink | null = null;

/**
 * Install the recorder's blocked-item sink. Feedprint calls this once at start-up; Off never calls
 * it, so every recordBlocked() below is a no-op and no record path is reachable from the filter.
 */
export function setBlockedRecorder(next: BlockedSink | null): void {
  sink = next;
}

/** Hand a blocked item to the recorder if one is listening. Never throws, never blocks the hide. */
export function recordBlocked(payload: BlockedEventInput): void {
  if (!sink) return;
  try {
    sink(payload);
  } catch {
    // A recorder that throws must never stop the filter from hiding: the on-page action is the
    // promise, the record is the extra.
  }
}

/** For tests: forget whatever was installed. */
export function __resetBlockedRecorderForTest(): void {
  sink = null;
}
