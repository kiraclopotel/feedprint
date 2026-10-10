#!/usr/bin/env node
// pool.mjs: several people's exports as one dataset, with every record still checkable.
//
// Copyright 2026 FeelingWise. Licensed under the Apache License, Version 2.0;
// see the LICENSE file beside this one.
//
// Usage:  node pool.mjs <export...> --out <pool.json>     build a pool
//         node pool.mjs --check <pool.json>               check every record in a pool again
// Exit:   0 done and every record checked, 1 done with records that could only be
//         checked by hash, 2 a file or a record failed, 3 a file was unreadable.
//
// WHY A POOL KEEPS THE RECORDS AS THEY WERE SIGNED. A panel's data is worth what a
// stranger can check of it. A spreadsheet of four people's feeds is a document
// anyone could have typed; a pool is the same rows with each record left byte for
// byte as its recorder signed it, and the recorder's public key beside it, so
// `--check` (or any second implementation of FORMAT.md) can recompute every hash
// and verify every signature without the original files. Nothing in a record is
// rewritten, merged or cleaned: what the pool adds sits beside the record.
//
// THREE KINDS OF "THE SAME POST", told apart because a panel that cannot tell them
// apart counts one thing three times:
//   - the same signed record in two files (one person exported twice, or two
//     overlapping exports): kept once, with every file that held it listed;
//   - the same text recorded twice by one recorder (a post shown again on a later
//     day): two records, counted as repeat sightings by one recorder;
//   - the same text recorded by different recorders: two records, counted as a
//     sighting by each. Only this kind is agreement between people.
// "The same text" is the content identity of FORMAT.md section 9, and only for
// records whose caption was captured whole, as corroborate.mjs does.
//
// WHO IS ONE RECORDER. Files are grouped by signing key, and keys a file carries
// together (a key and the earlier keys it rotated from) are one recorder. Two
// files that cannot be shown to come from different installs are never counted
// as two people. The converse does not hold: two installs are two recorders even
// if one person runs both, and nothing in a file can tell.
//
// WHAT A POOL DOES NOT CLAIM. That a record verifies means its content is what its
// key signed. It does not date the sighting beyond what the file's time stamps
// show, does not say who held the key, and does not make the panel complete:
// a person who left a day out of their export left it out of the pool too.

import { readFileSync, writeFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseExport, verifyExportText, createVerifier, provenanceDocument } from './verify-export.mjs';
import { comparability, contentIdentity, normaliseForIdentity } from './corroborate.mjs';

const crypto = globalThis.crypto ?? webcrypto;

export const POOL_FORMAT = 'feed-observation-pool/1.0';
export const RECORD_FORMAT = 'feed-observation-record/1.0';
const CONTENT_IDENTITY_RULE = 'fw-ci-1';

async function sha256Hex(textOrBytes) {
  const bytes = typeof textOrBytes === 'string' ? new TextEncoder().encode(textOrBytes) : textOrBytes;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// What the volunteer typed in "Your name on the file", so a group can tell which recorder is which code. Where the
// file carries its signed first page, the checker fails a file whose name disagrees with it (FORMAT.md section 1,
// `profile`), and a failed file never reaches the pool. It says what was typed, never who typed it.
function nameOnFile(data) {
  const name = data && data.profile && typeof data.profile.name === 'string' ? data.profile.name.replace(/\s+/g, ' ').trim() : '';
  return name || null;
}

/** Union-find over key fingerprints: keys that appear in one file belong to one recorder. */
function recorderGroups() {
  const parent = new Map();
  const find = (k) => {
    if (!parent.has(k)) parent.set(k, k);
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r);
    parent.set(k, r);
    return r;
  };
  const join = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    // The smaller fingerprint names the group, so the name does not depend on file order.
    if (ra !== rb) { if (ra < rb) parent.set(rb, ra); else parent.set(ra, rb); }
  };
  return { find, join };
}

function keysOf(data) {
  const fps = new Set();
  if (typeof data.publicKeyFingerprint === 'string' && data.publicKeyFingerprint) fps.add(data.publicKeyFingerprint);
  for (const k of data.publicKeys || []) if (k && typeof k.fingerprint === 'string') fps.add(k.fingerprint);
  for (const r of data.records) if (r && typeof r.publicKeyFingerprint === 'string' && r.publicKeyFingerprint) fps.add(r.publicKeyFingerprint);
  return [...fps];
}

/** The identity a record contributes, or null when its text may not be compared. */
async function identityOf(record) {
  if (comparability(record) !== 'comparable') return null;
  const raw = typeof record.originalText === 'string' ? record.originalText : '';
  if (raw.startsWith('[blocked:') || normaliseForIdentity(raw) === '') return null;
  return contentIdentity(raw);
}

