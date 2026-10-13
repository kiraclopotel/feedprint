// FeelingWise — AI client (Groq-only for V1, via license-gated proxy).
//
// Single model: `openai/gpt-oss-20b` (see GROQ_FAST_MODEL below). The
// `fastMode` parameter on callAI is retained for source-compat with existing
// callers but is a no-op — there is one model for every call. JSON-mode
// refusal recovers via a retry-without-response_format path that lets the
// 3-tier `extractCombinedJSON` parser in neutralizer.ts handle markdown-
// wrapped or prose-prefixed LLM output.
//
// Requests are sent to the FeelingWise proxy (api.feelingwise.org), which
// validates the per-tier license key, enforces daily/monthly caps in KV,
// and forwards to Groq using a master key held as a Worker secret. The
// extension never sees a Groq key.

import { getSettings, recordAiCall, type FWSettings } from '../storage/settings';
import { levelMayCallOut } from '../types/reading-gate';
import { readingActiveNow } from './gate-with-agreement';
import { meteredTokenEquivalents } from '../storage/usage-weights';
import { getLicense, isUncappedTier, type LicenseInfo } from '../storage/license';
import { licenseHoldsFeature, readEntitlements, READING_FEATURE, refreshEntitlements } from '../storage/license-entitlements';
import type { AIFailure, Result } from './ai-error';
import { Err, Ok, parseRetryAfterMs } from './ai-error';
import { buildGroqCallTelemetry, recordGroqCallTelemetry } from './telemetry';
import { DeadlineError, PROXY_TEXT_DEADLINE_MS } from './fetch-with-deadline';
import { relayFetch } from './relay-fetch';
import { noteReadingAnswered, noteReadingFailure } from '../storage/reading-trouble';
import { noteReadingGotThrough } from './reading-got-through';
import { bumpCounter } from '../diagnostics/diagnostics';
import { noteCallProvenance } from './call-provenance';
import { getBuildId } from '../core/build-id';
import { countIdentifierHits, noteIdentifierHits } from '../core/name-labels';

function sleep(ms: number): Promise<void> {
  return new Promise<void>(r => setTimeout(r, ms));
}

// In-flight proxy-fetch cap. The pre-Phase-3 api-key-pool acted as a token
// bucket (capacity 10, sustained 1 req / 2s) that bounded concurrent
// fetches against Groq. Removing the pool dropped that ceiling along with
// the dual-key plumbing; on heavy fan-out (comment-batch fires N parallel
// rewrites + cap-check + probe simultaneously) unbounded concurrent
// requests accumulate state in the renderer process. Five is generous for
// typical comment-batch fan-out (one batch + a handful of per-comment
// rewrites) while keeping memory pressure bounded under adversarial load.
export const MAX_CONCURRENT_PROXY_FETCHES = 5;
let _inFlightProxyFetches = 0;
const _proxyFetchQueue: Array<() => void> = [];

async function withProxyFetchSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (_inFlightProxyFetches >= MAX_CONCURRENT_PROXY_FETCHES) {
    await new Promise<void>(resolve => _proxyFetchQueue.push(resolve));
  }
  _inFlightProxyFetches++;
  try {
    return await fn();
  } finally {
    _inFlightProxyFetches--;
    const next = _proxyFetchQueue.shift();
    if (next) next();
  }
}

let lastCallMeta: { model: string; provider: string } | null = null;
export function getLastCallMeta() { return lastCallMeta; }

/**
 * Kind of the most recent failed `callAI`, or null when the last call
 * succeeded.
 *
 * The single-post cascade collapses a failure to `null` before the pipeline
 * sees it, so the pipeline could name that a failure but not name WHICH one.
 * A chain record that cannot say why it went unjudged is read as `network` by
 * the dashboard's back-compat default — an attribution nobody measured. This
 * carries the real kind across that boundary.
 */
let lastFailureKind: AIFailure['kind'] | null = null;
export function getLastFailureKind(): AIFailure['kind'] | null { return lastFailureKind; }

/**
 * knob. When a caller (currently `combinedDetectAndNeutralize`) needs
 * the model output to be strict JSON, it passes `jsonMode: true`. Groq accepts
 * `response_format: { type: 'json_object' }` natively. If the model refuses
 * to produce valid JSON (safety filter trip on controversial content), the
 * client retries once WITHOUT JSON mode so the caller's 3-tier parser can
 * still try to recover something useful from prose output.
 */
export interface CallAIOptions {
  jsonMode?: boolean;
  /**
   * Per-call model. The proxy allows openai/gpt-oss-20b and openai/gpt-oss-120b
   * and pins anything else to its default. The adult judge (JUDGE_V1_MODEL) is
   * the one caller; everything else takes GROQ_FAST_MODEL.
   */
  model?: string;
  /**
   * Strict JSON schema for the reply (Groq `response_format: json_schema`,
   * constrained decoding). Takes precedence over jsonMode's json_object.
   */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  signal?: AbortSignal;
  /**
   * Per-call max_tokens override. Default 4096 is a ceiling, not a cost —
   * spend is on tokens actually generated. Batch comment scoring at 25
   * comments × ~25 tokens/verdict + environment block can exceed 1024 and
   * truncates the trailing indices to no-flag silently. Callers that emit
   * longer structured output pass an explicit value (typically 2048 for batch).
   */
  maxTokens?: number;
  /**
   * Per-call outcome sink for callers that must tell a TRUNCATED reply from a
   * malformed one (2026-09-02). `lastCallMeta` is a module global and races
   * with concurrent calls, so the one signal that names the failure —
   * `finish_reason` — could not be read safely by a caller that awaited a
   * call. This callback fires synchronously inside the response handler of
   * the attempt that produced the returned value, before `callAI` resolves,
   * so the caller reads its OWN call's outcome. Fired on every 2xx attempt
   * (last one wins); never fired when the request never reached a parsed
   * body (non-2xx, fetch throw, abort).
   */
  onCallMeta?: (meta: GroqCallOutcome) => void;
  /**
   * The account names this call replaced with labels ("@handle", display names). The last check
   * before the request counts whole-token hits of them in the user message: a hit means the
   * replacement missed one. A build with no id (tests, node harnesses) refuses the call; a shipped
   * build counts it and goes on, since the check can false-alarm and refusing would drop readings.
   */
  knownIdentifiers?: readonly string[];
}

