// After a restore the dashboard read "Record is healthy" while the whole-record export of the same
// record read partly verified: the dashboard checks the live chain and each archived month apart,
// and the entries a restore leaves on the other line only show when the two are read as one list.
// Measured on the product walk (backup of 6 entries, 2 more, restore, reset, export): the header
// said healthy over 21 entries, the export page and the node checker said PARTIALLY VERIFIED.
//
// The dashboard now runs the checker's own walk, from a generated copy of its core, over the list a
// whole-record export carries. Each layout below is one the checker's restore tests read, split the
// way the store holds it (archived months, then the live chain, with the copies a restore leaves in
// both), and the dashboard must give the checker's verdict and the checker's words for it.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { VERIFIER_CORE_FNS_SOURCE } from '../../../src/forensics/verifier-core-source';
import { buildDashboardCoreSource } from '../../../scripts/build-standalone-verifier';
import { I18N } from '../../../src/i18n/export-strings';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';
import { I18nProvider } from '../../../src/i18n/react';
import { readRecordLines, recordLinesNotes, wholeRecordInExportOrder } from '../../../src/forensics/record-lines';
import { integrityVerificationState } from '../../../src/forensics/integrity-summary';
import { ChainBanner } from '../../../src/ui/dashboard/components/ChainBanner';
import type { IntegrityResult, RecordVerifyStatus } from '../../../src/forensics/chain-integrity';
import type { ForensicRecord } from '../../../src/types/forensic';
import type { ResolvedUiLanguage } from '../../../src/types/ui-language';

type Chain = { ok: boolean; branches: number; restarts: number; outside: number; setAside: number; setAsideLines: Array<{ position: number; n: number }> };
type Core = {
  verifyChain(records: unknown[], perRecord?: unknown[]): Promise<Chain>;
  coverageFromRecords(records: unknown[]): unknown;
  verificationState(perRecord: unknown[], chain: Chain, extra?: unknown): string;
  chainNotes(chain: Chain, i18n: unknown, sel: unknown): string[];
};
// The checker exactly as the export embeds it, built from the source string, not the generated copy.
const checker = new Function(
  `"use strict";${VERIFIER_CORE_FNS_SOURCE}\n return { verifyChain, coverageFromRecords, verificationState, chainNotes };`,
)() as Core;

const GENESIS = 'feelingwise-chain-genesis-v1';
let serial = 0;
function run(label: string, count: number, from = 0, prev = GENESIS): ForensicRecord[] {
  const out: ForensicRecord[] = [];
  for (let p = from; p < from + count; p++) {
    const h = `${label}-${p}-${serial++}`;
    out.push({ id: h, integrityHash: h, prevRecordHash: prev, chainPosition: p, publicKeyFingerprint: 'k' } as ForensicRecord);
    prev = h;
  }
  return out;
}
function marker(kind: 'reset-marker' | 'month-rotation-marker', priorChainHash: string): ForensicRecord {
  const h = `${kind}-${serial++}`;
  return { id: h, integrityHash: h, prevRecordHash: GENESIS, chainPosition: 0, kind, priorChainHash, publicKeyFingerprint: 'k' } as ForensicRecord;
}

interface Layout { name: string; archives: ForensicRecord[][]; current: ForensicRecord[]; expect: 'verified' | 'partial' }

function layouts(): Layout[] {
  const out: Layout[] = [];
  {
    const old = run('a', 8);
    const m = marker('reset-marker', old[7].integrityHash);
    out.push({ name: 'a reset alone', archives: [old], current: [m, ...run('b', 12, 1, m.integrityHash)], expect: 'verified' });
  }
  {
    const month = run('a', 10);
    const rot = marker('month-rotation-marker', month[9].integrityHash);
    out.push({ name: 'a month flip', archives: [month], current: [rot, ...run('b', 5, 1, rot.integrityHash)], expect: 'verified' });
  }
  {
    // The restore files the outgoing chain in the archive and writes the backup's entries into the
    // live store; the reset then files those copies too.
    const old = run('a', 8);
    const m = marker('reset-marker', old[5].integrityHash);
    out.push({ name: 'the walk: a restore to position 5, then a reset', archives: [[...old, ...old.slice(0, 6)]], current: [m, ...run('b', 12, 1, m.integrityHash)], expect: 'partial' });
  }
  {
    const old = run('a', 8);
    out.push({ name: 'a restore that recording carried on from', archives: [old], current: [...old.slice(0, 6), ...run('c', 2, 6, old[5].integrityHash)], expect: 'partial' });
  }
  {
    const old = run('a', 6);
    const first = marker('reset-marker', old[5].integrityHash);
    const lost = run('b', 3, 1, first.integrityHash);
    const second = marker('reset-marker', old[5].integrityHash);
    out.push({ name: 'a restore after a reset', archives: [[...old, first, ...lost]], current: [second, ...run('d', 4, 1, second.integrityHash)], expect: 'partial' });
  }
  {
    const old = run('a', 8);
    const first = marker('reset-marker', old[5].integrityHash);
    const left = run('d', 4, 1, first.integrityHash);
    const second = marker('reset-marker', old[7].integrityHash);
    out.push({ name: 'a restore to a later backup', archives: [[...old, first, ...left]], current: [second, ...run('e', 3, 1, second.integrityHash)], expect: 'partial' });
  }
  {
    const old = run('a', 8);
    const first = marker('reset-marker', old[5].integrityHash);
    const left = run('d', 4, 1, first.integrityHash);
    const second = marker('reset-marker', old[7].integrityHash);
    const other = run('e', 3, 1, second.integrityHash);
    const third = marker('reset-marker', left[1].integrityHash);
    out.push({ name: 'three restores', archives: [[...old, first, ...left], [second, ...other]], current: [third, ...run('f', 2, 1, third.integrityHash)], expect: 'partial' });
  }
  return out;
}

