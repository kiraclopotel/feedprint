// A fresh worker woken by the heartbeat alarm starts two ticks: one at module scope and one for the
// alarm. If both read the heartbeat state before either writes it, both see the same stale last
// tick and each signs a recorder-down gap for the same interval, so the record states one outage
// twice. The runner takes one tick at a time, and these cases hold that.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/forensics/gap-marker', () => ({
  appendGapMarker: vi.fn(async () => undefined),
}));
vi.mock('../../../src/forensics/store', () => ({
  getChainState: vi.fn(async () => ({ nextPosition: 5 })),
}));
vi.mock('../../../src/diagnostics/extraction-canary', () => ({
  readExtractionCanary: vi.fn(async () => ({ date: '2026-01-01', status: 'clear', warnings: {} })),
}));
vi.mock('../../../src/forensics/author-exclusions', () => ({
  peekExcludedSkipped: vi.fn(async () => 0),
  consumeExcludedSkipped: vi.fn(async () => undefined),
}));
// The planner runs for real; only the chain write is stubbed.
vi.mock('../../../src/forensics/heartbeat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/forensics/heartbeat')>()),
  appendHeartbeatMarker: vi.fn(async () => 5),
}));

import { runHeartbeat } from '../../../src/background/heartbeat';
import { appendGapMarker } from '../../../src/forensics/gap-marker';
import { appendHeartbeatMarker } from '../../../src/forensics/heartbeat';
import { installChromeStorageStub, type ChromeStorageStub } from '../../helpers/chrome-storage';

const HOUR = 60 * 60 * 1000;
let storage: ChromeStorageStub;

beforeEach(() => {
  vi.mocked(appendGapMarker).mockClear();
  vi.mocked(appendHeartbeatMarker).mockClear();
  // The last tick is two hours old: well past the gap threshold, so a tick that reads it writes a gap.
  storage = installChromeStorageStub({
    initial: { fw_heartbeat: { lastTickISO: new Date(Date.now() - 2 * HOUR).toISOString() } },
  });
});

afterEach(() => {
  storage.restore();
});

describe('the heartbeat runs one tick at a time', () => {
  it('a start tick and an alarm tick fired together write one recorder-down gap, not two', async () => {
    const [start, alarm] = await Promise.all([runHeartbeat('start'), runHeartbeat('alarm')]);

    expect(appendGapMarker).toHaveBeenCalledTimes(1);
    expect(start).toEqual({ status: 'ticked', wroteGap: true, wroteHeartbeat: false });
    // The alarm tick reads the state the start tick wrote, so it finds no gap and still signs its heartbeat.
    expect(alarm).toEqual({ status: 'ticked', wroteGap: false, wroteHeartbeat: true });
    expect(appendHeartbeatMarker).toHaveBeenCalledTimes(1);
  });

  it('a tick that fails does not stop the next one', async () => {
    const [first, second] = await Promise.all([runHeartbeat('start'), runHeartbeat('alarm')]);
    expect(first.status).toBe('ticked');
    expect(second.status).toBe('ticked');

    vi.mocked(appendGapMarker).mockRejectedValueOnce(new Error('chain write refused'));
    storage.state.fw_heartbeat = { lastTickISO: new Date(Date.now() - 2 * HOUR).toISOString() };
    const [failed, next] = await Promise.all([runHeartbeat('start'), runHeartbeat('start')]);

    expect(failed).toEqual({ status: 'failed', reason: 'chain write refused' });
    // The failed tick left the state unstamped, so the next one sees the same gap and writes it.
    expect(next).toEqual({ status: 'ticked', wroteGap: true, wroteHeartbeat: false });
  });
});