/**
 * What the provider said about the shape of one completed call. Enough to
 * separate "the model was cut off at max_tokens" (retryable with room) from
 * "the model returned something we cannot parse" (a repeat call cannot fix).
 */
export interface GroqCallOutcome {
  /** `choices[0].finish_reason` — 'stop' healthy, 'length' cut at max_tokens. */
  finishReason: string | null;
  /** True iff `finishReason === 'length'`. */
  truncated: boolean;
  /** `usage.completion_tokens` actually generated. 0 when absent. */
  completionTokens: number;
  /** The `max_tokens` this attempt was sent with. */
  maxTokens: number;
}

const PROXY_URL = 'https://api.feelingwise.org/v1/chat/completions';
const PROXY_MODELS_URL = 'https://api.feelingwise.org/v1/models';
// Single Groq model. Exported so chain-payload writers reference one source
// of truth instead of hardcoding the model name string.
//
// Model is `openai/gpt-oss-20b`. Groq decommissioned the prior
// `llama-3.1-8b-instant` judge; a blind-gold-key bake-off (1329 real chain
// cases, teen mode) measured 20b at precision 42% / recall 59% vs gpt-oss-120b
// at 38% / 69% — tied on F1 (≈0.49) but 20b over-blocks less (the primary
// failure per VISION) and catches clear-cut harm better, at half the cost.
// The gpt-oss request-body params (reasoning_effort='low',
// include_reasoning=false) apply conditionally via `isGptOss` in
// callProxyOnce — the model name carries the whole switch.
export const GROQ_FAST_MODEL = 'openai/gpt-oss-20b';

/**
 * What to call the provider when a record is being written and no reply header
 * named one: no call was made, the meta was dropped, or the reply came from a
 * proxy too old to name itself.
 *
 * It exists as one exported constant because the string used to be typed out in
 * seven places as 'groq', and on 2026-09-21 the upstream became DeepInfra and all
 * seven became false at once. Four of them wrote straight into the judge block of
 * an exported forensics record, which the methodology block tells a reader is the
 * authoritative stamp. A person checking their own record would have been told
 * the wrong company read their text.
 *
 * The live value is never this constant: it is read off the proxy's x-fw-provider
 * header on every reply (see callAI below). This is only the floor under that.
 */
export const FALLBACK_AI_PROVIDER = 'deepinfra';

// ─── Q45 (W51): proxy-cap latch for the text path ───────────────────────────
// A proxy-enforced cap 429 (cap_daily / cap_monthly) is permanent for its
// billing period, but it was returned per call and latched nowhere: a capped
// license kept opening an authenticated fetch on EVERY scroll for the rest
// of the period, and no surface recorded that the account was capped. The
// media path latches (W28, noteMonthlyCapReached); this is the text sibling.
// In-memory latch short-circuits before the network; the storage marker
// feeds the dashboard Issues tab; both expire by period-key comparison so
// the roll needs no timer.

import { TEXT_CAP_STORAGE_KEY, licenseFingerprint } from '../storage/cap-markers';
import { licenseRefusalHolds, noteLicenseRefused } from '../storage/license-refusal';
import { clearReadingPause, noteReadingPaused, readingPauseHolds } from '../storage/reading-pause';
import { READING_CONSENT_HEADER, consentHeaderValue, getReadingConsent } from '../storage/reading-consent';
import { fwDebug } from '../core/fw-log';
export { TEXT_CAP_STORAGE_KEY };

type ProxyCapPeriod = 'daily' | 'monthly';

