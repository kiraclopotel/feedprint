// The Head, 10 Oct 2026: "seen a lot" had to be taken out of fifteen flag checks one by one, and two fresh reads each
// found more. The class is closed instead: one module (src/forensics/export-numbers.ts, re-exported as flag-verdict.ts) compares a verdict to the flag
// words, and a new direct comparison anywhere else under src/ fails the build here, unless it is on the list below
// with its reason. Readers go through carriesFlagVerdict, carriesHideVerdict or isCountedFlagVerdict (forensics), or
// isFlaggedVerdict and itemOutcomeOf (the dashboard), which are built on them.
//
// What this check sees: a comparison of `verdict` (or a local `v`) with 'flagged' or 'flagged-hidden' by === or !==,
// in code (comment lines are skipped). It does not see a verdict copied into a differently named variable, or a Set
// of verdict strings; the two such Sets today (record-sets.ts ACTED_VERDICTS, topics.ts ELIGIBLE_VERDICTS) do not
// count flags.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { REPO_ROOT as ROOT } from '../helpers/repo-root';

const EXEMPT: Record<string, string> = {
  'src/forensics/export-numbers.ts':
    'holds the one reader (flag-verdict.ts re-exports it to every other place); it has no runtime import, so the chain '
    + 'analyzer can load it with plain node',
  'src/forensics/export-numbers-inline.ts':
    'script that runs in the recipient\'s browser inside the export file, where no module can be imported; '
    + 'tests/unit/forensics/flag-provenance-in-step.test.ts runs it and flag-provenance.ts over the same records',
  'src/forensics/html-export-scripts.ts':
    'the export file\'s own viewer script, in the recipient\'s browser, no modules; it asks the inline numbers (FWN) '
    + 'first and restates the repeat rule where it reads a flag itself',
  'src/forensics/chain-debug-stats.ts':
    'the debug panel\'s tally of the verdict strings as stored, one counter per string, on purpose',
};

const DIRECT = /\b(?:verdict|v)\s*[!=]==\s*'flagged(?:-hidden)?'|'flagged(?:-hidden)?'\s*[!=]==\s*(?:\w+\.)?(?:verdict|v)\b/;

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

function directComparisons(file: string): string[] {
  const hits: string[] = [];
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    if (DIRECT.test(line)) hits.push(`:${i + 1} ${t.slice(0, 120)}`);
  });
  return hits;
}

const found = new Map<string, string[]>();
for (const f of filesUnder(join(ROOT, 'src'))) {
  const hits = directComparisons(f);
  if (hits.length > 0) found.set(relative(ROOT, f).split('\\').join('/'), hits);
}

describe('the flag verdict has one reader', () => {
  it('no file under src/ compares a verdict to the flag words, outside the named exemptions', () => {
    const outside = [...found.entries()].filter(([f]) => !(f in EXEMPT)).map(([f, h]) => `${f}${h.join(`\n${f}`)}`);
    expect(outside, 'read it through flag-verdict.ts (or isFlaggedVerdict / itemOutcomeOf on the dashboard)').toEqual([]);
  });

  it('every exemption still has a comparison and a reason (no stale entries)', () => {
    for (const [f, reason] of Object.entries(EXEMPT)) {
      expect(reason.length, f).toBeGreaterThan(20);
      expect(found.has(f), `${f} no longer compares; take it off the list`).toBe(true);
    }
  });

  it('the check sees a direct comparison when there is one', () => {
    expect(DIRECT.test(`if (r.verdict === 'flagged') n++;`)).toBe(true);
    expect(DIRECT.test(`return v==='flagged-hidden';`)).toBe(true);
    expect(DIRECT.test(`if ('flagged' === record.verdict) {}`)).toBe(true);
    expect(DIRECT.test(`if (key === 'flagged') {}`)).toBe(false);
  });
});
