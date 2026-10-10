#!/usr/bin/env node
// FeelingWise — check what SHIPS, not what is written.
//
// WHY THIS FILE EXISTS. CLAUDE.md already carries the rule: "Rebuild dist and
// grep-verify before any live check you ask of him." On 2026-08-21 a session
// followed it and it paid three times in one sitting: a /health endpoint still
// naming a build that had been replaced, 31 lines of stylesheet shipping to
// every user with nothing rendering it, and a licence field that would have
// been silently stripped on first use. All three were invisible in the source
// and obvious in the build.
//
// That rule had been on the page for weeks and none of those three had been
// caught. This project's own record says why: a written warning is read,
// agreed with, and skipped by the next session under time pressure, while a
// check that can contradict you is what actually catches errors. So the rule
// moves here, where it runs.
//
//   npm run verify:shipped
//
// FOUR CHECKS, in the order a defect usually arrives.
//
// 1. STALENESS. Is dist older than src? This is the one that matters most and
//    the one no amount of grepping finds, because a stale bundle grep-verifies
//    perfectly against the previous change. Every "he reloaded and it looked
//    the same" bug is this.
// 2. VERSION. Does the shipped manifest match the repo manifest?
// 3. DECLARED INVARIANTS. A list, below, of strings that MUST and MUST NOT
//    appear in the shipped assets. This is where a session records what a
//    change was supposed to do, so the next one cannot quietly undo it.
// 4. ORPHAN SELECTORS, ratcheted. Class selectors defined in the shipped CSS
//    that no shipped JS mentions. Dynamic class names make a zero here
//    unreachable, so this does NOT demand zero: it demands "no worse than the
//    recorded baseline". The number can only go down. That is deliberate —
//    a check that fails on day one for reasons nobody can fix gets disabled,
//    and a disabled check is worse than none.
//
// Exit code 1 on any failure, so it can gate a release.

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const BASELINE_PATH = join(ROOT, 'scripts', 'shipped-orphan-baseline.json');

// ── 3. DECLARED INVARIANTS ───────────────────────────────────────────────
//
// Add a line when you land something a future session could silently revert.
// Keep the reason attached: an invariant nobody can explain gets deleted the
// first time it is inconvenient.
const MUST_APPEAR = [
  { s: '.ov-hero-value', why: 'dashboard Overview leads with one hero figure (2026-08-21)' },
  { s: '.pop-hero-value', why: 'popup leads with one hero figure (2026-08-21)' },
  { s: 'caught today', why: 'the hero label reaches the built bundle, not just the source' },
];

const MUST_NOT_APPEAR = [
  { s: '.ov-kpi-row', why: 'six-tile Overview row restated the sentence above it; deleted 2026-08-21' },
  { s: '.kpi-tile', why: 'dead activity-kpi-row block, shipped for weeks with nothing rendering it' },
  { s: '.pop-usage', why: 'dead popup usage table; the spec listed it as open long after it was gone' },
];

// Regex form, for shapes rather than literals.
const MUST_NOT_MATCH = [
  {
    re: /data-tab="?activity"?\]\s*\.dash-(tabs|header)/,
    why: 'per-tab chrome made the header and tab bar jump between tabs; the first thing an outside reviewer named (2026-08-21)',
  },
];

