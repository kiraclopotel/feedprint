// Wiring audit 13 Sep, C28 and C29: the rotation and the prune leave a health
// entry, and a refusal that repeats, or one that needs a person, becomes an
// attention item. Nothing here touches the record.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAINTENANCE_HEALTH_KEY, dailyJobOverdue, maintenanceAttention, notePrune, noteRotation, noteStamp, readMaintenanceHealth,
} from '../../../src/forensics/maintenance-health';

let store: Record<string, unknown>;
beforeEach(() => {
  store = {};
  vi.stubGlobal('chrome', { storage: { local: {
    get: async (k: string) => (k in store ? { [k]: store[k] } : {}),
    set: async (items: Record<string, unknown>) => { Object.assign(store, items); },
  } } });
});
afterEach(() => vi.unstubAllGlobals());

describe('rotation health', () => {
  it('counts refusals in a row and resets on success or an idle run', async () => {
    await noteRotation({ rotated: false, reason: 'pending-deliveries' }, '2026-09-01T00:00:00Z');
    await noteRotation({ rotated: false, reason: 'pending-deliveries' }, '2026-09-02T00:00:00Z');
    expect((await readMaintenanceHealth()).rotation?.refusedInARow).toBe(2);
    expect(maintenanceAttention(await readMaintenanceHealth())).toEqual([]);
    await noteRotation({ rotated: false, reason: 'pending-deliveries' }, '2026-09-03T00:00:00Z');
    expect(maintenanceAttention(await readMaintenanceHealth())).toEqual([{ id: 'rotation-stuck', reason: 'pending-deliveries', days: 3 }]);
    await noteRotation({ rotated: false, reason: 'no-rotation-needed' }, '2026-09-04T00:00:00Z');
    const h = await readMaintenanceHealth();
    expect(h.rotation?.ok).toBe(true);
    expect(h.rotation?.refusedInARow).toBe(0);
    expect(maintenanceAttention(h)).toEqual([]);
  });

  it('an archive that already exists and fails its check needs a person at once', async () => {
    await noteRotation({ rotated: false, reason: 'archive-already-exists', archivedMonth: '2026-08' });
    expect(maintenanceAttention(await readMaintenanceHealth())).toEqual([{ id: 'archive-needs-person', month: '2026-08' }]);
  });
});

