#!/usr/bin/env node
// corroborate.mjs: how much of what one recorder saw, another recorder also saw.
//
// Copyright 2026 FeelingWise. Licensed under the Apache License, Version 2.0;
// see the LICENSE file beside this one.
//
// Usage:  node corroborate.mjs <export.html|export.json> <export...> [--json]
// Exit:   0 a report was produced, 2 nothing comparable, 3 a file was unreadable.
//
// WHY THIS EXISTS, and it is the part to read before the output.
//
// A signed record proves nothing was altered after it was signed. It proves
// nothing whatsoever about whether the thing was ever served: the signature
// goes on after the text is in hand, so a fabricated post signs exactly as
// cleanly as a real one. No amount of cryptography reaches back past that.
//
// The only thing that does reach it is other people. An observation earns
// weight in proportion to how many unrelated observers recorded the same item
// being served, and forging at scale costs a forger in proportion to how many
// independent recorders they would have to control. That is a property of a
// set of files, not of one file, which is why the checker beside this one
// cannot tell you anything about it.
//
// This tool computes the content identity defined in FORMAT.md section 9 for
// every record in every file it is given, and reports what more than one file
// holds. It contacts nothing and reads nothing but the files named.
//
// WHAT IT REFUSES TO DO. Two exports from the SAME recorder are not two
// observers, and counting their overlap as corroboration is the single easiest
// way to produce a confident number that means nothing. Files are grouped by
// the signing key they carry, and overlap inside one key is reported as repeat
// sightings by one recorder, never as agreement.
//
// WHAT IT DOES NOT CHECK. It does not verify the files. Run verify-export.mjs
// first: identities computed from a file that does not verify are identities
// out of a document that says whatever someone last typed into it, and the
// overlap of two such files is worth nothing at all. This is said again in the
// output because it is the assumption the whole report rests on.

import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const crypto = globalThis.crypto ?? webcrypto;

// ── The rule, FORMAT.md section 9 ────────────────────────────────────────────
// Kept as its own copy on purpose: this file ships to people who do not have
// the FeelingWise tree, and a second implementer reads it as one worked
// example of the normative text. verifier/vectors/CONTENT-IDENTITY.json is the
// conformance suite both this and the tree's own copy are checked against.

