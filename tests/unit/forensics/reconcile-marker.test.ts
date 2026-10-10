// Evidence-gap register item 10, part 2 (2026-09-06): the reconciliation is on
// the chain.
//
// The ninth marker kind, and the last for this register. Neither of the eight
// carries it: a gap marker states a bound on what was lost, a heartbeat states
// that the recorder was alive over a window, and a reconciliation states that
// an outside document was compared against the record and how much of it that
// document supports. The counts and the archive's digest ride inside the
// hashed text, so nothing in the canonical field list changed and no record
// written before this kind existed hashes any differently.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isReconcileMarkerInput,
  reconcileMarkerText,
  reconcileMarkerSummary,
} from '../../../src/forensics/reconcile-marker';
import { SYSTEM_MARKER_KINDS } from '../../../src/forensics/system-records';
import type { ReconcileMarkerInput } from '../../../src/types/reconcile-marker';
import { readSource } from '../../helpers/read-source';

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


const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8');

const DIGEST = 'a'.repeat(64);

function input(over: Partial<ReconcileMarkerInput> = {}): ReconcileMarkerInput {
  return {
    archiveDigest: DIGEST,
    platforms: ['facebook'],
    fromISO: '2026-08-01T10:00:00.000Z',
    toISO: '2026-08-31T10:00:00.000Z',
    windowMinutes: 15,
    corroboratedByUrl: 4,
    corroboratedByAuthorAndTime: 7,
    unmatchedRecords: 12,
    unmatchedArchiveItems: 30,
    recordsOutsideWindow: 100,
    ...over,
  };
}

describe('the shape check at the realm boundary', () => {
  it('accepts a well-formed input', () => {
    expect(isReconcileMarkerInput(input())).toBe(true);
    expect(isReconcileMarkerInput(input({ platforms: ['facebook', 'instagram', 'tiktok'] }))).toBe(true);
    expect(isReconcileMarkerInput(input({ corroboratedByUrl: 0, corroboratedByAuthorAndTime: 0 }))).toBe(true);
  });

  it('refuses what a dashboard should never send', () => {
    expect(isReconcileMarkerInput(null)).toBe(false);
    expect(isReconcileMarkerInput(input({ archiveDigest: 'not-a-digest' }))).toBe(false);
    expect(isReconcileMarkerInput(input({ archiveDigest: 'A'.repeat(64) }))).toBe(false);
    expect(isReconcileMarkerInput(input({ platforms: [] }))).toBe(false);
    expect(isReconcileMarkerInput(input({ platforms: ['myspace'] }))).toBe(false);
    expect(isReconcileMarkerInput(input({ fromISO: 'whenever' }))).toBe(false);
    expect(isReconcileMarkerInput(input({ windowMinutes: -1 }))).toBe(false);
    expect(isReconcileMarkerInput(input({ windowMinutes: 60 * 24 + 1 }))).toBe(false);
    expect(isReconcileMarkerInput(input({ unmatchedRecords: 1.5 }))).toBe(false);
    expect(isReconcileMarkerInput(input({ recordsOutsideWindow: -3 }))).toBe(false);
  });
});