// ── 4. ORPHAN SCAN CONFIG ────────────────────────────────────────────────
//
// Classes assembled at runtime (`fc-platform-${p}`) can never be found by a
// literal scan. Prefixes listed here are skipped rather than reported, so the
// signal stays worth reading.
const DYNAMIC_PREFIXES = [
  'fc-platform-', 'fc-tech-', 'h1', 'h2', 'h3', 'h4', 'h5',
  'depth', 'sev-', 'tone-', 'pf-', 'lang-', 'theme-',
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function newestMtime(files) {
  let newest = 0;
  let at = null;
  for (const f of files) {
    const m = statSync(f).mtimeMs;
    if (m > newest) { newest = m; at = f; }
  }
  return { newest, at };
}

const failures = [];
const notes = [];

function fail(check, detail) { failures.push({ check, detail }); }

// ── run ──────────────────────────────────────────────────────────────────
if (!existsSync(DIST)) {
  console.error('\nNo dist/. Run `npm run build` first.\n');
  process.exit(1);
}

const distFiles = walk(DIST);
const srcFiles = walk(join(ROOT, 'src')).concat([join(ROOT, 'manifest.json')]);

// 1. staleness
{
  const src = newestMtime(srcFiles);
  const dist = newestMtime(distFiles);
  if (src.newest > dist.newest) {
    const mins = Math.round((src.newest - dist.newest) / 60000);
    fail('staleness',
      `dist is OLDER than src by ~${mins} min. Newest source: ${src.at.replace(ROOT, '.')}\n`
      + '        A stale bundle passes every grep below against the PREVIOUS change, so this\n'
      + '        check runs first. Run `npm run build` and try again.');
  } else {
    notes.push(`dist is current (newest src ${Math.round((dist.newest - src.newest) / 60000)} min older than newest build output)`);
  }
}

// 2. version
{
  const repoV = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8')).version;
  const distManifest = join(DIST, 'manifest.json');
  if (!existsSync(distManifest)) fail('version', 'dist/manifest.json is missing');
  else {
    const distV = JSON.parse(readFileSync(distManifest, 'utf8')).version;
    if (distV !== repoV) fail('version', `repo manifest says ${repoV}, shipped manifest says ${distV}`);
    else notes.push(`version ${repoV} matches in repo and dist`);
  }
}

// text assets only — a scan that reads a PNG as utf8 wastes time and can match by accident
const TEXT_EXT = new Set(['.js', '.css', '.html', '.json', '.mjs', '.map']);
const textAssets = distFiles
  .filter((f) => TEXT_EXT.has(extname(f)))
  .map((f) => ({ f, t: readFileSync(f, 'utf8') }));

const shipped = textAssets.map((a) => a.t).join('\n');

// 3. declared invariants
for (const { s, why } of MUST_APPEAR) {
  if (!shipped.includes(s)) fail('must-appear', `"${s}" is NOT in the shipped assets — ${why}`);
}
for (const { s, why } of MUST_NOT_APPEAR) {
  const where = textAssets.filter((a) => a.t.includes(s)).map((a) => a.f.replace(DIST, 'dist'));
  if (where.length) fail('must-not-appear', `"${s}" IS shipping (${where.join(', ')}) — ${why}`);
}
for (const { re, why } of MUST_NOT_MATCH) {
  const where = textAssets.filter((a) => re.test(a.t)).map((a) => a.f.replace(DIST, 'dist'));
  if (where.length) fail('must-not-match', `${re} matches in ${where.join(', ')} — ${why}`);
}
if (!failures.some((f) => f.check.startsWith('must-'))) {
  notes.push(`${MUST_APPEAR.length} must-appear and ${MUST_NOT_APPEAR.length + MUST_NOT_MATCH.length} must-not-appear invariants hold`);
}

// 4. orphan selectors, ratcheted
const css = textAssets.filter((a) => extname(a.f) === '.css').map((a) => a.t).join('\n');
const js = textAssets.filter((a) => ['.js', '.html'].includes(extname(a.f))).map((a) => a.t).join('\n');

const declared = new Set();
// class tokens in selector position: strip comments, then read `.name` before { , : [ etc.
for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
  declared.add(m[1]);
}
const orphans = [...declared]
  .filter((c) => !DYNAMIC_PREFIXES.some((p) => c.startsWith(p)))
  .filter((c) => !js.includes(c))
  .sort();

let baseline = { count: Infinity, recorded: null, note: '' };
if (existsSync(BASELINE_PATH)) baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));

if (process.argv.includes('--record-baseline')) {
  writeFileSync(BASELINE_PATH, JSON.stringify({
    count: orphans.length,
    recorded: '(stamp this by hand or via the caller; scripts here take no clock)',
    note: 'Ratchet. This number may go DOWN and never up. Raising it needs a reason in the commit message.',
    sample: orphans.slice(0, 40),
  }, null, 2) + '\n', 'utf8');
  console.log(`\nBaseline recorded: ${orphans.length} orphan selectors.\n`);
} else if (orphans.length > baseline.count) {
  fail('orphan-ratchet',
    `${orphans.length} orphan CSS classes, baseline is ${baseline.count}. New ones:\n        `
    + orphans.slice(0, 15).join(', ')
    + '\n        Dead CSS that looks load-bearing is worse than no CSS. Delete it, or if these are\n'
    + '        assembled at runtime add the prefix to DYNAMIC_PREFIXES in this file.');
} else {
  notes.push(`${orphans.length} orphan CSS classes (baseline ${baseline.count === Infinity ? 'unset' : baseline.count}, ratchet holds)`);
}

// ── report ───────────────────────────────────────────────────────────────
console.log('');
for (const n of notes) console.log(`  ok    ${n}`);
for (const f of failures) console.log(`  FAIL  [${f.check}] ${f.detail}`);
console.log('');
if (failures.length) {
  console.log(`  ${failures.length} check(s) failed. Nothing here is about the source: every one of these`);
  console.log('  is about what a user would actually receive.\n');
  process.exit(1);
}
console.log('  The shipped build matches what the source claims.\n');
