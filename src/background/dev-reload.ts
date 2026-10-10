// FeelingWise — dev-only extension self-reload (product mandate, 2026-07-14:
// verification must not depend on a human clicking the reload button).
//
// HOW IT WORKS. The build bakes a unique id into this bundle
// (__FW_BUILD_ID__, vite define; scripts/check-sw-bundle.mjs mirrors the
// SAME baked id into dist/build-id.json). A local token server
// (scripts/dev/dev-reload-server.mjs) serves dist/build-id.json fresh
// from disk. This module polls that server on a chrome.alarms tick; when the
// id on disk differs from the id baked into the RUNNING bundle, a new build
// has landed and chrome.runtime.reload() picks it up — exactly what the
// chrome://extensions reload button does for an unpacked install.
//
// WHY THIS CAN NEVER FIRE IN PRODUCTION (two independent gates):
//   1. chrome.management.getSelf().installType must be 'development' — a
//      Chrome Web Store install reports 'normal' and returns before any
//      network activity. getSelf needs no "management" permission.
//   2. The token server must be running on the developer's own machine
//      (127.0.0.1). No server, no signal: the fetch fails silently.
// A reload also only happens on a real id MISMATCH, so a reloaded worker
// (whose baked id now equals the disk id) never loops.
//
// PROTECTION NOTE. Reloading the extension orphans content scripts in
// already-open tabs until those tabs reload — the same effect as the manual
// reload button. That is why this stays a DEVELOPMENT-install capability:
// the dev machine is a test surface, not a protected child's machine.

// Baked by vite define in every bundle; absent under vitest/node.
declare const __FW_BUILD_SECRET__: string;
// Baked by vite define in the main build: false in a store build (FW_DEV_RELOAD=0), true otherwise; absent under vitest/node,
// where it reads as on. In a store build the probe address and the poll below fold away: the store worker carries none of it.
declare const __FW_DEV_RELOAD__: boolean | undefined;

import { getBuildId } from '../core/build-id';

const DEV_RELOAD_ALARM = 'fw-dev-reload-check';
const DEV_RELOAD_ON = typeof __FW_DEV_RELOAD__ === 'undefined' || __FW_DEV_RELOAD__;
const DEV_RELOAD_TOKEN_URL = DEV_RELOAD_ON ? 'http://127.0.0.1:8790/fw-build-id' : '';

/**
 * This bundle's build id. One definition for the whole extension lives in
 * src/core/build-id.ts — the service worker, the content script and the record
 * must agree on what "which build" means, so they read the same function.
 */
export function getBakedBuildId(): string {
  return getBuildId();
}

function getBakedSecret(): string {
  return typeof __FW_BUILD_SECRET__ !== 'undefined' ? __FW_BUILD_SECRET__ : '';
}

/** Extract the build id from the token server's JSON body. Returns '' for
 *  any shape that is not { buildId: non-empty-string }. */
export function parseServerBuildId(body: unknown): string {
  if (typeof body !== 'object' || body === null) return '';
  const id = (body as { buildId?: unknown }).buildId;
  return typeof id === 'string' ? id.trim() : '';
}

/** Extract the secret from the token server's JSON body. Returns '' for
 *  any shape that is not { secret: non-empty-string }. */
export function parseServerSecret(body: unknown): string {
  if (typeof body !== 'object' || body === null) return '';
  const secret = (body as { secret?: unknown }).secret;
  return typeof secret === 'string' ? secret.trim() : '';
}

/** The reload decision, pure and test-locked: only a real mismatch between
 *  two KNOWN ids WITH a matching secret justifies a reload. Any missing side
 *  means "do nothing" — a failed read must never restart the extension. */
export function shouldReloadForBuildId(bakedId: string, serverId: string, bakedSecret: string, serverSecret: string): boolean {
  if (!bakedId || !serverId || !bakedSecret || !serverSecret) return false;
  // Verify the secret matches before considering an id mismatch
  if (bakedSecret !== serverSecret) return false;
  return bakedId !== serverId;
}

async function checkOnce(): Promise<void> {
  let serverId = '';
  let serverSecret = '';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(DEV_RELOAD_TOKEN_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return;
    const body = await res.json();
    serverId = parseServerBuildId(body);
    serverSecret = parseServerSecret(body);
  } catch {
    return; // server not running — the normal quiet state
  }
  if (shouldReloadForBuildId(getBakedBuildId(), serverId, getBakedSecret(), serverSecret)) {
    console.log(`[FeelingWise] dev-reload: new build on disk (${serverId}) — reloading extension`);
    chrome.runtime.reload();
  }
}

/**
 * Whether this install is the unpacked development one. Resolved
 * asynchronously; until it is, the alarm handler below does nothing.
 */
let isDevInstall = false;

/**
 * The dev-reload alarm, handled from the service worker's one onAlarm listener
 * (2026-09-19).
 *
 * It used to register a listener of its own, and that registration sat inside
 * the callback to chrome.management.getSelf, so it happened after an async
 * round trip. Under MV3 a listener added after an await is not reliably present
 * when the worker's realm is torn down and rebuilt, so the alarm could arrive
 * at a worker that had not re-registered for it.
 *
 * Registering it synchronously here was the first fix and it was the wrong one:
 * service-worker.ts has exactly one onAlarm listener on purpose, and a test
 * asserts the count. So this is a case in that dispatcher instead, which is
 * registered at module level and answers both problems at once.
 *
 * Inert until getSelf confirms a development install, which is why the flag is
 * checked here rather than around the registration: an answer that arrives late
 * belongs in the handler, not in the wiring.
 */
export function handleDevReloadAlarm(alarmName: string): void {
  if (!DEV_RELOAD_ON) return;
  if (alarmName !== DEV_RELOAD_ALARM) return;
  if (!isDevInstall) return;
  void checkOnce();
}

/**
 * Idempotent init from the service worker. Inert unless this is an unpacked
 * development install.
 *
 * The listener is registered here, synchronously, and not inside the
 * management.getSelf callback where it used to live (2026-09-19). Under MV3 a
 * listener added after an await is not reliably present when the worker's realm
 * is torn down and rebuilt, so the alarm that fires the reload could arrive at a
 * worker that had not re-registered for it. The development check moved into
 * the handler instead, which is where an answer that arrives late belongs.
 *
 * Only an unpacked install is affected either way, so nothing a person has ever
 * installed from the store can reach this. It is here because it is the exact
 * MV3 shape that bites silently, and every other listener in src/background is
 * registered at module level.
 */
export function initDevReload(): void {
  if (!DEV_RELOAD_ON) return;
  if (typeof chrome === 'undefined' || !chrome.management?.getSelf) return;
  chrome.management.getSelf((self) => {
    if (chrome.runtime.lastError) return;
    if (self.installType !== 'development') return;
    isDevInstall = true;
    void checkOnce();
    void chrome.alarms.create(DEV_RELOAD_ALARM, { periodInMinutes: 0.5 });
  });
}
