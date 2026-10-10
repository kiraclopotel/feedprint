#!/usr/bin/env node
// to-4cat.mjs: a pool, or one export, as a file 4CAT's own upload reads.
//
// Copyright 2026 FeelingWise. Licensed under the Apache License, Version 2.0;
// see the LICENSE file beside this one.
//
// Usage:  node to-4cat.mjs <pool.json | export.html> --out <for-4cat.csv>
// Exit:   0 a file was written, 2 nothing to write or a file was refused, 3 unreadable input.
//
// 4CAT takes data it did not collect through "Custom Dataset Upload" with the format "Custom/other": a UTF-8 CSV
// with a header row and five columns it names, id, thread_id, author, body and timestamp
// (datasources/upload/import_formats.py in the 4CAT repository, read at commit 6286c970). Every other column is
// copied through untouched, so the observation columns of to-csv.mjs follow the five.
//
// id is the record's integrityHash: unique across a pool, where two recorders' own record ids can repeat, and it is
// the value that finds the row again in the signed file. thread_id is the id of the post a comment was recorded
// under when that post is in the pool from the same recorder, and the row's own id otherwise, as 4CAT asks for
// items that belong to no thread.
//
// timestamp is written as UTC wall-clock time, YYYY-MM-DD HH:MM:SS, the notation 4CAT recommends. 4CAT rewrites the
// column in that notation and drops any offset, so a time written with one would be read as the wall clock of the
// offset rather than as UTC. The exact time as the record holds it is kept in timestamp_recorded.
//
// The upload's "pseudonymise" option replaces the author column only. The account names in postUrl and body are
// left as the site showed them, and a group that pseudonymises must know that.

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { poolFrom, rowsOf, COLUMNS as TABLE_COLUMNS } from './to-csv.mjs';
import { csvField } from './observations.mjs';

export const FOURCAT_COLUMNS = ['id', 'thread_id', 'author', 'body', 'timestamp'];
const CARRIED = TABLE_COLUMNS.filter((c) => !['author', 'originalText', 'integrityHash'].includes(c));
export const COLUMNS = [...FOURCAT_COLUMNS, 'timestamp_recorded', ...CARRIED.filter((c) => c !== 'timestamp')];

/** UTC wall clock in the notation 4CAT recommends, or empty when the record's time does not parse. */
export function fourcatTime(iso) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

export async function fourcatRows(pool) {
  const table = await rowsOf(pool);
  // The integrityHash of each record by recorder and record id, so a comment finds the post it was recorded under.
  const byId = new Map();
  for (const entry of pool.records) byId.set(entry.recorder + ' ' + entry.record.id, entry.record.integrityHash);
  const parentOf = new Map();
  for (const entry of pool.records) {
    const parent = entry.record.parentRecordId;
    if (typeof parent === 'string' && parent) parentOf.set(entry.record.integrityHash, byId.get(entry.recorder + ' ' + parent));
  }
  return table.map((row) => {
    const out = {
      id: row.integrityHash,
      thread_id: parentOf.get(row.integrityHash) || row.integrityHash,
      author: row.author,
      body: row.originalText,
      timestamp: fourcatTime(row.timestamp),
      timestamp_recorded: row.timestamp,
    };
    for (const c of CARRIED) if (c !== 'timestamp') out[c] = row[c];
    return out;
  });
}

export function toFourcatCsv(rows) {
  const lines = [COLUMNS.join(',')];
  // 4CAT reads this file into its own store and counts words in body, so the spreadsheet apostrophe would become part
  // of the text it analyses, and replies on X often start with an account name.
  for (const row of rows) lines.push(COLUMNS.map((c) => csvField(row[c] ?? '', { forSpreadsheet: false })).join(','));
  return lines.join('\r\n') + '\r\n';
}

export async function main(argv) {
  const outAt = argv.indexOf('--out');
  const out = outAt === -1 ? null : argv[outAt + 1];
  const paths = argv.filter((a, i) => !a.startsWith('--') && i !== outAt + 1);
  if (!out || paths.length !== 1) {
    console.error('usage: node to-4cat.mjs <pool.json | export.html> --out <for-4cat.csv>');
    return 3;
  }
  let bytes, text;
  try { bytes = readFileSync(paths[0]); text = bytes.toString('utf8'); } catch (err) { console.error(`cannot read ${paths[0]}: ${err.message}`); return 3; }
  let pool;
  try { pool = await poolFrom(text, paths[0].split(/[\\/]/).pop(), bytes); } catch (err) { console.error(`${paths[0]}: ${err.message}`); return 3; }
  for (const r of pool.refused) console.error(`  ${r.file}: REFUSED, ${r.reason}`);
  const rows = await fourcatRows(pool);
  if (rows.length === 0) { console.error('  no served item to write'); return 2; }
  writeFileSync(out, toFourcatCsv(rows), 'utf8');
  console.error(`  ${rows.length} rows written to ${out}. In 4CAT: Create dataset, Custom Dataset Upload, format "Custom/other".`);
  return pool.refused.length ? 2 : 0;
}

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
