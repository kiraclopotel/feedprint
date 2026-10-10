// Drift guard for the post-path severity floor table restated in the export
// methodology block.
//
// Why this test exists: the methodology block used to advertise a single
// "flag gate: severity >= 6". That number is the COMMENT path
// (MANIPULATION_SEVERITY_THRESHOLD). The POST path gates on
// SEVERITY_FLOOR_BY_TECHNIQUE_AND_MODE, whose cells run 4 to 8. In a real
// 5,365-record export, 37 of the 206 explicitly flagged records sat at
// severity 4 or 5 — every one of them a post-path record whose technique's
// floor for the active mode was 4 or 5 (combined 4/5, body-comparison-priming
// 4, scapegoating 5). The gate was correct; the disclosure was not, and an
// outside auditor reading the export could only conclude the system
// contradicted its own contract.
//
// methodology.ts restates the table as data rather than importing it
// (bundle weight — see that file's provenance rules). This test is the thing
// that makes restating safe.

import { describe, it, expect } from 'vitest';
import { buildMethodologyBlock } from '../../../src/forensics/methodology';
import {
  SEVERITY_FLOOR,
  SEVERITY_FLOOR_BY_TECHNIQUE_AND_MODE,
} from '../../../src/core/neutralizer';

const block = buildMethodologyBlock('9.9.9');
const table = block.thresholds.postSeverityFloorByTechniqueAndMode;

describe('methodology — post-path severity floors cannot drift from the gate', () => {
  it('restates every technique in the shipping matrix, and no extras', () => {
    expect(Object.keys(table).sort()).toEqual(
      Object.keys(SEVERITY_FLOOR_BY_TECHNIQUE_AND_MODE).sort(),
    );
  });

  it('matches the shipping matrix cell for cell', () => {
    for (const [name, cell] of Object.entries(SEVERITY_FLOOR_BY_TECHNIQUE_AND_MODE)) {
      expect(table[name], `child floor for ${name}`).toEqual({
        child: cell.child,
        teen: cell.teen,
      });
    }
  });

  it('restates the fallback floor used for techniques absent from the matrix', () => {
    expect(block.thresholds.defaultPostSeverityFloor).toBe(SEVERITY_FLOOR);
  });

  it('does not claim a single severity gate covers the post path', () => {
    const cells = Object.values(table).flatMap(v => [v.child, v.teen]);
    // The whole point: floors below the comment gate exist, so the note must
    // not promise that everything flagged is at or above it.
    expect(Math.min(...cells)).toBeLessThan(block.thresholds.severityFlagGate);
    expect(block.thresholds.thresholdsNote).toMatch(/per-technique/i);
    expect(block.thresholds.thresholdsNote).toMatch(/severity 4 or 5/i);
  });

  it('states that rule-based blocks are excluded from flag counts', () => {
    expect(block.thresholds.flagAccountingNote).toMatch(/blocked/i);
    expect(block.thresholds.flagAccountingNote).toMatch(/ai-content-block/);
    expect(block.thresholds.flagAccountingNote).toMatch(/cancelled/i);
  });

  // gem 76: a rewrite the page could not apply keeps action "allow" and (since
  // the note code shipped, 06f6f2ac) a note explaining it; the miss is per
  // BUILD, not a date cutoff - a store install on an older build still lacks
  // it after 26 Sep, so the note must not name a date (cold read of 37b113f9).
  it('explains a record whose rewrite never reached the page', () => {
    expect(block.thresholds.flagAccountingNote).toMatch(/could not apply the action/i);
    expect(block.thresholds.flagAccountingNote).toMatch(/earlier build/i);
    expect(block.thresholds.flagAccountingNote).not.toContain('26 September 2026');
  });
});
