// FeelingWise — license tier resolution
//
// V1 lean approach: no backend, no cryptographic signing, no server check.
// Manual key delivery for the first ~10 customers. License key format
// embeds the tier directly. Determined users could mint fake keys; that's
// later work.
//
// Format: `fw-<tier>-<secret>` (case-insensitive on read; persisted lowercased)
//   - tier: free | starter | family | extended
//   - secret: 8-32 alphanumeric chars
//   - examples: fw-starter-<12 alphanumerics>, fw-family-<8 alphanumerics>
//
// Free tier installs run with NO license key set; we resolve to FREE_LICENSE
// implicitly. Per-tier daily-cap and feature gating live here so a single
// import covers the tier story.

// `dev` is the founder/internal-testing tier: uncapped daily + monthly so the
// operator can stress-test far past a real user's volume without tripping the
// solvency-sized customer caps. It is NOT a customer-facing tier — keys are
// hand-seeded into the proxy KV, never minted by the Lemon Squeezy webhook.
import { isContextAlive, isContextError, markContextInvalidated } from './context-guard';
import { getLocalWithRetry } from './local-read';
import { TEXT_CAP_STORAGE_KEY } from './cap-markers';
import { LICENSE_REFUSED_STORAGE_KEY, forgetLicenseRefusal } from './license-refusal';
import { READING_PAUSED_STORAGE_KEY, forgetReadingPause } from './reading-pause';
import { GROQ_BLENDED_RATE_PER_1M_USD } from './usage-weights';

export type LicenseTier = 'free' | 'starter' | 'family' | 'extended' | 'dev';

export interface LicenseInfo {
  tier: LicenseTier;
  secret: string;
}

export const FREE_LICENSE: LicenseInfo = { tier: 'free', secret: '' };

const VALID_TIERS: ReadonlySet<LicenseTier> = new Set([
  'free',
  'starter',
  'family',
  'extended',
  'dev',
]);

// Paid-tier keys only. `fw-free-*` is rejected so a parent who types
// `fw-free-xxx` doesn't get the green "key valid" UI followed by silent
// degradation (DAILY_CAP_BY_TIER.free === 0 → no AI calls). The free
// tier needs no key — `getLicense` returns `FREE_LICENSE` when storage
// is empty.
const LICENSE_KEY_REGEX = /^fw-(starter|family|extended|dev)-([a-z0-9]{8,32})$/i;

export const LICENSE_STORAGE_KEY = 'fw_license_key';
const STORAGE_KEY = LICENSE_STORAGE_KEY;

// Last successfully-resolved PAID license, remembered in-memory per module
// instance (one per content script / SW / dashboard). A TRANSIENT, non-context
// `chrome.storage.local.get` failure — observed under the heavy concurrent
// storage I/O of audio/video analysis — used to flip a paid/dev user to
// FREE_LICENSE, surfaced downstream as a `cap: 'tier-free'` ("free plan") error.
// On such a blip getLicense now returns this cached license instead of FREE.
// A successful read that resolves to FREE clears it (the user's current state is
// authoritatively free); a dead context never consults it (the script is
// orphaned — a tab refresh re-injects a live one).
let lastGoodPaidLicense: LicenseInfo | null = null;

// Set once a realm has authoritatively resolved to free: a cold read (no cached
// paid license) that resolved empty even after the empty-read retry. getLicense
// runs per post, so a genuine free user must not pay that retry on every call.
// While this is true getLicense skips the empty-read retry and returns free on a
// single fast read — but it still performs that one read, so a paid key later
// written by another surface (popup/dashboard) is still picked up and re-arms.
// Reset to false whenever a paid key is read or stored; set true by clearLicense.
let realmConfirmedFree = false;