describe('prune health', () => {
  it('raises an over-cap prune that failed twice, and clears when one succeeds', async () => {
    await notePrune({ ok: false, reason: 'archive-mismatch' });
    expect(maintenanceAttention(await readMaintenanceHealth())).toEqual([]);
    await notePrune({ ok: false, reason: 'archive-mismatch' });
    expect(maintenanceAttention(await readMaintenanceHealth())).toEqual([{ id: 'prune-stuck', reason: 'archive-mismatch', runs: 2 }]);
    await notePrune({ ok: true });
    expect(maintenanceAttention(await readMaintenanceHealth())).toEqual([]);
  });

  it('keeps the other job when one is written', async () => {
    await noteRotation({ rotated: true, archivedMonth: '2026-08' });
    await notePrune({ ok: false, reason: 'x' });
    const h = store[MAINTENANCE_HEALTH_KEY] as { rotation?: unknown; prune?: unknown };
    expect(h.rotation).toBeTruthy();
    expect(h.prune).toBeTruthy();
  });

  it('a stale entry raises attention on its own age, even one that once said ok', async () => {
    // A job that stopped running leaves this exact shape: an old ok:true entry
    // with refusedInARow at 0, which the repeat-refusal check can never see.
    // It is its own item, with whole days and no reason or run count, because
    // the refusal words read "the last 0 attempts failed" for it.
    await notePrune({ ok: true }, '2026-09-10T00:00:00Z');
    const h = await readMaintenanceHealth();
    expect(maintenanceAttention(h, new Date('2026-09-11T00:00:00Z'))).toEqual([]);
    expect(maintenanceAttention(h, new Date('2026-09-12T12:00:00Z'))).toEqual([]);
    expect(maintenanceAttention(h, new Date('2026-09-14T00:00:00Z'))).toEqual([{ id: 'prune-stale', days: 4 }]);
    expect(maintenanceAttention(h, new Date('2026-09-13T06:00:00Z'))).toEqual([{ id: 'prune-stale', days: 3 }]);
  });

  it('an old entry that was refused once is a refusal, not a job that stopped', async () => {
    await notePrune({ ok: false, reason: 'archive-mismatch' }, '2026-09-10T00:00:00Z');
    const h = await readMaintenanceHealth();
    expect(maintenanceAttention(h, new Date('2026-09-11T00:00:00Z'))).toEqual([]);
    expect(maintenanceAttention(h, new Date('2026-09-14T00:00:00Z'))).toEqual([{ id: 'prune-stuck', reason: 'archive-mismatch', runs: 1 }]);
  });

  it('a daily job is overdue a day and an hour after it last reported, and never before it first reports', async () => {
    await notePrune({ ok: true }, '2026-09-10T00:00:00Z');
    const { prune } = await readMaintenanceHealth();
    expect(dailyJobOverdue(prune, new Date('2026-09-11T00:30:00Z')), 'a healthy alarm fires first').toBe(false);
    expect(dailyJobOverdue(prune, new Date('2026-09-11T01:00:00Z'))).toBe(true);
    expect(dailyJobOverdue(undefined, new Date('2026-09-14T00:00:00Z')), 'a new install').toBe(false);
    expect(dailyJobOverdue({ at: 'not a time' }), 'an unreadable time runs the job').toBe(true);
  });

  it('a fresh install with no prune entry yet is not stale', () => {
    expect(maintenanceAttention({}, new Date('2026-09-14T00:00:00Z'))).toEqual([]);
  });

  it('a repeated refusal is reported by its own reason, not overridden by staleness, once it is old too', async () => {
    await notePrune({ ok: false, reason: 'archive-mismatch' }, '2026-09-01T00:00:00Z');
    await notePrune({ ok: false, reason: 'archive-mismatch' }, '2026-09-02T00:00:00Z');
    const h = await readMaintenanceHealth();
    expect(maintenanceAttention(h, new Date('2026-09-20T00:00:00Z'))).toEqual([
      { id: 'prune-stuck', reason: 'archive-mismatch', runs: 2 },
    ]);
  });
});

describe('without extension storage', () => {
  it('reads empty and writes nothing, never throwing', async () => {
    vi.unstubAllGlobals();
    await expect(noteRotation({ rotated: false, reason: 'storage-error' })).resolves.toBeUndefined();
    await expect(readMaintenanceHealth()).resolves.toEqual({});
  });
});

