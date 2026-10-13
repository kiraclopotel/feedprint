# Subsystem: worker

> Rewritten 2026-08-10 against current worker/src/proxy.ts; re-read in the 2026-08-23 objective audit (spec-drift.md item 104). Line numbers are deliberately omitted here; anchor on exported names and string literals instead.

## Purpose

Cloudflare Worker proxy at api.feelingwise.org between the Chrome extension and upstream services (chat at Deep Infra since 2026-09-21, at Groq before; FreeTSA). It authenticates every request with a license key, enforces per-license daily-call and unified monthly-dollar caps through an atomic Durable Object counter, and relays route bodies upstream with server-held provider keys. It also receives Lemon Squeezy subscription webhooks to mint, update, and revoke license keys, and sends the license email via Resend.

## Key files

- worker/src/index.ts - the DEPLOYED entry (wrangler.toml main). Exports the Durable Object class and a fetch handler that calls proxy.ts fetchWorker with requireAtomicCounter=true.
- worker/src/proxy.ts - all route logic. Handlers: handleChatCompletions, handleModels, handleHealth, handleTsa, handleLemonsqueezyWebhook. The /v1/gemini and /v1/whisper routes were removed in 2.5.0 with the media features they served; GEMINI_API_KEY is no longer read. requireAtomicCounter defaults TRUE everywhere; for paid tiers the legacy KV path is reachable only behind env.ALLOW_LEGACY_COUNTER_FOR_TESTS. Dev-tier keys ALWAYS take the legacy path in production: `reserveUsage` short-circuits on `record.tier === 'dev'` to `checkCap` on the KV record (which returns null for dev) and `reconcileUsage` routes a legacy reservation to the KV read-modify-write `recordUsage`, never to the Durable Object. Dev keys are therefore uncapped and their usage is counted on the KV record only.
- worker/src/license-counter-state.ts - pure reserve/reconcile state machine for the Durable Object: period rollovers, reservation bookkeeping, RESERVATION_TTL_MS reaper (10 min) for reservations whose reconcile never arrived.
- worker/src/license-counter.ts - the Durable Object wrapper persisting that state.
- worker/wrangler.toml - deployment config: KV binding LICENSES, durable_objects binding LICENSE_COUNTER, custom domain route, smart placement, observability.
- src/storage/license.ts - client-side mirror of tier caps and key format. Must stay in lockstep with proxy.ts cap tables.

## Inputs

HTTPS requests with Authorization: Bearer fw-{tier}-{secret}. Route payloads: JSON for /v1/chat/completions; JSON {hash: hex64} for /v1/tsa; Lemon Squeezy JSON with X-Signature HMAC for /lemonsqueezy-webhook.

## Outputs

Forwarded upstream responses back to the extension. TSA JSON {ok, tsaProvider, response:base64, tst:base64, generalizedTime}. License lifecycle side effects: KV license records, Durable Object usage state, Resend email. Errors: {error:{message,code}} with 400 / 401 / 404 / 413 / 429 / 500 / 502 / 503 (no 504 is ever produced); 503 usage_coordinator_unavailable when the Durable Object binding is required but missing.

## Invariants & contracts

