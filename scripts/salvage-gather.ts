/**
 * Sweep this computer for every FeelingWise chain file and gather them into
 * one folder the dashboard's recovery picker can take whole.
 *
 * Why: exported records end up spread around a disk, and picking them one
 * file at a time misses some. This gathers every one it finds into a folder
 * that can be loaded whole.
 *
 * What it does, read-only on every input:
 *   1. Walks the roots given (or reads a prepared list of paths) and keeps
 *      every .json / .html file whose CONTENT is a chain source: an HTML
 *      export (the fw-export-data payload), a JSON export or epoch file
 *      (records carrying integrityHash), a keys list ({fingerprint, jwk}),
 *      or a sealed backup envelope (listed and copied, not readable here).
 *      Names are only a hint for the walk; the content decides.
 *   2. Copies each distinct source (by SHA-256 of the bytes) into
 *      <out>/sources/, so the originals are never touched and one folder
 *      holds everything that was found.
 *   3. Writes <out>/load-this/: one epoch-<fingerprint>.json per signing key
 *      with every record deduplicated by integrityHash across ALL sources,
 *      the epoch's public key when any source carried it, plus keys.json.
 *      This is the folder to pick in the dashboard ("Choose a folder"): it
 *      is small, complete, and carries the keys the export needs to verify
 *      signatures. The big HTML exports stay in sources/ because a browser
 *      cannot parse a 169 MB file in the dashboard page.
 *   4. Writes <out>/REPORT.md and <out>/INDEX.json.
 *
 * These files are private data (CLAUDE.md data rule): past-forensics/ is
 * gitignored and nothing here leaves the machine.
 *
 * Run: NODE_OPTIONS=--max-old-space-size=8192 npx tsx scripts/salvage-gather.ts
 *        --out past-forensics/gathered-2026-09-03 [--list <paths.txt>] [<root> ...]
 *      Paths in --list are one per line (a tab and anything after it is ignored).
 */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { ForensicRecord } from '../src/types/forensic';

interface Args { out: string; list: string | null; roots: string[] }

function parseArgs(argv: string[]): Args {
  const args: Args = { out: '', list: null, roots: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--list') args.list = argv[++i];
    else args.roots.push(argv[i]);
  }
  if (!args.out || (args.roots.length === 0 && !args.list)) {
    console.error('usage: salvage-gather.ts --out <dir> [--list <paths.txt>] [<root> ...]');
    process.exit(2);
  }
  return args;
}

// Folders that cannot hold a chain file worth reading: build output, package
// trees, the OS, browser profiles (the live chain is IndexedDB, not a file).
const SKIP_DIR = /^(node_modules|\.git|dist|dist-off|\$Recycle\.Bin|Windows|Program Files|Program Files \(x86\)|System Volume Information|\.verify|\.cache|__pycache__|Google|Microsoft|Packages)$/i;
const EXT = /^\.(json|html?)$/i;
const MAX_BYTES = 1_500_000_000;

function walk(root: string, into: string[]): void {
  let entries: import('node:fs').Dirent[];
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(root, e.name);
    if (e.isDirectory()) { if (!SKIP_DIR.test(e.name)) walk(p, into); continue; }
    if (e.isFile() && EXT.test(extname(e.name))) into.push(p);
  }
}

type Kind = 'html-export' | 'json-records' | 'keys-list' | 'sealed-backup';

interface Source {
  path: string;
  bytes: number;
  sha: string;
  kind: Kind;
  records: ForensicRecord[];
  keys: { fingerprint: string; jwk: JsonWebKey }[];
  activeFingerprint: string;
  note: string;
}

const HTML_MARKER = 'id="fw-export-data"';

function isRecord(v: unknown): v is ForensicRecord {
  return !!v && typeof v === 'object' && typeof (v as ForensicRecord).integrityHash === 'string' && typeof (v as ForensicRecord).id === 'string';
}
function isJwk(v: unknown): v is JsonWebKey {
  const j = v as Record<string, unknown> | null;
  return !!j && typeof j === 'object' && j.kty === 'EC' && typeof j.x === 'string' && typeof j.y === 'string';
}
function fingerprintOf(jwk: JsonWebKey): string {
  return createHash('sha256').update(`${jwk.x ?? ''}|${jwk.y ?? ''}`).digest('hex').slice(0, 16);
}

