// FeelingWise — parent-triggered platform-wide media timeout.
//
// When the `media-timeout` feature is enabled for a platform, this module
// injects a full-screen opaque overlay over the document and silences all
// playing media. The block stays in place for the whole session until the
// parent flips the toggle off.
//
// Scheduled quiet hours (added 2026-08-05). The toggle's value may carry
// `{ schedule: QuietHoursWindow[] }`; see core/quiet-hours.ts for the window
// semantics and for why the manual toggle stays master in both directions.
// With the toggle OFF and a schedule present, this module runs a per-minute
// tick that mounts the overlay when a window opens and unmounts it when the
// window closes. A per-minute tick is enough because the overlay is DOM-side
// and lives in the content script: a chrome.alarm would fire in the service
// worker, on the far side of a message hop, for no gain in edge precision.
// Editing the schedule is PIN-gated by the settings panel like every other
// setting; nothing here re-checks the PIN.
//
// The overlay is a single fixed-position div at the maximum 32-bit z-index
// (2147483647). Every covered surface — IG, FB, TikTok, X, YouTube — sees
// the same black surface; pointer-events absorb every click; the page
// underneath cannot scroll. One line on it says why (i18n/cover-strings.ts):
// a black page with no words reads as a site that failed to load.
//
// Mute discipline. The overlay hides the platform visually but the
// underlying <video>/<audio> elements would keep playing audio without
// active suppression. We pause + mute every media element on init and
// re-mute via MutationObserver any element added or modified afterwards
// (SPA hydration, in-feed lazy-mounted videos).
//
// Forensic write. One `BLOCKED_LOG` record per platform per activation,
// `blockReason: 'media-timeout'`, `matchedToken: 'parent-toggle'` for the
// manual switch and `'quiet-hours-schedule'` when a scheduled window opened
// it. The chain captures when the timeout went up, on which platform, and
// which of the two authorities put it there; re-fires of the observer within
// one activation don't write duplicate records. A scheduled block that ends
// and re-opens the next night is a second activation and writes a second
// record, because two separate nights of protection are two facts.
//
// Scope. Applies to every platform the engagement controller is wired
// for (twitter, facebook, instagram, tiktok, youtube), and the switch is
// PER-PLATFORM: every read here passes the platform to isFeatureEnabled,
// and the popup ships five independent break rows writing
// perPlatform[p].enabled. This said the toggle was global across all
// supported platforms, with per-platform control still to come, until
// 2026-09-19; a parent or a reviewer taking that at face value would have
// believed one break switch covered all five sites.

import type { FWSettings } from '../../storage/settings';
import { isFeatureEnabled, getFeatureValue } from '../../storage/settings';
import { countHiddenFor } from './mark-hidden';
import type { Platform } from '../../types/post';
import type { BlockedEventInput } from '../../types/logger-events';
import { recordBlocked } from './recorder-sink';
import { currentPageAddress } from '../record/post-url';
import { createRafBodyObserver } from '../post-path/raf-observer';
import { readQuietHoursSchedule, isWithinQuietHours } from '../../core/quiet-hours';
import { ensureStyleTag, removeStyleTag } from './style-tag';
import { resolveUiLanguage } from '../../i18n';
import { COVER_STRINGS, COVER_SITE_NAMES } from '../../i18n/cover-strings';

const OVERLAY_ID = 'fw-media-timeout-overlay';
const STYLE_TAG_ID = 'fw-media-timeout-css';
const BODY_MARKER = 'data-fw-media-timeout';

/** How often the schedule is re-evaluated. Sets the worst-case edge lag. */
const SCHEDULE_TICK_MS = 60_000;

type TimeoutAuthority = 'parent-toggle' | 'quiet-hours-schedule';

// Module-level flag to keep the BLOCKED_LOG dispatch idempotent across
// MutationObserver re-fires within a single session. Reset by the
// disposer returned from startMediaTimeout.
const _forensicDispatched = new Set<Platform>();

