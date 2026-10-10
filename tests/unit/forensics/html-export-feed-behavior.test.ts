/** @vitest-environment jsdom */
//
// Feed behavior section of the HTML export — the five-level analysis spine
// (READER_LENSES.md) recomputed by the EXACT recipient script over the
// embedded payload. Locks:
// 1. The run/return/amplification/chain numbers match the dashboard's
//    feed-behavior-data semantics (shared thresholds; the export can never
//    disagree with the Patterns tab about what earned a caution).
// 2. Level 5 is rule-gated: no caution line, no prediction, without its
//    evidence threshold.
// 3. The lens bar switches captions without touching any number.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildForensicHtmlExport,
  BEHAVIOR_SCRIPT,
  I18N,
  type ExportMetadata,
} from '../../../src/forensics/html-export';
import type { ForensicRecord } from '../../../src/types/forensic';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';
import { PRETTY_TECHNIQUE } from '../../../src/i18n/technique-labels';

let seq = 0;
function rec(overrides: Partial<ForensicRecord> = {}): ForensicRecord {
  seq++;
  return {
    id: `r-${seq}`,
    timestamp: '2026-07-01T10:00:00Z',
    platform: 'tiktok',
    originalText: 'sample',
    originalHash: 'h',
    originalLength: 6,
    neutralizedText: '',
    author: '@user',
    postUrl: '',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'for-you',
    integrityHash: 'deadbeef',
    signature: 'sig',
    publicKeyFingerprint: 'fp',
    chainPosition: seq,
    kind: 'post',
    verdict: 'pass',
    ...overrides,
  } as ForensicRecord;
}

const META: ExportMetadata = {
  fwVersion: 'V1.0.0-test',
  publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' },
  publicKeyFingerprint: 'fp16',
  locale: 'en',
};

function minuteRun(startIso: string, verdicts: Array<ForensicRecord['verdict']>, extra: Partial<ForensicRecord> = {}): ForensicRecord[] {
  const start = new Date(startIso).getTime();
  return verdicts.map((verdict, i) =>
    rec({ timestamp: new Date(start + i * 60_000).toISOString(), verdict, ...extra }));
}

