#!/usr/bin/env node
// FeelingWise: the reproducible build (Tier 1 item 10, the second bet of 2026).
//
// "Trust the extension" is the claim every vendor makes. The claim this
// script makes instead: anyone with this repository at this commit, the same
// Node version and `npm ci`, builds the same bytes and gets the same zip hash,
// which is the hash recorded for that upload in docs/spec/RELEASES.tsv.
//
// What normally makes two builds differ, and what this script does about it:
//   • the build id (`fwbid-…`, scripts/new-build-id.mjs) is minted from the
//     clock and Math.random on every run. Here it is derived from the commit
//     and the manifest version, so it is the same for the same source, and it
//     still says which code judged a record (its whole reason to exist).
//   • the dev-reload secret (`fwsec-…`, vite.config.ts) is per machine. Here
//     it is derived from the commit too. The dev self-reload is a developer
//     convenience and the secret guards nothing in a store build.
//   • the zip writes no timestamps and orders its entries by byte (scripts/package.mjs).
//   • the zip's compression is Node's own zlib, so the exact Node version is pinned in .nvmrc and
//     recorded with every upload; a run on another version refuses to compare.
// Everything else in the chain (tsc, vite/rolldown, the copied assets) is a
// pure function of the inputs pinned by package-lock.json.
//
// Usage:
//   node scripts/reproducible-build.mjs                 build, package, print the hashes
//   node scripts/reproducible-build.mjs --verify X.zip  build, package, compare with X.zip
//   node scripts/reproducible-build.mjs --expect-release
//        every product whose recorded upload was built from this source: build and compare with
//        its row in docs/spec/RELEASES.tsv (the public repository's CI runs this)
//   node scripts/reproducible-build.mjs --product off --expect-release
//        one product; refuses when its upload was built from another commit
//   node scripts/reproducible-build.mjs --product receipts --verify-installed <folder>
//        build and compare with the copy Chrome installed from the Chrome Web Store
//   node scripts/reproducible-build.mjs --allow-dirty   build anyway; the report says NOT REPRODUCIBLE
//   node scripts/reproducible-build.mjs --source-commit <sha>   name the commit the id is derived from
//   node scripts/reproducible-build.mjs --product off   the free filter: build:off, dist-off/, off-<version>.zip
//
// The public source is a fresh repository (docs/OPEN-SOURCE-SPLIT-2026-09-14.md): its own commit
// hash is not the one the store zip was built from, and the build id is derived from a commit, so
// a stranger building it would get other bytes. The snapshot therefore carries a SOURCE-COMMIT
// file naming the commit it was taken from, and this script derives the id from that file when it
// is there (or from --source-commit). The commit is a label inside the bundle, not a secret: the
// proof is still that the bytes match (found 2026-09-15, before any public push).
//
// The store never hands out the zip that was uploaded, so a zip hash in RELEASES.tsv is our record
// and nothing more. What a stranger does have is the copy Chrome installed from the store, and in
// it `_metadata/verified_contents.json`: a hash of every file the store served, signed with the
// Chrome Web Store's key, which Chromium publishes. --verify-installed checks that signature and
// compares every built file with it (measured 2026-09-16 on Receipts 2.5.8: the signature verifies,
// and 23 of the 24 files of the uploaded zip carry exactly the signed hashes). The one exception is
// manifest.json, which the store edits before signing; it is compared with the installed copy as
// data, allowing only the keys the store adds (key, update_url, differential_fingerprint).
//
// Output: release/receipts-<version>.zip (or release/off-<version>.zip), and beside it
// <name>-<version>.sha256.txt with the commit, the build id, the Node version, the hash of every
// file in the build folder and the hash of the zip. The developer's own .fw-dev-secret is put back
// afterwards. --verify refuses the path this run writes: the old zip there is removed before the
// build, so the comparison would be a file with itself and always MATCH (found 2026-09-15).

import { createHash, createPublicKey, verify } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { SOURCE_DIGEST_ENV } from './version-name.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Every zip uploaded to the Chrome Web Store, with the commit, the Node version and the hashes. */
export const RELEASES_PATH = 'docs/spec/RELEASES.tsv';
/** The products a row may name: the two Chrome uploads and their Firefox copies. */
export const RELEASE_PRODUCTS = ['receipts', 'off', 'receipts-firefox', 'off-firefox'];
/** The columns, in order. Columns may be added at the end, never removed or reordered. */
export const RELEASE_COLUMNS = ['product', 'version', 'source_commit', 'node', 'files_sha256', 'zip_sha256', 'uploaded'];