function currentCapPeriodKey(cap: ProxyCapPeriod, now = new Date()): string {
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return cap === 'monthly' ? month : `${month}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

// How long the relay asked this address to wait after refusing it for unknown keys. Held in memory only: the
// refusal lasts a minute, shorter than anything worth storing.
const TOO_MANY_FAILED_KEYS = 'too_many_failed_keys';
const RELAY_PAUSE_DEFAULT_MS = 60_000;
let relayPausedUntil = 0;
// An ordinary 429 (the provider's rate limit, with its Retry-After) pauses every call of this realm for that long, at
// the moment each would leave, so a burst of posts does not meet the same refusal twenty times in half a minute.
const RATE_LIMIT_PAUSE_DEFAULT_MS = 5_000;
const RATE_LIMIT_PAUSE_MAX_MS = 60_000;
// A timer can fire a few milliseconds before the pause it was set for ends; the caller's own retry, which waited the
// whole Retry-After, must not be turned away for that.
const RATE_LIMIT_PAUSE_SLACK_MS = 250;
let rateLimitedUntil = 0;

let textCapLatch: { cap: ProxyCapPeriod; periodKey: string; licenseFingerprint?: string } | null = null;
let textCapLatchHydrated = false;

/** Re-arm from the persisted marker once per realm, so a capped account
 *  does not re-discover the cap with one live 429 per SW respawn. */
async function hydrateTextCapLatch(): Promise<void> {
  if (textCapLatchHydrated) return;
  textCapLatchHydrated = true;
  try {
    if (typeof chrome === 'undefined' || !chrome?.storage?.local) return;
    const stored = await chrome.storage.local.get(TEXT_CAP_STORAGE_KEY);
    const marker = stored?.[TEXT_CAP_STORAGE_KEY] as { cap?: ProxyCapPeriod; periodKey?: string; licenseFingerprint?: string } | undefined;
    if (
      (marker?.cap === 'daily' || marker?.cap === 'monthly')
      && marker.periodKey === currentCapPeriodKey(marker.cap)
    ) {
      textCapLatch = { cap: marker.cap, periodKey: marker.periodKey, licenseFingerprint: marker.licenseFingerprint };
    }
  } catch { /* marker is best-effort */ }
}

function noteTextCapReached(cap: ProxyCapPeriod, fingerprint: string): void {
  const periodKey = currentCapPeriodKey(cap);
  textCapLatch = { cap, periodKey, licenseFingerprint: fingerprint };
  try {
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
      void chrome.storage.local.set({ [TEXT_CAP_STORAGE_KEY]: { cap, periodKey, licenseFingerprint: fingerprint } });
    }
  } catch { /* marker is best-effort */ }
  console.warn(`[FeelingWise] license ${cap} cap reached at the proxy — text AI checks pause until the period rolls`);
}

/**
 * Result of a proxy probe. `ok` = license authenticated against the FW
 * proxy; `revoked` = proxy returned 401 (license invalid, revoked, or
 * tier mismatch); `unknown` = network error / timeout / non-auth HTTP
 * error (no opinion — don't downgrade the UI state on transient failures).
 */
export type ProxyProbeResult = 'ok' | 'revoked' | 'unknown';

// Cache the probe result so the popup doesn't hammer the proxy on every
// open. Cleared when the bearer changes (`probeProxy` keys the cache by
// the trimmed bearer string).
const probeCache = new Map<string, { result: ProxyProbeResult; providerName: string | null; claudeProviderName: string | null; expiresAt: number }>();
// The header the proxy names its provider in, on the same answer as the licence check.
const PROVIDER_LEGAL_HEADER = 'x-fw-provider-legal';
// The second company, the paid reading's Claude reader, named on the same answer only while the relay's
// Claude route is configured (worker/src/proxy.ts); absent, the Claude reading cannot be offered.
const CLAUDE_PROVIDER_LEGAL_HEADER = 'x-fw-claude-provider-legal';
const PROVIDER_LEGAL_MAX_CHARS = 120;

/** The provider's legal name as the proxy last served it for this key, or null when it did not. */
export function servedProviderName(licenseBearer: string): string | null {
  return probeCache.get(licenseBearer.trim())?.providerName ?? null;
}

/** The second company's legal name (the Claude reader) as the proxy last served it, or null when it did not. */
export function servedClaudeProviderName(licenseBearer: string): string | null {
  return probeCache.get(licenseBearer.trim())?.claudeProviderName ?? null;
}

function providerNameFrom(header: string | null): string | null {
  const name = header?.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return name && name.length <= PROVIDER_LEGAL_MAX_CHARS ? name : null;
}
const PROBE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — short enough to catch a
// just-revoked license when the parent reopens the popup; long enough to
// skip the network round-trip during a normal protect-the-kid session.
// How often a good key check also refreshes what the key turns on (src/storage/license-entitlements.ts).
const ENTITLEMENTS_REFRESH_MS = 6 * 60 * 60 * 1000;
let lastEntitlementsRefreshAt = Number.NEGATIVE_INFINITY;
let lastEntitlementsRefreshKey = '';
// How often a reading refused for want of a checked list may ask for one.
const UNCHECKED_RETRY_MS = 10 * 60 * 1000;
let lastUncheckedRefreshAt = Number.NEGATIVE_INFINITY;

/**
 * Whether a paid key with no checked list (never fetched, or lapsed while the computer was offline)
 * holds the reading once the list is fetched. Without this the first reading after coming back online
 * would be refused until the next key check. Asks at most every ten minutes; a key whose checked list
 * leaves the reading out is not asked again here.
 */
async function holdsReadingAfterRefresh(license: LicenseInfo): Promise<boolean> {
  if ((await readEntitlements()).kind !== 'unchecked') return false;
  const now = Date.now();
  if (now - lastUncheckedRefreshAt < UNCHECKED_RETRY_MS) return false;
  lastUncheckedRefreshAt = now;
  const refreshed = await refreshEntitlements().catch(() => 'kept' as const);
  return refreshed === 'stored' && licenseHoldsFeature(license, READING_FEATURE);
}

/**
 * Probe the FeelingWise proxy to verify the license is currently
 * authenticated. The popup's status pill calls this on open + on
 * license-key changes; a 'revoked' result flips the pill to 'err' so the
 * parent has a clear "open License tab" affordance. VISION §1.2 + §2.7 trust
 * mandate: the connected pill must reflect connected REALITY, not
 * connected SHAPE.
 *
 * Uses the proxy's `/v1/models` endpoint — costs zero tokens, returns the
 * model list on auth success, 401 on license failure. Aborts after 5s on
 * network hang; falls back to 'unknown' so transient network blips don't
 * flip the pill to revoked.
 */
export async function probeProxy(licenseBearer: string): Promise<ProxyProbeResult> {
  const trimmed = licenseBearer.trim();
  if (trimmed.length === 0) return 'revoked';
  const now = Date.now();
  const cached = probeCache.get(trimmed);
  if (cached && cached.expiresAt > now) return cached.result;
  // A level that sends nothing asks nothing of the proxy, not even whether the key is alive: Strict while it
  // reads nothing, and an install whose level is not chosen. The last answer stands, or none, which the popup
  // shows as unchecked.
  if (!levelMayCallOut(await getSettings())) return cached?.result ?? 'unknown';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  let result: ProxyProbeResult;
  let providerName: string | null = null;
  let claudeProviderName: string | null = null;
  try {
    const resp = await fetch(PROXY_MODELS_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${trimmed}` },
      signal: controller.signal,
    });
    if (resp.status === 200) {
      result = 'ok';
      providerName = providerNameFrom(resp.headers?.get?.(PROVIDER_LEGAL_HEADER) ?? null);
      claudeProviderName = providerNameFrom(resp.headers?.get?.(CLAUDE_PROVIDER_LEGAL_HEADER) ?? null);
    }
    else if (resp.status === 401 || resp.status === 403) result = 'revoked';
    else {
      result = 'unknown';
      bumpCounter(`licenseProbe:status-${resp.status}`);
    }
  } catch {
    result = 'unknown';
    // The owner's chip read NOT CHECKED on a working install (13 Oct 2026) and nothing said why: a timeout (the list is slow) and a
    // dropped connection are told apart here, and any other status above.
    bumpCounter(controller.signal.aborted ? 'licenseProbe:timeout' : 'licenseProbe:network');
  } finally {
    clearTimeout(timeout);
  }
  // Only cache definitive results so a transient network hiccup doesn't
  // freeze the pill at 'unknown' for 5 min.
  if (result !== 'unknown') {
    probeCache.set(trimmed, { result, providerName, claudeProviderName, expiresAt: now + PROBE_CACHE_TTL_MS });
  }
  // The key answered: refresh what it turns on. A new key (the popup probes on every key change) is
  // asked at once; the same key at most every six hours, so a plan change reaches the popup within
  // the day and a kept list is renewed before its seven days run out.
  if (result === 'ok' && (trimmed !== lastEntitlementsRefreshKey || now - lastEntitlementsRefreshAt >= ENTITLEMENTS_REFRESH_MS)) {
    lastEntitlementsRefreshAt = now;
    lastEntitlementsRefreshKey = trimmed;
    void refreshEntitlements().catch(() => undefined);
  }
  return result;
}

