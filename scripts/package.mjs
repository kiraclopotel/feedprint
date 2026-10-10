// FeelingWise — cross-platform zip packager for Chrome Web Store.
//
// Produces `<repo>/release/<name>-<version>.local.zip` from the contents of `dist/` with
// `manifest.json` at the zip root (required by Chrome Web Store). release/ is
// ignored by git and created here when missing; packages never sit at the repo
// root or in a tracked folder (PLAN-2026-09-16 item 2.2).
//
// Zero-dep, pure Node. Replaces the previous `zip -r` shell call in
// package.json which failed on Windows where `zip` is not in PATH.
// Emits a standard ZIP with DEFLATE for compressible files and STORED
// for already-compressed / small files where DEFLATE would grow the
// output.
//
// Exported as a function for unit testing; runs as CLI when invoked
// directly via `node scripts/package.mjs`.

import {
  readdirSync, statSync, readFileSync, writeFileSync, existsSync, mkdirSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { deflateRawSync, crc32 } from 'node:zlib';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, '..');

/**
 * Files that live in the build folder and have no business in the zip.
 *
 * `build-id.json` is written by scripts/check-sw-bundle.mjs for the local
 * dev-reload server, which reads it OFF DISK on the developer's own machine
 * (scripts/dev/dev-reload-server.mjs). The extension itself never reads it: it
 * compares against the id baked into its own bundle. So in a store install the
 * file does nothing at all, and what it does do is ship a field called
 * `secret`. In a reproducible build that value is a throwaway derived from the
 * commit, but a zip cut straight after `npm run build` would carry the
 * developer's own `.fw-dev-secret`. Found 2026-09-19 by unpacking
 * release/receipts-2.5.11.zip and reading the file.
 */
export const NOT_IN_THE_ZIP = ['build-id.json'];

function walk(dir, base) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walk(full, base));
    } else if (st.isFile()) {
      const rel = relative(base, full).split(sep).join('/');
      if (NOT_IN_THE_ZIP.includes(rel)) continue;
      out.push({ abs: full, rel });
    }
  }
  return out;
}

function buildZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const raw = readFileSync(file.abs);
    const compressed = deflateRawSync(raw);
    const useStore = compressed.length >= raw.length;
    const body = useStore ? raw : compressed;
    const method = useStore ? 0 : 8;
    const crc = crc32(raw);
    const nameBytes = Buffer.from(file.rel, 'utf8');

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0, 6);
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt16LE(0, 10);
    lfh.writeUInt16LE(0x21, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(body.length, 18);
    lfh.writeUInt32LE(raw.length, 22);
    lfh.writeUInt16LE(nameBytes.length, 26);
    lfh.writeUInt16LE(0, 28);

    localParts.push(lfh, nameBytes, body);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0, 8);
    cdh.writeUInt16LE(method, 10);
    cdh.writeUInt16LE(0, 12);
    cdh.writeUInt16LE(0x21, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(body.length, 20);
    cdh.writeUInt32LE(raw.length, 24);
    cdh.writeUInt16LE(nameBytes.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt16LE(0, 34);
    cdh.writeUInt16LE(0, 36);
    cdh.writeUInt32LE(0, 38);
    cdh.writeUInt32LE(offset, 42);

    centralParts.push(cdh, nameBytes);
    offset += lfh.length + nameBytes.length + body.length;
  }

  const localBuf = Buffer.concat(localParts);
  const centralBuf = Buffer.concat(centralParts);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localBuf, centralBuf, eocd]);
}

export function packageExtension({ distDir, outFile } = {}) {
  const dist = distDir ?? resolve(DEFAULT_ROOT, 'dist');
  // No unversioned fallback. This defaulted to `release/feelingwise.zip`, which
  // is the name that kept putting a nameless twin of the release artefact in
  // the folder a person uploads from (2026-09-19; see zipNameFor below).
  const out = outFile ?? resolve(DEFAULT_ROOT, 'release', zipNameFor(dist, { local: true }));

  if (!existsSync(dist)) {
    throw new Error(`dist/ not found at ${dist} — run \`npm run build\` first`);
  }
  // Byte order, not localeCompare: the locale's collation decided the order of the zip's entries,
  // so a stranger whose system reads Thai built another zip from the same files (found 2026-09-16;
  // byte order gives the same order as en-US for every zip uploaded so far).
  const files = walk(dist, dist).sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  if (files.length === 0) {
    throw new Error(`dist/ is empty at ${dist} — run \`npm run build\` first`);
  }
  if (!files.some((f) => f.rel === 'manifest.json')) {
    throw new Error(`manifest.json missing from dist/ — corrupt build`);
  }

  const zipBuf = buildZip(files);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, zipBuf);
  return { outFile: out, fileCount: files.length, bytes: zipBuf.length };
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  return resolve(entry) === resolve(self);
}

