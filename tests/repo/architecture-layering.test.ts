import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LAYERS, TOLERATED } from '../../eslint.config.mjs';
import { REPO_ROOT as ROOT } from '../helpers/repo-root';
import { TREE_READ_TIMEOUT_MS } from '../helpers/spawn-timeout';

// Reads the whole tree or asks git, which outlasts the 5s default on a busy machine; see the helper.
vi.setConfig({ testTimeout: TREE_READ_TIMEOUT_MS });

// Guards the layering rule seeded in eslint.config.mjs (ARCHITECTURE-1, Proposal C,
// docs/audits/2026-08-23-objective-audit/wave4-architecture/architecture.md).
// The rule itself is enforced by `eslint.config.mjs` via
// `@typescript-eslint/no-restricted-imports`; every pre-existing violation was seeded
// as an `eslint-disable-next-line` carrying the marker below so `npx eslint .` stays
// green. This test is the ratchet: the marker count may only go down.
//
// Re-measured 2026-08-23 on branch p2-tooling (~105 commits past the audited
// d5bb79a, after large refactors): 51 markers, up from the audit's original 34.
// Wave 8 of PLAN-2026-09-16 takes it down by moving modules into the layer they belong to; the
// count below falls with each of those commits, and a marker may never be added to keep it green.
//
// If this test fails because the count went UP: you added a new cross-layer
// import. Do not add another marker to paper over it — route the import through
// the correct layer (see the eslint.config.mjs comment for the allowed
// directions), or get an explicit decision to widen the layering rule.
//
// A count that went down still passes, so nothing forces the ratchet tighter: lower
// SEEDED_COUNT to the new number yourself, or a later import can take the freed place unseen.
const MARKER = 'ARCHITECTURE-1 layering violation';
const SEEDED_COUNT = 8;

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(abs));
    } else if (entry.isFile() && ['.ts', '.tsx'].includes(extname(entry.name))) {
      out.push(abs);
    }
  }
  return out;
}

describe('architecture layering (ARCHITECTURE-1, Proposal C)', () => {
  // Every file under src is read here, while vitest collects this file, because collecting has no
  // time limit and reading all of src can outlast the per-test limit on a busy machine.
  const texts = listSourceFiles(join(ROOT, 'src')).map((file) => readFileSync(file, 'utf8'));

  it('keeps the seeded layering-violation marker count at or below the last recorded total', () => {
    // A count of zero markers is only a pass when src/ was actually read.
    expect(texts.length).toBeGreaterThan(300);
    let count = 0;
    for (const text of texts) {
      const matches = text.match(new RegExp(MARKER, 'g'));
      count += matches ? matches.length : 0;
    }
    expect(
      count,
      `found ${count} "${MARKER}" markers under src/, expected <= ${SEEDED_COUNT}. ` +
        'If you fixed a violation, lower SEEDED_COUNT in this test to match. ' +
        'If you added one, route the import through the correct layer instead.',
    ).toBeLessThanOrEqual(SEEDED_COUNT);
  });
});

// ── The table itself (PLAN-2026-09-16 item 8.11) ────────────────────────────────────────────────
//
// The per-folder lint rules are generated from one ordered list in eslint.config.mjs. Two ways that
// can rot: a new folder appears in src/ and nobody places it, so it is silently unruled; or a
// tolerated upward import outlives the import it was written for. Both are checked here.
describe('the layer table covers src as it is', () => {
  it('names every folder under src/, in order, and nothing that is not there', () => {
    const folders = readdirSync(join(ROOT, 'src'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect([...LAYERS].sort()).toEqual(folders);
  });

  it('tolerates an upward import only where one exists, and only from a named folder', () => {
    for (const [layer, allowed] of Object.entries(TOLERATED)) {
      expect(LAYERS, `${layer} is not a layer`).toContain(layer);
      for (const target of allowed as string[]) {
        expect(LAYERS, `${layer} tolerates ${target}, which is not a layer`).toContain(target);
        expect(LAYERS.indexOf(target), `${layer} -> ${target} is not an upward import`)
          .toBeGreaterThan(LAYERS.indexOf(layer));
        const importers = listSourceFiles(join(ROOT, 'src', layer)).filter((f) => {
          const text = readFileSync(f, 'utf8');
          return new RegExp(`from '(\.\./)+${target}/`).test(text);
        });
        expect(importers.length, `${layer} no longer imports ${target}: take the line out`)
          .toBeGreaterThan(0);
      }
    }
  });
});
