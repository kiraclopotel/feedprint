/** @vitest-environment jsdom */
//
// A parent's own rules showed no hit count in the recorder, however many posts
// they had hidden.
//
// The rules editor prints a `×N` pill per chip, read out of
// `settings.hiddenByFeature` under `ruleTallyKey`. The only writer of those
// keys was the free product's word filter, and the controller starts that
// filter only in the Off build. The editor renders in the recorder's settings
// panel too, where hides by the parent's rules happen in the analysis pipeline
// instead: it records `detectionMode: blocklist:<kind>:<rule>` and no tally.
//
// So a chip with no pill meant "this rule has never fired" to the parent, and
// meant nothing at all in fact. The pill only draws above zero, so the screen
// never printed a false number; it printed silence where a number belonged,
// which a reader has no way to tell from a true zero.
//
// The pipeline cannot reach the counter: `analysis/` does not import
// `content/`, deliberately. It carries the fact in `detectionMode`, in the
// documented prefix-matched form, and the apply path is where that fact meets
// the page. Counted there, and only when the hide really landed, which is the
// standing rule about recording the applied outcome rather than the intent.
//
// Found 2026-09-19 by a read-only scan of the child-safety promise, verified
// against the writer, the reader and the product gate before anything moved.

import { describe, expect, it } from 'vitest';
import { ruleTallyKey } from '../../../src/core/parent-blocklist';
import { readSource } from '../../helpers/read-source';

describe("the parent's own rules are counted (2026-09-19)", () => {
  it('the recorder counts a rule when its hide lands, not when it is decided', () => {
    const src = readSource('src/content/post-path/result-apply.ts');
    expect(src, 'the tally lives at the apply site').toContain('function noteBlocklistRuleFired');
    expect(src, 'and runs only on a hide that landed').toContain('if (applied) noteBlocklistRuleFired(detectionMode);');
  });

  it('it reads the same key the editor reads, built the same way', () => {
    // The two sides of this pill have to agree on one string or the pill stays
    // blank in a new way.
    expect(ruleTallyKey('word', 'gateword')).toBe('rule:word:gateword');
    const apply = readSource('src/content/post-path/result-apply.ts');
    const editor = readSource('src/ui/popup/BlocklistEditor.tsx');
    expect(apply).toContain('countHiddenFor(ruleTallyKey(kind, rule), 1, false)');
    expect(editor).toContain('ruleTallyKey(');
  });

  it('a phrase rule carrying a colon survives the round trip', () => {
    // detectionMode is `blocklist:<kind>:<rule>` and only the first two
    // segments are structure. A phrase is the parent's own text and can hold
    // anything, so the parser keeps the rest whole.
    const mode = `blocklist:phrase:${'see this: now'}`;
    const rest = mode.slice('blocklist:'.length);
    const sep = rest.indexOf(':');
    expect(rest.slice(0, sep)).toBe('phrase');
    expect(rest.slice(sep + 1), 'the colon in the phrase is kept').toBe('see this: now');
    expect(ruleTallyKey('phrase', rest.slice(sep + 1))).toBe('rule:phrase:see this: now');
  });

  it('nothing is counted for a detection that is not one of the rules', () => {
    const src = readSource('src/content/post-path/result-apply.ts');
    expect(src).toContain("if (!detectionMode || !detectionMode.startsWith('blocklist:')) return;");
  });

  describe('and two docblocks that described other code', () => {
    it('the break switch is documented as per-platform, because it is', () => {
      const src = readSource('src/content/engagement/media-timeout.ts');
      expect(src, 'every read passes the platform').toContain("isFeatureEnabled(settings, 'media-timeout', platform)");
      expect(src, 'and the header no longer calls the toggle global')
        .not.toContain('the V1 toggle is global across all');
    });

    it('the locked-switch note no longer names a row that was removed', () => {
      // "Hide when a rewrite is impossible" left the popup on 2026-09-07 and
      // this comment went on naming it as a locked child protection.
      const src = readSource('src/ui/popup/controls.tsx');
      expect(src).not.toContain('Hide when a rewrite is impossible');
    });
  });
});
