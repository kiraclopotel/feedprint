// The paid reading's Claude reader, as the extension sees it: one item sent to the relay, which holds
// the prompt and asks Claude Haiku (worker/src/claude-judge.ts). The answer is Haiku's reading, or the
// reason there is none. No reason is ever turned into a reading, so whatever goes wrong, the item
// keeps the ordinary reading's rule (src/ai/judge-pair.ts actFires).
//
// Asked only once the ordinary judge has fired on the same item, so every gate that call passed
// (the reading on, a level that reads, a paid key that holds the reading, room under the caps) has
// just been passed. This checks only what is new: a paid key and a consent for the Claude reading.

import { getLicense } from '../storage/license';
import { bearerOf, consentHeaderValue, getReadingConsent, READING_CONSENT_HEADER } from '../storage/reading-consent';
import { recordAiCall } from '../storage/settings';
import { claudeTokenEquivalents } from '../storage/usage-weights';
import { DeadlineError } from './fetch-with-deadline';
import { relayFetch } from './relay-fetch';

const CLAUDE_READER_URL = 'https://api.feelingwise.org/v1/claude/verdict';
// Past the relay's own 15 seconds, so a slow answer is the relay's to name.
export const CLAUDE_READER_DEADLINE_MS = 20_000;

// Who is asked. The relay names who answered; these name the reader on a record when it did not.
const CLAUDE_MODEL = 'claude-haiku-5-5';
const CLAUDE_PROVIDER = 'anthropic';
const CLAUDE_JUDGE_HASH = 'd83cd0253c1c';

export interface ClaudeVerdict {
  charged: boolean;
  family: string;
  severity: number;
  effect: string;
  intent: string;
}

export type ClaudeOutcome =
  | 'read'
  | 'no-key'
  | 'no-consent'
  | 'no-feature'
  | 'key-refused'
  | 'not-configured'
  | 'paused-near-cap'
  | 'paused-daily'
  | 'paused-monthly'
  | 'refused'
  | 'unusable'
  | 'timeout'
  | 'error';

/** What the record keeps about the Claude reader on an item it was asked about. */
export interface ClaudeStamp {
  model: string;
  provider: string;
  hash: string;
  outcome: ClaudeOutcome;
  /** Haiku's five fields, present only when it read the item. */
  reading?: ClaudeVerdict;
}

const FAILURE_BY_CODE: Record<string, ClaudeOutcome> = {
  claude_not_configured: 'not-configured',
  claude_paused_near_cap: 'paused-near-cap',
  claude_refused: 'refused',
  claude_unusable: 'unusable',
  upstream_timeout: 'timeout',
  consent_required: 'no-consent',
  feature_missing: 'no-feature',
  cap_daily: 'paused-daily',
  cap_monthly: 'paused-monthly',
};

// A refusal that will not change within the hour is remembered, so the next flagged items get the same
// stamp without a call: the second check of 11 Oct 2026 found every flagged item opening a call after a
// cap. A daily cap holds until the next UTC day, as the relay counts it; the rest are asked again after
// an hour. A reading clears it. The popup reads the marker (HomeTab) to say that Claude stopped first.
export const CLAUDE_PAUSE_STORAGE_KEY = 'claudeReadingPaused';
const LATCHED: ReadonlySet<ClaudeOutcome> = new Set(['paused-near-cap', 'paused-daily', 'paused-monthly', 'no-feature', 'key-refused', 'not-configured']);
const HOUR_MS = 60 * 60 * 1000;
let pausedUntil = 0;
let pausedAs: ClaudeOutcome | null = null;

function nextUtcMidnight(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
}

async function latch(outcome: ClaudeOutcome, now = new Date()): Promise<void> {
  pausedUntil = outcome === 'paused-daily' ? nextUtcMidnight(now) : now.getTime() + HOUR_MS;
  pausedAs = outcome;
  try {
    await chrome.storage.local.set({ [CLAUDE_PAUSE_STORAGE_KEY]: { reason: outcome, until: new Date(pausedUntil).toISOString() } });
  } catch { /* the marker is for the popup; a lost write costs nothing else */ }
}

async function unlatch(): Promise<void> {
  if (pausedAs === null) return;
  pausedUntil = 0;
  pausedAs = null;
  try { await chrome.storage.local.remove(CLAUDE_PAUSE_STORAGE_KEY); } catch { /* as above */ }
}

/**
 * Whether the paid reading's Claude reader runs on this install: a paid key, and a consent for the
 * Claude reading stored for it (the screen that names the second company, src/ui/popup/panels/
 * ReadingConsentScreen.tsx). There is no other switch: the consent is the switch (11 Oct 2026).
 */