/**
 * Whether the reading may run for this install now: the refusals callAI makes before it reads (the master switch,
 * a level that sends nothing, Strict without the adult's agreement, no key, a plan without the reading), without its
 * network refresh. Work the reading did
 * earlier, such as a cached rewrite, is served only while this holds, so a key that is removed or lapses stops it too.
 */
export async function readingAllowed(settings: FWSettings, license: LicenseInfo): Promise<boolean> {
  if (!await readingActiveNow(settings, license)) return false;
  return licenseHoldsFeature(license, READING_FEATURE);
}

export async function callAI(
  system: string,
  user: string,
  fastMode = true,
  opts: CallAIOptions = {},
): Promise<Result<string, AIFailure>> {
  const result = await callAIInner(system, user, fastMode, opts);
  // Stamp on the way out, at the one place every return path passes through:
  // the cap-exhausted short-circuits leave before the network code, and a
  // missed path here would silently restore the unattributed 'network' default.
  lastFailureKind = result.ok ? null : result.error.kind;
  return result;
}

async function callAIInner(
  system: string,
  user: string,
  fastMode = true,
  opts: CallAIOptions = {},
): Promise<Result<string, AIFailure>> {
  const settings = await getSettings();
  const jsonMode = opts.jsonMode === true;

  // Master AI breaker. Checked FIRST: when the parent flips aiAnalysisEnabled
  // off, no license read, no cap math, no network. Every Groq caller funnels
  // through here, so this one gate is the whole guarantee. A level that sends nothing is the same refusal whatever
  // the stored switch says: the person's own setting is kept, so leaving Strict gives it back.
  if (settings.aiAnalysisEnabled === false || !levelMayCallOut(settings)) {
    return Err({ kind: 'cap-exhausted', cap: 'master-off' });
  }

  // License gate. The proxy also enforces tier caps server-side via KV,
  // but we short-circuit here so a Free-tier install never even attempts
  // the network round-trip. Returning Err lets each caller's existing
  // empty-response branch fire (combined → null → cancel-stale, batch →
  // failClosed, neutralize → marker without rewrite). Resolved before the
  // daily-cap gate so the uncapped `dev` tier can skip it.
  const license = await getLicense();
  if (license.tier === 'free') {
    // Once per post read on the free tier: behind the debug switch, so it does not fill the page's console.
    fwDebug(`[FeelingWise] Pipeline: PASS (free tier — ${license.tier}) — regex/harm-floor cleared`);
    return Err({ kind: 'cap-exhausted', cap: 'tier-free' });
  }
  // Strict reads only for an adult who agreed (the reading consent, kept per key): without it Strict is the
  // refusal it has always been. The other levels pass here untouched; the relay holds their agreement.
  if (!await readingActiveNow(settings, license)) {
    return Err({ kind: 'cap-exhausted', cap: 'master-off' });
  }
  // Plan gate: a paid key whose plan does not include the reading makes no call, and reads to the
  // callers exactly like the free tier. The proxy refuses such a call anyway (403 feature_missing);
  // this keeps it off the network. Until the build carries the entitlements public key, every paid
  // key holds the reading (src/storage/license-entitlements.ts).
  if (!await licenseHoldsFeature(license, READING_FEATURE) && !await holdsReadingAfterRefresh(license)) {
    return Err({ kind: 'cap-exhausted', cap: 'tier-free' });
  }
  const bearer = `fw-${license.tier}-${license.secret}`;

  // Daily cap (VISION §8 user-set throttle / network kill-switch). Skipped for
  // the uncapped `dev` tier so founder testing isn't bounded by the customer
  // solvency cap.
  if (!isUncappedTier(license.tier) && settings.dailyCap > 0 && settings.totalChecksToday >= settings.dailyCap) {
    fwDebug('[FeelingWise] Daily cap reached — PASS');
    return Err({ kind: 'cap-exhausted', cap: 'daily' });
  }

  // Q45 (W51): proxy-cap latch. Once the worker has said cap_daily or
  // cap_monthly, every further call inside the same period would 429
  // identically — skip the network until the period rolls. Ordered after
  // the client gates above so their precedence (master-off, tier-free,
  // client daily) is unchanged; dev tier never latches because the worker
  // never caps it.
  await hydrateTextCapLatch();
  const fingerprint = licenseFingerprint(license.tier, license.secret);
  if (textCapLatch) {
    // A latch left by a different key (trial capped, paid key pasted) does
    // not bind this one. Markers written before the fingerprint existed
    // carry none and are honoured as before.
    const sameLicense = textCapLatch.licenseFingerprint === undefined
      || textCapLatch.licenseFingerprint === fingerprint;
    if (sameLicense && textCapLatch.periodKey === currentCapPeriodKey(textCapLatch.cap)) {
      return Err({ kind: 'cap-exhausted', cap: textCapLatch.cap });
    }
    textCapLatch = null; // period rolled or licence changed — resume normal calls
  }

  // A key the proxy refused lately sends nothing more until its pause ends; the post's words stay on
  // the device. The answer is the one the refusal itself gave, so every caller's auth-refusal branch
  // already handles it.
  if (await licenseRefusalHolds(fingerprint)) {
    return Err({ kind: 'auth-refusal' });
  }

  // The relay asked this key for the reading go-ahead lately (403 consent_required): nothing more leaves until the
  // person gives it or a few minutes pass, and the Issues tab and the toolbar icon say why (storage/reading-pause.ts).
  if (await readingPauseHolds(fingerprint)) {
    return Err({ kind: 'consent-required' });
  }

  // The go-ahead is read here, before any post text leaves: a key with no stored consent sends nothing, and the
  // Issues tab and the toolbar icon say why, as for the relay's own refusal. Until 13 Oct 2026 only the relay held
  // this line (cold audit, finding 4).
  if (!await getReadingConsent(bearer)) {
    noteReadingPaused(fingerprint);
    return Err({ kind: 'consent-required' });
  }

  // The relay refused this address for guessing keys (someone else on a shared network, usually). Asking again
  // before its Retry-After only extends the refusal, so every call waits it out here, off the network.
  const pausedForMs = relayPausedUntil - Date.now();
  if (pausedForMs > 0) {
    return Err({ kind: 'rate-limit', retryAfterMs: pausedForMs });
  }

  // Single-model V1: gpt-oss-20b for every call. `fastMode` parameter is
  // retained on the public signature for caller back-compat but ignored.
  void fastMode;
  const model = opts.model ?? GROQ_FAST_MODEL;

  // caller-supplied max_tokens override.
  //
  // Default 4096 is a generous ceiling, not a cost: real spend is on tokens
  // actually generated, so a high cap only guards against response truncation
  // (the `json_validate_failed` failure mode when output is clipped mid-JSON).
  // Batch callers pass an explicit value (typically 2048); single-post
  // COMBINED uses this default.
  const maxTokens = typeof opts.maxTokens === 'number' && opts.maxTokens > 0
    ? Math.floor(opts.maxTokens)
    : 4096;

  // The last check before anything leaves: a caller that replaced names says which ones, and a
  // whole-token hit in the user message means the replacement missed one. The message names no
  // identifier. A build with no id is a test or a harness and refuses; a shipped build counts the
  // hit and goes on, because the check can false-alarm and a refusal would cost the reading.
  const identifierHits = opts.knownIdentifiers && opts.knownIdentifiers.length > 0
    ? countIdentifierHits(user, opts.knownIdentifiers)
    : 0;
  if (identifierHits > 0) {
    noteIdentifierHits(identifierHits);
    if (getBuildId() === '') {
      console.error(`[FeelingWise] AI request refused: ${identifierHits} known identifier(s) still in the message`);
      return Err({ kind: 'internal-error', status: 0, code: 'identifier-in-request' });
    }
    console.warn(`[FeelingWise] AI request still carries ${identifierHits} known identifier(s)`);
  }

  // Every attempt below logs under this one id, so the debug tab can count a retried call once.
  const callId = newCallId();

  // First attempt: with JSON mode if requested.
  let first = await callProxyOnce(system, user, bearer, fingerprint, model, jsonMode, maxTokens, opts.signal, opts.onCallMeta, opts.jsonSchema, identifierHits, callId);

  // Higher-level transient retry: rate-limit, 5xx and network get one more
  // attempt with backoff before being surfaced as a permanent failure.
  // Genuinely permanent failures (auth-refusal, content-policy, cap-exhausted,
  // json-refusal, aborted) are NOT retried.
  //
  // `network` was in the permanent set until 2026-08-02, when a day's
  // diagnostic showed 40 network failures, 36 of them inside one hour — a
  // socket hang-up or a DNS blip is exactly the kind of failure a second
  // attempt clears, and each unretried one costs a post its judgement. The
  // added latency is bounded by design and not by hope: after three failures
  // in ten seconds the caller's own circuit breaker arms and skips the call
  // entirely, so a real outage pays this backoff a few times, not per post.
  const relayPaused = Date.now() < relayPausedUntil;
  if (!first.ok && !relayPaused && (first.error.kind === 'rate-limit' || first.error.kind === 'transient-http' || first.error.kind === 'network')) {
    if (first.error.kind === 'rate-limit') {
      const wait = Math.min(first.error.retryAfterMs ?? 1000, 60_000);
      await sleep(wait);
    } else {
      await sleep(750);
    }
    first = await callProxyOnce(system, user, bearer, fingerprint, model, jsonMode, maxTokens, opts.signal, opts.onCallMeta, opts.jsonSchema, identifierHits, callId);
  }

  if (first.ok) return first;

  // on JSON-mode refusal, retry once without `response_format`
  // so the 3-tier parser in neutralizer.ts can extract whatever JSON the model
  // emits in prose. This recovers ~80% of refusals (model produces valid JSON
  // when not explicitly gated on server-side validation). Only retry when
  // first attempt was in JSON mode — otherwise retry would be identical.
  if (jsonMode && first.error.kind === 'json-refusal') {
    console.warn('[FeelingWise] groq JSON-mode refusal — retrying without JSON constraint.');
    return callProxyOnce(system, user, bearer, fingerprint, model, false, maxTokens, opts.signal, opts.onCallMeta, undefined, identifierHits, callId);
  }

  return first;
}

