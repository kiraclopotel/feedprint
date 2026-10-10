// Wiring audit of 13 Sep 2026, batch B: counters and windows count the whole
// chain, the month rotation does not zero them, the export's numbers note is
// true, and Verify on an install with archives neither turns the banner amber
// nor calls every record unverified.
//
// docs/audits/2026-09-13-wiring/FINDINGS.md, batch B: C1, C2, C3, C4, C9,
// C31, C32, D1-3, D1-10, D2-1, D2-2, D2-7, D2-12, D2-13, D2-14, D2-22.
//
// The shell (Dashboard.tsx) is locked by source reads, the same idiom as
// dashboard-freshness-wiring.test.ts: mounting it needs IndexedDB and the
// service worker. The pure pieces are exercised directly.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { verifyChainIntegrityAcrossMonths, type IntegrityResult } from '../../../src/forensics/chain-integrity';
import { integrityVerificationState, unverifiedRecordCount, summarizeForensicIntegrity } from '../../../src/forensics/integrity-summary';
import { ChainBanner } from '../../../src/ui/dashboard/components/ChainBanner';
import { ForensicsTab } from '../../../src/ui/dashboard/components/ForensicsTab';
import { flagProvenance, isDecidedContentRecord, computeFlagSplit } from '../../../src/forensics/flag-provenance';
import { isModelNamed, isPaidPlacement } from '../../../src/forensics/export-numbers';
import * as engine from '../../../src/forensics/export-numbers';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';
import { computeStats } from '../../../src/forensics/store';
import { computeGroupBehavior } from '../../../src/ui/dashboard/components/group-behavior';
import { usageBand } from '../../../src/ui/dashboard/components/UsageTimePanel';
import { I18N, READING_SCRIPT } from '../../../src/forensics/html-export';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';
import { UI_LANGUAGES } from '../../../src/i18n';
import type { ForensicRecord } from '../../../src/types/forensic';

let seq = 0;
function rec(over: Partial<ForensicRecord> = {}): ForensicRecord {
  seq++;
  return {
    id: `r-${seq}`,
    timestamp: '2026-09-07T12:00:00.000Z',
    platform: 'twitter',
    originalText: 'a body long enough to be ordinary',
    originalHash: `h${seq}`,
    originalLength: 33,
    neutralizedText: '',
    author: '@someone',
    postUrl: `https://x.com/someone/status/${seq}`,
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'for-you',
    detectionMode: 'pass:post-llm-not-manipulative',
    prevRecordHash: `p${seq}`,
    chainPosition: seq,
    verdict: 'pass',
    kind: 'post',
    integrityHash: `i${seq}`,
    signature: `s${seq}`,
    ...over,
  } as ForensicRecord;
}