- Auth precedes any upstream call on every AI route; unauthenticated requests 401 before any spend.
- A license record MAY carry `note` (who holds the key, operator's words, written at mint, never read by the proxy) and `last_seen_at` (stamped by both KV write-back paths). `last_seen_at` inherits the mirror's throttle, so it lags by up to 25 calls / 50k token-equivalents and its ABSENCE never proves a key is idle. Both exist so the estate stays attributable and auditable from KV alone: nine review keys issued 2026-05-28 are permanently anonymous because their only record was a gitignored local log. `worker/scripts/license-report.mjs` (npm run license:report) is the read surface; there is deliberately no admin endpoint, since one bearer token listing every key would put the whole estate behind a single secret.
- A license record MAY carry `expires_at` (ISO 8601). `authenticate` refuses it with 401 `license_expired` once that instant has passed, on every authenticated route, before any spend. The field is absent on review keys (those end by manual revoke) and present on keys from worker/scripts/mint-trial-license.mjs and on subscription keys whose subscription was cancelled (set to the Lemon Squeezy `ends_at`; see the lifecycle table). It fails CLOSED on an unparseable value, and rides through both KV write-back paths (recordUsage, mirrorCounterToKv) via the freshly-read record they spread, so using a time-limited key cannot launder it into a permanent one. Guarded by tests/unit/worker-license-expiry.test.ts.
- Cap enforcement is reserve-then-reconcile: each capped route reserves an estimated amount in the per-license Durable Object BEFORE the upstream call and reconciles the actual usage after (ctx.waitUntil). Rejection returns 429 with cap_daily or cap_monthly. Dev tier is uncapped: the bypass is the literal `tier === 'dev'` check in the worker (there is no `isUncappedTier` in worker code; that helper is client-side), and a dev key never reaches the Durable Object.
- Reservations carry createdAt and expire after RESERVATION_TTL_MS (10 min) if never reconciled, releasing their hold; reservations without the stamp (pre-field) are treated as expired. A request straddling a period boundary bills its actuals into the NEW period (deliberate conservative choice, locked by worker-license-counter.test.ts).
- Chat meters direction-weighted token counts into ONE unified monthly token-equivalent counter sized so counted $3.50 binds at or under real $3.50.
- Only 2xx upstream responses bill; failures reconcile to zero.
- Usage truth for paid licenses lives in the Durable Object; the KV license record is a throttled MIRROR of it: `reconcile()` returns the post-reconcile snapshot and `mirrorCounterToKv` writes it back when drift reaches 25 calls / 50k token-equivalents or a period rolled, re-reading the record first so a revoked or deleted license is never resurrected, and refusing to write at all when a `rev:` tombstone exists. KV counters are therefore near-true for ops and safe as a re-seed baseline for a recreated counter, but the DO remains the only authority the caps consult.
- Revocation tombstone (STORAGE-LICENCE-WORKER-6): Workers KV has no compare-and-swap, so a revoke's put can land between the mirror's get and put and be written over by the active record the mirror re-read. Every webhook revoke therefore writes `rev:<key>` = `{revoked_at}` BEFORE the record, and `authenticate` refuses 401 `license_revoked` whenever that key exists, whatever the record's status says; an unreadable tombstone still refuses. The record's `status` is no longer the only authority and the mirror may not re-activate a tombstoned key. Only a reactivation strictly newer than `revoked_at` (which joins the ordering check even when the record's own stamp was lost) removes the tombstone, and it does so after writing the active record, so a failure between the two leaves the key refused. The operator scripts' revoke (status flip via wrangler) writes no tombstone and keeps working through the status check. `worker/scripts/license-report.mjs` lists only `fw-` keys, so `rev:` entries never appear in the report. Cost: one extra KV read per authenticated request. Locked by tests/unit/worker-kv-mirror.test.ts (tombstone wins over the mirror and over an active record) and worker-webhook-lifecycle.test.ts.
- Request bodies are buffered in memory only to validate the route contract; response bodies only to extract token counts. Neither is logged or persisted. Both body-bearing routes (chat 256 KB, tsa 4 KB) run the contentLengthFailure preflight before reading.
- Log lines carry status, latency, request id, token counts, and a short license fingerprint. Never message content, full keys, customer email, or the Authorization header. Minted keys are never logged (S-1); on email failure the operator recovers keys from KV by subscription id.
- Models probe (/v1/models) is auth-gated, uncapped, and served from a per-isolate TTL cache to bound upstream traffic.
- Lemon Squeezy webhooks are HMAC-verified (constant-time crypto.subtle.verify) before any KV mutation; test_mode events are acknowledged and dropped; subscription_created is idempotent via the active-keys index; the license email HTML escapes the customer-supplied name.
- Subscription lifecycle is ONE table pair in proxy.ts (`SUBSCRIPTION_EVENT_ACTION`, `SUBSCRIPTION_STATUS_ACTION`); the handlers only execute the action a row names, so a policy change is a one-row edit. ASSUMPTION, recorded until the owner answers audit question 2 (2026-08-23 objective audit): a cancelled subscription keeps access until its paid period ends, and every non-paying status cuts access at once. The rows as implemented:

  | Event | Action |
  |---|---|
  | subscription_created | mint (idempotent per subscription) |
  | subscription_updated, subscription_plan_changed | honour the carried status (table below), then sync quantity when live |
  | subscription_cancelled | keep active, `expires_at = ends_at`; revoke at once when `ends_at` is missing or unparseable |
  | subscription_resumed, subscription_unpaused | reactivate (status active, `expires_at` cleared) |
  | subscription_paused, subscription_expired | revoke at once |
  | subscription_payment_failed / _success / _recovered | acknowledged, no KV change (the resulting status arrives on subscription_updated) |
  | subscription_payment_refunded | FULL refund (`refunded: true` or status `refunded`): revoke the invoice's `subscription_id` keys at once, stamped with `refunded_at`; a partial refund is logged and leaves the keys alone (2026-09-02, the owner's refunded test purchase had kept its key active to period end) |
  | order_refunded | FULL refund: revoke every active key whose `customer_email` equals the order's `user_email` (the order names no subscription); partial refund logged, keys untouched. Both refund events must be ticked on the Lemon Squeezy webhook, which on 2026-09-02 listened to three events only |
  | anything else | acknowledged with 200, logged `unsupported event` |

  | Status carried by subscription_updated | Action |
  |---|---|
  | active, on_trial | reactivate, then quantity sync |
  | cancelled | keep active, `expires_at = ends_at` |
  | paused, past_due, unpaid, expired | revoke at once |
  | unknown | logged, state untouched, quantity synced |

  Ordering: deliveries are not ordered, so every lifecycle write stamps the record's `lifecycle_at` with the event's `updated_at`. A revocation always applies (fail closed). A reactivation or period-end cancel applies only when its stamp is strictly later than `lifecycle_at`; an undated event never reactivates. A revoked record with no `lifecycle_at` was revoked by the operator's scripts and the webhook never lifts it. A fresh reactivating event stamps even a key it leaves active, so a stale cancel that arrives afterwards cannot apply. Locked by tests/unit/worker-webhook-lifecycle.test.ts (every table row, cancelled-then-updated, expired-then-late-resumed).
- The chat model is pinned server-side; a client cannot select a pricier model. Streaming is rejected on chat.
- /v1/tsa validates the hash is exactly 32 bytes of hex before building the DER TimeStampReq; it meters attempts, not successes (deliberate, documented in-code). Anchor attempts are capped at TSA_DAILY_ANCHOR_CAP = 100 per licence per day on a dedicated `<counter>:tsa` Durable Object, separate from the AI counter, so anchor traffic can neither consume nor be starved by the AI caps (a legitimate install needs at most 5000/50 = 100 anchors a day; a hostile key is bounded to 100 FreeTSA calls).
- Quantity decrease revokes surplus keys: when `subscription_updated` carries a live status and a `quantity` below the number of active keys on the subscription, the handler revokes the surplus, last-issued first (tombstone then record), and mints new keys when the quantity grew.

## How it ACTUALLY works

index.ts default export routes every production request into proxy.ts fetchWorker with requireAtomicCounter=true. fetchWorker routes by pathname+method: OPTIONS returns CORS 204; /health returns static JSON unauthenticated. Capped routes run authenticate (bearer parse, KV license load, revocation check on the record status and the `rev:<key>` tombstone, expiry check, tier match) then reserveUsage against the LICENSE_COUNTER Durable Object (license-keyed; getByName). A missing DO binding with requireAtomicCounter=true returns 503 usage_coordinator_unavailable rather than silently falling back to the racy KV path. After the upstream call, reconcileUsage runs in ctx.waitUntil with the actual usage (or zeros on failure); reconcile failures are logged and swallowed, which is what the reservation TTL reaper exists to mop up. The webhook handler looks the event up in SUBSCRIPTION_EVENT_ACTION and runs applyLifecycleAction: mint (quantity keys under the sub:{id} index, email), honour_status (SUBSCRIPTION_STATUS_ACTION on the payload's status, then syncSubscriptionQuantity, which mints up to or revokes down to the new quantity only when at least one key is active), cancel_at_period_end, revoke, reactivate, or ignore. Unlisted events are acknowledged and logged.

## Known divergences (updated 2026-08-23)

- D-A1 [high, closed in code 2026-10-09 (9775d222), live since the relay deploy a38417d9 of 2026-10-10 and in every deploy after it] Keys are minted with 20 characters (100 bits; shorter keys still accepted), and authenticate counts unknown keys per address (IPv6 by /64) through the AUTH_FAILURE_LIMITER rate limit binding and an in-isolate map, answering 429 too_many_failed_keys before the KV read once an address passes 10 a minute; a key that worked in the isolate within the minute still passes (tests/private/worker/worker-failed-auth-friction.test.ts).
- RESOLVED 2026-08-10: requireAtomicCounter defaults TRUE; for paid tiers the legacy KV path is reachable only via env.ALLOW_LEGACY_COUNTER_FOR_TESTS, which production never sets (503 fail-closed test in worker-hardening-batch.test.ts). The dev tier is the one production user of the legacy path by design (see Key files). Duplicate lenient hexToBytes deleted; /health reports the DEPLOY_STAMP constant (bump on each deploy).
- RESOLVED 2026-08-10: webhook replay guard keys on the raw-body SHA-256 (`evt:` KV entries, 30-day TTL), written only AFTER a successful dispatch so LS retries of failed deliveries still process while replays of successful ones are acknowledged and dropped. KV eventual consistency narrows rather than closes the race.
- RESOLVED 2026-08-10: chat pins n=1 and clamps max_tokens to 4096 inside the forwarded body. (The sibling validateGeminiBody contract went with the /v1/gemini route in 2.5.0.)
- RESOLVED 2026-08-10: chat (256 KB) and TSA (4 KB) run the contentLengthFailure preflight before reading the body. Lock: tests/unit/worker-hardening-batch.test.ts.
- D-M4 [resolved 2026-08-11] KV usage counters were dead for paid traffic; the DO snapshot now mirrors back into KV on reconcile (drift-throttled). The client-side visibility half landed earlier.
- RESOLVED 2026-08-10: reservation leak (TTL reaper), README privacy claims (rewritten), stale key-logging comments corrected, unescaped customerName in the license email.
- RESOLVED 2026-08-23 (STORAGE-LICENCE-WORKER-6): the mirror-versus-revoke read-then-write race on `status` can no longer resurrect a revoked key; the tombstone is checked before the record may grant.
- RESOLVED earlier: the recordUsage read-modify-write race the old spec flagged as [med] is gone for paid production traffic; the atomic Durable Object path replaced it. It survives only on dev keys, which are uncapped, so nothing depends on it.
- [low, accepted] CORS echoes any Origin; the bearer key is the auth gate. (ALLOWED_ORIGINS is gone from wrangler.toml and Env.)
- [low, accepted] extractGeneralizedTime is a byte-scan heuristic; the raw TST bytes are the load-bearing evidence.


## Cross-references

- src/ai/client.ts - probeProxy hits /v1/models; chat goes to /v1/chat/completions; maps 429 body codes to cap-exhausted kinds and arms the proxy-cap latch; maps 503 usage_coordinator_unavailable to the distinct non-retried 'coordinator-unavailable' kind (no retry storm).
- src/storage/license.ts - tier caps mirror; in sync as of 2026-10-09 ($3.50/month uniform, 2000/day). The client monthly override may exceed the tier cap client-side; the worker ignores overrides and enforces $3.50 regardless (documented in storage-license.md).
- src/forensics/tsa-client.ts - chain anchoring via /v1/tsa.
- Lemon Squeezy, Resend.com, FreeTSA - external services as before.
- Cloudflare KV LICENSES + Durable Object LICENSE_COUNTER - license records in KV; usage truth in the DO.
