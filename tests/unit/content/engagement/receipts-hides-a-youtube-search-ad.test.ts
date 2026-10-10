// @vitest-environment jsdom
//
// Receipts, started through initEngagementControl as its content script starts it, hides and records a YouTube
// search ad slot: the controller starts the feed ad rule in Receipts too, and the rule names the slots Receipts'
// pipeline does not read. Every other test of the rule calls it directly or replaces it.

import { afterEach, describe, expect, it, vi } from 'vitest';
const recorded: string[] = [];
vi.mock('../../../../src/content/engagement/recorder-sink', () => ({ recordBlocked: (p: { matchedToken: string }) => { recorded.push(p.matchedToken); } }));
vi.mock('../../../../src/storage/settings', async (io) => ({ ...(await io<object>()), incrementMetricsHidden: vi.fn(() => Promise.resolve()), getSettings: async () => s() }));
vi.mock('../../../../src/storage/context-guard', () => ({ isContextAlive: () => true }));
import { _setProductForTesting } from '../../../../src/product';
import { initEngagementControl } from '../../../../src/content/engagement/controller';
import { adultPreset } from '../../../../src/storage/presets';
import { CURRENT_SETTINGS_SCHEMA_VERSION, type FWSettings } from '../../../../src/storage/settings';
const s = (): FWSettings => ({ settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION, mode: 'adult', strictLanguage: false, uiLanguage: 'auto', features: adultPreset(), presets: { appliedAt: '', appliedPreset: 'adult' } }) as unknown as FWSettings;
const BADGE = '<ad-avatar-lockup-view-model><div><div><ad-badge-view-model><badge-shape><div>Sponsored</div></badge-shape></ad-badge-view-model></div></div></ad-avatar-lockup-view-model>';
afterEach(() => { _setProductForTesting(null); vi.unstubAllGlobals(); });
describe('Receipts on YouTube search', () => {
  it('hides and records the ad slot through its own start', async () => {
    vi.stubGlobal('chrome', { storage: { onChanged: { addListener: () => {}, removeListener: () => {} }, local: { get: async () => ({}), set: async () => {} } }, runtime: { sendMessage: () => Promise.resolve() } });
    _setProductForTesting('receipts');
    document.body.innerHTML = `<ytd-search><ytd-ad-slot-renderer id="ad"><ytd-in-feed-ad-layout-renderer><div>${BADGE}</div></ytd-in-feed-ad-layout-renderer></ytd-ad-slot-renderer></ytd-search>`;
    const stop = await initEngagementControl('youtube');
    expect(document.querySelector('[data-fw-feed-ad="true"]')).not.toBeNull();
    expect(recorded).toContain('ad-slot');
    stop();
  });
});