/**
 * Builds a pool from export texts. Each input is { label, text, bytes? }; give the bytes as read from disk, because
 * the SHA-256 a volunteer sends is of the bytes, and text decoded and encoded again can differ from them (a byte
 * order mark, a byte that is not UTF-8). A file the checker reads as failed is
 * refused whole, with its reason: a pool built from a broken file carries the break into every number
 * drawn from it.
 */
export async function buildPool(inputs) {
  const sources = [];
  const refused = [];
  const accepted = [];
  for (const { label, text, bytes } of inputs) {
    const fileSha256 = await sha256Hex(bytes ?? text);
    let report;
    let data;
    try {
      report = await verifyExportText(text);
      data = parseExport(text).data;
    } catch (err) {
      refused.push({ file: label, sha256: fileSha256, reason: 'unreadable: ' + String(err && err.message || err) });
      continue;
    }
    if (report.state === 'failed') {
      const first = report.failures[0];
      refused.push({ file: label, sha256: fileSha256, reason: 'failed the check: ' + (first ? first.reason : 'unknown') });
      continue;
    }
    accepted.push({ label, fileSha256, report, data });
  }

  const groups = recorderGroups();
  for (const a of accepted) {
    const fps = keysOf(a.data);
    a.fps = fps;
    for (const fp of fps) groups.find(fp);
    for (let i = 1; i < fps.length; i++) groups.join(fps[0], fps[i]);
  }

  // Every key any accepted file carries, each checked against its fingerprint before it is kept.
  const v = createVerifier(provenanceDocument(''));
  const keys = new Map();
  for (const a of accepted) {
    const carried = [{ fingerprint: a.data.publicKeyFingerprint, jwk: a.data.publicKeyJwk }, ...(a.data.publicKeys || [])];
    for (const k of carried) {
      if (!k || keys.has(k.fingerprint)) continue;
      try {
        await v.importVerifiedPubKey(k.jwk, k.fingerprint);
        keys.set(k.fingerprint, { fingerprint: k.fingerprint, jwk: k.jwk });
      } catch { /* a key that fails its own fingerprint is not carried; its records read by hash only */ }
    }
  }

  const records = [];
  const byRecorderAndHash = new Map();
  for (let s = 0; s < accepted.length; s++) {
    const a = accepted[s];
    const recorder = a.fps.length ? groups.find(a.fps[0]) : `unknown:${s}`;
    const failedAt = new Set(a.report.failures.map((f) => f.index));
    let pooled = 0;
    let copies = 0;
    let left = 0;
    for (let i = 0; i < a.data.records.length; i++) {
      const record = a.data.records[i];
      if (failedAt.has(i)) { left++; continue; }
      const seenKey = recorder + ' ' + record.integrityHash;
      const earlier = byRecorderAndHash.get(seenKey);
      if (earlier) { earlier.alsoIn.push(s); copies++; continue; }
      const row = { recorder, source: s, index: i, alsoIn: [], identity: await identityOf(record), record };
      byRecorderAndHash.set(seenKey, row);
      records.push(row);
      pooled++;
    }
    sources.push({
      file: a.label,
      nameOnFile: nameOnFile(a.data),
      sha256: a.fileSha256,
      recorder,
      reading: a.report.state,
      manifest: a.report.manifest,
      records: a.data.records.length,
      pooled,
      copies,
      leftOut: left,
    });
  }

  // Sightings per identity, per recorder: a repeat by one recorder and agreement between two are different numbers.
  const sightings = new Map();
  for (const row of records) {
    if (!row.identity) continue;
    if (!sightings.has(row.identity)) sightings.set(row.identity, new Map());
    const per = sightings.get(row.identity);
    per.set(row.recorder, (per.get(row.recorder) ?? 0) + 1);
  }
  for (const row of records) {
    const per = row.identity ? sightings.get(row.identity) : null;
    row.recordersWithItem = per ? per.size : null;
    row.sightingsByThisRecorder = per ? per.get(row.recorder) : null;
  }

  const recorders = [...new Set(sources.map((s) => s.recorder))].sort();
  return {
    format: POOL_FORMAT,
    recordFormat: RECORD_FORMAT,
    contentIdentityRule: CONTENT_IDENTITY_RULE,
    note: 'Each record is kept exactly as its recorder signed it; run pool.mjs --check to verify every one again. '
      + 'A record that verifies says its content is what its key signed, nothing about who held the key.',
    recorders,
    sources,
    refused,
    keys: [...keys.values()].sort((x, y) => (x.fingerprint < y.fingerprint ? -1 : 1)),
    records,
  };
}

