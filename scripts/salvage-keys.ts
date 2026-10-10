/**
 * Sweep every FeelingWise HTML export under the given folders for the public
 * key it embeds (fingerprint + JWK) and write them to one keys file, so a
 * salvage folder can carry the key of an epoch whose only complete-chain
 * export sits in some other folder on disk.
 *
 * Read-only on the inputs. Each export's key sits at the tail of the
 * fw-export-data JSON, after the records, so only the last 4 KB of each
 * block is parsed; a 169 MB file costs one read of its tail.
 *
 * Run: npx tsx scripts/salvage-keys.ts --out past-forensics/keys.json <dir> [<dir> ...]
 */

import { readdirSync, statSync, openSync, readSync, closeSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';

interface KeyEntry { fingerprint: string; jwk: JsonWebKey; from: string[] }

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (/\.html?$/i.test(name)) out.push(p);
  }
}

/** The tail of the fw-export-data block: up to `tailBytes` before "</script>". */
function keyFromExport(path: string): { fingerprint: string; jwk: JsonWebKey } | null {
  const size = statSync(path).size;
  const fd = openSync(path, 'r');
  try {
    // The block is followed by a handful of <script> tags (~1 MB of embedded
    // libraries); scan the last 3 MB for the block end, then read its tail.
    const span = Math.min(size, 3 * 1024 * 1024);
    const buf = Buffer.alloc(span);
    readSync(fd, buf, 0, span, size - span);
    const text = buf.toString('utf8');
    const endMarker = '</script>\n<script>window.__FW_EXPORT__';
    const end = text.indexOf(endMarker);
    if (end < 0) return null;
    // Payload order is records, publicKeyJwk, publicKeyFingerprint, i18n,
    // anchors, locale, techLabels: the key sits before the i18n strings and
    // the time-stamp tokens, which together can run to a megabyte, so the
    // whole window is searched, not a fixed tail.
    const block = text.slice(0, end);
    const jwkAt = block.lastIndexOf('"publicKeyJwk":{');
    if (jwkAt < 0) return null;
    const jwkStart = jwkAt + '"publicKeyJwk":'.length;
    const jwkEnd = block.indexOf('}', jwkStart);
    if (jwkEnd < 0) return null;
    const jwk = JSON.parse(block.slice(jwkStart, jwkEnd + 1).replace(/\\u003c/g, '<')) as JsonWebKey;
    if (!jwk.x || !jwk.y) return null;
    // Exports before the fingerprint field carry only the key; the
    // fingerprint is derived the way signing.ts and the export verifier do:
    // first 16 hex of SHA-256 over "x|y".
    const derived = createHash('sha256').update(`${jwk.x}|${jwk.y}`).digest('hex').slice(0, 16);
    const declared = block.slice(jwkEnd, jwkEnd + 200).match(/"publicKeyFingerprint":"([0-9a-f]{16})"/)?.[1];
    if (declared && declared !== derived) return null;
    return { fingerprint: derived, jwk };
  } finally {
    closeSync(fd);
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  const outAt = argv.indexOf('--out');
  const out = outAt >= 0 ? argv[outAt + 1] : '';
  const dirs = argv.filter((a, i) => a !== '--out' && i !== outAt + 1);
  if (!out || dirs.length === 0) {
    console.error('usage: salvage-keys.ts --out <keys.json> <dir> ...');
    process.exit(2);
  }
  const keys = new Map<string, KeyEntry>();
  if (existsSync(out)) {
    for (const k of JSON.parse(readFileSync(out, 'utf8')) as KeyEntry[]) keys.set(k.fingerprint, k);
  }
  const files: string[] = [];
  for (const d of dirs) walk(d, files);
  let read = 0;
  for (const f of files) {
    let k: { fingerprint: string; jwk: JsonWebKey } | null = null;
    try { k = keyFromExport(f); } catch { k = null; }
    if (!k) continue;
    read++;
    const entry = keys.get(k.fingerprint) ?? { fingerprint: k.fingerprint, jwk: k.jwk, from: [] };
    if (!entry.from.includes(basename(f))) entry.from.push(basename(f));
    keys.set(k.fingerprint, entry);
  }
  const list = [...keys.values()].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
  writeFileSync(out, JSON.stringify(list, null, 1), 'utf8');
  console.log(`${files.length} exports scanned, ${read} carried a key, ${list.length} distinct epoch keys in ${out}`);
  for (const k of list) console.log(`  ${k.fingerprint}  from ${k.from.length} export(s)`);
}

main();
