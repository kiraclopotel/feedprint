// The whole-record export's "How items were identified" section names the levels Silent, Calm
// and Open (the names on the screens since 12 Oct 2026) in its labels and notes: no "Adult reader", no "child and teen mode", no floor table
// headed Child and Teen. The prompts are printed verbatim, as the model received them, and are left
// out of the name check.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildForensicHtmlExport, type ExportMetadata } from '../../../src/forensics/html-export';
import { buildMethodologyBlock } from '../../../src/forensics/methodology';
import type { ForensicRecord } from '../../../src/types/forensic';

const RECORD = {
  id: 'r-1', timestamp: '2026-09-29T07:00:00Z', platform: 'twitter', originalText: 'sample post', originalHash: 'abc',
  originalLength: 11, neutralizedText: '', author: '@example', postUrl: '', techniques: [], overallScore: 0,
  userAgeCategory: 'relaxed', aiSource: 'cloud', feedSource: 'for-you', integrityHash: 'ih', signature: 'sig',
  publicKeyFingerprint: 'fp', chainPosition: 0,
} as unknown as ForensicRecord;

const META: ExportMetadata = {
  fwVersion: 'V-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'A', y: 'B' }, publicKeyFingerprint: 'fp', locale: 'en',
  methodology: buildMethodologyBlock('2.5.16'),
};

/** The methodology section with the verbatim prompts cut out. */
function methodologyWords(): string {
  const html = buildForensicHtmlExport([RECORD], META);
  const rest = html.slice(html.indexOf('<details class="fw-methodology">'))
    .replace(/<details class="fw-mth-prompt"><summary>([\s\S]*?)<\/summary><pre>[\s\S]*?<\/pre><\/details>/g, '$1');
  return rest.slice(0, rest.indexOf('</details>'));
}

const OLD_NAMES = /\badult reader\b|\bchild and teen\b|\badult (?:mode|posts?|records?|note|path)\b|\bchild mode\b|\bteen mode\b|<th>Child<\/th>|<th>Teen<\/th>|\ban adult record\b/i;

describe('the methodology section of the export', () => {
  it('names the levels, not the old settings, outside the verbatim prompts', () => {
    const words = methodologyWords();
    expect(words.length).toBeGreaterThan(1000);
    const hit = words.match(OLD_NAMES);
    expect(hit?.[0] ?? null).toBeNull();
  });

  it('calls the reader of Open posts the Open reader, and heads the floor table Silent and Calm', () => {
    const words = methodologyWords();
    expect(words).toContain('Open reader');
    expect(words).toContain('<th>Silent</th><th>Calm</th>');
  });

  it('keeps no level of the old names in the section outside the verbatim prompts, so the file speaks in one set of names', () => {
    const words = methodologyWords();
    expect(words.match(/\bStrict\b|\bModerate\b|\bRelaxed\b/i)?.[0] ?? null).toBeNull();
  });

  it('the per-record note on a hide that did not land names Silent, in all four languages', () => {
    const src = readFileSync(join(process.cwd(), 'src/forensics/exporter.ts'), 'utf8');
    const notes = src.split('\n').filter((l) => l.trim().startsWith('visualNotAppliedNote:'));
    expect(notes).toHaveLength(4);
    for (const n of notes) {
      expect(n).not.toMatch(/Child|Copil|Niño|Criança/);
      expect(n).toMatch(/Silent|Silențios|Silencioso/);
    }
  });

  it('names the setting of the Relaxed-reader note by its earlier name, not as an age', () => {
    const words = methodologyWords();
    expect(words).toContain('(recorded under an earlier name before the levels were named)');
    expect(words).not.toContain('recorded as adult');
  });

  it('still prints the prompts verbatim', () => {
    const html = buildForensicHtmlExport([RECORD], META);
    expect(html).toContain('your reading is the measurement');
  });
});