/**
 * Checks every record in a pool again, from the pool alone: the hash recomputed from the record's own
 * fields, the signature under the key the record names. A withheld record is checked against the signed
 * marker of its own recorder.
 */
export async function checkPool(pool) {
  if (!pool || pool.format !== POOL_FORMAT) throw new Error('not a ' + POOL_FORMAT + ' file');
  const v = createVerifier(provenanceDocument(''));
  const keys = {};
  const badKeys = [];
  for (const k of pool.keys || []) {
    try {
      const imported = await v.importVerifiedPubKey(k.jwk, k.fingerprint);
      keys[imported.fingerprint] = imported.pubKey;
    } catch { badKeys.push(k.fingerprint); }
  }
  const byRecorder = new Map();
  for (const row of pool.records) {
    if (!byRecorder.has(row.recorder)) byRecorder.set(row.recorder, []);
    byRecorder.get(row.recorder).push(row.record);
  }
  const redactionsOf = new Map([...byRecorder].map(([r, recs]) => [r, v.redactionIndex(recs)]));
  const result = { records: pool.records.length, verified: 0, hashOnly: 0, failed: [], badKeys };
  for (let i = 0; i < pool.records.length; i++) {
    const row = pool.records[i];
    const fp = typeof row.record.publicKeyFingerprint === 'string' ? row.record.publicKeyFingerprint : null;
    const p = await v.verifyOne(row.record, keys, fp, redactionsOf.get(row.recorder));
    if (!p.ok) result.failed.push({ row: i, id: row.record && row.record.id || null, reason: p.reason });
    else if (p.unverified || p.noKey) result.hashOnly++;
    else result.verified++;
  }
  return result;
}

export async function main(argv) {
  const checkAt = argv.indexOf('--check');
  if (checkAt !== -1) {
    const path = argv[checkAt + 1];
    if (!path) { console.error('usage: node pool.mjs --check <pool.json>'); return 3; }
    let pool;
    try { pool = JSON.parse(readFileSync(path, 'utf8')); } catch (err) { console.error(`cannot read ${path}: ${err.message}`); return 3; }
    let r;
    try { r = await checkPool(pool); } catch (err) { console.error(`${path}: ${err.message}`); return 3; }
    console.log(`  ${r.records} records in the pool: ${r.verified} verified, ${r.hashOnly} checked by hash only, ${r.failed.length} failed.`);
    for (const f of r.failed.slice(0, 20)) console.log(`    row ${f.row} (${f.id}): ${f.reason}`);
    if (r.badKeys.length) console.log(`  ${r.badKeys.length} keys did not match their own fingerprint and were not used.`);
    return r.failed.length ? 2 : r.hashOnly ? 1 : 0;
  }

  const outAt = argv.indexOf('--out');
  const out = outAt === -1 ? null : argv[outAt + 1];
  const paths = argv.filter((a, i) => !a.startsWith('--') && i !== outAt + 1);
  if (!out || paths.length === 0) {
    console.error('usage: node pool.mjs <export...> --out <pool.json>   or   node pool.mjs --check <pool.json>');
    return 3;
  }
  const inputs = [];
  for (const path of paths) {
    try {
      const bytes = readFileSync(path);
      inputs.push({ label: path.split(/[\\/]/).pop(), text: bytes.toString('utf8'), bytes });
    } catch (err) {
      console.error(`cannot read ${path}: ${err.message}`);
      return 3;
    }
  }
  const pool = await buildPool(inputs);
  writeFileSync(out, JSON.stringify(pool, null, 2) + '\n');
  for (const s of pool.sources) {
    console.log(`  ${s.file}: ${s.reading}, ${s.pooled} records pooled, ${s.copies} already in the pool from an earlier file, ${s.leftOut} left out as failed`);
  }
  for (const r of pool.refused) console.log(`  ${r.file}: REFUSED, ${r.reason}`);
  const shared = new Set(pool.records.filter((r) => r.recordersWithItem > 1).map((r) => r.identity)).size;
  console.log(`  ${pool.records.length} records from ${pool.recorders.length} recorder${pool.recorders.length === 1 ? '' : 's'}; ${shared} items recorded by more than one recorder.`);
  console.log(`  Written to ${out}. Check it again any time with: node pool.mjs --check ${out}`);
  if (pool.refused.length) return 2;
  return pool.sources.some((s) => s.reading !== 'verified') ? 1 : 0;
}

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
