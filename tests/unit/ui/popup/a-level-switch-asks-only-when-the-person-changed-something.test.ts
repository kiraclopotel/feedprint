// The level switch asks a question only when the person changed something the switch would undo (the Leader's rule, 12 Oct 2026).
//
// Before: resolveModeClick asked whenever the TARGET level's grid differed from the current grid at all. Of the switches Feedprint
// shows, only swearing differs between the levels (Strict on, the others off), so an untouched install was asked a question on
// every move to or from Strict, though it had nothing to lose. Now it asks when two things are both true: the current grid differs
// from the current level's own preset (the person changed a switch and would lose it), and the target preset would change the grid
// (otherwise nothing is lost and nothing happens). The reset link already measures the first of these, so the two now agree on
// what "changed" means.

import { describe, it, expect } from 'vitest';
import { applyPreset, type FeatureToggles } from '../../../../src/storage/settings';
import { modeSwitchResetsToggles, resolveModeClick } from '../../../../src/ui/popup/switches';
import type { Mode } from '../../../../src/types/mode';

const MODES: Mode[] = ['child', 'teen', 'adult'];
const grid = (mode: Mode): FeatureToggles => applyPreset(mode).features;
const withSwitch = (features: FeatureToggles, id: string, enabled: boolean): FeatureToggles =>
  ({ ...features, [id]: { ...(features as unknown as Record<string, object>)[id], enabled } }) as unknown as FeatureToggles;

describe('an untouched level moves to any other level without a question', () => {
  it('untouched Relaxed to Strict applies', () => {
    expect(resolveModeClick({ mode: 'adult', features: grid('adult') }, 'child')).toBe('apply');
  });

  it('untouched Strict to Moderate applies', () => {
    expect(resolveModeClick({ mode: 'child', features: grid('child') }, 'teen')).toBe('apply');
  });

  it('every ordered pair of untouched levels applies, and a click on the current level is nothing', () => {
    for (const from of MODES) {
      for (const to of MODES) {
        const want = from === to ? 'noop' : 'apply';
        expect(resolveModeClick({ mode: from, features: grid(from) }, to), `${from} to ${to}`).toBe(want);
      }
    }
  });
});

describe('a level the person changed asks before the switch undoes the change', () => {
  it('Relaxed with the swearing mask turned on asks before going to Moderate, which has it off', () => {
    const edited = withSwitch(grid('adult'), 'soften-swearing', true);
    expect(modeSwitchResetsToggles(edited, 'adult'), 'the reset link sees the same change').toBe(true);
    expect(resolveModeClick({ mode: 'adult', features: edited }, 'teen')).toBe('confirm');
  });

  it('Moderate with the markers turned off asks before going to Strict or Relaxed', () => {
    const edited = withSwitch(grid('teen'), 'show-reframe-markers', false);
    expect(resolveModeClick({ mode: 'teen', features: edited }, 'child')).toBe('confirm');
    expect(resolveModeClick({ mode: 'teen', features: edited }, 'adult')).toBe('confirm');
  });

  it('a change that already equals the target loses nothing, so it applies: Relaxed with the swearing mask on and the markers off, to Strict', () => {
    const edited = withSwitch(withSwitch(grid('adult'), 'soften-swearing', true), 'show-reframe-markers', false);
    expect(modeSwitchResetsToggles(edited, 'child'), 'the target would change nothing').toBe(false);
    expect(resolveModeClick({ mode: 'adult', features: edited }, 'child')).toBe('apply');
  });

  it('the person\'s own list is never a change', () => {
    const withList = {
      ...grid('adult'),
      'parent-blocklist': { enabled: true, value: { words: ['mine'], phrases: [], accounts: [] } },
    } as unknown as FeatureToggles;
    expect(resolveModeClick({ mode: 'adult', features: withList }, 'child')).toBe('apply');
  });
});
