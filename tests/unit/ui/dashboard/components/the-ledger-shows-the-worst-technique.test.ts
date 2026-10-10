// The forensics ledger said "the record's own top technique" and showed the
// first one in an array nothing sorts.
//
// neutralizer.ts stores the judge's output in the order it arrived
// (`techniques: verified`) and computes overallScore from a sorted COPY.
// severity.ts sorts that copy with the comment "Sort by severity descending",
// which is the proof that the stored order cannot be assumed: if it were
// already sorted, that line would not exist.
//
// So on the one surface in this product a person would quote to somebody else,
// a record judged [{shame-attack, 3}, {self-harm, 9}] showed 3, sorted among
// the 3s, and named shame-attack beside it.
//
// Found 2026-09-19 alongside two other readings of the same field: the
// statistics bands read overallScore (the weighted aggregate, ~9.9 here) and
// group-behavior reads the true max (9). Three numbers for one record. This
// closes the one that was arbitrary rather than merely different: the other two
// answer different questions on purpose and say so, and this one answered no
// question at all, it just took element zero.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT as ROOT } from '../../../../helpers/repo-root';
import { aggregateSeverity } from '../../../../../src/core/severity';
import type { TechniqueResult } from '../../../../../src/types/analysis';

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const tech = (name: string, severity: number): TechniqueResult =>
  ({ name, severity, confidence: 1, present: true } as unknown as TechniqueResult);

describe('the ledger shows the worst technique, not the first one (2026-09-19)', () => {
  it('no longer reads element zero anywhere', () => {
    // The ledger moved to the Feed log on 10 Oct 2026: its rows are drawn in FeedLogTab.tsx from feed-log.ts.
    const src = read('src/ui/dashboard/components/feed-log.ts') + '\n' + read('src/ui/dashboard/components/FeedLogTab.tsx');
    // Comments stripped: the helper's own docblock quotes the line it replaced,
    // and a check that cannot tell code from the prose about it is not a check.
    const code = src
      .split(/\r?\n/)
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join(' ');
    expect(code, 'the Sev column, the sort and the detail line all go through one helper')
      .not.toContain('r.techniques[0]');
    expect(src).toContain('function worstTechnique(');
    expect((src.match(/worstTechnique\(/g) ?? []).length, 'declared once, used at least twice')
      .toBeGreaterThanOrEqual(3);
  });

  it('the stored order really is not sorted, which is why this mattered', () => {
    // The premise, asserted rather than assumed: severity.ts sorts a copy, so
    // its input is not sorted. If someone ever makes the stored array sorted,
    // this case is where they will find out this file exists.
    const severity = read('src/core/severity.ts');
    expect(severity).toContain('[...present].sort((a, b) => b.severity - a.severity)');
    const neutralizer = read('src/core/neutralizer.ts');
    expect(neutralizer, 'stored as the judge returned it').toContain('techniques: verified,');
  });

  it('a worse technique sitting second is the one that counts', () => {
    // Worked through the real aggregate so the three readings are visible
    // together rather than described.
    const techniques = [tech('shame-attack', 3), tech('self-harm', 9)];
    const first = techniques[0].severity;
    const worst = techniques.reduce((mx, t) => Math.max(mx, t.severity), 0);
    const aggregate = aggregateSeverity(techniques);

    expect(first, 'what the ledger used to show').toBe(3);
    expect(worst, 'what it shows now').toBe(9);
    expect(aggregate, 'what the statistics bands show, on purpose').toBeCloseTo(9.9, 5);

    // The band boundary is 8, so the old reading put this record in the lowest
    // band on one tab and the highest on another.
    expect(first < 5 && aggregate >= 8, 'two tabs, opposite ends').toBe(true);
  });

  it('is unchanged for the ordinary case of one technique', () => {
    const one = [tech('fear-appeal', 6)];
    expect(one[0].severity).toBe(6);
    expect(one.reduce((mx, t) => Math.max(mx, t.severity), 0)).toBe(6);
    expect(aggregateSeverity(one)).toBe(6);
  });
});
