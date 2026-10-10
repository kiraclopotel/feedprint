/**
 * Pull the records out of one or more FeelingWise HTML exports into per-epoch
 * salvage files, deduplicated by integrityHash, ready for
 * scripts/salvage-verify.ts and for the dashboard's "recover from an export"
 * import (Export tab).
 *
 * Why: the owner's 2026-09-02 "everything" exports (94 MB and 169 MB) hold
 * ten epochs and three months of records; the larger one cuts off when
 * opened in a browser. The HTML embeds the payload as plaintext JSON in
 * <script type="application/json" id="fw-export-data">, with every `<`
 * escaped as <, so the file is readable without a browser.
 *
 * Read-only on the inputs. Writes epoch-<fingerprint>.json, INDEX.json and
 * REPORT.md into --out. Records already present in --prior (an earlier
 * salvage folder) are counted, not dropped: each epoch file is complete on
 * its own, and the salvage store imports by id, so importing a record twice
 * is a no-op there. Public keys come from the export's own key when the
 * epoch is the export's active one, else from the prior folder's epoch file
 * of the same fingerprint.
 *
 * These files are private data (CLAUDE.md data rule): past-forensics/ is
 * gitignored and nothing here leaves the machine.
 *
 * Run: NODE_OPTIONS=--max-old-space-size=8192 npx tsx scripts/salvage-extract.ts
 *        --out past-forensics/salvage-2026-09-03 --prior past-forensics/salvage-2026-09-01
 *        <export.html> [<export.html> ...]
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { ForensicRecord } from '../src/types/forensic';

interface EpochFile {
  publicKeyFingerprint: string;
  publicKeyJwk: JsonWebKey | null;
  recoveredFrom: string[];
  conflictingIds: string[];
  records: ForensicRecord[];
}

interface Args { out: string; prior: string | null; keys: string | null; inputs: string[] }

function parseArgs(argv: string[]): Args {
  const args: Args = { out: '', prior: null, keys: null, inputs: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--prior') args.prior = argv[++i];
    else if (argv[i] === '--keys') args.keys = argv[++i];
    else args.inputs.push(argv[i]);
  }
  if (!args.out || args.inputs.length === 0) {
    console.error('usage: salvage-extract.ts --out <dir> [--prior <dir>] [--keys <keys.json>] <export.html> ...');
    process.exit(2);
  }
  return args;
}

/** Epoch keys swept from every export on disk by scripts/salvage-keys.ts. */
function loadKeys(path: string | null, into: Map<string, JsonWebKey>): void {
  if (!path || !existsSync(path)) return;
  for (const k of JSON.parse(readFileSync(path, 'utf8')) as { fingerprint: string; jwk: JsonWebKey }[]) {
    if (!into.has(k.fingerprint)) into.set(k.fingerprint, k.jwk);
  }
}

const MARKER = '<script type="application/json" id="fw-export-data">';

function readPayload(path: string): { records: ForensicRecord[]; publicKeyJwk: JsonWebKey | null; publicKeyFingerprint: string; bytes: number } {
  const buf = readFileSync(path);
  const start = buf.indexOf(MARKER);
  if (start < 0) throw new Error(`${basename(path)}: no fw-export-data block`);
  const from = start + MARKER.length;
  const end = buf.indexOf('</script>', from);
  if (end < 0) throw new Error(`${basename(path)}: unterminated fw-export-data block`);
  const text = buf.subarray(from, end).toString('utf8');
  const payload = JSON.parse(text) as { records?: ForensicRecord[]; publicKeyJwk?: JsonWebKey; publicKeyFingerprint?: string };
  return {
    records: payload.records ?? [],
    publicKeyJwk: payload.publicKeyJwk ?? null,
    publicKeyFingerprint: payload.publicKeyFingerprint ?? '',
    bytes: buf.length,
  };
}

function loadPrior(dir: string | null): { hashes: Set<string>; keys: Map<string, JsonWebKey> } {
  const hashes = new Set<string>();
  const keys = new Map<string, JsonWebKey>();
  if (!dir || !existsSync(dir)) return { hashes, keys };
  for (const f of readdirSync(dir)) {
    if (!f.startsWith('epoch-') || !f.endsWith('.json')) continue;
    const epoch = JSON.parse(readFileSync(join(dir, f), 'utf8')) as EpochFile;
    if (epoch.publicKeyJwk && Object.keys(epoch.publicKeyJwk).length > 0) keys.set(epoch.publicKeyFingerprint, epoch.publicKeyJwk);
    for (const r of epoch.records) if (r.integrityHash) hashes.add(r.integrityHash);
  }
  return { hashes, keys };
}

interface EpochStats {
  fingerprint: string;
  seen: number;
  unique: number;
  duplicateHash: number;
  conflictingIds: number;
  inPrior: number;
  newVsPrior: number;
  earliest: string;
  latest: string;
  files: Set<string>;
  keyFrom: 'export' | 'prior' | 'none';
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(args.out, { recursive: true });
  const prior = loadPrior(args.prior);
  loadKeys(args.keys, prior.keys);
  console.log(`prior: ${prior.hashes.size} record hashes from ${args.prior ?? '(none)'}; ${prior.keys.size} epoch keys (prior folder + ${args.keys ?? 'no keys file'})`);

  const byEpoch = new Map<string, EpochFile>();
  const stats = new Map<string, EpochStats>();
  const seenHash = new Map<string, string>(); // integrityHash -> id
  const seenId = new Map<string, string>();   // id -> integrityHash
  const exportKeys = new Map<string, JsonWebKey>();

