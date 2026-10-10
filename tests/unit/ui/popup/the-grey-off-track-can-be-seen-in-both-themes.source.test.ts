// B3F (PAINT-4 P4-1, P4-2). The grey off track was 1.87:1 (dark) and 1.72:1 (light) against its card, under the 3:1 a
// control's outline needs, so a switch that is off read only by its knob. This reads the stylesheet and the colour
// tokens and computes the contrast, so a colour step that drifts back under 3:1 fails here, not on a person's screen.
// The base rule (Receipts) and Off's own rule stay the same colour (off-switch-track-is-not-error-red.source.test.ts).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { repoPath } from '../../../helpers/repo-root';

const css = readFileSync(repoPath('src', 'ui', 'popup', 'popup-design.css'), 'utf8');
const tokens = readFileSync(repoPath('src', 'ui', 'shared', 'tokens.css'), 'utf8');

type Rgb = [number, number, number];

/** The declaration block that follows the first occurrence of `opener` in `text`. */
function blockAfter(text: string, opener: string): string {
  const at = text.indexOf(opener);
  expect(at, `found ${opener}`).toBeGreaterThanOrEqual(0);
  const end = text.indexOf('\n}', at);
  return text.slice(at, end);
}

function token(block: string, name: string): Rgb {
  const m = block.match(new RegExp(`${name}:\\s*#([0-9a-fA-F]{6})`));
  expect(m, `${name} is a 6-digit hex in the block`).not.toBeNull();
  const h = (m as RegExpMatchArray)[1];
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

const lin = (c: number): number => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = (c: Rgb): number => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const contrast = (a: Rgb, b: Rgb): number => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/** color-mix(in srgb, a p%, b): p of a and the rest of b. */
const mix = (a: Rgb, b: Rgb, p: number): Rgb => a.map((v, i) => v * p + b[i] * (1 - p)) as Rgb;

function offTrackPercent(selector: string): number {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = css.match(new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  expect(rule, `the sheet has a rule for ${selector}`).not.toBeNull();
  const m = (rule as RegExpMatchArray)[1].match(/background\s*:\s*color-mix\(\s*in srgb\s*,\s*var\(--fw-muted\)\s+(\d+)%\s*,\s*var\(--fw-card\)\s*\)/);
  expect(m, `${selector} mixes --fw-muted into --fw-card`).not.toBeNull();
  return Number((m as RegExpMatchArray)[1]) / 100;
}

/** The colour of the knob a rule paints: --fw-text, or a mix of it into the card. */
function knobColour(selector: string, text: Rgb, card: Rgb): Rgb {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = css.match(new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  expect(rule, `the sheet has a rule for ${selector}`).not.toBeNull();
  const bg = (rule as RegExpMatchArray)[1].match(/background\s*:\s*([^;]+);/);
  expect(bg, `${selector} paints a background`).not.toBeNull();
  const value = (bg as RegExpMatchArray)[1].trim();
  if (value === 'var(--fw-text)') return text;
  const m = value.match(/^color-mix\(\s*in srgb\s*,\s*var\(--fw-text\)\s+(\d+)%\s*,\s*var\(--fw-card\)\s*\)$/);
  expect(m, `${selector} paints --fw-text or a mix of it into the card`).not.toBeNull();
  return mix(text, card, Number((m as RegExpMatchArray)[1]) / 100);
}

const THEMES = [
  ['dark', blockAfter(tokens, ':root {')],
  ['light', blockAfter(tokens, ':root[data-theme="light"] {')],
] as const;

describe.each([
  ['.toggle.off', '.toggle::after'],
  ['.fw-off .toggle.off', '.fw-off .toggle.off::after'],
])('the off track %s can be seen', (selector, knobRule) => {
  it.each(THEMES)('%s: the track is at least 3:1 against its card, and the knob is at least 3:1 against the track', (_name, block) => {
    const muted = token(block, '--fw-muted');
    const card = token(block, '--fw-card');
    const text = token(block, '--fw-text');
    const track = mix(muted, card, offTrackPercent(selector));
    expect(contrast(track, card), 'track against card').toBeGreaterThanOrEqual(3);
    expect(contrast(knobColour(knobRule, text, card), track), 'knob against track').toBeGreaterThanOrEqual(3);
  });
});