const CONTENT_IDENTITY_VERSION = 'fw-ci-1';
const FORMAT_NOISE = /[\u200B\uFEFF\u00AD\u180E]/g;
const HORIZONTAL_SPACE = /[\t\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;

/** The normal form: extraction noise removed, content untouched. */
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

/**
 * Whether this record's text may be compared with another observer's at all.
 * A caption cut at a "show more" control is less text, not the same text worn
 * differently, and the cut point moves with the viewport.
 */
export function comparability(record) {
  const capture = record.textCapture;
  if (capture === undefined) return 'unknown';
  if (capture === 'whole' || capture === 'folded') return 'comparable';
  return 'incomparable';
}

// ── Reading a file ───────────────────────────────────────────────────────────

const PAYLOAD_RE = /<script\b[^>]*\bid="fw-export-data"[^>]*>/;

/** The envelope out of an HTML export, or a bare JSON envelope. */
export function parseExport(text) {
  const trimmed = text.trimStart();
  // A bare array is JSON that is not an envelope, not a missing HTML wrapper.
  // Sent down the HTML path it would be answered with "no fw-export-data
  // payload", which points at the wrong thing.
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
 * The key a file's records were signed under, as the name of the RECORDER.
 *
 * Deliberately crude and deliberately conservative: the envelope's own
 * fingerprint when it carries one, else the first fingerprint stamped on a
 * record, else a marker that keeps the file in a group of its own. Two files
 * that cannot be shown to come from different recorders must never be counted
 * as different recorders, so an unknown key is its own group and says so.
 */
export function recorderOf(data, label) {
  const fromEnvelope = typeof data.publicKeyFingerprint === 'string' && data.publicKeyFingerprint;
  if (fromEnvelope) return { key: fromEnvelope, known: true };
  for (const record of data.records) {
    if (typeof record?.publicKeyFingerprint === 'string' && record.publicKeyFingerprint) {
      return { key: record.publicKeyFingerprint, known: true };
    }
  }
  return { key: `unknown:${label}`, known: false };
}

/** One file's comparable identities, with the counts the report needs. */
export async function readFileIdentities(text, label) {
  const data = parseExport(text);
  const recorder = recorderOf(data, label);
  const identities = new Set();
  const counts = { records: data.records.length, comparable: 0, incomparable: 0, unknown: 0, empty: 0 };

  for (const record of data.records) {
    const state = comparability(record);
    counts[state === 'comparable' ? 'comparable' : state === 'unknown' ? 'unknown' : 'incomparable']++;
    if (state !== 'comparable') continue;
    const raw = typeof record.originalText === 'string' ? record.originalText : '';
    // A placeholder is not content. The recorder writes "[blocked: <reason>]"
    // where an item had no caption, and letting those meet would corroborate
    // the placeholder rather than anything anyone was served.
    if (raw.startsWith('[blocked:')) { counts.empty++; continue; }
    if (normaliseForIdentity(raw) === '') { counts.empty++; continue; }
    identities.add(await contentIdentity(raw));
  }
  return { label, recorder, identities, counts };
}

// ── The report ───────────────────────────────────────────────────────────────

export function buildReport(files) {
  const byRecorder = new Map();
  for (const file of files) {
    if (!byRecorder.has(file.recorder.key)) byRecorder.set(file.recorder.key, []);
    byRecorder.get(file.recorder.key).push(file);
  }

  // One set per RECORDER, not per file. Two exports from one install are one
  // observer seeing something twice, which is not agreement about anything.
  const perRecorder = [...byRecorder.entries()].map(([key, group]) => {
    const identities = new Set();
    for (const file of group) for (const id of file.identities) identities.add(id);
    return { key, known: group[0].recorder.known, files: group.map((f) => f.label), identities };
  });

  const seenIn = new Map();
  for (const recorder of perRecorder) {
    for (const id of recorder.identities) {
      seenIn.set(id, (seenIn.get(id) ?? 0) + 1);
    }
  }
  const shared = [...seenIn.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);

  return {
    recorders: perRecorder.length,
    unknownKeyRecorders: perRecorder.filter((r) => !r.known).length,
    perRecorder,
    distinctItems: seenIn.size,
    corroborated: shared.length,
    shared,
  };
}

function print(report, files) {
  const line = (s = '') => console.log(s);

  line();
  line('  NOT A VERIFICATION. Run verify-export.mjs on each file first. Identities');
  line('  out of a file that does not verify are identities out of a document that');
  line('  says whatever someone last typed into it.');
  line();

  for (const file of files) {
    const c = file.counts;
    line(`  ${file.label}`);
    line(`    ${c.records} records: ${c.comparable} comparable, ${c.incomparable} not, ${c.unknown} unknown capture`);
    if (c.empty) line(`    ${c.empty} comparable records carried no text to identify`);
  }
  line();

  line(`  ${files.length} file${files.length === 1 ? '' : 's'} from ${report.recorders} recorder${report.recorders === 1 ? '' : 's'}.`);
  for (const r of report.perRecorder) {
    const name = r.known ? r.key.slice(0, 12) : 'key not stated';
    line(`    ${name}  ${r.identities.size} distinct items  (${r.files.join(', ')})`);
  }
  line();

  if (report.recorders < 2) {
    line('  NO CORROBORATION IS POSSIBLE HERE, and this is not a failure of the files.');
    line('  Every file given was signed by one recorder, so there is one observer and');
    line('  nothing to agree with. Two exports from one install are that install');
    line('  seeing something twice. Corroboration needs files from people who have');
    line('  never met.');
    if (report.unknownKeyRecorders) {
      line();
      line('  One or more files did not state a signing key. Each was kept in a group');
      line('  of its own rather than assumed to be a separate recorder.');
    }
    return 2;
  }

  line(`  ${report.distinctItems} distinct items across all recorders.`);
  const was = report.corroborated === 1 ? 'was' : 'were';
  line(`  ${report.corroborated} ${was} recorded by more than one recorder.`);
  line();
  if (report.corroborated) {
    line('  Most widely seen first. An identity is a hash of the served text, so it');
    line('  names an item without naming anyone who saw it.');
    for (const [id, n] of report.shared.slice(0, 20)) {
      line(`    ${n} recorders  ${id}`);
    }
    if (report.shared.length > 20) line(`    ... and ${report.shared.length - 20} more`);
  }
  line();
  line('  WHAT THIS DOES NOT SAY. That two recorders hold one identity means two');
  line('  files contain the same text. It does not date either sighting, does not');
  line('  say either person saw it on a platform, and is not by itself evidence');
  line('  that anything was served. Short text corroborates trivially: two people');
  line('  posting the same three words produce one identity by definition.');
  line();
  return 0;
}

// ── Entry ────────────────────────────────────────────────────────────────────

export async function main(argv) {
  const asJson = argv.includes('--json');
  const paths = argv.filter((a) => !a.startsWith('--'));
  if (paths.length === 0) {
    console.error('usage: node corroborate.mjs <export...> [--json]');
    return 3;
  }

  const files = [];
  for (const path of paths) {
    let text;
    try {
      text = readFileSync(path, 'utf8');
    } catch (err) {
      console.error(`cannot read ${path}: ${err.message}`);
      return 3;
    }
    try {
      files.push(await readFileIdentities(text, path));
    } catch (err) {
      console.error(`${path}: ${err.message}`);
      return 3;
    }
  }

  const report = buildReport(files);
  if (asJson) {
    console.log(JSON.stringify({
      note: 'Not a verification. Run verify-export.mjs on each file first.',
      rule: CONTENT_IDENTITY_VERSION,
      recorders: report.recorders,
      distinctItems: report.distinctItems,
      corroborated: report.corroborated,
      files: files.map((f) => ({ file: f.label, ...f.counts })),
      shared: report.shared.map(([identity, recorders]) => ({ identity, recorders })),
    }, null, 2));
    return report.recorders < 2 ? 2 : 0;
  }
  return print(report, files);
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('corroborate.mjs');
if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