/** The chain content of one parsed JSON value, whatever file shape held it. */
function readJson(parsed: unknown): Pick<Source, 'kind' | 'records' | 'keys' | 'activeFingerprint' | 'note'> | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const keys: Source['keys'] = [];
  const takeKey = (jwk: unknown): void => { if (isJwk(jwk)) keys.push({ fingerprint: fingerprintOf(jwk), jwk }); };
  if (Array.isArray(parsed)) {
    const records = parsed.filter(isRecord);
    if (records.length > 0) return { kind: 'json-records', records, keys, activeFingerprint: '', note: '' };
    for (const e of parsed) if (e && typeof e === 'object' && 'jwk' in e) takeKey((e as { jwk: unknown }).jwk);
    return keys.length > 0 ? { kind: 'keys-list', records: [], keys, activeFingerprint: '', note: '' } : null;
  }
  const o = parsed as Record<string, unknown>;
  if (typeof o.fwSealedBackup === 'number' && typeof o.ciphertext === 'string') {
    return { kind: 'sealed-backup', records: [], keys, activeFingerprint: '', note: `sealed with ${String(o.keySource)}; opens only through Restore` };
  }
  takeKey(o.publicKeyJwk);
  for (const list of [o.publicKeys, o.keys]) {
    if (Array.isArray(list)) for (const e of list) if (e && typeof e === 'object' && 'jwk' in e) takeKey((e as { jwk: unknown }).jwk);
  }
  const records = Array.isArray(o.records) ? o.records.filter(isRecord) : [];
  if (records.length === 0 && keys.length === 0) return null;
  return {
    kind: records.length > 0 ? 'json-records' : 'keys-list',
    records,
    keys,
    activeFingerprint: typeof o.publicKeyFingerprint === 'string' ? o.publicKeyFingerprint : (keys[0]?.fingerprint ?? ''),
    note: '',
  };
}

function readSource(path: string): Source | null {
  const stat = statSync(path);
  if (stat.size === 0 || stat.size > MAX_BYTES) return null;
  const buf = readFileSync(path);
  const sha = createHash('sha256').update(buf).digest('hex');
  const base = { path, bytes: stat.size, sha };
  if (/^\.html?$/i.test(extname(path))) {
    const at = buf.indexOf(HTML_MARKER);
    if (at < 0) return null;
    const from = buf.indexOf('>', at) + 1;
    const end = buf.indexOf('</script>', from);
    if (end < 0) return null;
    let parsed: unknown;
    try { parsed = JSON.parse(buf.subarray(from, end).toString('utf8')); } catch { return null; }
    const content = readJson(parsed);
    return content ? { ...base, ...content, kind: 'html-export' } : null;
  }
  // Cheap gate before parsing: a chain file names these fields.
  const head = buf.subarray(0, Math.min(buf.length, 4096)).toString('utf8');
  if (!/integrityHash|publicKeyJwk|fwSealedBackup|"jwk"/.test(head) && buf.indexOf('integrityHash') < 0) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(buf.toString('utf8')); } catch { return null; }
  const content = readJson(parsed);
  return content ? { ...base, ...content } : null;
}

