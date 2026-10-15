// FeelingWise — Cloudflare Worker proxy.
//
// Phase 2: license-key auth + per-license cap enforcement on top of the
// Phase 1 Groq pass-through.
//
// Flow per request:
//   1. Parse `Authorization: Bearer fw-<tier>-<secret>` → reject malformed (401).
//   2. KV lookup against LICENSES namespace → reject if missing or revoked (401);
//      a `rev:<key>` tombstone counts as revoked whatever the record says.
//   3. Reset daily counter if past UTC midnight; reset monthly if past month
//      boundary. Reject if cap exceeded (429).
//   4. Parse the chat JSON, reject streaming, pin the production model, then
//      forward to Groq with the master key.
//   5. Buffer the Groq response just long enough to read split usage fields.
//      Schedule the counter update via ctx.waitUntil so response returns to
//      caller without waiting on the KV write.
//   6. Return the buffered response to the extension.
//
// Privacy invariants (verifiable from this source file):
//   - Chat request bodies are buffered only long enough to enforce the route
//     contract; request content is never logged or persisted.
//   - Response bodies are buffered ONLY to extract token counts; the body
//     itself is not written to KV, logs, or any storage.
//   - The master Groq key is read from env.GROQ_API_KEY (Worker secret).
//   - No license key, customer email, or request content appears in
//     `wrangler tail` log lines — only license-key fingerprints (the tier and
//     six hex characters of the key's SHA-256) for support correlation.

import { handleRepairs } from './repairs';
import { handleDomReport } from './report-intake';
import {
  nextPeriodStartIso,
  reconcileCounterState,
  reserveCounterState,
  type ReconcileCounterInput,
  type ReserveCounterInput,
  type ReserveCounterResult,
} from './license-counter-state';
import type { CounterInspection, CounterSnapshot } from './license-counter';
import {
  GROQ_BLENDED_RATE_PER_1M_USD,
  chatTokenEquivalents,
  meteredTokenEquivalents,
  claudeTokenEquivalents,
} from './usage-weights';
import {
  chatResponseFromWorkersAi,
  fallbackEnabled,
  PROVIDER_HEADER,
  shouldFallBack,
  workersAiRequest,
  workersAiTokenEquivalents,
  WORKERS_AI_MODEL,
} from './ai-fallback';
import { entitlementsPayload, featuresForVariant, featuresOf, holdsFeature, READING_FEATURE, signEntitlements } from './entitlements';
import {
  CLAUDE_JUDGE_HASH,
  CLAUDE_MAX_OUTPUT_TOKENS,
  CLAUDE_MODEL,
  CLAUDE_PROVIDER,
  claudeRequest,
  readClaudeAnswer,
  readItem,
} from './claude-judge';

export interface Env {
  GROQ_API_KEY: string;
  GROQ_UPSTREAM_URL: string;
  GROQ_MODELS_URL: string;
  LICENSES: KVNamespace;
  LICENSE_COUNTER?: {
    getByName(name: string): {
      reserve(input: ReserveCounterInput): Promise<ReserveCounterResult>;
      reconcile(input: ReconcileCounterInput): Promise<CounterSnapshot | null>;
      inspect(): Promise<CounterInspection | null>;
    };
  };
  // The Workers Rate Limiting binding that counts unknown keys per address (authenticate). Absent means the
  // relay counts in each isolate alone.
  AUTH_FAILURE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  // The Workers Rate Limiting binding that counts "this broke" reports per sender (report-intake.ts). Absent means the
  // relay counts in each isolate alone.
  REPORT_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  // Operator visibility (2026-08-23): bearer token for GET /admin/licenses.
  // Set via `wrangler secret put ADMIN_TOKEN`. When unset the route answers
  // 503 and nothing is listed: the estate is never readable by accident.
  ADMIN_TOKEN?: string;
  // Phase 4: Lemon Squeezy webhook HMAC secret. Set via
  // `wrangler secret put LEMONSQUEEZY_WEBHOOK_SECRET`. Used to verify
  // X-Signature header on incoming webhook POSTs.
  // Stamped by worker/scripts/deploy.mjs as a --var so /health names the code
  // that is actually running. Optional because a bare `wrangler deploy` sets
  // nothing, and /health then reads 'unstamped', which is the honest answer
  // rather than the previous deploy's label.
  DEPLOY_STAMP?: string;
  LEMONSQUEEZY_WEBHOOK_SECRET: string;
  // Phase 4: Resend.com API key for transactional email. Optional to the type
  // system and required in practice since 2026-09-18: with it unset the
  // webhook still mints and persists the keys, but the welcome cannot be sent,
  // so the delivery is written to the `owed:<subscription_id>` ledger and the
  // webhook answers non-2xx rather than telling the payment provider a
  // delivery succeeded that nobody received. Every retry then fails the same
  // way until the secret is set, and GET /admin/licenses lists the debt under
  // `undelivered`. Set it with `wrangler secret put RESEND_API_KEY`.
  RESEND_API_KEY?: string;
  // The judge's second rung (docs/design/JUDGE-AVAILABILITY-2026-09-07.md):
  // Workers AI serving the same gpt-oss weights inside this Worker when Groq
  // does not answer. `AI` is the binding from wrangler.toml; `AI_FALLBACK` is
  // 'on' or anything else (off). Off until the dev-split run on this host is
  // on file; a stranger's export must not carry a verdict from an unmeasured
  // host without the record saying so, which the provider header makes true.
  AI?: { run(model: string, input: Record<string, unknown>): Promise<unknown> };
  AI_FALLBACK?: string;
  // The company that reads the text, by its legal name and country, as the licence probe serves it
  // and as the consent screen shows it. It lives here and not in the extension so that a change of
  // provider needs no new build; a changed name asks every key for a new consent.
  PROVIDER_LEGAL_NAME?: string;
  // Until this moment (ISO 8601) a paid call with no consent is still served: the version already
  // installed has no screen to ask with, and Chrome replaces it only after the store publishes the
  // one that asks. Unset or unreadable means the consent is required now.
  CONSENT_REQUIRED_FROM?: string;
  // Ed25519 private key (a JWK) that signs GET /v1/entitlements, so the extension can trust a cached
  // list of what a key turns on. Set with `wrangler secret put ENTITLEMENTS_SIGNING_KEY`. Unset means
  // the route answers 503 and no list: an unsigned list would be worth nothing to the extension.
  ENTITLEMENTS_SIGNING_KEY?: string;
  // Which features each shop product sells: JSON, Lemon Squeezy variant id -> feature list, set in
  // wrangler.toml [vars] once the products exist. A key is minted with its variant's list, and a plan
  // change rewrites the list on the subscription's live keys. Unset, unreadable or unmapped means
  // ["reading"] (worker/src/entitlements.ts featuresForVariant).
  PLAN_FEATURES?: string;
  // The Claude reading (POST /v1/claude/verdict). The key is a Worker secret, set with
  // `wrangler secret put ANTHROPIC_API_KEY`; the company's name is a var, shown on the consent screen
  // the way PROVIDER_LEGAL_NAME is. Without both the route answers 503 and the extension keeps the
  // ordinary reading, so the code can ship before anyone turns it on.
  ANTHROPIC_API_KEY?: string;
  CLAUDE_PROVIDER_LEGAL_NAME?: string;
  // The relay's own ceiling for the Claude reading across every key, in USD per UTC calendar month
  // (CLAUDE_MONTHLY_USD_CAP_DEFAULT when unset). The operator's API account carries the real stop; this one
  // keeps the relay's share of it small whatever the number of paid keys.
  CLAUDE_MONTHLY_USD_CAP?: string;
  // The first moment the Claude reading may run, as an ISO time. The privacy page promises a notice 30
  // days before a material change takes effect; the page named the second company on 11 Oct 2026, so the
  // route stays shut, and the licence probe does not offer it, before then (the operator's decision, 11 Oct 2026).
  // Unset means no hold; a value that is not a time holds the route shut.
  CLAUDE_STARTS_AT?: string;
}

// ─── License model ─────────────────────────────────────────────────────────
//
// Mirrors src/storage/license.ts on the extension side. Keep these two
// definitions in sync — any divergence breaks the client-side cap-check
// short-circuit at src/ai/client.ts:179-187.

// `dev` is the founder/internal-testing tier: uncapped daily + monthly. Keys
// are hand-seeded into KV (never minted by the Lemon Squeezy webhook), so a
// forged `fw-dev-*` key still fails auth — `loadLicense` returns null without
// a matching KV record. Mirrors src/storage/license.ts.
type LicenseTier = 'starter' | 'family' | 'extended' | 'dev';
type LicenseStatus = 'active' | 'revoked';

interface LicenseRecord {
  tier: LicenseTier;
  status: LicenseStatus;
  customer_email: string;
  issued_at: string;          // ISO 8601
  daily_calls: number;
  daily_reset_at: string;     // ISO 8601 — UTC midnight after last reset
  monthly_tokens: number;
  monthly_reset_at: string;   // ISO 8601: the next monthly roll, counted from issued_at (the day paid)
  // Optional hard stop. When present and in the past, `authenticate` refuses
  // the key with 401 `license_expired` — the only mechanism by which a key
  // stops working without someone running a revoke command. Absent on every
  // subscription and review key: those end by cancellation or manual revoke,
  // not by a clock. Set by scripts/mint-trial-license.mjs.
  expires_at?: string;        // ISO 8601
  // Why the store revoked the key, when it was the store (RevokeReason); absent on a key revoked by the operator, a
  // refund or a quantity cut, and cleared on reactivation. The tombstone carries the same reason and outranks it.
  revoke_reason?: RevokeReason;
  // Who holds this key, in the operator's own words ("Jane Doe, Example Daily",
  // "beta tester 3"). Written at mint time and never read by the proxy: it
  // exists so the estate stays attributable from KV alone. Nine review keys
  // issued 2026-05-28 are permanently anonymous because their only record
  // was a local gitignored log that no longer exists on any machine, and
  // recovering a recipient list from memory is not possible.
  note?: string;
  // Last time the proxy confirmed traffic on this key. Advanced by the same
  // throttled write-back that mirrors the counters, so it LAGS by up to the
  // mirror threshold (25 calls / 50k token-equivalents). Absent means "no
  // write-back has ever fired", which for a light user is not the same as
  // unused. Never treat its absence as proof a key is idle.
  last_seen_at?: string;      // ISO 8601
  // Phase 4: Lemon Squeezy subscription this license was minted for. Used
  // by the cancellation handler to find all keys belonging to a cancelled
  // subscription via the subscription→keys index. Optional because pre-
  // Phase-4 manually-seeded keys (the test license + early manual sales)
  // don't carry this field.
  subscription_id?: string;
  // The Lemon Squeezy `updated_at` of the last lifecycle event applied to
  // this key (revoke, period-end cancel, reactivation). Webhook deliveries
  // are not ordered, so a reactivation only applies when its stamp is
  // strictly later than this one; a revocation always applies. Absent on
  // keys that never saw a lifecycle event, and on keys revoked by the
  // operator's scripts, which the webhook may therefore never reactivate.
  lifecycle_at?: string;      // ISO 8601
  // Set by the operator (license-admin.mjs grandfather) on a key that paid and was used before the
  // consent screen existed, so the consent gate serves it without a stored consent.
  consent_grandfathered?: true;
  // What this key turns on ("reading", later "sites:<name>"). Absent means ["reading"]: every key
  // sold before the field existed was sold for the reading. Read through featuresOf in
  // ./entitlements, never directly, so an absent or malformed list has one meaning everywhere.
  features?: string[];
  // The Lemon Squeezy updated_at of the event that last set `features` (mint or plan change).
  // Webhook deliveries are not ordered, so a plan only replaces the list when its event is strictly
  // later than this one: a late delivery of an older event cannot undo a plan change.
  features_at?: string;
}

// Format mirrors LICENSE_KEY_REGEX in src/storage/license.ts:38.
const LICENSE_KEY_PATTERN = /^fw-(starter|family|extended|dev)-([a-z0-9]{8,32})$/i;
const BEARER_PATTERN = /^Bearer\s+(.+)$/i;

// Per-tier daily call cap. Mirrors DAILY_CAP_BY_TIER in license.ts:51.
// Family/Extended honor-system multi-user: one license shared across
// installs uses one shared daily cap. Pricing/cap reform happens in
// Phase 5; for now these match the client-side fallback.
const DAILY_CALL_CAP_BY_TIER: Readonly<Record<LicenseTier, number>> = {
  starter: 2000,
  family: 2000,
  extended: 2000,
  // Uncapped founder/testing tier. `checkCap` bypasses the comparison for
  // `dev` outright; this large-but-finite value is the backstop.
  dev: 1_000_000,
};

// Per-license monthly USD cap — the ALL-AI solvency ceiling. $3.50 since 9 Oct 2026 (was $5): at
// $5 a key that ran to the cap cost more than a 6 euro sale brings in after VAT and the shop's fees;
// at $3.50 no sale loses money in any EU country, and the most any real month has cost is $2.60
// (the operator's cost table). Every AI call meters through this one
// counter via recordUsage(), so when total spend hits the cap every AI path pauses (DOM-only
// protection continues). Mirrors license.ts LICENSE_TIER_CAPS.
const MONTHLY_USD_CAP_BY_TIER: Readonly<Record<LicenseTier, number>> = {
  starter: 3.5,
  family: 3.5,
  extended: 3.5,
  // Uncapped founder/testing tier (see DAILY_CALL_CAP_BY_TIER.dev).
  dev: 1_000_000,
};

// Rate that converts the dollar cap to a token-equivalent cap. The counter
// accumulates cost-weighted token-equivalents so a dollar counted means at most a dollar
// actually spent: openai/gpt-oss-20b costs $0.075/M prompt and $0.30/M
// completion tokens (Groq pricing, live-verified 2026-07-13), and chat usage is
// weighted by direction against this $0.10/M counter basis.
// At the $3.50 cap this allows 35M token-equivalents/month; the heaviest real month measured
// cost $2.60 (an internal testing key, 1 to 5 Oct 2026, with test runs).
// The rates and factors live in ./usage-weights.ts, a byte-identical copy of
// src/ai/usage-weights.ts so the extension's local counter weighs every call
// the way this counter does (tests/unit/usage-weights-parity.test.ts).
// GROQ_BLENDED_RATE_PER_1M in src/storage/license.ts mirrors the basis.

// Q19: the one externally-visible version string, and the only thing that
// answers "which code is live" without a Cloudflare login.
//
// It was a hand-typed constant with a comment telling the next person to bump
// it on every deploy. That comment already recorded one failure (it read
// 'phase-4' for months after phase 5 shipped) and it failed the same way
// again: on 2026-09-20 a deploy of that day's code still answered with the
// September 4th label. An instruction to remember something is not a
// mechanism, which is this repository's oldest lesson. The stale literal
// itself is deliberately not quoted here: the guard that forbids it in this
// file searches the file, and a comment holding the example would fail it.
//
// Stamped at deploy time now, from the commit, by worker/scripts/deploy.mjs.
// An unstamped deploy says so rather than repeating the last true answer.
// Nothing branches on it: it is a label a person reads.
function deployStamp(env: Env): string {
  const stamp = (env.DEPLOY_STAMP ?? '').trim();
  return stamp === '' ? 'unstamped' : stamp;
}

// Who answered, named on every reply rather than assumed by the reader.
//
// This used to be sent only when the Workers AI rung answered, and the extension
// inferred the normal case by hardcoding the string 'groq'. That inference was
// wrong the moment the upstream moved to DeepInfra on 2026-09-21, and it was
// wrong in the one place it must not be: the exported forensics record names the
// per-record model and provider stamp as authoritative, so a person checking a
// record would have been told the wrong company read their text. Naming it here,
// from the same place GROQ_UPSTREAM_URL is read, makes that class of drift
// impossible rather than merely fixed once.
const UPSTREAM_PROVIDER_NAME = 'deepinfra';

const CHAT_MODEL = 'openai/gpt-oss-20b';
// The models a client may ask for by name. The adult judge (2026-09-03,
// docs/research/accuracy-2026-09-03/RESULTS.md) runs on gpt-oss-120b; every
// other call takes CHAT_MODEL. Anything else in the body is pinned to CHAT_MODEL
// so a stolen key cannot pick a dearer model. Metering reads the model back
// (chatTokenEquivalents), so the 120b pays its own price against the cap.
// google/gemma-4-31B-it joined on 2026-09-21 as the second judge of JUDGE-V1-PAIR
// (src/core/judge-pair.ts). It must be here or the pin below silently sends it back to
// the 20b and the whole instrument measures something nobody asked for, while reporting
// perfectly healthy numbers. tests/private/worker/worker-proxy-caps.test.ts locks it.
const CHAT_MODELS_ALLOWED: ReadonlySet<string> = new Set([
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
  'google/gemma-4-31B-it',
]);
const CHAT_DEFAULT_MAX_TOKENS = 4096;
// Q17: chat and TSA used to read arbitrarily large bodies fully into memory
// before failing. The biggest legitimate chat body is a 25-comment batch
// prompt, far under 256 KB; a TSA request is a 64-char hash in JSON.
const CHAT_MAX_BODY_BYTES = 256 * 1024;
const TSA_MAX_BODY_BYTES = 4 * 1024;
// The webhook is the one route no bearer token guards: anybody on the
// internet can POST to it, and the signature cannot be checked without first
// having the body, so the size bound is the only defence that runs before
// the body is in memory. A Lemon Squeezy subscription event with a hundred
// seats is a few kilobytes (adversarial read, 2026-09-18).
const WEBHOOK_MAX_BODY_BYTES = 64 * 1024;
// Q16: hard ceiling on client-controlled output budget. The extension asks
// for at most CHAT_DEFAULT_MAX_TOKENS; anything above is a stolen key
// trying to buy bigger completions on FW's bill.
const CHAT_MAX_OUTPUT_TOKENS = CHAT_DEFAULT_MAX_TOKENS;

const CLAUDE_UPSTREAM_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
// A forced tool answer of a few dozen tokens comes back in seconds. Past this the extension is better
// served by the ordinary reading than by waiting.
const CLAUDE_TIMEOUT_MS = 15_000;
// The Claude reading stops when a key has used this share of its monthly cap, so the ordinary reading
// keeps the rest of the month. A month that heavy then ends on today's reading instead of on none.
const CLAUDE_MONTHLY_SHARE = 0.8;

// The ceiling across every key (11 Oct 2026, the operator's decision: an API account is never taken past 195 USD a
// month). One name on the shared counter for all keys, counted in token-equivalents at Haiku's prices, per
// UTC calendar month; reserved before the key's own share, released when the key's share refuses. The
// extension already reads claude_paused_near_cap and stops asking for an hour at a time.
const CLAUDE_CEILING_COUNTER_NAME = 'claude-reading:all-keys';
const CLAUDE_MONTHLY_USD_CAP_DEFAULT = 25;

/** The ceiling in USD, or null when the config holds a value that is not a number (the route then refuses). */
function claudeMonthlyUsdCap(env: Env): number | null {
  const raw = env.CLAUDE_MONTHLY_USD_CAP?.trim();
  if (raw === undefined || raw === '') return CLAUDE_MONTHLY_USD_CAP_DEFAULT;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function utcMonthStart(now: Date, monthsAhead = 0): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthsAhead, 1)).toISOString();
}

