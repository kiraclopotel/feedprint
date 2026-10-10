// Wiring audit 13 Sep, D2-23 and D2-26 (source locks; the themes compute is
// async over IndexedDB and crypto, which a unit render cannot drive to the
// range-toggle race).

import { describe, expect, it } from 'vitest';
import { readSource } from '../../../../helpers/read-source';
import { readFileSync } from 'node:fs';

const src = readSource('src/ui/dashboard/components/PatternsTab.tsx');

describe('Patterns tab and its range', () => {
  it('shows themes only for the window they were computed over', () => {
    expect(src).toContain('const result = computed && computed.forWindow === windowed ? computed : null;');
    expect(src.match(/forWindow: windowed/g)?.length).toBe(3);
  });

  it('resolves every record id against the windowed records', () => {
    expect(src).toMatch(/for \(const r of windowed\) m\.set\(r\.id, r\);\s*return m;\s*\}, \[windowed\]\);/);
    expect(src).not.toMatch(/for \(const r of records\) m\.set\(r\.id, r\);/);
  });

  it('memoises the reserve patterns', () => {
    // The options object is not pinned here: it gained dayKeyOf on 2026-09-18
    // and will gain more. What must hold is that the compute is memoised over
    // the WINDOW and nothing else, which is the race D2-23 closed.
    expect(src).toMatch(/React\.useMemo\(\(\) => computeReservePatterns\(windowed,[^)]*\), \[windowed\]\)/);
    expect(src).toMatch(/React\.useMemo\(\(\) => computeTemplatePatterns\(windowed,[^)]*\), \[windowed\]\)/);
  });

  // Three forensics-layer computes bucket records by day. Each defaults to a
  // UTC cut, because that layer must answer the same on every machine; each is
  // called from here, where a day is the READER's day and has to match the
  // Overview's columns. A fourth call that forgets dayKeyOf puts two
  // definitions of a day back on one screen (2026-09-18).
  it('names the reader’s day at every forensics compute that buckets by day', () => {
    for (const fn of ['buildThemes', 'computeReservePatterns', 'computeTemplatePatterns']) {
      const calls = src.match(new RegExp(`${fn}\\(windowed[^)]*\\)`, 'g')) ?? [];
      expect(calls.length, `${fn} is called from the Patterns tab`).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call, `${fn} must say which clock its day keys are on`).toContain('dayKeyOf');
      }
    }
  });
});
