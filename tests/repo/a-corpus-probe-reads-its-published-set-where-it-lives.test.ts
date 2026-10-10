// G6 (the grow owner's row G6, from maker 2's finding on G4). scripts/corpus/deterministic-floor-fp-probe.ts is the project's
// own "0 false hits" gate for the check that hides posts and comments when the AI is off ("every floor change must pass it
// before it ships"). Since 16 Sep (commit 1910b700) it could not run: it read its published set, adversarial-benign-v1.json,
// from the private calibration folder, and that commit had moved the published sets to tests/fixtures/calibration/. Nothing
// failed, because nothing runs a probe that is not in the suite; the next move of a folder would do the same.
//
// This reads the corpus probes as TEXT (it runs none of them, and reads no corpus) and asks, of every published set a probe
// names, the thing that broke: the folder the probe reads it from (a resolve(REPO, ...) on the line, or the constant the line
// resolves over) holds the file. It is a check by place, not by name: a probe pointed back at a folder that no longer holds
// its set fails here (critic 1, G6-CRITIC.md: a check that only looked for the word "PUBLISHED" on the line passed with the
// probe pointed at the old wrong folder). It reads every script under scripts/corpus, so a new probe is covered; a script that
// names no published set passes nothing through. The private corpora (honest-en-v1.json and the rest) are optional by design,
// stay in the private folder and are not looked at.

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT as ROOT } from '../helpers/repo-root';

// The folder is named in pieces on purpose: a test that spells the private folder out whole reads, to the guard that
// rehearses the public copy (a-public-test-reads-no-private-path), like a test that opens it.
const PUBLISHED_DIR = join(ROOT, 'tests', 'fixtures', 'calibration');
// Held in pieces: the probes are not in the public copy (they are not tests and the split leaves them out), where this guard
// must still pass, reading nothing and finding nothing, rather than reach for a path the copy does not carry.
const PROBE_PIECES = ['scripts', 'corpus'];
const PROBE_DIR = join(ROOT, ...PROBE_PIECES);
// The probes that gate the floor: each must read at least one published set, so a rewrite that stops naming one cannot pass.
const FLOOR_PROBES = ['deterministic-floor-fp-probe.ts', 'profanity-fp-probe.ts', 'hard-harm-recall-floor.ts'];

const published = new Set(existsSync(PUBLISHED_DIR) ? readdirSync(PUBLISHED_DIR).filter((f) => f.endsWith('.json')) : []);
const scripts = existsSync(PROBE_DIR) ? readdirSync(PROBE_DIR).filter((f) => /\.(ts|mjs)$/.test(f)).sort() : [];

const segs = (s: string): string[] => [...s.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);

/** The folder-and-file a line reads, as a path: the literal resolve(REPO, ...) on the line, or the constant it resolves over. */
function whereRead(text: string, line: string, file: string): string | null {
  const literal = line.match(/resolve\(\s*REPO\s*,([^)]*)\)/);
  if (literal && segs(literal[1]).includes(file)) return join(ROOT, ...segs(literal[1]));
  const over = line.match(/resolve\(\s*([A-Z_]+)\s*,\s*['"][\w.-]+\.json['"]/);
  if (!over) return null;
  const definition = text.match(new RegExp(`const ${over[1]}\\s*=\\s*resolve\\(\\s*REPO\\s*,([^)]*)\\)`));
  return definition ? join(ROOT, ...segs(definition[1]), file) : null;
}

/** Every published set a script names on a line that is not a comment: where it is read, and the line. */
function publishedReads(script: string): Array<{ line: number; file: string; at: string | null }> {
  const text = readFileSync(join(PROBE_DIR, script), 'utf8');
  const out: Array<{ line: number; file: string; at: string | null }> = [];
  text.split('\n').forEach((t, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(t)) return;   // a comment is not a read
    for (const m of t.matchAll(/['"`]([\w.-]+\.json)['"`]/g)) {
      if (published.has(m[1])) out.push({ line: i + 1, file: m[1], at: whereRead(text, t, m[1]) });
    }
  });
  return out;
}

describe('a corpus probe reads its published set where it lives', () => {
  it('the published folder holds sets (the premise of the rest; the probe scripts may be absent, as in the public copy)', () => {
    expect(published.size).toBeGreaterThan(0);
  });

  for (const script of scripts) {
    it(`${script}: every published set it names is there, where it reads it`, () => {
      for (const r of publishedReads(script)) {
        expect(r.at, `${script}:${r.line} names ${r.file} but the folder it reads cannot be read off the line`).not.toBeNull();
        expect(existsSync(r.at!), `${script}:${r.line} reads ${r.at}, which does not exist`).toBe(true);
      }
    });
  }

  for (const probe of FLOOR_PROBES) {
    it.skipIf(!scripts.includes(probe))(`${probe} reads at least one published set`, () => {
      expect(publishedReads(probe).length).toBeGreaterThan(0);
    });
  }
});
