// Q38/Q39 (wiring W47): chain-housekeeping markers must never read as feed
// content in parent-facing aggregations.
//
// Q38: theme corpus — marker records write verdict 'pass' and housekeeping
// originalText, so three cap prunes could form a top "theme" on the
// Patterns tab out of FeelingWise's own bookkeeping.
// Q39: feed-composition / overview-data — local marker-kind copies missed
// prune-marker, inflating the documented "honest denominator".
//
// The fix centralizes the predicate in forensics/system-records.ts; the
// source-lock here fails on any future copy-pasted triple comparison.

import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ForensicRecord } from '../../../src/types/forensic';
import { isSystemMarkerRecord, SYSTEM_MARKER_KINDS } from '../../../src/forensics/system-records';
import { buildFeedComposition } from '../../../src/ui/dashboard/components/feed-composition';
import { isBalanceContent } from '../../../src/ui/dashboard/record-sets';
import { readSource } from '../../helpers/read-source';
import { TREE_READ_TIMEOUT_MS } from '../../helpers/spawn-timeout';

// Reads the whole tree or asks git, which outlasts the 5s default on a busy machine; see the helper.
vi.setConfig({ testTimeout: TREE_READ_TIMEOUT_MS });

/** The export builder is four files since 2026-09-16 (PLAN-2026-09-16 item 10.1): the builder, the
 *  scripts the page carries, the stylesheet, and the string table under i18n. A scan of "the
 *  export's source" reads all four through readSource, which refuses an emptied or re-export-only
 *  file, so a later split cannot turn this scan into an empty pass. */
const EXPORT_SOURCES = [
  'src/forensics/html-export.ts',
  'src/forensics/html-export-scripts.ts',
  'src/forensics/html-export-styles.ts',
  'src/i18n/export-strings.ts',
];
const exportSource = (): string => EXPORT_SOURCES.map((p) => readSource(p)).join(String.fromCharCode(10));


const TOPICS_PATH = 'src/forensics/topics.ts';
const HTML_EXPORT_PATH = 'src/forensics/html-export.ts';

function markerRecord(kind: string, i: number): ForensicRecord {
  return {
    id: `mk-${kind}-${i}`,
    timestamp: `2026-08-0${(i % 8) + 1}T10:00:00.000Z`,
    platform: 'twitter',
    originalText: `[${kind} @ 2026-08-0${(i % 8) + 1}T10:00:00.000Z] deleted=250 cap=10000 positions=0-249`,
    originalHash: `h-${kind}-${i}`,
    originalLength: 60,
    verdict: 'pass',
    kind: kind as ForensicRecord['kind'],
    integrityHash: `ih-${kind}-${i}`,
  } as unknown as ForensicRecord;
}

function contentRecord(i: number): ForensicRecord {
  return {
    id: `ct-${i}`,
    timestamp: `2026-08-05T1${i % 10}:00:00.000Z`,
    platform: 'twitter',
    originalText: `an ordinary feed post number ${i} about football practice`,
    originalHash: `h-ct-${i}`,
    originalLength: 50,
    verdict: 'pass',
    integrityHash: `ih-ct-${i}`,
  } as unknown as ForensicRecord;
}

describe('isSystemMarkerRecord', () => {
  it('covers all nine marker kinds and nothing else', () => {
    expect([...SYSTEM_MARKER_KINDS].sort()).toEqual(
      ['month-rotation-marker', 'prune-marker', 'reset-marker', 'gap-marker', 'heartbeat-marker', 'import-marker', 'repair-marker', 'redaction-marker', 'reconcile-marker'].sort(),
    );
    expect(isSystemMarkerRecord({ kind: 'prune-marker' })).toBe(true);
    expect(isSystemMarkerRecord({ kind: 'gap-marker' })).toBe(true);
    expect(isSystemMarkerRecord({ kind: 'reconcile-marker' })).toBe(true);
    expect(isSystemMarkerRecord({ kind: 'environment' })).toBe(false);
    expect(isSystemMarkerRecord({ kind: undefined })).toBe(false);
  });
});

describe('Q39 — the honest denominator excludes every marker kind', () => {
  it('feed-composition eligible count skips prune markers', () => {
    const records = [
      ...Array.from({ length: 5 }, (_, i) => contentRecord(i)),
      markerRecord('prune-marker', 1),
      markerRecord('month-rotation-marker', 2),
      markerRecord('reset-marker', 3),
    ];
    expect(buildFeedComposition(records).eligible).toBe(5);
  });

  it('overview isBalanceContent rejects all marker kinds and environment', () => {
    for (const kind of SYSTEM_MARKER_KINDS) {
      expect(isBalanceContent(markerRecord(kind, 0))).toBe(false);
    }
    expect(isBalanceContent(contentRecord(0))).toBe(true);
  });
});

describe('Q38 — theme corpus (source-lock)', () => {
  it('topics.ts eligibility filters system markers', () => {
    const topics = readFileSync(join(process.cwd(), TOPICS_PATH), 'utf8');
    expect(topics).toContain('if (isSystemMarkerRecord(r)) return false;');
  });
});

describe('no copy-pasted marker-kind EXCLUSION survives outside system-records.ts', () => {
  // Label-mapping ternaries (FeedCard, Dashboard ledger) legitimately name
  // individual kinds; the lock targets exclusion chains only ("!== 'reset-
  // marker' && ..." or "=== 'reset-marker' || ..."). html-export.ts is
  // exempt (embedded verifier JS inside template strings cannot import the
  // predicate) and gets its own coverage assertion below.
  const EXCLUSION = /kind\s*(?:!==\s*'reset-marker'|===\s*'reset-marker'\s*\|\|)[\s\S]{0,160}?'month-rotation-marker'/;
  const sources: { path: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.(ts|tsx)$/.test(name)) continue;
      if (p.endsWith('system-records.ts') || p.endsWith('html-export.ts')) continue;
      sources.push({ path: p, text: readFileSync(p, 'utf8') });
    }
  };
  // Every file under src is read here, while vitest collects this file, because collecting has no
  // time limit and walking all of src can outlast the per-test limit on a busy machine.
  walk(join(process.cwd(), 'src'));

  it('src/ carries the predicate, not the literal chain', () => {
    const offenders = sources.filter((s) => EXCLUSION.test(s.text)).map((s) => s.path);
    expect(offenders).toEqual([]);
  });

  it('the embedded HTML-export verifier covers prune-marker wherever it names rotation markers', () => {
    const exportSrc = exportSource();
    const rotation = exportSrc.match(/k==='month-rotation-marker'/g)?.length ?? 0;
    const prune = exportSrc.match(/k==='prune-marker'/g)?.length ?? 0;
    expect(rotation).toBeGreaterThan(0);
    expect(prune).toBe(rotation);
  });
});