const verified = (ids: string[]): IntegrityResult => ({
  valid: true, chainLength: ids.length, preChainCount: 0, preRekeyCount: 0,
  perRecord: new Map(ids.map(id => [id, 'verified' as const])),
});

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('D2-1, D2-22: a cross-month verify carries every record it checked', () => {
  const archive = [rec({ chainPosition: 0 }), rec({ chainPosition: 1 })];
  const current = [rec({ chainPosition: 0 }), rec({ chainPosition: 1 }), rec({ chainPosition: 2 })];
  const archiveResult = verified(archive.map(r => r.id));
  const currentResult = verified(current.map(r => r.id));

  it('the rolled-up result has the union of the per-record maps, so the summary reads verified, not partial', async () => {
    const cross = await verifyChainIntegrityAcrossMonths(current, [{ monthKey: '2026-08', records: archive }], {
      archiveResults: new Map([['2026-08', archiveResult]]),
      currentResult,
    });
    expect(cross.valid).toBe(true);
    expect(cross.chainLength).toBe(5);
    expect(cross.perRecord?.size).toBe(5);
    expect(integrityVerificationState(cross)).toBe('verified');
    expect(unverifiedRecordCount(cross)).toBe(0);
    expect(summarizeForensicIntegrity(cross).counts.verified).toBe(5);
  });

  it('the banner fed the cross-month result stays green and names the whole record', async () => {
    const cross = await verifyChainIntegrityAcrossMonths(current, [{ monthKey: '2026-08', records: archive }], {
      archiveResults: new Map([['2026-08', archiveResult]]),
      currentResult,
    });
    const html = renderToStaticMarkup(
      <ChainBanner records={[...archive, ...current]} integrity={cross} fingerprint="ff" anchorCreatedAt={null} archivedMonthCount={1} archivesVerified />,
    );
    expect(html).toContain('chain-banner ok');
    expect(html).toContain('Record verified');
    expect(html).not.toContain('partly verified');
  });

  it('reused month verdicts are taken as given; a month not in the map is walked', async () => {
    // The reused archive verdict is deliberately a broken one: if the walk
    // ran anyway it would find two unsigned-but-consistent records and report
    // valid, so a broken roll-up proves the reuse.
    const broken: IntegrityResult = { valid: false, brokenAt: 1, brokenKind: 'tampered', reason: 'test', chainLength: 2, preChainCount: 0, preRekeyCount: 0, perRecord: new Map([[archive[0].id, 'verified'], [archive[1].id, 'broken']]) };
    const cross = await verifyChainIntegrityAcrossMonths(current, [{ monthKey: '2026-08', records: archive }], {
      archiveResults: new Map([['2026-08', broken]]),
      currentResult,
    });
    expect(cross.valid).toBe(false);
    expect(cross.reason).toContain('2026-08');
    expect(cross.perMonth[0].result).toBe(broken);
    expect(cross.perMonth[1].result).toBe(currentResult);
  });
});

describe('D2-2: the Forensics tab prints one total, the whole record, in the banner and the entries row', () => {
  it('banner count and entries row agree on the cross-month total', () => {
    const active = [rec(), rec()];
    const archived = [rec(), rec(), rec()];
    const whole = [...archived, ...active];
    const cross = { ...verified(whole.map(r => r.id)), perMonth: [] };
    const html = renderToStaticMarkup(
      <ForensicsTab
        records={active}
        allRecords={whole}
        integrity={verified(active.map(r => r.id))}
        crossMonth={cross}
        archivedMonthCount={1}
        anchorCreatedAt={null}
        fingerprint="ff"
      />,
    );
    // The entries row: "5 (5 verified, 0 pre-existing)", never the active 2.
    expect(html).toContain(`5 <span style="color:var(--fw-muted)">${DASHBOARD_STRINGS.en.anchorEntriesDetail(5, 0)}`);
    expect(html).not.toContain(`2 <span style="color:var(--fw-muted)">`);
  });
});

