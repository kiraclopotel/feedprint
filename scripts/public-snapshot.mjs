#!/usr/bin/env node
// FeelingWise: the public snapshot (docs/OPEN-SOURCE-SPLIT-2026-09-14.md, section 6).
//
// Writes the tree that goes public into public-snapshot/ (gitignored): every
// tracked file the allowlist names, nothing the private list names, then a
// content scan that refuses the whole snapshot on a single hit. The owner runs
// `git init` in that directory; this repository's history never travels.
//
// Why an allowlist over the committed tree and not a copy of the working tree: an
// untracked file (a corpus, a chain, a key) can never reach the snapshot, and a
// tracked file outside the list needs a line here, on purpose, in a commit. The
// bytes come from the commit too, never from the working files: a Windows checkout
// can hold CRLF where the commit holds LF, and MANIFEST.txt then named hashes the
// public repository would never contain (found 2026-09-15 with
// tests/fixtures/calibration/user-words-v1.json in a worktree).
//
// Usage:
//   node scripts/public-snapshot.mjs            write public-snapshot/, scan, MANIFEST.txt
//   node scripts/public-snapshot.mjs --list     print the public paths, write nothing
//   node scripts/public-snapshot.mjs --scan     scan the public paths in place, write nothing
//   node scripts/public-snapshot.mjs --commit <sha>   the public copy of an upload (below); combines with the two above
//   node scripts/public-snapshot.mjs --digest   print the source digest of the commit, write nothing
//   node scripts/public-snapshot.mjs --archive <file.zip>   also pack the written snapshot into one zip
//   node scripts/public-snapshot.mjs --check-digest <folder>   recompute the digest of an unpacked archive, no git
//
// The source digest (SOURCE-DIGEST in the snapshot) is the SHA-256 of the sorted "<sha256>  <path>"
// lines of the public files, the release list left out, so it is a function of the commit alone. A
// reproducible build writes it into the manifest's version_name, which page one of every export
// prints; docs/REBUILD.md is the stranger's way from that line to a rebuilt, compared package.
//
// A public copy is published at an upload, so that its source is the source of what the store serves.
// `--commit` takes the files from the commit an upload was built from, and one file from HEAD:
// docs/spec/RELEASES.tsv, because the row for that upload can only be committed after it (a commit
// cannot hold the hash of its own build). The copy is classified by that commit's own lists, and
// refused where today's lists would decide a path differently, so an old commit cannot publish a
// file that has since been made private. It is refused as well when the commit predates the release
// list, since its copy would carry the checks from before there was anything to compare with. The
// output folder is refused when it holds a git repository: this script empties it on every run.
//
// Exit 0 on a clean snapshot, 2 on a scan hit (the paths and line numbers are
// printed, never the matched text), 1 on any other failure.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RELEASES_PATH, parseReleases } from './reproducible-build.mjs';
import { packageExtension } from './package.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SNAPSHOT_DIR = 'public-snapshot';

/**
 * The public tree, section 2 of the proposal. A prefix ends in "/" and takes
 * the whole directory; anything else is one exact path.
 */
