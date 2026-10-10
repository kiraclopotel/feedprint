// FeelingWise - the chained heartbeat (evidence-gap register item 9, 2026-09-06).
//
// "No records between 19:00 and 22:00" used to be unanswerable: nothing was
// served, or the recorder was down. The heartbeat makes it a positive
// statement. On a 15-minute alarm the worker stamps a tick in storage and,
// when there is something to say, writes one signed record: the window it
// covers, which feeds had a tab open at the tick, how many chain positions
// were written since the previous heartbeat, and the extraction canary's
// warnings. When a tick finds the previous tick older than two intervals it
// writes a gap marker (reason recorder-down) from that tick to now, so "the
// extension was disabled from T1 to T2" is on the chain under the install's
// own signature, at the first opportunity the recorder had to say so.
//
// What a heartbeat proves and what it does not. A tick proves the worker was
// alive at that instant. A written heartbeat covers a window of ticks; every
// tick inside it was stamped, and a stale tick would have produced a gap
// marker instead, so the window is contiguous. It says nothing about a tab's
// content script: a feed tab can be open with the recorder's content script
// broken, and the canary field is the only witness to that.
//
// Volume. A heartbeat is written when a feed tab is open, when positions
// advanced, or when six hours passed since the last one; otherwise the tick
// stays in storage. Worst case is 96 records a day while a feed is open all
// day, against a 10,000-record active cap that rotates monthly; an idle
// install writes four a day. The cap is not widened. Every aggregation
// excludes the kind (system-records.ts).
//
// The planner is pure so the tests can drive it; src/background/heartbeat.ts
// does the reading and writing.

import type { ForensicRecord } from '../types/forensic';
import type { GapMarkerInput } from '../types/gap-marker';
import { sha256 } from './hasher';
import { finalizeRecord } from './record-stamp';
import { getPublicKeyFingerprint } from './signing';
import { addRecord, getChainState } from './store';
import { getSettingsForAttestation } from '../storage/settings';
import { sharedChainWriteLock } from './chain-write-lock';
import { levelOf } from '../types/mode';

export const HEARTBEAT_INTERVAL_MINUTES = 15;
/** A tick this many intervals after the last one means the recorder was down. */
export const HEARTBEAT_GAP_FACTOR = 2;
/** An idle install still writes a heartbeat this often. */
export const HEARTBEAT_IDLE_WRITE_MS = 6 * 60 * 60 * 1000;

export interface HeartbeatState {
  /** The last instant the worker stamped, written or not. */
  lastTickISO?: string;
  /** Where the chain's coverage (heartbeat or gap) currently ends. */
  coveredToISO?: string;
  /** When the last heartbeat record was written. */
  lastWrittenISO?: string;
  /** getChainState().nextPosition when the last heartbeat was written. */
  positionAtWrite?: number;
}

export interface HeartbeatInput {
  fromISO: string;
  toISO: string;
  /** Platforms with at least one tab open at the tick, or null when tabs could not be read. */
  platformsOpen: string[] | null;
  /** Chain positions advanced since the previous heartbeat; null when the chain restarted (rotation) inside the window. */
  positionsSince: number | null;
  /** platform -> canary warning kind, for today. */
  canaryWarnings: Record<string, string>;
  /**
   * Why that map is empty, when it is. 'clear' is the only value that earns the
   * words "canary clear" on a signed record: an unreadable store and a snapshot
   * from a previous UTC day are both silence, not health, and were being signed
   * as health. Absent on records written before this field, read as 'clear'
   * because that is what they meant.
   */
  canaryStatus?: 'clear' | 'warned' | 'unreadable' | 'stale';
  /** Records withheld at capture because their account is on the parent's skip list, since the last heartbeat. Nobody is named. */
  skippedExcluded: number;
}

export interface HeartbeatTickFacts {
  state: HeartbeatState;
  nowISO: string;
  nextPosition: number;
  platformsOpen: string[] | null;
  canaryWarnings: Record<string, string>;
  /** Why that map is empty, when it is. See HeartbeatInput.canaryStatus. */
  canaryStatus?: 'clear' | 'warned' | 'unreadable' | 'stale';
  trigger: 'alarm' | 'start';
  skippedExcluded: number;
}

export interface HeartbeatPlan {
  gap?: GapMarkerInput;
  heartbeat?: HeartbeatInput;
  nextState: HeartbeatState;
}

/** Decide what this tick writes. Pure. */
export function planHeartbeatTick(facts: HeartbeatTickFacts): HeartbeatPlan {
  const { state, nowISO, nextPosition, platformsOpen, canaryWarnings, canaryStatus, trigger, skippedExcluded } = facts;
  const now = Date.parse(nowISO);
  const intervalMs = HEARTBEAT_INTERVAL_MINUTES * 60 * 1000;
  const nextState: HeartbeatState = { ...state, lastTickISO: nowISO };
  const plan: HeartbeatPlan = { nextState };

  const lastTick = state.lastTickISO ? Date.parse(state.lastTickISO) : NaN;
  if (Number.isFinite(lastTick) && now - lastTick > HEARTBEAT_GAP_FACTOR * intervalMs) {
    plan.gap = {
      reason: 'recorder-down',
      platform: 'unknown',
      count: 0,
      unit: 'records',
      fromISO: state.lastTickISO as string,
      toISO: nowISO,
    };
    nextState.coveredToISO = nowISO;
  }

  if (trigger !== 'alarm') return plan;

  const positionsSince = state.positionAtWrite === undefined
    ? 0
    : nextPosition >= state.positionAtWrite ? nextPosition - state.positionAtWrite : null;
  const lastWritten = state.lastWrittenISO ? Date.parse(state.lastWrittenISO) : NaN;
  const idleDue = !Number.isFinite(lastWritten) || now - lastWritten >= HEARTBEAT_IDLE_WRITE_MS;
  const feedOpen = platformsOpen === null || platformsOpen.length > 0;
  const shouldWrite = feedOpen || positionsSince === null || positionsSince > 0 || idleDue || skippedExcluded > 0;
  if (!shouldWrite) return plan;

  plan.heartbeat = {
    fromISO: nextState.coveredToISO ?? state.coveredToISO ?? nowISO,
    toISO: nowISO,
    platformsOpen,
    positionsSince,
    canaryWarnings,
    canaryStatus,
    skippedExcluded,
  };
  nextState.coveredToISO = nowISO;
  nextState.lastWrittenISO = nowISO;
  // The heartbeat itself takes `nextPosition`; counting from the slot after
  // it keeps a quiet night at zero instead of one per tick (owner's export,
  // 2026-09-06: forty-five heartbeats reading "positionsSince=1").
  nextState.positionAtWrite = nextPosition + 1;
  return plan;
}

