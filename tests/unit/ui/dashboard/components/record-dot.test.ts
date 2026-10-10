// Activity record dot color contract (record-dot.ts) + the token-mirror drift
// guard: TECHNIQUE_COLORS (JS, read by the chart + dot) and the --fw-tech-*
// custom properties (tokens.css) must agree — the known drift trap.

import { describe, it, expect } from 'vitest';
import { repoPath } from '../../../../helpers/repo-root';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { recordDotColor, TECHNIQUE_MIX_COLOR } from '../../../../../src/ui/dashboard/components/record-dot';
import { TECHNIQUE_COLORS } from '../../../../../src/ui/dashboard/components/color-maps';
import type { ForensicRecord } from '../../../../../src/types/forensic';

const TOKENS_CSS_PATH = 'src/ui/shared/tokens.css';

function rec(over: Partial<ForensicRecord>): ForensicRecord {
  return {
    id: 'r', timestamp: '2026-08-01T00:00:00.000Z', platform: 'tiktok',
    originalText: '', originalHash: 'h', originalLength: 0, neutralizedText: '',
    author: 'a', postUrl: '', techniques: [], overallScore: 0,
    userAgeCategory: 'teen', aiSource: 'cloud', feedSource: 'foryou', integrityHash: 'ih',
    ...over,
  } as ForensicRecord;
}

const tq = (name: string, severity = 5) => ({ name, severity, confidence: 1 });

describe('recordDotColor', () => {
  it('single technique → that technique color (matches the frequency chart palette)', () => {
    expect(recordDotColor(rec({ verdict: 'flagged', techniques: [tq('fear-appeal')] })))
      .toBe(TECHNIQUE_COLORS['fear-appeal']);
    expect(recordDotColor(rec({ verdict: 'flagged-hidden', techniques: [tq('bandwagon', 8)] })))
      .toBe(TECHNIQUE_COLORS['bandwagon']);
  });

  it('never red-by-default: a flagged non-red technique does not get the alarm red', () => {
    const c = recordDotColor(rec({ verdict: 'flagged', techniques: [tq('toxic-positivity', 9)] }));
    expect(c).toBe(TECHNIQUE_COLORS['toxic-positivity']);
    expect(c).not.toBe('#e53935'); // --fw-marker-high
    expect(c).not.toBe('#ef5350'); // --fw-red
  });

  it('multiple distinct techniques → the dedicated mix color (--fw-tech-combined)', () => {
    const c = recordDotColor(rec({
      verdict: 'flagged',
      techniques: [tq('fear-appeal'), tq('bandwagon')],
    }));
    expect(c).toBe(TECHNIQUE_MIX_COLOR);
    expect(TECHNIQUE_MIX_COLOR).toBe('#5c6bc0');
  });

  it('duplicate entries of ONE technique are not a mix', () => {
    expect(recordDotColor(rec({ techniques: [tq('fomo'), tq('fomo', 8)] })))
      .toBe(TECHNIQUE_COLORS['fomo']);
  });

  it('the "combined" technique record matches the chart bar for "multiple techniques"', () => {
    expect(recordDotColor(rec({ verdict: 'flagged', techniques: [tq('combined')] })))
      .toBe(TECHNIQUE_COLORS['combined']);
    expect(TECHNIQUE_COLORS['combined']).toBe('#5c6bc0');
  });

  it('pass record with no techniques → green (verdict semantic, not red)', () => {
    expect(recordDotColor(rec({ verdict: 'pass' }))).toBe('var(--fw-green)');
  });

  it('pure profanity-floor record (no techniques) → the profanity chip grey', () => {
    expect(recordDotColor(rec({
      verdict: 'flagged-hidden',
      harmFloor: { score: 80, language: 'en' } as ForensicRecord['harmFloor'],
    }))).toBe(TECHNIQUE_COLORS['profanity']);
  });

  it('safety-category-only floor → that safety category color', () => {
    expect(recordDotColor(rec({
      verdict: 'flagged-hidden',
      harmFloor: { score: 92, language: 'en', topCategory: 'sexual' } as unknown as ForensicRecord['harmFloor'],
    }))).toBe(TECHNIQUE_COLORS['sexual']);
  });

  it('blocked record with no techniques → the blocked-category chip purple', () => {
    expect(recordDotColor(rec({ verdict: 'blocked', detectionMode: 'block:reel-surface:x' })))
      .toBe('#ab47bc');
  });

  it('nothing to claim → muted, never red', () => {
    expect(recordDotColor(rec({}))).toBe('var(--fw-muted)');
  });
});

describe('token mirror sync (tokens.css --fw-tech-* vs TECHNIQUE_COLORS)', () => {
  // Token suffix → technique id (some token names are shortened).
  const TOKEN_TO_TECHNIQUE: Record<string, string> = {
    'fear-appeal': 'fear-appeal',
    'repeat-exposure': 'repeat-exposure',
    'anger-trigger': 'anger-trigger',
    'shame-attack': 'shame-attack',
    'false-urgency': 'false-urgency',
    'bandwagon': 'bandwagon',
    'scapegoating': 'scapegoating',
    'fomo': 'fomo',
    'toxic-positivity': 'toxic-positivity',
    'misleading-format': 'misleading-format',
    'combined': 'combined',
    'ai-content-block': 'ai-content-block',
    'profanity': 'profanity',
    'body-comparison': 'body-comparison-priming',
    'parasocial': 'parasocial-coercion',
    'consumer-rapid': 'consumer-rapid-frame',
    'hyperreal-trauma': 'hyperreal-trauma-bait',
    'combined-stack': 'combined-stack',
    'sexual': 'sexual',
    'violence-graphic': 'violence-graphic',
    'self-harm': 'self-harm',
    'drug-promotion': 'drug-promotion',
    'unsafe-health-experiment': 'unsafe-health-experiment',
    'extreme-toxicity': 'extreme-toxicity',
  };

  it('every --fw-tech-* token equals its TECHNIQUE_COLORS entry', () => {
    const css = readFileSync(repoPath(...TOKENS_CSS_PATH.split(String.fromCharCode(47))), 'utf8');
    const tokens = [...css.matchAll(/--fw-tech-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)];
    expect(tokens.length).toBeGreaterThanOrEqual(23);
    for (const [, suffix, hex] of tokens) {
      const technique = TOKEN_TO_TECHNIQUE[suffix];
      expect(technique, `unmapped token --fw-tech-${suffix}`).toBeDefined();
      expect(TECHNIQUE_COLORS[technique], `--fw-tech-${suffix} vs TECHNIQUE_COLORS['${technique}']`)
        .toBe(hex.toLowerCase());
    }
  });

  it('every TECHNIQUE_COLORS entry has a token', () => {
    const mirrored = new Set(Object.values(TOKEN_TO_TECHNIQUE));
    for (const name of Object.keys(TECHNIQUE_COLORS)) {
      expect(mirrored.has(name), `TECHNIQUE_COLORS['${name}'] missing a --fw-tech-* token`).toBe(true);
    }
  });
});
