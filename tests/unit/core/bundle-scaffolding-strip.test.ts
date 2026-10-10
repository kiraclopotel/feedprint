// LOOP-043: defensive strip of TikTok bundle scaffolding from LLM rewrite.
// The bundle formatter packs caption + comments; NEUTRALIZATION_SYSTEM §9
// instructs the LLM to rewrite only the caption. If it slips and includes
// the scaffolding, `stripBundleScaffolding` removes it.

import { describe, it, expect } from 'vitest';
import { stripBundleScaffolding } from '../../../src/core/neutralizer';

describe('stripBundleScaffolding — LOOP-043', () => {
  it('returns input unchanged when no bundle markers present', () => {
    const input = 'A neutral rewrite of the original post caption.';
    expect(stripBundleScaffolding(input)).toBe(input);
  });

  it('strips "— Top reactions" header + everything after', () => {
    const input = [
      'The cat video shows a kitten playing with yarn.',
      '',
      '— Top reactions (context only; judge the post above) —',
      '• @sam: so cute',
      '• @maria: i love this',
    ].join('\n');
    const out = stripBundleScaffolding(input);
    expect(out).toBe('The cat video shows a kitten playing with yarn.');
    expect(out).not.toContain('Top reactions');
    expect(out).not.toContain('@sam');
    expect(out).not.toContain('@maria');
  });

  it('strips Romanian localized marker "— Reacții"', () => {
    const input = [
      'Un videoclip despre pisici jucăușe.',
      '',
      '— Reacții (context doar; judecă postarea de mai sus) —',
      '• @ana: adorabil',
    ].join('\n');
    const out = stripBundleScaffolding(input);
    expect(out).toBe('Un videoclip despre pisici jucăușe.');
    expect(out).not.toContain('Reacții');
  });

  it('handles trailing whitespace after strip', () => {
    const input = 'Caption here.   \n\n— Top reactions —\n• @x: hi';
    expect(stripBundleScaffolding(input)).toBe('Caption here.');
  });

  it('handles the fallback dash-variant marker', () => {
    const input = 'Post text.\n\n---- Top reactions ----\n• @x: hi';
    const out = stripBundleScaffolding(input);
    expect(out).toBe('Post text.');
  });

  it('is case-insensitive on the marker word', () => {
    const input = 'Post text.\n\n— TOP REACTIONS —\n• @x: hi';
    const out = stripBundleScaffolding(input);
    expect(out).toBe('Post text.');
  });

  it('returns empty string when entire input is scaffolding (degenerate case)', () => {
    const input = '\n— Top reactions —\n• @x: hi';
    expect(stripBundleScaffolding(input)).toBe('');
  });
});
