// FeelingWise — Adult mode (re-introduced 2026-06-05, chain-centric reframe).
// Locks: preset mapping, the adult preset's deliberate toggle choices, and that
// adult reads the teen severity floor (adult is the lightest family member;
// the matrix stays keyed child|teen for hash stability — see neutralizer.ts).

import { describe, it, expect } from 'vitest';
import { presetForMode, adultPreset, teenPreset, childPreset } from '../../../src/storage/presets';
import { severityFloorFor } from '../../../src/core/neutralizer';

describe('presetForMode', () => {
  it('maps each mode to its preset', () => {
    expect(presetForMode('child')).toEqual(childPreset());
    expect(presetForMode('teen')).toEqual(teenPreset());
    expect(presetForMode('adult')).toEqual(adultPreset());
  });
});

describe('adultPreset — light by default; adult enables the rest', () => {
  const p = adultPreset();
  it('ships with only the visible-value features on (rewrite + reframe markers)', () => {
    expect(p['rewritten-comments-first'].enabled).toBe(true);
    expect(p['show-reframe-markers'].enabled).toBe(true);
  });
  it('leaves the on-device protections OFF for the adult to opt into', () => {
    expect(p['hide-engagement-metrics'].enabled).toBe(false);
    expect(p['hide-action-buttons'].enabled).toBe(false);
    expect(p['block-ai-content'].enabled).toBe(false);
    expect(p['block-reels'].enabled).toBe(false);
    expect(p['strip-emojis'].enabled).toBe(false);
  });
  it('does NOT silence the adult (block-comment-posting off) and does not auto-pause (media-timeout off)', () => {
    expect(p['block-comment-posting'].enabled).toBe(false);
    expect(p['media-timeout'].enabled).toBe(false);
  });
});

describe('severityFloorFor — adult reads the teen floor', () => {
  const techniques = ['shame-attack', 'scapegoating', 'fear-appeal', 'anger-trigger', 'not-a-real-technique'];
  it.each(techniques)('adult floor === teen floor for %s', (t) => {
    expect(severityFloorFor(t, 'adult')).toBe(severityFloorFor(t, 'teen'));
  });
  it('returns the universal floor when no mode is given', () => {
    expect(severityFloorFor('shame-attack', undefined)).toBe(severityFloorFor(undefined, undefined));
  });
});