type ClaudeCeilingReservation = { counterName: string; requestId: string } | null;
type ClaudeCeilingResult =
  | { ok: true; reservation: ClaudeCeilingReservation }
  | { ok: false; reason: 'monthly' | 'unavailable' | 'unset' };

async function reserveClaudeCeiling(
  env: Env,
  requestId: string,
  tokens: number,
  requireAtomicCounter: boolean,
): Promise<ClaudeCeilingResult> {
  const capUsd = claudeMonthlyUsdCap(env);
  if (capUsd === null) return { ok: false, reason: 'unset' };
  const monthlyLimit = Math.floor((capUsd / GROQ_BLENDED_RATE_PER_1M_USD) * 1_000_000);
  if (!env.LICENSE_COUNTER) {
    // Without the shared counter nothing can hold a ceiling across isolates: only a test may go on.
    return requireAtomicCounter ? { ok: false, reason: 'unavailable' } : { ok: true, reservation: null };
  }
  try {
    const now = new Date();
    const result = await env.LICENSE_COUNTER.getByName(CLAUDE_CEILING_COUNTER_NAME).reserve({
      requestId,
      calls: 1,
      tokens,
      dailyLimit: Number.MAX_SAFE_INTEGER,
      monthlyLimit,
      nowIso: now.toISOString(),
      dailyResetAt: utcMonthStart(now, 1),
      monthlyResetAt: utcMonthStart(now, 1),
      baselineDailyCalls: 0,
      baselineMonthlyTokens: 0,
      periodAnchor: utcMonthStart(now),
    });
    return result.ok
      ? { ok: true, reservation: { counterName: CLAUDE_CEILING_COUNTER_NAME, requestId } }
      : { ok: false, reason: 'monthly' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    console.warn(`[proxy] claude-ceiling-reserve-failed error=${message}`);
    return { ok: false, reason: 'unavailable' };
  }
}

function reconcileClaudeCeiling(
  ctx: ExecutionContext,
  env: Env,
  reservation: ClaudeCeilingReservation,
  calls: number,
  tokens: number,
): void {
  if (!reservation || !env.LICENSE_COUNTER) return;
  ctx.waitUntil(
    env.LICENSE_COUNTER.getByName(reservation.counterName)
      .reconcile({ requestId: reservation.requestId, calls, tokens, nowIso: new Date().toISOString() })
      .then(() => undefined)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'unknown';
        console.warn(`[proxy] claude-ceiling-reconcile-failed error=${message}`);
      }),
  );
}

function monthlyTokenCapForTier(tier: LicenseTier): number {
  return Math.floor((MONTHLY_USD_CAP_BY_TIER[tier] / GROQ_BLENDED_RATE_PER_1M_USD) * 1_000_000);
}

// ─── Time helpers ──────────────────────────────────────────────────────────

function nextUtcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

// ─── License-key parsing + fingerprinting ──────────────────────────────────

interface ParsedKey {
  raw: string;          // canonical (lowercased, trimmed) — KV key
  tier: LicenseTier;
  secret: string;       // the post-tier portion
  fingerprint: string;  // what a log line prints in place of the key
}

async function parseLicenseKey(raw: string | null): Promise<ParsedKey | null> {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  const match = trimmed.match(LICENSE_KEY_PATTERN);
  if (!match) return null;
  return {
    raw: trimmed,
    tier: match[1] as LicenseTier,
    secret: match[2],
    fingerprint: await fingerprintKey(trimmed),
  };
}

// Computed once in parseLicenseKey so every log line can name the key synchronously.
function fingerprint(parsed: ParsedKey): string {
  return parsed.fingerprint;
}

// A minted secret is eight characters, so printing any of it gives most or all of a working key
// away. A log line names a key by its tier and six hex characters of its SHA-256 instead: enough to
// tell a few hundred keys apart, while 65,536 possible keys stay behind each one even for someone
// who hashes every eight-character secret.
async function fingerprintKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const hash = Array.from(new Uint8Array(digest).slice(0, 3), byte => byte.toString(16).padStart(2, '0')).join('');
  const match = key.match(LICENSE_KEY_PATTERN);
  return match ? `fw-${match[1]}-sha256:${hash}` : `sha256:${hash}`;
}

// Extract the bearer token from the Authorization header. Returns null when
// the header is missing or malformed.
function extractBearer(headers: Headers): string | null {
  const auth = headers.get('Authorization');
  if (!auth) return null;
  const match = auth.match(BEARER_PATTERN);
  return match ? match[1] : null;
}

// ─── KV operations ─────────────────────────────────────────────────────────

async function loadLicense(env: Env, key: string): Promise<LicenseRecord | null> {
  const raw = await env.LICENSES.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LicenseRecord;
  } catch {
    // KV held a value but it isn't valid JSON — corruption, not a missing key.
    // Returning null degrades to "license not found" (401), which is the safe
    // fail-closed outcome here, but log so the operator can distinguish a
    // corrupted record from a key that never existed.
    console.warn(`[proxy] loadLicense corrupt-record key=${await fingerprintKey(key)}`);
    return null;
  }
}

// ─── Revocation tombstone ──────────────────────────────────────────────────
//
// Workers KV has no compare-and-swap. A revoke is get, set status, put;
// the usage mirror is get, set counters, put of the re-read record. If the
// revoke's put lands between the mirror's get and put, the mirror writes
// the active record back over it and the revoke is lost for good. The
// tombstone `rev:<key>` is written on every revoke and checked by
// `authenticate` before the record's status can grant access, so the
// record's status is no longer the only authority; the mirror also refuses
// to write over a tombstoned key. Only a reactivation that is strictly
// newer than the revocation removes it.
interface RevocationTombstone {
  revoked_at: string;         // ISO 8601, the revocation's lifecycle stamp
  reason?: RevokeReason;
}

// Why the store revoked a key (the open board's R038 follow-up, 15 Oct 2026). 'expired': the subscription ended
// (subscription_expired, or the status expired or unpaid), and the key answers license_expired, so the popup says
// expired and links to getting a key again. 'stopped': a pause or a payment still being retried (paused, past_due),
// which "expired" would misdescribe, so the key answers license_revoked; a stopped key whose subscription then ends
// becomes expired. No reason (the operator, a refund, a quantity cut): license_revoked, never changed by an end.
type RevokeReason = 'expired' | 'stopped';

function isRevokeReason(v: unknown): v is RevokeReason {
  return v === 'expired' || v === 'stopped';
}

function tombstoneKey(licenseKey: string): string {
  return `rev:${licenseKey}`;
}

// The person's request to start the paid reading now. Each reading is paid to the provider as it
// runs, so this record is the fact the 14-day refund rule stands on: present means the reading was
// started. Only the first one seen is kept, and only these fields.
interface ConsentRecord {
  textVersion: string;
  textHash: string;
  at: string;          // when the person pressed the button (the extension's clock)
  provider: string;    // the name shown on the screen, as this proxy served it
  first_seen_at: string; // when the proxy first saw it, on a paid call
  // The consent given after the provider's name changed. The fields above stay as the first one:
  // they are what the refund rule stands on.
  renewed?: { textVersion: string; textHash: string; at: string; provider: string; seen_at: string };
}

/** The provider's name is read back from the licence probe, so it travels as a header. */
const PROVIDER_LEGAL_HEADER = 'x-fw-provider-legal';
const PROVIDER_LEGAL_MAX_CHARS = 120;
const CLAUDE_PROVIDER_LEGAL_HEADER = 'x-fw-claude-provider-legal';

function servedProviderName(env: Env): string | null {
  const name = env.PROVIDER_LEGAL_NAME?.trim();
  return name && name.length <= PROVIDER_LEGAL_MAX_CHARS ? name : null;
}

function consentKey(licenseKey: string): string {
  return `consent:${licenseKey}`;
}

// The Claude reading sends the text to another company, so its consent is asked for and kept on its
// own: a consent for the ordinary reading never starts it, and turning it on asks nobody else again.
function claudeConsentKey(licenseKey: string): string {
  return `consent:claude:${licenseKey}`;
}

function claudeProviderName(env: Env): string | null {
  const name = env.CLAUDE_PROVIDER_LEGAL_NAME?.trim();
  return name && name.length <= PROVIDER_LEGAL_MAX_CHARS ? name : null;
}

function claudeStarted(env: Env, now = Date.now()): boolean {
  const raw = env.CLAUDE_STARTS_AT?.trim();
  if (raw === undefined || raw === '') return true;
  const at = Date.parse(raw);
  return Number.isFinite(at) && now >= at;
}

function claudeConfigured(env: Env): boolean {
  return !!env.ANTHROPIC_API_KEY && claudeProviderName(env) !== null && claudeStarted(env);
}

async function loadConsent(env: Env, storageKey: string): Promise<ConsentRecord | null> {
  const raw = await env.LICENSES.get(storageKey);
  if (!raw) return null;
  try { return JSON.parse(raw) as ConsentRecord; } catch { return null; }
}

/** The X-FW-Consent header: {"v", "h", "at", "p"}; anything else, or any field out of shape, is no consent. */
function parseConsentHeader(value: string | null): Omit<ConsentRecord, 'first_seen_at' | 'renewed'> | null {
  if (!value || value.length > 768) return null;
  try {
    const o = JSON.parse(value) as { v?: unknown; h?: unknown; at?: unknown; p?: unknown };
    if (typeof o.v !== 'string' || o.v.length === 0 || o.v.length > 64) return null;
    if (typeof o.h !== 'string' || !/^[0-9a-f]{64}$/.test(o.h)) return null;
    if (typeof o.at !== 'string' || Number.isNaN(Date.parse(o.at))) return null;
    if (typeof o.p !== 'string' || o.p.length === 0 || o.p.length > PROVIDER_LEGAL_MAX_CHARS) return null;
    return { textVersion: o.v, textHash: o.h, at: o.at, provider: o.p };
  } catch {
    return null;
  }
}

async function loadTombstone(env: Env, licenseKey: string): Promise<RevocationTombstone | null> {
  const raw = await env.LICENSES.get(tombstoneKey(licenseKey));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<RevocationTombstone>;
    // An unreadable stamp still revokes; it only loses the ordering check.
    const tombstone: RevocationTombstone = { revoked_at: typeof parsed.revoked_at === 'string' ? parsed.revoked_at : '' };
    if (isRevokeReason(parsed.reason)) tombstone.reason = parsed.reason;
    return tombstone;
  } catch {
    return { revoked_at: '' };
  }
}

// Reset counters whose reset-timestamp is in the past. Returns the
// post-reset record — does NOT write back to KV (the caller composes
// the final mutation with the post-call increment).
function applyResets(record: LicenseRecord, now: Date): LicenseRecord {
  const next = { ...record };
  if (new Date(record.daily_reset_at).getTime() <= now.getTime()) {
    next.daily_calls = 0;
    next.daily_reset_at = nextUtcMidnight(now).toISOString();
  }
  if (new Date(record.monthly_reset_at).getTime() <= now.getTime()) {
    next.monthly_tokens = 0;
    next.monthly_reset_at = nextPeriodStartIso(record.issued_at, now);
  }
  return next;
}

// True once a time-limited key's `expires_at` has passed. A record without
// the field never expires, so every pre-existing key keeps its behaviour. An
// unparseable timestamp fails CLOSED (treated as expired): a corrupt clock on
// a trial key must not silently promote it to a permanent one.
function licenseExpired(record: LicenseRecord, now: Date): boolean {
  if (!record.expires_at) return false;
  const at = new Date(record.expires_at).getTime();
  if (Number.isNaN(at)) return true;
  return at <= now.getTime();
}

// Cap-check returns null when below cap, or an error code when exceeded.
function checkCap(record: LicenseRecord): 'daily' | 'monthly' | null {
  // Founder/testing tier is never capped.
  if (record.tier === 'dev') return null;
  if (record.daily_calls >= DAILY_CALL_CAP_BY_TIER[record.tier]) return 'daily';
  if (record.monthly_tokens >= monthlyTokenCapForTier(record.tier)) return 'monthly';
  return null;
}

// Legacy usage update for uncapped dev keys and direct module tests. Paid
// production traffic reserves and reconciles through LICENSE_COUNTER instead.
async function recordUsage(
  env: Env,
  key: string,
  callsDelta: number,
  tokensDelta: number,
): Promise<void> {
  const fresh = await loadLicense(env, key);
  if (!fresh) return;            // license deleted mid-call; skip metering
  const now = new Date();
  const resetApplied = applyResets(fresh, now);
  const updated: LicenseRecord = {
    ...resetApplied,
    daily_calls: resetApplied.daily_calls + callsDelta,
    monthly_tokens: resetApplied.monthly_tokens + tokensDelta,
    last_seen_at: now.toISOString(),
  };
  await env.LICENSES.put(key, JSON.stringify(updated));
}

type UsageReservation =
  | { mode: 'legacy' }
  | { mode: 'atomic'; counterName: string; requestId: string };

type UsageReservationResult =
  | { ok: true; reservation: UsageReservation }
  | { ok: false; reason: 'daily' | 'monthly' | 'unavailable' };

async function licenseCounterName(licenseKey: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(licenseKey));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function reserveUsage(
  env: Env,
  auth: AuthSuccess,
  requestId: string,
  tokens: number,
  requireAtomicCounter: boolean,
  // Below 1 for a call that must stop before the cap does (CLAUDE_MONTHLY_SHARE).
  monthlyShare = 1,
): Promise<UsageReservationResult> {
  const monthlyLimit = Math.floor(monthlyTokenCapForTier(auth.record.tier) * monthlyShare);
  if (auth.record.tier === 'dev' || (!env.LICENSE_COUNTER && !requireAtomicCounter)) {
    const overShare = monthlyShare < 1 && auth.record.tier !== 'dev'
      && auth.record.monthly_tokens + tokens > monthlyLimit;
    const cap = checkCap(auth.record) ?? (overShare ? 'monthly' : null);
    return cap
      ? { ok: false, reason: cap }
      : { ok: true, reservation: { mode: 'legacy' } };
  }
  if (!env.LICENSE_COUNTER) return { ok: false, reason: 'unavailable' };

  try {
    const counterName = await licenseCounterName(auth.parsed.raw);
    const result = await env.LICENSE_COUNTER.getByName(counterName).reserve({
      requestId,
      calls: 1,
      tokens,
      dailyLimit: DAILY_CALL_CAP_BY_TIER[auth.record.tier],
      monthlyLimit,
      nowIso: new Date().toISOString(),
      dailyResetAt: auth.record.daily_reset_at,
      monthlyResetAt: auth.record.monthly_reset_at,
      baselineDailyCalls: auth.record.daily_calls,
      baselineMonthlyTokens: auth.record.monthly_tokens,
      periodAnchor: auth.record.issued_at,
    });
    return result.ok
      ? { ok: true, reservation: { mode: 'atomic', counterName, requestId } }
      : { ok: false, reason: result.cap };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    console.warn(`[proxy] usage-reserve-failed license=${fingerprint(auth.parsed)} error=${message}`);
    return { ok: false, reason: 'unavailable' };
  }
}

// ─── Q18 KV mirror ──────────────────────────────────────────────────────────
// The Durable Object holds the only true counters for paid traffic; the KV
// license record's daily_calls/monthly_tokens stopped moving the day the DO
// shipped. That made the operator's KV view a lie AND poisoned the DO's own
// re-seed path (a recreated counter baselines from KV). The mirror writes the
// post-reconcile DO truth back into KV, throttled by drift so a hot license
// stays far under KV's 1 write/sec/key limit: mirror only when the counters
// moved materially since this request's auth-time read, or a period rolled.
const MIRROR_CALLS_DRIFT = 25;
const MIRROR_TOKENS_DRIFT = 50_000;

function counterMirrorDue(baseline: LicenseRecord, snapshot: CounterSnapshot): boolean {
  return (
    Math.abs(snapshot.dailyCalls - baseline.daily_calls) >= MIRROR_CALLS_DRIFT
    || Math.abs(snapshot.monthlyTokens - baseline.monthly_tokens) >= MIRROR_TOKENS_DRIFT
    || snapshot.dailyResetAt !== baseline.daily_reset_at
    || snapshot.monthlyResetAt !== baseline.monthly_reset_at
  );
}

async function mirrorCounterToKv(
  env: Env,
  licenseKey: string,
  baseline: LicenseRecord,
  snapshot: CounterSnapshot,
): Promise<void> {
  if (!counterMirrorDue(baseline, snapshot)) return;
  // Re-read rather than trusting the auth-time record: the license may have
  // been revoked or re-tiered mid-request, and the mirror must never
  // resurrect a deleted record.
  const fresh = await loadLicense(env, licenseKey);
  if (!fresh || fresh.status !== 'active') return;
  if (await loadTombstone(env, licenseKey) !== null) return;
  const mirrored: LicenseRecord = {
    ...fresh,
    daily_calls: snapshot.dailyCalls,
    daily_reset_at: snapshot.dailyResetAt,
    monthly_tokens: snapshot.monthlyTokens,
    monthly_reset_at: snapshot.monthlyResetAt,
    last_seen_at: new Date().toISOString(),
  };
  await env.LICENSES.put(licenseKey, JSON.stringify(mirrored));
}

function reconcileUsage(
  ctx: ExecutionContext,
  env: Env,
  auth: AuthSuccess,
  reservation: UsageReservation,
  calls: number,
  tokens: number,
): void {
  if (reservation.mode === 'legacy') {
    if (calls > 0) ctx.waitUntil(recordUsage(env, auth.parsed.raw, calls, tokens));
    return;
  }

  const pending = (async () => {
    try {
      const snapshot = await env.LICENSE_COUNTER?.getByName(reservation.counterName).reconcile({
        requestId: reservation.requestId,
        calls,
        tokens,
        nowIso: new Date().toISOString(),
      });
      // Mirror failures are logged but never re-thrown: the reconcile itself
      // succeeded, and KV catching up on a later call is the design.
      if (snapshot) {
        await mirrorCounterToKv(env, auth.parsed.raw, auth.record, snapshot).catch((err) => {
          const message = err instanceof Error ? err.message : 'unknown';
          console.warn(`[proxy] usage-mirror-failed license=${fingerprint(auth.parsed)} error=${message}`);
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      console.warn(`[proxy] usage-reconcile-failed license=${fingerprint(auth.parsed)} error=${message}`);
    }
  })();
  ctx.waitUntil(pending);
}

// ─── HTTP helpers ──────────────────────────────────────────────────────────

const CORS_ALLOW_HEADERS = 'Authorization, Content-Type, X-FW-Consent';
const CORS_ALLOW_METHODS = 'POST, GET, OPTIONS';

// Permissive CORS rationale: the proxy is gated by the license-key bearer
// auth (Authorization header). The Origin doesn't add a security boundary
// here — a malicious caller with a stolen license key could call from any
// origin via curl regardless. Echoing the request Origin back (or `*` when
// absent) means MV3 content scripts whose Origin resolves to the page's
// host (e.g. `https://x.com`) get a valid CORS response, removing the
// dependency on host_permissions for the CORS bypass path. `Vary: Origin`
// keeps shared CDN/cache layers from cross-contaminating.
/**
 * Response headers the extension is allowed to READ. The proxy copies Groq's
 * upstream headers into the response, but without this list a cross-origin
 * caller only sees the CORS-safelisted ones, so the client's rate-limit
 * telemetry (src/ai/telemetry.ts: x-ratelimit-remaining-*, retry-after)
 * read null on every one of 100 calls in the operator's 2026-09-02 dump.
 */
const CORS_EXPOSE_HEADERS = [
  'x-ratelimit-limit-requests',
  'x-ratelimit-limit-tokens',
  'x-ratelimit-remaining-requests',
  'x-ratelimit-remaining-tokens',
  'x-ratelimit-reset-requests',
  'x-ratelimit-reset-tokens',
  'retry-after',
  'x-fw-provider',
  'x-fw-provider-legal',
  'x-fw-claude-provider-legal',
].join(', ');

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': CORS_ALLOW_METHODS,
    'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
    'Access-Control-Expose-Headers': CORS_EXPOSE_HEADERS,
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin),
    },
  });
}

