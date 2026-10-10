// Evidence-gap register item 18 (2026-09-06): a repair the file discloses.
//
// repairRelegatedPositions solves for the chain position whose canonical hash
// equals a stripped record's stored integrityHash and writes it back, and it
// told only a 20-entry local log. Now each heal-log event goes on the live
// chain once as a signed repair marker, and the export prints the heal log in
// "This file". This file pins the hashed line, the two-sided shape check, the
// heal-event mapping, the idempotent disclosure loop against a fake worker,
// the export row, and the wiring by source.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  discloseRepairsOnChain,
  isRepairMarkerInput,
  repairInputFromHealEvent,
  repairMarkerSummary,
  repairMarkerText,
  REPAIR_DISCLOSED_KEY,
} from '../../../src/forensics/repair-marker';
import type { RepairMarkerInput } from '../../../src/types/repair-marker';
import type { HealEvent } from '../../../src/forensics/auto-heal';
import { SYSTEM_MARKER_KINDS } from '../../../src/forensics/system-records';
import { buildForensicHtmlExport, repairLine, I18N, type ExportMetadata } from '../../../src/forensics/html-export';
import type { ForensicRecord } from '../../../src/types/forensic';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const solve: RepairMarkerInput = { at: '2026-06-12T09:00:00.000Z', method: 'position-solve', repairedCount: 3412, unrepairedCount: 88, healed: true };

describe('repair marker text', () => {
  it('the hashed line carries when it ran, the method, both counts and the outcome', () => {
    expect(repairMarkerText(solve, '2026-09-06T04:00:00.000Z', false)).toBe(
      '[repair-marker @ 2026-09-06T04:00:00.000Z] ran=2026-06-12T09:00:00.000Z method=position-solve repaired=3412 unrepaired=88 healed=yes',
    );
    expect(repairMarkerText({ ...solve, healed: false, error: 'read\nfailed  badly' }, 't', true)).toBe(
      '[repair-marker @ t] ran=2026-06-12T09:00:00.000Z method=position-solve repaired=3412 unrepaired=88 healed=no error=read failed badly settings-read-failed',
    );
  });

  it('the reader line', () => {
    expect(repairMarkerSummary(solve)).toBe(
      'repair on 2026-06-12T09:00:00.000Z: 3412 records regained the chain position their stored hash names, 88 could not',
    );
    expect(repairMarkerSummary({ at: 't', method: 'reanchor', repairedCount: 5, unrepairedCount: 0, healed: false })).toBe(
      'repair on t: 5 records set aside by a re-anchor; the run failed',
    );
  });

  it('maps heal-log events and drops the ones that say nothing', () => {
    expect(repairInputFromHealEvent({ at: 'a', healed: true, kind: 'position-repair', repairedCount: 2, unrepairedCount: 1 })).toEqual({
      at: 'a', method: 'position-solve', repairedCount: 2, unrepairedCount: 1, healed: true,
    });
    expect(repairInputFromHealEvent({ at: 'b', healed: false, kind: 'position-repair', error: 'x' })).toEqual({
      at: 'b', method: 'position-solve', repairedCount: 0, unrepairedCount: 0, healed: false, error: 'x',
    });
    expect(repairInputFromHealEvent({ at: 'c', healed: true, kind: 'reanchor', reAnchoredCount: 7 })).toMatchObject({ method: 'reanchor', repairedCount: 7 });
    expect(repairInputFromHealEvent({ at: 'd', healed: true })).toBeNull();
  });

  it('is a system marker', () => {
    expect(SYSTEM_MARKER_KINDS.has('repair-marker')).toBe(true);
  });
});

describe('isRepairMarkerInput (realm boundary, two-sided)', () => {
  const accept: unknown[] = [solve, { ...solve, healed: false, error: 'e' }, { ...solve, method: 'reanchor' }];
  const reject: unknown[] = [
    null, { ...solve, at: 'yesterday' }, { ...solve, method: 'magic' }, { ...solve, repairedCount: -1 },
    { ...solve, unrepairedCount: 1.5 }, { ...solve, healed: 'yes' }, { ...solve, error: 5 },
  ];
  it.each(accept.map((x, i) => [i, x]))('accepts case %i', (_i, x) => { expect(isRepairMarkerInput(x)).toBe(true); });
  it.each(reject.map((x, i) => [i, x]))('rejects case %i', (_i, x) => { expect(isRepairMarkerInput(x)).toBe(false); });
});