/**
 * Single source of truth for per-tier caps. `dailyCalls` is the LLM-call
 * cap per UTC day; `monthlyUsd` is the Groq-spend cap per UTC month.
 *
 * Free tier is `{ 0, 0 }` (no AI calls regardless of either cap). Paid
 * tiers are uniform `{ 2000/day, $3.50/month }` because each license is
 * one user, period. (Daily cap lowered 2500→2000 on 2026-05-31 for an
 * extra solvency margin; ~2.5x the heaviest observed real usage, and the
 * regex/DOM layer keeps protecting once the AI cap is hit.) Tier names (starter / family / extended) are
 * display labels on customer receipts + Lemon Squeezy product labels —
 * they no longer carry different per-license behavior. What a customer pays
 * is on landing/pricing.html; at the time of writing it is one family price
 * per month, not the per-user figure an earlier note here quoted.
 *
 * Pricing context for the $3.50 monthly cap (was $5 until 9 Oct 2026): FW absorbs the AI cost
 * through the proxy. The heaviest real month measured cost $1.30 to $2.60, so the cap only bites on
 * a rare cap-out user, and at $3.50 that user still costs less than a 6 euro sale brings in. Above the cap, the proxy returns 429
 * cap_monthly and the pipeline silently passes posts through (no AI
 * analysis, DOM-side protections still apply) until UTC month flip.
 *
 * Parent can override `settings.dailyCap` / `monthlyUsdCapOverride`
 * to dial DOWN from the tier cap but cannot exceed it.
 *
 * Pre-2026-05-24 the two caps lived as separate Records — easy to
 * forget one when adding a new tier. Audit A5/A6 V1.5 ROADMAP rank 16:
 * single source of truth.
 *
 * **Cross-realm mirror**: `worker/src/proxy.ts` holds a matching map
 * that the FW proxy enforces server-side. When values here change,
 * the worker mirror MUST update in lockstep — otherwise the popup
 * displays one cap while the proxy enforces another. The worker file
 * is out of scope for client-side audits (CLAUDE.md skip-list); sync
 * on the next worker deploy by copying these values across.
 */
// Sentinel cap for the uncapped `dev` tier. Large-but-finite (not Infinity) so
// the dollar→token conversion and any popup cap-progress display stay plain
// numbers. The real uncapping is the `isUncappedTier` bypass at the gates;
// this value is the backstop that keeps `dev` effectively limitless even if a
// gate ever forgets the bypass.
const UNCAPPED = 1_000_000;

// monthlyUsd = the ALL-AI cost ceiling per license. $3.50 keeps the worst case under what a 6 euro
// sale brings in after VAT and the shop's fees (worked out in the project's cost table, kept with its private papers). Authoritative enforcement is the worker proxy (server-side, tamper-proof); this
// mirror drives the client-side pre-flight cap check. Every AI call meters through the one monthly
// counter (worker recordUsage), conservatively, so a dollar counted binds at <= a dollar real. The AI is text
// only: the video eyes and ears that this note used to price are not in the product, and the proxy
// has no route for them (2026-09-16).
export const LICENSE_TIER_CAPS: Readonly<Record<LicenseTier, { dailyCalls: number; monthlyUsd: number }>> = {
  free: { dailyCalls: 0, monthlyUsd: 0 },
  starter: { dailyCalls: 2000, monthlyUsd: 3.5 },
  family: { dailyCalls: 2000, monthlyUsd: 3.5 },
  extended: { dailyCalls: 2000, monthlyUsd: 3.5 },
  dev: { dailyCalls: UNCAPPED, monthlyUsd: UNCAPPED },
};

/**
 * True for tiers that bypass daily-call + monthly-spend caps entirely (founder
 * / internal testing). Gates consult this to skip the cap math rather than
 * relying on a large cap value alone — the user-configurable `settings.dailyCap`
 * would otherwise still bind via `min(settings.dailyCap, tierCap)`.
 */
export function isUncappedTier(tier: LicenseTier): boolean {
  return tier === 'dev';
}

/** Derived: daily-call cap per tier. Pipeline-side enforcement consults this. */
export const DAILY_CAP_BY_TIER: Readonly<Record<LicenseTier, number>> = {
  free: LICENSE_TIER_CAPS.free.dailyCalls,
  starter: LICENSE_TIER_CAPS.starter.dailyCalls,
  family: LICENSE_TIER_CAPS.family.dailyCalls,
  extended: LICENSE_TIER_CAPS.extended.dailyCalls,
  dev: LICENSE_TIER_CAPS.dev.dailyCalls,
};

