// Built-bundle service-worker gate (known-issues M40).
//
// The source test suite transforms TypeScript and never exercises Rollup's
// chunked output, which is exactly where M40 lived: a chunk shared between
// the dashboard entry and the service worker picked up Vite's DOM preload
// helper (`__vitePreload` touches `document`), so a correct-PIN chain reset
// crashed the document-free MV3 worker with "document is not defined".
//
// This script runs against dist/ after a full `npm run build` and enforces:
//   1. Every manifest-referenced script exists in dist/ (complete-dist law).
//   2. The service worker's transitive static module graph contains NO
//      dynamic import and NO `__vitePreload` token.
//   3. The built worker actually LOADS and answers RESET_FORENSIC_CHAIN in a
//      document-free Node realm (the exact shape of the live failure).
//
// Exit code 0 = all gates pass. Any failure prints the gate and exits 1.

import { createHash } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

function fail(gate, detail) {
  console.error(`[check-sw-bundle] FAIL ${gate}: ${detail}`);
  process.exit(1);
}

// ─── Gate 1: manifest-referenced scripts exist ──────────────────────────────

const manifestPath = join(dist, 'manifest.json');
if (!existsSync(manifestPath)) fail('manifest', 'dist/manifest.json missing (partial dist?)');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const referenced = [];
if (manifest.background?.service_worker) referenced.push(manifest.background.service_worker);
for (const cs of manifest.content_scripts ?? []) referenced.push(...(cs.js ?? []));
for (const res of manifest.web_accessible_resources ?? []) {
  for (const r of res.resources ?? []) if (r.endsWith('.js')) referenced.push(r);
}
for (const rel of referenced) {
  if (!existsSync(join(dist, rel))) fail('manifest', `manifest references ${rel} but it is not in dist/`);
}
// Localised name and description (since 2.5.2): every __MSG_ key in the
// built manifest must resolve in the built default-locale file, or the store
// would show the placeholder.
if (manifest.default_locale) {
  const messagesPath = join(dist, '_locales', manifest.default_locale, 'messages.json');
  if (!existsSync(messagesPath)) fail('manifest', `default_locale ${manifest.default_locale} but ${messagesPath} is not in dist/`);
  const messages = JSON.parse(readFileSync(messagesPath, 'utf8'));
  for (const key of JSON.stringify(manifest).matchAll(/__MSG_([A-Za-z0-9_@]+)__/g)) {
    if (!messages[key[1]]?.message) fail('manifest', `manifest uses __MSG_${key[1]}__ but ${manifest.default_locale}/messages.json has no message for it`);
  }
}
console.log(`[check-sw-bundle] gate 1 ok — ${referenced.length} manifest-referenced scripts present`);

// ─── Gate 2: SW static import graph is preload-free and dynamic-import-free ─

const swEntry = manifest.background?.service_worker;
if (!swEntry) fail('graph', 'manifest has no background.service_worker');