  for (const path of args.inputs) {
    const name = basename(path);
    const t0 = Date.now();
    const payload = readPayload(path);
    console.log(`${name}: ${(payload.bytes / 1e6).toFixed(1)} MB, ${payload.records.length} records, active epoch ${payload.publicKeyFingerprint} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    if (payload.publicKeyJwk && payload.publicKeyFingerprint) exportKeys.set(payload.publicKeyFingerprint, payload.publicKeyJwk);

    for (const r of payload.records) {
      const fp = r.publicKeyFingerprint || payload.publicKeyFingerprint || 'unknown';
      let s = stats.get(fp);
      if (!s) {
        s = { fingerprint: fp, seen: 0, unique: 0, duplicateHash: 0, conflictingIds: 0, inPrior: 0, newVsPrior: 0, earliest: '', latest: '', files: new Set(), keyFrom: 'none' };
        stats.set(fp, s);
      }
      s.seen++;
      s.files.add(name);
      const hash = r.integrityHash ?? '';
      if (hash && seenHash.has(hash)) { s.duplicateHash++; continue; }
      const prevHash = seenId.get(r.id);
      let epoch = byEpoch.get(fp);
      if (!epoch) {
        epoch = { publicKeyFingerprint: fp, publicKeyJwk: null, recoveredFrom: [], conflictingIds: [], records: [] };
        byEpoch.set(fp, epoch);
      }
      if (prevHash !== undefined && prevHash !== hash) {
        // Same id, different content: keep both (they are different records
        // to the hash) and name the id so a reader can look.
        s.conflictingIds++;
        if (!epoch.conflictingIds.includes(r.id)) epoch.conflictingIds.push(r.id);
      }
      if (hash) seenHash.set(hash, r.id);
      seenId.set(r.id, hash);
      epoch.records.push(r);
      if (!epoch.recoveredFrom.includes(name)) epoch.recoveredFrom.push(name);
      s.unique++;
      if (hash && prior.hashes.has(hash)) s.inPrior++; else s.newVsPrior++;
      if (r.timestamp) {
        if (!s.earliest || r.timestamp < s.earliest) s.earliest = r.timestamp;
        if (!s.latest || r.timestamp > s.latest) s.latest = r.timestamp;
      }
    }
  }

  const index: { fingerprint: string; records: number; conflicts: number; sourceFiles: number; file: string; bytes: number }[] = [];
  const lines: string[] = [
    '# Salvage extraction report',
    '',
    `Inputs: ${args.inputs.map((p) => basename(p)).join(', ')}`,
    `Prior salvage: ${args.prior ?? '(none)'}`,
    '',
    '| epoch | seen | unique | dup hash | id conflicts | already in prior | new | earliest | latest | key |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  const order = [...byEpoch.values()].sort((a, b) => b.records.length - a.records.length);
  for (const epoch of order) {
    const s = stats.get(epoch.publicKeyFingerprint)!;
    epoch.records.sort((a, b) => (a.chainPosition ?? 0) - (b.chainPosition ?? 0) || String(a.timestamp).localeCompare(String(b.timestamp)));
    const key = exportKeys.get(epoch.publicKeyFingerprint) ?? prior.keys.get(epoch.publicKeyFingerprint) ?? null;
    epoch.publicKeyJwk = key;
    s.keyFrom = exportKeys.has(epoch.publicKeyFingerprint) ? 'export' : key ? 'prior' : 'none';
    const file = `epoch-${epoch.publicKeyFingerprint}.json`;
    const json = JSON.stringify(epoch);
    writeFileSync(join(args.out, file), json, 'utf8');
    index.push({ fingerprint: epoch.publicKeyFingerprint, records: epoch.records.length, conflicts: epoch.conflictingIds.length, sourceFiles: epoch.recoveredFrom.length, file, bytes: Buffer.byteLength(json) });
    lines.push(`| ${s.fingerprint} | ${s.seen} | ${s.unique} | ${s.duplicateHash} | ${s.conflictingIds} | ${s.inPrior} | ${s.newVsPrior} | ${s.earliest.slice(0, 10)} | ${s.latest.slice(0, 10)} | ${s.keyFrom} |`);
    console.log(`${s.fingerprint}  seen ${String(s.seen).padStart(6)}  unique ${String(s.unique).padStart(6)}  dup ${String(s.duplicateHash).padStart(6)}  conflicts ${s.conflictingIds}  in prior ${String(s.inPrior).padStart(6)}  new ${String(s.newVsPrior).padStart(6)}  ${s.earliest.slice(0, 10)}..${s.latest.slice(0, 10)}  key:${s.keyFrom}`);
  }
  const totals = [...stats.values()].reduce((a, s) => ({ seen: a.seen + s.seen, unique: a.unique + s.unique, inPrior: a.inPrior + s.inPrior, fresh: a.fresh + s.newVsPrior }), { seen: 0, unique: 0, inPrior: 0, fresh: 0 });
  lines.push('', `Total: ${totals.seen} records seen, ${totals.unique} unique by hash, ${totals.inPrior} already in the prior salvage, ${totals.fresh} new.`);
  lines.push('', 'Verification (hash + signature) is scripts/salvage-verify.ts --dir <this folder>; its VERIFICATION.json lands here.');
  writeFileSync(join(args.out, 'INDEX.json'), JSON.stringify(index, null, 1), 'utf8');
  writeFileSync(join(args.out, 'REPORT.md'), lines.join('\n') + '\n', 'utf8');
  console.log(`\nTOTAL seen ${totals.seen}, unique ${totals.unique}, in prior ${totals.inPrior}, new ${totals.fresh}; files in ${args.out}`);
}

main();