describe('C1, C2, C3, D1-3, D1-10, D2-7, D2-22: the shell wiring', () => {
  const shell = src('src/ui/dashboard/Dashboard.tsx');

  it('one whole-record list, archives first then the active chain, feeds every counting tab and the stats', () => {
    expect(shell).toContain('const allRecords = useMemo(');
    expect(shell).toContain('[...archiveRecords, ...records]');
    // Item 7 (14 Sep): the stats are the records in the page folded with the
    // summaries of every month not loaded (the walk window, second slice);
    // the two halves never overlap, so the fold is the whole record.
    expect(shell).toContain('foldSummariesIntoStats(computeStats(allRecords), unloadedSummaries)');
    expect(shell).toContain('summariesOutsideLoaded(monthSummaries, loadedMonthKeys)');
    for (const tab of ['OverviewTab', 'ExposureView', 'PatternsTab', 'StatisticsTab']) {
      const at = shell.indexOf(`<${tab}`);
      expect(at, tab).toBeGreaterThan(0);
      expect(shell.slice(at, at + 200), tab).toContain('records={allRecords}');
    }
    expect(shell).toContain('allRecords={allRecords}');
    // The badge: the loaded months by the counting module's rule, every other month by the same rule once it is counted.
    expect(shell).toContain('flaggedItemsAllMonths(allRecords, unloadedSummaries, monthSets)');
    expect(readFileSync(join(process.cwd(), 'src/ui/dashboard/month-sets.ts'), 'utf8')).toContain('let n = countRecordSets(loaded).flagged;');
  });

  it('the archives are read on demand after first paint and their absence is stated, never silent', () => {
    // The tabs read the months inside the walk window (item 7, second slice);
    // Verify still reads every month.
    // Since 2026-09-18 the call answers with the months it could read AND the
    // ones it could not, so a month that will not open is named rather than
    // silently missing from every fold built here.
    expect(shell).toContain('const loaded = await loadArchiveMonths(wanted);');
    expect(shell).toContain('const archives = loaded.months;');
    expect(shell).toContain('const archives = await loadArchivesOldestFirst();');
    expect(shell).toContain('setArchiveRecords(applyRedactions(archives.flatMap(a => a.records)));');
    expect(shell).toContain('setArchivesPending(false)');
    expect(shell).toContain('archivesPending={archivesPending}');
  });

  it('a refused extension falls back to a full walk, so "checking" cannot be permanent (D2-7)', () => {
    expect(shell).toContain('(ext ? Promise.resolve(ext) : verifyChainIntegrity(rawRecs, unreadableRowsRef.current))');
    expect(shell).toContain('void settleRefreshVerify(rawRecs, null);');
  });

  it('the archive verdicts are kept and reused on refresh (D2-22)', () => {
    expect(shell).toContain('archiveVerdictsRef.current = new Map(');
    expect(shell).toContain('archiveResults: kept,');
  });

  it('the refresh keeps the rows Verify found undecodable, so a reset on the live chain is checked the same on both', () => {
    expect(shell).toContain('archivesRef.current = archives.map(a => ({ monthKey: a.monthKey, records: a.records, unreadable: a.unreadable }));');
  });

  it('every interface language carries the pending note and the included note', () => {
    for (const lang of UI_LANGUAGES) {
      const t = DASHBOARD_STRINGS[lang];
      expect(t.archivesPendingNote.length, lang).toBeGreaterThan(20);
      expect(t.showingArchivedIncluded(12), lang).toMatch(/12/);
      expect(t.sidePanelsPending.length, lang).toBeGreaterThan(10);
      expect(t.archivesPendingNote, lang).not.toContain('—');
    }
  });
});

describe('C4: the export numbers note says what the table ran over', () => {
  it('a report (a selection) uses the selection wording; a whole-record file keeps the whole-file wording', () => {
    expect(READING_SCRIPT).toContain('rdSel.totalSource>records.length');
    expect(READING_SCRIPT).toContain('fill(i18n.rdSelectionNote,num(records.length),num(rdSel.totalSource))');
    expect(READING_SCRIPT).toContain("fill(i18n.rdWholeChain,num(records.length),'')");
    for (const [locale, table] of Object.entries(I18N)) {
      expect(table.rdSelectionNote, locale).toContain('{n}');
      expect(table.rdSelectionNote, locale).toContain('{m}');
      expect(table.rdSelectionNote, locale).not.toContain('—');
    }
  });
});

