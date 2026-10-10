// @vitest-environment jsdom
//
// The tester's finding 6 (9 Oct 2026): "Hide action buttons" hid like, share,
// save and Subscribe on a watch page and left "Join", the paid channel
// membership button. Read signed out the same night: the button is
// #sponsor-button, drawn beside Subscribe on a watch page (ILVRaV8Sli4).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/content/engagement/selector-family-miss', () => ({ noteSelectorFamilySweep: vi.fn() }));
vi.mock('../../../../src/content/post-path/raf-observer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/content/post-path/raf-observer')>()),
  createRafBodyObserver: vi.fn(() => ({ cleanup: () => {} })),
}));

import { startYouTubeEngagementControl } from '../../../../src/content/engagement/youtube-engagement';
import type { FWSettings } from '../../../../src/storage/settings';

const settings = (actions: boolean): FWSettings => ({
  features: { 'hide-action-buttons': { enabled: actions } },
} as unknown as FWSettings);

const WATCH = `<ytd-watch-metadata><div id="owner">
  <div id="sponsor-button"><ytd-button-renderer><button>Join</button></ytd-button-renderer></div>
  <div id="subscribe-button"><button>Subscribe</button></div>
</div><div id="actions"></div></ytd-watch-metadata>`;

let cleanup: (() => void) | null = null;
beforeEach(() => { vi.useFakeTimers(); history.replaceState({}, '', '/watch'); document.body.innerHTML = WATCH; });
afterEach(() => { cleanup?.(); cleanup = null; vi.useRealTimers(); document.body.innerHTML = ''; });

describe('the Join button is an action button', () => {
  it('goes with Subscribe when "Hide action buttons" is on', () => {
    cleanup = startYouTubeEngagementControl(settings(true));
    expect(document.getElementById('sponsor-button')!.getAttribute('data-fw-yt-action')).toBe('hidden');
    expect(document.getElementById('subscribe-button')!.getAttribute('data-fw-yt-action')).toBe('hidden');
  });

  it('stays when the switch is off', () => {
    cleanup = startYouTubeEngagementControl(settings(false));
    expect(document.getElementById('sponsor-button')!.hasAttribute('data-fw-yt-action')).toBe(false);
  });
});