/** Where Chrome fetches store updates from: the value the store writes into an installed manifest. */
export const STORE_UPDATE_URL = 'https://clients2.google.com/service/update2/crx';

/**
 * The Chrome Web Store's public key for verified_contents.json, as Chromium publishes it:
 * kWebstoreSignaturesPublicKeyData in extensions/common/constants.cc (DER, SubjectPublicKeyInfo).
 * Checked 2026-09-16 against the signature on an installed copy of Receipts 2.5.8: it verifies.
 */
export const WEBSTORE_PUBLIC_KEY_HEX =
  '30820122300d06092a864886f70d01010105000382010f003082010a02820101008ffbbf5c3763943cb0ee01c4b5a69a' +
  'b19f46746f1638a0322735ddf0716b0edcf625cbb2edeafb32d5af1e03430346f0a739db23961d65e57851f084b00e12' +
  'ac0e5bdcc9d64c7c00d5b81b88333e2fdaebaaf71a75c2ae3a54de378f10d228e684794d15b4f3bd3f56d33c3f18abfc' +
  '2e05c01e0831b661d0fd9f4f3f640d1793bcad41c748be0027a84d7042920554a66db8de566e204970ee103e6bd27c31' +
  'bd1b6ea43c46629f086693f92a5131a8dbb59db90f73e8a0093201e97b2a8a36a0cf17b050709da2f9a46f624db6c931' +
  'fcf30812ff93bd6231d81cea1a9ef581287f755ed2277ac296f59ddb18fc76dc46f057c05834c8222d2a6575a7d90862' +
  'cd0203010001';

/** `fwbid-<commit hex>-r<version digits>`: the shape check-sw-bundle greps for. */
export function reproducibleBuildId(commit, version) {
  const hex = String(commit).toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 12);
  const ver = String(version).replace(/[^0-9]/g, '') || '0';
  if (hex.length < 7) throw new Error(`reproducible build id needs a commit hash, got "${commit}"`);
  return `fwbid-${hex}-r${ver}`;
}

/** `fwsec-<10 hex>` derived from the commit: the shape vite.config.ts accepts. */
export function reproducibleSecret(commit) {
  return `fwsec-${createHash('sha256').update(`feelingwise-reproducible:${commit}`).digest('hex').slice(0, 10)}`;
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function walk(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push(relative(base, full).split(sep).join('/'));
  }
  return out.sort();
}

