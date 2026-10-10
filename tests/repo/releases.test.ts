// docs/spec/RELEASES.tsv: every zip uploaded to the Chrome Web Store, the commit it was built from,
// the Node version, and the hashes of its files and of the zip.
//
// The public repository's CI rebuilds each upload its source was built from and compares it with
// this file, so a row that names the wrong commit or version would make that check compare the
// wrong thing, or nothing. In this repository every row is held to the history it names. In the
// public copy, which has none of that history, a row naming the copy's own commit must hold the
// version the copy's manifest says, and on an upload's tag that row must exist.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { RELEASES_PATH, RELEASE_COLUMNS, parseReleases, productConfig } from '../../scripts/reproducible-build.mjs';
import { REPO_ROOT, repoPath } from '../helpers/repo-root';

const text = readFileSync(repoPath(...RELEASES_PATH.split('/')), 'utf8');
const rows = parseReleases(text);
const IN_PUBLIC_COPY = existsSync(repoPath('SOURCE-COMMIT'));
const header = RELEASE_COLUMNS.join('\t');
const row = ['receipts', '2.5.9', 'b'.repeat(40), '24.14.0', 'c'.repeat(64), 'd'.repeat(64), '2026-09-16'];

/** What git printed, or the error it threw, kept for the case that reads it. */
type GitAnswer = { out: string } | { error: unknown };

function git(args: string[]): GitAnswer {
  try {
    return { out: execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }) };
  } catch (error) {
    return { error };
  }
}

// Git is asked about every row here, while vitest imports this file, because vitest puts no time
// limit on an import and two git processes per row can outlast the per-test limit on a busy machine.
const HISTORY = IN_PUBLIC_COPY ? [] : rows.map((r) => ({
  ancestor: git(['merge-base', '--is-ancestor', r.commit, 'HEAD']),
  manifest: git(['show', `${r.commit}:${productConfig(r.product).manifest}`]),
}));

describe('the list of uploaded builds', () => {
  it('reads as rows, one per product and version', () => {
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => `${r.product} ${r.version}`)).size).toBe(rows.length);
  });

  it.skipIf(IN_PUBLIC_COPY)('names commits in this history, each holding the version its row says', () => {
    for (const [i, r] of rows.entries()) {
      const { ancestor, manifest } = HISTORY[i];
      // Throws when the commit is not an ancestor: an object left over from a deleted branch is not enough.
      if ('error' in ancestor) throw ancestor.error;
      if ('error' in manifest) throw manifest.error;
      expect(JSON.parse(manifest.out).version, `${r.product} ${r.version}`).toBe(r.version);
    }
  });

  it.runIf(IN_PUBLIC_COPY)('records the upload this copy is the source of, when it is one', () => {
    const commit = readFileSync(repoPath('SOURCE-COMMIT'), 'utf8').trim();
    const mine = rows.filter((r) => r.commit === commit);
    // Most commits of the public repository are updates between uploads and built nothing that was
    // uploaded; the public check runs on a tag v<version> only for the commit an upload came from.
    if (process.env.GITHUB_REF?.startsWith('refs/tags/v')) expect(mine.length, `a row built from ${commit}`).toBeGreaterThan(0);
    for (const r of mine) {
      expect(JSON.parse(readFileSync(repoPath(productConfig(r.product).manifest), 'utf8')).version).toBe(r.version);
    }
  });

  it('the Node version uploads are built with is pinned to the patch', () => {
    // The zip's compression is Node's zlib, so "24" is not enough to get the same bytes.
    expect(readFileSync(repoPath('.nvmrc'), 'utf8')).toMatch(/^\d+\.\d+\.\d+\n$/);
  });

  describe('the reader refuses what would turn a comparison into "not recorded"', () => {
    const read = (...lines: string[]) => () => parseReleases(`${lines.join('\n')}\n`);

    it('reads a well-formed row, notes and an added column', () => {
      expect(read('# a note', header, row.join('\t'))()).toEqual([
        { product: 'receipts', version: '2.5.9', commit: 'b'.repeat(40), node: '24.14.0', filesSha256: 'c'.repeat(64), zipSha256: 'd'.repeat(64), uploaded: '2026-09-16' },
      ]);
      // Columns may be added at the end, so a copy of an older reader still reads a newer file.
      expect(read(`${header}\tnote`, `${row.join('\t')}\tanything`)()).toHaveLength(1);
    });

    it('refuses a header out of order, a short hash, capitals, a product it does not know and a repeat', () => {
      expect(read(header.replace('node\tfiles_sha256', 'files_sha256\tnode'), row.join('\t'))).toThrow(/header/);
      expect(read(header, row.map((c, i) => (i === 2 ? 'b56ed67' : c)).join('\t'))).toThrow(/source_commit/);
      expect(read(header, row.map((c, i) => (i === 5 ? 'D'.repeat(64) : c)).join('\t'))).toThrow(/zip_sha256/);
      expect(read(header, row.map((c, i) => (i === 0 ? 'both' : c)).join('\t'))).toThrow(/product/);
      expect(read(header, row.map((c, i) => (i === 3 ? '24' : c)).join('\t'))).toThrow(/node/);
      expect(read(header, row.join('\t'), row.join('\t'))).toThrow(/listed twice/);
      expect(read(header, row.slice(0, 6).join('\t'))).toThrow(/cells/);
    });
  });
});
