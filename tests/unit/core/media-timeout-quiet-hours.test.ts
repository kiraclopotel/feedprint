// @vitest-environment jsdom
//
// Scheduled quiet hours on `media-timeout` (laydown section 8c).
//
// Two layers under test, deliberately separated:
//   1. The pure evaluator (`readQuietHoursSchedule`, `isWithinQuietHours`) —
//      total functions over plain data, including the overnight wrap that is
//      the easiest part of this feature to get silently wrong.
//   2. The engine (`startMediaTimeout`, `mediaTimeoutHasWork`) — that a
//      schedule with the toggle OFF still mounts and unmounts the overlay on
//      the per-minute tick, and that the manual toggle overrides the schedule
//      in both directions.
//
// Clock discipline: the evaluator reads the LOCAL clock, so every fixture
// date is built from local-time components (`new Date(y, m, d, h, min)`),
// never from a UTC string. A UTC fixture would pass or fail by timezone.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setBlockedRecorder, __resetBlockedRecorderForTest } from '../../../src/content/engagement/recorder-sink';
import { sendHighStakesForensicLog } from '../../../src/content/record/forensic-retry';
import {
  readQuietHoursSchedule,
  isWithinQuietHours,
  type QuietHoursWindow,
} from '../../../src/core/quiet-hours';
import {
  startMediaTimeout,
  mediaTimeoutHasWork,
  MEDIA_TIMEOUT_OVERLAY_ID,
} from '../../../src/content/engagement/media-timeout';
import {
  FWSettings,
  FeatureToggles,
  CURRENT_SETTINGS_SCHEMA_VERSION,
} from '../../../src/storage/settings';
import { teenPreset } from '../../../src/storage/presets';

// 2026-08-05 is a Wednesday; 2026-08-07 a Friday, 2026-08-08 a Saturday.
const WED = (h: number, min: number) => new Date(2026, 7, 5, h, min, 0, 0);
const FRI = (h: number, min: number) => new Date(2026, 7, 7, h, min, 0, 0);
const SAT = (h: number, min: number) => new Date(2026, 7, 8, h, min, 0, 0);

const SCHOOL_NIGHT: QuietHoursWindow = { days: [1, 2, 3, 4], startMin: 21 * 60, endMin: 23 * 60 };
const OVERNIGHT: QuietHoursWindow = { days: [5], startMin: 22 * 60, endMin: 6 * 60 };


// Receipts' own wiring: the filter hands a blocked item to the sink the entry point installs, and
// this is that sink (src/content/index.ts, PLAN-2026-09-16 item 9.2). Without it a hide records
// nothing, which is exactly what Off does.
beforeEach(() => {
  setBlockedRecorder((payload) => {
    void sendHighStakesForensicLog({ type: 'BLOCKED_LOG', payload });
  });
});
afterEach(() => {
  __resetBlockedRecorderForTest();
});

describe('quiet-hours evaluator — same-day windows', () => {
  it('is in-window inside the range on a listed day', () => {
    expect(isWithinQuietHours([SCHOOL_NIGHT], WED(21, 30))).toBe(true);
  });

  it('is out of window before the range', () => {
    expect(isWithinQuietHours([SCHOOL_NIGHT], WED(20, 59))).toBe(false);
  });

  it('is out of window on a day that is not listed', () => {
    // Saturday is not in days [1,2,3,4] even at the same clock time.
    expect(isWithinQuietHours([SCHOOL_NIGHT], SAT(21, 30))).toBe(false);
  });

  it('treats startMin as inclusive and endMin as exclusive', () => {
    expect(isWithinQuietHours([SCHOOL_NIGHT], WED(21, 0))).toBe(true);
    expect(isWithinQuietHours([SCHOOL_NIGHT], WED(23, 0))).toBe(false);
    expect(isWithinQuietHours([SCHOOL_NIGHT], WED(22, 59))).toBe(true);
  });

  it('supports endMin 1440 as "to midnight"', () => {
    const toMidnight: QuietHoursWindow = { days: [3], startMin: 23 * 60, endMin: 1440 };
    expect(isWithinQuietHours([toMidnight], WED(23, 59))).toBe(true);
    expect(isWithinQuietHours([toMidnight], WED(22, 59))).toBe(false);
  });

  it('an empty schedule is never in window', () => {
    expect(isWithinQuietHours([], WED(21, 30))).toBe(false);
  });

  it('matches if ANY window matches', () => {
    expect(isWithinQuietHours([OVERNIGHT, SCHOOL_NIGHT], WED(21, 30))).toBe(true);
  });
});