export const PUBLIC_ALLOWLIST = [
  'src/',
  'tests/',
  '_locales/',
  'assets/',
  'verifier/',
  'docs/spec/',
  // The relay's source, public since 13 Oct 2026 (cold audit, finding 1): every claim about post text after it leaves
  // the browser rests on this code. Its operator scripts stay private (below).
  'worker/',
  '.githooks/',
  'manifest.json',
  'manifest.off.json',
  'vite.config.ts',
  'vitest.config.ts',
  'tsconfig.json',
  'tsconfig.tests.json',
  'eslint.config.mjs',
  'eslint.config.d.mts',
  'knip.json',
  'package.json',
  'package-lock.json',
  'README.md',
  'SECURITY.md',
  'CHANGELOG.md',
  'LICENSE',
  'LICENSE-NOTES.md',
  'THIRD-PARTY-NOTICES.md',
  // The line-ending rule the reproducible hash depends on; the public copy carries the same file.
  '.gitattributes',
  // The exact Node version uploads are built with; the public CI installs it from this file.
  '.nvmrc',
  // The public repository's own check (since 2026-09-16): the gates this repository runs before a
  // commit, then every uploaded extension this source built, rebuilt and compared with its row in
  // docs/spec/RELEASES.tsv. Named exactly, so a workflow added later stays private until named.
  '.github/workflows/ci.yml',
  'docs/METHODOLOGY.md',
  'docs/REBUILD.md',
  'scripts/reproducible-build.mjs',
  'scripts/reproducible-build.d.mts',
  'scripts/package.mjs',
  'scripts/package.d.mts',
  // The Firefox copies are made from the Chrome build by this step, and addons.mozilla.org rebuilds
  // an extension from its source, so the step is public with the build it follows.
  'scripts/firefox-package.mjs',
  'scripts/firefox-package.d.mts',
  'scripts/firefox/',
  'scripts/new-build-id.mjs',
  'scripts/version-name.mjs',
  'scripts/version-name.d.mts',
  'scripts/check-sw-bundle.mjs',
  'scripts/check-off-bundle.mjs',
  'scripts/build-standalone-verifier.ts',
  'scripts/build-verifier-vectors.ts',
  // Public because its output ships in verifier/: kit.browser.js is a generated copy of the pool and table
  // tools, and a generated copy whose generator is hidden has to be taken on trust.
  'scripts/build-kit-browser.mjs',
  // Public because its OUTPUT is addressed to a stranger: it generates the content-identity
  // conformance suite a second implementer diffs against (verifier/FORMAT.md section 9), and a
  // conformance suite whose construction is hidden is one an implementer has to take on trust.
  'scripts/build-content-identity-vectors.ts',
  'scripts/build-demo-export.ts',
  // The demo's time-stamp tokens, fetched once from public authorities over invented data.
  'scripts/demo-anchors.json',
  // The week example's time-stamp tokens, the same kind over its invented week.
  'scripts/example-anchors.json',
  // The fixed clock the two generators above run under, so a rebuild's diff shows only what changed.
  'scripts/fixed-clock.ts',
  'scripts/gen-rfc3161-inline.mjs',
  'scripts/gen-rfc3161-inline.d.mts',
  'scripts/verify-shipped.mjs',
  // The dev-reload token server: public since 2026-09-16 (PLAN-2026-09-16 item 5.6). It serves
  // dist/build-id.json to an unpacked install; a reader building this repository uses it.
  'scripts/dev/dev-reload-server.mjs',
  // Public like the rest of scripts/dev: a person working on this repository runs it before joining
  // a branch, and it only reads the journals and the git range it is given.
  'scripts/dev/review-verdicts.mjs',
  'scripts/dev/review-verdicts.d.mts',
  // Public like the rest of scripts/dev: it lists the test and build runs still going for a folder,
  // reading the process list and stopping nothing.
  'scripts/dev/stray-runs.mjs',
  'scripts/dev/stray-runs.d.mts',
  // Public like the rest of scripts/dev: it lists what pins a path before a move, reading the guard
  // tests and writing nothing, and skips each guard the public copy does not carry.
  'scripts/dev/retirement-preflight.mjs',
  'scripts/dev/retirement-preflight.d.mts',
  // The salvage tools, public since 2026-09-16 (PLAN-2026-09-16 decision 17 and item 5.7). The
  // shipped dashboard prints scripts/salvage-gather.ts in four languages when a chain has to be
  // recovered from disk, so a reader of the public copy must find the script that line names.
  // They read files and write copies; they hold no key and no private path beyond the folder the
  // operator gives them.
  'scripts/salvage-gather.ts',
  'scripts/salvage-extract.ts',
  'scripts/salvage-keys.ts',
  'scripts/salvage-verify.ts',
  'scripts/shipped-orphan-baseline.json',
  'scripts/public-snapshot.mjs',
  'scripts/public-snapshot.d.mts',
];

/**
 * Never public, whatever the allowlist says. Checked after the allowlist so a
 * widened prefix cannot quietly carry one of these. Prefixes end in "/"; an entry
 * ending in "*" matches every path that starts with the rest (dated file families).
 */
