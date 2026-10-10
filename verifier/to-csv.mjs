#!/usr/bin/env node
// to-csv.mjs: a pool, or one export, as one table a spreadsheet opens.
//
// Copyright 2026 FeelingWise. Licensed under the Apache License, Version 2.0;
// see the LICENSE file beside this one.
//
// Usage:  node to-csv.mjs <pool.json | export.html> --out <table.csv> [--no-bom]
// Exit:   0 a table was written, 2 nothing to write or a file was refused, 3 unreadable input.
//
// One row per served item, with the observation columns of observations.mjs and four more that only a pool has:
// which recorder, which file, how many recorders hold the same text, and how many times this recorder holds it.
// Like observations.mjs it leaves out every model reading, and for the same reason: a reading is a model's output,
// which changes between releases, and a panel's table should hold what was served.
//
// The first line is the column names, with nothing above them, so a spreadsheet or a statistics package reads the
// file without being told to skip lines. What observations.mjs puts in its comment header lives in the pool file
// instead, which is the thing to cite.
//
// A cell that starts with = + - @, a tab, a carriage return or an apostrophe gets an apostrophe in front, so a
// spreadsheet shows a post that starts that way instead of running it (csvField in observations.mjs).
//
// The file starts with a byte order mark unless --no-bom is given, because a spreadsheet opened by double-click
// otherwise reads UTF-8 as the machine's old code page and turns every Romanian letter with a mark into two wrong
// ones. A script that reads the file with a plain UTF-8 reader sees the mark as part of the first column's name:
// give it --no-bom.

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildPool } from './pool.mjs';
import { OBSERVATION_FIELDS, csvField, isObservation, contentIdentity, comparability } from './observations.mjs';

export const POOL_COLUMNS = ['recorder', 'nameOnFile', 'file', 'fileReading'];
export const COUNT_COLUMNS = ['contentIdentity', 'comparable', 'recordersWithItem', 'sightingsByThisRecorder'];
export const COLUMNS = [...POOL_COLUMNS, ...OBSERVATION_FIELDS.map(([f]) => f), ...COUNT_COLUMNS];

/**
 * A pool file, or an export turned into a pool of one so the two inputs give the same table. Pass the file's bytes
 * when you have them: the pool's sources[].sha256 is of the bytes, and hashing the text instead gives another
 * number for a file saved with a byte order mark.
 */
export async function poolFrom(text, label, bytes) {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed.format === 'string' && parsed.format.startsWith('feed-observation-pool/')) return parsed;
  }
  return buildPool([{ label, text, ...(bytes ? { bytes } : {}) }]);
}

/** The rows of the table, in pool order. Chain markers, withheld records and empty items are not observations. */
export async function rowsOf(pool) {
  const rows = [];
  for (const entry of pool.records) {
    const record = entry.record;
    if (!isObservation(record)) continue;
    const source = pool.sources[entry.source];
    const row = { recorder: entry.recorder, nameOnFile: source.nameOnFile ?? '', file: source.file, fileReading: source.reading };
    for (const [field] of OBSERVATION_FIELDS) row[field] = record[field] === undefined || record[field] === null ? '' : record[field];
    row.contentIdentity = await contentIdentity(record.originalText);
    row.comparable = comparability(record);
    row.recordersWithItem = entry.recordersWithItem ?? '';
    row.sightingsByThisRecorder = entry.sightingsByThisRecorder ?? '';
    rows.push(row);
  }
  return rows;
}

export function toCsv(rows, { bom = true } = {}) {
  const lines = [COLUMNS.join(',')];
  for (const row of rows) lines.push(COLUMNS.map((c) => csvField(row[c])).join(','));
  // CRLF, as RFC 4180 writes it; every spreadsheet and statistics package reads it.
  return (bom ? '﻿' : '') + lines.join('\r\n') + '\r\n';
}

export async function main(argv) {
  const outAt = argv.indexOf('--out');
  const out = outAt === -1 ? null : argv[outAt + 1];
  const paths = argv.filter((a, i) => !a.startsWith('--') && i !== outAt + 1);
  if (!out || paths.length !== 1) {
    console.error('usage: node to-csv.mjs <pool.json | export.html> --out <table.csv> [--no-bom]');
    return 3;
  }
  let bytes, text;
  try { bytes = readFileSync(paths[0]); text = bytes.toString('utf8'); } catch (err) { console.error(`cannot read ${paths[0]}: ${err.message}`); return 3; }
  let pool;
  try { pool = await poolFrom(text, paths[0].split(/[\\/]/).pop(), bytes); } catch (err) { console.error(`${paths[0]}: ${err.message}`); return 3; }
  for (const r of pool.refused) console.error(`  ${r.file}: REFUSED, ${r.reason}`);
  const rows = await rowsOf(pool);
  if (rows.length === 0) { console.error('  no served item to write'); return 2; }
  writeFileSync(out, toCsv(rows, { bom: !argv.includes('--no-bom') }), 'utf8');
  console.error(`  ${rows.length} rows written to ${out}`);
  return pool.refused.length ? 2 : 0;
}

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