describe('discloseRepairsOnChain', () => {
  const g = globalThis as unknown as { chrome?: unknown };
  let saved: unknown;
  let store: Record<string, unknown>;
  beforeEach(() => {
    store = {};
    saved = g.chrome;
    g.chrome = {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: store[key] }),
          set: async (v: Record<string, unknown>) => { Object.assign(store, v); },
        },
      },
    };
  });
  afterEach(() => { g.chrome = saved; });

  const log: HealEvent[] = [
    { at: '2026-08-01T00:00:00.000Z', healed: true, kind: 'position-repair', repairedCount: 1, unrepairedCount: 0 },
    { at: '2026-06-12T09:00:00.000Z', healed: true, kind: 'position-repair', repairedCount: 3412, unrepairedCount: 88 },
    { at: '2026-05-01T00:00:00.000Z', healed: true },
  ];

  it('sends one marker per event oldest first, remembers only the acknowledged ones, and skips them next time', async () => {
    store.fw_chain_heal_log = log;
    const send = vi.fn(async (m: unknown) => {
      const at = (m as { payload: RepairMarkerInput }).payload.at;
      return { ok: at !== '2026-08-01T00:00:00.000Z' };
    });
    const first = await discloseRepairsOnChain(send);
    expect(first).toEqual({ sent: 1, alreadyDisclosed: 0, failed: 1 });
    expect(send.mock.calls.map(c => (c[0] as { type: string; payload: RepairMarkerInput }).payload.at)).toEqual([
      '2026-06-12T09:00:00.000Z', '2026-08-01T00:00:00.000Z',
    ]);
    expect((send.mock.calls[0][0] as { type: string }).type).toBe('REPAIR_MARKER');
    expect(store[REPAIR_DISCLOSED_KEY]).toEqual(['2026-06-12T09:00:00.000Z']);

    const send2 = vi.fn(async () => ({ ok: true }));
    const second = await discloseRepairsOnChain(send2);
    expect(second).toEqual({ sent: 1, alreadyDisclosed: 1, failed: 0 });
    expect(send2).toHaveBeenCalledTimes(1);
    expect(store[REPAIR_DISCLOSED_KEY]).toEqual(['2026-06-12T09:00:00.000Z', '2026-08-01T00:00:00.000Z']);
  });

  it('an empty log sends nothing; a throwing worker is a failure, not a throw', async () => {
    expect(await discloseRepairsOnChain(vi.fn())).toEqual({ sent: 0, alreadyDisclosed: 0, failed: 0 });
    store.fw_chain_heal_log = [log[1]];
    const out = await discloseRepairsOnChain(vi.fn(async () => { throw new Error('gone'); }));
    expect(out).toEqual({ sent: 0, alreadyDisclosed: 0, failed: 1 });
    expect(store[REPAIR_DISCLOSED_KEY]).toBeUndefined();
  });
});

describe('the export prints the heal log in "This file"', () => {
  const META: ExportMetadata = {
    fwVersion: 'V1.0.0-test',
    publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' },
    publicKeyFingerprint: 'fp16',
    locale: 'en',
  };
  const rec = {
    id: 'r-1', timestamp: '2026-07-01T10:00:00.000Z', platform: 'tiktok', originalText: 'post', originalHash: 'h', originalLength: 4,
    neutralizedText: '', author: '@u', postUrl: '', techniques: [], overallScore: 0, userAgeCategory: 'teen', aiSource: 'cloud',
    feedSource: 'for-you', integrityHash: 'deadbeef', signature: 'sig', publicKeyFingerprint: 'fp', chainPosition: 0, kind: 'post', verdict: 'pass',
  } as ForensicRecord;

  it('one sentence per event, none when the log is empty', () => {
    const html = buildForensicHtmlExport([rec], { ...META, healLog: [
      { at: '2026-06-12T09:00:00.000Z', healed: true, kind: 'position-repair', repairedCount: 3412, unrepairedCount: 88 },
      { at: '2026-06-11T09:00:00.000Z', healed: false, kind: 'position-repair', error: 'store unreadable' },
    ] });
    expect(html).toContain('data-repairs="2"');
    expect(html).toContain(I18N.en.fileRepairs);
    expect(html).toContain('2026-06-12T09:00:00.000Z: position recovery; 3412 records regained the chain position their stored hash names, 88 could not.');
    expect(html).toContain('a repair run failed (store unreadable)');
    // The string table rides in the payload; the row itself is what must be absent.
    expect(buildForensicHtmlExport([rec], META)).not.toContain('data-repairs=');
    expect(repairLine({ at: 'x', healed: true }, I18N.en)).toBeNull();
  });

  it('every interface language carries the four repair strings', () => {
    for (const locale of Object.keys(I18N) as Array<keyof typeof I18N>) {
      for (const key of ['fileRepairs', 'fileRepairPositionSolve', 'fileRepairReanchor', 'fileRepairFailed'] as const) {
        expect(I18N[locale][key].length, `${locale}.${key}`).toBeGreaterThan(10);
      }
      expect(I18N[locale].fileRepairPositionSolve).toContain('{r}');
      expect(I18N[locale].fileRepairPositionSolve).toContain('{u}');
    }
  });
});

describe('wiring (source lock)', () => {
  it('the dashboard discloses after the repair, the worker writes on the chain lock, the exporter passes the log', () => {
    expect(read('src/ui/dashboard/Dashboard.tsx')).toContain('void discloseRepairsOnChain();');
    const sw = read('src/background/service-worker.ts');
    expect(sw).toContain("if (message.type === 'REPAIR_MARKER')");
    expect(sw).toContain('isRepairMarkerInput(message.payload)');
    // Two HTML export paths since 2026-09-16 (PLAN-2026-09-16 item 6.2 removed the per-chain one).
    expect(read('src/forensics/exporter.ts').match(/healLog: await readHealLog\(\),/g)?.length).toBe(2);
    const writer = read('src/forensics/repair-marker.ts');
    const block = writer.slice(writer.indexOf('export function appendRepairMarker'));
    expect(block).toContain('sharedChainWriteLock(');
    expect(block).toContain('originalText: text');
    expect(block).toContain("kind: 'repair-marker'");
    expect(block).toContain('await addRecord(');
  });
});