const seen = new Set();
const queue = [join(dist, swEntry)];
// Matches static import/re-export specifiers in Rollup ESM output.
const staticImportRe = /(?:import|export)\s*(?:[\w$*\s{},]*from\s*)?["']([^"']+)["']/g;
// Dynamic import keyword — cannot be minify-renamed; guard against member
// access (`.import(`) and identifiers ending in "import".
const dynamicImportRe = /(?<![\w$.])import\s*\(/;

while (queue.length) {
  const file = queue.pop();
  if (seen.has(file)) continue;
  seen.add(file);
  if (!existsSync(file)) fail('graph', `imported module missing on disk: ${file}`);
  const code = readFileSync(file, 'utf8');

  if (code.includes('__vitePreload')) {
    fail('graph', `__vitePreload found in SW-reachable module ${file} — Vite's DOM preload helper crashes the document-free worker (M40)`);
  }
  if (dynamicImportRe.test(code)) {
    fail('graph', `dynamic import found in SW-reachable module ${file} — dynamic imports pull the DOM preload helper into the worker (M40)`);
  }

  for (const m of code.matchAll(staticImportRe)) {
    const spec = m[1];
    if (spec.startsWith('./') || spec.startsWith('../')) {
      queue.push(resolve(dirname(file), spec));
    }
  }
}
console.log(`[check-sw-bundle] gate 2 ok — ${seen.size} SW-graph modules, no dynamic imports, no __vitePreload`);

// ─── Gate 3: document-free invocation of the built reset path ───────────────

// Node has webcrypto + structuredClone; fake-indexeddb supplies IDB. There is
// deliberately NO `document` in this realm — that absence IS the test.
await import('fake-indexeddb/auto');

const messageListeners = [];
const noopEvent = () => ({ addListener: () => {}, removeListener: () => {}, hasListener: () => false });
const storageArea = () => {
  const data = new Map();
  return {
    get: async (keys) => {
      if (keys == null) return Object.fromEntries(data);
      const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const out = typeof keys === 'object' && !Array.isArray(keys) ? { ...keys } : {};
      for (const k of names) if (data.has(k)) out[k] = data.get(k);
      return out;
    },
    set: async (obj) => { for (const [k, v] of Object.entries(obj)) data.set(k, v); },
    remove: async (keys) => { for (const k of (Array.isArray(keys) ? keys : [keys])) data.delete(k); },
    clear: async () => data.clear(),
  };
};

globalThis.self = globalThis;
globalThis.chrome = {
  runtime: {
    id: 'check-sw-bundle',
    getManifest: () => manifest,
    getURL: (p) => `chrome-extension://check-sw-bundle/${p}`,
    onMessage: {
      addListener: (fn) => messageListeners.push(fn),
      removeListener: () => {},
      hasListener: () => false,
    },
    onInstalled: noopEvent(),
    onStartup: noopEvent(),
    onConnect: noopEvent(),
    sendMessage: async () => ({}),
    lastError: undefined,
  },
  storage: {
    local: storageArea(),
    session: storageArea(),
    sync: storageArea(),
    onChanged: noopEvent(),
  },
  alarms: {
    create: () => {},
    clear: async () => true,
    get: async () => undefined,
    getAll: async () => [],
    onAlarm: noopEvent(),
  },
  tabs: {
    query: async () => [],
    sendMessage: async () => ({}),
    onRemoved: noopEvent(),
    onUpdated: noopEvent(),
  },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  scripting: { executeScript: async () => [] },
  permissions: { contains: async () => false },
};

try {
  await import(pathToFileURL(join(dist, swEntry)).href);
} catch (err) {
  fail('invoke', `built service worker failed to LOAD in a document-free realm: ${err?.stack ?? err}`);
}
if (messageListeners.length === 0) fail('invoke', 'worker registered no onMessage listener');

// F2: RESET_FORENSIC_CHAIN is parent-PIN-gated at the SW boundary. Seed the
// stored credential (sha256 hex of the PIN — same format storage/settings.ts
// setPin writes) and pass the matching preimage in the payload so this gate
// exercises the authenticated happy path of the built reset code.
const SMOKE_PIN = '1234';
await globalThis.chrome.storage.local.set({
  parentPin: createHash('sha256').update(SMOKE_PIN).digest('hex'),
});

const response = await new Promise((resolvePromise, rejectPromise) => {
  const timer = setTimeout(() => rejectPromise(new Error('RESET_FORENSIC_CHAIN timed out after 30s')), 30_000);
  let handled = false;
  for (const listener of messageListeners) {
    try {
      const keepOpen = listener(
        { type: 'RESET_FORENSIC_CHAIN', payload: { reason: 'check-sw-bundle smoke', pin: SMOKE_PIN } },
        { id: 'check-sw-bundle' },
        (resp) => { clearTimeout(timer); resolvePromise(resp); },
      );
      if (keepOpen === true) handled = true;
    } catch (err) {
      clearTimeout(timer);
      rejectPromise(err);
      return;
    }
  }
  if (!handled) {
    clearTimeout(timer);
    rejectPromise(new Error('no listener claimed RESET_FORENSIC_CHAIN'));
  }
}).catch((err) => fail('invoke', `reset invocation rejected: ${err?.stack ?? err}`));

// Every flag must be a clean success: a partial reset (marker written but an
// auxiliary wipe failed) must not pass this gate as if it were complete
// (known-issues M58).
const REQUIRED_TRUE_FLAGS = [
  'resetMarkerWritten',
  'signingIdentityRetained',
  'scanLogCleared',
  'authorProfilesCleared',
  'verdictsCleared',
  'diagnosticsCleared',
  'usageStatsCleared',
  'parentFeedbackCleared',
  'chainAnchorsCleared',
];
const falseFlags = REQUIRED_TRUE_FLAGS.filter((f) => response?.result?.[f] !== true);
if (!response?.ok || falseFlags.length > 0) {
  fail('invoke', `reset responded but not with a clean full success (false flags: ${falseFlags.join(', ') || 'none'}): ${JSON.stringify(response)}`);
}
console.log('[check-sw-bundle] gate 3 ok — built worker loaded and completed RESET_FORENSIC_CHAIN with no document, all result flags true');

// Gate 4 — dev-reload build id and secret. The vite define bakes exactly one
// `fwbid-…` and one `fwsec-…` literal into the service worker; mirror them into
// dist/build-id.json so the dev-reload token server serves the id and secret of the
// build that is actually on disk (src/background/dev-reload.ts).
{
  const swSource = readFileSync(join(dist, 'service-worker.js'), 'utf8');
  const ids = [...new Set(swSource.match(/fwbid-[a-z0-9]+-[a-z0-9]+/g) ?? [])];
  const secrets = [...new Set(swSource.match(/fwsec-[a-z0-9]+/g) ?? [])];
  if (ids.length !== 1) {
    fail('build-id', `expected exactly one baked fwbid- literal in service-worker.js, found ${ids.length}`);
  }
  // FW_DEV_RELOAD=0 is what the two packaging paths set (see BAKE_DEV_SECRET in
  // vite.config.ts): the build that becomes a store zip bakes no dev-reload
  // secret at all. The gate then flips over and proves the ABSENCE, because a
  // gate that only ever checks the developer's case is how a packaging build
  // came to ship a machine token nobody meant to ship, up to and including
  // 2.5.11 (found 2026-09-19 by unpacking the zip).
  const wantSecret = process.env.FW_DEV_RELOAD !== '0';
  if (wantSecret && secrets.length !== 1) {
    fail('build-secret', `expected exactly one baked fwsec- literal in service-worker.js, found ${secrets.length}`);
  }
  if (!wantSecret && secrets.length !== 0) {
    fail('build-secret', `FW_DEV_RELOAD=0, so no dev-reload secret may be baked, but service-worker.js carries ${secrets.length}`);
  }
  // A store build also carries none of the developer's other aids: the local dev-reload probe address and path
  // (DEVELOPER_AIDS below). A development build keeps them. A developer licence key pattern is not listed: the server accepts
  // such a key when its record is seeded, and the owner's own install may hold one.
  if (!wantSecret) {
    const DEVELOPER_AIDS = [
      { what: 'the local dev-reload probe address', needle: '127.0.0.1:8790' },
      { what: 'the dev-reload probe path', needle: 'fw-build-id' },
    ];
    const aids = DEVELOPER_AIDS.filter((a) => swSource.includes(a.needle)).map((a) => `${a.what} ("${a.needle}")`);
    if (aids.length > 0) {
      fail('developer-aid', `FW_DEV_RELOAD=0, so this is a store build, but service-worker.js carries ${aids.join(', ')}`);
    }
  }
  writeFileSync(join(dist, 'build-id.json'), JSON.stringify({ buildId: ids[0], secret: secrets[0] ?? '' }) + '\n');
  console.log(`[check-sw-bundle] gate 4 ok — build id ${ids[0]}${wantSecret ? ' and secret' : ', no dev secret baked'}, mirrored to dist/build-id.json`);
}
process.exit(0);
