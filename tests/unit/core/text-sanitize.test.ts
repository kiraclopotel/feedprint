// core/text-sanitize.ts — first coverage (found-not-fixed item, session report
// 2026-07-02 §5). stripEmojis is the rewrite path's safety net: the prompt
// forbids emoji in rewrites, the model complies ~80% of the time, this is the
// 20% catch before text reaches a child's screen. Locks the documented
// codepoint ranges, including the Ship #34 additions (keycaps, geometric
// shapes, subdivision-flag TAG characters) and whitespace collapse.

import { describe, it, expect } from 'vitest';
import { stripEmojis } from '../../../src/core/text-sanitize';

describe('stripEmojis — child-visible rewrite safety net', () => {
  it('strips everyday emoji and collapses the gap they leave', () => {
    expect(stripEmojis('I disagree 😡 with this take 🔥🔥')).toBe('I disagree with this take');
    expect(stripEmojis('😂😂😂')).toBe('');
  });

  it('strips dingbats, misc symbols, and technical symbols (U+2600-27BF, U+2300-23FF)', () => {
    expect(stripEmojis('done ✅ soon ⏰ love ❤')).toBe('done soon love');
  });

  it('strips variation selectors and ZWJ compounds whole (family emoji)', () => {
    expect(stripEmojis('my family 👨‍👩‍👧 rocks')).toBe('my family rocks');
    expect(stripEmojis('heart ❤️ here')).toBe('heart here');
  });

  it('Ship #34: keycap digits lose the enclosing keycap, not the digit', () => {
    // 1️⃣ = DIGIT ONE + FE0F + 20E3 — the digit itself must survive.
    expect(stripEmojis('option 1️⃣ wins')).toBe('option 1 wins');
  });

  it('Ship #34: subdivision-flag TAG characters (England flag) strip fully', () => {
    const englandFlag = '🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}';
    expect(stripEmojis(`match day ${englandFlag} today`)).toBe('match day today');
  });

  it('preserves plain multilingual text, punctuation, and currency', () => {
    const text = 'Nu sunt de acord — costă 50€ și 100$, punct.';
    expect(stripEmojis(text)).toBe(text);
  });

  it('trims leading/trailing residue whitespace', () => {
    expect(stripEmojis('🔥 hot take')).toBe('hot take');
    expect(stripEmojis('hot take 🔥')).toBe('hot take');
  });
});