export const PRIVATE_DENYLIST = [
  'corpus/',
  'past-forensics/',
  '.fw-chain.json',
  // The relay's operator tools: they mint keys and print the licence ledger, the operator's and not a reader's.
  'worker/scripts/',
  // The relay's deploy config names the Cloudflare account, which the scan refuses in public. Its settings that bear on
  // a claim (when consent is required, when the second company starts) are described in docs/spec/subsystems/worker.md.
  'worker/wrangler.toml',
  'landing/',
  'store/',
  'OUTBOX/',
  'docs/audits/',
  'docs/research/',
  'docs/measurements/',
  'docs/outreach/',
  'docs/design/',
  'docs/marketing/',
  'docs/archive/',
  // Documents that are history (PLAN-2026-09-16 Wave 4): moved, never deleted, never public.
  'docs/history/',
  // The working defect register (PLAN-2026-09-17 decision 3). 800-plus lines in the maintainer's
  // own voice, quoting reports from named people and describing his own record's contents; the
  // scrub of 2026-09-17 took the real handles and ids out of the docs/spec files, and this one
  // stays private besides. `docs/spec/KNOWN-LIMITS.md` is what a stranger needs from it: what a
  // checked file establishes, what it does not, and what is missing from a record by construction.
  // Source comments still cite it by entry number, and KNOWN-LIMITS says where it is and why.
  'docs/spec/known-issues.md',
  // The audit ledger of 23 Aug. Its open weakness (key guessing, D-A1) is fixed and live since the relay deploy of
  // 10 Oct 2026, and the relay's own page is public again; the ledger is a working paper and stays here.
  'docs/spec/AUDIT-2026-08-23-APPLIED.md',
  'docs/history/2026-09/LONG-PLAN.md',
  'docs/VOICE.md',
  'docs/STATE-LOG.md',
  'docs/OPEN-SOURCE-SPLIT-2026-09-14.md',
  'STATE.md',
  // The one page a session is fed, and today's page with his own acts: the maintainer's, not a stranger's.
  'BRIEF.md',
  // A book for the owner to learn to explain the product himself, not project documentation.
  'HOW-TO-EXPLAIN-FEELINGWISE.txt',
  'HOW-FEELINGWISE-SPEAKS.txt',
  'NOW.md',
  'docs/history/2026-09/presentstate.md',
  'docs/history/2026-09/paststate.md',
  'docs/history/2026-09/futurestate.md',
  // The progress bar a session keeps for him. Names his own acts and the queue it is working
  // through, which is his business and not a stranger's.
  'docs/history/2026-09/WORK-NOW.md',
  'SESSION-PROMPT.md',
  // Where everything is, written for the maintainer: it names OUTBOX, the outreach folder and
  // his own acts, so it is a map of the private half and does not go out.
  'WHERE.md',
  'PLAN-*',
  // Names the private folders of this repository; the public copy gets no ignore file from here.
  '.gitignore',
  // Named so nothing in the tree is private only by being left off the allowlist
  // (tests/repo/snapshot-classification.test.ts, 2026-09-15). Private already; naming them
  // means a widened allowlist cannot carry them.
  '.audit-cache/',
  'docs/adr/',
  'docs/compliance/',
  'docs/redesign/',
  'docs/store/',
  'docs/verification/',
  // The public texts' provenance: fact sheets, model drafts and their claim checks. Drafts of store texts
  // and reports on them are the maintainer's working papers, like docs/store/.
  'docs/words/',
  'docs/plans/',
  // The map a session reads first. It names the private folders (the server, the site, WHERE.md)
  // beside the public ones, so like WHERE.md it is a map of both halves and does not go out.
  'docs/context/',
  '.brain/',
  '.agents/',
  '.claude/',
  'experiments/',
  'tools/',
  'scripts/corpus/',
  'scripts/research/',
  'scripts/eyes-exam/',
  'scripts/store/',
  'tests/calibration/',
  // Tests whose subject stays private live under one prefix since 2026-09-16 (PLAN-2026-09-16 item
  // 7.3): tests/private/worker, /site, /scripts, /docs, /hooks. Each reads a private path, so it
  // cannot run in the public copy; they keep running in this repository. Before this, 34 file names
  // were listed here one by one, and a new private test was public until someone remembered.
  'tests/private/',
  // repository guards that read private scripts (PLAN-2026-09-16 item 0.6)
  'tests/repo/path-resolver.test.ts',
  'tests/repo/path-resolver-baseline.json',
  'tests/repo/ab-build.test.ts',
  'tests/repo/root.test.ts',
  'tests/repo/outbox.test.ts',
  'tests/repo/docs.test.ts',
  'tests/repo/citations.test.ts',
  'tests/repo/scripts.test.ts',
  // Reads docs/context/, WHERE.md and scripts/context/, none of which the public copy carries.
  'tests/repo/context-map.test.ts',
  // Names the private tests in each vitest project, so it cannot run where they are absent.
  'tests/repo/vitest-projects.test.ts',
  'tests/repo/citations-baseline.json',
  // OpenAI's moderation sample: third-party text with real people's handles, and texts labelled
  // sexual-minors. Tracked for the private corpus probe, never public.
  'tests/fixtures/calibration/external-openai-mod-1680.json',
];

/** The reviewed calibration sets that ship. tests/fixtures/calibration/ is tracked whole; the one
 *  file kept out is external-openai-mod-1680.json, OpenAI's moderation sample: third-party text
 *  carrying real people's handles, and no test reads it (2026-09-15). */
export const CALIBRATION_ALLOWED = [
  'tests/fixtures/calibration/',
];

function matches(list, path) {
  return list.some((entry) =>
    entry.endsWith('/') ? path.startsWith(entry) : entry.endsWith('*') ? path.startsWith(entry.slice(0, -1)) : path === entry,
  );
}

/** True when a tracked path belongs in the public tree. */
export function isPublicPath(path) {
  // The denylist is read first: with the calibration prefix first, the moderation sample's line
  // never took effect and the sample sat in the public copy.
  if (matches(PRIVATE_DENYLIST, path)) return false;
  if (CALIBRATION_ALLOWED.some((p) => path.startsWith(p))) return true;
  return matches(PUBLIC_ALLOWLIST, path);
}