function contentLengthFailure(request: Request, maxBytes: number): AuthFailure | null {
  const raw = request.headers.get('Content-Length');
  if (raw === null) return null;
  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized)) {
    return {
      ok: false,
      status: 400,
      body: { error: { message: 'Invalid Content-Length header', code: 'invalid_content_length' } },
    };
  }
  const length = Number(normalized);
  if (!Number.isSafeInteger(length) || length > maxBytes) {
    return bodyTooLargeFailure();
  }
  return null;
}

function bodyTooLargeFailure(): AuthFailure {
  return {
    ok: false,
    status: 413,
    body: { error: { message: 'Request body too large', code: 'body_too_large' } },
  };
}

// Q17 bounded the body before reading it, but only against Content-Length,
// which is a header the CLIENT writes. An adversarial read (2026-09-18) found
// the other half of the door open: a chunked request carries no
// Content-Length at all, `contentLengthFailure` returns null for it, and
// `request.text()` then buffered the whole body into the isolate whatever its
// size, on the two authenticated routes and on the unauthenticated webhook.
//
// This reads the stream and stops at the cap, so the bound holds for a body
// of any shape. The header check above is kept and still runs first: it
// refuses an honestly-declared oversize body without opening the stream at
// all, and this is what catches the one that lies or says nothing.
//
// Returns null when the body exceeds `maxBytes`, '' when there is no body.
async function readBoundedText(request: Request, maxBytes: number): Promise<string | null> {
  const stream = request.body;
  if (!stream) return '';
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      // Cancel rather than drain: the sender is told to stop, and nothing
      // beyond the chunk that crossed the line is ever held.
      await reader.cancel().catch(() => { /* the peer is gone; nothing to do */ });
      return null;
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  // Decoded once at the end, so a multi-byte character split across two
  // chunks still decodes correctly.
  return new TextDecoder().decode(joined);
}

function usageReservationFailureResponse(
  reason: 'daily' | 'monthly' | 'unavailable',
  origin: string | null,
): Response {
  if (reason === 'unavailable') {
    return jsonResponse(
      { error: { message: 'Usage coordinator unavailable', code: 'usage_coordinator_unavailable' } },
      503,
      origin,
    );
  }
  return jsonResponse(
    { error: { message: `Cap exhausted (${reason})`, code: `cap_${reason}` } },
    429,
    origin,
  );
}

function chatUsageFallbackTokenEquivalents(
  serializedBody: string,
  body: Record<string, unknown>,
): number {
  const requestedMax = body.max_tokens;
  const outputBudget = typeof requestedMax === 'number'
    && Number.isFinite(requestedMax)
    && requestedMax > 0
    ? Math.ceil(requestedMax)
    : CHAT_DEFAULT_MAX_TOKENS;
  const promptTokenUpperBound = new TextEncoder().encode(serializedBody).byteLength;
  return chatTokenEquivalents(promptTokenUpperBound, outputBudget, typeof body.model === 'string' ? body.model : undefined);
}

interface AuthSuccess {
  ok: true;
  parsed: ParsedKey;
  record: LicenseRecord;        // post-reset; counters may still be at-cap
}
interface AuthFailure {
  ok: false;
  status: number;
  body: { error: { message: string; code: string } };
  /** Sent as Retry-After, so the extension waits it out instead of asking again at once. */
  retryAfterSeconds?: number;
}

function authFailureResponse(auth: AuthFailure, origin: string | null): Response {
  const response = jsonResponse(auth.body, auth.status, origin);
  if (auth.retryAfterSeconds !== undefined) response.headers.set('Retry-After', String(auth.retryAfterSeconds));
  return response;
}
type AuthResult = AuthSuccess | AuthFailure;

// A key the relay does not know is answered from KV, so without a count every guess costs the guesser nothing and
// costs a read here. Unknown keys are counted per address, and an address past the limit is answered 429 before
// the read. A person who mistypes a key a few times stays well under it.
//
// The count lives in two places. AUTH_FAILURE_LIMITER, the Workers Rate Limiting binding, counts across the isolates
// of a Cloudflare location; the map below remembers, in this isolate, an address the binding has refused, so its
// next requests skip the KV read too. A Durable Object would count exactly, but it would put a round trip in front
// of every paying request to protect against the unpaying ones. Without the binding (tests, a deploy that has not
// added it) the map counts on its own, which holds one isolate's guesser back and nothing more.
//
// Cloudflare advises against keying a limit on the address, because many people can share one (a phone network, a
// privacy proxy). Only unknown keys are counted, so sharing an address with a guesser is what costs a paying person,
// and a key that has already worked in this isolate within the window passes the refusal.
const AUTH_FAILURE_LIMIT = 10;
const AUTH_FAILURE_WINDOW_MS = 60_000;
const AUTH_FAILURE_ADDRESSES_KEPT = 10_000;
const authFailuresByAddress = new Map<string, { count: number; since: number }>();
const keysThatWorked = new Map<string, number>();
const TOO_MANY_FAILED_KEYS: AuthFailure = {
  ok: false,
  status: 429,
  body: { error: { message: 'Too many unknown license keys from this address; try again in a minute', code: 'too_many_failed_keys' } },
  retryAfterSeconds: AUTH_FAILURE_WINDOW_MS / 1000,
};

/**
 * The address a guesser would have to change to escape the count. An IPv6 caller is counted by its /64, because one
 * connection is usually handed a whole /64 and could otherwise take a fresh address for every guess.
 */
function callerAddress(request: Request): string {
  const ip = request.headers.get('CF-Connecting-IP')?.trim();
  if (!ip) return 'unknown';
  // An IPv4 address, or one written inside IPv6 (::ffff:192.0.2.1), is counted as it stands.
  if (!ip.includes(':') || ip.includes('.')) return ip;
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

function authFailuresExhausted(address: string, now: number): boolean {
  const entry = authFailuresByAddress.get(address);
  return !!entry && now - entry.since < AUTH_FAILURE_WINDOW_MS && entry.count >= AUTH_FAILURE_LIMIT;
}

function workedRecently(key: string, now: number): boolean {
  const at = keysThatWorked.get(key);
  return at !== undefined && now - at < AUTH_FAILURE_WINDOW_MS;
}

function rememberKeyWorked(key: string, now: number): void {
  keysThatWorked.delete(key);
  if (keysThatWorked.size >= AUTH_FAILURE_ADDRESSES_KEPT) {
    const oldest = keysThatWorked.keys().next().value;
    if (oldest !== undefined) keysThatWorked.delete(oldest);
  }
  keysThatWorked.set(key, now);
}

async function countAuthFailure(env: Env, address: string, now: number): Promise<void> {
  let entry = authFailuresByAddress.get(address);
  if (!entry || now - entry.since >= AUTH_FAILURE_WINDOW_MS) {
    if (!entry && authFailuresByAddress.size >= AUTH_FAILURE_ADDRESSES_KEPT) {
      // The oldest insertion goes first; a Map iterates in insertion order.
      const oldest = authFailuresByAddress.keys().next().value;
      if (oldest !== undefined) authFailuresByAddress.delete(oldest);
    }
    entry = { count: 0, since: now };
    authFailuresByAddress.set(address, entry);
  }
  entry.count += 1;
  if (!env.AUTH_FAILURE_LIMITER) return;
  try {
    const { success } = await env.AUTH_FAILURE_LIMITER.limit({ key: address });
    if (!success) entry.count = Math.max(entry.count, AUTH_FAILURE_LIMIT);
  } catch {
    // The binding failing must not turn a wrong key into a server error; the map still counts.
  }
}

async function authenticate(request: Request, env: Env): Promise<AuthResult> {
  const bearer = extractBearer(request.headers);
  if (!bearer) {
    return {
      ok: false,
      status: 401,
      body: { error: { message: 'Missing Authorization header', code: 'missing_auth' } },
    };
  }
  const parsed = await parseLicenseKey(bearer);
  if (!parsed) {
    return {
      ok: false,
      status: 401,
      body: { error: { message: 'Invalid license key format', code: 'invalid_license_format' } },
    };
  }
  const address = callerAddress(request);
  if (authFailuresExhausted(address, Date.now()) && !workedRecently(parsed.raw, Date.now())) return TOO_MANY_FAILED_KEYS;
  const record = await loadLicense(env, parsed.raw);
  if (!record) {
    await countAuthFailure(env, address, Date.now());
    return {
      ok: false,
      status: 401,
      body: { error: { message: 'License key not recognized', code: 'license_not_found' } },
    };
  }
  // The tombstone outranks the record: a revoke whose record write was
  // lost to the mirror race, or undone by an out-of-order status flip,
  // still refuses here.
  const tombstone = await loadTombstone(env, parsed.raw);
  if (record.status !== 'active' || tombstone !== null) {
    // A subscription the store ended says so, as a key past its expires_at does; the tombstone's reason outranks the
    // record's, as the tombstone itself does.
    const reason = tombstone !== null ? tombstone.reason : record.revoke_reason;
    if (reason === 'expired') {
      return {
        ok: false,
        status: 401,
        body: { error: { message: 'License has expired', code: 'license_expired' } },
      };
    }
    return {
      ok: false,
      status: 401,
      body: { error: { message: 'License has been revoked', code: 'license_revoked' } },
    };
  }
  if (licenseExpired(record, new Date())) {
    return {
      ok: false,
      status: 401,
      body: { error: { message: 'License has expired', code: 'license_expired' } },
    };
  }
  // Belt-and-suspenders: the tier in the KV record should match the tier
  // embedded in the key. If a key was issued for one tier and the record
  // claims a different tier (manual edit / corruption), refuse to serve.
  if (record.tier !== parsed.tier) {
    return {
      ok: false,
      status: 401,
      body: { error: { message: 'License tier mismatch', code: 'tier_mismatch' } },
    };
  }
  const now = new Date();
  rememberKeyWorked(parsed.raw, now.getTime());
  const reset = applyResets(record, now);
  return { ok: true, parsed, record: reset };
}

/** True while CONSENT_REQUIRED_FROM names a moment still to come. */
function consentNotYetRequired(env: Pick<Env, 'CONSENT_REQUIRED_FROM'>, now: number = Date.now()): boolean {
  const from = Date.parse(env.CONSENT_REQUIRED_FROM ?? '');
  return Number.isFinite(from) && now < from;
}

/**
 * A paid call needs the person's request to start the reading, for the company that reads the text
 * now: a consent already on record for that name, the one this call carries (stored now), or a key
 * the operator grandfathered. Only the chat route is gated; the licence check, the models list and
 * the time stamps are not paid readings.
 */
async function consentGate(request: Request, env: Env, licenseKey: string, record: LicenseRecord): Promise<AuthFailure | null> {
  if (record.consent_grandfathered === true) return null;
  return storedConsentGate(request, env, consentKey(licenseKey), servedProviderName(env), consentNotYetRequired(env));
}

/**
 * The Claude reading's consent has no grandfathering and no grace period: nobody gave it before the
 * screen that asks for it existed.
 */
async function claudeConsentGate(request: Request, env: Env, licenseKey: string): Promise<AuthFailure | null> {
  return storedConsentGate(request, env, claudeConsentKey(licenseKey), claudeProviderName(env), false);
}

async function storedConsentGate(
  request: Request,
  env: Env,
  storageKey: string,
  served: string | null,
  graceOpen: boolean,
): Promise<AuthFailure | null> {
  const stored = await loadConsent(env, storageKey);
  const current = stored?.renewed ?? stored;
  if (current && (served === null || current.provider === served)) return null;
  const offered = parseConsentHeader(request.headers.get('X-FW-Consent'));
  if (!offered || (served !== null && offered.provider !== served)) {
    if (graceOpen) return null;
    return {
      ok: false,
      status: 403,
      body: { error: { message: 'The reading has not been started from the extension yet', code: 'consent_required' } },
    };
  }
  const seenAt = new Date().toISOString();
  const next: ConsentRecord = stored
    ? { ...stored, renewed: { ...offered, seen_at: seenAt } }
    : { ...offered, first_seen_at: seenAt };
  await env.LICENSES.put(storageKey, JSON.stringify(next));
  return null;
}

// ─── Route handlers ────────────────────────────────────────────────────────

async function handleChatCompletions(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  requireAtomicCounter: boolean,
): Promise<Response> {
  const origin = request.headers.get('Origin');
  const requestId = crypto.randomUUID();

  const auth = await authenticate(request, env);
  if (!auth.ok) {
    console.log(`[proxy] req=${requestId} auth-failed code=${auth.body.error.code}`);
    return authFailureResponse(auth, origin);
  }

  // The real gate for what a plan sells: the extension shows the reading only to a key that holds
  // it, and this refuses the call when the key does not, whatever the extension shows. 403 rather
  // than 401: the key is good, the plan does not cover this.
  if (!holdsFeature(featuresOf(auth.record.tier, auth.record.features), READING_FEATURE)) {
    console.log(`[proxy] req=${requestId} feature-missing license=${fingerprint(auth.parsed)} need=${READING_FEATURE}`);
    return jsonResponse(
      { error: { message: 'This key does not include the AI reading', code: 'feature_missing' } },
      403,
      origin,
    );
  }

  const consentFailure = await consentGate(request, env, auth.parsed.raw, auth.record);
  if (consentFailure) {
    console.log(`[proxy] req=${requestId} consent-missing`);
    return jsonResponse(consentFailure.body, consentFailure.status, origin);
  }

  // Q17: bound the body BEFORE reading it into memory.
  const preflightFailure = contentLengthFailure(request, CHAT_MAX_BODY_BYTES);
  if (preflightFailure) {
    return jsonResponse(preflightFailure.body, preflightFailure.status, origin);
  }

  const rawChatBody = await readBoundedText(request, CHAT_MAX_BODY_BYTES);
  if (rawChatBody === null) {
    const failure = bodyTooLargeFailure();
    return jsonResponse(failure.body, failure.status, origin);
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawChatBody);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('chat body must be an object');
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonResponse(
      { error: { message: 'Request body must be a JSON object', code: 'invalid_request_body' } },
      400,
      origin,
    );
  }

  if (body.stream === true) {
    return jsonResponse(
      { error: { message: 'Streaming is not supported', code: 'streaming_not_supported' } },
      400,
      origin,
    );
  }

  body.model = typeof body.model === 'string' && CHAT_MODELS_ALLOWED.has(body.model) ? body.model : CHAT_MODEL;
  // Q16: clamp the client-controlled spend levers. n is pinned to one
  // completion; max_tokens is capped at the extension's own ceiling. Both
  // ride inside the forwarded body, so the clamp is what Groq sees.
  body.n = 1;
  const requestedMaxTokens = body.max_tokens;
  body.max_tokens = typeof requestedMaxTokens === 'number'
    && Number.isFinite(requestedMaxTokens)
    && requestedMaxTokens > 0
    ? Math.min(Math.ceil(requestedMaxTokens), CHAT_MAX_OUTPUT_TOKENS)
    : CHAT_DEFAULT_MAX_TOKENS;
  const forwardedBody = JSON.stringify(body);
  const usageFallbackTokenEquivalents = chatUsageFallbackTokenEquivalents(forwardedBody, body);
  const reservationResult = await reserveUsage(
    env,
    auth,
    requestId,
    usageFallbackTokenEquivalents,
    requireAtomicCounter,
  );
  if (!reservationResult.ok) {
    console.log(`[proxy] req=${requestId} usage-rejected license=${fingerprint(auth.parsed)} reason=${reservationResult.reason}`);
    return usageReservationFailureResponse(reservationResult.reason, origin);
  }
  const reservation = reservationResult.reservation;

  const t0 = Date.now();
  let upstreamResponse: Response | null = null;
  try {
    upstreamResponse = await fetch(env.GROQ_UPSTREAM_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.GROQ_API_KEY}`,
      },
      body: forwardedBody,
    });
  } catch {
    upstreamResponse = null;
  }

  // The second rung: Groq did not answer (fetch threw, account refused, rate,
  // service) and the flag is on, so the same weights on Workers AI answer
  // instead, named on the response. A request Groq rejected as malformed never
  // retries here (shouldFallBack). A Workers AI failure falls through to the
  // honest Groq error below, exactly as before the rung existed.
  if (shouldFallBack(upstreamResponse ? upstreamResponse.status : null) && fallbackEnabled(env)) {
    const waiModel = WORKERS_AI_MODEL[String(body.model)] ?? WORKERS_AI_MODEL[CHAT_MODEL];
    try {
      const out = await env.AI!.run(waiModel, workersAiRequest(body));
      const shaped = chatResponseFromWorkersAi(out, String(body.model));
      if (shaped) {
        const latencyMs = Date.now() - t0;
        const usage = (shaped.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number };
        const p = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0;
        const c = typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0;
        const tokenEquivalents = p + c > 0 ? workersAiTokenEquivalents(p, c, waiModel) : usageFallbackTokenEquivalents;
        reconcileUsage(ctx, env, auth, reservation, 1, tokenEquivalents);
        console.log(
          `[proxy] req=${requestId} status=200 provider=workers-ai groq=${upstreamResponse ? upstreamResponse.status : 'fetch-failed'} ` +
          `license=${fingerprint(auth.parsed)} tokenEquiv=${tokenEquivalents} latency=${latencyMs}ms`,
        );
        const headers = new Headers({ 'Content-Type': 'application/json', [PROVIDER_HEADER]: 'workers-ai' });
        for (const [k, v] of Object.entries(corsHeaders(origin))) headers.set(k, v);
        return new Response(JSON.stringify(shaped), { status: 200, headers });
      }
    } catch (e) {
      console.log(`[proxy] req=${requestId} workers-ai-failed license=${fingerprint(auth.parsed)} err=${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (!upstreamResponse) {
    const latencyMs = Date.now() - t0;
    reconcileUsage(ctx, env, auth, reservation, 0, 0);
    console.log(`[proxy] req=${requestId} upstream-fetch-failed license=${fingerprint(auth.parsed)} latency=${latencyMs}ms`);
    return jsonResponse(
      { error: { message: 'Upstream connection failed', code: 'upstream_fetch_error' } },
      502,
      origin,
    );
  }

  // Buffer the response so we can read split usage fields for metering.
  // Body is small (chat completions are typically <2KB); the buffering
  // adds <5ms and never writes the body to storage.
  const responseBody = await upstreamResponse.text();
  const latencyMs = Date.now() - t0;

  // A successful response without usable split usage still advances the
  // solvency counter. The fallback conservatively covers serialized input
  // bytes plus the requested completion budget at their respective rates.
  let tokenEquivalents = usageFallbackTokenEquivalents;
  try {
    const parsed = JSON.parse(responseBody);
    const promptTokens = parsed?.usage?.prompt_tokens;
    const completionTokens = parsed?.usage?.completion_tokens;
    // The upstream reports what it actually charged, in usage.estimated_cost. Passed
    // through here so the counter bills the higher of that and this repository's own
    // rate table (meteredTokenEquivalents explains why the higher). Absent or unusable,
    // and this is exactly the table, as it was before 2026-09-21.
    const estimatedCost = parsed?.usage?.estimated_cost;
    if (typeof promptTokens === 'number'
      && Number.isFinite(promptTokens)
      && promptTokens >= 0
      && typeof completionTokens === 'number'
      && Number.isFinite(completionTokens)
      && completionTokens >= 0
      && promptTokens + completionTokens > 0) {
      tokenEquivalents = meteredTokenEquivalents(
        promptTokens,
        completionTokens,
        typeof body.model === 'string' ? body.model : undefined,
        typeof estimatedCost === 'number' ? estimatedCost : undefined,
      );
    }
  } catch {
    // Keep the conservative fallback for a non-JSON response body.
  }

  // Only count successful Groq calls against the cap. 4xx/5xx don't bill
  // (Groq won't charge for rejected requests either).
  const success = upstreamResponse.status >= 200 && upstreamResponse.status < 300;
  reconcileUsage(ctx, env, auth, reservation, success ? 1 : 0, success ? tokenEquivalents : 0);

  console.log(
    `[proxy] req=${requestId} status=${upstreamResponse.status} license=${fingerprint(auth.parsed)} ` +
    `tokenEquiv=${tokenEquivalents} latency=${latencyMs}ms`,
  );

  const headers = new Headers(upstreamResponse.headers);
  headers.delete('Transfer-Encoding');
  headers.delete('Connection');
  headers.set(PROVIDER_HEADER, UPSTREAM_PROVIDER_NAME);
  for (const [k, v] of Object.entries(corsHeaders(origin))) {
    headers.set(k, v);
  }
  return new Response(responseBody, { status: upstreamResponse.status, headers });
}

// POST /v1/claude/verdict: one item read by Claude with the prompt and tool this relay holds. Only the
// item is read from the body. The answer is a verdict, or a typed failure the extension answers by
// keeping the ordinary reading; a refusal or a broken answer never becomes a verdict.
async function handleClaudeVerdict(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  requireAtomicCounter: boolean,
): Promise<Response> {
  const origin = request.headers.get('Origin');
  const requestId = crypto.randomUUID();

  const auth = await authenticate(request, env);
  if (!auth.ok) {
    console.log(`[proxy] req=${requestId} claude auth-failed code=${auth.body.error.code}`);
    return authFailureResponse(auth, origin);
  }
  if (!holdsFeature(featuresOf(auth.record.tier, auth.record.features), READING_FEATURE)) {
    return jsonResponse(
      { error: { message: 'This key does not include the AI reading', code: 'feature_missing' } },
      403,
      origin,
    );
  }
  if (!claudeConfigured(env)) {
    return jsonResponse(
      { error: { message: 'The Claude reading is not configured', code: 'claude_not_configured' } },
      503,
      origin,
    );
  }
  const consentFailure = await claudeConsentGate(request, env, auth.parsed.raw);
  if (consentFailure) {
    console.log(`[proxy] req=${requestId} claude consent-missing`);
    return jsonResponse(consentFailure.body, consentFailure.status, origin);
  }

  const preflightFailure = contentLengthFailure(request, CHAT_MAX_BODY_BYTES);
  if (preflightFailure) {
    return jsonResponse(preflightFailure.body, preflightFailure.status, origin);
  }
  const raw = await readBoundedText(request, CHAT_MAX_BODY_BYTES);
  if (raw === null) {
    const failure = bodyTooLargeFailure();
    return jsonResponse(failure.body, failure.status, origin);
  }
  let parsedBody: unknown = null;
  try { parsedBody = JSON.parse(raw); } catch { parsedBody = null; }
  const item = readItem(parsedBody);
  if (!item) {
    return jsonResponse(
      { error: { message: 'The body must carry one item: platform, kind and text', code: 'invalid_item' } },
      400,
      origin,
    );
  }

  const forwardedBody = JSON.stringify(claudeRequest(item));
  // The hold covers the dearest case: every byte of the request billed as a cache write, and the whole
  // output ceiling.
  const holdTokens = claudeTokenEquivalents({
    input_tokens: 0,
    cache_creation_input_tokens: new TextEncoder().encode(forwardedBody).byteLength,
    cache_read_input_tokens: 0,
    output_tokens: CLAUDE_MAX_OUTPUT_TOKENS,
  });
  const ceiling = await reserveClaudeCeiling(env, requestId, holdTokens, requireAtomicCounter);
  if (!ceiling.ok) {
    console.log(`[proxy] req=${requestId} claude ceiling-rejected license=${fingerprint(auth.parsed)} reason=${ceiling.reason}`);
    if (ceiling.reason === 'unset') {
      return jsonResponse({ error: { message: 'The Claude reading is not configured', code: 'claude_not_configured' } }, 503, origin);
    }
    if (ceiling.reason === 'unavailable') return usageReservationFailureResponse('unavailable', origin);
    return jsonResponse(
      { error: { message: 'The Claude reading is paused for the rest of this month', code: 'claude_paused_near_cap' } },
      429,
      origin,
    );
  }
  const reservationResult = await reserveUsage(env, auth, requestId, holdTokens, requireAtomicCounter, CLAUDE_MONTHLY_SHARE);
  if (!reservationResult.ok) {
    reconcileClaudeCeiling(ctx, env, ceiling.reservation, 0, 0);
    console.log(`[proxy] req=${requestId} claude usage-rejected license=${fingerprint(auth.parsed)} reason=${reservationResult.reason}`);
    if (reservationResult.reason === 'monthly') {
      return jsonResponse(
        { error: { message: 'The Claude reading is paused for the rest of this month', code: 'claude_paused_near_cap' } },
        429,
        origin,
      );
    }
    return usageReservationFailureResponse(reservationResult.reason, origin);
  }
  const reservation = reservationResult.reservation;

  const t0 = Date.now();
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(CLAUDE_UPSTREAM_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY!,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: forwardedBody,
      signal: AbortSignal.timeout(CLAUDE_TIMEOUT_MS),
    });
  } catch (err) {
    reconcileUsage(ctx, env, auth, reservation, 0, 0);
    reconcileClaudeCeiling(ctx, env, ceiling.reservation, 0, 0);
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    console.log(`[proxy] req=${requestId} claude ${timedOut ? 'timeout' : 'fetch-failed'} license=${fingerprint(auth.parsed)} latency=${Date.now() - t0}ms`);
    return timedOut
      ? jsonResponse({ error: { message: 'The Claude reading did not answer in time', code: 'upstream_timeout' } }, 504, origin)
      : jsonResponse({ error: { message: 'Upstream connection failed', code: 'upstream_fetch_error' } }, 502, origin);
  }

  const responseText = await upstreamResponse.text().catch(() => '');
  const latencyMs = Date.now() - t0;
  if (!upstreamResponse.ok) {
    // Anthropic does not bill a request it answered with an error.
    reconcileUsage(ctx, env, auth, reservation, 0, 0);
    reconcileClaudeCeiling(ctx, env, ceiling.reservation, 0, 0);
    console.log(`[proxy] req=${requestId} claude upstream=${upstreamResponse.status} license=${fingerprint(auth.parsed)} latency=${latencyMs}ms`);
    return jsonResponse(
      { error: { message: `The Claude reading answered ${upstreamResponse.status}`, code: 'claude_upstream_error' } },
      502,
      origin,
    );
  }

  let answer: unknown = null;
  try { answer = JSON.parse(responseText); } catch { answer = null; }
  // A refusal and an unusable answer are billed like any other, so they are metered like any other.
  const usage = (answer as { usage?: Record<string, unknown> } | null)?.usage;
  const reported = usage && typeof usage.input_tokens === 'number' && typeof usage.output_tokens === 'number'
    ? {
      input_tokens: usage.input_tokens,
      cache_creation_input_tokens: Number(usage.cache_creation_input_tokens ?? 0),
      cache_read_input_tokens: Number(usage.cache_read_input_tokens ?? 0),
      output_tokens: usage.output_tokens,
    }
    : null;
  const tokenEquivalents = reported ? claudeTokenEquivalents(reported) : holdTokens;
  reconcileUsage(ctx, env, auth, reservation, 1, tokenEquivalents);
  reconcileClaudeCeiling(ctx, env, ceiling.reservation, 1, tokenEquivalents);
  // The four counts go back with every billed answer so the extension's own counter weighs the call
  // as this one does; they are numbers only.
  const billed = reported ? { usage: reported } : {};

  const outcome = readClaudeAnswer(answer);
  console.log(
    `[proxy] req=${requestId} claude answer=${outcome.ok ? 'verdict' : outcome.reason} license=${fingerprint(auth.parsed)} ` +
    `tokenEquiv=${tokenEquivalents} latency=${latencyMs}ms`,
  );
  if (!outcome.ok) {
    return outcome.reason === 'refused'
      ? jsonResponse({ error: { message: 'The Claude reader declined this item', code: 'claude_refused' }, ...billed }, 502, origin)
      : jsonResponse({ error: { message: 'The Claude reader gave no usable answer', code: 'claude_unusable' }, ...billed }, 502, origin);
  }
  const response = jsonResponse(
    { verdict: outcome.verdict, reader: { model: CLAUDE_MODEL, provider: CLAUDE_PROVIDER, judge: CLAUDE_JUDGE_HASH }, ...billed },
    200,
    origin,
  );
  response.headers.set(PROVIDER_HEADER, CLAUDE_PROVIDER);
  return response;
}