const warnedOfCallFailure = new Set<string>();

let callSeq = 0;
/** Unique across the tabs that share one telemetry buffer, not only within this one. */
function newCallId(): string {
  callSeq += 1;
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${callSeq.toString(36)}`;
}

/** The worker's own 401 codes: the only 4xx that mean the licence. */
const PROXY_LICENCE_CODES: ReadonlySet<string> = new Set([
  'missing_auth', 'invalid_license_format', 'license_not_found',
  'license_revoked', 'license_expired', 'tier_mismatch',
]);
const warnedRequestRejectedCodes = new Set<string>();

async function callProxyOnce(
  system: string,
  user: string,
  licenseBearer: string,
  fingerprint: string,
  model: string,
  jsonMode: boolean,
  maxTokens: number,
  signal: AbortSignal | undefined,
  onCallMeta?: (meta: GroqCallOutcome) => void,
  jsonSchema?: { name: string; schema: Record<string, unknown> },
  identifierHits = 0,
  callId?: string,
): Promise<Result<string, AIFailure>> {
  try {
    // gpt-oss family requires reasoning_effort='low' for reliable strict-JSON
    // output. Default 'medium' burns the reasoning budget before the
    // final-channel JSON emits, producing forum-documented
    // `json_validate_failed` errors. `include_reasoning: false` keeps the
    // reasoning channel out of the answer content so the existing JSON
    // parser at neutralizer.ts doesn't choke on think-tags. Mirrors the
    // params used by the c100 multi-variant harness when it measured
    // gpt-oss-120b at F1≈0.48-0.51 — production was previously missing
    // both fields, so the production path under-performed harness numbers.
    // See docs/audit-2026-05-27/08-provider-prompt-specs.md §GPT-OSS-120B
    // for the full param rationale.
    // Dormant model-swap path: re-enabled by setting GROQ_FAST_MODEL=openai/gpt-oss-*
    // (see ARCHITECTURE.md). Leave intact.
    const isGptOss = /gpt-oss/.test(model);
    const requestBody: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      // temperature pinned to 0 + fixed seed for
      // determinism. The first live test surfaced "two-step
      // rewrites" where the same post was first rewritten then replaced
      // by a fold placeholder a few seconds later. Root cause: the model
      // has default sampling randomness (temperature=1.0), so concurrent
      // or sequential calls on the same input can produce different
      // action labels and rewrites. For a classification task this is
      // wrong — we want "same input → same verdict". Setting temp=0
      // makes the verdict deterministic, eliminating the flip even when
      // X virtualization re-extracts a post for a fresh DOM node.
      // Seed: defensive — Groq honors it when supported, ignored
      // otherwise. Doesn't hurt either way.
      temperature: 0,
      seed: 42,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      ...(jsonSchema
        ? { response_format: { type: 'json_schema', json_schema: { name: jsonSchema.name, strict: true, schema: jsonSchema.schema } } }
        : jsonMode ? { response_format: { type: 'json_object' } } : {}),
      ...(isGptOss ? { reasoning_effort: 'low', include_reasoning: false } : {}),
    };
    // End-to-end latency anchor — captured before the request leaves the
    // sandbox so the `latencyMs` field in groq-telemetry reflects total
    // wall-clock cost (DNS + TLS + server + body parse). TTFT is out of
    // scope this turn (would require streaming).
    // The person's go-ahead for the paid reading rides with every call; the proxy keeps the first
    // it sees. callAIInner already refused a key with none, so it is always here.
    const consent = await getReadingConsent(licenseBearer);
    const t0 = Date.now();
    const sent = await withProxyFetchSlot(async () => {
      // A call that waited for its turn while another met a 429 does not add to it: it goes back to its caller as the
      // same refusal, which waits out the Retry-After and tries once more.
      const waitMs = rateLimitedUntil - Date.now();
      if (waitMs > RATE_LIMIT_PAUSE_SLACK_MS) return waitMs;
      const answered = await relayFetch(PROXY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${licenseBearer}`,
          ...(consent ? { [READING_CONSENT_HEADER]: consentHeaderValue(consent) } : {}),
        },
        body: JSON.stringify(requestBody),
        // The worker carries this call out (relay-fetch.ts). Where it goes out from a page instead, without a policy of
        // its own the browser would attach that page's address as the referrer, under the site's rules, not ours.
        referrerPolicy: 'no-referrer',
      }, PROXY_TEXT_DEADLINE_MS, signal);
      // Set before the slot is let go, so the call queued behind this one meets the pause and not the same refusal. Only a
      // plain rate limit pauses everyone: a licence cap and the failed-keys refusal have latches of their own, and the
      // first is bound to the key that earned it.
      if (answered.status === 429) {
        let code: unknown;
        try {
          const body = await answered.clone().json();
          code = body?.error?.code ?? body?.code;
        } catch { /* body unreadable / not JSON: a plain rate limit */ }
        if (code !== 'cap_daily' && code !== 'cap_monthly' && code !== TOO_MANY_FAILED_KEYS) {
          rateLimitedUntil = Date.now() + Math.min(parseRetryAfterMs(answered.headers.get('Retry-After')) ?? RATE_LIMIT_PAUSE_DEFAULT_MS, RATE_LIMIT_PAUSE_MAX_MS);
        }
      }
      return answered;
    });
    if (typeof sent === 'number') {
      lastCallMeta = null;
      return Err({ kind: 'rate-limit', retryAfterMs: sent });
    }
    const res = sent;
    // A relay that answers at all, with an error below 500 included, is there; one that fails, or does not answer, several
    // times in a row is told to the person (storage/reading-trouble.ts).
    if (res.status >= 500) noteReadingFailure();
    else noteReadingAnswered();
    // A reading that came back is the best check there is that this key is accepted (the header chip takes it when the models list gives none).
    if (res.ok) noteReadingGotThrough(fingerprint);
    const retryAfterMs = parseRetryAfterMs(res.headers.get('Retry-After')) ?? null;
    if (!res.ok) {
      lastCallMeta = null;
      // Non-2xx: record telemetry with whatever the response carries (Groq
      // sets `x-request-id` + region on error responses too, so the entry
      // is still useful for support correlation).
      void recordGroqCallTelemetry(
        buildGroqCallTelemetry({
          model,
          status: res.status,
          headers: res.headers,
          body: undefined,
          latencyMs: Date.now() - t0,
          identifierHits,
          retryAfterMs,
          callId,
        }),
      );
      // 429 from the proxy carries a body code that distinguishes proxy-
      // enforced license caps (cap_daily / cap_monthly — permanent for the
      // billing period) from Groq's rate-limit (transient, retry-after).
      // Read the body once; on parse failure assume Groq-style rate-limit.
      if (res.status === 429) {
        let capKind: 'daily' | 'monthly' | null = null;
        try {
          const body = await res.clone().json();
          const code = body?.error?.code ?? body?.code;
          if (code === TOO_MANY_FAILED_KEYS) relayPausedUntil = Date.now() + (retryAfterMs ?? RELAY_PAUSE_DEFAULT_MS);
          if (code === 'cap_daily') capKind = 'daily';
          else if (code === 'cap_monthly') capKind = 'monthly';
        } catch {
          // body unreadable / not JSON — fall through to rate-limit
        }
        if (capKind) {
          noteTextCapReached(capKind, fingerprint);
          return Err({ kind: 'cap-exhausted', cap: capKind });
        }
        return Err({ kind: 'rate-limit', retryAfterMs: retryAfterMs ?? 5_000 });
      }
      // 503 usage_coordinator_unavailable = the proxy's Durable Object
      // binding is broken (deploy fault), not a blip. Distinct kind so the
      // retry allowlist skips it (a per-post retry storm helped nobody) and
      // the console names the real failure.
      if (res.status === 503) {
        try {
          const body = await res.clone().json();
          if ((body?.error?.code ?? body?.code) === 'usage_coordinator_unavailable') {
            console.error('[FeelingWise] proxy usage coordinator unavailable — AI check skipped, not retrying');
            return Err({ kind: 'coordinator-unavailable' });
          }
        } catch {
          // body unreadable — fall through to the generic 5xx handling
        }
      }
      if (res.status >= 500) {
        return Err({ kind: 'transient-http', status: res.status, retryAfterMs: retryAfterMs ?? undefined });
      }
      if (res.status === 451) {
        return Err({ kind: 'content-policy' });
      }
      // 4xx other than 429/451. The proxy returns 401 with one of its own
      // codes (missing_auth / invalid_license_format / license_not_found /
      // license_revoked / license_expired / tier_mismatch) for a licence
      // problem, and relays Groq's status and body unchanged for everything
      // else (400 json_validate_failed, 413, 422). Only the first is a
      // licence refusal; a bare 401/403 with no readable code is treated as
      // one too. The rest is our request being refused: named in the console
      // once per code, and never counted against the key. Item 3c.
      let code: string | undefined;
      try {
        const body = await res.clone().json();
        const c = body?.error?.code ?? body?.code;
        if (typeof c === 'string') code = c;
      } catch {
        // body unreadable — decide on the status alone
      }
      // The reading has not been started from the extension (the relay asks every key for the go-ahead from 12 Oct 2026):
      // a thing for the person to do, not a refusal of the key and not our request being wrong.
      if (res.status === 403 && code === 'consent_required') {
        noteReadingPaused(fingerprint);
        return Err({ kind: 'consent-required' });
      }
      if ((code !== undefined && PROXY_LICENCE_CODES.has(code))
        || (code === undefined && (res.status === 401 || res.status === 403))) {
        if (code !== undefined) noteLicenseRefused(fingerprint, code);
        return Err({ kind: 'auth-refusal' });
      }
      if (!warnedRequestRejectedCodes.has(code ?? String(res.status))) {
        warnedRequestRejectedCodes.add(code ?? String(res.status));
        console.warn(`[FeelingWise] proxy relayed HTTP ${res.status}${code ? ` (${code})` : ''}: the request was refused, not the licence. Not retried.`);
      }
      return Err({ kind: 'internal-error', status: res.status, code });
    }
    const data = await res.json();
    // The relay answered a reading: whatever paused this key for the go-ahead has been put right (by another page, say).
    void clearReadingPause();
    // Hand the caller its OWN call's finish_reason before this attempt's
    // value (or error) is returned. Fired here, on the parsed 2xx body, so a
    // caller that must distinguish a max_tokens cut from a malformed reply
    // reads a per-call fact instead of a racy module global.
    if (onCallMeta) {
      const finishReason: string | null = data.choices?.[0]?.finish_reason ?? null;
      try {
        onCallMeta({
          finishReason,
          truncated: finishReason === 'length',
          completionTokens: data.usage?.completion_tokens || 0,
          maxTokens,
        });
      } catch { /* a caller's sink must never break the call path */ }
    }
    // Record telemetry after a successful parse on the 2xx path. Captures
    // actual token usage + system_fingerprint + finish_reason that only the
    // body provides, in addition to the response headers.
    void recordGroqCallTelemetry(
      buildGroqCallTelemetry({
        model,
        status: res.status,
        headers: res.headers,
        body: data,
        latencyMs: Date.now() - t0,
        retryAfterMs,
        identifierHits,
        callId,
      }),
    );
    if (data.error) {
      const msg: string = data.error.message ?? String(data.error);
      // Distinguish JSON-mode refusal (retryable) from other errors (not
      // retryable). JSON-mode refusals are observed on Groq for hot-button
      // content (originally calibrated against llama-3.1-8b-instant; the
      // same refusal pattern occurs on gpt-oss-120b at lower rates); the
      // prose path often succeeds.
      const isJsonRefusal = /Failed to generate JSON/i.test(msg) || /json_validate_failed/i.test(msg);
      if (isJsonRefusal) {
        // Quiet log (expected) — caller decides whether to retry.
        lastCallMeta = null;
        return Err({ kind: 'json-refusal' });
      }
      // The provider's message can repeat what it was sent: the error is always shown, its text only behind the
      // debug switch.
      console.error('[FeelingWise] the AI provider answered with an error');
      fwDebug('[FeelingWise] the provider\'s error text:', msg);
      lastCallMeta = null;
      // Body-level error after a 2xx; treat as content-policy when the
      // message indicates safety-filter trip, otherwise generic network.
      if (/content[_\s-]?policy|safety|moderation/i.test(msg)) {
        return Err({ kind: 'content-policy' });
      }
      return Err({ kind: 'network', message: msg });
    }
    // Metering is a message to the service worker (the single counter
    // writer); a lost increment is logged there and the verdict still
    // ships. The proxy counts every 2xx as one daily call plus the
    // direction-weighted token-equivalents, so this does the same
    // (usage-weights.ts); the proxy's own cap remains the hard stop.
    const promptTokens = data.usage?.prompt_tokens || 0;
    const completionTokens = data.usage?.completion_tokens || 0;
    // The upstream reports what it actually charged. The proxy meters the higher of that
    // and the shared rate table, so this side has to do the same or the popup shows room
    // the proxy has already spent, which is the exact drift the byte-identical
    // usage-weights pair exists to prevent.
    const estimatedCost = typeof (data.usage as { estimated_cost?: unknown } | undefined)?.estimated_cost === 'number'
      ? (data.usage as unknown as { estimated_cost: number }).estimated_cost
      : undefined;
    // Who answered, as the proxy names it on the reply. The record carries this,
    // and the exported methodology block says the per-record stamp is what counts,
    // so it has to be read rather than assumed.
    //
    // It WAS assumed: this line hardcoded 'groq' for anything that was not the
    // Workers AI rung, which silently became a false statement the day the
    // upstream moved to DeepInfra (2026-09-21). The proxy now names the provider
    // on every reply, from the same place it reads the upstream URL. The fallback
    // here is for a reply from a proxy older than that change, which can only be
    // Groq, because that is what every proxy before it talked to.
    const namedProvider = res.headers.get('x-fw-provider');
    const provider = namedProvider && namedProvider.trim() !== '' ? namedProvider.trim() : 'groq';
    // Caught here, deliberately. The paragraph above is the contract: a lost
    // increment must not cost the verdict. Since 2026-09-18 the single counter
    // writer REFUSES to write a count computed from the synthetic fail-closed
    // settings snapshot, because doing so replaced the install's real total
    // with 1 instead of adding to it (storage/settings.ts, applyUsageIncrement).
    // That refusal is a throw, and this call sits before the return, so without
    // this catch a storage read blip would turn a dropped count into a dropped
    // judgement, and the reader would lose the protection rather than a number.
    try {
      await recordAiCall({
        inputTokens: promptTokens,
        outputTokens: completionTokens,
        // With the model: the 120b judge costs twice the 20b in both directions, and leaving it out
        // metered every 120b call at half (PLAN-2026-09-16 item 6.9). The proxy always weighed it by
        // model, so the popup showed room the proxy had already spent.
        tokenEquivalents: meteredTokenEquivalents(promptTokens, completionTokens, model, estimatedCost),
        provider,
        model,
      });
    } catch (meterErr) {
      console.warn('[FeelingWise] the AI call was not metered locally; the verdict still ships:', meterErr);
    }
    const text = data.choices?.[0]?.message?.content ?? '';
    if (text) {
      // The model the reply names, because the proxy answers a model it does not allow with its
      // default one; the model asked for is kept only for a reply that names none.
      const answeredModel = typeof data.model === 'string' && data.model.trim() !== '' ? data.model.trim() : model;
      lastCallMeta = { model: answeredModel, provider };
      noteCallProvenance(signal, lastCallMeta);
      return Ok(text);
    }
    lastCallMeta = null;
    return Err({ kind: 'network', message: 'empty response body' });
  } catch (error: unknown) {
    // Fetch threw (DNS, TLS, socket-hang-up, etc.) — no response, so no
    // telemetry entry. The error-path skip is by design: telemetry exists
    // to characterize Groq's response surface, not to log local network
    // failures.
    lastCallMeta = null;
    // AbortError surfaces as typed Err so upstream cascade can distinguish
    // signal-driven cancellation from other network failures.
    if (error instanceof Error && error.name === 'AbortError') {
      return Err({ kind: 'aborted' });
    }
    // The deadline is a network failure from the cascade's point of view:
    // the slot is freed, the retry allowlist applies, and the record says
    // the vendor did not answer in time.
    if (error instanceof DeadlineError) {
      console.warn(`[FeelingWise] proxy call exceeded ${error.deadlineMs} ms; treating as a network failure`);
      noteReadingFailure();
      return Err({ kind: 'network', message: error.message });
    }
    noteReadingFailure();
    const message = error instanceof Error ? error.message : undefined;
    // One line per kind of failure, so a call that fails before the relay answers says how (the Tester's twenty-fifth read
    // saw five of them at Silent and nothing on the page to tell them apart); the worker's refusals name their cause besides.
    const said = error instanceof Error ? `${error.name}: ${error.message}` : 'not an error object';
    if (!warnedOfCallFailure.has(said)) {
      warnedOfCallFailure.add(said);
      console.warn(`[FeelingWise] a reading call failed before the relay answered (${said})`);
    }
    return Err({ kind: 'network', message });
  }
}