describe('C9, C32: one reading of "a judge decided this", and the flagged share counts what was seen', () => {
  const shapes: ForensicRecord[] = [
    rec({ verdict: 'flagged', aiSource: 'cloud' }),
    rec({ verdict: 'flagged-hidden', aiSource: 'local' }),
    rec({ verdict: undefined, aiSource: 'cloud' }),
    rec({ verdict: 'flagged', aiSource: 'rules', detectionMode: 'sponsored-ad' }),
    rec({ verdict: 'flagged', aiSource: 'none', detectionMode: 'blocklist:word:x' }),
    rec({ verdict: 'flagged', aiSource: 'cloud', overrideOrigin: 'identity-slur' }),
    rec({ verdict: 'flagged', aiSource: 'local', feedSource: 'manual', detectionMode: 'manual' }),
    // The disputed shape: the structured fields say a model read it, the
    // detection-mode text says an ad marker. Both readers follow the fields
    // (flag-provenance.ts contract) and both then apply the advertising rule
    // of 2026-09-14, so they cannot disagree.
    rec({ verdict: 'flagged', aiSource: 'cloud', detectionMode: 'sponsored-ad' }),
    rec({ verdict: 'flagged', aiSource: 'cloud', detectionMode: 'blocklist:word:x' }),
    rec({ verdict: 'pass', aiSource: 'cloud' }),
    rec({ verdict: 'blocked', aiSource: 'rules', detectionMode: 'block:ai-label:en' }),
  ];
  const inline = new Function(`${EXPORT_NUMBERS_INLINE_SOURCE}; return FWN;`)() as typeof engine;

  it('isModelNamed is exactly "flagged and judged" for every shape, in the module and the inline copy', () => {
    for (const r of shapes) {
      const flagged = r.verdict === 'flagged' || r.verdict === 'flagged-hidden' || r.verdict === undefined;
      // Advertising is never model-named, whatever read the item (standing
      // decision 1, 2026-09-14): it has its own column and its own page-one
      // row, and a judged verdict on a sponsored post is still a paid
      // placement.
      const expected = flagged && !isPaidPlacement(r) && flagProvenance(r) === 'judged';
      expect(isModelNamed(r), `${r.aiSource} ${r.detectionMode} ${r.verdict}`).toBe(expected);
      expect(inline.isModelNamed(r), `inline ${r.aiSource} ${r.detectionMode} ${r.verdict}`).toBe(expected);
    }
  });

  it('an image analysis record is not in the flagged share; its post already is', () => {
    expect(isDecidedContentRecord(rec({ kind: 'image', verdict: 'flagged' }))).toBe(false);
    expect(isDecidedContentRecord(rec({ kind: 'post', verdict: 'flagged' }))).toBe(true);
    const split = computeFlagSplit([
      rec({ kind: 'post', verdict: 'flagged' }),
      rec({ kind: 'image', verdict: 'flagged', parentVideoId: 'v1' }),
      rec({ kind: 'post', verdict: 'pass' }),
    ])!;
    expect(split.decided).toBe(2);
    expect(split.flagged).toBe(1);
  });
});

describe('C31: a technique is counted once per record', () => {
  it('two entries that fold into one bucket count that bucket once', () => {
    const stats = computeStats([
      rec({ verdict: 'flagged', techniques: [
        { name: 'anger-trigger', severity: 5, confidence: 1 },
        { name: 'anger-trigger', severity: 7, confidence: 1 },
      ] }),
    ]);
    const buckets = Object.values(stats.byTechnique);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toBe(1);
  });
});

describe('D2-14: the group panel reads "flagged" the way every other surface does', () => {
  it('a legacy record with no verdict is a flagged record', () => {
    const groups = computeGroupBehavior([
      rec({ accountType: 'group', sourceContainer: 'Parents of Exampleton', verdict: undefined, techniques: [{ name: 'fear-appeal', severity: 6, confidence: 1 }] }),
      rec({ accountType: 'group', sourceContainer: 'Parents of Exampleton', verdict: 'pass' }),
    ] as ForensicRecord[]);
    expect(groups).toHaveLength(1);
    expect(groups[0].flaggedCount).toBe(1);
  });
});

describe('D2-13: the usage bands', () => {
  it('skipped and cancelled scans are "not judged"; markers and room summaries are not counted', () => {
    expect(usageBand(rec({ verdict: 'skipped' }))).toBe('unjudged');
    expect(usageBand(rec({ verdict: 'cancelled-stale' }))).toBe('unjudged');
    expect(usageBand(rec({ verdict: 'pass' }))).toBe('pass');
    expect(usageBand(rec({ verdict: 'masked' }))).toBe('pass');
    expect(usageBand(rec({ verdict: 'flagged-hidden' }))).toBe('flagged');
    expect(usageBand(rec({ verdict: 'blocked' }))).toBe('blocked');
    expect(usageBand(rec({ kind: 'heartbeat-marker', verdict: 'pass' }))).toBeNull();
    expect(usageBand(rec({ kind: 'environment', verdict: 'pass' }))).toBeNull();
  });
});