const allVerified = (records: readonly ForensicRecord[]) => new Map<string, RecordVerifyStatus>(records.map(r => [r.id, 'verified']));

/** What the dashboard's own walks report for this layout: every part sound, every signature verified. */
function partsSound(current: ForensicRecord[], archives: ForensicRecord[][]): IntegrityResult {
  return { valid: true, chainLength: current.length, perRecord: allVerified([...archives.flat(), ...current]) } as IntegrityResult;
}

async function bothReadings(l: Layout) {
  const exported = wholeRecordInExportOrder(l.current, l.archives.map(records => ({ records })));
  const perRecord = exported.map(() => ({ ok: true }));
  const chain = await checker.verifyChain(exported, perRecord);
  const checkerState = checker.verificationState(perRecord, chain, { coverage: checker.coverageFromRecords(exported) });
  const parts = partsSound(l.current, l.archives);
  const recordLines = await readRecordLines(l.current, l.archives.map(records => ({ records })), parts.perRecord);
  const dashboard: IntegrityResult = { ...parts, recordLines };
  return { chain, checkerState, parts, recordLines, dashboard };
}

const LANGS: ResolvedUiLanguage[] = ['en', 'ro', 'es', 'pt-BR'];
const unescape = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');

describe('the dashboard reads a restore as the checker does', () => {
  it('the dashboard runs a copy of the checker written from the same source, byte for byte', () => {
    const onDisk = readFileSync(join(process.cwd(), 'src/forensics/verifier-core.generated.ts'), 'utf8');
    expect(onDisk).toBe(buildDashboardCoreSource());
    expect(onDisk).toContain(VERIFIER_CORE_FNS_SOURCE);
  });

  for (const l of layouts()) {
    it(`${l.name}: the dashboard gives the checker's verdict (${l.expect})`, async () => {
      const { checkerState, parts, dashboard } = await bothReadings(l);
      expect(checkerState).toBe(l.expect);
      expect(integrityVerificationState(dashboard)).toBe(checkerState);
      // The gap this closes: each part alone reads sound.
      expect(integrityVerificationState(parts)).toBe('verified');
    });

    it(`${l.name}: the dashboard's words are the checker's words, in every language`, async () => {
      const { chain, recordLines } = await bothReadings(l);
      expect(chain.outside).toBe(0);
      expect(chain.restarts).toBe(0);
      for (const lang of LANGS) {
        expect(recordLinesNotes(recordLines, lang), lang).toEqual(checker.chainNotes(chain, I18N[lang], null));
      }
    });
  }

  it('the banner says what the exported file says, after the dashboard\'s own lead, in every language', async () => {
    const walk = layouts().find(l => l.name.startsWith('the walk'))!;
    const { chain, dashboard } = await bothReadings(walk);
    for (const lang of LANGS) {
      const html = unescape(renderToStaticMarkup(
        <I18nProvider lang={lang}>
          <ChainBanner records={walk.current} integrity={dashboard} fingerprint="abcd1234" anchorCreatedAt={null} onVerify={() => {}} onExport={() => {}} archivedMonthCount={1} archivesVerified />
        </I18nProvider>,
      ));
      const t = DASHBOARD_STRINGS[lang];
      expect(html, lang).toContain('<div class="chain-banner-title">' + t.chainTitlePartial + '</div>');
      expect(html, lang).toContain(t.chainLinesLead + checker.chainNotes(chain, I18N[lang], null).join(' '));
    }
  });

  it('a marker the dashboard did not verify, under a key no export would carry, opens no run', async () => {
    const month = run('a', 10);
    const rot = marker('month-rotation-marker', month[9].integrityHash);
    const current = [rot, ...run('b', 5, 1, rot.integrityHash)];
    const statuses = allVerified([...month, ...current]);
    statuses.set(rot.id, 'prior-key');
    const lines = await readRecordLines(current, [{ records: month }], statuses, async () => false);
    const exported = wholeRecordInExportOrder(current, [{ records: month }]);
    const chain = await checker.verifyChain(exported, exported.map(r => (r.id === rot.id ? { ok: true, unverified: true } : { ok: true })));
    expect(lines.branches).toBe(chain.branches);
    expect(lines.branches).toBeGreaterThan(0);
  });
});