describe('quiet-hours evaluator — overnight wrap', () => {
  it('is in-window on the tail of the START day', () => {
    expect(isWithinQuietHours([OVERNIGHT], FRI(23, 0))).toBe(true);
  });

  it('is in-window on the head of the day AFTER the start day', () => {
    expect(isWithinQuietHours([OVERNIGHT], SAT(5, 0))).toBe(true);
  });

  it('is out of window after the wrap closes', () => {
    expect(isWithinQuietHours([OVERNIGHT], SAT(6, 0))).toBe(false);
  });

  it('does not fire on the start day before the window opens', () => {
    expect(isWithinQuietHours([OVERNIGHT], FRI(21, 59))).toBe(false);
  });

  it('does not fire on a morning whose PREVIOUS day is not listed', () => {
    // Wednesday 05:00 — Tuesday is not in days [5], so no wrap reaches here.
    expect(isWithinQuietHours([OVERNIGHT], WED(5, 0))).toBe(false);
  });

  it('wraps across the week boundary (Sunday window reaching Monday)', () => {
    const sundayNight: QuietHoursWindow = { days: [0], startMin: 23 * 60, endMin: 60 };
    // 2026-08-10 is a Monday, 00:30 — the previous day is Sunday.
    expect(isWithinQuietHours([sundayNight], new Date(2026, 7, 10, 0, 30))).toBe(true);
  });
});

describe('readQuietHoursSchedule — defensive read', () => {
  it('returns an empty schedule for absent or non-object values', () => {
    expect(readQuietHoursSchedule(undefined)).toEqual([]);
    expect(readQuietHoursSchedule(null)).toEqual([]);
    expect(readQuietHoursSchedule('21:00-23:00')).toEqual([]);
    expect(readQuietHoursSchedule({})).toEqual([]);
    expect(readQuietHoursSchedule({ schedule: 'nightly' })).toEqual([]);
  });

  it('keeps well-formed windows', () => {
    expect(readQuietHoursSchedule({ schedule: [SCHOOL_NIGHT] })).toEqual([SCHOOL_NIGHT]);
  });

  it('drops malformed windows instead of blocking around the clock', () => {
    const raw = {
      schedule: [
        null,
        'nonsense',
        { days: [1], startMin: -1, endMin: 600 },
        { days: [1], startMin: 60, endMin: 1441 },
        { days: [1], startMin: 60.5, endMin: 600 },
        { days: [1], startMin: 600, endMin: 600 }, // zero length
        { days: [], startMin: 60, endMin: 600 }, // no days
        { days: [1], startMin: 60 }, // no end
        SCHOOL_NIGHT,
      ],
    };
    expect(readQuietHoursSchedule(raw)).toEqual([SCHOOL_NIGHT]);
  });

  it('filters out-of-range day numbers but keeps the valid ones', () => {
    const raw = { schedule: [{ days: [1, 7, -2, 3], startMin: 60, endMin: 600 }] };
    expect(readQuietHoursSchedule(raw)).toEqual([{ days: [1, 3], startMin: 60, endMin: 600 }]);
  });
});

// ─── Engine ────────────────────────────────────────────────────────────────

