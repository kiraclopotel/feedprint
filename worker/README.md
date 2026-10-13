# FeelingWise Proxy Worker

Cloudflare Worker at `api.feelingwise.org`. The FeelingWise extension sends its
AI calls here; the Worker checks the license, enforces spending caps, and
forwards the call to the AI provider using keys held server-side. Customers pay
one FeelingWise subscription and never see or manage a provider key.

**Status:** live. License auth, atomic per-license cap metering (Durable
Object), Lemon Squeezy webhook licensing, and transactional email are all in
production. `GET /health` reports a `DEPLOY_STAMP` (short commit plus UTC date)
written by `worker/scripts/deploy.mjs`; a deploy run by hand with a bare
`wrangler deploy` leaves that field reading "unstamped", which is how you tell
the two kinds of deploy apart.

## What the Worker does with content, stated plainly

- Request bodies are read into memory to validate the route contract (JSON
  shape, model pinning, size limits) and response bodies are read into memory
  to extract token counts for cap metering. Both are held only for the life of
  the request. Neither is written to KV, Durable Object storage, logs, or any
  other store. One route is the exception by design: an accepted `POST /v1/dom-report` body (the
  structure of a page: every field is a listed word or has a fixed shape) is kept in KV for 60 days, as its row
  below says.
- `wrangler tail` log lines carry status, latency, request id, token counts,
  and a license fingerprint (a short hash of the key, for support correlation). They
  never carry message content, model output, customer email, full license
  keys, or the Authorization header. Minted license keys are never logged
  either; if the license email fails to send, the operator recovers the keys
  from KV by subscription id, not from logs.
- The provider key (`GROQ_API_KEY`) is a Worker secret, encrypted at rest,
  never committed to source.
- CORS reflects the request origin. The protection against misuse is the
  bearer license key, not an origin allowlist. A page that has a valid key can
  call the API; a page without one gets 401.
- The Worker source is in this repository so these claims can be checked
  against the code rather than taken on trust.

## Routes

| Route | Auth | Notes |
|---|---|---|
| `GET /health` | none | Uptime probe |
| `GET /v1/models` | license key | Key-validity probe used by the popup license pill; upstream result is cached per isolate |
| `GET /v1/entitlements` | license key | What the key turns on, signed: `{payload, sig}`, where `payload` is the JSON text `{v, key_fp, features, issued_at, valid_until}` (good for 7 days) and `sig` its Ed25519 signature, base64url. A record without `features` is a reading key (`["reading"]`); the dev tier holds `["*"]`. Answers 503 `entitlements_unsigned` when `ENTITLEMENTS_SIGNING_KEY` is unset or unreadable. Not metered |
| `POST /v1/chat/completions` | license key | Text analysis. Model pinned server-side, streaming rejected, calls and tokens metered against the license caps |
| `GET /v1/repairs` | none | The signed repair file the extension's finders read (`cfg:repairs` in the licence namespace), as text, or 204 when none is published. The relay serves the one file the maintainer published and does not itself check the signature: the publish script checks it, and the extension checks it again against the public keys it carries, so the route proves nothing and reads nothing from the caller (no key, cookie or body). Cached for 15 minutes. Publish with `node worker/scripts/publish-repairs.mjs <envelope.json> [--apply]`: it verifies the signature and the version first and writes one KV key; running it with `--apply` is an outward act |
| `POST /v1/dom-report` | none | A "this broke" report from the extension: the structure of a page (tags, roles, attribute names, the shape of labels and addresses; never a word, a name, an id or an address), sent on a press and with the person's consent. The body is read from the stream up to a byte cap (413 `too_large` past it, whether or not a length was declared), and accepted only if every field is a listed word or has a fixed shape under `src/dom-report/` (a byte-identical copy of `src/core/dom-report/`; a test fails when they differ): labels and addresses are limited to listed words, other names (a custom tag, a `data-` name, a family id, a ledger key, the build) to a fixed shape, so a forged body can carry a chosen lowercase string in those slots; it is refused whole otherwise: 400 `not_a_report`, 413 `too_large`, 429 `slow_down` (three a minute per sender; the sender's address is hashed without a salt and counted for one minute in this isolate's memory and in the `REPORT_LIMITER` binding when present, and is written to none of our stores), 503 `unavailable` when the store fails, 204 when kept. Kept as the checked text under `domrep:<day>:<site>:<product>:<hash>` in the licence namespace for 60 days, so an identical report on the same day is one record; no address, header, cookie, key or user agent is written to any store we read. Read with `node worker/scripts/read-dom-reports.mjs [--day D] [--out folder]` (an outward read of production, run by the seat that holds the marker) |
| `POST /v1/tsa` | license key | RFC 3161 timestamp relay to FreeTSA for chain anchoring. Attempt-metered with its own daily allowance |
| `POST /lemonsqueezy-webhook` | HMAC signature | Mints, updates, and revokes license keys on subscription events; sends the license email |
| `GET /admin/licenses` | `ADMIN_TOKEN` bearer | Operator-only. Lists every licence with its KV record and the Durable Object's true counters (`inspect()`, read-only), including a never-resetting `last_seen_at` and lifetime `total_calls`/`total_tokens`. Active keys by default; `?include_revoked=1` for all, `?key=fw-…` for one. Answers 503 when the secret is unset, 401 otherwise; no CORS. Report it with `node worker/scripts/license-usage.mjs` (token from `FW_ADMIN_TOKEN` or gitignored `worker/.admin-token`). Rotate with `wrangler secret put ADMIN_TOKEN` |