/** Every file under a folder, by forward-slash path. */
function readTree(dir) {
  return new Map(walk(dir).map((p) => [p, readFileSync(join(dir, ...p.split('/')))]));
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function run(cmd, args, env) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}`);
}

/** A refusal: the run cannot say MATCH or MISMATCH, and says why. Exit 2. */
class Refusal extends Error {}

/** What one product builds from and writes: its manifest, npm script, folder, file stem and store id. */
export function productConfig(product) {
  if (product === 'receipts') {
    return { name: 'Feedprint', manifest: 'manifest.json', script: 'build', dist: 'dist', stem: 'receipts', storeId: 'mcdanhgfcpjpajlmjcdfeaeanlkodifp' };
  }
  if (product === 'off') {
    return { name: 'Off', manifest: 'manifest.off.json', script: 'build:off', dist: 'dist-off', stem: 'off', storeId: 'kebfpnjiiiboofdjhomcbgphfnlbahmh' };
  }
  // The Firefox copies are the Chrome build plus scripts/firefox-package.mjs, so a reviewer at addons.mozilla.org rebuilds
  // them with the same command. They have no Chrome Web Store item, so the store checks refuse them.
  if (product === 'receipts-firefox') {
    return { name: 'Feedprint for Firefox', manifest: 'manifest.json', script: 'build:firefox', dist: 'dist-firefox', stem: 'receipts-firefox', storeId: null };
  }
  if (product === 'off-firefox') {
    return { name: 'Off for Firefox', manifest: 'manifest.off.json', script: 'build:off-firefox', dist: 'dist-off-firefox', stem: 'off-firefox', storeId: null };
  }
  throw new Error(`--product must be ${RELEASE_PRODUCTS.join(', ')}, got "${product}"`);
}

/** True when two paths name the same file (Windows paths compare without case). */
export function samePath(a, b, platform = process.platform) {
  const norm = (p) => resolve(p).split(sep).join('/');
  return platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
}

/** The flags this script knows, and whether each takes a value. */
const FLAGS = {
  '--verify': true,
  '--verify-installed': true,
  '--expect-release': false,
  '--allow-dirty': false,
  '--source-commit': true,
  '--product': true,
};

/**
 * The command line as flags. Anything it does not know is refused: an older copy of this script
 * ignored flags it did not know, so a check that was never run looked like one that passed.
 */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!(flag in FLAGS)) throw new Refusal(`unknown argument "${flag}"; the arguments are ${Object.keys(FLAGS).join(', ')}`);
    if (flag in out) throw new Refusal(`${flag} given twice`);
    if (FLAGS[flag]) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Refusal(`${flag} needs a value`);
      out[flag] = value;
      i++;
    } else {
      out[flag] = true;
    }
  }
  if (out['--verify-installed'] && !out['--product']) throw new Refusal('--verify-installed needs --product, the extension that folder holds');
  if ((out['--expect-release'] || out['--verify-installed']) && out['--allow-dirty']) {
    throw new Refusal('--allow-dirty builds something no commit names, so there is nothing to compare it with');
  }
  return out;
}

/**
 * The commit the build id is derived from: `--source-commit <sha>`, else the SOURCE-COMMIT file a
 * public snapshot carries, else this repository's HEAD. Returns where it came from as well, so the
 * report can say so.
 */
export function resolveSourceCommit(argv, root, gitHead) {
  const at = argv.indexOf('--source-commit');
  if (at >= 0) {
    const value = String(argv[at + 1] ?? '').trim();
    if (!/^[0-9a-f]{40}$/i.test(value)) throw new Error(`--source-commit needs a full 40-character commit hash, got "${value}"`);
    return { commit: value.toLowerCase(), from: 'argument' };
  }
  const file = join(root, 'SOURCE-COMMIT');
  if (existsSync(file)) {
    const value = readFileSync(file, 'utf8').trim();
    if (!/^[0-9a-f]{40}$/i.test(value)) throw new Error(`SOURCE-COMMIT must hold one full commit hash, got "${value}"`);
    return { commit: value.toLowerCase(), from: 'SOURCE-COMMIT' };
  }
  return { commit: gitHead(), from: 'git' };
}

/**
 * The rows of docs/spec/RELEASES.tsv. Lines starting with # are notes. Anything malformed throws,
 * so a typo cannot quietly turn a comparison into "not recorded".
 */
export function parseReleases(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() !== '' && !l.startsWith('#'));
  const [header = '', ...rows] = lines;
  const columns = header.split('\t');
  if (RELEASE_COLUMNS.some((c, i) => columns[i] !== c)) {
    throw new Error(`${RELEASES_PATH}: the header must start with ${RELEASE_COLUMNS.join(', ')} (tab-separated)`);
  }
  const seen = new Set();
  return rows.map((line, i) => {
    const cells = line.split('\t');
    const where = `${RELEASES_PATH} row ${i + 1}`;
    if (cells.length !== columns.length) throw new Error(`${where}: ${cells.length} cells for ${columns.length} columns`);
    const [product, version, commit, node, filesSha256, zipSha256, uploaded] = cells;
    if (!RELEASE_PRODUCTS.includes(product)) throw new Error(`${where}: product must be one of ${RELEASE_PRODUCTS.join(', ')}`);
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`${where}: version "${version}"`);
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`${where}: source_commit must be 40 lowercase hex`);
    if (!/^\d+\.\d+\.\d+$/.test(node)) throw new Error(`${where}: node must be a version such as 24.14.0`);
    if (!/^[0-9a-f]{64}$/.test(filesSha256)) throw new Error(`${where}: files_sha256 must be 64 lowercase hex`);
    if (!/^[0-9a-f]{64}$/.test(zipSha256)) throw new Error(`${where}: zip_sha256 must be 64 lowercase hex`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(uploaded)) throw new Error(`${where}: uploaded must be a date`);
    const key = `${product} ${version}`;
    if (seen.has(key)) throw new Error(`${where}: ${key} is listed twice`);
    seen.add(key);
    return { product, version, commit, node, filesSha256, zipSha256, uploaded };
  });
}

/**
 * One hash for the contents of a build folder, whatever the zip around it: the SHA-256 of the lines
 * `<file sha256>  <path>`, one per file, ordered by path. Two builds with the same files and a zip
 * compressed differently have the same value here, so a MISMATCH can say which of the two it is.
 */
export function filesDigest(tree) {
  const paths = [...tree.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sha256(paths.map((p) => `${sha256(tree.get(p))}  ${p}\n`).join(''));
}

/**
 * Chromium's tree hash of one file, as verified_contents.json records it: SHA-256 over 4096-byte
 * blocks, then over groups of 128 of those hashes until one is left, written base64url. An empty
 * file is the hash of nothing.
 */
export function treeHashRoot(buf, blockSize = 4096, hashBlockSize = 4096) {
  let level = [];
  if (buf.length === 0) level.push(createHash('sha256').digest());
  for (let i = 0; i < buf.length; i += blockSize) level.push(createHash('sha256').update(buf.subarray(i, i + blockSize)).digest());
  const branch = hashBlockSize / 32;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += branch) {
      const h = createHash('sha256');
      for (const node of level.slice(i, i + branch)) h.update(node);
      next.push(h.digest());
    }
    level = next;
  }
  return level[0].toString('base64url');
}

/** The extension id Chrome derives from a manifest `key`: the first 32 hex of its SHA-256, as a to p. */
export function extensionIdFromKey(base64Key) {
  const hex = sha256(Buffer.from(base64Key, 'base64')).slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

const fromBase64Url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/**
 * What the Chrome Web Store signed for an installed copy: its item id, version and the tree hash of
 * every file. Throws when the store's signature does not verify with its published key, or when
 * the file is not in the one shape Chromium writes.
 */
export function readSignedContents(json, publicKeyHex = WEBSTORE_PUBLIC_KEY_HEX) {
  const entry = (Array.isArray(json) ? json : []).find((e) => e && e.description === 'treehash per file');
  const signed = entry?.signed_content;
  if (!signed?.payload || !Array.isArray(signed.signatures)) throw new Error('verified_contents.json has no signed "treehash per file" entry');
  const key = createPublicKey({ key: Buffer.from(publicKeyHex, 'hex'), format: 'der', type: 'spki' });
  const byStore = signed.signatures.filter((s) => s?.header?.kid === 'webstore');
  const ok = byStore.some((s) => verify('sha256', Buffer.from(`${s.protected}.${signed.payload}`), key, fromBase64Url(s.signature)));
  if (!ok) throw new Error('the Chrome Web Store signature on verified_contents.json does not verify');
  const body = JSON.parse(fromBase64Url(signed.payload).toString('utf8'));
  const hashes = (body.content_hashes ?? []).filter((h) => h.format === 'treehash');
  if (hashes.length !== 1 || hashes[0].block_size !== 4096 || hashes[0].hash_block_size !== 4096) {
    throw new Error('verified_contents.json holds a tree hash shape this script does not read');
  }
  return {
    itemId: body.item_id,
    itemVersion: body.item_version,
    files: new Map(hashes[0].files.map((f) => [f.path, f.root_hash])),
  };
}

const canonical = (v) =>
  Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v;
const sameData = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/**
 * A build compared with the copy Chrome installed from the store.
 *
 * `built` maps each path of the build folder to its bytes; `signed` is readSignedContents' result;
 * `installedManifest` is the parsed manifest.json of the installed folder. Every file but
 * manifest.json must carry the tree hash the store signed, and the signed list must name exactly
 * the built files. manifest.json is edited by the store before it signs, and written back by Chrome
 * at install, so it is compared as data: the installed one may add `key`, which must give this
 * product's store id, and `update_url`, which must be the store's; any other difference is named.
 */
export function compareWithStore({ built, signed, installedManifest, storeId }) {
  const matching = [];
  const problems = [];
  const signedPath = (p) => (signed.files.has(p) ? p : [...signed.files.keys()].find((k) => k.toLowerCase() === p.toLowerCase()));
  if (signed.itemId !== storeId) problems.push(`the store signed item ${signed.itemId}, not ${storeId}`);
  for (const [p, bytes] of built) {
    const at = signedPath(p);
    if (at === undefined) problems.push(`${p}: in this build, not in what the store signed`);
    else if (p === 'manifest.json') continue;
    // Compared as bytes: Chromium decodes root_hash ignoring padding, so a padded value is still valid.
    else if (fromBase64Url(signed.files.get(at)).equals(Buffer.from(treeHashRoot(bytes), 'base64url'))) matching.push(p);
    else problems.push(`${p}: different from what the store signed`);
  }
  for (const k of signed.files.keys()) {
    if (![...built.keys()].some((p) => p.toLowerCase() === k.toLowerCase())) problems.push(`${k}: signed by the store, not in this build`);
  }
  const ours = built.get('manifest.json');
  if (ours) {
    const mine = JSON.parse(ours.toString('utf8'));
    const theirs = { ...installedManifest };
    if (!('update_url' in mine)) {
      if (theirs.update_url !== STORE_UPDATE_URL) problems.push(`manifest.json: update_url is ${JSON.stringify(theirs.update_url)}, not the store's`);
      delete theirs.update_url;
    }
    if (!('key' in mine)) {
      if (typeof theirs.key !== 'string' || extensionIdFromKey(theirs.key) !== storeId) problems.push(`manifest.json: its key is not the key of ${storeId}`);
      delete theirs.key;
    }
    // Chromium's unpacker also writes `differential_fingerprint` when the copy arrived as a
    // differential update (extensions/browser/sandboxed_unpacker.cc, RewriteManifestFile). It is
    // a string the store derives from the package, not a change to what was built.
    if (!('differential_fingerprint' in mine) && 'differential_fingerprint' in theirs) {
      if (typeof theirs.differential_fingerprint !== 'string') problems.push('manifest.json: differential_fingerprint is not a string');
      delete theirs.differential_fingerprint;
    }
    const names = [...new Set([...Object.keys(mine), ...Object.keys(theirs)])].sort();
    const differing = names.filter((k) => !sameData(mine[k], theirs[k]));
    if (differing.length) problems.push(`manifest.json: ${differing.join(', ')} differ from this build`);
    else matching.push('manifest.json (as data)');
  }
  return { matching, problems };
}

