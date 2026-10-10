import { describe, expect, it } from 'vitest';
import { canonicalizeTechniqueForStats } from '../../../src/forensics/store';

// Display-time technique canonicalization for stats aggregation.
// Legacy chain records can carry the canonical English enum, Romanian-
// localized display strings stamped before the EN-only purge, or LLM
// mid-translation drift forms. The canonicalizer collapses all known
// variants into the canonical English enum so the dashboard chart
// aggregates correctly.

describe('canonicalizeTechniqueForStats — collapses legacy + drift variants to canonical English', () => {
  describe('genuine-opinion family', () => {
    it.each([
      'genuine-opinion',
      'genuine opinion',
      'genuine-opinie',
      'genuine opinions',
      'opinie',
      'opinie sincera',
      'opinie sinceră',
      'GENUINE-OPINIE',  // case-insensitive
      'Opinie Sincera',
    ])('"%s" → "genuine-opinion"', (input) => {
      expect(canonicalizeTechniqueForStats(input)).toBe('genuine-opinion');
    });
  });

  describe('informative family', () => {
    it.each(['informative', 'informativ', 'INFORMATIVE'])(
      '"%s" → "informative"',
      (input) => {
        expect(canonicalizeTechniqueForStats(input)).toBe('informative');
      },
    );
  });

  describe('neutral family', () => {
    it.each(['neutral', 'neutru', 'Neutral'])(
      '"%s" → "neutral"',
      (input) => {
        expect(canonicalizeTechniqueForStats(input)).toBe('neutral');
      },
    );
  });

  describe('mockery family', () => {
    it.each(['mockery', 'batjocura', 'batjocură'])(
      '"%s" → "mockery"',
      (input) => {
        expect(canonicalizeTechniqueForStats(input)).toBe('mockery');
      },
    );
  });

  describe('shame-attack family', () => {
    it.each(['shame-attack', 'shame attack', 'atac la rusine', 'atac la ruşine'])(
      '"%s" → "shame-attack"',
      (input) => {
        expect(canonicalizeTechniqueForStats(input)).toBe('shame-attack');
      },
    );
  });

  describe('fear-appeal family', () => {
    it.each(['fear-appeal', 'fear appeal', 'apel la frica', 'apel la frică'])(
      '"%s" → "fear-appeal"',
      (input) => {
        expect(canonicalizeTechniqueForStats(input)).toBe('fear-appeal');
      },
    );
  });

  describe('toxic-positivity family', () => {
    it.each(['toxic-positivity', 'toxic positivity', 'pozitivism toxic'])(
      '"%s" → "toxic-positivity"',
      (input) => {
        expect(canonicalizeTechniqueForStats(input)).toBe('toxic-positivity');
      },
    );
  });

  describe('bandwagon family', () => {
    it.each(['bandwagon', 'efect de turma', 'efect de turmă'])(
      '"%s" → "bandwagon"',
      (input) => {
        expect(canonicalizeTechniqueForStats(input)).toBe('bandwagon');
      },
    );
  });

  describe('edge cases', () => {
    it('unknown technique passes through verbatim (no fabrication)', () => {
      expect(canonicalizeTechniqueForStats('totally-made-up-technique')).toBe('totally-made-up-technique');
    });

    it('legacy-only labels with no canonical equivalent pass through verbatim', () => {
      // Labels like `poezie` / `afirmare` / `invitație` were LLM-emitted on
      // Romanian content pre-Tier-9; they are not in the current
      // `BatchCommentVerdict.technique` union. New records cannot produce
      // them; legacy records render their raw form.
      expect(canonicalizeTechniqueForStats('poezie')).toBe('poezie');
      expect(canonicalizeTechniqueForStats('afirmare')).toBe('afirmare');
    });

    it('empty string returns "unknown"', () => {
      expect(canonicalizeTechniqueForStats('')).toBe('unknown');
    });

    it('whitespace is trimmed before lookup', () => {
      expect(canonicalizeTechniqueForStats('  genuine-opinie  ')).toBe('genuine-opinion');
    });
  });
});
