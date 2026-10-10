// The moved-path ledger (PLAN-2026-09-16, rule 4). Citations in history files and in the two
// frozen judge files are never edited when their target moves; they resolve through the ledger.
// So every row must point at a file that exists, and the public half must be exactly the rows a
// reader of the public source can follow. In the public copy only the public half exists.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPublicPath } from '../../scripts/public-snapshot.mjs';

import { REPO_ROOT as ROOT } from '../helpers/repo-root';
const PRIVATE_LEDGER = 'docs/MOVED.tsv';
const PUBLIC_LEDGER = 'docs/spec/MOVED-PUBLIC.tsv';
const HEADER = 'old_path\tnew_path\titem';

type Row = { old: string; now: string; item: string; line: number };

function readLedger(path: string): Row[] {
  const lines = readFileSync(join(ROOT, path), 'utf8').split(/\r?\n/);
  const body = lines.map((text, i) => ({ text, line: i + 1 })).filter(({ text }) => text && !text.startsWith('#'));
  expect(body[0]?.text, `${path} header`).toBe(HEADER);
  return body.slice(1).map(({ text, line }) => {
    const cells = text.split('\t');
    expect(cells.length, `${path}:${line} has three cells`).toBe(3);
    return { old: cells[0], now: cells[1], item: cells[2], line };
  });
}

describe('moved-path ledger', () => {
  it('every public row points at a file that exists, once per old path', () => {
    const rows = readLedger(PUBLIC_LEDGER);
    const seen = new Set<string>();
    for (const r of rows) {
      expect(existsSync(join(ROOT, r.now)), `${PUBLIC_LEDGER}:${r.line} ${r.now}`).toBe(true);
      expect(seen.has(r.old), `${PUBLIC_LEDGER}:${r.line} repeats ${r.old}`).toBe(false);
      seen.add(r.old);
    }
  });

  it.runIf(existsSync(join(ROOT, PRIVATE_LEDGER)))('every row exists, and the public half is exactly the rows public at both ends', () => {
    const rows = readLedger(PRIVATE_LEDGER);
    for (const r of rows) {
      expect(existsSync(join(ROOT, r.now)), `${PRIVATE_LEDGER}:${r.line} ${r.now}`).toBe(true);
    }
    const expected = rows.filter((r) => isPublicPath(r.old) && isPublicPath(r.now)).map((r) => [r.old, r.now, r.item].join('\t'));
    const actual = readLedger(PUBLIC_LEDGER).map((r) => [r.old, r.now, r.item].join('\t'));
    expect(actual).toEqual(expected);
  });
});
