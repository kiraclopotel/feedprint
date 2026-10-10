// A late verdict is applied when its item comes back. If the page change did not land, the record
// says the page could not apply it: the sentence "it was applied when the item came back" would be
// false there. The late sentence is for a change that landed.

import { describe, it, expect } from 'vitest';
import {
  decisionForBlock,
  decisionForJudge,
  decisionForLegacy,
  decisionForMask,
  NOTE_LATE_VERDICT,
  NOTE_NOT_APPLIED,
  NOTE_SETTING_OFF,
} from '../../../../src/content/record/decision';

const judge = { id: 'judge-v1' as const, hash: '4f32b70b07b7', model: 'openai/gpt-oss-120b', charged: true, family: 'hostile', severity: 9, effect: 'recruit', intent: 'react' };

describe('a late verdict whose page change did not land', () => {
  it('judge path: a hide that did not land says could not apply', () => {
    const d = decisionForJudge({ mode: 'adult', judge, provider: 'groq', applied: 'mark', landed: false, mask: false, rewrite: { attempted: false, outcome: 'off' }, late: true });
    expect(d.note).toBe(NOTE_NOT_APPLIED);
  });

  it('judge path: a rewrite that failed says could not apply', () => {
    const d = decisionForJudge({ mode: 'adult', judge: { ...judge, severity: 5 }, provider: 'groq', applied: 'allow', mask: false, rewrite: { attempted: true, outcome: 'failed' }, late: true });
    expect(d.note).toBe(NOTE_NOT_APPLIED);
  });

  it('legacy path with a rail row: a collapse that did not land says could not apply', () => {
    const d = decisionForLegacy({ mode: 'teen', detectionMode: 'blocklist:word:elon', techniques: [], severity: 9, applied: 'mark', landed: false, mask: false, late: true });
    expect(d!.note).toBe(NOTE_NOT_APPLIED);
  });

  it('legacy path without a rail row: landed false says could not apply', () => {
    const d = decisionForLegacy({ mode: 'teen', detectionMode: 'combined-detect-neutralize', techniques: ['consumer-rapid-frame'], severity: 6, applied: 'mark', landed: false, mask: false, late: true });
    expect(d!.note).toBe(NOTE_NOT_APPLIED);
  });

  it('rule block: an ad hide that did not land says could not apply', () => {
    const d = decisionForBlock({ mode: 'teen', blockReason: 'ads', matchedToken: 'platform-ad-marker', applied: 'mark', landed: false, mask: false, late: true });
    expect(d!.note).toBe(NOTE_NOT_APPLIED);
  });

  it('mask: stars that did not land say could not apply', () => {
    const d = decisionForMask('teen', undefined, { applied: 'allow', rewrite: { attempted: true, outcome: 'failed' } }, true);
    expect(d.note).toBe(NOTE_NOT_APPLIED);
  });
});

describe('a late verdict whose page change landed', () => {
  it('still carries the late sentence', () => {
    const j = decisionForJudge({ mode: 'adult', judge, provider: 'groq', applied: 'hide', landed: true, mask: false, rewrite: { attempted: false, outcome: 'off' }, late: true });
    expect(j.note).toBe(NOTE_LATE_VERDICT);
    const l = decisionForLegacy({ mode: 'teen', detectionMode: 'combined-detect-neutralize', techniques: ['consumer-rapid-frame'], severity: 6, applied: 'hide', landed: true, mask: false, late: true });
    expect(l!.note).toBe(NOTE_LATE_VERDICT);
    expect(decisionForMask('teen', undefined, undefined, true).note).toBe(NOTE_LATE_VERDICT);
    expect(decisionForBlock({ mode: 'teen', blockReason: 'ads', matchedToken: 'platform-ad-marker', applied: 'collapse', mask: false, late: true })!.note).toBe(NOTE_LATE_VERDICT);
  });
});

describe('a late verdict where nothing was applied on purpose, or the page did less than the row asks and it landed', () => {
  it('a switched-off ad keeps the setting-off sentence, on both legacy call shapes', () => {
    const a = decisionForLegacy({ mode: 'teen', detectionMode: 'sponsored-ad', techniques: [], applied: 'allow', settingOff: true, mask: false, late: true });
    expect(a!.note).toBe(NOTE_SETTING_OFF);
    const b = decisionForLegacy({ mode: 'teen', detectionMode: 'sponsored-ad', techniques: [], applied: 'allow', settingOff: true, landed: false, mask: false, late: true });
    expect(b!.note).toBe(NOTE_SETTING_OFF);
  });

  it('a collapse where the row says hide did land, so it keeps the late sentence', () => {
    const d = decisionForLegacy({ mode: 'teen', detectionMode: 'blocklist:word:elon', techniques: [], severity: 9, applied: 'collapse', mask: false, late: true });
    expect(d!.action).toBe('hide');
    expect(d!.note).toBe(NOTE_LATE_VERDICT);
  });

  it('a Child hide that stood in for stars did land, so it keeps the late sentence', () => {
    const d = decisionForMask('child', undefined, { applied: 'hide', rewrite: { attempted: true, outcome: 'failed' } }, true);
    expect(d.note).toBe(NOTE_LATE_VERDICT);
  });
});

// The critic's two findings on the first version (gem 56, 29 Sep 2026).
describe('the late sentence keys on whether the page change landed', () => {
  it('finding 1: a switched-off sponsored ad, late, keeps the setting-off sentence', () => {
    const d = decisionForLegacy({ mode: 'teen', detectionMode: 'sponsored-ad', techniques: [], applied: 'allow', settingOff: true, mask: false, late: true });
    expect(d!.note).toBe(NOTE_SETTING_OFF);
  });

  it('finding 2: a sponsored ad whose collapse did not land, Block Ads on, says could not apply', () => {
    // The post path's own shape for an ad the page failed to fold (result-apply, the !visualApplied branch).
    const d = decisionForLegacy({ mode: 'teen', detectionMode: 'sponsored-ad', techniques: [], applied: 'allow', settingOff: false, landed: false, mask: false, late: true });
    expect(d!.note).toBe(NOTE_NOT_APPLIED);
  });

  it('finding 2: a page change that landed is never "could not apply", whatever the row asked', () => {
    const d = decisionForLegacy({ mode: 'teen', detectionMode: 'blocklist:word:elon', techniques: [], severity: 9, applied: 'mark', landed: true, mask: false, late: true });
    expect(d!.action).toBe('hide');
    expect(d!.note).toBe(NOTE_LATE_VERDICT);
  });

  it('finding 2: the rule block says could not apply when told the change did not land', () => {
    const d = decisionForBlock({ mode: 'teen', blockReason: 'ads', matchedToken: 'platform-ad-marker', applied: 'mark', landed: false, mask: false, late: true });
    expect(d!.note).toBe(NOTE_NOT_APPLIED);
  });
});
