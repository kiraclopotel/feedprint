// @vitest-environment jsdom
//
// W88 — route-guard for the YouTube selector-family sweeps.
//
// Owner diagnostics 2026-08-18 showed youtube.engagement-metrics and
// youtube.action-buttons at "0 primary / 100% miss". Live /watch DOM
// (verified via Chrome MCP on two videos, 2026-08-18) matches the core
// selectors, so the miss flood was structural: the metrics + actions sweeps
// reported on EVERY YouTube route — home feed, search, channel pages —
// where matching nothing is normal (the selectors target /watch + /shorts
// renderers). The comment-block sweep already had this guard (see
// controlCommentPosting); this extends it to the other two families, per
// the selector-health LABELING RULE ("do not label reads where a miss is
// the normal outcome").

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/content/engagement/selector-family-miss', () => ({
  noteSelectorFamilySweep: vi.fn(),
}));
// The rAF observer would keep firing after the test; stub it inert.
vi.mock('../../../../src/content/post-path/raf-observer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/content/post-path/raf-observer')>()),
  createRafBodyObserver: vi.fn(() => ({ cleanup: () => {} })),
}));

import { startYouTubeEngagementControl } from '../../../../src/content/engagement/youtube-engagement';
import { noteSelectorFamilySweep } from '../../../../src/content/engagement/selector-family-miss';
import type { FWSettings } from '../../../../src/storage/settings';

const sweepMock = noteSelectorFamilySweep as unknown as ReturnType<typeof vi.fn>;

// Minimal settings shape: every feature enabled for the youtube platform so
// all three control functions run their sweeps.
function settingsAllOn(): FWSettings {
  return {
    features: {
      'hide-engagement-metrics': { enabled: true },
      'hide-action-buttons': { enabled: true },
      'block-comment-posting': { enabled: true },
    },
  } as unknown as FWSettings;
}

let cleanup: (() => void) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers(); // keep the 2s polling interval from leaking real timers
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.useRealTimers();
});

describe('YouTube sweep route guards', () => {
  it('on the home feed (/) no family reports — matching nothing there is normal', () => {
    history.replaceState({}, '', '/');
    cleanup = startYouTubeEngagementControl(settingsAllOn());
    expect(sweepMock).not.toHaveBeenCalled();
  });

  it('on /watch all three families report their sweep result', () => {
    history.replaceState({}, '', '/watch');
    cleanup = startYouTubeEngagementControl(settingsAllOn());
    const labels = sweepMock.mock.calls.map((c: unknown[]) => c[0]);
    expect(labels).toContain('youtube.engagement-metrics');
    expect(labels).toContain('youtube.action-buttons');
    expect(labels).toContain('youtube.comment-block');
  });

  it('on /shorts all three families report their sweep result', () => {
    history.replaceState({}, '', '/shorts/abc123');
    cleanup = startYouTubeEngagementControl(settingsAllOn());
    const labels = sweepMock.mock.calls.map((c: unknown[]) => c[0]);
    expect(labels).toContain('youtube.engagement-metrics');
    expect(labels).toContain('youtube.action-buttons');
    expect(labels).toContain('youtube.comment-block');
  });

  it('on a channel page no family reports', () => {
    history.replaceState({}, '', '/@somechannel');
    cleanup = startYouTubeEngagementControl(settingsAllOn());
    expect(sweepMock).not.toHaveBeenCalled();
  });
});
