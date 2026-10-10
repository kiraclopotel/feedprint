// Off built-bundle gate. Runs after `npm run build:off` against dist-off/.
//
// Off's promise is smallness and absence: no record, no AI, no service
// worker, no network beyond the pages it runs on. These gates make the
// built package prove that, because a wrong import in a shared module would
// otherwise silently pull the recorder into the filter.
//
//   1. Every manifest-referenced script exists in dist-off/.
//   2. The manifest declares no background worker, no api.feelingwise.org
//      host, and only the `storage` permission.
//   3. NO shipped script references the proxy host, the Groq or Gemini model
//      ids, or the record store's IndexedDB name.
//   4. Both bundles are under their own size cap (the recorder's content
//      script is ~570 KB; Off must stay a fraction of that or the split has
//      failed).
//
// Gates 3 and 4 read content.js alone until 2026-09-19 while this list said the
// package, so the popup, the larger of the two bundles, was never opened (M277).

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist-off');

function fail(gate, detail) {
  console.error(`[check-off-bundle] FAIL ${gate}: ${detail}`);
  process.exit(1);
}

const manifestPath = join(dist, 'manifest.json');
if (!existsSync(manifestPath)) fail('manifest', 'dist-off/manifest.json missing');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const referenced = [];
for (const cs of manifest.content_scripts ?? []) referenced.push(...(cs.js ?? []));
for (const rel of referenced) {
  if (!existsSync(join(dist, rel))) fail('manifest', `manifest references ${rel} but it is not in dist-off/`);
}
if (!existsSync(join(dist, manifest.action?.default_popup ?? 'popup.html'))) fail('manifest', 'popup html missing');
// Localised name and description (since 1.0.2): every __MSG_ key in the
// built manifest must resolve in the built default-locale file.
if (manifest.default_locale) {
  const messagesPath = join(dist, '_locales', manifest.default_locale, 'messages.json');
  if (!existsSync(messagesPath)) fail('manifest', `default_locale ${manifest.default_locale} but ${messagesPath} is not in dist-off/`);
  const messages = JSON.parse(readFileSync(messagesPath, 'utf8'));
  for (const key of JSON.stringify(manifest).matchAll(/__MSG_([A-Za-z0-9_@]+)__/g)) {
    if (!messages[key[1]]?.message) fail('manifest', `manifest uses __MSG_${key[1]}__ but ${manifest.default_locale}/messages.json has no message for it`);
  }
}
console.log(`[check-off-bundle] gate 1 ok — ${referenced.length} content scripts present`);

if (manifest.background) fail('absence', 'Off must not declare a background worker');
if ((manifest.host_permissions ?? []).some((h) => h.includes('api.feelingwise.org'))) {
  fail('absence', 'Off must not hold the proxy host permission');
}
const perms = manifest.permissions ?? [];
if (perms.length !== 1 || perms[0] !== 'storage') fail('absence', `Off permissions must be exactly ["storage"], got ${JSON.stringify(perms)}`);
console.log('[check-off-bundle] gate 2 ok — no worker, no proxy host, storage only');

// Every script the package ships, not only content.js (M277, 2026-09-19). Until then gates 3 and 4
// read content.js alone, and the docblock above promised the package. The popup bundle is the
// LARGER of the two, 310 KiB against content.js's 167 KiB, and it was the one nobody opened.
function shippedScripts(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...shippedScripts(abs));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(abs);
  }
  return out;
}

const scripts = shippedScripts(dist);
if (scripts.length < 2) fail('absence', `expected at least the content script and the popup bundle, found ${scripts.length}`);

// The proxy host and its three AI routes only exist in ai/client and the
// media clients; the record store's IndexedDB name only in forensics/store.
// (Model ids alone are not a signal: settings.ts carries a cost table that
// names them and Off legitimately imports settings.)
const forbidden = ['api.feelingwise.org', '/v1/chat/completions', '/v1/gemini', '/v1/whisper', 'feelingwise-forensics'];
for (const abs of scripts) {
  const code = readFileSync(abs, 'utf8');
  const rel = relative(dist, abs).split(sep).join('/');
  for (const token of forbidden) {
    if (code.includes(token)) fail('absence', `${rel} contains "${token}"`);
  }
}
console.log(`[check-off-bundle] gate 3 ok — no proxy host, model id or record store in any of the ${scripts.length} shipped scripts`);

// Two caps, because the two files answer different questions. content.js runs on every page a
// person reads and its size is the cost of the product being there at all. The popup is opened by
// hand, so its cap is about what came with it: Off's promise is absence, and a bundle that grows
// is the first sign a shared import pulled something in.
const CONTENT_CAP_BYTES = 300 * 1024;
const size = statSync(join(dist, 'content.js')).size;
if (size > CONTENT_CAP_BYTES) fail('size', `content.js is ${size} bytes, cap ${CONTENT_CAP_BYTES}`);

const POPUP_CAP_BYTES = 360 * 1024;
let popupTotal = 0;
for (const abs of scripts) {
  if (abs.endsWith(`${sep}content.js`)) continue;
  popupTotal += statSync(abs).size;
}
if (popupTotal > POPUP_CAP_BYTES) {
  fail('size', `the popup bundle is ${popupTotal} bytes, cap ${POPUP_CAP_BYTES}. Something was imported into the free filter; find it before raising this.`);
}
console.log(`[check-off-bundle] gate 4 ok — content.js ${(size / 1024).toFixed(1)} KB, popup ${(popupTotal / 1024).toFixed(1)} KB`);