describe('the wiring', () => {
  it('the service worker notes every rotation, the prune notes its outcomes, and the dashboard reads them', async () => {
    const { readFileSync } = await import('node:fs');
    const sw = readFileSync('src/background/service-worker.ts', 'utf8');
    const store = readFileSync('src/forensics/store.ts', 'utf8');
    const dash = readFileSync('src/ui/dashboard/Dashboard.tsx', 'utf8');
    expect(sw).toContain('void noteRotation(result);');
    // 6, not 4: pruneRecordsToCapUnderChainLock has two exits that returned
    // without recording anything at all (the "nothing evictable" branch and
    // the outer catch), which let a prune that fails every night leave a
    // stale ok:true entry standing forever with no ok:false anywhere to
    // count (found by the adversarial read, 18 Sep 2026). Each needs its own
    // notePrune({ ok: false, reason: ... }) call before it returns.
    // Counts calls, not the `void` keyword: the nothing-evictable exit chooses
    // between two calls in one expression, because arriving there with overflow
    // waiting means the chain is OVER its cap and the pass achieved nothing,
    // which must not be recorded as a healthy run.
    expect(store.match(/notePrune\(/g)?.length).toBe(7);
    expect(dash).toContain('maintenanceAttention(await readMaintenanceHealth())');
  });
});

// F68 (6 Oct 2026): a record whose six-hour time stamp stopped landing told only the service worker
// console, and only the first authority's answer. His own export ran eight days and 12,000 entries
// with no stamp while every page said the record was stamped every few hours. The stamp now leaves
// the same kind of entry as the rotation and the prune, keeps every authority's answer, and a day of
// refusals in a row (four ticks) becomes an attention item that names them.
describe('stamp health', () => {
  const refused = { status: 'skipped' as const, reason: 'tsa_freetsa_network_error', reasons: ['freetsa_network_error', 'digicert_http_503', 'sectigo_no_host_permission'], headPosition: 4775 };

  it('four refusals in a row raise stamp-stuck with every authority answer; a stamp that lands clears it', async () => {
    for (let i = 0; i < 3; i++) await noteStamp(refused, `2026-10-0${i + 3}T00:00:00Z`);
    expect(maintenanceAttention(await readMaintenanceHealth()), 'three ticks are not yet raised').toEqual([]);
    await noteStamp(refused, '2026-10-06T00:00:00Z');
    const h = await readMaintenanceHealth();
    expect(h.stamp?.ok).toBe(false);
    expect(h.stamp?.refusedInARow).toBe(4);
    expect(h.stamp?.reasons).toEqual(['freetsa_network_error', 'digicert_http_503', 'sectigo_no_host_permission']);
    expect(h.stamp?.headPosition).toBe(4775);
    expect(maintenanceAttention(h)).toEqual([{ id: 'stamp-stuck', reason: 'tsa_freetsa_network_error', reasons: ['freetsa_network_error', 'digicert_http_503', 'sectigo_no_host_permission'], attempts: 4 }]);
    await noteStamp({ status: 'anchored', anchoredChainPosition: 4800 }, '2026-10-06T06:00:00Z');
    const after = await readMaintenanceHealth();
    expect(after.stamp?.ok).toBe(true);
    expect(after.stamp?.refusedInARow).toBe(0);
    expect(after.stamp?.headPosition).toBe(4800);
    expect(maintenanceAttention(after)).toEqual([]);
  });

  it('a tick with nothing to stamp is healthy, not a refusal', async () => {
    for (let i = 0; i < 5; i++) await noteStamp({ status: 'skipped', reason: 'recent_anchor_covers_head', lastAnchoredPosition: 10 });
    expect((await readMaintenanceHealth()).stamp?.ok).toBe(true);
    for (let i = 0; i < 5; i++) await noteStamp({ status: 'skipped', reason: 'no_chained_records' });
    expect((await readMaintenanceHealth()).stamp?.ok).toBe(true);
    expect(maintenanceAttention(await readMaintenanceHealth())).toEqual([]);
  });

  it('a stamp call that threw is a refusal with its message, and a skip with one reason keeps that one', async () => {
    await noteStamp({ status: 'failed', reason: 'threw: injected' });
    const h = await readMaintenanceHealth();
    expect(h.stamp?.ok).toBe(false);
    expect(h.stamp?.reasons).toEqual(['threw: injected']);
    await noteStamp({ status: 'skipped', reason: 'chain_head_changed', headPosition: 7 });
    expect((await readMaintenanceHealth()).stamp?.reasons).toEqual(['chain_head_changed']);
  });

  it('keeps the rotation and the prune when the stamp is written', async () => {
    await noteRotation({ rotated: true, archivedMonth: '2026-09' });
    await notePrune({ ok: true });
    await noteStamp(refused);
    const h = store[MAINTENANCE_HEALTH_KEY] as { rotation?: unknown; prune?: unknown; stamp?: unknown };
    expect(h.rotation).toBeTruthy();
    expect(h.prune).toBeTruthy();
    expect(h.stamp).toBeTruthy();
  });
});