/**
 * The name a zip gets from the build it was cut from: `<slug>-<version>`, plus
 * `.local` when nothing asked for a particular place.
 *
 * Why `.local` exists (2026-09-19). A plain `npm run package` used to write
 * `release/feelingwise.zip`: no version in the name, sitting in the same folder
 * as the reproducible artefacts, indistinguishable from them. One was found
 * there dated 18 September carrying a dev build id and the developer's own
 * dev-reload secret, beside `receipts-2.5.11.zip` of the same version. Sending
 * the wrong one would have put an unreproducible row in RELEASES.tsv under a
 * version number that means something else. The register already recorded this
 * file being deleted once, under M57, and it came back, because the default
 * name is what recreates it.
 *
 * The marker is in the name rather than the folder on purpose: it travels with
 * the bytes, so a zip that reaches a desktop still says what it is. And it can
 * never collide with `<slug>-<version>.zip`, which is the reproducible build's
 * name and the one artefact a session must never overwrite (M280).
 */
export function zipNameFor(distDir, { local }) {
  const manifest = JSON.parse(readFileSync(join(distDir, 'manifest.json'), 'utf8'));
  const slug = resolveManifestName(distDir, manifest).toLowerCase().split(/[^a-z0-9]+/)[0];
  return `${slug}-${manifest.version}${local ? '.local' : ''}.zip`;
}

// CLI: `node scripts/package.mjs [--dist <dir>] [--out <file> | --out-dir <dir>]`.
// With --out-dir the file is named from the manifest: `<name-slug>-<version>.zip`.
// With neither, it lands in `release/` as `<name-slug>-<version>.local.zip`.
function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dist') opts.distDir = resolve(argv[++i]);
    else if (a === '--out') opts.outFile = resolve(argv[++i]);
    else if (a === '--out-dir') opts.outDir = resolve(argv[++i]);
  }
  if (!opts.outFile) {
    const dist = opts.distDir ?? resolve(DEFAULT_ROOT, 'dist');
    const dir = opts.outDir ?? resolve(DEFAULT_ROOT, 'release');
    opts.outFile = join(dir, zipNameFor(dist, { local: !opts.outDir }));
  }
  return opts;
}

/**
 * The manifest name as the store shows it in the default locale. Since 2.5.2
 * the name is a `__MSG_key__` placeholder resolved from
 * `_locales/<default_locale>/messages.json`; a literal name is returned as is.
 * Throws when the placeholder has no message, so a package never gets a
 * nameless zip.
 */
export function resolveManifestName(distDir, manifest) {
  const name = String(manifest.name ?? '');
  const m = name.match(/^__MSG_([A-Za-z0-9_@]+)__$/);
  if (!m) return name;
  const locale = manifest.default_locale;
  if (!locale) throw new Error(`manifest name ${name} is a message key but default_locale is not set`);
  const file = join(distDir, '_locales', locale, 'messages.json');
  if (!existsSync(file)) throw new Error(`manifest name ${name} needs ${locale}/messages.json, not in dist`);
  const message = JSON.parse(readFileSync(file, 'utf8'))[m[1]]?.message;
  if (typeof message !== 'string' || !message) throw new Error(`no message for ${m[1]} in ${locale}/messages.json`);
  return message;
}

if (isMainModule()) {
  try {
    const result = packageExtension(parseArgs(process.argv.slice(2)));
    const kb = (result.bytes / 1024).toFixed(1);
    const rel = relative(DEFAULT_ROOT, result.outFile);
    process.stdout.write(`packaged ${result.fileCount} files -> ${rel} (${kb} KB)\n`);
  } catch (err) {
    process.stderr.write(`package failed: ${err.message}\n`);
    process.exit(1);
  }
}