/**
 * Basis rate that converts the dollar cap to a token cap (`monthlyTokenCapForTier`),
 * mirroring the worker. VERIFIED provider pricing (2026-06-21):
 *   • Text — `openai/gpt-oss-20b` on DeepInfra: $0.030/M in, $0.14/M out, read
 *     live 2026-09-21 off DeepInfra's own /models metadata. FW's prompt is
 *     input-heavy (~6000 in / ~150 out) ⇒ effective ~$0.033/M, far BELOW this
 *     $0.10/M basis, so text meters well OVER real cost (conservative). ✓
 *     It was Groq at $0.075/M in and $0.30/M out until that day, where the same
 *     prompt worked out at ~$0.08/M, only just under the basis.
 *   • There is no second provider to blend in: the video eyes and ears this note
 *     used to scale up are gone from the product and from the proxy (2026-09-16).
 * At the $3.50 cap this allows 35M token-equivalents/month, above the $2.60 the heaviest real
 * month measured cost.
 *
 * The basis itself is not restated here: it comes from src/storage/usage-weights.ts, the file the
 * extension and the proxy keep byte-identical, so there is one number and not three
 * (PLAN-2026-09-16 item 6.9).
 */

/**
 * What the AI reading cost, in euros, when it was sold: per family, not
 * per seat (ADR-0003), monthly or yearly at the early-adopter price.
 *
 * The extension prints no price: the reading is not sold now, and a key already
 * held keeps working until it ends. The numbers stay for the store listing guard in
 * tests/private/docs/public-copy-claims.test.ts, which holds the listing's price
 * lines to them until the listing's own text changes.
 */
export const AI_PRICE_EUR_MONTHLY = 6;
export const AI_PRICE_EUR_YEARLY = 60;

/** Derived: monthly USD cap per tier. */
export const MONTHLY_USD_CAP_BY_TIER: Readonly<Record<LicenseTier, number>> = {
  free: LICENSE_TIER_CAPS.free.monthlyUsd,
  starter: LICENSE_TIER_CAPS.starter.monthlyUsd,
  family: LICENSE_TIER_CAPS.family.monthlyUsd,
  extended: LICENSE_TIER_CAPS.extended.monthlyUsd,
  dev: LICENSE_TIER_CAPS.dev.monthlyUsd,
};

/**
 * Parse a raw license-key string into structured `LicenseInfo`. Returns null
 * when the format is invalid; caller decides whether to fall back to
 * `FREE_LICENSE`. Case-insensitive on input; whitespace is trimmed.
 */
export function parseLicenseKey(raw: string | null | undefined): LicenseInfo | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const trimmed = raw.trim().toLowerCase();
  const match = LICENSE_KEY_REGEX.exec(trimmed);
  if (!match) return null;
  const tier = match[1] as LicenseTier;
  if (!VALID_TIERS.has(tier)) return null;
  return { tier, secret: match[2] };
}

/**
 * Format-validate a license key without persisting. Returns true iff the key
 * would parse successfully. Useful for the settings UI to enable/disable a
 * "Save" button as the user types.
 */
export function isValidLicenseKey(raw: string | null | undefined): boolean {
  return parseLicenseKey(raw) !== null;
}

/**
 * Read the persisted license from `chrome.storage.local`. Always fails closed
 * to `FREE_LICENSE` — never throws. Two failure shapes are distinguished:
 *
 *   - No key / non-string / malformed value: expected for a fresh install or a
 *     Free-tier user, so the FREE fallback is SILENT (surfacing it would be UX
 *     noise).
 *   - A thrown chrome.storage error: this is NOT expected — it means the paid
 *     user's tier read failed and the AI classifier silently turns off (see
 *     feedback_no_detection_check_license_tier_first). Warn-log it so the cause
 *     is visible in the extension error log, then still return FREE.
 */
