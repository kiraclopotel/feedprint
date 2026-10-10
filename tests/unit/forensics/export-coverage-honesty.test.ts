// An export may not claim more than it can show.
//
// The complete-chain and everything exports pass no `selection`, and the
// no-selection branch of the page-one summary printed a constant:
// "Nothing. This is the complete retained chain." A 2026-09-01 export
// carried that sentence while holding 11816 of 38834 chain positions, with
// four of its own prune markers on the same page recording the deletions.
// The file was built to be handed to a school or a court, so the sentence is
// the most serious defect in this subsystem, worse than the data loss that
// produced it.
//
// These tests are written against the three shapes that actually occur on a
// real install, with the numbers taken from that same chain.

import { describe, expect, it } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';
import { buildForensicHtmlExport, computeChainCoverage, extractProvenanceRows } from '../../../src/forensics/html-export';

function record(position: number, over: Partial<ForensicRecord> = {}): ForensicRecord {
  return {
    id: `fr-${position}`,
    timestamp: new Date(Date.UTC(2026, 7, 28, 0, 0, position % 60)).toISOString(),
    platform: 'twitter',
    originalText: `t${position}`,
    originalHash: `oh${position}`,
    originalLength: 2,
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'adult',
    chainPosition: position,
    integrityHash: `h${position}`,
    ...over,
  } as ForensicRecord;
}

function buildHtml(records: ForensicRecord[]): string {
  return buildForensicHtmlExport(records, {
    fwVersion: 'FeelingWise V2.3.0',
    publicKeyJwk: {},
    publicKeyFingerprint: 'fd3577e462c42ebc',
    locale: 'en',
  });
}

describe('chain coverage', () => {
  it('counts the records missing before a chain that does not start at zero', () => {
    // The real shape: positions 27018..38833, contiguous, nothing before.
    const records = [record(27018), record(27019), record(38833)];

    const coverage = computeChainCoverage(records);

    expect(coverage.firstPosition).toBe(27018);
    expect(coverage.lastPosition).toBe(38833);
    expect(coverage.missingBefore).toBe(27018);
  });

  it('does not count a month rotation restarting at zero as missing records', () => {
    // Archived month 0..2 followed by the active chain restarting at 0.
    const records = [record(0), record(1), record(2), record(0), record(1)];

    const coverage = computeChainCoverage(records);

    expect(coverage.missingBefore).toBe(0);
    expect(coverage.gapsInside).toBe(0);
  });

  it('counts holes inside a run', () => {
    const records = [record(0), record(1), record(5)];

    expect(computeChainCoverage(records).gapsInside).toBe(3); // 2, 3, 4
  });

  it('flags a chain that begins at a reset marker, where count and range look clean', () => {
    const reset = record(0, { kind: 'reset-marker', chainAnchor: 'genesis-v1' });
    const records = [reset, record(1), record(2)];

    const coverage = computeChainCoverage(records);

    expect(coverage.missingBefore).toBe(0);
    expect(coverage.resetAt).toBe(reset.timestamp);
  });
});

describe('the page-one summary', () => {
  // Assertions run against the rendered summary block only. The whole page is
  // the wrong target: it embeds every i18n string in a JSON payload and every
  // CSS class in the stylesheet, so `toContain` on the full HTML passes for
  // strings that were never rendered to the reader.
  function summaryOf(records: ForensicRecord[]): string {
    const html = buildHtml(records);
    const start = html.indexOf('<div class="fw-summary">');
    expect(start).toBeGreaterThan(-1);
    const end = html.indexOf('</dl>', start);
    return html.slice(start, end);
  }

  it('never claims a truncated chain is complete', () => {
    const summary = summaryOf([record(27018), record(38833)]);

    expect(summary).not.toContain('complete retained chain');
    expect(summary).toContain('Earlier records NOT in this file');
    expect(summary).toContain('>27018<');
    expect(summary).toContain('class="fw-coverage-note"');
  });

  it('says so plainly when an earlier record was cleared by a reset', () => {
    const summary = summaryOf([
      record(0, { kind: 'reset-marker', chainAnchor: 'genesis-v1' }),
      record(1),
    ]);

    expect(summary).toContain('Earlier record cleared');
    expect(summary).not.toContain('complete retained chain');
  });

  it('still affirms completeness when the file genuinely is complete', () => {
    const summary = summaryOf([record(0), record(1), record(2)]);

    expect(summary).toContain('begins at the start of the chain');
    // The label is printed either way, deliberately, so a reader never has to
    // infer completeness from a line that is simply absent. What must not
    // appear is the shortfall note.
    expect(summary).not.toContain('class="fw-coverage-note"');
  });

  it('prints the missingBefore row at most once, whichever branch prints it', () => {
    // The count and the all-clear share one row name, and the signed rows are sorted by name alone,
    // so two of them in one file would leave the builder and the checker free to disagree on order.
    const shapes: Record<string, ForensicRecord[]> = {
      complete: [record(0), record(1), record(2)],
      'records missing before': [record(5), record(6), record(7)],
      'missing before and a hole': [record(27018), record(38833)],
      'a hole and nothing before': [record(0), record(1), record(5)],
      'begins at a reset': [record(0, { kind: 'reset-marker', chainAnchor: 'genesis-v1' }), record(1)],
    };
    const printed: Record<string, string[]> = {};
    for (const [shape, records] of Object.entries(shapes)) {
      const rows = extractProvenanceRows(buildHtml(records));
      const names = rows.map(([name]) => name);
      expect(new Set(names).size, `${shape}: every row name is used once`).toBe(names.length);
      printed[shape] = rows.filter(([name]) => name === 'missingBefore').map(([, text]) => text);
    }
    // Each branch was reached, so the check above covered both of them.
    expect(printed.complete).toEqual([expect.stringContaining('begins at the start of the chain')]);
    expect(printed['records missing before']).toEqual([expect.stringMatching(/^5/)]);
  });
});
