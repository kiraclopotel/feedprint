import { describe, expect, it } from 'vitest';
import {
  PRETTY_TECHNIQUE,
  PRETTY_TECHNIQUE_RO,
  PRETTY_TECHNIQUE_ES,
  PRETTY_TECHNIQUE_PT_BR,
  TECHNIQUE_COLORS,
} from '../../../../../src/ui/dashboard/components/color-maps';
import type { TechniqueName } from '../../../../../src/types/analysis';

// The dashboard looks PRETTY_TECHNIQUE / PRETTY_TECHNIQUE_RO / TECHNIQUE_COLORS
// up by the raw persisted TechniqueName enum value. Before this guard the maps
// were keyed by short legacy ids ('parasocial', 'consumer-rapid',
// 'hyperreal-trauma') and were missing 8 techniques entirely, so 11 of 21
// values fell through to the raw kebab-case id (parent dashboard) and a grey
// dot. Every TechniqueName must resolve to a parent-readable label + a color.

// Listed explicitly (not derived) so adding a TechniqueName without covering
// it here is a compile error: the `satisfies` check fails if this drifts from
// the union, and an extra member would make the union assignment below fail.
const ALL_TECHNIQUES = [
  'fear-appeal', 'anger-trigger', 'shame-attack', 'false-urgency',
  'bandwagon', 'scapegoating', 'fomo', 'toxic-positivity',
  'misleading-format', 'combined', 'profanity',
  'body-comparison-priming', 'parasocial-coercion', 'consumer-rapid-frame',
  'hyperreal-trauma-bait', 'combined-stack', 'sexual', 'violence-graphic',
  'self-harm', 'drug-promotion', 'unsafe-health-experiment', 'extreme-toxicity',
  'repeat-exposure',
] as const satisfies readonly TechniqueName[];

// Bidirectional check: this is the full union (every TechniqueName is covered).
type _Exhaustive = Exclude<TechniqueName, (typeof ALL_TECHNIQUES)[number]> extends never
  ? true
  : ['MISSING TechniqueName in ALL_TECHNIQUES'];
const _exhaustive: _Exhaustive = true;
void _exhaustive;

const HEX = /^#[0-9a-f]{3,8}$/i;
// A label still keyed by a kebab-case id reads like a raw enum: a single
// lowercase token containing a hyphen and no space.
const LOOKS_LIKE_RAW_KEBAB = /^[a-z]+(-[a-z]+)+$/;

describe('technique color maps — every persisted TechniqueName resolves', () => {
  describe.each(ALL_TECHNIQUES)('%s', (name) => {
    it('has a parent-readable EN label (not the raw kebab-case id)', () => {
      const label = PRETTY_TECHNIQUE[name];
      expect(label, `PRETTY_TECHNIQUE missing "${name}"`).toBeTypeOf('string');
      // A single readable word (e.g. "profanity") may equal its key; only a
      // multi-token kebab id ("parasocial-coercion") is unreadable to a parent.
      expect(LOOKS_LIKE_RAW_KEBAB.test(label), `"${name}" still renders as raw kebab "${label}"`).toBe(false);
    });

    it.each([
      ['RO', PRETTY_TECHNIQUE_RO],
      ['ES', PRETTY_TECHNIQUE_ES],
      ['PT-BR', PRETTY_TECHNIQUE_PT_BR],
    ])('has a %s label', (tag, map) => {
      const label = map[name];
      expect(label, `PRETTY_TECHNIQUE_${tag} missing "${name}"`).toBeTypeOf('string');
      expect(LOOKS_LIKE_RAW_KEBAB.test(label), `"${name}" ${tag} still renders as raw kebab "${label}"`).toBe(false);
    });

    it('has a valid hex color (no grey fallback)', () => {
      const color = TECHNIQUE_COLORS[name];
      expect(color, `TECHNIQUE_COLORS missing "${name}"`).toBeTypeOf('string');
      expect(HEX.test(color)).toBe(true);
    });
  });

  it('the three youth techniques are keyed by the FULL enum name, not the short legacy id', () => {
    // Regression guard for the exact bug: the short keys must NOT be present,
    // and the full enum keys MUST be.
    for (const legacy of ['parasocial', 'consumer-rapid', 'hyperreal-trauma']) {
      expect(PRETTY_TECHNIQUE[legacy], `stale short key "${legacy}" still present`).toBeUndefined();
      expect(TECHNIQUE_COLORS[legacy], `stale short key "${legacy}" still present`).toBeUndefined();
    }
    expect(PRETTY_TECHNIQUE['parasocial-coercion']).toBeTypeOf('string');
    expect(PRETTY_TECHNIQUE['consumer-rapid-frame']).toBeTypeOf('string');
    expect(PRETTY_TECHNIQUE['hyperreal-trauma-bait']).toBeTypeOf('string');
  });

  it('a label outside the taxonomy is left for the caller to fall back (maps do not fabricate)', () => {
    // The maps must not invent entries for non-technique strings; the
    // consumers use `?? id` / `?? grey`, so absence is the correct behavior.
    expect(PRETTY_TECHNIQUE['totally-made-up']).toBeUndefined();
    expect(TECHNIQUE_COLORS['totally-made-up']).toBeUndefined();
  });
});