// Worker-side cache for the upstream Groq model list (G2 fix, 2026-08-04).
// The extension calls /v1/models only as a license/liveness probe
// (probeProxy at src/ai/client.ts:141 reads the HTTP status, never the
// body), yet every request used to fan out to Groq with the master key —
// an unmetered amplification a single valid license could drive unboundedly
// against FW's Groq standing. The model list changes rarely and is
// identical for every license, so a short per-isolate TTL cache removes the
// amplification without billing users for a metadata call. Auth still runs
// per request — a revoked license flips to 401 immediately; only the "is
// the master Groq key alive" half of the probe can be up to 5 minutes
// stale, the same staleness the client already accepts from its own
// PROBE_CACHE_TTL_MS. Upstream failures cache on a shorter TTL so a Groq
// outage recovers quickly while error-path hammering stays bounded at one
// upstream call per minute per isolate.
const MODELS_CACHE_SUCCESS_TTL_MS = 5 * 60 * 1000;
const MODELS_CACHE_FAILURE_TTL_MS = 60 * 1000;
// The cache stores the in-flight PROMISE, not the resolved value, so a
// parallel burst of misses coalesces onto ONE upstream fetch instead of
// fanning out N fetches during the round-trip window. `expiresAt` stays
// pinned at MAX_SAFE_INTEGER while the fetch is in flight and drops to the
// outcome-appropriate TTL when it settles.
interface ModelsCacheEntry {
  expiresAt: number;
  result: Promise<{ status: number; body: string; ok: boolean }>;
}
let modelsCache: ModelsCacheEntry | null = null;