describe('what the marker says', () => {
  it('the hashed line carries every count, the window and the digest, and names nobody', () => {
    const line = reconcileMarkerText(input(), '2026-09-06T15:00:00.000Z', false);
    expect(line).toContain(`archive=${DIGEST}`);
    expect(line).toContain('platforms=facebook');
    expect(line).toContain('windowMinutes=15');
    expect(line).toContain('corroboratedByUrl=4');
    expect(line).toContain('corroboratedByAuthorAndTime=7');
    expect(line).toContain('unmatchedRecords=12');
    expect(line).toContain('unmatchedArchiveItems=30');
    expect(line).toContain('recordsOutsideWindow=100');
    expect(line).not.toMatch(/author=|handle=|file=|name=/);
  });

  it('the platforms are sorted, so the same reconciliation writes the same line', () => {
    const a = reconcileMarkerText(input({ platforms: ['tiktok', 'facebook'] }), 't', false);
    const b = reconcileMarkerText(input({ platforms: ['facebook', 'tiktok'] }), 't', false);
    expect(a).toBe(b);
  });

  it('a settings read that failed is disclosed in the line', () => {
    expect(reconcileMarkerText(input(), 't', true)).toContain('settings-read-failed');
    expect(reconcileMarkerText(input(), 't', false)).not.toContain('settings-read-failed');
  });

  it("the reader's line calls the supported count a floor and never a rate", () => {
    const summary = reconcileMarkerSummary(input());
    expect(summary).toContain('11 records supported by it');
    expect(summary).toContain('12 not mentioned in it');
    expect(summary).toContain('30 things it lists that the recorder has no record of');
    expect(summary).toContain('floor');
    expect(summary).not.toMatch(/\d+(\.\d+)?%/);
  });

  /**
   * The fields added 2026-09-18 (the population the counts are over, the
   * archive entries from outside the recorder's own period, and that period
   * itself). The hashed line is covered by a signature, so the pin below is
   * the point of the whole design: an input without them writes the byte
   * string it wrote before, and a marker already on a chain re-hashes to what
   * it was signed with.
   */
  it('an input without the later fields writes exactly the line it always wrote', () => {
    expect(reconcileMarkerText(input(), '2026-09-06T15:00:00.000Z', false)).toBe(
      `[reconcile-marker @ 2026-09-06T15:00:00.000Z] archive=${DIGEST} platforms=facebook`
      + ' from=2026-08-01T10:00:00.000Z to=2026-08-31T10:00:00.000Z windowMinutes=15'
      + ' corroboratedByUrl=4 corroboratedByAuthorAndTime=7 unmatchedRecords=12'
      + ' unmatchedArchiveItems=30 recordsOutsideWindow=100',
    );
  });

  it('the population, the entries outside coverage and the compared period are on the line when they are known', () => {
    const line = reconcileMarkerText(input({
      systemMarkersExcluded: 9,
      archiveItemsOutsideCoverage: 83,
      comparedFromISO: '2026-08-24T00:00:00.000Z',
      comparedToISO: '2026-08-31T10:00:00.000Z',
    }), 't', true);
    expect(line).toContain('systemMarkersExcluded=9');
    expect(line).toContain('archiveItemsOutsideCoverage=83');
    expect(line).toContain('comparedFrom=2026-08-24T00:00:00.000Z');
    expect(line).toContain('comparedTo=2026-08-31T10:00:00.000Z');
    // The flag stays last, so a reader that looks for it at the end still finds it.
    expect(line.endsWith(' settings-read-failed')).toBe(true);
  });

  it('the later fields may be absent and may not be wrong', () => {
    expect(isReconcileMarkerInput(input({ systemMarkersExcluded: 0, archiveItemsOutsideCoverage: 0 }))).toBe(true);
    expect(isReconcileMarkerInput(input({ comparedFromISO: '2026-08-24T00:00:00.000Z' }))).toBe(true);
    expect(isReconcileMarkerInput(input({ systemMarkersExcluded: -1 }))).toBe(false);
    expect(isReconcileMarkerInput(input({ archiveItemsOutsideCoverage: 1.5 }))).toBe(false);
    expect(isReconcileMarkerInput(input({ comparedToISO: 'whenever' }))).toBe(false);
  });

  it("the summary says what was counted and what was left out, and only when the marker knows", () => {
    expect(reconcileMarkerSummary(input())).not.toMatch(/housekeeping|outside the period this recorder covers/);
    const said = reconcileMarkerSummary(input({
      systemMarkersExcluded: 9,
      archiveItemsOutsideCoverage: 83,
      comparedFromISO: '2026-08-24T00:00:00.000Z',
      comparedToISO: '2026-08-31T10:00:00.000Z',
    }));
    // The old sentence is unchanged and still leads.
    expect(said.startsWith(reconcileMarkerSummary(input()))).toBe(true);
    expect(said).toContain('2026-08-24 to 2026-08-31');
    expect(said).toContain("the chain's own housekeeping");
    expect(said).toContain('9 markers of that kind were left out');
    expect(said).toContain('A further 83 things');
    expect(said).not.toMatch(/\d+(\.\d+)?%/);
  });

  it('one of each reads as one, not as one of many', () => {
    const summary = reconcileMarkerSummary(input({
      corroboratedByUrl: 1, corroboratedByAuthorAndTime: 0, unmatchedArchiveItems: 1,
    }));
    expect(summary).toContain('1 record supported');
    expect(summary).toContain('1 thing it lists');
  });
});

describe('wiring (source lock)', () => {
  it('the kind is a system marker, so no parent-facing aggregation counts it as feed content', () => {
    expect(SYSTEM_MARKER_KINDS.has('reconcile-marker')).toBe(true);
  });

  it('the writer takes the shared chain-write lock and puts the details in the hashed text', () => {
    const src = read('src/forensics/reconcile-marker.ts');
    const block = src.slice(src.indexOf('export function appendReconcileMarker'));
    expect(block).toContain('sharedChainWriteLock(');
    expect(block).toContain('getChainState()');
    expect(block).toContain('originalText: text');
    expect(block).toContain("kind: 'reconcile-marker'");
    expect(block).toContain('getSettingsForAttestation()');
    expect(block).toContain('await addRecord(');
    // No canonical field is added; the statement is the text.
    expect(block).not.toMatch(/archiveDigest:|corroborated\w*:/);
  });

  it('the worker checks the payload before writing, like every other marker', () => {
    const sw = read('src/background/service-worker.ts');
    expect(sw).toContain("if (message.type === 'RECONCILE_MARKER') {");
    expect(sw).toContain('if (!isReconcileMarkerInput(message.payload)) {');
    expect(sw.indexOf('isReconcileMarkerInput(message.payload)')).toBeLessThan(sw.indexOf('appendReconcileMarker(message.payload)'));
  });

  it("the export's own reader treats it as a marker everywhere it treats the other eight as markers", () => {
    const exportSrc = exportSource();
    const redaction = exportSrc.match(/k==='redaction-marker'/g)?.length ?? 0;
    const reconcile = exportSrc.match(/k==='reconcile-marker'/g)?.length ?? 0;
    expect(redaction).toBeGreaterThan(0);
    expect(reconcile).toBe(redaction);
  });

  it('the archive itself is never carried into the marker', () => {
    const types = read('src/types/reconcile-marker.ts');
    expect(types).not.toMatch(/\bitems\b|\bauthor\b\??:|\burl\b\??:|fileName/);
  });
});
