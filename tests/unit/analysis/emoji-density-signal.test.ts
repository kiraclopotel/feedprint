// FeelingWise — Emoji-pile density pre-LLM signal.
//
// Verifies the structural emoji-density extractor flags emoji-stacked
// manipulation ("🔪🔪🔪🔪🔪 die" / "❤️❤️❤️❤️❤️❤️❤️") without false-
// positiving on single-emoji or short balanced uses ("🎉🎉🎉 happy
// birthday 🎂", "ok 👍").
//
// Two-condition fire:
//   density = cluster_count × longest_cluster_length / text_length > 0.15
//   OR longest_cluster ≥ 5

import { describe, it, expect } from 'vitest';
import { detectEmojiPile } from '../../../src/analysis/pre-llm-signals';

describe('emoji-pile — positive cases', () => {
  it('5 knife emojis followed by "die" fires (long cluster + density)', () => {
    const r = detectEmojiPile('🔪🔪🔪🔪🔪 die');
    expect(r).not.toBeNull();
    expect(r!.weight).toBeGreaterThanOrEqual(10);
    expect(r!.evidence).toContain('longest=5');
  });

  it('7-heart emoji pile fires on long cluster', () => {
    const r = detectEmojiPile('❤️❤️❤️❤️❤️❤️❤️');
    expect(r).not.toBeNull();
    expect(r!.weight).toBeGreaterThanOrEqual(10);
  });

  it('a tight 3-cluster in a short comment fires on density', () => {
    // 3 clusters in "🚨🚨🚨 stop 🔪🔪🔪 now 😡😡😡": short text, dense.
    const r = detectEmojiPile('🚨🚨🚨 stop 🔪🔪🔪 now 😡😡😡');
    expect(r).not.toBeNull();
  });
});

describe('emoji-pile — negative cases (no false positive)', () => {
  it('balanced "🎉🎉🎉 happy birthday 🎂" does not fire (length=3, normal text)', () => {
    // cluster_count=1, longest=3, density=1*3/len. The text "🎉🎉🎉 happy
    // birthday 🎂" is ~22 chars; density ≈ 3/22 ≈ 0.14 — below 0.15 threshold.
    const r = detectEmojiPile('🎉🎉🎉 happy birthday 🎂');
    expect(r).toBeNull();
  });

  it('single emoji "ok 👍" does not fire', () => {
    const r = detectEmojiPile('ok 👍');
    expect(r).toBeNull();
  });

  it('two isolated emojis ("hi 😀 there 🙂") do not fire', () => {
    const r = detectEmojiPile('hi 😀 there 🙂 bye 👋');
    expect(r).toBeNull();
  });

  it('long benign text with one 3-emoji cluster does not fire (density low)', () => {
    const r = detectEmojiPile(
      'happy birthday my dear friend hope you have an amazing day 🎉🎉🎉',
    );
    expect(r).toBeNull();
  });

  it('text with no emojis at all returns null', () => {
    const r = detectEmojiPile('this is a normal comment with words only');
    expect(r).toBeNull();
  });
});

describe('emoji-pile — ZWJ + skin-tone modifiers', () => {
  it('ZWJ family sequence does not inflate the count', () => {
    // 👨‍👩‍👧‍👦 is one rendered emoji but contains 4 person codepoints joined
    // by ZWJ. The cluster algorithm must count this run by its rendered
    // emojis, not by raw codepoints — and a single family emoji is NOT a
    // cluster ≥ 3.
    const r = detectEmojiPile('our family 👨‍👩‍👧‍👦 is great');
    // We accept either null (correct: 1 rendered emoji, no cluster) OR a
    // very low weight — the assertion is: NOT a high-weight pile flag.
    if (r !== null) {
      expect(r.weight).toBeLessThan(15);
    }
  });

  it('skin-tone modifier on a single thumb does not fire', () => {
    const r = detectEmojiPile('thanks 👍🏽');
    expect(r).toBeNull();
  });
});

describe('emoji-pile — long cluster trigger', () => {
  it('a 10-emoji laugh cluster fires harder than a 5-emoji one', () => {
    const r5 = detectEmojiPile('lol 😂😂😂😂😂 nice');
    const r10 = detectEmojiPile('lol 😂😂😂😂😂😂😂😂😂😂 nice');
    expect(r5).not.toBeNull();
    expect(r10).not.toBeNull();
    expect(r10!.weight).toBeGreaterThan(r5!.weight);
  });
});