export async function getLicense(): Promise<LicenseInfo> {
  // Orphaned content script after an extension reload: chrome.storage throws
  // "Extension context invalidated" on every read. Once any guarded path has
  // seen that, short-circuit so the read loop can't flood the console or thrash
  // the FREE fallback — a tab refresh re-injects a live content script.
  if (!isContextAlive()) return FREE_LICENSE;
  let raw: unknown;
  try {
    // getLocalWithRetry absorbs the transient storage blips seen under heavy
    // video/audio I/O, so a single momentary failure no longer flips a paid/dev
    // user to FREE on a freshly-injected content script (cold in-memory cache).
    // The isPresent predicate widens that absorption to a resolved-but-missing
    // key (an empty read that did NOT throw), retried the same as a thrown blip.
    // That empty-read retry fires ONLY until the realm is confirmed free: it
    // exists to recover a cold PAID tab whose first read is transiently empty,
    // so once a cold read has resolved authoritatively free there is nothing to
    // recover and later per-post reads skip it (a thrown blip is still retried).
    const isPresent = realmConfirmedFree
      ? undefined
      : (record: Record<string, unknown>) => STORAGE_KEY in record;
    const stored = await getLocalWithRetry(STORAGE_KEY, undefined, undefined, isPresent);
    raw = stored[STORAGE_KEY];
  } catch (err) {
    // A dead context is the graceful-shutdown case (markContextInvalidated logs
    // it once); only NON-context storage errors are the unexpected paid-tier
    // read failure worth a per-call warning.
    if (isContextError(err)) {
      markContextInvalidated();
      return FREE_LICENSE;
    }
    // Transient read failure that survived the retries (NOT a dead context):
    // keep the paid user paid by returning the last-known license rather than
    // collapsing to the free cap.
    console.warn('[FeelingWise] getLicense storage read failed (after retry) — falling back to last-known license:', err);
    return lastGoodPaidLicense ?? FREE_LICENSE;
  }
  if (typeof raw !== 'string') {
    // Empty/missing read that RESOLVED (did not throw). A legitimate transition
    // to free always routes through clearLicense() (which nulls the cache) or a
    // fresh install (cache already null); setLicense only ever stores a paid key.
    // So a warm cache here is proof of a transient blip, not a real downgrade —
    // keep the user paid and leave the safety net armed. Only a cold cache (no
    // paid read yet this realm) is the genuine fresh/free case.
    if (lastGoodPaidLicense !== null) return lastGoodPaidLicense;
    // Cold + resolved empty (past the retry): authoritatively free. Remember it
    // so subsequent per-post reads skip the empty-read retry.
    realmConfirmedFree = true;
    return FREE_LICENSE;
  }
  const resolved = parseLicenseKey(raw) ?? FREE_LICENSE;
  lastGoodPaidLicense = resolved.tier === 'free' ? null : resolved;
  // A paid key is present in storage — this realm is not free (recovers a realm
  // that was briefly confirmed free before the key became readable).
  if (resolved.tier !== 'free') realmConfirmedFree = false;
  return resolved;
}

/**
 * Best-effort: does storage currently hold a VALID paid/dev license key?
 *
 * Diagnostics-only. Lets a caller tell a GENUINE free user (no key stored —
 * AI off by design) apart from a paid/dev license that momentarily resolved
 * FREE (the read-collapse class fixed by getLocalWithRetry). parseLicenseKey's
 * regex rejects `fw-free-*`, so any non-null parse means a paid/dev key is
 * present. Never throws.
 *
 * Q50 (W52): tri-state. The old boolean returned `false` on a read FAILURE,
 * which reported "genuine free tier" during the exact storage-blip window
 * this diagnostic exists to detect — the wrong line, and the one that ends
 * triage. 'unreadable' means we could not look.
 */
export async function hasStoredPaidLicenseKey(): Promise<'present' | 'absent' | 'unreadable'> {
  try {
    const stored = await getLocalWithRetry(STORAGE_KEY);
    return parseLicenseKey(stored[STORAGE_KEY] as string | undefined) !== null ? 'present' : 'absent';
  } catch {
    return 'unreadable';
  }
}

/**
 * Persist a license key to `chrome.storage.local` after validating its format.
 * Returns `{ ok: true, license }` on success or `{ ok: false, error }` on
 * format failure. Storage failures bubble as exceptions (caller surfaces).
 *
 * The stored value is the input lowercased + trimmed (canonical form); this
 * way `getLicense` can rely on consistent casing without re-normalizing.
 */
export async function setLicense(
  rawKey: string,
): Promise<{ ok: true; license: LicenseInfo } | { ok: false; error: string }> {
  const parsed = parseLicenseKey(rawKey);
  if (!parsed) {
    return {
      ok: false,
      error: 'License key format invalid. Expected: fw-<tier>-<secret>',
    };
  }
  const canonical = rawKey.trim().toLowerCase();
  await chrome.storage.local.set({ [STORAGE_KEY]: canonical });
  await clearCapMarkers();
  // Keep the transient-failure cache coherent with the just-saved key (parsed
  // is always a paid tier — the regex rejects fw-free-*).
  lastGoodPaidLicense = parsed;
  // A paid key was just stored: this realm is no longer free, so re-arm the
  // empty-read retry for later reads.
  realmConfirmedFree = false;
  return { ok: true, license: parsed };
}

/**
 * Remove the stored license key (downgrade to FREE_LICENSE on next read).
 * Used by the settings UI's "Sign out" / "Reset license" affordance and by
 * the dashboard's full-state reset.
 */