// Maximum 32-bit signed z-index beats any platform's z-index war. Inset:0
// covers the entire viewport regardless of the page's transform context
// because position:fixed roots to the viewport, not the offset parent.
// Body marker disables scrolling under the overlay so a swipe / scroll
// gesture doesn't leak through to the platform underneath.
const OVERLAY_CSS = `
    #${OVERLAY_ID} {
      position: fixed !important;
      inset: 0 !important;
      background: #000 !important;
      z-index: 2147483647 !important;
      pointer-events: auto !important;
      margin: 0 !important;
      padding: 0 16px !important;
      box-sizing: border-box !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      text-align: center !important;
      color: #e8e8e8 !important;
      font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif !important;
    }
    [${BODY_MARKER}="true"] {
      overflow: hidden !important;
    }
  `;

function ensureOverlay(line: string): HTMLElement {
  ensureStyleTag(STYLE_TAG_ID, OVERLAY_CSS);
  let overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.setAttribute('role', 'status');
    document.body.appendChild(overlay);
  }
  if (overlay.textContent !== line) overlay.textContent = line;
  document.body.setAttribute(BODY_MARKER, 'true');
  return overlay;
}

/**
 * Only the elements THIS feature silenced, with the state they had before.
 * The teardown used to unmute and play every media element on the page,
 * including videos another path hid for graphic harm and videos the child
 * had paused, on any feature toggle or quiet-window close
 * (MEDIA-ENGAGEMENT-1). A WeakMap so a recycled element never leaks.
 */
const mutedByTimeout = new WeakMap<HTMLMediaElement, { wasMuted: boolean; wasPaused: boolean }>();
const mutedElements = new Set<HTMLMediaElement>();

/** Media inside a container another protection path hid stays as that path left it. */
function insideProtectedContainer(media: HTMLMediaElement): boolean {
  return media.closest('[data-fw-blocked], [data-fw-hard-hidden]') !== null
    || media.closest('.fw-provisional-shield') !== null;
}

function muteAllMediaIn(root: HTMLElement | Document = document): void {
  root.querySelectorAll<HTMLMediaElement>('video, audio').forEach(media => {
    try {
      if (insideProtectedContainer(media)) return;
      if (!mutedByTimeout.has(media)) {
        mutedByTimeout.set(media, { wasMuted: media.muted, wasPaused: media.paused });
        mutedElements.add(media);
      }
      media.muted = true;
      media.pause();
    } catch {
      // Transitional media state — ignore.
    }
  });
}

function dispatchForensicOnce(
  platform: Platform,
  mode: 'child' | 'teen' | 'adult',
  authority: TimeoutAuthority,
): void {
  if (_forensicDispatched.has(platform)) return;
  _forensicDispatched.add(platform);
  const payload: BlockedEventInput = {
    platform,
    mode,
    author: 'parent-action',
    postUrl: currentPageAddress(),
    blockReason: 'media-timeout',
    matchedToken: authority,
    caption: '',
  };
  recordBlocked(payload);
}

function applyTimeout(
  platform: Platform,
  mode: 'child' | 'teen' | 'adult',
  authority: TimeoutAuthority,
  line: string,
): void {
  ensureOverlay(line);
  muteAllMediaIn();
  countHiddenFor('media-timeout');
  dispatchForensicOnce(platform, mode, authority);
}

/**
 * Reverse of muteAllMediaIn. Without this, the overlay came down when a
 * quiet-hours window closed (or the parent toggled off) but every video and
 * audio element on the page stayed muted and paused until a reload — the
 * same hole the reels and AI-content blockers already fixed with their
 * unmute-on-release passes.
 */
function unmuteAllMediaIn(): void {
  for (const media of mutedElements) {
    const prior = mutedByTimeout.get(media);
    mutedByTimeout.delete(media);
    if (!prior) continue;
    try {
      // Never touch media another protection path has since hidden.
      if (insideProtectedContainer(media)) continue;
      media.muted = prior.wasMuted;
      // Only resume what was playing before; a video the child paused, or
      // one that was never started, stays paused.
      if (!prior.wasPaused) {
        const result = media.play();
        if (result !== undefined && typeof result.catch === 'function') {
          result.catch(() => { /* autoplay-blocked is fine */ });
        }
      }
    } catch {
      // Transitional media state — ignore.
    }
  }
  mutedElements.clear();
}

