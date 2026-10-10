#!/usr/bin/env node
// observations.mjs: the served observations out of an export, with no model reading in them.
//
// Copyright 2026 FeelingWise. Licensed under the Apache License, Version 2.0;
// see the LICENSE file beside this one.
//
// Usage:  node observations.mjs <export.html|export.json> [--json] [--out file]
// Exit:   0 a projection was written, 2 the file held no observation to project,
//         3 the file could not be read.
//
// WHY, and it is a real limit of the format rather than a preference.
//
// A record carries two different kinds of thing. "This text was served at this
// time, in this surface, by this account" is an observation. "This is a fear
// appeal at severity 5" is a reading, by a named model, at a stated confidence.
// The first is a fact about the world. The second is the output of a model
// whose behaviour changes between releases, so nobody doing measurement can
// cite it and expect the number to mean the same thing next year.
//
// This writes out the first kind and nothing else. Every field naming a model,
// a score, a technique, a verdict or a rewrite is left out. What each row keeps
// is its `integrityHash` and its position, so any row can be found again in the
// signed file it came from.
//
// WHAT THIS IS NOT. It is not a signed artefact and it is not evidence on its
// own. The signed export is the evidence; this is a projection of it that
// anybody can reproduce by running this tool over the same file, which is the
// property that makes it citeable. Name the source file and its SHA-256 beside
// any table built from it; the header this tool writes gives you both.
//
// WHY IT IS NOT A SIGNED EXPORT WITH THE READINGS REMOVED, which is what an
// earlier plan in this project called for and priced at half a day. That plan
// was wrong and the reason is worth keeping. A record's signature covers a hash
// of ALL its fields together, readings included, so removing a field makes the
// hash unrecomputable. The format does have a mechanism for exactly that, the
// signed redaction marker, and it does not fit here for two reasons: a marker
// binds to ONE record, so an export of 130,000 records would need 130,000 more
// records to say what was withheld; and the alternative, a new file-wide
// declaration, would be a format change that every already-published copy of
// verify-export.mjs would reject. Handing a researcher a file that our own
// published checker calls broken is worse than handing them a projection.

import { readFileSync, writeFileSync } from 'node:fs';
import { webcrypto, createHash } from 'node:crypto';

const crypto = globalThis.crypto ?? webcrypto;
const TOOL_VERSION = 'observations-1';

// ── Content identity, FORMAT.md section 9 ────────────────────────────────────
// Same rule as corroborate.mjs beside this file; both are checked against
// verifier/vectors/CONTENT-IDENTITY.json so they cannot say different things.