export async function clearLicense(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
  await clearCapMarkers();
  // Sign-out is authoritative free — drop the cached paid license so a later
  // transient read failure can't resurrect it, and mark the realm free so later
  // reads skip the empty-read retry (nothing to recover after an explicit clear;
  // a fresh setLicense re-arms it).
  lastGoodPaidLicense = null;
  realmConfirmedFree = true;
}

/**
 * A cap reached by one licence does not bind the next: the proxy-cap marker goes with the key it
 * was earned under (STORAGE-LICENCE-WORKER-1). The second key is the media-AI latch no build has
 * written since that path was removed; it stays in this list, as a literal, so an install that
 * latched it long ago is cleared rather than left paused forever.
 */
async function clearCapMarkers(): Promise<void> {
  // A key pasted again (renewed) or replaced is tried at once, not after a refusal's pause.
  forgetLicenseRefusal();
  forgetReadingPause();
  try {
    await chrome.storage.local.remove([TEXT_CAP_STORAGE_KEY, 'mediaMonthlyCapReached', LICENSE_REFUSED_STORAGE_KEY, READING_PAUSED_STORAGE_KEY]);
  } catch {
    // Best-effort: the text client also compares the licence fingerprint.
  }
}

// A sign-out or key change in the popup must reach every running tab. Each
// content realm keeps lastGoodPaidLicense as a safety net against transient
// read failures; without this listener a removed key stayed "paid" in every
// open social tab (frames and audio kept uploading) until the tab reloaded
// (STORAGE-LICENCE-WORKER-2). Fires in every realm on any realm's write.
if (typeof chrome !== 'undefined' && chrome?.storage?.onChanged?.addListener) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !(STORAGE_KEY in changes)) return;
    const next = changes[STORAGE_KEY]?.newValue;
    if (typeof next !== 'string') {
      lastGoodPaidLicense = null;
      realmConfirmedFree = true;
      return;
    }
    const parsed = parseLicenseKey(next);
    lastGoodPaidLicense = parsed && parsed.tier !== 'free' ? parsed : null;
    realmConfirmedFree = lastGoodPaidLicense === null;
  });
}

/**
 * Resolve the per-tier daily LLM-call cap. Used by `pipeline.ts` cap check;
 * a separate function (vs direct map access) gives us a hook for future
 * per-tier overrides (e.g., promo codes, beta-tier bumps) without changing
 * call sites.
 */
export function dailyCapForTier(tier: LicenseTier): number {
  return DAILY_CAP_BY_TIER[tier];
}

/**
 * Resolve the per-tier monthly TOKEN cap, derived from the dollar cap and
 * the V1 single-model Groq rate. Used by `pipeline.ts` to short-circuit
 * new LLM calls when `settings.totalTokensThisMonth >= cap`. Returned as
 * an integer; tokens are whole units in Groq billing.
 */
export function monthlyTokenCapForTier(tier: LicenseTier): number {
  const usdCap = MONTHLY_USD_CAP_BY_TIER[tier];
  return Math.floor((usdCap / GROQ_BLENDED_RATE_PER_1M_USD) * 1_000_000);
}

/**
 * Resolve the EFFECTIVE monthly USD cap given a tier and an optional
 * parent override. When the parent has set `settings.monthlyUsdCapOverride`
 * to a non-negative number, that value is the cap; otherwise the
 * tier default applies. Negative or non-numeric overrides are ignored.
 *
 * The parent can dial the cap UP (more Groq spend allowed) or DOWN
 * (more conservative). Cap of 0 effectively pauses AI features —
 * pipeline short-circuits before any LLM call.
 */
export function effectiveMonthlyUsdCap(
  tier: LicenseTier,
  override: number | null | undefined,
): number {
  if (typeof override === 'number' && Number.isFinite(override) && override >= 0) {
    return override;
  }
  return MONTHLY_USD_CAP_BY_TIER[tier];
}

/**
 * Resolve the EFFECTIVE monthly TOKEN cap given a tier and an optional
 * parent override. Same shape as `monthlyTokenCapForTier` but uses the
 * effective dollar cap. The integer-tokens contract holds.
 */
export function effectiveMonthlyTokenCap(
  tier: LicenseTier,
  override: number | null | undefined,
): number {
  const usdCap = effectiveMonthlyUsdCap(tier, override);
  return Math.floor((usdCap / GROQ_BLENDED_RATE_PER_1M_USD) * 1_000_000);
}