// Never rejects: a thrown fetch (no HTTP response at all) maps to the same
// upstream_fetch_error shape the other routes use.
async function fetchModelsUpstream(
  env: Env,
): Promise<{ status: number; body: string; ok: boolean }> {
  try {
    const upstream = await fetch(env.GROQ_MODELS_URL, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${env.GROQ_API_KEY}` },
    });
    return { status: upstream.status, body: await upstream.text(), ok: upstream.ok };
  } catch {
    return {
      status: 502,
      body: JSON.stringify(
        { error: { message: 'Upstream connection failed', code: 'upstream_fetch_error' } },
      ),
      ok: false,
    };
  }
}

// GET /v1/entitlements: the signed list of what this key turns on, for the extension to cache and
// show only the settings the key covers. Same authentication as every route; not metered, because
// it reads one KV record and makes no upstream call.
async function handleEntitlements(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get('Origin');
  const auth = await authenticate(request, env);
  if (!auth.ok) {
    return authFailureResponse(auth, origin);
  }
  const payload = entitlementsPayload(
    fingerprint(auth.parsed),
    featuresOf(auth.record.tier, auth.record.features),
    Date.now(),
  );
  const signed = await signEntitlements(payload, env.ENTITLEMENTS_SIGNING_KEY);
  if (!signed) {
    return jsonResponse(
      { error: { message: 'Entitlements cannot be signed right now', code: 'entitlements_unsigned' } },
      503,
      origin,
    );
  }
  return jsonResponse(signed, 200, origin);
}

// GET /v1/usage: how many calls the asking key has used today and how many are left before it is refused (the open
// board's R122, 15 Oct 2026; the drafting key hit its cap mid-batch because nothing could say whether a batch would
// fit). A key is refused by either cap (reserveUsage, checkCap): the daily calls, or the monthly allowance in
// token-equivalents, so the calls left are 0 once the month's allowance is spent, whatever the day's count says, and
// `stopped_by` names the cap that stops it. The numbers are the Durable Object counter's, the one the caps are enforced
// on; the KV record only when that counter has no state yet (a key not used since the counter shipped, which the
// counter would seed from the same record). A counter that cannot be read answers 503 usage_unavailable, as a call
// would be refused then too (reserveUsage 'unavailable'), rather than the record's mirror, which lags by up to 25
// calls (MIRROR_CALLS_DRIFT). Asking is not a call: the counter is read, never reserved, and only the asking key's.
//
// A call is refused when what it holds would pass the month's allowance (the counter's reserve: used + hold > limit),
// and the hold is an estimate made before the call runs, up to the largest one below. So the month is reported as
// stopping calls once less than the largest chat hold is left: the answer errs toward less room (a small call may still
// pass), never toward room a batch would not get. The Claude reading stops earlier, at CLAUDE_MONTHLY_SHARE of the
// allowance, and is reported on its own; the relay-wide Claude ceiling (reserveClaudeCeiling) is shared by every key
// and is not this key's to read.
//
// The chat hold is measured on the body as the relay forwards it: the body read (at most CHAT_MAX_BODY_BYTES) plus the
// fields the relay sets on it (model, n, max_tokens). A client that writes its body with JSON.stringify, as the
// extension and the drafting tool do, gets that body back unchanged when the relay parses and rewrites it; a body
// written to grow on that rewrite (numbers like 1e20, bytes that are not UTF-8) can hold more than this bound.
const USAGE_RELAY_ADDED_BYTES = Math.max(
  ...[...CHAT_MODELS_ALLOWED, CHAT_MODEL].map(
    model => new TextEncoder().encode(JSON.stringify({ model, n: 1, max_tokens: CHAT_MAX_OUTPUT_TOKENS })).byteLength,
  ),
);
const USAGE_LARGEST_CHAT_HOLD = Math.max(
  ...[...CHAT_MODELS_ALLOWED, CHAT_MODEL].map(
    model => chatTokenEquivalents(CHAT_MAX_BODY_BYTES + USAGE_RELAY_ADDED_BYTES, CHAT_MAX_OUTPUT_TOKENS, model),
  ),
);
const USAGE_LARGEST_CLAUDE_HOLD = claudeTokenEquivalents({
  input_tokens: 0,
  cache_creation_input_tokens: CHAT_MAX_BODY_BYTES,
  cache_read_input_tokens: 0,
  output_tokens: CLAUDE_MAX_OUTPUT_TOKENS,
});

async function handleUsage(request: Request, env: Env, requireAtomicCounter: boolean): Promise<Response> {
  const origin = request.headers.get('Origin');
  const auth = await authenticate(request, env);
  if (!auth.ok) {
    return authFailureResponse(auth, origin);
  }
  const now = new Date();
  let daily = { used: auth.record.daily_calls, resetsAt: auth.record.daily_reset_at };
  let monthly = { used: auth.record.monthly_tokens, resetsAt: auth.record.monthly_reset_at };
  let source: 'counter' | 'record' = 'record';
  // Without the counter a call is refused as unavailable (reserveUsage), unless the relay runs the legacy KV path.
  if (!env.LICENSE_COUNTER && requireAtomicCounter) {
    return jsonResponse({ error: { message: 'Usage cannot be read right now', code: 'usage_unavailable' } }, 503, origin);
  }
  if (env.LICENSE_COUNTER) {
    try {
      const seen = await env.LICENSE_COUNTER.getByName(await licenseCounterName(auth.parsed.raw)).inspect();
      if (seen) {
        daily = { used: seen.dailyCalls, resetsAt: seen.dailyResetAt };
        monthly = { used: seen.monthlyTokens, resetsAt: seen.monthlyResetAt };
        source = 'counter';
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      console.warn(`[proxy] usage-inspect-failed license=${fingerprint(auth.parsed)} error=${message}`);
      return jsonResponse(
        { error: { message: 'Usage cannot be read right now', code: 'usage_unavailable' } },
        503,
        origin,
      );
    }
  }
  // A period that rolled since the last call has not been reset in storage yet: the next call starts it from zero
  // (license-counter-state.ts resetExpiredPeriods, the same test).
  const rolled = (at: string) => {
    const t = new Date(at).getTime();
    return Number.isNaN(t) || t <= now.getTime();
  };
  if (rolled(daily.resetsAt)) daily = { used: 0, resetsAt: nextUtcMidnight(now).toISOString() };
  if (rolled(monthly.resetsAt)) monthly = { used: 0, resetsAt: nextPeriodStartIso(auth.record.issued_at, now) };
  // The founder tier is never capped (checkCap), so it has no limit to count down to.
  const dev = auth.record.tier === 'dev';
  const dailyLimit = dev ? null : DAILY_CALL_CAP_BY_TIER[auth.record.tier];
  const monthlyLimit = dev ? null : monthlyTokenCapForTier(auth.record.tier);
  const monthlyLeft = monthlyLimit === null ? null : Math.max(0, monthlyLimit - monthly.used);
  const monthSpent = monthlyLeft !== null && monthlyLeft < USAGE_LARGEST_CHAT_HOLD;
  const dailyLeft = dailyLimit === null ? null : Math.max(0, dailyLimit - daily.used);
  const stoppedBy = monthSpent ? 'monthly' : dailyLeft === 0 ? 'daily' : null;
  // The same floor reserveUsage takes for the Claude share.
  const claudeLimit = monthlyLimit === null ? null : Math.floor(monthlyLimit * CLAUDE_MONTHLY_SHARE);
  const claudePaused = claudeLimit === null
    ? null
    : dailyLeft === 0 || monthly.used + USAGE_LARGEST_CLAUDE_HOLD > claudeLimit;
  return jsonResponse(
    {
      calls_used_today: daily.used,
      calls_left_today: dailyLeft === null ? null : monthSpent ? 0 : dailyLeft,
      daily_call_limit: dailyLimit,
      resets_at: daily.resetsAt,
      monthly_allowance_used_percent: monthlyLimit === null
        ? null
        : Math.min(100, Math.round((monthly.used / monthlyLimit) * 1000) / 10),
      monthly_allowance_left: monthlyLeft,
      monthly_resets_at: monthly.resetsAt,
      stopped_by: stoppedBy,
      claude_reading_paused: claudePaused,
      source,
    },
    200,
    origin,
  );
}

async function handleModels(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get('Origin');
  const auth = await authenticate(request, env);
  if (!auth.ok) {
    return authFailureResponse(auth, origin);
  }
  // Models endpoint isn't capped — it's used by the extension's key probe
  // (probeProxy at src/ai/client.ts:141) and answers "is the license
  // valid + is the proxy reachable + is the master Groq key alive."
  // Staying uncapped is safe because the TTL cache above bounds upstream
  // Groq traffic to one in-flight fetch per isolate regardless of how hard
  // any license hammers the route.
  if (!modelsCache || modelsCache.expiresAt <= Date.now()) {
    const entry: ModelsCacheEntry = {
      expiresAt: Number.MAX_SAFE_INTEGER,
      result: fetchModelsUpstream(env),
    };
    // fetchModelsUpstream never rejects, so this settle-handler always runs
    // and always inside the awaiting request's lifetime (no orphan work).
    void entry.result.then(({ ok }) => {
      entry.expiresAt = Date.now()
        + (ok ? MODELS_CACHE_SUCCESS_TTL_MS : MODELS_CACHE_FAILURE_TTL_MS);
    });
    modelsCache = entry;
  }
  const { status, body } = await modelsCache.result;
  const headers = new Headers({ 'Content-Type': 'application/json', ...corsHeaders(origin) });
  // Named here, on the answer the extension already asks for, so the consent screen shows the
  // company the proxy actually sends to and no build has to know it.
  const provider = servedProviderName(env);
  if (provider !== null) headers.set(PROVIDER_LEGAL_HEADER, provider);
  // Named only when the route would answer, so its presence is also how the extension knows the Claude
  // reading can be offered.
  if (claudeConfigured(env)) headers.set(CLAUDE_PROVIDER_LEGAL_HEADER, claudeProviderName(env)!);
  return new Response(body, { status, headers });
}

function handleHealth(request: Request, env: Env): Response {
  const origin = request.headers.get('Origin');
  return jsonResponse(
    { ok: true, service: 'feelingwise-proxy', version: deployStamp(env) },
    200,
    origin,
  );
}

// ─── Operator visibility: GET /admin/licenses ──────────────────────────────
//
// The Durable Object holds the only true counters and the KV mirror lags by
// up to 25 calls / 50k tokens, so until 2026-08-23 the operator had no way to
// answer "was this key ever used" short of inferring it from reset stamps.
// This route walks every `fw-*` record in KV and pairs it with the DO's
// read-only `inspect()` for both counters a key owns (chat has one, TSA has
// its own). It is the ONLY route that reads the DO
// without writing, and the only one that returns plaintext keys: the caller
// is the operator, authenticated by a constant-time bearer compare against
// the ADMIN_TOKEN secret. No CORS headers: browsers never call this.

const ADMIN_BEARER_PATTERN = /^Bearer\s+([A-Za-z0-9._~+/=-]{32,256})$/;
const ADMIN_TOKEN_MIN_LENGTH = 32;

function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  // Always walk the full longer length so timing does not depend on where
  // the first mismatch sits. Leaks length only, which the token format
  // already fixes. (crypto.subtle.timingSafeEqual is Workers-only and the
  // unit suite runs on Node.)
  const n = Math.max(ab.byteLength, bb.byteLength);
  let diff = ab.byteLength ^ bb.byteLength;
  for (let i = 0; i < n; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

export interface AdminLicenseCounterView {
  daily_calls: number;
  daily_reset_at: string;
  monthly_tokens: number;
  monthly_reset_at: string;
  last_seen_at: string | null;
  total_calls: number;
  total_tokens: number;
  pending_reservations: number;
}

export interface AdminLicenseView {
  key: string;
  tier: string;
  status: string;
  tombstoned: boolean;
  note: string | null;
  customer_email: string;
  issued_at: string;
  expires_at: string | null;
  subscription_id: string | null;
  // Best single answer to "has this key been used": newest stamp across the
  // DO counters and the KV mirror, or null when nothing has ever been seen.
  last_seen_at: string | null;
  ever_used: boolean;
  kv_mirror: { daily_calls: number; monthly_tokens: number; last_seen_at: string | null };
  counters: { main: AdminLicenseCounterView | null; tsa: AdminLicenseCounterView | null };
}

function counterView(c: CounterInspection | null): AdminLicenseCounterView | null {
  if (!c) return null;
  return {
    daily_calls: c.dailyCalls,
    daily_reset_at: c.dailyResetAt,
    monthly_tokens: c.monthlyTokens,
    monthly_reset_at: c.monthlyResetAt,
    last_seen_at: c.lastSeenAt,
    total_calls: c.totalCalls,
    total_tokens: c.totalTokens,
    pending_reservations: c.pendingReservations,
  };
}

function newestIso(...stamps: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const s of stamps) {
    if (!s) continue;
    if (best === null || new Date(s).getTime() > new Date(best).getTime()) best = s;
  }
  return best;
}

async function listLicenseKeys(env: Env): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.LICENSES.list({ prefix: 'fw-', cursor });
    for (const k of page.keys) keys.push(k.name);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return keys;
}

async function adminLicenseView(env: Env, key: string): Promise<AdminLicenseView | null> {
  const record = await loadLicense(env, key);
  if (!record) return null;
  const tombstone = await loadTombstone(env, key);
  let main: CounterInspection | null = null;
  let tsa: CounterInspection | null = null;
  if (env.LICENSE_COUNTER) {
    const name = await licenseCounterName(key);
    [main, tsa] = await Promise.all([
      env.LICENSE_COUNTER.getByName(name).inspect(),
      env.LICENSE_COUNTER.getByName(`${name}:tsa`).inspect(),
    ]);
  }
  const lastSeen = newestIso(record.last_seen_at, main?.lastSeenAt, tsa?.lastSeenAt);
  const everUsed = lastSeen !== null
    || (main?.totalCalls ?? 0) > 0 || (tsa?.totalCalls ?? 0) > 0
    || record.daily_calls > 0 || record.monthly_tokens > 0;
  return {
    key,
    tier: record.tier,
    status: record.status,
    tombstoned: tombstone !== null,
    note: record.note ?? null,
    customer_email: record.customer_email,
    issued_at: record.issued_at,
    expires_at: record.expires_at ?? null,
    subscription_id: record.subscription_id ?? null,
    last_seen_at: lastSeen,
    ever_used: everUsed,
    kv_mirror: {
      daily_calls: record.daily_calls,
      monthly_tokens: record.monthly_tokens,
      last_seen_at: record.last_seen_at ?? null,
    },
    counters: { main: counterView(main), tsa: counterView(tsa) },
  };
}

function adminJson(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function handleAdminLicenses(request: Request, env: Env): Promise<Response> {
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < ADMIN_TOKEN_MIN_LENGTH) {
    return adminJson({ error: { message: 'Admin access not configured', code: 'admin_unavailable' } }, 503);
  }
  const auth = request.headers.get('Authorization') ?? '';
  const match = auth.match(ADMIN_BEARER_PATTERN);
  if (!match || !constantTimeEqual(match[1], env.ADMIN_TOKEN)) {
    console.warn('[proxy] admin-auth-failed');
    return adminJson({ error: { message: 'Unauthorized', code: 'admin_unauthorized' } }, 401);
  }

  const url = new URL(request.url);
  const only = url.searchParams.get('key');
  const includeRevoked = url.searchParams.get('include_revoked') === '1';

  let keys: string[];
  if (only) {
    if (!LICENSE_KEY_PATTERN.test(only)) {
      return adminJson({ error: { message: 'Malformed key filter', code: 'admin_bad_key' } }, 400);
    }
    keys = [only];
  } else {
    keys = await listLicenseKeys(env);
  }

  const views: AdminLicenseView[] = [];
  for (const key of keys) {
    const view = await adminLicenseView(env, key);
    if (!view) continue;
    if (!includeRevoked && !only && (view.status !== 'active' || view.tombstoned)) continue;
    views.push(view);
  }
  views.sort((a, b) => a.issued_at.localeCompare(b.issued_at));

  // Welcomes the worker minted and could not deliver. Named here because the
  // only detector this defect had was the operator noticing a key with no
  // usage on it, which is an inference and not a record (adversarial read,
  // 2026-09-18). An empty array is the ordinary answer.
  const undelivered = await listOwedDeliveries(env);

  return adminJson({
    generated_at: new Date().toISOString(),
    counter_source: env.LICENSE_COUNTER ? 'durable_object' : 'kv_only',
    total_in_kv: keys.length,
    undelivered,
    licenses: views,
  }, 200);
}

// ─── Phase 4: Lemon Squeezy webhook ────────────────────────────────────────
//
// LS POSTs to /lemonsqueezy-webhook with:
//   Headers:
//     X-Event-Name: subscription_created | subscription_updated | subscription_cancelled
//     X-Signature: hex-encoded HMAC SHA256 of the raw body, keyed by
//                  LEMONSQUEEZY_WEBHOOK_SECRET.
//   Body (JSON): LS event payload — see https://docs.lemonsqueezy.com/help/webhooks
//
// We verify the signature, then look the event name up in
// SUBSCRIPTION_EVENT_ACTION (and, for events that carry a status change, the
// status in SUBSCRIPTION_STATUS_ACTION). Those two tables are the whole
// lifecycle policy; the handlers below only execute the action they name.
//
// LS retries failed webhooks with backoff. Returning 200 is the success
// signal; any non-2xx triggers a retry. Verification failures return 401
// (don't retry — those are bogus). Body-parse failures return 400.

interface LSWebhookSubscription {
  data: {
    type: string;
    id: string;
    attributes: {
      user_email: string;
      user_name?: string;
      status: string;
      first_subscription_item?: {
        quantity: number;
      };
      // The product and the variant (the plan) the subscription is for. The variant decides the
      // features its keys carry, through PLAN_FEATURES. Absent on invoice and order payloads.
      product_id?: number | string;
      variant_id?: number | string;
      // When the subscription is cancelled, the instant the paid period
      // ends and access should stop. Null on a live subscription.
      ends_at?: string | null;
      // LS stamps the subscription's last change; every event carries the
      // value current at emission, so a later event carries a later (or
      // equal) stamp. Lifecycle ordering is decided on it.
      updated_at?: string;
      // Refund events carry a subscription INVOICE (subscription_payment_refunded)
      // or an ORDER (order_refunded), not a subscription. The invoice names
      // its subscription; the order names only the customer.
      subscription_id?: number | string;
      refunded?: boolean;
      refunded_at?: string | null;
    };
  };
  meta: {
    event_name: string;
    // LS sets test_mode=true for events from test-mode purchases. The
    // live webhook endpoint may still receive these if the dashboard's
    // webhook config catches both modes, or if someone uses LS's
    // "preview / test purchase" buttons. Without this flag the worker
    // would mint a real license + email a real key for a test event.
    test_mode?: boolean;
  };
}

async function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  signatureHex: string,
): Promise<boolean> {
  if (!signatureHex) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  // Strict hex parse (Q19): the lenient variant mapped non-hex chars to 0
  // instead of rejecting; one correct implementation now serves both the
  // webhook signature and the TSA DER path.
  const sigBytes = hexToBytesStrict(signatureHex);
  if (sigBytes === null || sigBytes.length === 0) return false;
  try {
    // Type-only cast: pins the buffer generic for TS 5.7 BufferSource
    // strictness; hexToBytes always allocates a plain ArrayBuffer.
    return await crypto.subtle.verify('HMAC', key, sigBytes as Uint8Array<ArrayBuffer>, encoder.encode(rawBody));
  } catch {
    return false;
  }
}

// A key is the only thing that stands between a stranger and a paying person's readings, so it must not be found by
// guessing: 20 characters from a 32-letter alphabet is 100 bits. Eight characters (40 bits) left some live key
// within reach of a caller who guesses long enough. Keys minted shorter keep working, because LICENSE_KEY_PATTERN
// takes 8 to 32 characters. The alphabet skips 0, 1, l, i and o for hand-typing, and 256 is a multiple of 32, so the
// modulo draws every letter equally. The trial and review scripts mint the same way.
const LICENSE_SECRET_LENGTH = 20;
function generateLicenseSecret(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(LICENSE_SECRET_LENGTH);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < LICENSE_SECRET_LENGTH; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

// All paid tiers share the same caps now (Phase 5 pricing reform). Tier
// label is purely cosmetic / for support correlation. Webhook-minted keys
// use `starter` for uniformity.
const WEBHOOK_MINTED_TIER: LicenseTier = 'starter';

async function mintAndStoreLicense(
  env: Env,
  customerEmail: string,
  subscriptionId: string,
  issuedAt: Date,
  features: string[],
  featuresAt: string | null,
): Promise<string> {
  const key = `fw-${WEBHOOK_MINTED_TIER}-${generateLicenseSecret()}`;
  const record: LicenseRecord = {
    tier: WEBHOOK_MINTED_TIER,
    status: 'active',
    customer_email: customerEmail,
    issued_at: issuedAt.toISOString(),
    daily_calls: 0,
    daily_reset_at: nextUtcMidnight(issuedAt).toISOString(),
    monthly_tokens: 0,
    monthly_reset_at: nextPeriodStartIso(issuedAt.toISOString(), issuedAt),
    subscription_id: subscriptionId,
    features,
    ...(featuresAt ? { features_at: featuresAt } : {}),
  };
  await env.LICENSES.put(key, JSON.stringify(record));
  return key;
}

/** The features a key minted for this event carries: its variant's list, or the reading. */
function mintFeatures(env: Env, payload: LSWebhookSubscription): string[] {
  return featuresForVariant(env.PLAN_FEATURES, payload.data.attributes.variant_id) ?? featuresOf('starter', undefined);
}

// The features and stamp for keys a quantity increase mints. A late event older than the plan the
// subscription's keys already carry would otherwise give the new seats a stale plan, so the newest
// applied plan wins over the event's own.
async function featuresForNewSeats(
  env: Env,
  payload: LSWebhookSubscription,
  activeKeys: string[],
): Promise<{ features: string[]; featuresAt: string | null }> {
  const stamp = eventStamp(payload);
  let newest: LicenseRecord | null = null;
  for (const key of activeKeys) {
    const record = await loadLicense(env, key);
    if (!record?.features_at) continue;
    if (!newest || new Date(record.features_at).getTime() > new Date(newest.features_at!).getTime()) newest = record;
  }
  if (newest && (stamp === null || new Date(stamp).getTime() < new Date(newest.features_at!).getTime())) {
    return { features: featuresOf(newest.tier, newest.features), featuresAt: newest.features_at! };
  }
  return { features: mintFeatures(env, payload), featuresAt: stamp };
}

// A plan change (or any status event that names the plan) sets the features of the live keys to the
// plan's list, but only from an event strictly later than the last one applied (features_at), and
// the stamp advances even when the list is unchanged: otherwise, with plan Y at T1, X at T2 and Y at
// T3 arriving T3 first, the late T2 would pass the check against T1 and leave the key on X. An event
// that names no variant, or carries no stamp, changes nothing. Revoked keys keep what they had.
async function syncSubscriptionFeatures(
  env: Env,
  payload: LSWebhookSubscription,
  activeKeys: string[],
  eventName: string,
): Promise<void> {
  const target = featuresForVariant(env.PLAN_FEATURES, payload.data.attributes.variant_id);
  const stamp = eventStamp(payload);
  if (target === null || stamp === null) return;
  let changed = 0;
  for (const key of activeKeys) {
    const record = await loadLicense(env, key);
    if (!record || record.status !== 'active') continue;
    if (record.features_at && new Date(stamp).getTime() <= new Date(record.features_at).getTime()) continue;
    const same = JSON.stringify(featuresOf(record.tier, record.features)) === JSON.stringify(target);
    await env.LICENSES.put(key, JSON.stringify({ ...record, features: target, features_at: stamp }));
    if (!same) changed++;
  }
  if (changed > 0) console.log(`[webhook] ${eventName} sub=${payload.data.id} features=${target.join(',')} keys=${changed}`);
}

// Subscription→keys index. KV doesn't support secondary indexes, so we
// maintain this lookup as a separate KV entry keyed `sub:<subscription_id>`
// with a JSON-encoded string[] of license keys.
function subscriptionIndexKey(subscriptionId: string): string {
  return `sub:${subscriptionId}`;
}

async function getKeysForSubscription(env: Env, subscriptionId: string): Promise<string[]> {
  const raw = await env.LICENSES.get(subscriptionIndexKey(subscriptionId));
  if (raw === null) return [];   // no index entry — subscription has no keys
  try {
    return JSON.parse(raw) as string[];
  } catch (err) {
    // The index entry exists but is corrupt. Swallowing it to [] would make
    // subscription_cancelled silently revoke nothing — the user keeps access.
    // Throw so handleLemonsqueezyWebhook returns 500 and Lemon Squeezy retries
    // rather than treating the cancellation as successfully processed.
    const msg = err instanceof Error ? err.message : 'unknown';
    console.warn(`[webhook] sub-index corrupt sub=${subscriptionId} error=${msg}`);
    throw new Error(`subscription index corrupt: ${subscriptionId}`);
  }
}

async function setKeysForSubscription(
  env: Env,
  subscriptionId: string,
  keys: string[],
): Promise<void> {
  await env.LICENSES.put(subscriptionIndexKey(subscriptionId), JSON.stringify(keys));
}

// ─── Licence-key delivery ──────────────────────────────────────────────────
//
// What a person experienced on each failure path before this layer existed
// (adversarial read of this file, 2026-09-18):
//
//   RESEND_API_KEY unset, or Resend answering a non-2xx: they had paid, Lemon
//   Squeezy had shown a receipt, the key was minted and sitting in KV, and
//   sendLicenseKeysEmail returned { sent: false }. The handler wrote one
//   console.warn and returned normally, so the webhook answered 200 and the
//   payment provider marked the delivery successful. Nothing retried. The
//   pricing page promises the key by email and there is no thank-you page
//   anywhere, so email was the only channel: they were left with a charge, a
//   receipt, and nothing to paste into the extension. The only detector was
//   the operator reading the licence report by hand and noticing a key with
//   no usage on it.
//
//   The Resend fetch THROWING rather than answering: the throw escaped, the
//   webhook returned 500 and the provider redelivered, which is correct, but
//   the redelivery re-entered, found the keys already minted, logged
//   "already minted" and returned BEFORE reaching the email. The one retry
//   that existed was structurally incapable of doing the thing that failed.
//
//   A payload whose user_email was absent or reshaped: the value went to
//   Resend as a recipient unchecked, so a key was minted, addressed to
//   nobody, and reported as a success.
//
// What happens now: an undelivered welcome is written to
// `owed:<subscription_id>` with the keys already minted, the recipient and
// the reason, and the webhook answers non-2xx. The provider redelivers; the
// redelivery finds the ledger and re-sends THOSE keys instead of minting a
// second set, so the buyer gets one mail carrying the key they paid for. A
// debt that survives the provider's retry budget is listed under
// `undelivered` in GET /admin/licenses, so the detector is a named line in
// the report rather than an inference from a usage counter. If
// RESEND_API_KEY is never set, every attempt fails and the buyer is reached
// by hand. The ledger says who, and which keys.

// A recipient the mail provider can actually address. Deliberately not an RFC
// 5322 parser: this refuses the shapes that turn into an unaddressable key:
// an absent field, an empty or whitespace value, no @, no dot after it, a
// comma-separated list, a header-injection attempt. An address that passes
// here and still bounces comes back as a Resend status and is owed the same
// way.
const RECIPIENT_PATTERN = /^[^\s@,;:<>"'\\]+@[^\s@,;:<>"'\\]+\.[^\s@,;:<>"'\\]{2,}$/;

function deliverableRecipient(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  // 254 octets is the longest address an SMTP path accepts.
  if (trimmed.length === 0 || trimmed.length > 254) return null;
  if (!RECIPIENT_PATTERN.test(trimmed)) return null;
  return trimmed;
}

// Resend.com transactional email. Never throws: every failure comes back as a
// reason the caller can write into the ledger, because a throw here is the
// shape that made the retry useless. Body uses a minimal HTML template; the
// customer's email client renders it.
//
// Reasons it returns: invalid_recipient, no_resend_key, resend_threw,
// resend_http_<status>.
async function sendLicenseKeysEmail(
  env: Env,
  customerEmail: unknown,
  customerName: string | undefined,
  licenseKeys: string[],
): Promise<{ sent: boolean; reason?: string }> {
  const recipient = deliverableRecipient(customerEmail);
  if (!recipient) {
    return { sent: false, reason: 'invalid_recipient' };
  }
  if (!env.RESEND_API_KEY) {
    return { sent: false, reason: 'no_resend_key' };
  }
  // Escape the customer-supplied name before HTML interpolation: Lemon
  // Squeezy passes it through from checkout, so a crafted name could inject
  // markup into the outbound email (survey I6).
  const escapeHtml = (s: string): string => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const greeting = customerName ? `Hi ${escapeHtml(customerName.split(' ')[0])},` : 'Hi,';
  const keysList = licenseKeys.map(k => `<li><code style="font-family:monospace;font-size:15px;background:#f5f5f5;padding:4px 8px;border-radius:4px;">${k}</code></li>`).join('');
  const seatLabel = licenseKeys.length === 1 ? '1 user' : `${licenseKeys.length} users`;
  const html = `
    <p>${greeting}</p>
    <p>Thank you for subscribing to FeelingWise (${seatLabel}). Your license key${licenseKeys.length === 1 ? ' is' : 's are'} below.</p>
    <ul style="list-style:none;padding-left:0;">${keysList}</ul>
    <p>To activate:</p>
    <ol>
      <li>Install the FeelingWise Chrome extension if you haven't already: <a href="https://chromewebstore.google.com/detail/feelingwise/mcdanhgfcpjpajlmjcdfeaeanlkodifp">Chrome Web Store</a></li>
      <li>Click the FeelingWise icon &rarr; go to the <strong>Keys</strong> tab.</li>
      <li>Paste a license key into the License field and click Save.</li>
      <li>${licenseKeys.length > 1 ? 'Give the remaining keys to the other people in your family, one key per Chrome install.' : 'That is it. Paid features start working immediately.'}</li>
    </ol>
    <p>You can manage or cancel your subscription anytime through your Lemon Squeezy customer portal.</p>
    <p>If something does not work, reply to this email. I wrote the code and I answer the support address myself.</p>
  `;
  let resp: Response;
  try {
    resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'FeelingWise <support@feelingwise.org>',
        to: [recipient],
        subject: `Welcome to FeelingWise - your license key${licenseKeys.length === 1 ? '' : 's'}`,
        html,
      }),
    });
  } catch (err) {
    // This fetch was bare. A DNS, TLS or timeout failure escaped the function,
    // became a 500, and the redelivery it triggered then skipped the email
    // entirely, so the throw was both the failure and the reason it could not
    // be repaired. It is a reason now, like any other.
    const kind = err instanceof Error ? err.name : 'unknown';
    console.warn(`[webhook] resend fetch threw kind=${kind}`);
    return { sent: false, reason: 'resend_threw' };
  }
  if (!resp.ok) {
    return { sent: false, reason: `resend_http_${resp.status}` };
  }
  return { sent: true };
}

// The ledger of welcomes owed. One entry per subscription, keyed
// `owed:<subscription_id>`, holding the keys that were minted but never
// reached anyone. It lives in the same KV namespace as the keys themselves,
// so a licence delete removes the debt with the record it names
// (worker/scripts/license-admin.mjs delete).
interface OwedDelivery {
  subscription_id: string;
  keys: string[];
  // The address as the payload gave it, which on an invalid_recipient debt is
  // the unusable value, kept because it is the evidence of what the provider
  // actually sent, and the operator needs to see it to reach the buyer.
  recipient: string;
  reason: string;
  first_owed_at: string;
  last_attempt_at: string;
  attempts: number;
  event: string;
}

function deliveryOwedKey(subscriptionId: string): string {
  return `owed:${subscriptionId}`;
}

async function loadOwedDelivery(env: Env, subscriptionId: string): Promise<OwedDelivery | null> {
  const raw = await env.LICENSES.get(deliveryOwedKey(subscriptionId));
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as OwedDelivery;
  } catch {
    // Unlike the subscription index, a corrupt ledger cannot make the worker
    // serve something it should not: it is read only to decide what to re-send.
    // Treated as absent, and the next failure rewrites it whole.
    console.warn(`[webhook] owed-ledger corrupt sub=${subscriptionId}: treated as absent`);
    return null;
  }
}

// Every welcome still owed, for the operator report. The namespace holds one
// entry per subscription with an undelivered key, so this is short by
// construction and empty in the ordinary case.
async function listOwedDeliveries(env: Env): Promise<OwedDelivery[]> {
  const out: OwedDelivery[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.LICENSES.list({ prefix: 'owed:', cursor });
    for (const { name } of page.keys) {
      const raw = await env.LICENSES.get(name);
      if (raw === null) continue;
      try {
        out.push(JSON.parse(raw) as OwedDelivery);
      } catch {
        console.warn(`[proxy] owed-ledger corrupt entry=${name}`);
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  out.sort((a, b) => (a.first_owed_at ?? '').localeCompare(b.first_owed_at ?? ''));
  return out;
}

async function recordOwedDelivery(
  env: Env,
  subscriptionId: string,
  keys: string[],
  recipient: unknown,
  reason: string,
  eventName: string,
): Promise<void> {
  const now = new Date().toISOString();
  const existing = await loadOwedDelivery(env, subscriptionId);
  const owed: OwedDelivery = {
    subscription_id: subscriptionId,
    keys: existing ? [...new Set([...existing.keys, ...keys])] : [...keys],
    recipient: typeof recipient === 'string' ? recipient : '',
    reason,
    first_owed_at: existing?.first_owed_at ?? now,
    last_attempt_at: now,
    attempts: (existing?.attempts ?? 0) + 1,
    event: eventName,
  };
  await env.LICENSES.put(deliveryOwedKey(subscriptionId), JSON.stringify(owed));
}

// Clearing is per-key, not per-subscription: a family whose second seat was
// minted in a later event can owe one key while the first is long delivered.
async function clearOwedDelivery(env: Env, subscriptionId: string, sentKeys: string[]): Promise<void> {
  const existing = await loadOwedDelivery(env, subscriptionId);
  if (!existing) return;
  const remaining = existing.keys.filter(key => !sentKeys.includes(key));
  if (remaining.length === 0) {
    await env.LICENSES.delete(deliveryOwedKey(subscriptionId));
    return;
  }
  await env.LICENSES.put(
    deliveryOwedKey(subscriptionId),
    JSON.stringify({ ...existing, keys: remaining }),
  );
}

// An expired subscription has no later event that would re-send its welcome, so the ledger and the address in it
// go with it: the privacy page holds them until the mail can be sent, and after the end it never can be (the open
// board's R086, 14 Oct 2026). Only the expiry drops it. A pause, a missed payment, a cancel running to its period
// end and a refund can all be followed by a reactivation (a subscription refunded on 2026-08-28 stayed "cancelled,
// expires 28 Sep", SUBSCRIPTION_EVENT_ACTION), and then deliverOwedKeys needs the ledger to get the keys to the
// buyer; when they end instead, the expiry that ends them is what drops it.
async function dropOwedDelivery(env: Env, subscriptionId: string, eventName: string): Promise<void> {
  if ((await env.LICENSES.get(deliveryOwedKey(subscriptionId))) === null) return;
  await env.LICENSES.delete(deliveryOwedKey(subscriptionId));
  console.log(`[webhook] ${eventName} sub=${subscriptionId} owed_delivery_dropped: the subscription has expired`);
}

// Thrown when the keys exist and the person does not have them. The webhook
// turns it into a non-2xx so the payment provider redelivers: the alternative
// is answering 200 for a call whose only job it could not finish.
class DeliveryNotMade extends Error {
  constructor(subscriptionId: string, reason: string) {
    super(`licence delivery not made: sub=${subscriptionId} reason=${reason}`);
    this.name = 'DeliveryNotMade';
  }
}

async function deliverLicenseKeys(
  env: Env,
  subscriptionId: string,
  recipient: unknown,
  customerName: string | undefined,
  keys: string[],
  eventName: string,
): Promise<void> {
  if (keys.length === 0) return;
  const result = await sendLicenseKeysEmail(env, recipient, customerName, keys);
  if (result.sent) {
    await clearOwedDelivery(env, subscriptionId, keys);
    console.log(`[webhook] ${eventName} sub=${subscriptionId} keys=${keys.length} email_sent=true`);
    return;
  }
  const reason = result.reason ?? 'unknown';
  await recordOwedDelivery(env, subscriptionId, keys, recipient, reason, eventName);
  // Privacy (S-1): NEVER log plaintext licence keys or the customer email.
  // They would land in `wrangler tail` and in Cloudflare's logs. The ledger in
  // KV holds both; this line holds neither and names the subscription only.
  console.warn(
    `[webhook] ${eventName} sub=${subscriptionId} keys=${keys.length} email_sent=false ` +
    `reason=${reason} owed (recover by sub from KV, never from logs)`,
  );
  throw new DeliveryNotMade(subscriptionId, reason);
}

// The redelivery's one job. Re-sends what the ledger names; it never mints,
// because minting twice is its own defect. Called on every path that a
// redelivery can re-enter, which is the fix for the guard that used to return
// before the email.
async function deliverOwedKeys(
  env: Env,
  subscriptionId: string,
  recipient: unknown,
  customerName: string | undefined,
  eventName: string,
): Promise<void> {
  const owed = await loadOwedDelivery(env, subscriptionId);
  if (owed === null) return;
  // A key revoked or deleted since the debt was written is not re-sent: the
  // subscription may have been refunded while the mail was failing.
  const live: string[] = [];
  for (const key of owed.keys) {
    const record = await loadLicense(env, key);
    if (record !== null && record.status === 'active') live.push(key);
  }
  if (live.length === 0) {
    await env.LICENSES.delete(deliveryOwedKey(subscriptionId));
    console.log(`[webhook] ${eventName} sub=${subscriptionId} owed_delivery_dropped: no active keys left`);
    return;
  }
  // The live payload's address wins when it is usable: a buyer who corrected a
  // typo in the provider's dashboard is reachable at the new one.
  const to = deliverableRecipient(recipient) ?? owed.recipient;
  await deliverLicenseKeys(env, subscriptionId, to, customerName, live, `${eventName}(owed)`);
}

function normalizeSubscriptionQuantity(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 1;
  return Math.min(100, Math.max(1, Math.floor(raw)));
}

async function handleSubscriptionCreated(env: Env, payload: LSWebhookSubscription): Promise<void> {
  const subscriptionId = payload.data.id;
  const attrs = payload.data.attributes;
  const customerEmail = attrs.user_email;
  const customerName = attrs.user_name;
  const quantity = normalizeSubscriptionQuantity(attrs.first_subscription_item?.quantity);

  // Idempotency guard: LS webhooks are at-least-once. If this sub already
  // has active indexed keys, this invocation is a duplicate (LS retry,
  // dashboard resend, network blip causing redelivery) — skip rather than
  // double-mint with a second batch of keys + second welcome email.
  // KV is eventually consistent, so a fresh invocation racing the first
  // index-write may still slip through; the no-active-keys guard in
  // handleSubscriptionUpdated absorbs the resulting parallel-fire shape.
  const existingKeys = await getKeysForSubscription(env, subscriptionId);
  const existingActive: string[] = [];
  for (const key of existingKeys) {
    const raw = await env.LICENSES.get(key);
    if (!raw) continue;
    try {
      const rec = JSON.parse(raw) as LicenseRecord;
      if (rec.status === 'active') existingActive.push(key);
    } catch { /* skip */ }
  }
  if (existingActive.length > 0) {
    console.log(`[webhook] subscription_created sub=${subscriptionId} already_minted active=${existingActive.length}`);
    // This branch used to `return` here. A redelivery is the provider's
    // answer to our own 500, and the only thing that can have failed after a
    // successful mint is the email, so returning before the email made the
    // retry incapable of the one act it was retrying. The debt is re-sent from
    // the keys that already exist; nothing is minted on this path.
    await deliverOwedKeys(env, subscriptionId, customerEmail, customerName, 'subscription_created');
    return;
  }

  const now = new Date();
  const issued: string[] = [];
  for (let i = 0; i < quantity; i++) {
    const key = await mintAndStoreLicense(env, customerEmail, subscriptionId, now, mintFeatures(env, payload), eventStamp(payload));
    issued.push(key);
  }
  await setKeysForSubscription(env, subscriptionId, issued);
  console.log(`[webhook] subscription_created sub=${subscriptionId} qty=${quantity} minted`);

  // Throws on failure after writing the ledger, so the delivery is not
  // acknowledged as successful to the payment provider. The keys stay: the
  // money was taken, so the licence exists whether or not the mail went out.
  await deliverLicenseKeys(env, subscriptionId, customerEmail, customerName, issued, 'subscription_created');
}

// ─── Subscription lifecycle table ──────────────────────────────────────────
//
// ASSUMPTION (an open question of the 2026-08-23 audit): a
// cancelled subscription keeps access until the paid period ends, and every
// non-paying status cuts access at once. Changing either answer is one row
// in the tables below. The status table also covers `subscription_updated`,
// whose payload carries the status a separate event may or may not have
// announced, so a missed event cannot leave a key in the wrong state.
//
//   mint                  create quantity keys (idempotent per subscription)
//   honour_status         SUBSCRIPTION_STATUS_ACTION[status], then quantity sync
//   cancel_at_period_end  keep active, expires_at = ends_at (revoke when absent)
//   revoke                status revoked, effective immediately
//   reactivate            status active, expires_at cleared, if the event is
//                         strictly newer than the last lifecycle event
//   ignore                acknowledged, no KV change
//   revoke_refunded_invoice  full refund of a subscription invoice: revoke the
//                         invoice's subscription keys at once
//   revoke_refunded_order  full refund of an order: revoke every active key
//                         held by the order's customer email
type LifecycleAction =
  | 'mint'
  | 'honour_status'
  | 'cancel_at_period_end'
  | 'revoke'
  | 'revoke_refunded_invoice'
  | 'revoke_refunded_order'
  | 'reactivate'
  | 'ignore';

const SUBSCRIPTION_EVENT_ACTION: Readonly<Record<string, LifecycleAction>> = {
  subscription_created: 'mint',
  subscription_updated: 'honour_status',
  subscription_plan_changed: 'honour_status',
  subscription_cancelled: 'cancel_at_period_end',
  subscription_resumed: 'reactivate',
  subscription_unpaused: 'reactivate',
  subscription_paused: 'revoke',
  subscription_expired: 'revoke',
  // Payment outcomes reach us as a status on subscription_updated; the
  // payment events themselves carry an invoice, not a subscription.
  subscription_payment_failed: 'ignore',
  subscription_payment_success: 'ignore',
  subscription_payment_recovered: 'ignore',
  // A refund is the one payment event that must act by itself. A test
  // purchase on 2026-08-28 was refunded the same day; Lemon Squeezy kept
  // the subscription "cancelled, expires 28 Sep" and no refund event was
  // subscribed, so the key stayed active for a month of AI spend the operator
  // pays for. Money back means service off, at once.
  subscription_payment_refunded: 'revoke_refunded_invoice',
  order_refunded: 'revoke_refunded_order',
};

const SUBSCRIPTION_STATUS_ACTION: Readonly<Record<string, LifecycleAction>> = {
  on_trial: 'reactivate',
  active: 'reactivate',
  cancelled: 'cancel_at_period_end',
  paused: 'revoke',
  past_due: 'revoke',
  unpaid: 'revoke',
  expired: 'revoke',
};

interface IndexedLicense {
  key: string;
  record: LicenseRecord;
}

// Every parseable record in the subscription's index, in index order.
// Corrupt entries are skipped, as the quantity handlers always did.
async function loadIndexedLicenses(env: Env, subscriptionId: string): Promise<IndexedLicense[]> {
  const keys = await getKeysForSubscription(env, subscriptionId);
  const out: IndexedLicense[] = [];
  for (const key of keys) {
    const record = await loadLicense(env, key);
    if (record) out.push({ key, record });
  }
  return out;
}

function eventStamp(payload: LSWebhookSubscription): string | null {
  const raw = payload.data.attributes.updated_at;
  if (!raw || Number.isNaN(new Date(raw).getTime())) return null;
  return raw;
}

// True when `stamp` is strictly later than the record's last lifecycle
// event. A record without one has never been touched by the lifecycle, so
// any dated event is newer than it; an undated event is never newer.
function isNewerThanRecord(record: LicenseRecord, stamp: string | null): boolean {
  if (stamp === null) return false;
  if (!record.lifecycle_at) return true;
  return new Date(stamp).getTime() > new Date(record.lifecycle_at).getTime();
}

function laterOf(a: string | undefined, b: string | null, fallback: string): string {
  const candidates = [a, b].filter((v): v is string => typeof v === 'string');
  if (candidates.length === 0) return fallback;
  return candidates.reduce((x, y) => (new Date(y).getTime() > new Date(x).getTime() ? y : x));
}

// Tombstone first: if the record write is lost, the key is still refused.
async function revokeLicense(
  env: Env, key: string, record: LicenseRecord, stamp: string | null, reason?: RevokeReason,
): Promise<void> {
  const revokedAt = laterOf(record.lifecycle_at, stamp, new Date().toISOString());
  const tombstone: RevocationTombstone = reason ? { revoked_at: revokedAt, reason } : { revoked_at: revokedAt };
  await env.LICENSES.put(tombstoneKey(key), JSON.stringify(tombstone));
  const { revoke_reason: _was, ...rest } = record;
  const revoked: LicenseRecord = reason
    ? { ...rest, status: 'revoked', lifecycle_at: revokedAt, revoke_reason: reason }
    : { ...rest, status: 'revoked', lifecycle_at: revokedAt };
  await env.LICENSES.put(key, JSON.stringify(revoked));
}

// Revocation is never subject to the ordering check: a stale revoke after
// a fresh reactivation cuts a paying customer off until the next event,
// which is the cheaper mistake. The opposite (a stale reactivation after a
// revoke) would serve a non-paying key indefinitely.
//
// `reason` is the store's (RevokeReason). An end also reaches the keys a pause or a failed payment already stopped:
// those were the store's 'stopped', and the subscription is now over. A key revoked any other way is left as it is.
async function revokeSubscriptionKeys(
  env: Env, payload: LSWebhookSubscription, eventName: string, reason?: RevokeReason,
): Promise<void> {
  const subscriptionId = payload.data.id;
  const stamp = eventStamp(payload);
  const licenses = await loadIndexedLicenses(env, subscriptionId);
  let revokedCount = 0;
  let endedCount = 0;
  for (const { key, record } of licenses) {
    if (record.status === 'revoked') {
      if (reason !== 'expired') continue;
      const tombstone = await loadTombstone(env, key);
      const was = tombstone !== null ? tombstone.reason : record.revoke_reason;
      if (was !== 'stopped') continue;
      await revokeLicense(env, key, record, stamp, 'expired');
      endedCount++;
      continue;
    }
    await revokeLicense(env, key, record, stamp, reason);
    revokedCount++;
  }
  console.log(
    `[webhook] ${eventName} sub=${subscriptionId} revoked=${revokedCount}/${licenses.length}` +
    (reason ? ` reason=${reason}` : '') + (endedCount > 0 ? ` stopped_now_expired=${endedCount}` : ''),
  );
}

// A refund event is "fully refunded" when LS says so on the object itself.
// A partial refund is operator goodwill (only the merchant can issue one) and
// leaves the key alone; the log names it so the operator can revoke by hand.
function isFullRefund(payload: LSWebhookSubscription): boolean {
  const a = payload.data.attributes;
  return a.refunded === true || a.status === 'refunded';
}

function refundStamp(payload: LSWebhookSubscription): string | null {
  const a = payload.data.attributes;
  const raw = a.refunded_at ?? a.updated_at;
  if (!raw || Number.isNaN(new Date(raw).getTime())) return null;
  return raw;
}

// subscription_payment_refunded carries a subscription INVOICE whose
// `subscription_id` names the subscription; revoke that subscription's keys
// exactly as an expiry would.
async function revokeRefundedInvoiceKeys(env: Env, payload: LSWebhookSubscription, eventName: string): Promise<void> {
  const a = payload.data.attributes;
  if (!isFullRefund(payload)) {
    console.log(`[webhook] ${eventName} invoice=${payload.data.id} status=${a.status} partial_or_not_refunded: keys untouched`);
    return;
  }
  const subscriptionId = a.subscription_id === undefined || a.subscription_id === null ? '' : String(a.subscription_id);
  if (!subscriptionId) {
    console.log(`[webhook] ${eventName} invoice=${payload.data.id} no_subscription_id: nothing to revoke`);
    return;
  }
  const stamp = refundStamp(payload);
  const synthetic: LSWebhookSubscription = {
    data: { type: 'subscriptions', id: subscriptionId, attributes: { ...a, updated_at: stamp ?? undefined } },
    meta: payload.meta,
  };
  await revokeSubscriptionKeys(env, synthetic, eventName);
}

// order_refunded carries an ORDER, which names the customer but not the
// subscription. Every active key held by that customer email is revoked: a
// customer with two subscriptions who refunds one loses both, which is the
// cheaper mistake and one the operator can undo by hand. Rare event, so the
// full-namespace list is acceptable.
async function revokeRefundedOrderKeys(env: Env, payload: LSWebhookSubscription, eventName: string): Promise<void> {
  const a = payload.data.attributes;
  if (!isFullRefund(payload)) {
    console.log(`[webhook] ${eventName} order=${payload.data.id} status=${a.status} partial_or_not_refunded: keys untouched`);
    return;
  }
  const email = (a.user_email ?? '').trim().toLowerCase();
  if (!email) {
    console.log(`[webhook] ${eventName} order=${payload.data.id} no_user_email: nothing to revoke`);
    return;
  }
  const stamp = refundStamp(payload);
  let revokedCount = 0;
  let seen = 0;
  let skippedUnpaid = 0;
  let cursor: string | undefined;
  do {
    const page = await env.LICENSES.list({ prefix: 'fw-', cursor });
    for (const { name } of page.keys) {
      const record = await loadLicense(env, name);
      if (!record) continue;
      seen++;
      if (record.status === 'revoked') continue;
      if ((record.customer_email ?? '').trim().toLowerCase() !== email) continue;
      // A refunded ORDER has no claim on a key that no order ever paid for.
      // A key minted by a subscription carries `subscription_id`; a key the
      // operator minted by hand (the founder key, review keys, trial keys,
      // early manual sales) does not. This sweep matches on the customer
      // email alone, by design, because a refund event names an order or an
      // invoice and never a subscription. Without this line one refund
      // revokes every key that email has ever held.
      // Found 2026-09-20: a refunded test subscription made the sweep revoke
      // a hand-minted internal key of 2026-07-14 held under the same address,
      // the key an internal install ran on. The purchase and that key had
      // nothing to do with each other except the email, and the email is the
      // weakest link in the record.
      if (!record.subscription_id) { skippedUnpaid++; continue; }
      await revokeLicense(env, name, record, stamp);
      revokedCount++;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  console.log(`[webhook] ${eventName} order=${payload.data.id} revoked=${revokedCount} of ${seen} records for the refunded customer, ${skippedUnpaid} hand-minted key(s) left alone`);
}

// Period-end cancellation: the customer paid through `ends_at`, so the key
// stays active with that instant as its hard stop and `licenseExpired`
// does the cut-off. Without a usable `ends_at` the cancel is treated as a
// revoke: serving an unknown-length grace period is the wrong default.
async function cancelSubscriptionAtPeriodEnd(env: Env, payload: LSWebhookSubscription, eventName: string): Promise<void> {
  const subscriptionId = payload.data.id;
  const stamp = eventStamp(payload);
  const endsAt = payload.data.attributes.ends_at;
  if (!endsAt || Number.isNaN(new Date(endsAt).getTime())) {
    console.log(`[webhook] ${eventName} sub=${subscriptionId} no_ends_at: revoking at once`);
    await revokeSubscriptionKeys(env, payload, eventName);
    return;
  }
  const licenses = await loadIndexedLicenses(env, subscriptionId);
  let stamped = 0;
  for (const { key, record } of licenses) {
    if (record.status !== 'active') continue;
    if (record.lifecycle_at && !isNewerThanRecord(record, stamp)) continue;
    const scheduled: LicenseRecord = {
      ...record,
      expires_at: endsAt,
      lifecycle_at: laterOf(record.lifecycle_at, stamp, new Date().toISOString()),
    };
    await env.LICENSES.put(key, JSON.stringify(scheduled));
    stamped++;
  }
  console.log(`[webhook] ${eventName} sub=${subscriptionId} expires_at_set=${stamped}/${licenses.length}`);
}

// Reactivation applies only to keys whose last lifecycle event is older
// than this one. An undated event, or one older than the revocation it
// would undo, leaves the key revoked; a fresh activation is then either a
// later dated event or a new subscription (subscription_created mints new
// keys). A revoked key with no lifecycle stamp was revoked by the operator,
// not by Lemon Squeezy, and the webhook never lifts that. A fresh event
// always records its stamp, even on a key it leaves active, so a stale
// cancel delivered afterwards cannot apply. Returns the keys that are
// active once it has run.
async function reactivateSubscriptionKeys(env: Env, payload: LSWebhookSubscription, eventName: string): Promise<string[]> {
  const subscriptionId = payload.data.id;
  const stamp = eventStamp(payload);
  const licenses = await loadIndexedLicenses(env, subscriptionId);
  const active: string[] = [];
  let reactivated = 0;
  let stale = 0;
  let operatorRevoked = 0;
  for (const { key, record } of licenses) {
    // A tombstone is a revocation even when the record write that should
    // have accompanied it was lost; its stamp joins the ordering check.
    const tombstone = await loadTombstone(env, key);
    const revokedByWebhook = record.status !== 'active' || tombstone !== null;
    const lastStamp = laterOf(record.lifecycle_at, tombstone?.revoked_at || null, '');
    const seen: LicenseRecord = lastStamp ? { ...record, lifecycle_at: lastStamp } : record;
    if (!isNewerThanRecord(seen, stamp)) {
      stale++;
      if (!revokedByWebhook) active.push(key);
      continue;
    }
    if (revokedByWebhook && !lastStamp) {
      operatorRevoked++;
      continue;
    }
    if (revokedByWebhook || record.expires_at !== undefined) reactivated++;
    const { expires_at: _dropped, revoke_reason: _reason, ...rest } = record;
    const revived: LicenseRecord = { ...rest, status: 'active', lifecycle_at: stamp as string };
    await env.LICENSES.put(key, JSON.stringify(revived));
    // Last, so a failure between the two leaves the key refused, not served.
    if (tombstone !== null) await env.LICENSES.delete(tombstoneKey(key));
    active.push(key);
  }
  console.log(
    `[webhook] ${eventName} sub=${subscriptionId} reactivated=${reactivated} stale=${stale} ` +
    `operator_revoked=${operatorRevoked} active=${active.length}/${licenses.length}`,
  );
  return active;
}

// Quantity sync for a live subscription: mint up to the new quantity or
// revoke the surplus (last-issued first). `activeKeys` is the post-status
// set, so a reactivation in the same delivery is already counted.
async function syncSubscriptionQuantity(
  env: Env,
  payload: LSWebhookSubscription,
  activeKeys: string[],
  eventName: string,
): Promise<void> {
  const subscriptionId = payload.data.id;
  const attrs = payload.data.attributes;
  const newQuantity = normalizeSubscriptionQuantity(attrs.first_subscription_item?.quantity);
  // No active keys means either subscription_created has not landed yet
  // (its index write is in flight) or nothing survived the status step.
  // Minting here would double-mint or resurrect; both are wrong.
  if (activeKeys.length === 0) {
    console.log(`[webhook] ${eventName} sub=${subscriptionId} skipped: no_active_keys`);
    return;
  }
  await syncSubscriptionFeatures(env, payload, activeKeys, eventName);
  if (newQuantity > activeKeys.length) {
    const toMint = newQuantity - activeKeys.length;
    const now = new Date();
    const seat = await featuresForNewSeats(env, payload, activeKeys);
    const newKeys: string[] = [];
    for (let i = 0; i < toMint; i++) {
      newKeys.push(await mintAndStoreLicense(env, attrs.user_email, subscriptionId, now, seat.features, seat.featuresAt));
    }
    await setKeysForSubscription(env, subscriptionId, [...activeKeys, ...newKeys]);
    console.log(`[webhook] ${eventName} sub=${subscriptionId} minted=${toMint}`);
    // Throws on failure; the seats a household added are owed exactly as a
    // first purchase is, and on redelivery the quantity is already synced so
    // this branch is not re-entered, and the trailing deliverOwedKeys below is
    // what re-sends them.
    await deliverLicenseKeys(env, subscriptionId, attrs.user_email, attrs.user_name, newKeys, eventName);
  } else if (newQuantity < activeKeys.length) {
    const stamp = eventStamp(payload);
    const toRevoke = activeKeys.slice(newQuantity);
    for (const key of toRevoke) {
      const record = await loadLicense(env, key);
      if (record) await revokeLicense(env, key, record, stamp);
    }
    await setKeysForSubscription(env, subscriptionId, activeKeys.slice(0, newQuantity));
    console.log(`[webhook] ${eventName} sub=${subscriptionId} revoked=${toRevoke.length}`);
  } else {
    console.log(`[webhook] ${eventName} sub=${subscriptionId} no_quantity_change`);
  }
  // Last, and after the state work above has landed: a welcome still owed
  // from an earlier event is retried on every later event for the same
  // subscription, so a subscription that goes on living gets its mail out
  // even after the payment provider has spent its retry budget. Putting it
  // last means a permanently undeliverable address cannot stop the lifecycle
  // from being applied.
  await deliverOwedKeys(env, subscriptionId, attrs.user_email, attrs.user_name, eventName);
}

// subscription_updated and subscription_plan_changed: the carried status
// decides the state, then a live subscription gets its quantity synced.
async function honourSubscriptionStatus(env: Env, payload: LSWebhookSubscription, eventName: string): Promise<void> {
  const subscriptionId = payload.data.id;
  const status = payload.data.attributes.status;
  const action = SUBSCRIPTION_STATUS_ACTION[status];
  if (action === undefined) {
    // An unknown status is logged and treated as live: the key's state is
    // left as it is and only the quantity is synced, as before the table.
    console.log(`[webhook] ${eventName} sub=${subscriptionId} unknown_status=${status}`);
    const licenses = await loadIndexedLicenses(env, subscriptionId);
    const active = licenses.filter(l => l.record.status === 'active').map(l => l.key);
    await syncSubscriptionQuantity(env, payload, active, eventName);
    return;
  }
  await applyLifecycleAction(env, payload, action, `${eventName}(${status})`);
}

async function applyLifecycleAction(
  env: Env,
  payload: LSWebhookSubscription,
  action: LifecycleAction,
  eventName: string,
): Promise<void> {
  switch (action) {
    case 'mint':
      await handleSubscriptionCreated(env, payload);
      return;
    case 'honour_status':
      await honourSubscriptionStatus(env, payload, eventName);
      return;
    case 'cancel_at_period_end':
      await cancelSubscriptionAtPeriodEnd(env, payload, eventName);
      return;
    case 'revoke': {
      const status = payload.data.attributes.status;
      // The subscription ended (expired, or unpaid, which ends the same way) or only stopped (paused, past_due): the
      // key says which (RevokeReason).
      const ended = eventName === 'subscription_expired' || status === 'expired' || status === 'unpaid';
      await revokeSubscriptionKeys(env, payload, eventName, ended ? 'expired' : 'stopped');
      // Of the revoking events only an expiry is an end; the rest can be resumed (dropOwedDelivery).
      if (eventName === 'subscription_expired' || status === 'expired') {
        await dropOwedDelivery(env, payload.data.id, eventName);
      }
      return;
    }
    case 'revoke_refunded_invoice':
      await revokeRefundedInvoiceKeys(env, payload, eventName);
      return;
    case 'revoke_refunded_order':
      await revokeRefundedOrderKeys(env, payload, eventName);
      return;
    case 'reactivate': {
      const active = await reactivateSubscriptionKeys(env, payload, eventName);
      await syncSubscriptionQuantity(env, payload, active, eventName);
      return;
    }
    case 'ignore':
      console.log(`[webhook] ${eventName} sub=${payload.data.id} ignored by table`);
      return;
  }
}

async function handleLemonsqueezyWebhook(request: Request, env: Env): Promise<Response> {
  if (!env.LEMONSQUEEZY_WEBHOOK_SECRET) {
    console.log('[webhook] rejected: LEMONSQUEEZY_WEBHOOK_SECRET not configured');
    return new Response('Webhook secret not configured', { status: 503 });
  }
  // Bounded first: the signature check needs the whole body, so there is no
  // cheaper gate than size on a route with no bearer token in front of it.
  const rawBody = await readBoundedText(request, WEBHOOK_MAX_BODY_BYTES);
  if (rawBody === null) {
    console.log('[webhook] rejected: body over the size cap');
    return new Response('Request body too large', { status: 413 });
  }
  const signature = request.headers.get('X-Signature') ?? '';
  const headerEventName = request.headers.get('X-Event-Name') ?? '';

  const valid = await verifyWebhookSignature(env.LEMONSQUEEZY_WEBHOOK_SECRET, rawBody, signature);
  if (!valid) {
    console.log(`[webhook] rejected: invalid signature event=${headerEventName}`);
    return new Response('Invalid signature', { status: 401 });
  }

  let payload: LSWebhookSubscription;
  try {
    payload = JSON.parse(rawBody) as LSWebhookSubscription;
  } catch {
    console.log(`[webhook] rejected: body not JSON event=${headerEventName}`);
    return new Response('Invalid JSON', { status: 400 });
  }

  // The signature covers the body and not the headers, so the action comes from the signed event
  // name, and a header that names a different event is refused rather than believed.
  const eventName = typeof payload.meta?.event_name === 'string' ? payload.meta.event_name : '';
  if (headerEventName !== '' && headerEventName !== eventName) {
    console.log(`[webhook] rejected: header event=${headerEventName} disagrees with signed event=${eventName}`);
    return new Response('Event name does not match the signed body', { status: 400 });
  }

  // Drop test-mode events on the live endpoint. We acknowledge with 200
  // so LS doesn't retry, but skip minting / revoking — test events
  // shouldn't move real KV state. The dashboard can still trigger these
  // (preview buttons, "test purchase" flows) post-go-live; without this
  // guard those would create live license keys and send real emails.
  if (payload.meta?.test_mode === true) {
    console.log(`[webhook] skipped: test_mode event=${eventName} sub=${payload.data?.id ?? '(no-id)'}`);
    return new Response('OK (test_mode skipped)', { status: 200 });
  }

  // Q15: replay guard. A captured, validly-signed delivery (HMAC has no
  // timestamp window) could be replayed to re-run its mutation, e.g. a
  // subscription_updated with a higher quantity re-minting keys. Key on the
  // body digest: LS retries after our 500 send the IDENTICAL body, so the
  // marker is written only after a SUCCESSFUL dispatch; a retry of a failed
  // delivery re-processes, a replay of a successful one is acknowledged and
  // dropped. 30-day TTL bounds KV growth; KV eventual consistency leaves a
  // small race window, which this guard narrows rather than closes.
  const digestBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawBody));
  const bodyDigest = Array.from(new Uint8Array(digestBytes)).map(b => b.toString(16).padStart(2, '0')).join('');
  const replayKey = `evt:${bodyDigest}`;
  if (await env.LICENSES.get(replayKey) !== null) {
    console.log(`[webhook] skipped: duplicate delivery event=${eventName} digest=${bodyDigest.slice(0, 12)}`);
    return new Response('OK (duplicate delivery)', { status: 200 });
  }

  // Dispatch through the lifecycle table. Events it does not list are
  // accepted with 200 so LS doesn't retry, but logged.
  try {
    const action = SUBSCRIPTION_EVENT_ACTION[eventName];
    if (action === undefined) {
      console.log(`[webhook] unsupported event=${eventName} accepted`);
    } else {
      await applyLifecycleAction(env, payload, action, eventName);
    }
    // Mark processed ONLY on success (see replay-guard note above).
    try {
      await env.LICENSES.put(replayKey, '1', { expirationTtl: 30 * 24 * 60 * 60 });
    } catch {
      // Marker write failure risks one replay window; never fail the
      // delivery over bookkeeping.
    }
    return new Response('OK', { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.log(`[webhook] handler-threw event=${eventName} error=${msg}`);
    // 500 → LS will retry. Acceptable for transient KV / Resend failures.
    return new Response('Handler error', { status: 500 });
  }
}

// ─── RFC 3161 Time-Stamp Authority proxy ───────────────────────────────────
//
// Third-party signed timestamps from FreeTSA (https://freetsa.org). The
// extension periodically anchors the latest forensic-chain integrity hash
// by POSTing here; we build an RFC 3161 TimeStampReq from the hash, forward
// to FreeTSA, parse the response just enough to surface the TSA-claimed
// time, and return the raw TimeStampToken bytes (base64) for the extension
// to store.
//
// Why route through the worker (vs. extension calling FreeTSA directly):
//   • Keeps the MV3 bundle small — no ASN.1 library shipped to the client.
//   • Centralizes the TSA URL so we can swap providers / add failover
//     without an extension update.
//   • FreeTSA serves HTTP only on some endpoints; routing through Cloudflare
//     lets us preserve TLS to the client while reaching the TSA.
//
// What the extension stores: the raw response bytes are returned base64'd
// in `response` (full TimeStampResp incl. PKIStatus) and `tst` (the inner
// CMS SignedData TimeStampToken alone). Either is sufficient for offline
// cryptographic verification against the embedded TSA certificate; the
// `generalizedTime` field is a parsed convenience for display only and is
// NOT the load-bearing evidence.

const FREETSA_URL = 'https://freetsa.org/tsr';

// SHA-256 algorithm OID: 2.16.840.1.101.3.4.2.1 → DER-encoded form.
const SHA256_OID_DER = new Uint8Array([
  0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01,
]);
const ASN1_NULL = new Uint8Array([0x05, 0x00]);

function derLen(n: number): Uint8Array {
  if (n < 0x80) return new Uint8Array([n]);
  if (n < 0x100) return new Uint8Array([0x81, n]);
  if (n < 0x10000) return new Uint8Array([0x82, (n >> 8) & 0xff, n & 0xff]);
  throw new Error('der_length_too_large');
}

function derPrim(tag: number, content: Uint8Array): Uint8Array {
  const lb = derLen(content.length);
  const out = new Uint8Array(1 + lb.length + content.length);
  out[0] = tag;
  out.set(lb, 1);
  out.set(content, 1 + lb.length);
  return out;
}

function derSeq(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const body = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { body.set(p, off); off += p.length; }
  return derPrim(0x30, body);
}

function hexToBytesStrict(hex: string): Uint8Array | null {
  const s = hex.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(s) || s.length % 2 !== 0) return null;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < s.length; i += 2) out[i / 2] = parseInt(s.slice(i, i + 2), 16);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// Build RFC 3161 TimeStampReq for a SHA-256 hash.
//
//   TimeStampReq ::= SEQUENCE {
//     version           INTEGER { v1(1) },
//     messageImprint    SEQUENCE { hashAlgorithm, hashedMessage },
//     certReq           BOOLEAN  -- TRUE = ask TSA to include its cert
//   }
function buildTimeStampReqSHA256(hashBytes: Uint8Array): Uint8Array {
  if (hashBytes.length !== 32) throw new Error('sha256_must_be_32_bytes');
  const version = new Uint8Array([0x02, 0x01, 0x01]);
  const hashAlgorithm = derSeq([SHA256_OID_DER, ASN1_NULL]);
  const hashedMessage = derPrim(0x04, hashBytes);
  const messageImprint = derSeq([hashAlgorithm, hashedMessage]);
  const certReq = new Uint8Array([0x01, 0x01, 0xff]);
  return derSeq([version, messageImprint, certReq]);
}

function parseDerLength(b: Uint8Array, off: number): { length: number; next: number } | null {
  if (off >= b.length) return null;
  const f = b[off];
  if ((f & 0x80) === 0) return { length: f, next: off + 1 };
  const n = f & 0x7f;
  if (n === 0 || off + 1 + n > b.length) return null;
  let len = 0;
  for (let i = 0; i < n; i++) len = (len << 8) | b[off + 1 + i];
  return { length: len, next: off + 1 + n };
}

// Best-effort extraction of the TSA's claimed time from inside a CMS-wrapped
// TimeStampToken. Scans the bytes for the ASN.1 GeneralizedTime tag (0x18)
// followed by a plausible length + ASCII time string. Returns ISO-8601 or
// null. This is intentionally not a full ASN.1 walker — the load-bearing
// evidence is the raw TST bytes which the recipient verifies against the
// TSA certificate. The parsed time is for human display only.
function extractGeneralizedTime(bytes: Uint8Array): string | null {
  for (let i = 0; i < bytes.length - 2; i++) {
    if (bytes[i] !== 0x18) continue;
    const len = parseDerLength(bytes, i + 1);
    if (!len) continue;
    if (len.length < 13 || len.length > 19) continue;
    if (len.next + len.length > bytes.length) continue;
    const s = new TextDecoder().decode(bytes.slice(len.next, len.next + len.length));
    const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\.\d{1,3})?Z$/);
    if (!m) continue;
    return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ?? ''}Z`;
  }
  return null;
}

// Parse the TimeStampResp envelope. Per RFC 3161:
//
//   TimeStampResp ::= SEQUENCE {
//     status                  PKIStatusInfo,
//     timeStampToken          TimeStampToken OPTIONAL
//   }
//   PKIStatusInfo ::= SEQUENCE { status INTEGER, ... }
//
// Status 0 = granted, 1 = grantedWithMods, others = error.
function parseTimeStampResp(bytes: Uint8Array): {
  status: number;
  tstBytes: Uint8Array | null;
  reason: string | null;
} {
  if (bytes[0] !== 0x30) return { status: -1, tstBytes: null, reason: 'not_a_sequence' };
  const outer = parseDerLength(bytes, 1);
  if (!outer) return { status: -1, tstBytes: null, reason: 'bad_outer_length' };
  let off = outer.next;
  if (bytes[off] !== 0x30) return { status: -1, tstBytes: null, reason: 'no_status_info' };
  const statusLen = parseDerLength(bytes, off + 1);
  if (!statusLen) return { status: -1, tstBytes: null, reason: 'bad_status_length' };
  const inner = statusLen.next;
  if (bytes[inner] !== 0x02) return { status: -1, tstBytes: null, reason: 'no_status_int' };
  const statusIntLen = parseDerLength(bytes, inner + 1);
  if (!statusIntLen || statusIntLen.length === 0) return { status: -1, tstBytes: null, reason: 'bad_status_int' };
  let status = 0;
  for (let i = 0; i < statusIntLen.length; i++) {
    status = (status << 8) | bytes[statusIntLen.next + i];
  }
  off = statusLen.next + statusLen.length;
  if (off >= bytes.length) {
    return {
      status,
      tstBytes: null,
      reason: status === 0 || status === 1 ? 'no_token' : 'rejected',
    };
  }
  const tstStart = off;
  if (bytes[tstStart] !== 0x30) return { status, tstBytes: null, reason: 'token_not_sequence' };
  const tstLen = parseDerLength(bytes, tstStart + 1);
  if (!tstLen) return { status, tstBytes: null, reason: 'token_bad_length' };
  const tstEnd = tstLen.next + tstLen.length;
  if (tstEnd > bytes.length) return { status, tstBytes: null, reason: 'token_truncated' };
  return { status, tstBytes: bytes.slice(tstStart, tstEnd), reason: null };
}

// Per-license daily cap on TSA anchor calls (G2 fix, 2026-08-04). FreeTSA is
// a free third-party service, so every /v1/tsa call spends FW's standing with
// it rather than dollars — and before this cap a single valid license could
// relay unbounded FreeTSA traffic through the Worker. Cap arithmetic against
// the client's own cadence (src/forensics/chain-anchor-store.ts): the head is
// stamped no sooner than five and a half hours after the last stamp, whatever
// the install records, so an install asks for about four rounds a day.
// 100/day therefore breaks nobody legitimate while bounding a hostile key to
// 100 FreeTSA round-trips/day. ATTEMPTS count, not successes — the cap protects the TSA
// from FW-originated traffic and a failed round-trip is still a round-trip
// (unlike chat, where only Groq-billed successes meter).
const TSA_DAILY_ANCHOR_CAP = 100;

// Reserve one anchor slot against the per-license daily cap. Same
// reserve/reconcile + LICENSE_COUNTER Durable Object machinery as
// reserveUsage, but on a dedicated `<counter>:tsa` DO so anchor traffic
// never consumes the chat daily-call budget (and vice versa). The
// token/monthly dimension is unused: tokens=0 against monthlyLimit=0 always
// passes the monthly check.
async function reserveTsaAnchor(
  env: Env,
  auth: AuthSuccess,
  requestId: string,
  requireAtomicCounter: boolean,
): Promise<UsageReservationResult> {
  // `dev` is the uncapped founder/testing tier (see DAILY_CALL_CAP_BY_TIER).
  // The legacy escape hatch (no DO binding on a non-strict entry) mirrors
  // reserveUsage: direct-module tests without a counter binding keep the
  // pre-cap pass-through, while the deployed entry (worker/src/index.ts)
  // passes requireAtomicCounter=true and fails closed below.
  if (auth.record.tier === 'dev' || (!env.LICENSE_COUNTER && !requireAtomicCounter)) {
    return { ok: true, reservation: { mode: 'legacy' } };
  }
  if (!env.LICENSE_COUNTER) return { ok: false, reason: 'unavailable' };

  try {
    const counterName = `${await licenseCounterName(auth.parsed.raw)}:tsa`;
    const result = await env.LICENSE_COUNTER.getByName(counterName).reserve({
      requestId,
      calls: 1,
      tokens: 0,
      dailyLimit: TSA_DAILY_ANCHOR_CAP,
      monthlyLimit: 0,
      nowIso: new Date().toISOString(),
      dailyResetAt: auth.record.daily_reset_at,
      monthlyResetAt: auth.record.monthly_reset_at,
      // The anchor counter's snapshot can be mirrored into the key's record, so it rolls on the same day.
      periodAnchor: auth.record.issued_at,
    });
    return result.ok
      ? { ok: true, reservation: { mode: 'atomic', counterName, requestId } }
      : { ok: false, reason: result.cap };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    console.warn(`[tsa] anchor-reserve-failed license=${fingerprint(auth.parsed)} error=${message}`);
    return { ok: false, reason: 'unavailable' };
  }
}

// Settle the anchor attempt on every post-reservation path (success AND
// upstream failure — attempts count, see TSA_DAILY_ANCHOR_CAP). Legacy
// reservations held nothing, and routing them through reconcileUsage's
// legacy branch would wrongly bill the license's CHAT daily counter in KV,
// so only atomic reservations reconcile.
function reconcileTsaAnchor(
  ctx: ExecutionContext,
  env: Env,
  auth: AuthSuccess,
  reservation: UsageReservation,
): void {
  if (reservation.mode !== 'atomic') return;
  reconcileUsage(ctx, env, auth, reservation, 1, 0);
}

async function handleTsa(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  requireAtomicCounter: boolean,
): Promise<Response> {
  const origin = request.headers.get('Origin');
  const requestId = crypto.randomUUID();

  const auth = await authenticate(request, env);
  if (!auth.ok) {
    console.log(`[tsa] req=${requestId} auth-failed code=${auth.body.error.code}`);
    return authFailureResponse(auth, origin);
  }

  // Q17: a TSA request is a 64-char hash in JSON; bound the body before
  // reading it.
  const preflightFailure = contentLengthFailure(request, TSA_MAX_BODY_BYTES);
  if (preflightFailure) {
    return jsonResponse(preflightFailure.body, preflightFailure.status, origin);
  }

  const rawTsaBody = await readBoundedText(request, TSA_MAX_BODY_BYTES);
  if (rawTsaBody === null) {
    const failure = bodyTooLargeFailure();
    return jsonResponse(failure.body, failure.status, origin);
  }

  let payload: { hash?: unknown };
  try {
    payload = JSON.parse(rawTsaBody) as { hash?: unknown };
  } catch {
    return jsonResponse(
      { error: { message: 'Invalid JSON body', code: 'bad_request' } },
      400,
      origin,
    );
  }
  if (typeof payload.hash !== 'string') {
    return jsonResponse(
      { error: { message: 'Missing or non-string hash field', code: 'missing_hash' } },
      400,
      origin,
    );
  }
  const hashBytes = hexToBytesStrict(payload.hash);
  if (!hashBytes || hashBytes.length !== 32) {
    return jsonResponse(
      { error: { message: 'Hash must be 32-byte SHA-256 hex (64 chars)', code: 'invalid_hash' } },
      400,
      origin,
    );
  }

  let tsr: Uint8Array;
  try {
    tsr = buildTimeStampReqSHA256(hashBytes);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return jsonResponse(
      { error: { message: `TimeStampReq build failed: ${msg}`, code: 'tsr_build_error' } },
      500,
      origin,
    );
  }

  // Reserve AFTER validation so malformed requests (which never reach
  // FreeTSA) don't consume anchor slots, but BEFORE the upstream fetch so
  // the cap bounds every FreeTSA round-trip (G2, 2026-08-04).
  const reservationResult = await reserveTsaAnchor(env, auth, requestId, requireAtomicCounter);
  if (!reservationResult.ok) {
    console.log(`[tsa] req=${requestId} anchor-rejected license=${fingerprint(auth.parsed)} reason=${reservationResult.reason}`);
    return usageReservationFailureResponse(reservationResult.reason, origin);
  }
  const reservation = reservationResult.reservation;

  const t0 = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch(FREETSA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/timestamp-query' },
      // Type-only cast: same TS 5.7 buffer-generic pin as the HMAC verify.
      body: tsr as Uint8Array<ArrayBuffer>,
    });
  } catch {
    reconcileTsaAnchor(ctx, env, auth, reservation);
    const latencyMs = Date.now() - t0;
    console.log(`[tsa] req=${requestId} upstream-fetch-failed license=${fingerprint(auth.parsed)} latency=${latencyMs}ms`);
    return jsonResponse(
      { error: { message: 'TSA unreachable', code: 'tsa_fetch_error' } },
      502,
      origin,
    );
  }

  // The FreeTSA round-trip happened; count the attempt no matter what the
  // response says (see TSA_DAILY_ANCHOR_CAP — attempts, not successes).
  reconcileTsaAnchor(ctx, env, auth, reservation);

  if (!upstream.ok) {
    const latencyMs = Date.now() - t0;
    console.log(`[tsa] req=${requestId} upstream-status=${upstream.status} license=${fingerprint(auth.parsed)} latency=${latencyMs}ms`);
    return jsonResponse(
      { error: { message: `TSA returned HTTP ${upstream.status}`, code: 'tsa_http_error' } },
      502,
      origin,
    );
  }

  const respBytes = new Uint8Array(await upstream.arrayBuffer());
  const parsed = parseTimeStampResp(respBytes);
  const latencyMs = Date.now() - t0;

  if (parsed.status !== 0 && parsed.status !== 1) {
    console.log(`[tsa] req=${requestId} tsa-rejected status=${parsed.status} reason=${parsed.reason ?? '-'} license=${fingerprint(auth.parsed)} latency=${latencyMs}ms`);
    return jsonResponse(
      { error: { message: `TSA rejected (status=${parsed.status})`, code: 'tsa_rejected' } },
      502,
      origin,
    );
  }
  if (!parsed.tstBytes) {
    console.log(`[tsa] req=${requestId} no-token status=${parsed.status} license=${fingerprint(auth.parsed)} latency=${latencyMs}ms`);
    return jsonResponse(
      { error: { message: 'TSA response had no TimeStampToken', code: 'tsa_no_token' } },
      502,
      origin,
    );
  }

  const generalizedTime = extractGeneralizedTime(parsed.tstBytes);
  console.log(`[tsa] req=${requestId} ok status=${parsed.status} time=${generalizedTime ?? 'unknown'} license=${fingerprint(auth.parsed)} latency=${latencyMs}ms`);
  return jsonResponse(
    {
      ok: true,
      tsaProvider: 'freetsa',
      response: bytesToBase64(respBytes),
      tst: bytesToBase64(parsed.tstBytes),
      generalizedTime,
    },
    200,
    origin,
  );
}

