// Worker-realm heartbeat runner (evidence-gap register item 9, 2026-09-06).
// Reads the facts, hands them to the pure planner in forensics/heartbeat.ts,
// writes what it decides, persists the tick. Failure-tolerant: nothing here
// may stop the worker; a failed write leaves the tick unstamped so the next
// tick sees the same facts.

import {
  appendHeartbeatMarker,
  planHeartbeatTick,
  type HeartbeatState,
} from '../forensics/heartbeat';
import { appendGapMarker } from '../forensics/gap-marker';
import { getChainState } from '../forensics/store';
import { readExtractionCanary } from '../diagnostics/extraction-canary';
import { peekExcludedSkipped, consumeExcludedSkipped } from '../forensics/author-exclusions';

const HEARTBEAT_STATE_KEY = 'fw_heartbeat';

const PLATFORM_HOSTS: ReadonlyArray<[string, string]> = [
  ['twitter.com', 'twitter'],
  ['x.com', 'twitter'],
  ['instagram.com', 'instagram'],
  ['tiktok.com', 'tiktok'],
  ['facebook.com', 'facebook'],
  ['youtube.com', 'youtube'],
];

/** Platforms with an open tab, or null when tabs cannot be read in this realm. */
async function readPlatformsOpen(): Promise<string[] | null> {
  try {
    if (typeof chrome === 'undefined' || !chrome.tabs?.query) return null;
    const tabs = await chrome.tabs.query({ url: PLATFORM_HOSTS.map(([h]) => `*://*.${h}/*`) });
    const open = new Set<string>();
    for (const tab of tabs) {
      const host = tab.url ? new URL(tab.url).hostname : '';
      for (const [suffix, platform] of PLATFORM_HOSTS) {
        if (host === suffix || host.endsWith(`.${suffix}`)) open.add(platform);
      }
    }
    return [...open].sort();
  } catch {
    return null;
  }
}

async function readState(): Promise<HeartbeatState> {
  try {
    const got = await chrome.storage.local.get([HEARTBEAT_STATE_KEY]);
    const raw = got[HEARTBEAT_STATE_KEY];
    return raw && typeof raw === 'object' ? (raw as HeartbeatState) : {};
  } catch {
    return {};
  }
}

export type HeartbeatOutcome =
  | { status: 'ticked'; wroteGap: boolean; wroteHeartbeat: boolean }
  | { status: 'failed'; reason: string };

// A fresh worker woken by the alarm starts a tick at module scope and another
// for the alarm. Run together, both would read the same stale state and each
// sign a recorder-down gap for the same interval, so ticks run one at a time.
let queue: Promise<unknown> = Promise.resolve();

/**
 * One tick. 'alarm' may write a heartbeat; 'start' (a fresh worker realm) only
 * stamps the tick and writes the recorder-down gap when the last tick is
 * stale, so a worker that restarts every few minutes does not fill the chain.
 */
export function runHeartbeat(trigger: 'alarm' | 'start'): Promise<HeartbeatOutcome> {
  const tick = queue.then(() => runTick(trigger), () => runTick(trigger));
  queue = tick;
  return tick;
}

async function runTick(trigger: 'alarm' | 'start'): Promise<HeartbeatOutcome> {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return { status: 'failed', reason: 'no-storage' };
    const state = await readState();
    const [chain, platformsOpen, canary, skippedExcluded] = await Promise.all([
      getChainState(),
      readPlatformsOpen(),
      readExtractionCanary(),
      trigger === 'alarm' ? peekExcludedSkipped() : Promise.resolve(0),
    ]);
    const canaryWarnings: Record<string, string> = {};
    for (const [platform, w] of Object.entries(canary.warnings)) canaryWarnings[platform] = w.kind;
    const plan = planHeartbeatTick({
      state,
      nowISO: new Date().toISOString(),
      nextPosition: chain.nextPosition,
      platformsOpen,
      canaryWarnings,
      canaryStatus: canary.status,
      trigger,
      skippedExcluded,
    });
    if (plan.gap) await appendGapMarker(plan.gap);
    if (plan.heartbeat) {
      // The position the record actually took, not the one read before the
      // write: a gap marker in this same tick takes the slot the plan assumed,
      // and counting from the plan's number made the next heartbeat report one
      // position too many.
      const writtenAt = await appendHeartbeatMarker(plan.heartbeat);
      plan.nextState.positionAtWrite = writtenAt + 1;
      // Retire the skips only now that the marker stating them is on the chain.
      await consumeExcludedSkipped(plan.heartbeat.skippedExcluded);
    }
    await chrome.storage.local.set({ [HEARTBEAT_STATE_KEY]: plan.nextState });
    return { status: 'ticked', wroteGap: Boolean(plan.gap), wroteHeartbeat: Boolean(plan.heartbeat) };
  } catch (err) {
    return { status: 'failed', reason: err instanceof Error ? err.message : String(err) };
  }
}
