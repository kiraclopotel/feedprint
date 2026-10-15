// The Firefox copy of a finished Chrome build. Runs after `npm run build` (or build:off) and writes dist-firefox/ (or
// dist-off-firefox/) beside it; the Chrome folder is only read.
//
//   node scripts/firefox-package.mjs --product receipts|off [--zip]
//
// --zip also writes release/<product>-firefox-<version>.local.zip from the copy, beside the Chrome zips and never named
// like them.
//
// Firefox runs the same code as Chrome. What differs is the manifest and the names:
//   - Release Firefox has no service-worker background (MDN, manifest.json background, read 9 Oct 2026); it runs the
//     same file as a background script.
//   - downloads.ui is a Chrome permission Firefox does not know; the code that uses it already checks it is there.
//   - Firefox wants its own id, a lowest version, and a statement of what data leaves the device
//     (browser_specific_settings.gecko), and addons.mozilla.org refuses a name over 50 characters in any language.
// Those come from scripts/firefox/overlay.json. Every other file is copied byte for byte, and the copy is refused if the
// manifest changed anywhere else, so Firefox can never quietly ship different behaviour from Chrome.

import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageExtension } from './package.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The longest name addons.mozilla.org accepts, in every language of the listing. */
export const AMO_NAME_LIMIT = 50;

/** The only Chrome permission the Firefox copy drops. */
const CHROME_ONLY_PERMISSIONS = ['downloads.ui'];

export function readOverlay(product, root = ROOT) {
  const all = JSON.parse(readFileSync(join(root, 'scripts', 'firefox', 'overlay.json'), 'utf8'));
  if (!all[product]) throw new Error(`--product must be ${Object.keys(all).join(' or ')}, got "${product}"`);
  return all[product];
}

/** The Firefox manifest made from the built Chrome manifest. Pure; throws on anything it does not expect. */
export function firefoxManifest(chrome, overlay) {
  const out = structuredClone(chrome);
  if (chrome.manifest_version !== 3) throw new Error(`expected manifest_version 3, got ${chrome.manifest_version}`);
  if (chrome.browser_specific_settings) throw new Error('the Chrome manifest already carries browser_specific_settings');
  if (chrome.background) {
    const { service_worker: worker, type, ...rest } = chrome.background;
    if (!worker || Object.keys(rest).length > 0) throw new Error(`unexpected background ${JSON.stringify(chrome.background)}`);
    out.background = { scripts: [worker], ...(type ? { type } : {}) };
  }
  if (Array.isArray(chrome.permissions)) {
    out.permissions = chrome.permissions.filter((p) => !CHROME_ONLY_PERMISSIONS.includes(p));
  }
  // Chrome's floor (137, Ed25519 for the signed repairs, src/core/repairs/signed.ts); Firefox has its own, strict_min_version.
  delete out.minimum_chrome_version;
  out.browser_specific_settings = { gecko: structuredClone(overlay.gecko) };
  return out;
}

/** The keys a Firefox manifest may differ from Chrome's in; everything else must be equal. */
const CHANGED_KEYS = new Set(['background', 'permissions', 'browser_specific_settings', 'minimum_chrome_version']);

export function manifestDrift(chrome, firefox) {
  const keys = new Set([...Object.keys(chrome), ...Object.keys(firefox)]);
  return [...keys].filter((k) => !CHANGED_KEYS.has(k) && JSON.stringify(chrome[k]) !== JSON.stringify(firefox[k]));
}

/**
 * Each language's messages with the product name made to fit: the overlay's Firefox name where it has one, else the
 * Chrome name. Throws when any name is over the limit, so an upload is never refused for it.
 */
export function firefoxMessages(messagesByLocale, overlay) {
  const out = {};
  for (const [locale, messages] of Object.entries(messagesByLocale)) {
    const name = overlay.names?.[locale] ?? messages[overlay.nameKey]?.message;
    if (!name) throw new Error(`${locale}: no ${overlay.nameKey}`);
    if ([...name].length > AMO_NAME_LIMIT) throw new Error(`${locale}: "${name}" is ${[...name].length} characters; addons.mozilla.org takes ${AMO_NAME_LIMIT}`);
    out[locale] = { ...messages, [overlay.nameKey]: { ...messages[overlay.nameKey], message: name } };
  }
  return out;
}

function filesUnder(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...filesUnder(abs, base));
    else out.push(relative(base, abs).split(sep).join('/'));
  }
  return out.sort();
}

const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** Copies the Chrome build, writes the Firefox manifest and names, and checks every other file is the same bytes. */
export function makeFirefoxCopy(product, root = ROOT) {
  const overlay = readOverlay(product, root);
  const from = join(root, overlay.chromeDist);
  const to = join(root, overlay.firefoxDist);
  if (!existsSync(join(from, 'manifest.json'))) throw new Error(`${overlay.chromeDist}/manifest.json is missing: build the Chrome copy first`);
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });

  const chrome = JSON.parse(readFileSync(join(from, 'manifest.json'), 'utf8'));
  const firefox = firefoxManifest(chrome, overlay);
  const drift = manifestDrift(chrome, firefox);
  if (drift.length) throw new Error(`the Firefox manifest differs from Chrome's in ${drift.join(', ')}`);
  writeFileSync(join(to, 'manifest.json'), JSON.stringify(firefox, null, 2));

  const localesDir = join(from, '_locales');
  const byLocale = Object.fromEntries(readdirSync(localesDir).map((l) => [l, JSON.parse(readFileSync(join(localesDir, l, 'messages.json'), 'utf8'))]));
  for (const [locale, messages] of Object.entries(firefoxMessages(byLocale, overlay))) {
    writeFileSync(join(to, '_locales', locale, 'messages.json'), JSON.stringify(messages, null, 2));
  }

  const rewritten = new Set(['manifest.json', ...Object.keys(byLocale).map((l) => `_locales/${l}/messages.json`)]);
  const chromeFiles = filesUnder(from);
  const firefoxFiles = filesUnder(to);
  if (chromeFiles.join('\n') !== firefoxFiles.join('\n')) throw new Error('the Firefox copy holds other files than the Chrome build');
  const changed = chromeFiles.filter((f) => !rewritten.has(f) && sha(join(from, f)) !== sha(join(to, f)));
  if (changed.length) throw new Error(`files changed in the copy: ${changed.join(', ')}`);
  return { to: overlay.firefoxDist, files: firefoxFiles.length, rewritten: rewritten.size, version: firefox.version };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--product');
  const product = at >= 0 ? process.argv[at + 1] : undefined;
  try {
    const r = makeFirefoxCopy(product);
    console.log(`[firefox-package] ${r.to}: ${r.files} files, ${r.rewritten} rewritten (manifest and names), the rest the Chrome build's bytes`);
    if (process.argv.includes('--zip')) {
      const zip = packageExtension({ distDir: join(ROOT, r.to), outFile: join(ROOT, 'release', `${product}-firefox-${r.version}.local.zip`) });
      console.log(`[firefox-package] ${relative(ROOT, zip.outFile)}`);
    }
  } catch (e) {
    console.error(`[firefox-package] FAIL: ${e.message}`);
    process.exit(1);
  }
}
