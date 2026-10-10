// Evidence-gap register item 9 (2026-09-06): the chained heartbeat.
//
// "No records between 19:00 and 22:00" resolves to "nothing was served" or
// "the recorder was down" only if the recorder says so itself. The planner is
// pure; this file drives it through every branch and pins the hashed line,
// then locks the alarm and the worker-start call by source.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HEARTBEAT_GAP_FACTOR,
  HEARTBEAT_IDLE_WRITE_MS,
  HEARTBEAT_INTERVAL_MINUTES,
  heartbeatSummary,
  heartbeatText,
  planHeartbeatTick,
  type HeartbeatState,
  type HeartbeatTickFacts,
} from '../../../src/forensics/heartbeat';
import { SYSTEM_MARKER_KINDS } from '../../../src/forensics/system-records';

const T0 = Date.parse('2026-09-06T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const INTERVAL = HEARTBEAT_INTERVAL_MINUTES * 60 * 1000;

function facts(over: Partial<HeartbeatTickFacts> & { state?: HeartbeatState }): HeartbeatTickFacts {
  return {
    state: {},
    nowISO: iso(T0),
    nextPosition: 100,
    platformsOpen: [],
    canaryWarnings: {},
    trigger: 'alarm',
    skippedExcluded: 0,
    ...over,
  };
}

describe('planHeartbeatTick', () => {
  it('the first tick ever writes a heartbeat with an empty window and stamps everything (the marker is not counted as written since)', () => {
    const plan = planHeartbeatTick(facts({}));
    expect(plan.gap).toBeUndefined();
    expect(plan.heartbeat).toEqual({
      fromISO: iso(T0), toISO: iso(T0), platformsOpen: [], positionsSince: 0, canaryWarnings: {}, skippedExcluded: 0,
    });
    expect(plan.nextState).toEqual({
      lastTickISO: iso(T0), coveredToISO: iso(T0), lastWrittenISO: iso(T0), positionAtWrite: 101,
    });
  });

  it('an idle tick inside six hours writes nothing but stamps the tick', () => {
    const state: HeartbeatState = {
      lastTickISO: iso(T0 - INTERVAL), coveredToISO: iso(T0 - INTERVAL), lastWrittenISO: iso(T0 - INTERVAL), positionAtWrite: 100,
    };
    const plan = planHeartbeatTick(facts({ state }));
    expect(plan.gap).toBeUndefined();
    expect(plan.heartbeat).toBeUndefined();
    expect(plan.nextState).toEqual({ ...state, lastTickISO: iso(T0) });
  });

  it('a feed tab open, or positions advanced, or six idle hours, each write one', () => {
    const base: HeartbeatState = {
      lastTickISO: iso(T0 - INTERVAL), coveredToISO: iso(T0 - 3 * INTERVAL), lastWrittenISO: iso(T0 - 3 * INTERVAL), positionAtWrite: 100,
    };
    const open = planHeartbeatTick(facts({ state: base, platformsOpen: ['youtube'] }));
    expect(open.heartbeat).toMatchObject({ fromISO: iso(T0 - 3 * INTERVAL), toISO: iso(T0), platformsOpen: ['youtube'], positionsSince: 0 });
    const advanced = planHeartbeatTick(facts({ state: base, nextPosition: 137 }));
    expect(advanced.heartbeat).toMatchObject({ positionsSince: 37 });
    expect(advanced.nextState.positionAtWrite).toBe(138);
    const idle = planHeartbeatTick(facts({ state: { ...base, lastWrittenISO: iso(T0 - HEARTBEAT_IDLE_WRITE_MS) } }));
    expect(idle.heartbeat).toBeDefined();
    const unreadableTabs = planHeartbeatTick(facts({ state: base, platformsOpen: null }));
    expect(unreadableTabs.heartbeat).toMatchObject({ platformsOpen: null });
  });

  it('a stale last tick writes a recorder-down gap from that tick to now, then the coverage resumes at now', () => {
    const stale = iso(T0 - (HEARTBEAT_GAP_FACTOR * INTERVAL + 1000));
    const state: HeartbeatState = { lastTickISO: stale, coveredToISO: stale, lastWrittenISO: stale, positionAtWrite: 100 };
    const plan = planHeartbeatTick(facts({ state, platformsOpen: ['twitter'], nextPosition: 103 }));
    expect(plan.gap).toEqual({
      reason: 'recorder-down', platform: 'unknown', count: 0, unit: 'records', fromISO: stale, toISO: iso(T0),
    });
    expect(plan.heartbeat).toMatchObject({ fromISO: iso(T0), toISO: iso(T0), positionsSince: 3 });
    expect(plan.nextState.coveredToISO).toBe(iso(T0));
  });

  it('exactly two intervals late is not yet a gap', () => {
    const last = iso(T0 - HEARTBEAT_GAP_FACTOR * INTERVAL);
    const plan = planHeartbeatTick(facts({ state: { lastTickISO: last, lastWrittenISO: last, coveredToISO: last, positionAtWrite: 100 } }));
    expect(plan.gap).toBeUndefined();
  });

  it('a worker start writes the gap when due and never a heartbeat', () => {
    const stale = iso(T0 - 5 * INTERVAL);
    const state: HeartbeatState = { lastTickISO: stale, coveredToISO: stale, lastWrittenISO: stale, positionAtWrite: 100 };
    const plan = planHeartbeatTick(facts({ state, trigger: 'start', platformsOpen: ['tiktok'], nextPosition: 500 }));
    expect(plan.gap).toBeDefined();
    expect(plan.heartbeat).toBeUndefined();
    expect(plan.nextState).toEqual({ ...state, lastTickISO: iso(T0), coveredToISO: iso(T0) });
    const fresh = planHeartbeatTick(facts({ state: { ...state, lastTickISO: iso(T0 - INTERVAL) }, trigger: 'start' }));
    expect(fresh.gap).toBeUndefined();
    expect(fresh.heartbeat).toBeUndefined();
  });

  it('a chain that restarted inside the window says so instead of a negative count', () => {
    const state: HeartbeatState = { lastTickISO: iso(T0 - INTERVAL), coveredToISO: iso(T0 - INTERVAL), lastWrittenISO: iso(T0 - INTERVAL), positionAtWrite: 9000 };
    const plan = planHeartbeatTick(facts({ state, nextPosition: 4 }));
    expect(plan.heartbeat).toMatchObject({ positionsSince: null });
    expect(plan.nextState.positionAtWrite).toBe(5);
  });
});

describe('heartbeat text', () => {
  const input = {
    fromISO: '2026-09-06T11:45:00.000Z',
    toISO: '2026-09-06T12:00:00.000Z',
    platformsOpen: ['youtube', 'twitter'],
    positionsSince: 37,
    canaryWarnings: { twitter: 'author-drift' },
    skippedExcluded: 0,
  };
  it('the hashed line names the window, the feeds sorted, the positions and the canary', () => {
    expect(heartbeatText(input, '2026-09-06T12:00:01.000Z', false)).toBe(
      '[heartbeat-marker @ 2026-09-06T12:00:01.000Z] from=2026-09-06T11:45:00.000Z to=2026-09-06T12:00:00.000Z'
      + ' feedsOpen=twitter,youtube positionsSince=37 canary=twitter:author-drift excludedSkipped=0',
    );
    expect(heartbeatText({ ...input, platformsOpen: null, positionsSince: null, canaryWarnings: {} }, 't', true)).toBe(
      '[heartbeat-marker @ t] from=2026-09-06T11:45:00.000Z to=2026-09-06T12:00:00.000Z'
      + ' feedsOpen=unreadable positionsSince=chain-restarted canary=none excludedSkipped=0 settings-read-failed',
    );
    expect(heartbeatText({ ...input, platformsOpen: [] }, 't', false)).toContain(' feedsOpen=none ');
  });

  it('the reader line', () => {
    expect(heartbeatSummary(input)).toBe(
      'heartbeat: recorder alive 2026-09-06T11:45:00.000Z to 2026-09-06T12:00:00.000Z; 2 feeds open; 37 positions since the last; canary: twitter',
    );
    expect(heartbeatSummary({ ...input, platformsOpen: [], positionsSince: 0, canaryWarnings: {} })).toContain('; no feed open; 0 positions since the last; canary clear');
  });

  it('is a system marker', () => {
    expect(SYSTEM_MARKER_KINDS.has('heartbeat-marker')).toBe(true);
  });
});

describe('wiring (source lock)', () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

  it('the worker registers the alarm at the interval, handles it, and stamps a tick on start', () => {
    const sw = read('src/background/service-worker.ts');
    expect(sw).toContain("{ name: 'forensic-heartbeat', opts: { periodInMinutes: HEARTBEAT_INTERVAL_MINUTES } }");
    expect(sw).toContain("if (alarm.name === 'forensic-heartbeat')");
    expect(sw).toContain("runHeartbeat('alarm')");
    // Not anchored to the start of a line any more. Since 2026-09-18 the start
    // tick runs inside the chain height check's continuation, because the
    // heartbeat writes a record and a check running after it reads a destroyed
    // record as a chain of one instead of a chain of none
    // (forensics/chain-height-witness.ts). The tick still happens on every
    // fresh realm, which is what this lock is for.
    expect(sw).toMatch(/void runHeartbeat\('start'\);/);
    // Renamed 2026-09-19 to checkChainHeightOnRealmStart: the shallow read still
    // runs on every realm and only the archive half is throttled, so what this
    // lock is about, the tick happening inside the check's continuation, holds
    // unchanged.
    expect(sw).toMatch(/void checkChainHeightOnRealmStart\(\)\.then\(\(\) => \{[\s\S]{0,900}runHeartbeat\('start'\);/);
  });

  it('the writer takes the shared chain-write lock and puts the details in the hashed text', () => {
    const src = read('src/forensics/heartbeat.ts');
    const block = src.slice(src.indexOf('export function appendHeartbeatMarker'));
    expect(block).toContain('sharedChainWriteLock(');
    expect(block).toContain('getChainState()');
    expect(block).toContain('originalText: text');
    expect(block).toContain("kind: 'heartbeat-marker'");
    expect(block).toContain('getSettingsForAttestation()');
    expect(block).toContain('await addRecord(');
    // The position the record took is returned, so the runner counts the next
    // window from the slot after this record instead of from an estimate made
    // before the write.
    expect(block).toContain('return nextPosition;');
  });

  it('the runner counts from the position the record actually took, not the planned one', () => {
    const hb = read('src/background/heartbeat.ts');
    expect(hb).toContain('const writtenAt = await appendHeartbeatMarker(plan.heartbeat);');
    expect(hb).toContain('plan.nextState.positionAtWrite = writtenAt + 1;');
    // A gap marker written in the same tick takes the slot the plan assumed.
    expect(hb.indexOf('appendGapMarker(plan.gap)')).toBeLessThan(hb.indexOf('const writtenAt ='));
  });
});

// AN EMPTY CANARY MEANT FOUR THINGS AND PRINTED AS ONE. readExtractionCanary
// returned the same empty snapshot for: no warnings today, the store
// unreadable, no store at all, and a snapshot from a previous UTC day. The
// heartbeat turned every one of them into the signed claim "canary clear".
//
// The stale case is the dangerous one. A platform that warns at 22:05 is not
// re-persisted once it has warned, so from 00:00 UTC the day key no longer
// matches and every fifteen-minute heartbeat signed "canary clear" while the
// recorder was provably blind there. For a reader in California that midnight
// is 17:00 — the middle of a session.
describe('heartbeat — what an empty canary is allowed to claim', () => {
  const base = {
    fromISO: '2026-09-08T00:00:00.000Z',
    toISO: '2026-09-08T00:15:00.000Z',
    platformsOpen: ['tiktok'],
    positionsSince: 12,
    canaryWarnings: {},
    skippedExcluded: 0,
  };

  it('says clear only when the canary was read and was clear', () => {
    const line = heartbeatSummary({ ...base, canaryStatus: 'clear' });
    expect(line).toContain('canary clear');
    expect(heartbeatText({ ...base, canaryStatus: 'clear' }, base.toISO, false)).toContain('canary=none');
  });

  it('says the canary could not be read when the store threw or was absent', () => {
    const line = heartbeatSummary({ ...base, canaryStatus: 'unreadable' });
    expect(line).toContain('canary could not be read');
    expect(line).not.toContain('canary clear');
    expect(heartbeatText({ ...base, canaryStatus: 'unreadable' }, base.toISO, false)).toContain('canary=unreadable');
  });

  it('says the canary is silent about today when the snapshot has rolled over', () => {
    const line = heartbeatSummary({ ...base, canaryStatus: 'stale' });
    expect(line).toContain('canary says nothing about today');
    expect(line).not.toContain('canary clear');
    expect(heartbeatText({ ...base, canaryStatus: 'stale' }, base.toISO, false)).toContain('canary=stale');
  });

  // A named warning always wins, and a record written before the field existed
  // reads as clear, which is what it meant when it was written.
  it('a named warning is printed, and a legacy record still reads clear', () => {
    expect(heartbeatSummary({ ...base, canaryWarnings: { tiktok: 'cold-start' }, canaryStatus: 'warned' }))
      .toContain('canary: tiktok');
    expect(heartbeatSummary(base)).toContain('canary clear');
  });
});
