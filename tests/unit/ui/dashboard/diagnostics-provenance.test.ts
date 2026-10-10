/**
 * Turn 89 — a diagnostic must say which build produced it, and over what period.
 *
 * The failure this prevents, from 2026-08-02: a Copy Diagnostics payload was
 * captured at 03:15, pasted at 06:21, and read against code shipped at 06:05.
 * Nothing in the payload revealed the mismatch; it took reading file timestamps
 * on disk. These tests lock the two properties that make that impossible again.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildDiagnosticsProvenance, GROQ_RING_CAP } from '../../../../src/ui/dashboard/diagnostics-provenance';
import { currentBuildSinceRow as currentBuildSince, spansMultipleBuildsRow as spansMultipleBuilds, type BuildRunRow as BuildRun } from '../../../../src/ui/dashboard/build-history-read';

const run = (buildId: string, firstSeen: string, lastSeen = firstSeen): BuildRun =>
  ({ buildId, version: '1.6.0', firstSeen, lastSeen, boots: 1 });

const base = {
  capturedAt: '2026-08-02T06:21:00.000Z',
  buildId: 'fwbid-new',
  version: '1.6.0',
  summaries: {},
};

describe('build chronology', () => {
  it('reports when the running build started here', () => {
    const history = [run('fwbid-new', '2026-08-02T06:05:00.000Z'), run('fwbid-old', '2026-07-14T09:00:00.000Z')];
    expect(currentBuildSince(history, 'fwbid-new')).toBe('2026-08-02T06:05:00.000Z');
    expect(currentBuildSince(history, 'fwbid-never-ran')).toBeNull();
  });

  it('flags a payload whose data began BEFORE the current build — the real 2026-08-02 case', () => {
    const history = [run('fwbid-new', '2026-08-02T06:05:00.000Z'), run('fwbid-old', '2026-07-14T09:00:00.000Z')];
    // Counters running since 07-23 straddle the 08-02 rebuild.
    expect(spansMultipleBuilds(history, '2026-07-23T13:28:15.239Z')).toBe(true);
  });

  it('does not flag a payload gathered entirely under one build', () => {
    const history = [run('fwbid-only', '2026-07-14T09:00:00.000Z')];
    expect(spansMultipleBuilds(history, '2026-07-23T13:28:15.239Z')).toBe(false);
    // Two builds, but all data started after the newest one began.
    const two = [run('fwbid-new', '2026-08-01T00:00:00.000Z'), run('fwbid-old', '2026-07-14T09:00:00.000Z')];
    expect(spansMultipleBuilds(two, '2026-08-01T10:00:00.000Z')).toBe(false);
  });

  it('is silent rather than wrong when there is no data start', () => {
    expect(spansMultipleBuilds([run('a', '2026-08-01T00:00:00.000Z')], null)).toBe(false);
  });
});

describe('provenance payload', () => {
  it('carries the capture instant and the build identity', () => {
    const p = buildDiagnosticsProvenance({
      ...base,
      history: [run('fwbid-new', '2026-08-02T06:05:00.000Z')],
    });
    expect(p.capturedAt).toBe('2026-08-02T06:21:00.000Z');
    expect(p.build.id).toBe('fwbid-new');
    expect(p.build.version).toBe('1.6.0');
    expect(p.build.runningSince).toBe('2026-08-02T06:05:00.000Z');
  });

  it('raises spansMultipleBuilds from the earliest data start across blocks', () => {
    const p = buildDiagnosticsProvenance({
      ...base,
      history: [run('fwbid-new', '2026-08-02T06:05:00.000Z'), run('fwbid-old', '2026-07-14T09:00:00.000Z')],
      summaries: { roomSince: '2026-07-23T13:28:15.239Z', groqFirstTs: '2026-08-02T06:10:00.000Z' },
    });
    expect(p.spansMultipleBuilds).toBe(true);
  });

  it('names a saturated ring buffer instead of letting it read as a total', () => {
    const p = buildDiagnosticsProvenance({
      ...base,
      history: [],
      summaries: {
        groqCalls: GROQ_RING_CAP,
        groqFirstTs: '2026-08-02T03:12:19.374Z', groqLastTs: '2026-08-02T03:16:36.217Z',
      },
    });
    expect(p.saturated).toEqual(['groqSummary']);
    // The real capture: 100 calls that look like a day but span four minutes.
    expect(p.windows.groqSummary).toContain('NOT a daily total');
    expect(p.windows.groqSummary).toContain('2026-08-02T03:12:19.374Z');
    expect(p.windows.groqSummary).toContain('BUFFER IS FULL');
  });

  it('leaves an unsaturated buffer unmarked', () => {
    const p = buildDiagnosticsProvenance({
      ...base, history: [], summaries: { groqCalls: 12 },
    });
    expect(p.saturated).toEqual([]);
    expect(p.windows.groqSummary).not.toContain('BUFFER IS FULL');
  });

  it('states that the daily counters are TODAY ONLY — absence is not "never"', () => {
    const p = buildDiagnosticsProvenance({ ...base, history: [], summaries: { diagnosticsDate: '2026-08-02' } });
    expect(p.windows.diagnosticCounterTotals).toContain('TODAY ONLY');
    expect(p.windows.diagnosticCounterTotals).toContain('not the same as never bumped');
  });

  it('explains an empty perf summary instead of leaving it looking broken', () => {
    const p = buildDiagnosticsProvenance({ ...base, history: [], summaries: { perfRecords: 0 } });
    expect(p.windows.perfSummary).toContain('EMPTY BY DESIGN');
    expect(p.windows.perfSummary).toContain('Not a fault');
  });


  it('labels exactly the blocks the copied payload carries, no more and no fewer (D2-33)', () => {
    const p = buildDiagnosticsProvenance({ ...base, history: [] });
    const panel = readFileSync('src/ui/dashboard/components/OperationalEventsPanel.tsx', 'utf8');
    const start = panel.indexOf('const payload = JSON.stringify({');
    const body = panel.slice(start, panel.indexOf('}, null, 2);', start));
    const keys = Array.from(body.matchAll(/^\s{6}([A-Za-z]+)(?::|,)/gm)).map(m => m[1]).filter(k => k !== 'provenance');
    expect(keys.length).toBeGreaterThan(10);
    expect(Object.keys(p.windows).sort()).toEqual([...new Set(keys)].sort());
  });
});
