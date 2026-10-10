#!/usr/bin/env node
// Lists every commit in a git range whose unit of work has no review verdict, read from the
// journals a workflow run leaves behind, so a branch is not joined while a reviewer's silence
// could pass for approval. A unit has a verdict when its last review answered "ok", or answered
// "problems" and a repair returned after it.
//
// A journal is the journal.jsonl a Claude Code workflow run writes: one JSON line per agent start,
// answer or failure. Units are read from agent labels "work:<id>" or "fix:<id>", "review:<id>" (or
// "review2:<id>") and "repair:<id>", one unit per id within one journal. A commit belongs to a unit
// when the "commit" or "commits" field of that unit's work or repair answer names it.
//
// Read only: it reads the journals and runs git log and git rev-list, nothing else.
// Exit 0 when every commit has a verdict, 1 when some do not, 2 when there was nothing to check.
//
// Usage: node scripts/dev/review-verdicts.mjs <from>..<to> <journal.jsonl or folder>... [--repo <path>] [--all]
//   A folder is searched for journal.jsonl in itself and in each folder directly inside it.
//   --all also prints the commits that do have a verdict.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const WORK_ROLES = new Set(['work', 'fix']);

/** The unit an agent label belongs to, or null for agents that are not part of a reviewed unit. */
export function roleOf(label) {
  if (typeof label !== 'string') return null;
  const at = label.indexOf(':');
  if (at < 1) return null;
  const head = label.slice(0, at);
  const id = label.slice(at + 1).trim();
  if (!id) return null;
  if (WORK_ROLES.has(head)) return { role: 'work', id };
  if (/^review\d*$/.test(head)) return { role: 'review', id };
  if (head === 'repair') return { role: 'repair', id };
  return null;
}

// A hash is matched only against the commits of the range later, so a hex-looking word in a
// commit subject cannot claim a commit by accident.
const HEX = /(?<![0-9A-Za-z])[0-9a-f]{7,40}(?![0-9A-Za-z])/g;

function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) strings(v, out);
  return out;
}

/** Every hash-shaped word in an answer's "commit" and "commits" fields, lowercase. */
export function commitTokens(answer) {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return [];
  const tokens = [];
  for (const field of ['commits', 'commit']) {
    for (const text of strings(answer[field])) for (const m of text.matchAll(HEX)) tokens.push(m[0]);
  }
  return tokens;
}

/**
 * Reads one journal's text into units, each with its events in the order the journal wrote them.
 * A line that does not parse is counted, never guessed at: losing a line can only lose an answer,
 * which leaves a unit without a verdict rather than giving it one.
 */
export function parseJournal(text, name) {
  const labels = new Map();
  const units = new Map();
  let badLines = 0;
  let plainAnswers = 0;
  let unknownKeys = 0;
  const unitFor = (id) => {
    if (!units.has(id)) units.set(id, { journal: name, id, events: [] });
    return units.get(id);
  };
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      badLines++;
      continue;
    }
    if (!entry || typeof entry !== 'object') {
      badLines++;
      continue;
    }
    if (entry.type === 'started') {
      const r = roleOf(entry.label);
      labels.set(entry.key, r);
      if (r) unitFor(r.id).events.push({ role: r.role, what: 'started', key: entry.key });
      continue;
    }
    if (entry.type !== 'result' && entry.type !== 'failed') continue;
    if (!labels.has(entry.key)) {
      unknownKeys++;
      continue;
    }
    const r = labels.get(entry.key);
    if (!r) continue;
    const unit = unitFor(r.id);
    if (entry.type === 'failed') {
      unit.events.push({ role: r.role, what: 'failed', key: entry.key });
      continue;
    }
    const answer = entry.result;
    const structured = answer !== null && typeof answer === 'object' && !Array.isArray(answer);
    if (!structured && r.role !== 'review') plainAnswers++;
    unit.events.push({
      role: r.role,
      what: 'returned',
      key: entry.key,
      verdict: structured && (answer.verdict === 'ok' || answer.verdict === 'problems') ? answer.verdict : null,
      status: structured && typeof answer.status === 'string' ? answer.status : null,
      commits: r.role === 'review' ? [] : commitTokens(answer),
    });
  }
  return { name, units: [...units.values()], badLines, plainAnswers, unknownKeys };
}

/** Whether a unit has a review verdict, and in words why not when it has none. */
export function unitVerdict(unit) {
  let verdict = null;
  let repaired = false;
  let repairState = '';
  let failed = 0;
  let silent = 0;
  let workStatus = null;
  const open = new Set();
  for (const e of unit.events) {
    if (e.role === 'work' && e.what === 'returned') workStatus = e.status;
    if (e.role === 'review') {
      if (e.what === 'started') {
        open.add(e.key);
        continue;
      }
      open.delete(e.key);
      if (e.what === 'failed') failed++;
      else if (e.verdict) {
        verdict = e.verdict;
        repaired = false;
        repairState = '';
      } else silent++;
      continue;
    }
    if (e.role === 'repair' && verdict === 'problems' && !repaired) {
      // A repair that says it was blocked fixed nothing, so the problems still stand.
      if (e.what === 'returned' && e.status !== 'blocked') repaired = true;
      else if (e.what === 'returned') repairState = 'its repair was blocked';
      else if (e.what === 'failed') repairState = 'its repair returned nothing';
      else repairState = 'its repair has not returned';
    }
  }
  if (verdict === 'ok') return { covered: true, reason: 'the review said ok' };
  if (verdict === 'problems' && repaired) return { covered: true, reason: 'the review found problems and a repair returned' };
  if (verdict === 'problems') return { covered: false, reason: `the review found problems and ${repairState || 'no repair ran'}` };
  if (open.size > 0) return { covered: false, reason: 'its review has not returned' };
  if (failed > 0) return { covered: false, reason: failed > 1 ? `its review returned nothing, ${failed} times` : 'its review returned nothing' };
  if (silent > 0) return { covered: false, reason: 'its review answered without a verdict' };
  return { covered: false, reason: workStatus ? `no review ran (the work answered ${workStatus})` : 'no review ran' };
}

