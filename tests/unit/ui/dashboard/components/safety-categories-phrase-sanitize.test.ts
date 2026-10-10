// F3b (2026-08 dashboard honesty audit): SafetyCategoriesPanel's header
// promised "we surface the matched stem only, never full slur strings" while
// extractPhrase just truncated the raw evidence to 30 chars — so a short slur
// rendered verbatim in the always-visible parent-facing chips. The parent
// surface convention (FeedCard) is that verbatim slur text sits behind an
// explicit per-record reveal; an aggregate chip row has no such consent step.
//
// Contract pinned here:
//   • the matched stem is unwrapped from the harm-floor evidence wrapper
//     ("3 profanity tokens (fuck)" → "fuck", the header's own example);
//   • identity-slur tokens are asterisk-masked with the first letter kept
//     ("nigger" → "n*****") via the SAME shipped lexicon that produced the
//     match (filterProfanity, tier 'slurs') — display-only, detection is
//     untouched;
//   • masking happens BEFORE the 30-char clip, so a clipped tail can never
//     leave a recognizable slur fragment behind.

import { describe, it, expect } from 'vitest';
import type { ForensicRecord } from '../../../../../src/types/forensic';
import { extractPhrase, displayPhrase } from '../../../../../src/ui/dashboard/components/SafetyCategoriesPanel';

function rec(overrides: Partial<ForensicRecord>): ForensicRecord {
  return {
    id: 'fr-stub',
    timestamp: '2026-05-09T00:00:00.000Z',
    platform: 'twitter',
    originalText: 'stub',
    originalHash: 'stub-hash',
    originalLength: 4,
    neutralizedText: '',
    author: '@stub',
    postUrl: 'https://x.com/.../status/0',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'unknown',
    integrityHash: 'stub-integrity',
    ...overrides,
  } as ForensicRecord;
}

// techniques[] entries carry no `evidence` in the declared type; the panel
// reads it defensively via a cast, so the stub mirrors the runtime shape.
function techniqueWithEvidence(evidence: unknown): ForensicRecord['techniques'][number] {
  return { name: 'dehumanization', severity: 6, confidence: 0.9, evidence } as never;
}

describe('SafetyCategoriesPanel extractPhrase (F3b — slur sanitization)', () => {
  it('masks identity-slur stems from harmFloor.topEvidence (never verbatim)', () => {
    const r = rec({
      harmFloor: {
        score: 65,
        topCategory: 'identity-slur',
        topEvidence: 'identity-slur match (nigger, spic)',
        identitySlurMatch: true,
        language: 'en',
      },
    });
    const phrase = extractPhrase(r);
    expect(phrase).toBe('n*****');
    expect(phrase).not.toContain('nigger');
    expect(phrase).not.toContain('spic');
  });

  it('keeps non-slur profanity stems verbatim (the header\'s "fuck × 23" example)', () => {
    const r = rec({
      harmFloor: {
        score: 40,
        topCategory: 'profanity',
        topEvidence: '3 profanity tokens (fuck)',
        identitySlurMatch: false,
        language: 'en',
      },
    });
    expect(extractPhrase(r)).toBe('fuck');
  });

  it('passes structural evidence (no parenthesized stem) through whole', () => {
    const r = rec({
      harmFloor: {
        score: 15,
        topCategory: 'sustained-caps',
        topEvidence: '78% caps, 4 ALL-CAPS words',
        identitySlurMatch: false,
        language: 'en',
      },
    });
    expect(extractPhrase(r)).toBe('78% caps, 4 ALL-CAPS words');
  });

  it('unwraps the stem even when the forensic 60-char clip ate the close paren', () => {
    const r = rec({
      harmFloor: {
        score: 65,
        topCategory: 'identity-slur',
        // top_evidence is slice(0, 60) of the full wrapper — close paren lost.
        topEvidence: 'identity-slur match (nigger, fa',
        identitySlurMatch: true,
        language: 'en',
      },
    });
    const phrase = extractPhrase(r);
    expect(phrase).toBe('n*****');
    expect(phrase).not.toContain('nigger');
  });

  it('masks slurs inside the raw-quote technique-evidence fallback', () => {
    const r = rec({
      techniques: [techniqueWithEvidence('this loser is a nigger and everyone knows it')],
    });
    const phrase = extractPhrase(r);
    expect(phrase).toContain('n*****');
    expect(phrase).not.toContain('nigger');
    // D2-39: the phrase is counted whole; the chip clips it for display, after masking.
    expect(displayPhrase(phrase!).length).toBeLessThanOrEqual(30);
    expect(displayPhrase(phrase!)).not.toMatch(/nig/);
  });

  it('masks BEFORE the 30-char clip: a slur straddling the boundary never leaks a fragment', () => {
    // Raw quote: 26 filler chars + " nigger" — clip-then-mask would render
    // "…a nig" (the fragment escapes the lexicon); mask-then-clip renders
    // "…a n**".
    const quote = 'a'.repeat(26) + ' nigger';
    const r = rec({ techniques: [techniqueWithEvidence(quote)] });
    const phrase = extractPhrase(r);
    expect(phrase).not.toMatch(/nig/);
    // D2-39: the phrase is counted whole; the chip clips it for display, after masking.
    expect(displayPhrase(phrase!).length).toBeLessThanOrEqual(30);
    expect(displayPhrase(phrase!)).not.toMatch(/nig/);
  });

  it('handles the array-shaped technique evidence fallback with the same masking', () => {
    const r = rec({
      techniques: [techniqueWithEvidence(['you are a spic', 'second entry ignored'])],
    });
    const phrase = extractPhrase(r);
    expect(phrase).toBe('you are a s***');
    expect(phrase).not.toContain('spic');
  });

  it('still returns null when no evidence exists anywhere', () => {
    expect(extractPhrase(rec({}))).toBeNull();
  });
});
