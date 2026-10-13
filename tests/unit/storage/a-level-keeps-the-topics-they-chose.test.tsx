/** @vitest-environment jsdom */
//
// A topic the person switched on (Topics U1, 13 Oct 2026) is their choice, not the level's: a level click, a reset to the
// level's defaults and the setup wizard all keep it as stored, and the question "this resets your switches" is never asked
// because of it. The same rule the person's own word list keeps (a-level-keeps-the-persons-own-list.test.tsx).

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

/** A grid on the given level with the gambling topic switched on. */
function gridWithTopic(mode: Mode): FeatureToggles {
  return { ...applyPreset(mode).features, 'topic-gambling': { enabled: true } } as FeatureToggles;
}

describe('a level keeps the topic switches', () => {
  it('puts the stored switch into the preset, whichever level it is, and the setup wizard writes through the same helper', () => {
    for (const preset of [childPreset(), teenPreset(), adultPreset()]) {
      expect(levelGridKeepingTheirs(preset, gridWithTopic('adult'))['topic-gambling']).toEqual({ enabled: true });
    }
  });

  it('a switch the person turned off stays off', () => {
    const stored = { ...applyPreset('teen').features, 'topic-gambling': { enabled: false } } as FeatureToggles;
    expect(levelGridKeepingTheirs(childPreset(), stored)['topic-gambling']).toEqual({ enabled: false });
  });

  it('a level never switches a topic on: nothing stored, the preset says off', () => {
    const stored = applyPreset('adult').features;
    delete (stored as Partial<FeatureToggles>)['topic-gambling'];
    for (const preset of [childPreset(), teenPreset(), adultPreset()]) {
      expect(levelGridKeepingTheirs(preset, stored)['topic-gambling']).toEqual({ enabled: false });
      expect(presetKeepingOwnList(preset, undefined)['topic-gambling']).toEqual({ enabled: false });
    }
  });

  it('does not change the grids it is given', () => {
    const preset = childPreset();
    const stored = gridWithTopic('adult');
    const before = [JSON.stringify(preset), JSON.stringify(stored)];
    levelGridKeepingTheirs(preset, stored);
    expect([JSON.stringify(preset), JSON.stringify(stored)]).toEqual(before);
  });
});

describe('the prompt counts the level\'s switches and not the topics', () => {
  it('a topic switched on is not something a reset would undo, so no reset link and no question', () => {
    expect(modeSwitchResetsToggles(gridWithTopic('adult'), 'adult')).toBe(false);
    expect(modeSwitchResetsToggles(gridWithTopic('teen'), 'teen')).toBe(false);
    expect(resolveModeClick({ mode: 'teen', features: gridWithTopic('teen') }, 'adult')).toBe('apply');
    expect(resolveModeClick({ mode: 'adult', features: gridWithTopic('adult') }, 'child')).toBe('apply');
  });

  it('a switch of the level changed by hand still asks, topic or no topic', () => {
    const changed = { ...gridWithTopic('adult'), 'show-reframe-markers': { enabled: false } } as FeatureToggles;
    expect(resolveModeClick({ mode: 'adult', features: changed }, 'child')).toBe('confirm');
    expect(modeSwitchResetsToggles(changed, 'adult')).toBe(true);
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
        mode: 'adult', features: gridWithTopic('adult'),
      },
    });
    onApplied.mockClear();
    box = document.createElement('div');
    document.body.appendChild(box);
    root = createRoot(box);
  });
  afterEach(() => { act(() => root.unmount()); box.remove(); stub.restore(); });

  it('an untouched level moves in one tap with the topic on, and the topic is still on', async () => {
    const before = await getSettings();
    expect(before.features['topic-gambling']).toEqual({ enabled: true });
    act(() => { root.render(createElement(Harness, { settings: { mode: 'adult', features: before.features, parentPin: 'x'.repeat(8) } })); });
    await act(async () => { state.onModeClick('child'); });
    expect(state.pendingMode, 'no question: nothing of the level was changed').toBeNull();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const after = await getSettings();
    expect(after.mode).toBe('child');
    expect(after.features['soften-swearing']).toEqual(childPreset()['soften-swearing']);
    expect(after.features['topic-gambling']).toEqual({ enabled: true });
  });

  it('Reset to defaults keeps the topic on too', async () => {
    const before = await getSettings();
    const features = { ...before.features, 'block-ads': { enabled: false } } as FeatureToggles;
    act(() => { root.render(createElement(Harness, { settings: { mode: 'adult', features, parentPin: '' } })); });
    act(() => state.requestReset());
    expect(state.pendingIsReset).toBe(true);
    await act(async () => { state.confirmPending(); });
    const after = await getSettings();
    expect(after.features['block-ads']).toEqual(adultPreset()['block-ads']);
    expect(after.features['topic-gambling']).toEqual({ enabled: true });
  });
});
