/**
 * Turn 89 — the install remembers which builds it has run.
 *
 * Without this, a Copy Diagnostics payload cannot say whether its numbers came
 * from the code the reader is holding. See build-history.ts for the failure.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getBuildHistory, noteBuildRun } from '../../../src/storage/build-history';

let store: Record<string, unknown> = {};

beforeEach(() => {
  store = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (k: string) => ({ [k]: store[k] }),
        set: async (o: Record<string, unknown>) => { Object.assign(store, o); },
      },
    },
  });
});

describe('build history', () => {
  it('records a first run', async () => {
    await noteBuildRun('fwbid-a', '1.6.0', '2026-08-02T06:05:00.000Z');
    const runs = await getBuildHistory();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ buildId: 'fwbid-a', version: '1.6.0', boots: 1 });
  });

  it('re-booting the SAME build updates lastSeen and never adds a row', async () => {
    await noteBuildRun('fwbid-a', '1.6.0', '2026-08-02T06:05:00.000Z');
    await noteBuildRun('fwbid-a', '1.6.0', '2026-08-02T07:00:00.000Z');
    await noteBuildRun('fwbid-a', '1.6.0', '2026-08-02T08:00:00.000Z');
    const runs = await getBuildHistory();
    expect(runs).toHaveLength(1);
    expect(runs[0].firstSeen).toBe('2026-08-02T06:05:00.000Z');
    expect(runs[0].lastSeen).toBe('2026-08-02T08:00:00.000Z');
    expect(runs[0].boots).toBe(3);
  });

  it('a new build adds a row and sorts newest first', async () => {
    await noteBuildRun('fwbid-old', '1.5.0', '2026-07-14T09:00:00.000Z');
    await noteBuildRun('fwbid-new', '1.6.0', '2026-08-02T06:05:00.000Z');
    const runs = await getBuildHistory();
    expect(runs.map(r => r.buildId)).toEqual(['fwbid-new', 'fwbid-old']);
  });

  it('records nothing when there is no baked build id (vitest/node)', async () => {
    await noteBuildRun('', '1.6.0', '2026-08-02T06:05:00.000Z');
    expect(await getBuildHistory()).toEqual([]);
  });

  it('keeps the tail bounded', async () => {
    for (let i = 0; i < 30; i++) {
      await noteBuildRun(`fwbid-${i}`, '1.6.0', `2026-08-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`);
    }
    expect((await getBuildHistory()).length).toBe(20);
  });

  it('survives a storage failure without throwing — boot must never depend on it', async () => {
    vi.stubGlobal('chrome', {
      storage: { local: { get: async () => { throw new Error('nope'); }, set: async () => { throw new Error('nope'); } } },
    });
    await expect(noteBuildRun('fwbid-a', '1.6.0', '2026-08-02T06:05:00.000Z')).resolves.toBeDefined();
    await expect(getBuildHistory()).resolves.toEqual([]);
  });
});