const CONTENT_IDENTITY_VERSION = 'fw-ci-1';
const FORMAT_NOISE = /[\u200B\uFEFF\u00AD\u180E]/g;
const HORIZONTAL_SPACE = /[\t\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;

export function normaliseForIdentity(text) {
  return text
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(FORMAT_NOISE, '')
    .replace(HORIZONTAL_SPACE, ' ')
    .replace(/ {2,}/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function contentIdentity(text) {
  const bytes = new TextEncoder().encode(normaliseForIdentity(text));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${CONTENT_IDENTITY_VERSION}:${hex}`;
}

// ── What counts as an observation ────────────────────────────────────────────
//
// The list is deliberately SHORT and the rule for adding to it is: a field goes
// in only when it describes what the platform served, when, or where. Anything
// that describes what this product concluded stays out, and where a field could
// be read either way it stays out, because a projection that quietly carries a
// judgement is worse than one that is missing a column somebody wanted.
//
// Left out on purpose, with the reason, so nobody has to guess whether it was
// forgotten:
//   neutralizedText  the model's rewrite. The most obviously a reading.
//   techniques, overallScore, harmFloor, topic, sourceCategory
//                    what the reading concluded and how strongly.
//   aiModel, aiProvider, aiSource, reader
//                    which model read it. Useful, and it belongs beside a
//                    reading, not beside an observation.
//   verdict, decision, detectionMode, verdictOrigin, overrideOrigin,
//   visualApplied, skipReason, failureKind, cap, metrics
//                    what this product DID about the item. That is a fact, and
//                    it is a fact about the product rather than about the feed,
//                    so it is not what this file is for.
//   imageContext, videoContext
//                    model output about media.
export const OBSERVATION_FIELDS = [
  ['chainPosition', 'where the record sits in the recorder\'s chain'],
  ['timestamp', 'when the recorder wrote it, ISO 8601'],
  ['platform', 'which site served it'],
  ['kind', 'post, comment, reply, and so on'],
  ['feedSource', 'which surface of that site'],
  ['surfaceOrigin', 'how the item reached the recorder'],
  ['author', 'the account the site showed beside it'],
  ['authorCapture', 'blank normally; "withheld" when the recorder saw an author and refused it'],
  ['postUrl', 'the address the site gave for it'],
  ['textCapture', 'whole, folded, cut or platform: how much of the text the page carried'],
  ['originalLength', 'the length of the served text'],
  ['originalText', 'the served text itself'],
  ['integrityHash', 'the row\'s place in the signed file, so it can be found again'],
  ['publicKeyFingerprint', 'the key that signed it'],
];

const DERIVED_FIELDS = [
  ['contentIdentity', 'fw-ci-1 identity of the served text; FORMAT.md section 9'],
  ['comparable', 'whether this row\'s text may be compared with another observer\'s'],
];

/**
 * Characters a UTF-8 text file cannot carry cleanly, counted so a reader knows
 * whether their file is one of the affected ones instead of guessing.
 *
 * Found 2026-09-21 by running this tool over verifier/vectors/11-text-escaping,
 * the vector written after an independent implementer's checker was tripped by
 * exactly this class. Zero of the 1,325 rows in the published demo are affected;
 * it is a pathological case and the vectors exist because pathological cases are
 * what two implementations disagree about.
 *
 * C0 CONTROL CHARACTERS other than tab and newline are written into the CSV as
 * they stand. RFC 4180 does not allow them and some readers will mangle them.
 * They are NOT escaped, on purpose: escaping would mean the text in the file no
 * longer hashes to the identity printed beside it, and that property is worth
 * more than conformance for a file this rare. `--json` is the lossless form and
 * the header says so when a file needs it.
 *
 * AN UNPAIRED SURROGATE cannot be encoded as UTF-8 at all, so it is written as
 * U+FFFD. That is not a loss of agreement: the identity rule encodes to UTF-8
 * too, so the record's text and the printed text produce the SAME identity. It
 * is a loss of the character, and the header says so rather than leaving a
 * reader to find a replacement character and wonder.
 */
export function hasControlCharacter(text) {
  for (const ch of text) {
    const n = ch.codePointAt(0);
    // Tab, newline and carriage return are excluded: RFC 4180 permits all
    // three inside a quoted field, and normalisation folds a carriage return to
    // a newline before the identity is taken, so none of them is the problem
    // this counts.
    if (n < 32 && n !== 10 && n !== 9 && n !== 13) return true;
    if (n === 127) return true;
  }
  return false;
}

export function hasUnpairedSurrogate(text) {
  return /[\uD800-\uDFFF]/.test(
    text.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ''),
  );
}

export function comparability(record) {
  const capture = record.textCapture;
  if (capture === undefined) return 'unknown';
  if (capture === 'whole' || capture === 'folded') return 'comparable';
  return 'incomparable';
}

// ── Reading the file ─────────────────────────────────────────────────────────

const PAYLOAD_RE = /<script\b[^>]*\bid="fw-export-data"[^>]*>/;

export function parseExport(text) {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('[')) throw new Error('not a FeelingWise export: the payload is not an object');
  const json = trimmed.startsWith('{') ? trimmed : (() => {
    const m = PAYLOAD_RE.exec(text);
    if (!m) throw new Error('not a FeelingWise export: no fw-export-data payload');
    const from = m.index + m[0].length;
    const end = text.indexOf('</script>', from);
    if (end < 0) throw new Error('not a FeelingWise export: payload never closes');
    return text.slice(from, end);
  })();
  const data = JSON.parse(json);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('not a FeelingWise export: the payload is not an object');
  }
  if (!Array.isArray(data.records)) throw new Error('not a FeelingWise export: no records array');
  return data;
}

/**
 * Kinds that are not an observation of a served item.
 *
 * The nine markers are records about the CHAIN: a reset, a month rotation, a
 * prune, a gap, a heartbeat, an import, a repair, a redaction, a reconcile. A
 * row for one of those in a table of what a feed served would be a row about
 * bookkeeping. Copied from SYSTEM_MARKER_KINDS in
 * src/forensics/system-records.ts and held to it by a gate test, because this
 * list was first written from memory and got five of the nine names wrong,
 * which would have let markers into the table silently.
 *
 * The two beside them are not markers and are excluded for their own reasons,
 * both from the docblock of src/forensics/export-numbers.ts: 'image' is an
 * analysis record rather than a node the person saw, and 'environment' is about
 * the chain.
 */
export const SYSTEM_KINDS = new Set([
  'reset-marker',
  'month-rotation-marker',
  'prune-marker',
  'gap-marker',
  'heartbeat-marker',
  'import-marker',
  'repair-marker',
  'redaction-marker',
  'reconcile-marker',
  'image',
  'environment',
]);

export function isObservation(record) {
  if (!record || typeof record !== 'object') return false;
  if (typeof record.kind === 'string' && SYSTEM_KINDS.has(record.kind)) return false;
  // A withheld record has had its text removed at the recorded person's
  // request. There is no observation left to project and putting an empty row
  // in the table would read as "nothing was served".
  if (record.redacted) return false;
  return typeof record.originalText === 'string' && record.originalText.length > 0;
}

export async function project(data) {
  const rows = [];
  const counts = {
    records: data.records.length, projected: 0, systemMarkers: 0, withheld: 0, empty: 0,
    withControlCharacter: 0, withUnpairedSurrogate: 0,
  };

  for (const record of data.records) {
    if (record?.redacted) { counts.withheld += 1; continue; }
    if (typeof record?.kind === 'string' && SYSTEM_KINDS.has(record.kind)) { counts.systemMarkers += 1; continue; }
    if (!isObservation(record)) { counts.empty += 1; continue; }

    const row = {};
    for (const [field] of OBSERVATION_FIELDS) {
      row[field] = record[field] === undefined || record[field] === null ? '' : record[field];
    }
    row.contentIdentity = await contentIdentity(record.originalText);
    row.comparable = comparability(record);
    if (hasControlCharacter(record.originalText)) counts.withControlCharacter += 1;
    if (hasUnpairedSurrogate(record.originalText)) counts.withUnpairedSurrogate += 1;
    rows.push(row);
    counts.projected += 1;
  }
  return { rows, counts };
}

// ── Output ───────────────────────────────────────────────────────────────────

/**
 * A spreadsheet runs a cell that starts with = + - @, a tab or a carriage return as a formula, and a served post can
 * start with any of them, so such a field gets an apostrophe in front, as OWASP's page on CSV injection describes. A
 * field that already starts with an apostrophe gets one too, so the rule reads back without a guess: drop one leading
 * apostrophe from any field that has one. FORMAT.md section 10 states it for readers of the tables.
 */
const SPREADSHEET_TRIGGER = /^[=+\-@\t\r']/;

/**
 * RFC 4180 quoting: a field holding a comma, a quote or a newline is quoted, and quotes double. With
 * `{ forSpreadsheet: false }` the leading apostrophe is left out, for a file a program imports rather than a person
 * opens, where the apostrophe would become part of the text.
 */
export function csvField(value, { forSpreadsheet = true } = {}) {
  const raw = String(value);
  const s = forSpreadsheet && SPREADSHEET_TRIGGER.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function header(source, digest, data, counts) {
  const fingerprint = data.publicKeyFingerprint
    ?? data.records.find((r) => typeof r?.publicKeyFingerprint === 'string')?.publicKeyFingerprint
    ?? 'not stated in this file';
  const lines = [
    `tool: ${TOOL_VERSION}, identity rule ${CONTENT_IDENTITY_VERSION}`,
    `source file: ${source}`,
    `source sha256: ${digest}`,
    `signing key: ${fingerprint}`,
    `records in file: ${counts.records}`,
    `projected: ${counts.projected}`,
    `left out: ${counts.systemMarkers} chain markers and analysis records, ${counts.withheld} withheld at the recorded person's request, ${counts.empty} with no served text`,
    '',
    'This is a PROJECTION, not evidence. The signed export named above is the',
    'evidence; this file is reproducible from it by running observations.mjs.',
    'It carries no model reading of any kind: no rewrite, no technique, no',
    'score, no verdict, and no model name. It has NOT been verified: run',
    'verify-export.mjs on the source file first.',
    'It does carry the account names and addresses the sites showed, because',
    'those are part of what was served. Treat it as personal data.',
  ];
  if (counts.withControlCharacter || counts.withUnpairedSurrogate) {
    lines.push(
      '',
      `TEXT THIS FILE FORMAT CANNOT CARRY CLEANLY: ${counts.withControlCharacter} row(s) hold a control`,
      `character and ${counts.withUnpairedSurrogate} hold an unpaired surrogate. Use --json for those:`,
      'it escapes both and reads back exactly. In the CSV a control character is',
      'written as it stands, which RFC 4180 does not allow and some readers will',
      'mangle; it is not escaped because escaping would stop the text hashing to',
      'the identity printed beside it. An unpaired surrogate is written as U+FFFD,',
      'which loses the character and NOT the agreement: the identity rule encodes',
      'to UTF-8 as well, so both produce the same identity.',
    );
  }
  return lines;
}

function toCsv(lines, rows) {
  const columns = [...OBSERVATION_FIELDS.map(([f]) => f), ...DERIVED_FIELDS.map(([f]) => f)];
  const out = lines.map((l) => (l === '' ? '#' : `# ${l}`));
  out.push('#');
  for (const [field, meaning] of [...OBSERVATION_FIELDS, ...DERIVED_FIELDS]) out.push(`# ${field}: ${meaning}`);
  out.push('# a field that starts with an apostrophe had it put in front so a spreadsheet does not run it as a formula: drop that one apostrophe to read the value');
  out.push(columns.join(','));
  for (const row of rows) out.push(columns.map((c) => csvField(row[c])).join(','));
  return `${out.join('\n')}\n`;
}

export async function main(argv) {
  const asJson = argv.includes('--json');
  const outAt = argv.indexOf('--out');
  const outPath = outAt === -1 ? undefined : argv[outAt + 1];
  // outAt is -1 when there is no --out, and `i !== outAt + 1` would then exclude
  // argument 0, which is the file itself. Guarded rather than clever.
  const skip = outAt === -1 ? -1 : outAt + 1;
  const paths = argv.filter((a, i) => !a.startsWith('--') && i !== skip);

  if (paths.length !== 1) {
    console.error('usage: node observations.mjs <export> [--json] [--out file]');
    return 3;
  }

  let text;
  try {
    text = readFileSync(paths[0], 'utf8');
  } catch (err) {
    console.error(`cannot read ${paths[0]}: ${err.message}`);
    return 3;
  }

  let data;
  try {
    data = parseExport(text);
  } catch (err) {
    console.error(`${paths[0]}: ${err.message}`);
    return 3;
  }

  const digest = createHash('sha256').update(text, 'utf8').digest('hex');
  const { rows, counts } = await project(data);
  const lines = header(paths[0], digest, data, counts);

  const body = asJson
    ? `${JSON.stringify({
      tool: TOOL_VERSION,
      rule: CONTENT_IDENTITY_VERSION,
      source: paths[0],
      sourceSha256: digest,
      note: lines.slice(8).join(' '),
      counts,
      columns: [...OBSERVATION_FIELDS, ...DERIVED_FIELDS].map(([field, meaning]) => ({ field, meaning })),
      observations: rows,
    }, null, 2)}\n`
    : toCsv(lines, rows);

  if (outPath) {
    writeFileSync(outPath, body, 'utf8');
    for (const l of lines) console.error(l ? `  ${l}` : '');
    console.error(`  written to ${outPath}`);
  } else {
    process.stdout.write(body);
  }
  return counts.projected === 0 ? 2 : 0;
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('observations.mjs');
if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