function makeSettings(features: FeatureToggles): FWSettings {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    mode: 'child',
    strictLanguage: false, aiAnalysisEnabled: true,
    hideUnrewritable: false,
    parentPin: '', dailyCap: 2000, monthlyUsdCapOverride: null, locale: 'en',
    outputLanguage: 'auto', uiLanguage: 'auto',
    totalChecksToday: 0, totalNeutralizedToday: 0, totalTokensToday: 0,
    estimatedCostToday: 0, lastResetDate: '',
    totalChecksThisMonth: 0, totalTokensThisMonth: 0, lastResetMonth: '',
    totalTokensAllTime: 0, totalChecksAllTime: 0,
    totalNeutralizedAllTime: 0, estimatedCostAllTime: 0,
    features,
    presets: { appliedAt: '', appliedPreset: 'child' },
    dashboardTheme: 'dark',
  };
}

function settingsWithTimeout(enabled: boolean, value?: unknown): FWSettings {
  const features = teenPreset();
  for (const key of Object.keys(features)) {
    features[key as keyof typeof features].enabled = false;
  }
  features['media-timeout'] = { enabled, value };
  return makeSettings(features);
}

const overlayMounted = (): boolean =>
  document.getElementById(MEDIA_TIMEOUT_OVERLAY_ID) !== null;

beforeEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => { /* no-op */ }),
        remove: vi.fn(async () => { /* no-op */ }),
      },
      onChanged: { addListener: vi.fn() },
    },
    runtime: { sendMessage: vi.fn(() => Promise.resolve()) },
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

describe('mediaTimeoutHasWork', () => {
  it('is true when the manual toggle is on', () => {
    expect(mediaTimeoutHasWork(settingsWithTimeout(true), 'tiktok')).toBe(true);
  });

  it('is true when the toggle is off but a schedule is present', () => {
    const settings = settingsWithTimeout(false, { schedule: [SCHOOL_NIGHT] });
    expect(mediaTimeoutHasWork(settings, 'tiktok')).toBe(true);
  });

  it('is false when the toggle is off and the schedule is malformed or absent', () => {
    expect(mediaTimeoutHasWork(settingsWithTimeout(false), 'tiktok')).toBe(false);
    expect(
      mediaTimeoutHasWork(settingsWithTimeout(false, { schedule: [{ days: [] }] }), 'tiktok'),
    ).toBe(false);
  });
});

describe('startMediaTimeout — scheduled quiet hours', () => {
  it('does nothing when the toggle is off and there is no schedule', () => {
    const stop = startMediaTimeout('tiktok', settingsWithTimeout(false));
    expect(overlayMounted()).toBe(false);
    stop();
  });

  it('mounts immediately when the schedule is already in window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(WED(21, 30));
    const stop = startMediaTimeout('tiktok', settingsWithTimeout(false, { schedule: [SCHOOL_NIGHT] }));
    expect(overlayMounted()).toBe(true);
    stop();
    expect(overlayMounted()).toBe(false);
  });

  it('mounts when the window opens and unmounts when it closes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(WED(20, 58));
    const stop = startMediaTimeout('tiktok', settingsWithTimeout(false, { schedule: [SCHOOL_NIGHT] }));
    expect(overlayMounted()).toBe(false);

    // Cross 21:00 — the tick fires once a minute.
    vi.advanceTimersByTime(3 * 60_000);
    expect(overlayMounted()).toBe(true);

    // Cross 23:00.
    vi.advanceTimersByTime(2 * 60 * 60_000);
    expect(overlayMounted()).toBe(false);

    stop();
  });

  it('the manual toggle overrides the schedule: on now even out of window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(WED(9, 0));
    const stop = startMediaTimeout('tiktok', settingsWithTimeout(true, { schedule: [SCHOOL_NIGHT] }));
    expect(overlayMounted()).toBe(true);

    // No schedule tick may take the overlay down while the toggle is on.
    vi.advanceTimersByTime(60 * 60_000);
    expect(overlayMounted()).toBe(true);

    stop();
    expect(overlayMounted()).toBe(false);
  });

  it('stops ticking after teardown', () => {
    vi.useFakeTimers();
    vi.setSystemTime(WED(20, 58));
    const stop = startMediaTimeout('tiktok', settingsWithTimeout(false, { schedule: [SCHOOL_NIGHT] }));
    stop();
    vi.advanceTimersByTime(10 * 60_000);
    expect(overlayMounted()).toBe(false);
  });

  it('writes one forensic record per activation, not per tick', () => {
    vi.useFakeTimers();
    vi.setSystemTime(WED(20, 58));
    const sendMessage = (globalThis as unknown as {
      chrome: { runtime: { sendMessage: ReturnType<typeof vi.fn> } };
    }).chrome.runtime.sendMessage;

    const stop = startMediaTimeout('tiktok', settingsWithTimeout(false, { schedule: [SCHOOL_NIGHT] }));
    vi.advanceTimersByTime(5 * 60_000); // opens the window, then keeps ticking
    const blockedLogs = sendMessage.mock.calls.filter(
      ([msg]) => (msg as { type?: string } | undefined)?.type === 'BLOCKED_LOG',
    );
    expect(blockedLogs).toHaveLength(1);
    expect(
      (blockedLogs[0][0] as { payload: { matchedToken: string } }).payload.matchedToken,
    ).toBe('quiet-hours-schedule');
    stop();
  });
});