function resetDOM(): void {
  document.getElementById(OVERLAY_ID)?.remove();
  removeStyleTag(STYLE_TAG_ID);
  document.body.removeAttribute(BODY_MARKER);
  unmuteAllMediaIn();
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Whether this module has anything to do for a platform: the manual toggle
 * is on, OR a well-formed quiet-hours schedule is present. The engagement
 * controller gates activation on this, because a scheduled block whose
 * toggle is off must still start the controller or the schedule would never
 * be evaluated.
 */
export function mediaTimeoutHasWork(settings: FWSettings, platform: Platform): boolean {
  if (isFeatureEnabled(settings, 'media-timeout', platform)) return true;
  return readQuietHoursSchedule(getFeatureValue(settings, 'media-timeout', platform)).length > 0;
}

export function startMediaTimeout(
  platform: Platform,
  settings: FWSettings,
): () => void {
  const manualOn = isFeatureEnabled(settings, 'media-timeout', platform);
  // The manual toggle is master: when it is on there is nothing to schedule,
  // the block is unconditional for the session.
  const schedule = manualOn
    ? []
    : readQuietHoursSchedule(getFeatureValue(settings, 'media-timeout', platform));
  if (!manualOn && schedule.length === 0) {
    return () => {};
  }
  const authority: TimeoutAuthority = manualOn ? 'parent-toggle' : 'quiet-hours-schedule';
  const words = COVER_STRINGS[resolveUiLanguage(settings.uiLanguage)];
  const site = COVER_SITE_NAMES[platform];
  const line = manualOn ? words.onBreak(site) : words.quietHours(site);
  console.log(
    `[FW media-timeout] active platform=${platform} authority=${authority}` +
      (schedule.length > 0 ? ` windows=${schedule.length}` : ''),
  );

  // One activation state for both authorities, so the observer, the tick and
  // the disposer all agree on whether the overlay is supposed to be up.
  let active = false;
  const setActive = (next: boolean): void => {
    if (next === active) return;
    active = next;
    if (active) {
      applyTimeout(platform, settings.mode, authority, line);
      return;
    }
    // Clearing the dispatch flag on the way down is what makes the NEXT
    // window write its own record.
    _forensicDispatched.delete(platform);
    resetDOM();
  };

  setActive(manualOn || isWithinQuietHours(schedule, new Date()));

  // MutationObserver covers two cases: (1) SPA navigation that replaces
  // <body> children — re-injects the overlay if it was removed; (2) the
  // platform's own scripts injecting late-loaded <video> / <audio> — we
  // re-mute on every body subtree change. Cheap to run because the
  // overlay short-circuits any paint reaching the user.
  // rAF-debounced body observer — see src/content/post-path/raf-observer.ts header.
  const { cleanup: cleanupObserver } = createRafBodyObserver(() => {
    if (!active) return;
    if (!document.getElementById(OVERLAY_ID)) {
      applyTimeout(platform, settings.mode, authority, line);
    }
    muteAllMediaIn();
  });

  const tickHandle =
    schedule.length > 0
      ? setInterval(() => {
          setActive(isWithinQuietHours(schedule, new Date()));
        }, SCHEDULE_TICK_MS)
      : undefined;

  return () => {
    if (tickHandle !== undefined) clearInterval(tickHandle);
    cleanupObserver();
    _forensicDispatched.delete(platform);
    resetDOM();
  };
}

// Exports for the engagement controller's master DOM-reset path.
export const MEDIA_TIMEOUT_OVERLAY_ID = OVERLAY_ID;
export const MEDIA_TIMEOUT_STYLE_TAG_ID = STYLE_TAG_ID;
export const MEDIA_TIMEOUT_BODY_MARKER = BODY_MARKER;
