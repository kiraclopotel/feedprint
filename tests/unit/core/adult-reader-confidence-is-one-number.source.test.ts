// The adult reader's confidence is written in three places and was, until 2026-09-20, only equal
// by coincidence. src/core/calibration.ts now names the value once, exported, with a docblock
// explaining what it is and is not. The export's methodology block and the manual read-this marker
// both import that export and print or write it. The automatic path lives in src/core/neutralizer.ts,
// which is frozen: nobody may edit it to import the constant, so the two literals there can only be
// held equal to the constant by a test that reads the frozen file as text. Before this file existed,
// the export read a private copy of the number while the writers typed it by hand in two more
// places, and a signed record could have gone on describing a confidence it no longer wrote with
// nothing anywhere to notice.
//
// This test never imports src/core/neutralizer.ts as code (importing it, or editing it, is exactly
// the thing that must not happen); it reads the file as text and locates the fired-verdict block by
// the comment that already sits beside the two literals it owns.

import { describe, expect, it } from 'vitest';
import { ADULT_READER_FIXED_CONFIDENCE } from '../../../src/core/calibration';
import { readSource } from '../../helpers/read-source';

describe('the adult reader confidence is one number, not three', () => {
  it('the constant sits above every mode threshold, not just the adult one', () => {
    const calibrationText = readSource('src/core/calibration.ts');
    const block = /DEFAULT_THRESHOLDS[^{]*\{([^}]*)\}/.exec(calibrationText);
    if (!block) {
      throw new Error(
        'the DEFAULT_THRESHOLDS declaration in src/core/calibration.ts no longer matches the shape '
        + 'this test parses; update the test, do not export the thresholds to work around it',
      );
    }
    const thresholds = [...block[1].matchAll(/:\s*([0-9.]+)/g)].map((m) => Number(m[1]));
    expect(thresholds.length, 'expected three mode thresholds').toBe(3);

    expect(ADULT_READER_FIXED_CONFIDENCE).toBeGreaterThan(0.60);
    expect(ADULT_READER_FIXED_CONFIDENCE).toBeLessThanOrEqual(1);
    for (const t of thresholds) {
      expect(ADULT_READER_FIXED_CONFIDENCE, `must clear mode threshold ${t}`).toBeGreaterThan(t);
    }
  });

  it('both literals in the frozen fired-verdict block still equal the constant', () => {
    const neutralizerText = readSource('src/core/neutralizer.ts');
    const anchorText = 'The measured rule has no confidence term';
    const anchorIndex = neutralizerText.indexOf(anchorText);
    if (anchorIndex === -1) {
      throw new Error(
        'the comment this test anchors on is gone from src/core/neutralizer.ts; the anchor moved, '
        + 'find where the JUDGE-V1 fired-verdict block now sits and update this test to match, '
        + 'without editing the frozen file',
      );
    }

    const before = neutralizerText.slice(0, anchorIndex);
    const after = neutralizerText.slice(anchorIndex);

    const techniquePattern = /techniques:\s*\[\{\s*technique,\s*present:\s*true,\s*confidence:\s*([0-9.]+)/g;
    const techniqueMatches = [...before.matchAll(techniquePattern)];
    if (techniqueMatches.length === 0) {
      throw new Error(
        'no "techniques: [{ technique, present: true, confidence: <n>" line precedes the '
        + 'no-confidence-term comment in src/core/neutralizer.ts; the anchor moved',
      );
    }
    const techniqueLiteral = Number(techniqueMatches[techniqueMatches.length - 1][1]);

    const overallMatch = /overallConfidence:\s*([0-9.]+)/.exec(after);
    if (!overallMatch) {
      throw new Error(
        'no "overallConfidence: <n>" line follows the no-confidence-term comment in '
        + 'src/core/neutralizer.ts; the anchor moved',
      );
    }
    const overallLiteral = Number(overallMatch[1]);

    expect(techniqueLiteral, 'the techniques[0].confidence literal').toBe(ADULT_READER_FIXED_CONFIDENCE);
    expect(overallLiteral, 'the overallConfidence literal').toBe(ADULT_READER_FIXED_CONFIDENCE);
  });

  it('the export methodology block reads the constant, not a private copy', () => {
    const methodologyText = readSource('src/forensics/methodology.ts');
    expect(methodologyText).toContain('ADULT_READER_FIXED_CONFIDENCE');
  });

  it('the manual read-this marker reads the constant, not a private copy', () => {
    const readThisText = readSource('src/content/markers/read-this.ts');
    expect(readThisText).toContain('ADULT_READER_FIXED_CONFIDENCE');
  });

  it('analysisFor in read-this.ts carries no hand-typed 0.9', () => {
    const readThisText = readSource('src/content/markers/read-this.ts');
    const startMatch = /function analysisFor\(/.exec(readThisText);
    if (!startMatch) {
      throw new Error('analysisFor no longer exists in src/content/markers/read-this.ts; the anchor moved');
    }
    const openBrace = readThisText.indexOf('{', startMatch.index);
    if (openBrace === -1) {
      throw new Error('analysisFor has no function body in src/content/markers/read-this.ts; the anchor moved');
    }
    let depth = 0;
    let end = -1;
    for (let i = openBrace; i < readThisText.length; i++) {
      if (readThisText[i] === '{') depth++;
      else if (readThisText[i] === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) {
      throw new Error('analysisFor never closes its opening brace in src/content/markers/read-this.ts; the anchor moved');
    }
    const body = readThisText.slice(startMatch.index, end + 1);
    const bareLiteral = /(?<![\w.])0\.9(?!\d)/.exec(body);
    expect(bareLiteral, 'a hand-typed confidence literal instead of the constant').toBeNull();
  });
});
