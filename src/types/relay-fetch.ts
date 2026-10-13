// The reading's calls go out through the service worker, not from the social site's page (the Tester's full test,
// 11 Oct 2026: 76 calls whose initiator was the site's own origin, with CORS preflights and the browser's error reports
// to a third party, and the key header readable in the site's network panel). These are the two envelopes.

/** One call to the relay, as the page's script hands it to the worker. */
export interface RelayFetchRequest {
  /** Names the call so the page can cancel it. */
  id: string;
  /** Only addresses on the relay's own host are carried out. */
  url: string;
  headers: Record<string, string>;
  body: string;
  /** How long the caller will wait; the worker keeps to a shorter limit of its own (see background/relay-fetch.ts). */
  deadlineMs: number;
}

/** What the worker answers: the relay's answer as it came, or why there was none. */
export type RelayFetchReply =
  | { ok: true; status: number; headers: Array<[string, string]>; body: string }
  | { ok: false; kind: 'deadline' | 'aborted' | 'network' }
  // `why` is the word for the cause: 'shape' for a call that is not a well-formed relay call, else the gate's (ai/gate-with-agreement.ts).
  | { ok: false; kind: 'refused'; why?: string };