/**
 * One product built with the id and secret pinned, packaged, and its report written.
 *
 * `into` is where the zip and its report land. A run that is COMPARING writes to
 * a scratch folder instead of release/, because a comparison that overwrites the
 * artefact it is comparing against is not a comparison. Read on 2026-09-18: a
 * `--verify` against a copy rebuilt the release zip in place, so the hash in the
 * note a person was about to act on named a file that no longer existed, and
 * nothing said so. The existing refusal only covered pointing `--verify` at the
 * output path itself, which is the one case where the damage is obvious.
 */
/**
 * The source digest of the tree being built (scripts/public-snapshot.mjs, SOURCE-DIGEST), or
 * undefined when no digest is true of it. In this repository it is the digest of the committed public
 * files; in an unpacked source archive it is recomputed from the files on disk and must equal the
 * SOURCE-DIGEST the archive carries. A dirty tree is no commit, so it states none; nor does a
 * checkout built under another commit's id (--source-commit), since its files are HEAD's. Asked of
 * the snapshot script in a child process, because that script imports this one.
 */
function sourceDigestOfThisTree({ dirty, commit }) {
  if (dirty) return undefined;
  const script = join(ROOT, 'scripts', 'public-snapshot.mjs');
  if (existsSync(join(ROOT, 'SOURCE-DIGEST'))) {
    const r = spawnSync(process.execPath, [script, '--check-digest', ROOT], { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) throw new Refusal(`these files do not recompute to the SOURCE-DIGEST beside them:\n${r.stdout}${r.stderr}`);
    return readFileSync(join(ROOT, 'SOURCE-DIGEST'), 'utf8').trim();
  }
  if (!existsSync(join(ROOT, '.git'))) return undefined;
  if (git(['rev-parse', 'HEAD']) !== commit) return undefined;
  const r = spawnSync(process.execPath, [script, '--digest'], { cwd: ROOT, encoding: 'utf8' });
  const digest = r.stdout.trim();
  if (r.status !== 0 || !/^[0-9a-f]{64}$/.test(digest)) throw new Refusal(`the source digest could not be read: ${r.stderr}`);
  return digest;
}

function buildProduct(product, { commit, from, dirty }, into) {
  const manifest = JSON.parse(readFileSync(join(ROOT, product.manifest), 'utf8'));
  const version = manifest.version;
  const releaseDir = into ?? join(ROOT, 'release');
  mkdirSync(releaseDir, { recursive: true });
  const zipTo = join(releaseDir, `${product.stem}-${version}.zip`);
  const buildId = reproducibleBuildId(commit, version);
  const secret = reproducibleSecret(commit);
  const sourceDigest = sourceDigestOfThisTree({ dirty, commit });

  // Pin the id and the secret for this run; put the developer's secret back after. The source
  // digest goes to the build in its environment, never in a file, so no later build can pick up a
  // digest left behind by an interrupted run.
  const idFile = join(ROOT, '.fw-build-id');
  const secretFile = join(ROOT, '.fw-dev-secret');
  const secretBackup = join(ROOT, '.fw-dev-secret.before-reproducible');
  if (existsSync(secretFile)) renameSync(secretFile, secretBackup);
  writeFileSync(idFile, `${buildId}\n`, 'utf8');
  writeFileSync(secretFile, `${secret}\n`, 'utf8');
  try {
    // FW_DEV_RELOAD=0: a packaged build bakes no dev-reload secret (2026-09-19,
    // BAKE_DEV_SECRET in vite.config.ts). The .fw-dev-secret swap above stays as
    // the belt to that brace: with the flag off nothing reads the file, and if
    // the flag is ever lost the value baked is still derived from the commit
    // rather than from this machine, so the build stays reproducible either way.
    run('npm', ['run', product.script], { FW_KEEP_BUILD_ID: '1', FW_DEV_RELOAD: '0', [SOURCE_DIGEST_ENV]: sourceDigest ?? '' });

    // Keep what is about to be replaced (M280, 2026-09-19). The comment above records this defect
    // for COMPARING runs and sent those to a scratch folder; a plain build still deleted the zip in
    // release/, which is where the package a person is about to upload lives. On 19 September a
    // verification sweep ran an ordinary build and both of his packages went, with the hashes in the
    // note in his hand naming files that no longer existed.
    //
    // The old bytes are moved aside rather than deleted, named with their own hash so the copy says
    // what it is. If the build reproduces them exactly, which is the whole claim of this script, the
    // copy is removed and nothing accumulates. If it does not, the copy stays and the run says so.
    // The zip and its .sha256.txt report are one artefact and move together. Found by using the
    // first version of this fix: it kept the zip, the report was written over anyway, and restoring
    // the zip left a report describing a different build beside it. A hash list that names other
    // bytes is worse than none, because it reads as confirmation.
    const reportPath = join(releaseDir, `${product.stem}-${version}.sha256.txt`);
    let superseded = null;
    let supersededReport = null;
    let supersededSha = null;
    if (existsSync(zipTo)) {
      supersededSha = sha256(readFileSync(zipTo));
      const stamp = `${product.stem}-${version}.${supersededSha.slice(0, 12)}.superseded`;
      superseded = join(releaseDir, `${stamp}.zip`);
      if (existsSync(superseded)) rmSync(superseded); // the same bytes kept twice is not a second copy
      renameSync(zipTo, superseded);
      if (existsSync(reportPath)) {
        supersededReport = join(releaseDir, `${stamp}.sha256.txt`);
        if (existsSync(supersededReport)) rmSync(supersededReport);
        renameSync(reportPath, supersededReport);
      }
    }
    run('node', ['scripts/package.mjs', '--dist', product.dist, '--out', zipTo]);

    const tree = readTree(join(ROOT, product.dist));
    const zipSha256 = sha256(readFileSync(zipTo));

    if (superseded) {
      if (zipSha256 === supersededSha) {
        rmSync(superseded);
        if (supersededReport) rmSync(supersededReport);
      } else {
        console.log('');
        console.log(`[reproducible] the ${product.stem} zip in release/ CHANGED.`);
        console.log(`[reproducible]   was ${supersededSha}`);
        console.log(`[reproducible]   now ${zipSha256}`);
        console.log(`[reproducible] the previous bytes are kept at ${relative(ROOT, superseded).split(sep).join('/')}`);
        if (supersededReport) {
          console.log(`[reproducible] and its hash list at ${relative(ROOT, supersededReport).split(sep).join('/')}`);
          console.log('[reproducible] put BOTH back together if you restore, or the report names other bytes.');
        }
        console.log('[reproducible] any note quoting the old hash is now wrong; correct it or put the old file back.');
      }
    }
    const lines = [
      `FeelingWise ${product.name} ${version}`,
      `commit ${commit}${from === 'git' ? '' : ` (from ${from})`}${dirty ? ' (DIRTY TREE: NOT REPRODUCIBLE)' : ''}`,
      `build id ${buildId}`,
      `source digest ${sourceDigest ?? 'none (not built from a commit)'}`,
      `node ${process.version}`,
      '',
      ...[...tree.keys()].map((f) => `${sha256(tree.get(f))}  ${product.dist}/${f}`),
      '',
      `${zipSha256}  ${product.stem}-${version}.zip`,
      '',
    ];
    const report = lines.join('\n');
    writeFileSync(join(releaseDir, `${product.stem}-${version}.sha256.txt`), report, 'utf8');
    console.log(report);
    console.log(`[reproducible] files ${filesDigest(tree)}`);
    return { version, zipTo, zipSha256, tree };
  } finally {
    rmSync(secretFile, { force: true });
    if (existsSync(secretBackup)) renameSync(secretBackup, secretFile);
  }
}

/** The Node version releases are built with, from .nvmrc; a run on another one would not compare. */
function checkNode(expected, why) {
  const running = process.version.replace(/^v/, '');
  if (running !== expected) {
    throw new Refusal(`${why} was built with Node ${expected} and this is Node ${running}; the zip's compression comes from Node, so install ${expected} first`);
  }
}

function main(argv) {
  const args = parseArgs(argv);
  const verifyZip = args['--verify'] ? resolve(args['--verify']) : null;
  // Receipts unless a product is named; --expect-release alone covers every product with an upload.
  const products = args['--product']
    ? [productConfig(args['--product'])]
    : args['--expect-release']
      ? [productConfig('receipts'), productConfig('off')]
      : [productConfig('receipts')];

  const { commit, from } = resolveSourceCommit(argv, ROOT, () => git(['rev-parse', 'HEAD']));
  // A snapshot unpacked without `git init` has no status to read; its files are what MANIFEST.txt hashes.
  const hasGit = existsSync(join(ROOT, '.git'));
  const dirty = hasGit ? git(['status', '--porcelain', '--untracked-files=no']) !== '' : false;
  if (dirty && !args['--allow-dirty']) {
    throw new Refusal('the working tree has uncommitted changes; a hash over them names no commit. Commit, or pass --allow-dirty to build anyway (the report will say NOT REPRODUCIBLE).');
  }
  const version = (p) => JSON.parse(readFileSync(join(ROOT, p.manifest), 'utf8')).version;

  // What each product is compared with, settled before anything is built.
  let rows = null;
  if (args['--expect-release']) {
    const file = join(ROOT, RELEASES_PATH);
    if (!existsSync(file)) throw new Refusal(`${RELEASES_PATH} is not in this tree, so no upload is recorded to compare with`);
    rows = parseReleases(readFileSync(file, 'utf8'));
  }
  const plan = [];
  for (const product of products) {
    const v = version(product);
    let row = null;
    if (rows) {
      row = rows.find((r) => r.product === product.stem && r.version === v) ?? null;
      const skip = !row
        ? `${product.name} ${v} has no row in ${RELEASES_PATH}: no upload of it is recorded`
        : row.commit !== commit
          ? `${product.name} ${v} was uploaded from ${row.commit.slice(0, 10)}; this source is ${commit.slice(0, 10)}, and the build id comes from the commit`
          : null;
      if (skip && args['--product']) throw new Refusal(skip);
      if (skip) {
        console.log(`[reproducible] not rebuilt here: ${skip}.`);
        continue;
      }
      checkNode(row.node, `${product.name} ${v}`);
    }
    plan.push({ product, row });
  }
  if (rows && plan.length === 0) throw new Refusal(`no upload in ${RELEASES_PATH} was built from ${commit}`);

  let signed = null;
  let installedManifest = null;
  if (args['--verify-installed']) {
    const folder = resolve(args['--verify-installed']);
    const product = products[0];
    if (!product.storeId) throw new Refusal(`${product.name} has no Chrome Web Store item to compare an installed copy with`);
    const record = join(folder, '_metadata', 'verified_contents.json');
    if (!existsSync(join(folder, 'manifest.json'))) throw new Refusal(`${folder} holds no manifest.json; give the folder named after the version, such as 2.5.9_0`);
    if (!existsSync(record)) throw new Refusal(`${folder} has no _metadata/verified_contents.json, the record the store signs; only a copy installed from the Chrome Web Store has one`);
    signed = readSignedContents(JSON.parse(readFileSync(record, 'utf8')));
    installedManifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8').replace(/^﻿/, ''));
    if (signed.itemId !== product.storeId) throw new Refusal(`that folder holds item ${signed.itemId}, not ${product.name} (${product.storeId})`);
    if (signed.itemVersion !== version(product)) {
      throw new Refusal(`that folder holds ${product.name} ${signed.itemVersion} and this source builds ${version(product)}; compare with the source of ${signed.itemVersion}`);
    }
    // The file hashes do not depend on Node's zlib, so another Node is a warning here, not a refusal;
    // a stranger who sees a MISMATCH should still know the version differs from the one recorded.
    const pinned = existsSync(join(ROOT, '.nvmrc')) ? readFileSync(join(ROOT, '.nvmrc'), 'utf8').trim() : null;
    if (pinned && pinned !== process.version.replace(/^v/, '')) {
      console.error(`[reproducible] note: uploads are built with Node ${pinned} (.nvmrc) and this is Node ${process.version.replace(/^v/, '')}; the file comparison does not depend on it, the zip hash would`);
    }
  }

  let failed = false;
  // A comparing run keeps its hands off release/. See buildProduct's docblock.
  const comparing = Boolean(verifyZip) || args['--expect-release'] || Boolean(args['--verify-installed']);
  const into = comparing ? mkdtempSync(join(tmpdir(), 'fw-reproducible-')) : null;
  if (into) console.log(`[reproducible] comparing, so this run writes to ${into} and leaves release/ as it stands.`);
  for (const { product, row } of plan) {
    const built = buildProduct(product, { commit, from, dirty }, into);
    if (verifyZip) {
      if (samePath(verifyZip, built.zipTo)) throw new Refusal(`--verify ${verifyZip} is the file this run writes; copy it elsewhere first, or the comparison is a file with itself.`);
      if (!existsSync(verifyZip)) throw new Refusal(`--verify: ${verifyZip} does not exist`);
      const theirs = sha256(readFileSync(verifyZip));
      if (theirs === built.zipSha256) console.log(`[reproducible] MATCH: ${verifyZip} has the same SHA-256 as the build from ${commit.slice(0, 10)}.`);
      else {
        console.error(`[reproducible] MISMATCH: ${verifyZip} ${theirs}\n               this build ${built.zipSha256}`);
        failed = true;
      }
    }
    if (row) {
      const files = filesDigest(built.tree);
      if (files === row.filesSha256 && built.zipSha256 === row.zipSha256) {
        console.log(`[reproducible] MATCH: ${product.name} ${row.version} is the zip recorded as uploaded on ${row.uploaded} (${row.zipSha256}).`);
      } else if (files === row.filesSha256) {
        console.error(`[reproducible] MISMATCH in the zip only: every file of ${product.name} ${row.version} matches the upload, the zip around them does not (recorded ${row.zipSha256}, this build ${built.zipSha256}).`);
        failed = true;
      } else {
        console.error(`[reproducible] MISMATCH: ${product.name} ${row.version} does not build the files recorded as uploaded (recorded ${row.filesSha256}, this build ${files}).`);
        failed = true;
      }
    }
    if (signed) {
      const { matching, problems } = compareWithStore({ built: built.tree, signed, installedManifest, storeId: product.storeId });
      if (problems.length === 0) {
        console.log(`[reproducible] MATCH: all ${matching.length} files of ${product.name} ${signed.itemVersion} are what the Chrome Web Store signed for this copy (manifest.json compared as data).`);
      } else {
        console.error(`[reproducible] MISMATCH with the installed copy:\n  ${problems.join('\n  ')}`);
        failed = true;
      }
    }
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    if (!(err instanceof Refusal)) throw err;
    console.error(`[reproducible] ${err.message}`);
    process.exitCode = 2;
  }
}
