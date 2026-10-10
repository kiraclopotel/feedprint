// LOOP-029 / DEC-011 / DESIGN §10.3 — preset purity + completeness.
// Locks the child / teen preset defaults confirmed 2026-04-20 (with
// 2026-04-25 LOOP-200 adult removal, 2026-04-28 V2-staging cleanup, the
// 2026-04-28 evening retirement of replace-toxic + educational-topic-pool,
// and the 2026-04-28 evening addition of `strip-emojis` applied — see
// src/storage/settings.ts:78 for the running list of FeatureId removals).

import { describe, it, expect } from 'vitest';

import { childPreset, teenPreset, adultPreset } from '../../../src/storage/presets';
import { ALL_FEATURE_IDS, FeatureId } from '../../../src/storage/settings';

describe('presets (LOOP-029 / DEC-011 / DESIGN §10.3 / DEC-015 family-only)', () => {
  describe('completeness — every preset defines every FeatureId', () => {
    it('childPreset covers all FeatureIds', () => {
      const toggles = childPreset();
      for (const id of ALL_FEATURE_IDS) {
        expect(toggles[id], `missing ${id}`).toBeDefined();
        expect(typeof toggles[id].enabled).toBe('boolean');
      }
      expect(new Set(Object.keys(toggles))).toEqual(new Set(ALL_FEATURE_IDS));
    });

    it('teenPreset covers all FeatureIds', () => {
      const toggles = teenPreset();
      for (const id of ALL_FEATURE_IDS) {
        expect(toggles[id], `missing ${id}`).toBeDefined();
      }
      expect(new Set(Object.keys(toggles))).toEqual(new Set(ALL_FEATURE_IDS));
    });
  });

  describe('purity — each call returns a fresh object', () => {
    it('childPreset — mutating the returned object does not affect future calls', () => {
      const a = childPreset();
      a['rewritten-comments-first'].enabled = false;
      const b = childPreset();
      expect(b['rewritten-comments-first'].enabled).toBe(true);
    });

    it('teenPreset — mutating the returned object does not affect future calls', () => {
      const a = teenPreset();
      a['hide-action-buttons'].enabled = true;
      const b = teenPreset();
      expect(b['hide-action-buttons'].enabled).toBe(false);
    });

    it('presets do not alias each other', () => {
      const c = childPreset();
      const t = teenPreset();
      c['rewritten-comments-first'].enabled = false;
      expect(t['rewritten-comments-first'].enabled).toBe(true);
    });
  });

  describe('child preset defaults — CYCLE N+18 maximum-protection policy', () => {
    const c = childPreset();
    const cases: Array<[FeatureId, boolean]> = [
      // Default protection (core) — ON.
      ['rewritten-comments-first', true],
      ['show-reframe-markers', true],
      // Additional protections — ALL ON (Child = maximum protection).
      ['hide-engagement-metrics', true],
      ['hide-action-buttons', true],
      ['block-comment-posting', true],
      ['strip-emojis', true],
      ['block-ai-content', true],
      ['block-reels', true],
      ['block-ads', true],
      // Parent-trigger only.
      ['media-timeout', false],
    ];
    it.each(cases)('%s → enabled=%s', (id, enabled) => {
      expect(c[id].enabled).toBe(enabled);
    });
    it('block-ai-content seeded with default hashtag list', () => {
      const v = c['block-ai-content'].value as { hashtags: string[] };
      expect(Array.isArray(v?.hashtags)).toBe(true);
      expect(v.hashtags.length).toBeGreaterThan(0);
    });
    it('comments-to-analyze-per-video = 25', () => {
      expect(c['comments-to-analyze-per-video'].enabled).toBe(true);
      expect(c['comments-to-analyze-per-video'].value).toBe(25);
    });
  });

  describe('teen preset defaults — CYCLE N+18 selective-opt-in policy', () => {
    const t = teenPreset();
    const cases: Array<[FeatureId, boolean]> = [
      // Default protection (core) — ON.
      ['rewritten-comments-first', true],
      ['show-reframe-markers', true],
      // Additional protections — three ON (block-ai-content, metric
      // hider, strip-emojis); two OFF for adolescent autonomy
      // (action-button hider, comment-post block); reels-blocker OFF.
      ['hide-engagement-metrics', true],
      ['hide-action-buttons', false],
      ['block-comment-posting', false],
      ['strip-emojis', true],
      ['block-ai-content', true],
      ['block-reels', false],
      ['block-ads', true],
      // Parent-trigger only.
      ['media-timeout', false],
    ];
    it.each(cases)('%s → enabled=%s', (id, enabled) => {
      expect(t[id].enabled).toBe(enabled);
    });
    it('block-ai-content seeded with default hashtag list', () => {
      const v = t['block-ai-content'].value as { hashtags: string[] };
      expect(Array.isArray(v?.hashtags)).toBe(true);
      expect(v.hashtags.length).toBeGreaterThan(0);
    });
    it('comments-to-analyze-per-video = 25 (teen sees more discussion)', () => {
      expect(t['comments-to-analyze-per-video'].value).toBe(25);
    });
  });

  describe('block-ads — ads hidden on the live page by default in EVERY mode', () => {
    it('child / teen / adult all default block-ads ON', () => {
      expect(childPreset()['block-ads'].enabled).toBe(true);
      expect(teenPreset()['block-ads'].enabled).toBe(true);
      expect(adultPreset()['block-ads'].enabled).toBe(true);
    });
  });

  describe('DESIGN §10.2 — no perPlatform overrides in fresh presets', () => {
    const all = [childPreset(), teenPreset()];
    it('presets start with no perPlatform carve-outs', () => {
      for (const preset of all) {
        for (const id of ALL_FEATURE_IDS) {
          expect(preset[id].perPlatform).toBeUndefined();
        }
      }
    });
  });

  // CYCLE N+18 — mode-driven preset policy (2026-05-10 ALPHA pulse):
  // mode pick now seeds different defaults so Child = maximum protection
  // (every additional protection ON) and Teen = core + 3 selective
  // opt-ins (AI-content + metrics-hide + strip-emojis), leaving action
  // buttons + comment posting available for adolescent autonomy.
  describe('mode-driven preset policy (CYCLE N+18)', () => {
    it('Child preset enables every Additional-protection feature', () => {
      const c = childPreset();
      const ADDITIONAL: FeatureId[] = [
        'hide-engagement-metrics',
        'hide-action-buttons',
        'block-comment-posting',
        'strip-emojis',
        'block-ai-content',
        'block-reels',
      ];
      for (const id of ADDITIONAL) {
        expect(c[id].enabled, `child/${id} should be ON in maximum-protection preset`).toBe(true);
      }
    });

    it('Teen preset enables exactly the 3 selected Additional protections', () => {
      const t = teenPreset();
      const TEEN_ON_ADDITIONAL: FeatureId[] = [
        'hide-engagement-metrics',
        'strip-emojis',
        'block-ai-content',
      ];
      const TEEN_OFF_ADDITIONAL: FeatureId[] = [
        'hide-action-buttons',
        'block-comment-posting',
        'block-reels',
      ];
      for (const id of TEEN_ON_ADDITIONAL) {
        expect(t[id].enabled, `teen/${id} should be ON`).toBe(true);
      }
      for (const id of TEEN_OFF_ADDITIONAL) {
        expect(t[id].enabled, `teen/${id} should be OFF (adolescent autonomy)`).toBe(false);
      }
    });

    it('Both presets keep core ON (rewrite + marker) and media-timeout OFF (parent trigger)', () => {
      for (const [label, preset] of [['child', childPreset()], ['teen', teenPreset()]] as const) {
        expect(preset['rewritten-comments-first'].enabled, `${label}/rewrite`).toBe(true);
        expect(preset['show-reframe-markers'].enabled, `${label}/marker`).toBe(true);
        expect(preset['media-timeout'].enabled, `${label}/media-timeout`).toBe(false);
      }
    });
  });
});
