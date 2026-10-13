// POST /v1/dom-report: a "this broke" report from a person's browser (11 Oct 2026).
//
// When a site changes under one of our finders, the fix needs to see what the page looks like now. The extension builds a
// skeleton of the page (tags, roles, attribute names, the shape of labels and addresses; never a word, a name, an id or an
// address) and, on a press and with the person's consent, sends it here. This route is the second lock on that promise:
// it accepts a body only if every string in it is a member of the closed sets in ./dom-report/ (the same files the
// extension checks against, kept equal by a test), and it refuses the whole body otherwise. It does not look for personal
// data and strip it; it accepts only what could not be.
//
// What is kept: the exact text of the accepted report, in the licence namespace under `domrep:<day>:<site>:<product>:<hash>`
// for sixty days, so an identical report on the same day is one record. What is not kept: the address it came from, any
// header, any cookie. The address is read once, hashed, and used only to count how often one sender writes (the Workers
// Rate Limiting binding when there is one, this isolate's memory otherwise). The answer to a stored report is 204.
//
// The licence listings read the `fw-` and `owed:` prefixes only, so these keys are never listed with them. The maintainer
// reads them with worker/scripts/read-dom-reports.mjs.

import type { Env } from './proxy';
import { MAX_REPORT_CHARS } from './dom-report/grammar';
import { validateReport } from './dom-report/report';
import { readBoundedText } from './bounded-text';

export const REPORT_KEY_PREFIX = 'domrep:';
export const REPORT_KEEP_SECONDS = 60 * 24 * 60 * 60;
/** A sender may write this many reports in a window. The Workers binding counts across isolates; this counts in one. */
export const REPORTS_PER_WINDOW = 3;
const WINDOW_MS = 60_000;
const ADDRESSES_KEPT = 500;
/** A little room over the report cap for whitespace; the validator holds the exact limit. */
const BODY_ROOM = MAX_REPORT_CHARS + 2_000;

const bySender = new Map<string, { count: number; since: number }>();

async function digestHex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * What a sender is counted under. A plain SHA-256 of an IPv4 address is undone by trying every address, so the address is
 * keyed with a secret the worker already holds (the webhook secret, under a label of its own), which every isolate shares, so the
 * Workers binding still counts one sender as one across isolates. With no secret configured the key is a random one for this
 * isolate: the in-memory count still works and nothing handed to the binding can be undone, but the binding then counts per isolate.
 */
let isolateKey: string | null = null;
async function senderFingerprint(address: string, env: Pick<Env, 'LEMONSQUEEZY_WEBHOOK_SECRET'>): Promise<string> {
  const secret = env.LEMONSQUEEZY_WEBHOOK_SECRET || (isolateKey ??= crypto.randomUUID() + crypto.randomUUID());
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('dom-report-sender:v1:' + address));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

/** True when this sender has written too many reports lately. The sender is a keyed fingerprint; the address itself is not kept. */
async function writesTooOften(request: Request, env: Pick<Env, 'REPORT_LIMITER' | 'LEMONSQUEEZY_WEBHOOK_SECRET'>, now: number): Promise<boolean> {
  const sender = await senderFingerprint(request.headers.get('cf-connecting-ip') ?? 'unknown', env);
  let entry = bySender.get(sender);
  if (!entry || now - entry.since >= WINDOW_MS) {
    if (!entry && bySender.size >= ADDRESSES_KEPT) {
      const oldest = bySender.keys().next().value;
      if (oldest !== undefined) bySender.delete(oldest);
    }
    entry = { count: 0, since: now };
    bySender.set(sender, entry);
  }
  entry.count++;
  if (entry.count > REPORTS_PER_WINDOW) return true;
  if (!env.REPORT_LIMITER) return false;
  try {
    const { success } = await env.REPORT_LIMITER.limit({ key: sender });
    return !success;
  } catch {
    return false;
  }
}

function answer(status: number, error?: string): Response {
  const headers: Record<string, string> = { 'cache-control': 'no-store' };
  if (status === 429) headers['retry-after'] = '60';
  if (!error) return new Response(null, { status, headers });
  return new Response(JSON.stringify({ error }), { status, headers: { ...headers, 'content-type': 'application/json; charset=utf-8' } });
}

export async function handleDomReport(request: Request, env: Pick<Env, 'LICENSES' | 'REPORT_LIMITER' | 'LEMONSQUEEZY_WEBHOOK_SECRET'>): Promise<Response> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > BODY_ROOM) return answer(413, 'too_large');
  if (await writesTooOften(request, env, Date.now())) return answer(429, 'slow_down');

  // The header above is the client's word. The stream is what counts: a chunked body has no length, and one that lies about it passes.
  const text = await readBoundedText(request, BODY_ROOM);
  if (text === null) return answer(413, 'too_large');
  let report: unknown;
  try { report = JSON.parse(text); } catch { return answer(400, 'not_a_report'); }
  // A report is stored as it was checked: re-serialised, so whitespace or key order cannot make one report two records.
  const problems = validateReport(report);
  if (problems.length > 0) return answer(400, 'not_a_report');

  const parts = report as { day: string; site: string; product: string };
  const canonical = JSON.stringify(report);
  const key = `${REPORT_KEY_PREFIX}${parts.day}:${parts.site}:${parts.product}:${(await digestHex(canonical)).slice(0, 16)}`;
  try {
    await env.LICENSES.put(key, canonical, { expirationTtl: REPORT_KEEP_SECONDS });
  } catch {
    return answer(503, 'unavailable');
  }
  return answer(204);
}

/** Test hook: forget who has written. */
export function __resetReportSendersForTest(): void {
  bySender.clear();
}
