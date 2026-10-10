// FeelingWise - the signed repair marker (evidence-gap register item 18, 2026-09-06).
//
// auto-heal.ts repairRelegatedPositions takes records whose chainPosition an
// earlier re-anchor stripped, solves for the position whose canonical hash
// equals the stored integrityHash, and writes that position back. The repair
// restored hash-consistent content and re-signed nothing, and it told only a
// 20-entry local log. A repair the file discloses is maintenance; a repair the
// file conceals reads as alteration. This marker puts each heal-log event on
// the live chain once, under the install's own signature, with the counts and
// the method inside the hashed text; the export prints the heal log beside it.
// No canonical field changed.
//
// Disclosure is idempotent: discloseRepairsOnChain keeps the set of event
// times already on the chain in chrome.storage.local and sends one
// REPAIR_MARKER per event not in it, from the dashboard realm through the
// worker, so a repair that ran before this existed is disclosed at the next
// dashboard load with its own time and the disclosure time both stated.

import type { ForensicRecord } from '../types/forensic';
import type { RepairMarkerInput } from '../types/repair-marker';
import { sha256 } from './hasher';
import { finalizeRecord } from './record-stamp';
import { getPublicKeyFingerprint } from './signing';
import { addRecord, getChainState } from './store';
import { getSettingsForAttestation } from '../storage/settings';
import { sharedChainWriteLock } from './chain-write-lock';
import { readHealLog, type HealEvent } from './auto-heal';
import { levelOf } from '../types/mode';

export const REPAIR_DISCLOSED_KEY = 'fw_repair_disclosed';

/** Shape check at the realm boundary: a dashboard message is input. */
export function isRepairMarkerInput(x: unknown): x is RepairMarkerInput {
  if (!x || typeof x !== 'object') return false;
  const m = x as Record<string, unknown>;
  const count = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= 0;
  return typeof m.at === 'string' && Number.isFinite(Date.parse(m.at))
    && (m.method === 'position-solve' || m.method === 'reanchor')
    && count(m.repairedCount) && count(m.unrepairedCount)
    && typeof m.healed === 'boolean'
    && (m.error === undefined || typeof m.error === 'string');
}

/** A heal-log event as a marker input, or null for an event that says nothing worth signing. */
export function repairInputFromHealEvent(e: HealEvent): RepairMarkerInput | null {
  if (e.kind === 'position-repair') {
    return {
      at: e.at,
      method: 'position-solve',
      repairedCount: e.repairedCount ?? 0,
      unrepairedCount: e.unrepairedCount ?? 0,
      healed: e.healed,
      ...(e.error ? { error: e.error } : {}),
    };
  }
  if (e.kind === 'reanchor') {
    return { at: e.at, method: 'reanchor', repairedCount: e.reAnchoredCount ?? 0, unrepairedCount: 0, healed: e.healed, ...(e.error ? { error: e.error } : {}) };
  }
  return null;
}

/** The hashed line. */
export function repairMarkerText(input: RepairMarkerInput, markerTimestamp: string, readFailed: boolean): string {
  return `[repair-marker @ ${markerTimestamp}] ran=${input.at} method=${input.method}`
    + ` repaired=${input.repairedCount} unrepaired=${input.unrepairedCount} healed=${input.healed ? 'yes' : 'no'}`
    + (input.error ? ` error=${input.error.replace(/\s+/g, ' ').slice(0, 200)}` : '')
    + (readFailed ? ' settings-read-failed' : '');
}

/** The reader's line, carried in resetReason like the other markers. */
export function repairMarkerSummary(input: RepairMarkerInput): string {
  const what = input.method === 'position-solve'
    ? `${input.repairedCount} records regained the chain position their stored hash names, ${input.unrepairedCount} could not`
    : `${input.repairedCount} records set aside by a re-anchor`;
  return `repair on ${input.at}: ${what}${input.healed ? '' : '; the run failed'}`;
}

/** Append one signed repair marker to the LIVE chain, on the shared chain-write lock. */
export function appendRepairMarker(input: RepairMarkerInput): Promise<void> {
  return sharedChainWriteLock(async () => {
    const { nextPosition, prevRecordHash } = await getChainState();
    const attestation = await getSettingsForAttestation();
    const markerTimestamp = new Date().toISOString();
    const text = repairMarkerText(input, markerTimestamp, attestation.readFailed);
    const partial: Omit<ForensicRecord, 'integrityHash' | 'signature'> = {
      id: `fr-repair-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: markerTimestamp,
      // Storage slot only, the prune marker's convention.
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
      aiSource: 'local',
      feedSource: 'unknown',
      detectionMode: 'repair-marker',
      prevRecordHash,
      chainPosition: nextPosition,
      chainAnchor: 'repair',
      verdict: 'pass',
      kind: 'repair-marker',
      resetReason: repairMarkerSummary(input),
      publicKeyFingerprint: await getPublicKeyFingerprint(),
    };
    await addRecord(await finalizeRecord(partial));
  });
}

export interface DisclosureOutcome { sent: number; alreadyDisclosed: number; failed: number }

/**
 * Dashboard realm: put every heal-log event not yet on the chain there, one
 * REPAIR_MARKER each through the worker. An event is remembered as disclosed
 * only on the worker's ok. Best-effort; never throws.
 */
export async function discloseRepairsOnChain(
  send: (message: unknown) => Promise<unknown> = (m) => chrome.runtime.sendMessage(m),
): Promise<DisclosureOutcome> {
  const outcome: DisclosureOutcome = { sent: 0, alreadyDisclosed: 0, failed: 0 };
  try {
    const log = await readHealLog();
    if (log.length === 0) return outcome;
    const stored = await chrome.storage.local.get(REPAIR_DISCLOSED_KEY);
    const raw = stored[REPAIR_DISCLOSED_KEY];
    const disclosed = new Set<string>(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []);
    // Oldest first, so the chain reads in the order the repairs ran.
    for (const event of [...log].reverse()) {
      const input = repairInputFromHealEvent(event);
      if (!input) continue;
      if (disclosed.has(input.at)) { outcome.alreadyDisclosed++; continue; }
      let ok = false;
      try {
        const resp = await send({ type: 'REPAIR_MARKER', payload: input });
        ok = !!resp && typeof resp === 'object' && (resp as { ok?: boolean }).ok === true;
      } catch {
        ok = false;
      }
      if (!ok) { outcome.failed++; continue; }
      disclosed.add(input.at);
      outcome.sent++;
      await chrome.storage.local.set({ [REPAIR_DISCLOSED_KEY]: [...disclosed] });
    }
  } catch (err) {
    console.warn('[FeelingWise] repair disclosure did not complete:', err);
  }
  return outcome;
}
