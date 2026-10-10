// B3 unit 7 (P4, QUALITY.md V1): an off switch in Receipts' Settings is a resting grey, not the
// red of an error. Walked on 30 Sep (out/visual/FAULTS-1.md V1): every switch that is off had a
// filled red track, so a page of honest choices read as a page of faults. Off already draws them
// grey (`.fw-off .toggle.off`); the base rule, which Receipts uses, drew them red.
//
// The check reads the stylesheet: the base off track and Off's off track are the same colour, and
// neither is the error red. Red stays available for real errors elsewhere in the sheet.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { repoPath } from '../../../helpers/repo-root';

const css = readFileSync(repoPath('src', 'ui', 'popup', 'popup-design.css'), 'utf8');

/** The declaration block of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  expect(m, `the sheet has a rule for ${selector}`).not.toBeNull();
  return (m as RegExpMatchArray)[1];
}

function background(block: string): string {
  const m = block.match(/background\s*:\s*([^;]+);?/);
  expect(m, 'the rule sets a background').not.toBeNull();
  return (m as RegExpMatchArray)[1].trim();
}

describe('an off switch is a resting grey in both products', () => {
  it('the base off track is not the error red', () => {
    expect(background(rule('.toggle.off'))).not.toMatch(/--fw-red/);
  });

  it('Receipts draws the off track the way Off does', () => {
    expect(background(rule('.toggle.off'))).toBe(background(rule('.fw-off .toggle.off')));
  });
});