/** Repository paths a script command names: a top folder of this tree, then a path under it. */
const COMMAND_PATH = /(?:^|[\s"'=])((?:scripts|worker|tools|src|tests|verifier|landing|docs)\/[\w./-]+)/g;
/** `npm --prefix <dir>` runs a whole folder's own scripts. */
const COMMAND_PREFIX = /--prefix\s+([\w./-]+)/g;
/** `npm run <name>` and `npm-run-all ... <name>` call other scripts in the same file. */
const COMMAND_RUNS = /(?:npm run|npm-run-all(?:\s+--\w+)*)\s+([\w:\s-]+)/g;

/**
 * package.json as the public copy carries it: every npm script a stranger can run, and none of
 * the ones that point at a folder the public copy does not have.
 *
 * The snapshot writes every other file exactly as HEAD stores it. This is the one exception, and
 * it only ever removes lines. Until 2026-09-16 the public package.json offered eleven commands that
 * fail the moment a stranger runs them: the research runners, the licence tools and the server,
 * the product walk and the verify harness, all of which live in folders the public copy leaves
 * out. Dependencies, the version and every kept script are untouched, so `npm ci` and the
 * reproducible build see the same file they always did, apart from the scripts they never call.
 *
 * A script is dropped when a path it names is private, when it runs a private folder with
 * `--prefix`, or when it calls a script already dropped. Returns the bytes to write.
 */
export function publicPackageJson(buf) {
  const pkg = JSON.parse(buf.toString('utf8'));
  const scripts = pkg.scripts ?? {};
  const dropped = new Set();
  const privateByPath = (cmd) =>
    [...cmd.matchAll(COMMAND_PATH)].some((m) => !isPublicPath(m[1])) ||
    // A folder's commands run on its package.json and, for the relay, its deploy config, which stays private.
    [...cmd.matchAll(COMMAND_PREFIX)].some((m) =>
      ['package.json', 'wrangler.toml'].some((f) => !isPublicPath(`${m[1].replace(/\/$/, '')}/${f}`)));
  for (const [name, cmd] of Object.entries(scripts)) if (privateByPath(cmd)) dropped.add(name);
  // A kept script that calls a dropped one would fail the same way, so the drop spreads until still.
  for (let grew = true; grew; ) {
    grew = false;
    for (const [name, cmd] of Object.entries(scripts)) {
      if (dropped.has(name)) continue;
      const calls = [...cmd.matchAll(COMMAND_RUNS)].flatMap((m) => m[1].trim().split(/\s+/));
      if (calls.some((c) => dropped.has(c))) {
        dropped.add(name);
        grew = true;
      }
    }
  }
  pkg.scripts = Object.fromEntries(Object.entries(scripts).filter(([name]) => !dropped.has(name)));
  return Buffer.from(`${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}

/**
 * The content scan, gate 3 of the proposal: the five key shapes of the 6 Sep
 * history check, a Cloudflare account id line, and the support address where a
 * public page does not already carry it. Returns line
 * numbers only; the matched text is never returned or printed.
 */
export const SCAN_PATTERNS = [
  { name: 'groq-key', re: /gsk_[A-Za-z0-9]{40,}/ },
  { name: 'sk-key', re: /\bsk-[A-Za-z0-9]{30,}/ },
  { name: 'aws-key', re: /\bAKIA[A-Z0-9]{16}\b/ },
  { name: 'slack-token', re: /\bxox[abpr]-[A-Za-z0-9-]{10,}/ },
  { name: 'github-token', re: /\bghp_[A-Za-z0-9]{30,}/ },
  // TOML's `account_id =`, and the YAML or JSON forms a workflow or a config would use.
  { name: 'account-id', re: /^\s*["']?(?:account_id|CLOUDFLARE_ACCOUNT_ID)["']?\s*[:=]/m },
  // A path on the owner's machine: a Windows profile's AppData, the folder the project lives in, or the sessions'
  // folder (a relay comment named two files there until 13 Oct 2026).
  { name: 'owner-path', re: /[A-Za-z]:[\\/]Users[\\/][^\\/\s]+[\\/]AppData|\bE:[\\/](?:HQ|sessions)\b/ },
  { name: 'private-key-block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];

/** Pages that already carry the support address in public. */
const SUPPORT_ADDRESS_ALLOWED = new Set([
  'README.md', 'SECURITY.md', 'LICENSE', 'verifier/README.md', 'docs/METHODOLOGY.md',
  // The relay's licence email gives the address the site already prints.
  'worker/src/proxy.ts',
  // The "Tell us" line in both popups writes to the same address, and its page in the spec quotes it.
  'src/ui/popup/report-link.ts', 'docs/spec/subsystems/off-product.md',
]);
const SUPPORT_ADDRESS = /support@feelingwise\.org/;

export function scanContent(path, text) {
  const hits = [];
  const lines = text.split('\n');
  for (const { name, re } of SCAN_PATTERNS) {
    if (!re.test(text)) continue;
    const single = new RegExp(re.source.replace(/^\^\\s\*/, '\\s*'), re.flags.replace('m', ''));
    lines.forEach((line, i) => {
      if (single.test(line)) hits.push({ path, line: i + 1, pattern: name });
    });
  }
  if (!SUPPORT_ADDRESS_ALLOWED.has(path) && SUPPORT_ADDRESS.test(text)) {
    lines.forEach((line, i) => {
      if (SUPPORT_ADDRESS.test(line)) hits.push({ path, line: i + 1, pattern: 'support-address' });
    });
  }
  // A scan written to keep a person out of the public copy has to read all of that copy, src/,
  // tests/ and verifier/ included, so each pattern names where it does NOT look, and why.
  //
  // Real people's names are not looked for here. A pattern that spells a name is itself that name
  // in the public copy, so the names live on a private list and the private name check matches
  // salted fingerprints of them in every tracked file.
  lines.forEach((line, i) => {
    // Under tests/ the ids are mostly ones we wrote, in shapes nobody's post has: a counting run
    // like 1234567890..., a long run of zeros, the 19000... prefixes. A test is also where an id
    // pasted from a live page hides, and a Facebook group id did, so there any 15 to 19 digit run
    // without such a shape is refused.
    const idHit = path.startsWith('tests/')
      ? [...line.matchAll(ANY_LONG_ID)].some((m) => !inventedId(m[1]))
      : LONG_ID.test(line);
    if (idHit) hits.push({ path, line: i + 1, pattern: 'long-numeric-id' });
    // Not in the files that carry npm scopes, which are @name and not a person: every one of
    // those in this tree is a package or a plugin, and there are 191 of them.
    // A stylesheet's at-names are at-rules, and a handle under tests/ is one we invented, the
    // same argument as the ids: @alice, @badactor, @someone and the rest are cast, not people.
    if (!SCOPE_FILES.has(path) && !path.endsWith('.css') && !path.startsWith('tests/') && path !== SCANNER) {
      for (const m of line.matchAll(HANDLE)) {
        if (!HANDLE_ALLOWED.has(m[1])) { hits.push({ path, line: i + 1, pattern: 'handle' }); break; }
      }
    }
  });
  return hits;
}

/** An 18 or 19 digit id (an X status, a TikTok video), unless it has the invented shape 190000…, 290000…, 790000…. */
const LONG_ID = /\b(?![127]9000000000000)\d{18,19}\b/;
/** A 15 to 19 digit id: a Facebook group or page, an Instagram media id, an X status, a TikTok video. */
const ANY_LONG_ID = /(?<![\w.])(\d{15,19})(?!\w)/g;
/**
 * True when an id has a shape we write and a platform does not: the 190000… prefixes, eight
 * counting digits (12345678, 89012345), eight zeros in a row, or four doubled digits in a row
 * (99887766).
 */
function inventedId(id) {
  if (/^[127]9000000000000/.test(id) || id.includes('00000000') || /(\d)\1(\d)\2(\d)\3(\d)\4/.test(id)) return true;
  for (let s = 0; s + 8 <= id.length; s += 1) {
    let run = true;
    for (let k = s; k < s + 7 && run; k += 1) run = (Number(id[k + 1]) - Number(id[k]) + 10) % 10 === 1;
    if (run) return true;
  }
  return false;
}
/**
 * `@name` outside a code span: a handle.
 *
 * The lookbehind excluded a leading `/` until 2026-09-18, so that a path like docs/@types would
 * not read as a handle. That is the exact shape of a TikTok profile link, and it is how the one
 * real advertiser handle in this tree was written: docs/spec/surfaces/tiktok.md carried a
 * `/@handle` link from a live drive on 2026-07-14 and the scan read straight past it. The
 * scope names that needed the exemption sit on HANDLE_ALLOWED instead, where a person can read
 * them and disagree.
 */
const HANDLE = /(?<![\w`.@-])@([A-Za-z0-9_]{4,})\b/g;
/** Words after an @ that documents use and that are not handles. */
const HANDLE_ALLOWED = new Set([
  'user', 'handle', 'handles', 'mention', 'eslint', 'GroupName', 'invented_handle',
  // npm scopes that appear in source and in comments rather than only in a manifest.
  'typescript', 'types', 'vitejs', 'vitest', 'rollup', 'babel', 'testing',
  // JSDoc tags and CSS at-rules. `@author` is a JSDoc tag here and never a person: the private
  // name check is what looks for a person, and it reads every file.
  'param', 'returns', 'return', 'throws', 'example', 'deprecated', 'typedef', 'template',
  'property', 'default', 'internal', 'public', 'private', 'readonly', 'override', 'author',
  'since', 'link', 'fileoverview', 'module', 'constant', 'namespace', 'inheritdoc',
  'media', 'supports', 'keyframes', 'import', 'charset', 'layer', 'container', 'font',
  'namespace', 'page', 'scope', 'starting', 'counter',
  // The stand-in names comments and prompts use when they show the shape of a handle. Each one
  // was read on the line it appears on before it was put here.
  'username', 'userX', 'name', 'news', 'viewer', 'someone', 'person', 'anyhandle',
  'mentions', 'creatorY', 'example_commenter', 'synthetic_author', 'somecreator', 'unknown',
  // The labels a reading sends in place of a name (src/core/name-labels.ts) and the stand-ins the comments beside
  // them use, each read on its line on 13 Oct 2026.
  'user_A', 'user_B', 'user_Z', 'user_AA', 'USER_A', 'user_', 'pat_99', 'viewer_t', 'names', 'jane', 'alice',
  // A Facebook group whose own name begins with an at sign, quoted in a comment that explains
  // why a group can be read as a user. The group is public and the line is about its shape.
  'Claude',
]);
/** This file: it holds the patterns, so it matches every one of them. */
const SCANNER = 'scripts/public-snapshot.mjs';
/** Files whose @names are npm scopes. The pattern is for a person, and these hold packages. */
const SCOPE_FILES = new Set([
  'package.json', 'package-lock.json', 'eslint.config.mjs', 'knip.json', 'vite.config.ts',
  'vitest.config.ts', 'tsconfig.json', 'tsconfig.tests.json',
  'worker/package.json', 'worker/package-lock.json', 'worker/tsconfig.json',
]);

function trackedFiles(rev = 'HEAD') {
  return execFileSync('git', ['ls-tree', '-r', '-z', '--name-only', rev], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean);
}

/** The committed bytes of each path at `rev`, read in one `git cat-file --batch`. */
export function committedBlobs(paths, rev = 'HEAD') {
  const out = execFileSync('git', ['cat-file', '--batch'], {
    cwd: ROOT,
    input: paths.map((p) => `${rev}:${p}`).join('\n') + '\n',
    maxBuffer: 512 * 1024 * 1024,
  });
  const blobs = new Map();
  let at = 0;
  for (const p of paths) {
    const nl = out.indexOf(0x0a, at);
    const header = out.subarray(at, nl).toString('utf8');
    const m = /^[0-9a-f]+ blob (\d+)$/.exec(header);
    if (!m) throw new Error(`public-snapshot: ${rev}:${p} is not a committed blob (${header})`);
    const size = Number(m[1]);
    blobs.set(p, out.subarray(nl + 1, nl + 1 + size));
    at = nl + 1 + size + 1;
  }
  return blobs;
}

export function publicPaths(rev = 'HEAD') {
  return trackedFiles(rev).filter(isPublicPath).sort();
}

/**
 * The public paths of an upload's commit, for `--commit`: that commit's files classified by that
 * commit's own lists (`isPublicThen`), and apart, every path today's lists (`isPublicNow`) decide
 * differently, so the caller can refuse. The release list is the one file the copy takes from HEAD,
 * so it is not compared.
 */
export function releaseSnapshotPaths({ files, isPublicThen, isPublicNow }) {
  const paths = files.filter((p) => isPublicThen(p)).sort();
  const disagree = files.filter((p) => p !== RELEASES_PATH && Boolean(isPublicThen(p)) !== Boolean(isPublicNow(p))).sort();
  return { paths, disagree };
}

/**
 * Why a commit cannot be the public copy of an upload, or null when it can: it must already carry
 * the release list, and HEAD's list must record at least one upload built from it.
 */
export function releaseCommitProblem({ commit, files, releasesText }) {
  if (!files.includes(RELEASES_PATH)) {
    return `${commit.slice(0, 10)} predates ${RELEASES_PATH}; its copy would carry the checks from before there was an upload to compare with`;
  }
  if (!parseReleases(releasesText).some((r) => r.commit === commit)) {
    return `no upload in ${RELEASES_PATH} at HEAD was built from ${commit.slice(0, 10)}`;
  }
  return null;
}

/** This script and every script beside it that it imports, directly or through another. */
export const SNAPSHOT_MODULE_FILES = ['public-snapshot.mjs', 'reproducible-build.mjs', 'package.mjs', 'version-name.mjs'];

/** A commit's own copy of this script, loaded from git, for its lists, its filter and its scan. */
async function snapshotModuleAt(commit) {
  const dir = join(tmpdir(), `fw-public-snapshot-${commit.slice(0, 12)}`);
  mkdirSync(dir, { recursive: true });
  // Its own imports resolve beside it. An older commit has fewer of them; each is taken only if
  // that commit has it.
  const atCommit = new Set(trackedFiles(commit));
  for (const name of SNAPSHOT_MODULE_FILES) {
    if (!atCommit.has(`scripts/${name}`)) continue;
    writeFileSync(join(dir, name), execFileSync('git', ['show', `${commit}:scripts/${name}`], { cwd: ROOT }));
  }
  return import(pathToFileURL(join(dir, 'public-snapshot.mjs')).href);
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * The one hash for the source of a build. The release list gains its row only after the upload and
 * the snapshot's own files describe the snapshot, so none of them is in it: the digest of a commit
 * never changes after that commit.
 */
export const SOURCE_DIGEST_NAME = 'SOURCE-DIGEST';
const NOT_IN_THE_DIGEST = new Set([RELEASES_PATH, 'MANIFEST.txt', 'SOURCE-COMMIT', SOURCE_DIGEST_NAME, '.gitignore']);

/**
 * The public copy's own ignore file. This repository's .gitignore names its private folders and stays here; a
 * stranger who installs, builds and tests in the copy needs these lines so nothing they make looks like source
 * (cold audit 13 Oct 2026: node_modules, both builds, a build id and the per-machine dev secret sat untracked).
 */
const PUBLIC_GITIGNORE = [
  'node_modules/', 'dist/', 'dist-off/', 'dist-firefox/', 'dist-off-firefox/', 'coverage/', '.vitest/',
  'test-results/', 'playwright-report/', '/release/', '/public-snapshot/', '*.zip', '*.sha256.txt',
  '.fw-build-id', '.fw-dev-secret', '.env', '.env.*', '!.env.example',
  'worker/.dev.vars', 'worker/.dev.vars.*', '!worker/.dev.vars.example', 'worker/.wrangler/', '',
].join('\n');

const byteOrder = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** SHA-256 of the "<sha256>  <path>" lines, one per file, sorted by path in byte order. */
export function sourceDigestOf(entries) {
  const lines = entries
    .filter(([path]) => !NOT_IN_THE_DIGEST.has(path))
    .sort(([a], [b]) => byteOrder(a, b))
    .map(([path, hash]) => `${hash}  ${path}\n`)
    .join('');
  return sha256(Buffer.from(lines, 'utf8'));
}

/**
 * What installing, building or testing in an unpacked source folder adds to it; never part of the
 * source. Anything else added to the folder changes the digest, on purpose: it could change the build.
 */
const ADDED_BY_A_BUILD = /^(node_modules|dist|dist-off|release|public-snapshot|coverage|test-results|playwright-report|\.git)(\/|$)|^\.fw-/;

function filesUnder(folder, prefix = '') {
  const out = [];
  for (const entry of readdirSync(join(folder, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (ADDED_BY_A_BUILD.test(rel)) continue;
    if (entry.isDirectory()) out.push(...filesUnder(folder, rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

/** The digest of an unpacked source folder, read from its files on disk, with no git. */
export function folderSourceDigest(folder) {
  const files = filesUnder(folder).filter((p) => !NOT_IN_THE_DIGEST.has(p)).sort(byteOrder);
  return { digest: sourceDigestOf(files.map((p) => [p, sha256(readFileSync(join(folder, p)))])), files };
}

/** The snapshot as one zip, built by the store packager: same files, same Node, same bytes. */
export function archiveFolder(folder, outFile) {
  return packageExtension({ distDir: folder, outFile });
}

function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function scanPaths(paths, blobs, scanners = [scanContent]) {
  const hits = [];
  const seen = new Set();
  for (const p of paths) {
    const buf = blobs.get(p);
    if (isBinary(buf)) continue;
    for (const scan of scanners) {
      for (const h of scan(p, buf.toString('utf8'))) {
        const key = `${h.path}:${h.line}:${h.pattern}`;
        if (!seen.has(key)) hits.push(h);
        seen.add(key);
      }
    }
  }
  return hits;
}

async function main(argv) {
  // A stranger's check of an unpacked source archive: no git, only the files.
  const check = argv.indexOf('--check-digest');
  if (check >= 0) {
    const folder = resolve(String(argv[check + 1] ?? '.'));
    const { digest, files } = folderSourceDigest(folder);
    const statedFile = join(folder, SOURCE_DIGEST_NAME);
    const stated = existsSync(statedFile) ? readFileSync(statedFile, 'utf8').trim() : null;
    console.log(`source digest ${digest} over ${files.length} files`);
    if (stated === null) {
      console.log(`no ${SOURCE_DIGEST_NAME} file in the folder: compare the digest above with the one on page one of the export`);
      return 0;
    }
    if (stated !== digest) {
      console.error(`DIFFERENT: ${SOURCE_DIGEST_NAME} says ${stated}; these files are not the source it names`);
      return 3;
    }
    console.log(`MATCH: the files recompute to the ${SOURCE_DIGEST_NAME} they carry`);
    return 0;
  }
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const at = argv.indexOf('--commit');
  let commit = head;
  let paths = publicPaths();
  let filterPackageJson = publicPackageJson;
  let scanners = [scanContent];
  if (at >= 0) {
    const given = String(argv[at + 1] ?? '');
    if (!/^[0-9a-f]{7,40}$/i.test(given)) {
      console.error('public-snapshot: --commit needs a commit hash');
      return 1;
    }
    commit = execFileSync('git', ['rev-parse', '--verify', `${given}^{commit}`], { cwd: ROOT, encoding: 'utf8' }).trim();
    const files = trackedFiles(commit);
    if (!trackedFiles(head).includes(RELEASES_PATH)) {
      console.error(`public-snapshot: HEAD does not carry ${RELEASES_PATH}, so no upload is recorded to take a copy of; nothing written`);
      return 1;
    }
    const releasesText = committedBlobs([RELEASES_PATH], head).get(RELEASES_PATH).toString('utf8');
    const problem = releaseCommitProblem({ commit, files, releasesText });
    if (problem) {
      console.error(`public-snapshot: ${problem}; nothing written`);
      return 1;
    }
    const then = await snapshotModuleAt(commit);
    const split = releaseSnapshotPaths({ files, isPublicThen: then.isPublicPath, isPublicNow: isPublicPath });
    if (split.disagree.length) {
      console.error(`public-snapshot: ${split.disagree.length} path(s) the lists at ${commit.slice(0, 10)} and at HEAD classify differently; nothing written`);
      for (const p of split.disagree.slice(0, 40)) console.error(`  ${p}  ${then.isPublicPath(p) ? 'public then, private now' : 'private then, public now'}`);
      return 1;
    }
    paths = split.paths;
    filterPackageJson = then.publicPackageJson;
    scanners = [scanContent, then.scanContent];
  }
  if (argv.includes('--list')) {
    for (const p of paths) console.log(p);
    return 0;
  }
  const blobs = committedBlobs(paths, commit);
  const writtenBytes = (p) => (p === 'package.json' ? filterPackageJson(blobs.get(p)) : blobs.get(p));
  if (argv.includes('--digest')) {
    console.log(sourceDigestOf(paths.map((p) => [p, sha256(writtenBytes(p))])));
    return 0;
  }
  // An upload's copy carries today's release list, which holds the row for that upload.
  if (commit !== head) blobs.set(RELEASES_PATH, committedBlobs([RELEASES_PATH], head).get(RELEASES_PATH));
  const hits = scanPaths(paths, blobs, scanners);
  if (hits.length) {
    console.error(`public-snapshot: ${hits.length} scan hit(s); nothing written`);
    for (const h of hits) console.error(`  ${h.path}:${h.line}  ${h.pattern}`);
    return 2;
  }
  if (argv.includes('--scan')) {
    console.log(`public-snapshot: ${paths.length} public paths, scan clean`);
    return 0;
  }
  // The snapshot is exactly a commit: uncommitted work is never in it, whatever the working tree
  // holds. One file is written differently, and only by removing lines: package.json loses the
  // scripts that point at private folders (publicPackageJson). An upload's copy takes the release
  // list from HEAD, and MANIFEST.txt says so. MANIFEST.txt hashes what is written.
  const out = join(ROOT, SNAPSHOT_DIR);
  if (existsSync(join(out, '.git'))) {
    console.error(`public-snapshot: ${SNAPSHOT_DIR}/ holds a git repository, and this run empties the folder; keep the public repository elsewhere and copy the snapshot into it`);
    return 1;
  }
  if (existsSync(out)) rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const manifest = [`source-commit ${commit}`, ...(commit === head ? [] : [`release-list-from ${head}`]), `files ${paths.length}`, ''];
  const entries = [];
  for (const p of paths) {
    const dst = join(out, p);
    mkdirSync(dirname(dst), { recursive: true });
    const bytes = writtenBytes(p);
    writeFileSync(dst, bytes);
    manifest.push(`${sha256(bytes)}  ${p}`);
    entries.push([p, sha256(bytes)]);
  }
  writeFileSync(join(out, 'MANIFEST.txt'), manifest.join('\n') + '\n');
  // The build id is derived from a commit, and the public repository's own commit is a new one: the
  // snapshot names the commit it came from so scripts/reproducible-build.mjs builds the same bytes.
  writeFileSync(join(out, 'SOURCE-COMMIT'), `${commit}\n`);
  writeFileSync(join(out, '.gitignore'), PUBLIC_GITIGNORE);
  const digest = sourceDigestOf(entries);
  writeFileSync(join(out, SOURCE_DIGEST_NAME), `${digest}\n`);
  console.log(`public-snapshot: ${paths.length} files written to ${SNAPSHOT_DIR}/ from ${commit.slice(0, 7)}; scan clean`);
  console.log(`public-snapshot: source digest ${digest}`);
  const at2 = argv.indexOf('--archive');
  if (at2 >= 0) {
    const zip = resolve(String(argv[at2 + 1] ?? ''));
    if (!argv[at2 + 1]) {
      console.error('public-snapshot: --archive needs a file name');
      return 1;
    }
    const packed = archiveFolder(out, zip);
    console.log(`public-snapshot: archive ${packed.outFile} (${packed.fileCount} files) sha256 ${sha256(readFileSync(packed.outFile))}`);
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