export async function claudeReadingOn(): Promise<boolean> {
  const license = await getLicense();
  if (license.tier === 'free' || !license.secret) return false;
  return (await getReadingConsent(bearerOf(license), 'claude')) !== null;
}

function stamp(outcome: ClaudeOutcome, reading?: ClaudeVerdict, reader?: Partial<Record<'model' | 'provider' | 'judge', unknown>>): ClaudeStamp {
  const named = (v: unknown, fallback: string) => (typeof v === 'string' && v !== '' ? v : fallback);
  return {
    model: named(reader?.model, CLAUDE_MODEL),
    provider: named(reader?.provider, CLAUDE_PROVIDER),
    hash: named(reader?.judge, CLAUDE_JUDGE_HASH),
    outcome,
    ...(reading ? { reading } : {}),
  };
}

function verdictFrom(v: unknown): ClaudeVerdict | null {
  if (!v || typeof v !== 'object') return null;
  const { charged, family, severity, effect, intent } = v as Record<string, unknown>;
  if (typeof charged !== 'boolean' || typeof family !== 'string' || typeof effect !== 'string' || typeof intent !== 'string') return null;
  if (!Number.isInteger(severity) || (severity as number) < 0 || (severity as number) > 10) return null;
  return { charged, family, severity: severity as number, effect, intent };
}

async function meter(usage: unknown): Promise<void> {
  const u = (usage && typeof usage === 'object' ? usage : {}) as Record<string, unknown>;
  const n = (k: string) => (typeof u[k] === 'number' && Number.isFinite(u[k]) ? (u[k] as number) : 0);
  const counted = {
    input_tokens: n('input_tokens'),
    cache_creation_input_tokens: n('cache_creation_input_tokens'),
    cache_read_input_tokens: n('cache_read_input_tokens'),
    output_tokens: n('output_tokens'),
  };
  // A lost count must not cost the reading, as on the ordinary path (client.ts).
  try {
    await recordAiCall({
      inputTokens: counted.input_tokens + counted.cache_creation_input_tokens + counted.cache_read_input_tokens,
      outputTokens: counted.output_tokens,
      tokenEquivalents: claudeTokenEquivalents(counted),
      provider: CLAUDE_PROVIDER,
      model: CLAUDE_MODEL,
    });
  } catch (err) {
    console.warn('[FeelingWise] the Claude reading was not metered locally; the reading still ships:', err);
  }
}

export async function askClaudeReader(item: {
  text: string;
  platform?: string;
  kind?: string;
  parentText?: string;
  signal?: AbortSignal;
}): Promise<ClaudeStamp> {
  const license = await getLicense();
  if (license.tier === 'free' || !license.secret) return stamp('no-key');
  const bearer = bearerOf(license);
  const consent = await getReadingConsent(bearer, 'claude');
  if (!consent) return stamp('no-consent');
  if (pausedAs !== null && Date.now() < pausedUntil) return stamp(pausedAs);

  let res: Response;
  try {
    res = await relayFetch(CLAUDE_READER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bearer}`,
        [READING_CONSENT_HEADER]: consentHeaderValue(consent),
      },
      body: JSON.stringify({
        item: {
          platform: item.platform ?? 'unknown',
          kind: item.kind ?? 'post',
          text: item.text,
          ...(item.parentText ? { parentText: item.parentText } : {}),
        },
      }),
      // Carried out by the worker like every reading call (relay-fetch.ts); where it goes out from a page, this keeps the page's address off it.
      referrerPolicy: 'no-referrer',
    }, CLAUDE_READER_DEADLINE_MS, item.signal);
  } catch (err) {
    return stamp(err instanceof DeadlineError ? 'timeout' : 'error');
  }

  let body: Record<string, unknown> = {};
  try { body = await res.json() as Record<string, unknown>; } catch { body = {}; }
  if ('usage' in body) await meter(body.usage);
  if (!res.ok) {
    const code = (body.error as { code?: unknown } | undefined)?.code;
    const outcome: ClaudeOutcome = typeof code === 'string' && FAILURE_BY_CODE[code] ? FAILURE_BY_CODE[code]
      : res.status === 401 || res.status === 403 ? 'key-refused'
      : 'error';
    if (LATCHED.has(outcome)) await latch(outcome);
    return stamp(outcome);
  }
  const reading = verdictFrom(body.verdict);
  if (reading) await unlatch();
  return reading
    ? stamp('read', reading, body.reader as Record<string, unknown> | undefined)
    : stamp('unusable');
}