interface EpochFile {
  publicKeyFingerprint: string;
  publicKeyJwk: JsonWebKey | null;
  recoveredFrom: string[];
  conflictingIds: string[];
  records: ForensicRecord[];
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  const candidates: string[] = [];
  if (args.list) {
    // One path per line; a tab (or a literal PowerShell `t) and anything
    // after it is ignored, and a BOM on the first line is stripped.
    for (const line of readFileSync(args.list, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
      const p = line.split(/\t|`t/)[0].trim();
      if (p && EXT.test(extname(p)) && existsSync(p)) candidates.push(p);
    }
  }
  for (const root of args.roots) walk(root, candidates);
  console.log(`${candidates.length} candidate files (${((Date.now() - t0) / 1000).toFixed(0)} s)`);

  const sourcesDir = join(args.out, 'sources');
  const loadDir = join(args.out, 'load-this');
  mkdirSync(sourcesDir, { recursive: true });
  mkdirSync(loadDir, { recursive: true });

  const bySha = new Map<string, Source>();
  const duplicates = new Map<string, string[]>();
  let read = 0;
  for (const path of candidates) {
    let src: Source | null;
    try { src = readSource(path); } catch (err) { console.warn(`${path}: ${err instanceof Error ? err.message : String(err)}`); continue; }
    if (!src) continue;
    read++;
    const first = bySha.get(src.sha);
    if (first) { duplicates.set(src.sha, [...(duplicates.get(src.sha) ?? []), path]); continue; }
    bySha.set(src.sha, src);
    const target = join(sourcesDir, `${src.sha.slice(0, 8)}-${basename(path)}`);
    if (!existsSync(target)) copyFileSync(path, target);
    console.log(`${src.kind.padEnd(14)} ${String(src.records.length).padStart(7)} records  ${(src.bytes / 1e6).toFixed(1).padStart(7)} MB  ${path}`);
  }

  // One epoch file per signing key, every record once by hash.
  const byEpoch = new Map<string, EpochFile>();
  const seenHash = new Set<string>();
  const seenId = new Map<string, string>();
  const keys = new Map<string, JsonWebKey>();
  let seen = 0;
  for (const src of bySha.values()) {
    for (const k of src.keys) if (!keys.has(k.fingerprint)) keys.set(k.fingerprint, k.jwk);
    for (const r of src.records) {
      seen++;
      if (seenHash.has(r.integrityHash)) continue;
      seenHash.add(r.integrityHash);
      const fp = r.publicKeyFingerprint || src.activeFingerprint || 'unknown';
      let epoch = byEpoch.get(fp);
      if (!epoch) { epoch = { publicKeyFingerprint: fp, publicKeyJwk: null, recoveredFrom: [], conflictingIds: [], records: [] }; byEpoch.set(fp, epoch); }
      const prev = seenId.get(r.id);
      if (prev !== undefined && prev !== r.integrityHash && !epoch.conflictingIds.includes(r.id)) epoch.conflictingIds.push(r.id);
      seenId.set(r.id, r.integrityHash);
      epoch.records.push(r);
      const name = basename(src.path);
      if (!epoch.recoveredFrom.includes(name)) epoch.recoveredFrom.push(name);
    }
  }
  const index: { fingerprint: string; records: number; key: boolean; file: string }[] = [];
  const epochs = [...byEpoch.values()].sort((a, b) => b.records.length - a.records.length);
  for (const epoch of epochs) {
    epoch.records.sort((a, b) => (a.chainPosition ?? 0) - (b.chainPosition ?? 0) || String(a.timestamp).localeCompare(String(b.timestamp)));
    epoch.publicKeyJwk = keys.get(epoch.publicKeyFingerprint) ?? null;
    const file = `epoch-${epoch.publicKeyFingerprint}.json`;
    writeFileSync(join(loadDir, file), JSON.stringify(epoch), 'utf8');
    index.push({ fingerprint: epoch.publicKeyFingerprint, records: epoch.records.length, key: epoch.publicKeyJwk !== null, file });
  }
  writeFileSync(join(loadDir, 'keys.json'), JSON.stringify([...keys].map(([fingerprint, jwk]) => ({ fingerprint, jwk })), null, 1), 'utf8');
  writeFileSync(join(args.out, 'INDEX.json'), JSON.stringify(index, null, 1), 'utf8');

  const withKey = index.filter(e => e.key);
  const lines = [
    '# Gathered chain files',
    '',
    `Swept ${candidates.length} candidate files; ${read} are chain files; ${bySha.size} distinct by content (${[...duplicates.values()].reduce((n, l) => n + l.length, 0)} exact copies skipped).`,
    `Records: ${seen} seen, ${seenHash.size} unique by hash, in ${epochs.length} signing keys; ${keys.size} public keys found (${withKey.reduce((n, e) => n + e.records, 0)} records under a key, ${seenHash.size - withKey.reduce((n, e) => n + e.records, 0)} hash-only).`,
    '',
    'Load `load-this/` in the dashboard (Export tab, "Choose a folder"). `sources/` holds one copy of every distinct file found, untouched.',
    '',
    '## Sources',
    '',
    '| kind | records | keys | MB | path | note |',
    '|---|---|---|---|---|---|',
    ...[...bySha.values()].sort((a, b) => b.records.length - a.records.length).map(s =>
      `| ${s.kind} | ${s.records.length} | ${s.keys.length} | ${(s.bytes / 1e6).toFixed(1)} | ${s.path} | ${s.note}${duplicates.has(s.sha) ? ` (+${duplicates.get(s.sha)!.length} identical copies)` : ''} |`),
    '',
    '## Epochs in load-this/',
    '',
    '| key | records | public key |',
    '|---|---|---|',
    ...index.map(e => `| ${e.fingerprint} | ${e.records} | ${e.key ? 'yes' : 'no, hash-only'} |`),
    '',
    'Verification (hash + signature): `npx tsx scripts/salvage-verify.ts --dir <out>/load-this`.',
  ];
  writeFileSync(join(args.out, 'REPORT.md'), lines.join('\n') + '\n', 'utf8');
  console.log(`\n${lines[2]}\n${lines[3]}\nfolder: ${args.out}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}

main();
