// UX-I18N-A11Y-2: WCAG 1.4.3 (AA text contrast, 4.5:1) computed from the live tokens.css color
// values, not from a snapshot of them. No test computed contrast before this file existed; the
// light-theme primary button, links, amber and a muted/surface pairing shipped under 4.5:1 with
// nothing to catch it. This reads the actual custom-property declarations out of tokens.css and
// runs the real WCAG relative-luminance formula, so a future edit to any of these hex values is
// what the test reacts to, not a copy of today's numbers.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readSource } from '../../../helpers/read-source';

import { repoPath } from '../../../helpers/repo-root';

const TOKENS_CSS_PATH = 'src/ui/shared/tokens.css';

// Through the repository-root helper, not a count of ../ from this file: the count was wrong the
// moment the test moved into a folder (PLAN-2026-09-16 item 11.2).
function readTokensCss(): string {
  return readSource(TOKENS_CSS_PATH);
}

// Pulls every `--fw-*: #rrggbb;` declaration out of one brace-delimited block. tokens.css never
// nests rules inside :root/[data-theme] blocks, so matching up to the first line that is just
// `}` is safe.
function extractBlock(css: string, blockStart: RegExp): Record<string, string> {
  const startMatch = blockStart.exec(css);
  if (!startMatch) {
    throw new Error(`tokens-contrast test: block not found in ${TOKENS_CSS_PATH}: ${blockStart}`);
  }
  const bodyStart = startMatch.index + startMatch[0].length;
  const bodyEnd = css.indexOf('\n}', bodyStart);
  if (bodyEnd === -1) {
    throw new Error(`tokens-contrast test: unterminated block in ${TOKENS_CSS_PATH}: ${blockStart}`);
  }
  const body = css.slice(bodyStart, bodyEnd);
  const tokens: Record<string, string> = {};
  for (const m of body.matchAll(/(--fw-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens[m[1]] = m[2].toLowerCase();
  }
  return tokens;
}

// WCAG 2.x relative luminance and contrast ratio (the same formula the audit used by hand).
function channelToLinear(c8bit: number): number {
  const c = c8bit / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
}

function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

const AA_TEXT_MIN = 4.5;

const css = readTokensCss();

// The base :root block also carries the dark colors (the file's own default theme); the
// `[data-theme="light"]` and `[data-theme="dark"]` blocks only redeclare what each theme
// overrides, so each theme's live values are the base block merged with its override block,
// exactly as the cascade resolves them in a browser.
const base = extractBlock(css, /^:root \{/m);
const lightOverrides = extractBlock(css, /:root\[data-theme="light"\] \{/);
const darkOverrides = extractBlock(css, /:root\[data-theme="dark"\] \{/);
const light = { ...base, ...lightOverrides };
const dark = { ...base, ...darkOverrides };

describe('tokens.css contrast (UX-I18N-A11Y-2)', () => {
  it('dark theme text pairs clear 4.5:1, including the lowest one measured', () => {
    // The audit measured every dark-theme text pair passing, muted-on-card the worst of them
    // (4.96:1). These three are the token pairs actually named in the finding.
    const pairs: Array<[string, string, string]> = [
      ['--fw-text on --fw-card', dark['--fw-text'], dark['--fw-card']],
      ['--fw-text-secondary on --fw-card', dark['--fw-text-secondary'], dark['--fw-card']],
      ['--fw-muted on --fw-card (lowest measured)', dark['--fw-muted'], dark['--fw-card']],
    ];

    for (const [name, fg, bg] of pairs) {
      expect(fg, `${name}: token missing from dark theme`).toBeTruthy();
      expect(bg, `${name}: token missing from dark theme`).toBeTruthy();
      const ratio = contrastRatio(fg, bg);
      expect(ratio, `${name} = ${ratio.toFixed(2)}:1, need >= ${AA_TEXT_MIN}:1`).toBeGreaterThanOrEqual(
        AA_TEXT_MIN,
      );
    }
  });

  // Light theme fails AA on four token pairs plus one pairing that fails in BOTH themes; none of
  // these are fixed yet (owner confirmed light-theme contrast work is phase 4, not this pass).
  // Turning any one of these into a real assertion is the signal that its fix landed: replace the
  // .todo with the same pattern as the dark-theme block above, then delete it from this list.
  // Two more failing pairs from the same finding (#d98a00 on card = 2.56:1, #d98a00 on bg =
  // 2.47:1) are not here: that hex is a literal in Popup.tsx / Dashboard.tsx, not a tokens.css
  // custom property, so a tokens.css parser has nothing to read for it.
  it.todo(
    `.pop-cta text: --fw-bg on --fw-teal, light = ${contrastRatio(light['--fw-bg'], light['--fw-teal']).toFixed(2)}:1 (need ${AA_TEXT_MIN}:1) — phase 4`,
  );
  it.todo(
    `.lnk / .pop-tab.active: --fw-teal on --fw-bg, light = ${contrastRatio(light['--fw-teal'], light['--fw-bg']).toFixed(2)}:1 (need ${AA_TEXT_MIN}:1) — phase 4`,
  );
  it.todo(
    `--fw-amber on --fw-card, light = ${contrastRatio(light['--fw-amber'], light['--fw-card']).toFixed(2)}:1 (need ${AA_TEXT_MIN}:1) — phase 4`,
  );
  it.todo(
    `--fw-on-accent on --fw-teal, light = ${contrastRatio(light['--fw-on-accent'], light['--fw-teal']).toFixed(2)}:1 (need ${AA_TEXT_MIN}:1) — phase 4`,
  );
  it.todo(
    `--fw-muted on --fw-surface-2, light = ${contrastRatio(light['--fw-muted'], light['--fw-surface-2']).toFixed(2)}:1 (need ${AA_TEXT_MIN}:1) — phase 4`,
  );
  it.todo(
    `--fw-muted on --fw-surface-2, dark = ${contrastRatio(dark['--fw-muted'], dark['--fw-surface-2']).toFixed(2)}:1 (need ${AA_TEXT_MIN}:1) — fails in BOTH themes, phase 4`,
  );
});
