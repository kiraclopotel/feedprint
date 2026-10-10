// Off — content script entry.
//
// The whole of Off on a page is the engagement controller: the switches
// (counts, action buttons, comment posting, emoji, AI-content, Reels, ads,
// quiet hours) plus the word filter (the user's list, slurs, swearing).
// There is no pipeline, no queue, no record and no service worker. Settings
// changes reach the page through the controller's storage listener.

import type { Platform } from '../../types/post';
import { detectCurrentPlatform, isPrivateMessageSurface } from '../../content/platforms/adapter';
import { initEngagementControl } from '../../content/engagement/controller';
import { watchRecorder } from './stand-down';
import { recorderRuns, watchRecorderRuns } from '../../content/engagement/recorder-runs';
import { watchPrivateSurface } from './private-surface-watch';

function whenBodyReady(): Promise<void> {
  if (document.body) return Promise.resolve();
  return new Promise((resolve) => {
    document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
  });
}

async function main(): Promise<void> {
  // detectCurrentPlatform answers null on a private surface as well as on an
  // unsupported host, so the URL gate is already closed at boot.
  const platform = detectCurrentPlatform();
  if (!platform) return;
  if (isPrivateMessageSurface()) {
    // Not the end of it: these are single page applications, so the person can
    // walk out of Messages into the feed without loading anything. The watch
    // below is what notices, in both directions.
    watchForTheFeed();
    return;
  }
  await whenBodyReady();
  // A recorder that names nothing it runs runs every switch Off has, so Off
  // leaves the whole page to it. One that names what it runs gets exactly that.
  if (recorderRuns() === 'all') {
    console.log(`[Off] standing down on ${platform}: Feedprint (the recorder) is active here`);
    return;
  }
  await run(platform);
}

/** The running filters, or null when nothing is running on this page. */
let stopEngagement: (() => void) | null = null;
/** Set once a recorder that runs everything takes over, and never unset: Off is done here. */
let stoodDown = false;
/** Whether the running filters already leave the recorder's switches to it. */
let besideRecorder = false;
/** Guards a start that is still awaiting settings against a second one. */
let starting = false;
/** Each start replaces the recorder watch, so going in and out of conversations never stacks them. */
let stopRecorderWatch: (() => void) | null = null;
/** Beside a recorder, the watch on what it runs; replaced on each start for the same reason. */
let stopRunsWatch: (() => void) | null = null;

async function run(platform: Platform): Promise<void> {
  if (stoodDown || starting || stopEngagement) return;
  starting = true;
  try {
    const runs = recorderRuns();
    if (runs === 'all') { stoodDown = true; return; }
    besideRecorder = runs !== null;
    const stop = await initEngagementControl(platform, runs ? { leaveToRecorder: runs } : {});
    // The page may have walked into a conversation while settings were read.
    // The watch is what starts the filters again when it walks back out.
    if (stoodDown || isPrivateMessageSurface()) { stop(); watchForTheFeed(); return; }
    stopEngagement = stop;
  } finally {
    starting = false;
  }
  console.log(`[Off] active on ${platform}`);
  stopRecorderWatch?.();
  stopRecorderWatch = watchRecorder(() => {
    if (recorderRuns() === 'all') {
      stoodDown = true;
      try {
        halt();
      } catch (error) {
        console.warn('[Off] a filter did not stop cleanly while standing down', error);
      }
      console.log(`[Off] standing down on ${platform}: Feedprint (the recorder) started`);
      return;
    }
    if (besideRecorder) return;
    // The recorder arrived after Off started: start again, leaving it what it runs.
    try {
      halt();
    } catch (error) {
      console.warn('[Off] a filter did not stop cleanly; starting again beside the recorder', error);
    }
    console.log(`[Off] leaving what Feedprint (the recorder) runs on ${platform} to it; the rest stays on`);
    void run(platform);
  });
  // The recorder rewrites what it runs when its own settings change: start again from the new list.
  stopRunsWatch?.();
  stopRunsWatch = besideRecorder ? watchRecorderRuns(() => {
    try {
      halt();
    } catch (error) {
      console.warn('[Off] a filter did not stop cleanly; starting again from what the recorder runs now', error);
    }
    if (recorderRuns() === 'all') { stoodDown = true; return; }
    void run(platform);
  }) : null;
  watchForTheFeed();
}

function halt(): void {
  // Cleared before the stop runs: a stop that throws must not leave Off unable to start again.
  const stop = stopEngagement;
  stopEngagement = null;
  stop?.();
}

/** Installed once; follows the page in and out of private conversations. */
let watching = false;
function watchForTheFeed(): void {
  if (watching) return;
  watching = true;
  watchPrivateSurface({
    isPrivate: isPrivateMessageSurface,
    onEnter: () => {
      halt();
      console.log('[Off] standing down: this is a private conversation');
    },
    onLeave: () => {
      const platform = detectCurrentPlatform();
      if (platform) void run(platform);
    },
  });
}

main().catch((err) => console.error('[Off] init failed:', err));