/**
 * What an empty warnings map means. It used to mean four things and print as
 * one: no warnings today, the store unreadable, no store at all, and a snapshot
 * from a previous UTC day. Only the first is health. A recorder blind on a
 * platform since 22:05 went on signing "canary clear" from 00:00 UTC, because
 * the day key rolled and a warned adapter is not re-persisted after it warns.
 */
function canaryEmptyWord(status: HeartbeatInput['canaryStatus']): string {
  if (status === 'unreadable') return 'unreadable';
  if (status === 'stale') return 'stale';
  return 'none';
}

/** The same distinction in the reader's words. */
function canaryPhrase(input: HeartbeatInput): string {
  const named = Object.keys(input.canaryWarnings).sort();
  if (named.length > 0) return `canary: ${named.join(', ')}`;
  if (input.canaryStatus === 'unreadable') return 'canary could not be read';
  if (input.canaryStatus === 'stale') return 'canary says nothing about today';
  return 'canary clear';
}

/** The hashed line. */
export function heartbeatText(input: HeartbeatInput, markerTimestamp: string, readFailed: boolean): string {
  const feeds = input.platformsOpen === null
    ? 'unreadable'
    : input.platformsOpen.length === 0 ? 'none' : [...input.platformsOpen].sort().join(',');
  const canary = Object.keys(input.canaryWarnings).length > 0
    ? Object.entries(input.canaryWarnings).sort(([a], [b]) => a.localeCompare(b)).map(([p, k]) => `${p}:${k}`).join(',')
    : canaryEmptyWord(input.canaryStatus);
  return `[heartbeat-marker @ ${markerTimestamp}] from=${input.fromISO} to=${input.toISO}`
    + ` feedsOpen=${feeds} positionsSince=${input.positionsSince === null ? 'chain-restarted' : input.positionsSince}`
    + ` canary=${canary}`
    + ` excludedSkipped=${input.skippedExcluded}`
    + (readFailed ? ' settings-read-failed' : '');
}

/** The reader's line, carried in resetReason like the other markers. */
export function heartbeatSummary(input: HeartbeatInput): string {
  const feeds = input.platformsOpen === null
    ? 'open feeds unreadable'
    : input.platformsOpen.length === 0 ? 'no feed open' : `${input.platformsOpen.length} feed${input.platformsOpen.length === 1 ? '' : 's'} open`;
  const positions = input.positionsSince === null ? 'chain restarted'
    : `${input.positionsSince} position${input.positionsSince === 1 ? '' : 's'} since the last`;
  const canary = canaryPhrase(input);
  const skipped = input.skippedExcluded > 0 ? `; ${input.skippedExcluded} withheld at capture (skip list)` : '';
  return `heartbeat: recorder alive ${input.fromISO} to ${input.toISO}; ${feeds}; ${positions}; ${canary}${skipped}`;
}

/**
 * Append one signed heartbeat to the LIVE chain, on the shared chain-write
 * lock. Returns the chain position it actually took, so the runner counts the
 * next window from the slot after this record rather than from an estimate
 * made before the write (a gap marker written in the same tick takes the slot
 * the plan assumed, and the next heartbeat then reported one position too
 * many - the same off-by-one his export caught on 2026-09-06, one tick over).
 */
export function appendHeartbeatMarker(input: HeartbeatInput): Promise<number> {
  return sharedChainWriteLock(async () => {
    const { nextPosition, prevRecordHash } = await getChainState();
    const attestation = await getSettingsForAttestation();
    const markerTimestamp = new Date().toISOString();
    const text = heartbeatText(input, markerTimestamp, attestation.readFailed);
    const partial: Omit<ForensicRecord, 'integrityHash' | 'signature'> = {
      id: `fr-heartbeat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: markerTimestamp,
      // Storage slot only; the feeds are named in the hashed text (same
      // convention as the prune and gap markers).
      platform: 'twitter',
      originalText: text,
      originalHash: await sha256(text),
      originalLength: text.length,
      neutralizedText: '',
      author: '',
      postUrl: '',
      techniques: [],
      overallScore: 0,
      userAgeCategory: levelOf(attestation.mode),
      aiSource: 'none',
      feedSource: 'unknown',
      detectionMode: 'heartbeat-marker',
      prevRecordHash,
      chainPosition: nextPosition,
      chainAnchor: 'heartbeat',
      verdict: 'pass',
      kind: 'heartbeat-marker',
      resetReason: heartbeatSummary(input),
      publicKeyFingerprint: await getPublicKeyFingerprint(),
    };
    await addRecord(await finalizeRecord(partial));
    return nextPosition;
  });
}