function renderBehaviorHtml(records: ForensicRecord[]): string {
  const html = buildForensicHtmlExport(records, META);
  const m = html.match(
    /<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/,
  );
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m![1]);
  document.body.innerHTML = '<div id="fw-behavior"></div>';
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${BEHAVIOR_SCRIPT}`)();
  return (document.getElementById('fw-behavior') as HTMLElement).innerHTML;
}

beforeEach(() => {
  document.body.innerHTML = '';
  delete (window as unknown as { __FW_EXPORT__?: unknown }).__FW_EXPORT__;
});

describe('export feed behavior section (five levels + lenses)', () => {
  it('renders the longest run with its end minute and the whole-set provenance', () => {
    const html = renderBehaviorHtml(minuteRun('2026-07-01T10:00:00Z', [
      'pass', 'flagged', 'flagged-hidden', undefined, 'pass',
    ]));
    // CHANGED 2026-09-20, M343: this file asked "was it flagged" two ways at
    // once (page one's 7.5% against this section's 7.9% on the same export).
    // The rule here now asks the shared predicates (FWN.isDecidedContentRecord,
    // FWN.isFlaggedRecord) instead of restating its own, and those predicates'
    // own docblock says a record with no verdict predates the field and was
    // only ever written when flagged. So the undefined-verdict item below is
    // flagged, not a break: the run is 3 (pass, then three flagged in a row,
    // then pass), not 2.
    expect(html).toContain('3 flagged items in a row');
    // end minute of the fourth run item, the undefined-verdict one (10:03
    // local of that timestamp).
    const endLocal = new Date('2026-07-01T10:03:00Z');
    const hm = `${String(endLocal.getHours()).padStart(2, '0')}:${String(endLocal.getMinutes()).padStart(2, '0')}`;
    expect(html).toContain(`ending at ${hm}.`);
    expect(html).toContain('5 records');
    expect(html).toContain('signed chain');
  });

  it('gates level 5: a calm chain shows no caution and no prediction', () => {
    const html = renderBehaviorHtml(minuteRun('2026-07-01T10:00:00Z', ['pass', 'flagged', 'pass']));
    expect(html).toContain(I18N.en.bhCautionNone);
    expect(html).not.toContain(I18N.en.bhPredTag);
    expect(html).not.toContain(I18N.en.bhCautionRun);
  });

  it('a run of 5+ fires the run caution and the run prediction clause', () => {
    const html = renderBehaviorHtml(minuteRun('2026-07-01T10:00:00Z', [
      'pass', 'flagged', 'flagged', 'flagged', 'flagged', 'flagged', 'pass',
    ]));
    expect(html).toContain(I18N.en.bhCautionRun);
    expect(html).toContain('Evidence: longest run 5 flagged items in a row');
    expect(html).toContain(I18N.en.bhPredTag);
    expect(html).toContain(I18N.en.bhPredClauseRun);
    expect(html).not.toContain(I18N.en.bhPredClauseReturn);
  });

  it('counts welcome-back items over 2h+ gaps with the disclosed sample size', () => {
    const html = renderBehaviorHtml([
      rec({ timestamp: '2026-07-01T08:00:00Z', verdict: 'pass' }),
      rec({ timestamp: '2026-07-01T10:00:00Z', verdict: 'flagged' }),
      rec({ timestamp: '2026-07-01T10:30:00Z', verdict: 'flagged' }),
      rec({ timestamp: '2026-07-01T13:00:00Z', verdict: 'pass' }),
    ]);
    expect(html).toContain('1 of 2 welcome-back items were flagged (50%).');
  });

  // An environment record is written per BATCH FLUSH, so a busy comment section
  // writes several and used to vote several times: 286 records over 155 rooms
  // in the 2026-09-08 file, 1.85 votes each. One reading per room now, worst
  // label winning — a section that read 'high' on any flush was pushed.
  it('a room that flushed twice counts once, at its worst reading', () => {
    const html = renderBehaviorHtml([
      rec({ kind: 'environment', parentVideoId: 'vid-1', environment: { algorithmicAmplification: 'normal' } as ForensicRecord['environment'] }),
      rec({ kind: 'environment', parentVideoId: 'vid-1', environment: { algorithmicAmplification: 'high' } as ForensicRecord['environment'] }),
      rec({ kind: 'environment', parentVideoId: 'vid-2', environment: { algorithmicAmplification: 'low' } as ForensicRecord['environment'] }),
      rec({ feedSource: 'for-you' }),
    ]);
    expect(html).toContain('2 of 2 rooms carried an amplification reading');
  });

  // 'unknown' means the surface gave no view count, not that the room was
  // quiet. It was in the denominator, so "high amplification" printed as 25.9%
  // on the 2026-09-08 file when it was 62.2% of the rooms that carried a
  // reading — the product's strongest signal understated 2.4x by its own
  // arithmetic. Unmeasured rooms are reported beside the figure, never inside it.
  it('rooms with no reading are named, not counted into the share', () => {
    const html = renderBehaviorHtml([
      rec({ kind: 'environment', parentVideoId: 'v1', environment: { algorithmicAmplification: 'high' } as ForensicRecord['environment'] }),
      rec({ kind: 'environment', parentVideoId: 'v2', environment: { algorithmicAmplification: 'unknown' } as ForensicRecord['environment'] }),
      rec({ kind: 'environment', parentVideoId: 'v3', environment: {} as ForensicRecord['environment'] }),
      rec({ feedSource: 'for-you' }),
    ]);
    expect(html).toContain('1 of 3 rooms carried an amplification reading');
  });

  it('tallies amplification from environment records and advertiser For-you placement', () => {
    const html = renderBehaviorHtml([
      rec({ kind: 'environment', environment: { algorithmicAmplification: 'high' } as ForensicRecord['environment'] }),
      rec({ kind: 'environment', environment: { algorithmicAmplification: 'normal' } as ForensicRecord['environment'] }),
      rec({ accountType: 'advertiser', feedSource: 'for-you' }),
      rec({ accountType: 'advertiser', feedSource: 'following' }),
      rec({ feedSource: 'for-you' }),
    ]);
    // "For you page", not "For you feed", since the plain-words pass of 2026-08-04. It is also the
    // name the platform itself uses, so the copy got more accurate and plainer in the same edit.
    expect(html).toContain('1 of 2 advertiser items arrived on the For you page.');
    expect(html).toContain('2 of 2 rooms carried an amplification reading, 2 advertiser items');
  });

  it('lists re-served threads by real content URL, filtering bare origins and surface pages', () => {
    const thread = { roomUrl: 'https://www.tiktok.com/@a/video/123', author: '@a' };
    const html = renderBehaviorHtml([
      rec({ timestamp: '2026-07-01T10:00:00Z', ...thread }),
      rec({ timestamp: '2026-07-02T10:00:00Z', ...thread, verdict: 'flagged' }),
      // Surface pages and bare origins never count as threads.
      rec({ timestamp: '2026-07-01T11:00:00Z', postUrl: 'https://www.tiktok.com/foryou' }),
      rec({ timestamp: '2026-07-02T11:00:00Z', postUrl: 'https://www.tiktok.com/foryou' }),
      rec({ timestamp: '2026-07-01T12:00:00Z', postUrl: 'https://x.com/' }),
      rec({ timestamp: '2026-07-02T12:00:00Z', postUrl: 'https://x.com/' }),
    ]);
    expect(html).toContain('www.tiktok.com/@a/video/123');
    expect(html).not.toContain('foryou</');
    expect(html).toContain('1 threads on 2+ days');
  });

  it('renders technique hand-offs within a sitting and recurring voices over 3+ days', () => {
    const tech = (name: string) => ({ verdict: 'flagged' as const, techniques: [{ name, severity: 5, confidence: 0.9 }] });
    const html = renderBehaviorHtml([
      rec({ timestamp: '2026-07-01T10:00:00Z', ...tech('anger-trigger'), author: 'alice' }),
      rec({ timestamp: '2026-07-01T10:01:00Z', ...tech('violence-graphic'), author: 'alice' }),
      rec({ timestamp: '2026-07-02T10:00:00Z', author: 'alice', verdict: 'pass' }),
      rec({ timestamp: '2026-07-03T10:00:00Z', author: 'alice', verdict: 'pass' }),
    ]);
    // CHANGED 2026-09-20, M360: these two read 'anger trigger' and 'violence
    // graphic', the raw enum with its dashes taken out, which this section was
    // the only surface to print. Every card in the same file prints the
    // envelope's own label for the same technique ("anger", "violence", and
    // "pressure to buy" where this said "consumer rapid frame"), so one export
    // named one pattern two ways. The labels are read from the table the
    // envelope is built from rather than written out here, so the case cannot
    // pass over a stale word if a label changes.
    expect(html).toContain(PRETTY_TECHNIQUE['anger-trigger']);
    expect(html).toContain(PRETTY_TECHNIQUE['violence-graphic']);
    expect(html).toContain('1 adjacent pairs');
    expect(html).toContain('alice');
    expect(html).toContain('1 of 1 named sources');
  });

  it('the lens bar switches captions without touching the numbers', () => {
    const records = minuteRun('2026-07-01T10:00:00Z', [
      'pass', 'flagged', 'flagged', 'flagged', 'pass',
    ]);
    const html = buildForensicHtmlExport(records, META);
    const m = html.match(
      /<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/,
    );
    (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m![1]);
    document.body.innerHTML = '<div id="fw-behavior"></div>';
    new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${BEHAVIOR_SCRIPT}`)();
    const rootEl = document.getElementById('fw-behavior') as HTMLElement;
    expect(rootEl.innerHTML).toContain(I18N.en.bhRunsCapParent);
    const statBefore = (rootEl.querySelector('.fwb-stat') as HTMLElement).textContent;

    const lawyerBtn = Array.from(rootEl.querySelectorAll('.fwb-lens'))
      .find((b) => b.textContent === I18N.en.bhLensLawyer) as HTMLElement;
    lawyerBtn.click();
    expect(rootEl.innerHTML).not.toContain(I18N.en.bhRunsCapParent);
    expect(rootEl.innerHTML).toContain('Cite the serial range of those 3 records');
    expect((rootEl.querySelector('.fwb-stat') as HTMLElement).textContent).toBe(statBefore);
  });

  // M343, 2026-09-20: this file told a reader two flag rates from one export
  // (page one 7.5%, the behavior section's own baseline sentence 7.9%, same
  // records). Both a flagged 'image' record (which page one's shared rule
  // excludes as a duplicate of its own post) and a severity-5+ technique with
  // no flagged verdict (which the behavior section used to count on its own,
  // ahead of a verdict) are in this fixture because each was a separate way
  // the two counts used to disagree. The percentage stays under 10% on
  // purpose: page one prints one decimal below 10% and a bare integer at or
  // above it, and comparing across that boundary would fail this check for a
  // formatting reason that has nothing to do with the promise under test.
  it('prints the same flag rate on page one and in the behavior section (M343)', () => {
    const verdicts: Array<ForensicRecord['verdict']> = new Array(27).fill('pass').concat(['flagged', 'flagged']);
    const records: ForensicRecord[] = [
      ...minuteRun('2026-07-01T09:00:00Z', verdicts),
      rec({
        timestamp: '2026-07-01T09:40:00Z',
        verdict: 'pass',
        techniques: [{ name: 'anger-trigger', severity: 7, confidence: 0.9 }],
      }),
      rec({ timestamp: '2026-07-01T09:41:00Z', kind: 'image', verdict: 'flagged' }),
    ];
    const html = buildForensicHtmlExport(records, META);

    const pageOneRow = html.match(/data-fw-prov="flaggedShare">([^<]*)</);
    expect(pageOneRow).not.toBeNull();
    const pageOnePct = Number(pageOneRow![1].match(/\(([\d.]+)%/)![1]);
    expect(pageOnePct).toBeLessThan(10);

    const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
    (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m![1]);
    document.body.innerHTML = '<div id="fw-behavior"></div>';
    new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${BEHAVIOR_SCRIPT}`)();
    const behaviorHtml = (document.getElementById('fw-behavior') as HTMLElement).innerHTML;
    const behaviorRow = behaviorHtml.match(/Baseline flag rate across this export: ([\d.]+)%/);
    expect(behaviorRow).not.toBeNull();
    const behaviorPct = Number(behaviorRow![1]);

    expect(behaviorPct.toFixed(1)).toBe(pageOnePct.toFixed(1));
  });

  it('renders the Romanian table with no missing keys (parity via typed I18N)', () => {
    const html = buildForensicHtmlExport(minuteRun('2026-07-01T10:00:00Z', ['flagged', 'pass']), { ...META, locale: 'ro' });
    const m = html.match(
      /<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/,
    );
    (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m![1]);
    document.body.innerHTML = '<div id="fw-behavior"></div>';
    new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${BEHAVIOR_SCRIPT}`)();
    const out = (document.getElementById('fw-behavior') as HTMLElement).innerHTML;
    expect(out).toContain(I18N.ro.bhHeader);
    expect(out).toContain('1 elemente semnalate la rând');
    expect(out).not.toContain('undefined');
  });
});