// MEDIA-ENGAGEMENT-1: teardown restores only what media-timeout itself muted,
// with the state it had, and never touches media inside a container another
// protection path hid.
describe('startMediaTimeout — restore only what it muted', () => {
  function mediaEl(opts: { muted: boolean; paused: boolean }, parent: HTMLElement = document.body): HTMLVideoElement {
    const v = document.createElement('video');
    v.muted = opts.muted;
    let paused = opts.paused;
    Object.defineProperty(v, 'paused', { get: () => paused, configurable: true });
    v.pause = vi.fn(() => { paused = true; });
    v.play = vi.fn(() => { paused = false; return Promise.resolve(); });
    parent.appendChild(v);
    return v;
  }

  it('a video hidden for graphic harm stays muted and paused through resetDOM', () => {
    const blocked = document.createElement('div');
    blocked.setAttribute('data-fw-blocked', 'video-context');
    document.body.appendChild(blocked);
    const flagged = mediaEl({ muted: true, paused: true }, blocked);
    const playing = mediaEl({ muted: false, paused: false });
    const userPaused = mediaEl({ muted: false, paused: true });

    const stop = startMediaTimeout('tiktok', settingsWithTimeout(true));
    expect(overlayMounted()).toBe(true);
    expect(playing.muted).toBe(true);
    expect(playing.pause).toHaveBeenCalled();
    // Media behind another path's hide is left exactly as that path set it.
    expect(flagged.pause).not.toHaveBeenCalled();

    stop();
    expect(overlayMounted()).toBe(false);
    // The playing video comes back; the flagged one is untouched.
    expect(playing.muted).toBe(false);
    expect(playing.play).toHaveBeenCalledTimes(1);
    expect(flagged.muted).toBe(true);
    expect(flagged.play).not.toHaveBeenCalled();
    // A video the child had paused is unmuted but not started.
    expect(userPaused.muted).toBe(false);
    expect(userPaused.play).not.toHaveBeenCalled();
  });

  it('a video hidden by another path AFTER the timeout muted it is not resumed at teardown', () => {
    const wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
    const video = mediaEl({ muted: false, paused: false }, wrapper);
    const stop = startMediaTimeout('tiktok', settingsWithTimeout(true));
    expect(video.muted).toBe(true);
    wrapper.setAttribute('data-fw-blocked', 'image-context');
    stop();
    expect(video.muted).toBe(true);
    expect(video.play).not.toHaveBeenCalled();
  });
});
