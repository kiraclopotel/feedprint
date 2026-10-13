// Feedprint fetches the repair file (11 Oct 2026).
//
// Every few hours the background worker asks our relay for the current repair file and keeps it if it verifies and is
// newer (src/core/repairs/store.ts). The request carries nothing: a plain GET with no cookies, no referrer, no key and no
// identifier, and the answer is the same for everyone. It follows the same rule as every other outside call: a Strict
// install, or one whose level nobody has chosen yet, asks no one (types/reading-gate.ts). A failed request, a file that
// does not verify and a file that is not newer change nothing; the last good file stays in force.
//
// Off never runs this. Off has no worker and no network, by a build gate, and gets its repairs in its store updates.

import { getSettings } from '../storage/settings';
import { mayCallOutNow } from '../ai/gate-with-agreement';
import { acceptFetchedRepairs, REPAIRS_STATUS_KEY } from '../core/repairs/store';

export const REPAIRS_URL = 'https://api.feelingwise.org/v1/repairs';
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 80_000;
/** Ask again no sooner than this after an answer, and no sooner than this after a failure. */
const ASK_EVERY_MS = 6 * 60 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 60 * 60 * 1000;

export type RepairsSyncResult = 'stored' | 'older' | 'invalid' | 'offline' | 'not-allowed';

async function writeStatus(result: RepairsSyncResult): Promise<void> {
  try {
    await chrome.storage.local.set({ [REPAIRS_STATUS_KEY]: { checkedAt: new Date().toISOString(), result } });
  } catch {
    // The status is a courtesy for the Issues tab; losing it changes nothing.
  }
}

/** Ask the relay for the repair file once. Never throws. */
export async function syncRepairs(fetchImpl: typeof fetch = fetch): Promise<RepairsSyncResult> {
  let result: RepairsSyncResult;
  try {
    const settings = await getSettings();
    if (!(await mayCallOutNow(settings))) {
      result = 'not-allowed';
    } else {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const response = await fetchImpl(REPAIRS_URL, {
          method: 'GET', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal,
        });
        const length = Number(response.headers.get('content-length') ?? 0);
        if (response.status === 204) {
          result = 'older'; // the relay holds nothing newer than the package
        } else if (!response.ok || length > MAX_BYTES) {
          result = 'offline';
        } else {
          const text = await response.text();
          result = text.length > MAX_BYTES ? 'invalid' : await acceptFetchedRepairs(text);
        }
      } finally {
        clearTimeout(timer);
      }
    }
  } catch {
    result = 'offline';
  }
  await writeStatus(result);
  return result;
}

/**
 * Ask the relay only when it is time: six hours after the last answer, an hour after a failure. It rides on the worker's
 * existing fifteen-minute tick, so no scheduled job of its own is added. Never throws.
 */
export async function syncRepairsIfDue(fetchImpl: typeof fetch = fetch, now: number = Date.now()): Promise<RepairsSyncResult | 'not-due'> {
  try {
    const stored = await chrome.storage.local.get([REPAIRS_STATUS_KEY]);
    const status = stored[REPAIRS_STATUS_KEY] as { checkedAt?: string; result?: string } | undefined;
    const last = status?.checkedAt ? Date.parse(status.checkedAt) : NaN;
    if (Number.isFinite(last)) {
      const gap = status?.result === 'offline' ? RETRY_AFTER_FAILURE_MS : ASK_EVERY_MS;
      if (now - last >= 0 && now - last < gap) return 'not-due';
    }
  } catch {
    // An unreadable status means ask now.
  }
  return syncRepairs(fetchImpl);
}
