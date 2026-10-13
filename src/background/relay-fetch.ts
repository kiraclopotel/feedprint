// The worker's side of the reading's calls (see ai/relay-fetch.ts): carries one call out to the relay and gives the
// answer back as it came. It is not a general proxy: only POSTs to the relay's own host, and nothing at Strict while
// Strict reads nothing, which makes no outside call of any kind (types/reading-gate.ts).

import type { RelayFetchReply, RelayFetchRequest } from '../types/relay-fetch';
import { getSettings } from '../storage/settings';
import { gateRefusal } from '../ai/gate-with-agreement';

const RELAY_HOST_PREFIX = 'https://api.feelingwise.org/';
/** A worker is ended when one fetch has not answered in 30 seconds, so the call is given up a little before that. */
export const WORKER_FETCH_DEADLINE_MS = 28_000;
const MAX_BODY_CHARS = 400_000;

const inflight = new Map<string, AbortController>();

function wellFormed(r: unknown): r is RelayFetchRequest {
  if (!r || typeof r !== 'object') return false;
  const q = r as Partial<RelayFetchRequest>;
  if (typeof q.id !== 'string' || q.id.length === 0 || q.id.length > 80) return false;
  if (typeof q.url !== 'string' || !q.url.startsWith(RELAY_HOST_PREFIX)) return false;
  if (typeof q.body !== 'string' || q.body.length > MAX_BODY_CHARS) return false;
  if (typeof q.deadlineMs !== 'number' || !(q.deadlineMs > 0)) return false;
  if (!q.headers || typeof q.headers !== 'object') return false;
  return Object.values(q.headers).every((v) => typeof v === 'string');
}

export function cancelRelayFetch(id: unknown): void {
  if (typeof id !== 'string') return;
  inflight.get(id)?.abort();
}

export async function carryOutRelayFetch(request: unknown): Promise<RelayFetchReply> {
  if (!wellFormed(request)) return { ok: false, kind: 'refused', why: 'shape' };
  const why = await gateRefusal(await getSettings());
  if (why !== null) return { ok: false, kind: 'refused', why };
  const controller = new AbortController();
  inflight.set(request.id, controller);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, Math.min(request.deadlineMs, WORKER_FETCH_DEADLINE_MS));
  try {
    const res = await fetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    const body = await res.text();
    return { ok: true, status: res.status, headers: Array.from(res.headers.entries()), body };
  } catch {
    return { ok: false, kind: timedOut ? 'deadline' : controller.signal.aborted ? 'aborted' : 'network' };
  } finally {
    clearTimeout(timer);
    inflight.delete(request.id);
  }
}