// Exported for unit tests in worker/test/tsa.spec.ts.
export const __TSA_INTERNAL = {
  buildTimeStampReqSHA256,
  parseTimeStampResp,
  extractGeneralizedTime,
  hexToBytesStrict,
  bytesToBase64,
};

// Exported for unit tests (cap sync + KV-corruption control flow +
// pricing-drift solvency). Test-only surface; not part of the request path.
export const __TEST_INTERNAL = {
  DAILY_CALL_CAP_BY_TIER,
  MONTHLY_USD_CAP_BY_TIER,
  GROQ_BLENDED_RATE_PER_1M_USD,
  TSA_DAILY_ANCHOR_CAP,
  MODELS_CACHE_SUCCESS_TTL_MS,
  MODELS_CACHE_FAILURE_TTL_MS,
  getKeysForSubscription,
  SUBSCRIPTION_EVENT_ACTION,
  SUBSCRIPTION_STATUS_ACTION,
  tombstoneKey,
  licenseExpired,
  loadLicense,
  mirrorCounterToKv,
  counterMirrorDue,
  MIRROR_CALLS_DRIFT,
  MIRROR_TOKENS_DRIFT,
  normalizeSubscriptionQuantity,
  deliveryOwedKey,
  deliverableRecipient,
  readBoundedText,
  reserveCounterState,
  reconcileCounterState,
  // The /v1/models cache is module-level state; tests reset it between
  // cases so one test's warm cache can't leak into the next.
  resetModelsCache: (): void => { modelsCache = null; },
  generateLicenseSecret,
  callerAddress,
  AUTH_FAILURE_LIMIT,
  resetAuthFailures: (): void => { authFailuresByAddress.clear(); keysThatWorked.clear(); },
  CLAUDE_MONTHLY_SHARE,
  CLAUDE_CEILING_COUNTER_NAME,
  monthlyTokenCapForTier,
  USAGE_LARGEST_CHAT_HOLD,
  USAGE_LARGEST_CLAUDE_HOLD,
  chatUsageFallbackTokenEquivalents,
  CHAT_MODELS_ALLOWED,
  CHAT_MAX_BODY_BYTES,
  CHAT_MAX_OUTPUT_TOKENS,
  CLAUDE_MONTHLY_USD_CAP_DEFAULT,
};

