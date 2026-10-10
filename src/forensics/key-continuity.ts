// A signing key that changes under a surviving chain says so on that chain.
//
// The key lives in chrome.storage and the chain in IndexedDB, so one can go without the other:
// the browser clears the key and the next write makes a new one, or a backup brings another key
// back. Records on either side are then signed by different keys, and without a statement the
// file cannot tell the install's own key change from a second recorder spliced in. The marker is
// written before any other record is signed with the new key, which is why the worker runs this
// first on every start and the restore runs it right after it swaps the key.
//
// A note goes into storage before the marker and comes out after it. If the marker write fails,
// later records are signed with the new key and the chain's newest record no longer shows the
// change, so the note is what lets the next start write the marker it owes. A worker that dies
// between the marker and clearing the note writes the statement twice; both are true.

import type { KeyReplacedOrigin } from '../types/gap-marker';
import { sharedChainWriteLock } from './chain-write-lock';
import { appendGapMarkerUnderChainLock } from './gap-marker';
import { getPublicKeyFingerprint, getSigningKeyOrigins } from './signing';
import { getChainState } from './store';

const PENDING_KEY = 'fw_key_change_unstated';

interface PendingKeyChange { previous: string; next: string; origin: KeyReplacedOrigin }

export type KeyContinuityOutcome =
  | { status: 'no-chain' }
  /** The newest record names no key (written before records did), so nothing can be compared. */
  | { status: 'tip-unnamed' }
  | { status: 'same-key' }
  | { status: 'stated'; previous: string; next: string; origin: KeyReplacedOrigin }
  | { status: 'failed'; reason: string };

async function originOf(fingerprint: string): Promise<KeyReplacedOrigin> {
  const origins = await getSigningKeyOrigins();
  for (let i = origins.length - 1; i >= 0; i--) {
    if (origins[i].fingerprint === fingerprint) return origins[i].origin;
  }
  return 'unknown';
}

async function readPending(): Promise<PendingKeyChange | null> {
  const raw = await chrome.storage.local.get(PENDING_KEY);
  const p = raw[PENDING_KEY] as PendingKeyChange | undefined;
  return p && typeof p.previous === 'string' && typeof p.next === 'string' ? p : null;
}

async function stateChange(change: PendingKeyChange): Promise<KeyContinuityOutcome> {
  await chrome.storage.local.set({ [PENDING_KEY]: change });
  const at = new Date().toISOString();
  await appendGapMarkerUnderChainLock({
    reason: 'key-replaced',
    platform: 'unknown',
    count: 0,
    unit: 'records',
    fromISO: at,
    toISO: at,
    key: change,
  });
  await chrome.storage.local.remove(PENDING_KEY);
  return { status: 'stated', ...change };
}

/**
 * Compare the key that signed the chain's newest record with the key in use, and when they
 * differ put a key-replaced marker on the chain. Idempotent: once the marker is written, the
 * newest record carries the new key and the note is gone.
 *
 * Asks for the key only when a chain exists, because asking makes one when storage is empty and
 * an install that has never recorded anything must not get an identity from a start-up check.
 * When a chain exists, the next record would make that key anyway.
 */
export function stateKeyReplacement(origin?: KeyReplacedOrigin): Promise<KeyContinuityOutcome> {
  return sharedChainWriteLock(() => stateKeyReplacementUnderChainLock(origin));
}

/** The same, for a caller that already holds the shared chain-write lock (the restore). */
export async function stateKeyReplacementUnderChainLock(origin?: KeyReplacedOrigin): Promise<KeyContinuityOutcome> {
  try {
    const { nextPosition, tipFingerprint } = await getChainState();
    if (nextPosition === 0) return { status: 'no-chain' };
    if (!tipFingerprint) return { status: 'tip-unnamed' };
    const next = await getPublicKeyFingerprint();
    const pending = await readPending();
    if (next === tipFingerprint) {
      // A marker owed from a write that failed: the records since carry the new key, so the
      // newest record no longer shows the change, but the note does.
      if (pending && pending.next === next) return await stateChange(pending);
      // A note about a key no longer in use describes nothing this chain still owes.
      if (pending) await chrome.storage.local.remove(PENDING_KEY);
      return { status: 'same-key' };
    }
    return await stateChange({ previous: tipFingerprint, next, origin: origin ?? await originOf(next) });
  } catch (err) {
    return { status: 'failed', reason: err instanceof Error ? err.message : String(err) };
  }
}