The webhook drops a delivery whose body is identical, byte for byte, to one it
processed successfully in the last 30 days, and answers `OK (duplicate
delivery)` without touching any key. Lemon Squeezy's webhook pages do not say
whether the dashboard's resend button sends the same body, so whether a resend
inside those 30 days is dropped this way is not confirmed. A resent
`subscription_created` that does run mints nothing while the subscription
still has an active key, and only sends again a welcome email still owed; if
every key was revoked, it mints a fresh batch of active keys and emails them.

Operator actions stay off the API. `node worker/scripts/license-admin.mjs revoke|expire|show <key>` writes KV through wrangler (tombstone + status for revoke, `expires_at` for expire), logging to gitignored `worker/license-admin.log`. Windows task `FW-Weekly-License-Usage` (Mondays 09:00) writes `license-usage.mjs --all --snapshot` into gitignored `worker/usage-reports/<date>.txt`.

## Cap enforcement

Every paid route reserves usage in a per-license Durable Object before the
upstream call and reconciles the actual usage after it. Daily call caps and the
unified monthly dollar cap (counted in token-equivalents, cost-weighted by
direction) live in `src/proxy.ts` and must stay in lockstep with the client
mirror in `src/storage/license.ts`. Reservations expire after ten minutes if a
reconcile never arrives, so a failed request cannot pin a license at its cap.
The legacy KV counters are not updated by the atomic path; usage truth for paid
licenses lives in the Durable Object.

## Local development

```bash
cd worker
npm install
wrangler dev
```

Secrets for local dev go in `.dev.vars` (gitignored):

```
GROQ_API_KEY=gsk_...
LEMONSQUEEZY_WEBHOOK_SECRET=...
RESEND_API_KEY=...
```

## Deploy

From the `worker/` folder, where `wrangler.toml` is:

```bash
wrangler login
wrangler secret put GROQ_API_KEY
wrangler secret put LEMONSQUEEZY_WEBHOOK_SECRET
wrangler secret put RESEND_API_KEY
wrangler secret put ENTITLEMENTS_SIGNING_KEY   # an Ed25519 private key as a JWK; the extension carries its public half
npm run deploy
```

Use `npm run deploy` here, or `npm run worker:deploy` from the repository
root, not `wrangler deploy` directly: both run `worker/scripts/deploy.mjs`,
which wraps `wrangler deploy`, stamps the release into `/health` and appends a
row to `worker/DEPLOYS.tsv`.

Smoke test after deploy:

```bash
curl https://api.feelingwise.org/health
```
