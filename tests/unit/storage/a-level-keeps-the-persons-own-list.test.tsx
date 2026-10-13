/** @vitest-environment jsdom */
//
// "Switch and reset" between levels emptied the person's own list of words, phrases and accounts: one word before, none after, and the
// dialog did not say so (the Tester's full test, 12 Oct 2026). The Leader's decision: the list is the person's, not the level's. A level
// sets the level's switches and never touches what the person wrote; the same list also holds the accounts blocked with "Block this".

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { installChromeStorageStub, type ChromeStorageStub } from '../../helpers/chrome-storage';
import { applyPreset, getSettings, utcDayKey, utcMonthKey, CURRENT_SETTINGS_SCHEMA_VERSION } from '../../../src/storage/settings';
import { adultPreset, childPreset, teenPreset } from '../../../src/storage/presets';
import { levelGridKeepingTheirs, presetKeepingOwnList } from '../../../src/storage/switch-scope';
import { modeSwitchResetsToggles, resolveModeClick, useModeSwitch, type ModeSwitchState } from '../../../src/ui/popup/switches';
import type { FeatureToggles } from '../../../src/types/feature-toggles';
import type { Mode } from '../../../src/types/mode';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const THEIRS = { words: ['gateword'], phrases: ['flat earth'], accounts: ['@someone'] };

/** A grid on the given level with the person's own list in it. */
function gridWithTheirList(mode: Mode): FeatureToggles {
  return { ...applyPreset(mode).features, 'parent-blocklist': { enabled: true, value: THEIRS } } as FeatureToggles;
}

describe('a level keeps the person\'s own list', () => {
  it('puts the stored list into the preset, whichever level it is', () => {
    for (const preset of [childPreset(), teenPreset(), adultPreset()]) {
      const grid = levelGridKeepingTheirs(preset, gridWithTheirList('adult'));
      expect(grid['parent-blocklist']?.value).toEqual(THEIRS);
    }
  });

  it('leaves the level\'s own switches as the preset has them', () => {
    const grid = levelGridKeepingTheirs(childPreset(), gridWithTheirList('adult'));
    expect(grid['soften-swearing']).toEqual(childPreset()['soften-swearing']);
    expect(grid['parent-blocklist']?.enabled).toBe(true);
  });

  it('the switch follows the level and only the list is kept', () => {
    const preset = { ...childPreset(), 'parent-blocklist': { enabled: true, value: { words: [], phrases: [], accounts: [] } } } as FeatureToggles;
    const stored = { ...gridWithTheirList('adult'), 'parent-blocklist': { enabled: false, value: THEIRS } } as FeatureToggles;
    const grid = presetKeepingOwnList(preset, stored);
    expect(grid['parent-blocklist']).toEqual({ enabled: true, value: THEIRS });
  });

  it('an install with no list stored gets the preset\'s empty one', () => {
    const stored = applyPreset('adult').features;
    delete (stored as Partial<FeatureToggles>)['parent-blocklist'];
    expect(levelGridKeepingTheirs(childPreset(), stored)['parent-blocklist']).toEqual(childPreset()['parent-blocklist']);
  });

  it('does not change the grids it is given', () => {
    const preset = childPreset();
    const stored = gridWithTheirList('adult');
    const before = [JSON.stringify(preset), JSON.stringify(stored)];
    levelGridKeepingTheirs(preset, stored);
    expect([JSON.stringify(preset), JSON.stringify(stored)]).toEqual(before);
  });
});

describe('the prompt counts the level\'s switches and not the list', () => {
  it('a list alone is not something a switch would reset', () => {
    expect(modeSwitchResetsToggles(gridWithTheirList('adult'), 'adult')).toBe(false);
    expect(resolveModeClick({ mode: 'teen', features: gridWithTheirList('adult') }, 'adult')).toBe('apply');
  });

  it('a different level differs in its switches, list or no list; asking is for a switch the person changed', () => {
    expect(modeSwitchResetsToggles(gridWithTheirList('adult'), 'child')).toBe(true);
    expect(resolveModeClick({ mode: 'adult', features: gridWithTheirList('adult') }, 'child'), 'only the list is theirs').toBe('apply');
    const changed = { ...gridWithTheirList('adult'), 'show-reframe-markers': { enabled: false } } as FeatureToggles;
    expect(resolveModeClick({ mode: 'adult', features: changed }, 'child')).toBe('confirm');
  });
});

describe('Switch and reset, end to end', () => {
  let stub: ChromeStorageStub;
  let root: Root;
  let box: HTMLDivElement;
  let state: ModeSwitchState;
  const onApplied = vi.fn(async () => undefined);

  function Harness({ settings }: { settings: Parameters<typeof useModeSwitch>[0] }) {
    state = useModeSwitch(settings, onApplied);
    return null;
  }

  beforeEach(() => {
    stub = installChromeStorageStub({
      initial: {
        settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION, lastResetDate: utcDayKey(), lastResetMonth: utcMonthKey(),
        mode: 'adult', features: gridWithTheirList('adult'),
      },
    });
    onApplied.mockClear();
    box = document.createElement('div');
    document.body.appendChild(box);
    root = createRoot(box);
  });
  afterEach(() => { act(() => root.unmount()); box.remove(); stub.restore(); });

  it('moving to another level resets the switches and keeps every word, phrase and account', async () => {
    const before = await getSettings();
    expect((before.features['parent-blocklist']?.value as typeof THEIRS).words).toEqual(['gateword']);
    // A switch of the level was changed by hand, so there is something to lose and the question is asked (12 Oct 2026).
    const features = { ...before.features, 'block-ads': { enabled: false } } as FeatureToggles;
    act(() => { root.render(createElement(Harness, { settings: { mode: 'adult', features, parentPin: 'x'.repeat(8) } })); });
    act(() => state.onModeClick('child'));
    expect(state.pendingMode).toBe('child');
    await act(async () => { state.confirmPending(); });
    const after = await getSettings();
    expect(after.mode).toBe('child');
    expect(after.features['soften-swearing']).toEqual(childPreset()['soften-swearing']);
    expect(after.features['parent-blocklist']?.value).toEqual(THEIRS);
  });

  it('Reset to defaults on the same level keeps them too', async () => {
    const before = await getSettings();
    // Something the level sets was changed by hand, so there is a reset to ask about.
    const features = { ...before.features, 'block-ads': { enabled: false } } as FeatureToggles;
    act(() => { root.render(createElement(Harness, { settings: { mode: 'adult', features, parentPin: '' } })); });
    act(() => state.requestReset());
    expect(state.pendingIsReset).toBe(true);
    await act(async () => { state.confirmPending(); });
    const after = await getSettings();
    expect(after.features['block-ads']).toEqual(adultPreset()['block-ads']);
    expect(after.features['parent-blocklist']?.value).toEqual(THEIRS);
  });
});
