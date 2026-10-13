// The reading's calls leave from the extension's worker, not from the social site's page.
//
// A fetch made by a content script carries the page's origin as its initiator: the browser sends a CORS preflight
// for the key header, the site's own network panel shows the call and the key, and the browser reports failures of
// the relay's host to a third party (Cloudflare's network error logging). The worker is a page of the extension's
// own, with the relay's host in its permissions, so none of that happens there.
//
// Where there is no worker to ask (an extension page such as the popup or the dashboard, a test, a script whose
// extension was reloaded under it), the call goes out as it always did.

import { DeadlineError, fetchWithDeadline } from './fetch-with-deadline';
import { bumpCounter } from '../diagnostics/diagnostics';
import type { RelayFetchReply, RelayFetchRequest } from '../types/relay-fetch';

let seq = 0;
let warnedOfFallback = false;
const warnedOfRefusal = new Set<string>();

/**
 * The worker did not take the call and it goes out from the page after all. Seen on the bench (12 Oct 2026): after the
 * files were swapped an older worker did not know the message and every reading call quietly left from the site's own
 * page, which is the very thing the worker route exists to stop. A counter in the diagnostics and one warning say so.
 */
function noteFallbackToThePage(): void {
  bumpCounter('relayFetchFellBackToPage');
  if (warnedOfFallback) return;
  warnedOfFallback = true;
  console.warn('[FW relay-fetch] the extension worker did not take the reading call, so it was made from the page. An update that has not been reloaded can cause this; reload the extension.');
}

/**
 * The worker would not carry the call out. The page reads it as a dropped connection, which is what the caller's failure
 * handling expects, so the cause is told here instead: a counter in the diagnostics and one warning per cause. The Tester's
 * twenty-fifth read (13 Oct 2026) found Silent with a key and the agreement making no reading call while Calm made 15, and
 * nothing on the page said which refusal it was.
 */
function noteRefusal(why: string | undefined): void {
  const cause = why ?? 'unnamed';
  bumpCounter(`relayFetchRefused:${cause}`);
  if (warnedOfRefusal.has(cause)) return;
  warnedOfRefusal.add(cause);
  console.warn(`[FW relay-fetch] the extension worker refused a reading call (${cause}).`);
}

function inExtensionPage(): boolean {
  try {
    return typeof location !== 'undefined' && location.protocol === 'chrome-extension:';
  } catch {
    return true;
  }
}

function runtime(): { id?: string; sendMessage?: (message: unknown) => unknown } | undefined {
  return (globalThis as { chrome?: { runtime?: { id?: string; sendMessage?: (message: unknown) => unknown } } }).chrome?.runtime;
}

function headersOf(init: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!init) return out;
  if (init instanceof Headers) { init.forEach((v, k) => { out[k] = v; }); return out; }
  if (Array.isArray(init)) { for (const [k, v] of init) out[k] = v; return out; }
  for (const [k, v] of Object.entries(init)) out[k] = String(v);
  return out;
}

function abortError(): Error {
  const e = new Error('The operation was aborted');
  e.name = 'AbortError';
  return e;
}

const NO_BODY_STATUS = new Set([101, 204, 205, 304]);

/** Same contract as fetchWithDeadline: a Response, a DeadlineError on the deadline, an AbortError when the caller cancels. */
export async function relayFetch(
  url: string,
  init: RequestInit,
  deadlineMs: number,
  callerSignal?: AbortSignal,
): Promise<Response> {
  const rt = runtime();
  const direct = (): Promise<Response> => fetchWithDeadline(url, init, deadlineMs, callerSignal);
  if (inExtensionPage() || !rt?.id || typeof rt.sendMessage !== 'function') return direct();
  if (init.method !== 'POST' || typeof init.body !== 'string') return direct();
  if (callerSignal?.aborted) throw abortError();

  const id = `rf-${Date.now().toString(36)}-${(++seq).toString(36)}`;
  const request: RelayFetchRequest = { id, url, headers: headersOf(init.headers), body: init.body, deadlineMs };
  const send = rt.sendMessage.bind(rt);
  const cancel = (): void => {
    try { void Promise.resolve(send({ type: 'RELAY_FETCH_CANCEL', payload: { id } })).catch(() => undefined); } catch { /* the worker is gone */ }
  };

  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onAbort);
      fn();
    };
    const onAbort = (): void => finish(() => { cancel(); reject(abortError()); });
    // The worker answers at its own, shorter limit; this one only covers a worker that never answers at all.
    const timer = setTimeout(() => finish(() => { cancel(); reject(new DeadlineError(deadlineMs)); }), deadlineMs + 2_000);
    callerSignal?.addEventListener('abort', onAbort, { once: true });

    let pending: Promise<unknown>;
    try {
      pending = Promise.resolve(send({ type: 'RELAY_FETCH', payload: request }));
    } catch (err) {
      finish(() => reject(err instanceof Error ? err : new TypeError('Failed to fetch')));
      return;
    }
    pending.then((reply) => {
      if (settled) return;
      if (reply === undefined || reply === null) {
        // Nothing was listening (a context with no worker): no call was made, so make it here.
        noteFallbackToThePage();
        finish(() => { direct().then(resolve, reject); });
        return;
      }
      const r = reply as RelayFetchReply;
      if (r.ok) {
        finish(() => resolve(new Response(NO_BODY_STATUS.has(r.status) ? null : r.body, { status: r.status, headers: r.headers })));
        return;
      }
      finish(() => {
        if (r.kind === 'deadline') reject(new DeadlineError(deadlineMs));
        else if (r.kind === 'aborted') reject(abortError());
        else {
          if (r.kind === 'refused') noteRefusal(r.why);
          reject(new TypeError('Failed to fetch'));
        }
      });
    }, (err) => {
      finish(() => reject(err instanceof Error ? err : new TypeError('Failed to fetch')));
    });
  });
}