// A restore onto an install with a new key. The dashboard's walk checks the current key only, so
// every record under the earlier key reads 'prior-key' there, while an export that carries that key
// verifies them, and its checker reads a marker under it as opening a run. The two layouts are the
// ones the check of this change measured apart ("8 seam(s)" on the screen, "2 records continue from
// position 5" in the file), copied from its case file.
function keyed(label: string, count: number, from: number, prev: string, key: string): ForensicRecord[] {
  return run(label, count, from, prev).map(r => ({ ...r, publicKeyFingerprint: key }));
}
function keyedMarker(priorChainHash: string, key: string): ForensicRecord {
  return { ...marker('reset-marker', priorChainHash), publicKeyFingerprint: key };
}
function earlierKeyLayouts(): Array<{ name: string; archives: ForensicRecord[][]; current: ForensicRecord[] }> {
  const out: Array<{ name: string; archives: ForensicRecord[][]; current: ForensicRecord[] }> = [];
  {
    const old = keyed('a', 8, 0, GENESIS, 'old');
    const m = keyedMarker(old[5].integrityHash, 'old');
    out.push({ name: 'the walk, its marker under the earlier key', archives: [[...old, ...old.slice(0, 6)]], current: [m, ...keyed('b', 12, 1, m.integrityHash, 'old')] });
  }
  {
    const old = keyed('a', 6, 0, GENESIS, 'old');
    const first = keyedMarker(old[5].integrityHash, 'old');
    const lost = keyed('b', 3, 1, first.integrityHash, 'old');
    const second = keyedMarker(old[5].integrityHash, 'new');
    out.push({ name: 'a restore after a reset, the first marker under the earlier key', archives: [[...old, first, ...lost]], current: [second, ...keyed('d', 4, 1, second.integrityHash, 'new')] });
  }
  return out;
}

describe('a marker under an earlier key reads as the checker reads it', () => {
  for (const l of earlierKeyLayouts()) {
    const archives = l.archives.map(records => ({ records }));
    const exported = wholeRecordInExportOrder(l.current, archives);
    const onScreen = new Map<string, RecordVerifyStatus>(exported.map(r => [r.id, r.publicKeyFingerprint === 'new' ? 'verified' : 'prior-key']));

    it(`${l.name}: when the export carries the key, the same verdict and the same words`, async () => {
      const lines = await readRecordLines(l.current, archives, onScreen, async (r) => r.publicKeyFingerprint === 'old');
      const verdicts = exported.map(() => ({ ok: true }));
      const chain = await checker.verifyChain(exported, verdicts);
      expect(chain.setAside).toBeGreaterThan(0);
      expect(chain.branches).toBe(0);
      for (const lang of LANGS) {
        expect(recordLinesNotes(lines, lang), lang).toEqual(checker.chainNotes(chain, I18N[lang], null));
      }
      const dashboard = { valid: true, chainLength: l.current.length, perRecord: onScreen, recordLines: lines } as IntegrityResult;
      expect(integrityVerificationState(dashboard)).toBe('partial');
    });

    it(`${l.name}: when the key is not carried, as a file without it reads`, async () => {
      const lines = await readRecordLines(l.current, archives, onScreen, async () => false);
      const verdicts = exported.map(r => (r.publicKeyFingerprint === 'old' ? { ok: true, unverified: true } : { ok: true }));
      const chain = await checker.verifyChain(exported, verdicts);
      expect(lines).toEqual({ setAside: chain.setAside, setAsideLines: chain.setAsideLines, branches: chain.branches });
    });
  }

  it('only a run marker is checked again, and a check that throws leaves it unverified', async () => {
    const [walk] = earlierKeyLayouts();
    const archives = walk.archives.map(records => ({ records }));
    const exported = wholeRecordInExportOrder(walk.current, archives);
    const asked: string[] = [];
    await readRecordLines(walk.current, archives, new Map(exported.map(r => [r.id, 'prior-key' as RecordVerifyStatus])), async (r) => { asked.push(r.id); return true; });
    expect(asked).toEqual([walk.current[0].id]);
    const thrown = await readRecordLines(walk.current, archives, new Map(exported.map(r => [r.id, 'prior-key' as RecordVerifyStatus])), async () => { throw new Error('no key store'); });
    expect(thrown.setAside).toBe(0);
  });
});