// ─── Entry point ───────────────────────────────────────────────────────────

export async function fetchWorker(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  // Q19: default TRUE (fail closed). The old false default meant repointing
  // wrangler.toml main at this file would silently drop every license to
  // the racy legacy KV path. Unit tests, which have no Durable Object, opt
  // out explicitly via env.ALLOW_LEGACY_COUNTER_FOR_TESTS; production
  // wrangler.toml never sets that var.
  requireAtomicCounter: boolean = (env as { ALLOW_LEGACY_COUNTER_FOR_TESTS?: boolean })
    .ALLOW_LEGACY_COUNTER_FOR_TESTS !== true,
): Promise<Response> {
  const origin = request.headers.get('Origin');
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (url.pathname === '/health' && request.method === 'GET') {
    return handleHealth(request, env);
  }
  if (url.pathname === '/v1/chat/completions' && request.method === 'POST') {
    return handleChatCompletions(request, env, ctx, requireAtomicCounter);
  }
  if (url.pathname === '/v1/claude/verdict' && request.method === 'POST') {
    return handleClaudeVerdict(request, env, ctx, requireAtomicCounter);
  }
  if (url.pathname === '/v1/models' && request.method === 'GET') {
    return handleModels(request, env);
  }
  if (url.pathname === '/v1/usage' && request.method === 'GET') {
    return handleUsage(request, env, requireAtomicCounter);
  }
  if (url.pathname === '/v1/entitlements' && request.method === 'GET') {
    return handleEntitlements(request, env);
  }
  if (url.pathname === '/v1/repairs' && request.method === 'GET') {
    return handleRepairs(request, env);
  }
  if (url.pathname === '/v1/dom-report' && request.method === 'POST') {
    return handleDomReport(request, env);
  }
  if (url.pathname === '/v1/tsa' && request.method === 'POST') {
    return handleTsa(request, env, ctx, requireAtomicCounter);
  }
  if (url.pathname === '/lemonsqueezy-webhook' && request.method === 'POST') {
    return handleLemonsqueezyWebhook(request, env);
  }
  if (url.pathname === '/admin/licenses' && request.method === 'GET') {
    return handleAdminLicenses(request, env);
  }

  return jsonResponse(
    { error: { message: 'Not Found', code: 'route_not_found' } },
    404,
    origin,
  );
}

export default {
  fetch: fetchWorker,
};