/**
 * Pairs each commit with the units whose work or repair answers name it. A commit is covered when
 * any unit naming it has a verdict; it is listed when none does, or when no unit names it at all.
 */
export function checkCommits(journals, commits) {
  const claims = [];
  for (const j of journals) {
    for (const unit of j.units) {
      const tokens = new Set(unit.events.flatMap((e) => e.commits ?? []).map((t) => t.toLowerCase()));
      if (tokens.size > 0) claims.push({ unit, tokens: [...tokens], verdict: unitVerdict(unit) });
    }
  }
  return commits.map((c) => {
    const hash = c.hash.toLowerCase();
    const units = claims
      .filter((claim) => claim.tokens.some((t) => hash.startsWith(t)))
      .map((claim) => ({ journal: claim.unit.journal, id: claim.unit.id, ...claim.verdict }));
    return { ...c, units, covered: units.some((u) => u.covered) };
  });
}

function git(args, repo) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
}

/** The range's commits, newest first, without merges, and how many merges it holds. */
export function readCommits(range, repo = REPO_ROOT) {
  if (typeof range !== 'string' || !range.includes('..') || range.startsWith('-') || /\s/.test(range)) {
    throw new Error(`a range looks like <from>..<to>, not ${JSON.stringify(range)}`);
  }
  const commits = git(['log', '--no-merges', '--format=%H%x09%s', range, '--'], repo)
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      return { hash: line.slice(0, tab), subject: line.slice(tab + 1) };
    });
  const merges = Number(git(['rev-list', '--count', '--merges', range, '--'], repo).trim());
  return { commits, merges };
}

/** The journal files a list of files and folders holds, each once, in path order. */
export function journalFiles(paths) {
  const found = new Set();
  for (const p of paths) {
    const abs = resolve(p);
    if (!existsSync(abs)) throw new Error(`no such file or folder: ${p}`);
    if (statSync(abs).isFile()) {
      found.add(abs);
      continue;
    }
    const before = found.size;
    if (existsSync(join(abs, 'journal.jsonl'))) found.add(join(abs, 'journal.jsonl'));
    for (const d of readdirSync(abs, { withFileTypes: true })) {
      if (d.isDirectory() && existsSync(join(abs, d.name, 'journal.jsonl'))) found.add(join(abs, d.name, 'journal.jsonl'));
    }
    if (found.size === before) throw new Error(`no journal.jsonl in ${p} or in the folders directly inside it`);
  }
  return [...found].sort();
}

function journalName(file) {
  return basename(file) === 'journal.jsonl' ? basename(dirname(file)) : basename(file);
}

/** The command line, run in this process: prints through `print` and returns the exit code. */
export function run(argv, print = (line) => console.log(line)) {
  let repo = REPO_ROOT;
  let all = false;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo') repo = resolve(argv[++i] ?? '');
    else if (argv[i] === '--all') all = true;
    else rest.push(argv[i]);
  }
  const [range, ...paths] = rest;
  if (!range || paths.length === 0) {
    print('usage: node scripts/dev/review-verdicts.mjs <from>..<to> <journal.jsonl or folder>... [--repo <path>] [--all]');
    return 2;
  }
  let journals;
  let commits;
  let merges;
  try {
    journals = journalFiles(paths).map((f) => parseJournal(readFileSync(f, 'utf8'), journalName(f)));
    ({ commits, merges } = readCommits(range, repo));
  } catch (err) {
    const detail = err && err.stderr ? String(err.stderr).trim() : err && err.message ? err.message : String(err);
    print(`FAIL  ${detail}`);
    return 2;
  }
  const unitCount = journals.reduce((n, j) => n + j.units.length, 0);
  print(`${journals.length} journal(s), ${unitCount} unit(s); ${range} holds ${commits.length} commit(s)${merges ? ` and ${merges} merge(s)` : ''}`);
  const bad = journals.reduce((n, j) => n + j.badLines, 0);
  if (bad) print(`note  ${bad} journal line(s) could not be read; an answer on them counts as missing`);
  const plain = journals.reduce((n, j) => n + j.plainAnswers, 0);
  if (plain) print(`note  ${plain} work or repair answer(s) were plain text, so a commit they made shows as named by no unit`);
  const unknown = journals.reduce((n, j) => n + j.unknownKeys, 0);
  if (unknown) print(`note  ${unknown} answer(s) belong to no agent start in their journal and were not read`);
  if (merges) print('note  merges are not listed: a merge brings in commits that are listed here on their own');
  if (commits.length === 0) {
    print(`FAIL  ${range} holds no commit to check; is the range the right way round?`);
    return 2;
  }
  const checked = checkCommits(journals, commits);
  const missing = checked.filter((c) => !c.covered);
  for (const c of checked) {
    if (c.covered && !all) continue;
    print(`${c.covered ? 'ok          ' : 'NO VERDICT  '}${c.hash.slice(0, 8)}  ${c.subject}`);
    if (c.units.length === 0) print('            no unit in these journals names this commit');
    for (const u of c.units) print(`            unit ${u.id} in ${u.journal}: ${u.reason}`);
  }
  if (missing.length === 0) {
    print(`PASS  every one of the ${commits.length} commit(s) belongs to a unit with a review verdict`);
    return 0;
  }
  print(`FAIL  ${missing.length} of ${commits.length} commit(s) have no review verdict`);
  return 1;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  process.exitCode = run(process.argv.slice(2));
}
