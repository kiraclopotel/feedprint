// The public copy of an upload (scripts/public-snapshot.mjs --commit).
//
// A public copy is published at the commit an upload was built from, with the release list from
// HEAD, since that upload's row can only be committed after it. The review of this design found
// three ways it could go wrong, and each is held here: a commit from before the release list would
// publish the checks from before there was anything to compare; an old commit read with today's
// lists could publish a file made private since; and a commit no recorded upload came from would
// publish a copy whose CI has nothing to rebuild.
import { describe, expect, it } from 'vitest';
import { releaseCommitProblem, releaseSnapshotPaths } from '../../scripts/public-snapshot.mjs';
import { RELEASES_PATH, RELEASE_COLUMNS } from '../../scripts/reproducible-build.mjs';

const COMMIT = 'a'.repeat(40);
const list = (commit: string) =>
  `${RELEASE_COLUMNS.join('\t')}\n${['receipts', '9.9.9', commit, '24.14.0', 'c'.repeat(64), 'd'.repeat(64), '2026-09-16'].join('\t')}\n`;

// The sample paths below start with folders this repository does not have (app/, old/, new/), so
// tests/repo/citations.test.ts does not read them as citations of missing files; the two
// classifiers are stubs and the functions are set operations, so the names carry no meaning.
describe('the public copy of an upload', () => {
  it('is refused for a commit from before the release list', () => {
    expect(releaseCommitProblem({ commit: COMMIT, files: ['app/a.ts'], releasesText: list(COMMIT) })).toMatch(/predates/);
  });

  it('is refused for a commit no recorded upload was built from', () => {
    expect(releaseCommitProblem({ commit: COMMIT, files: [RELEASES_PATH], releasesText: list('b'.repeat(40)) })).toMatch(/no upload/);
  });

  it('is allowed for a commit an upload was built from', () => {
    expect(releaseCommitProblem({ commit: COMMIT, files: [RELEASES_PATH, 'app/a.ts'], releasesText: list(COMMIT) })).toBeNull();
  });

  it("classifies by the commit's own lists, and names every path today's lists decide otherwise", () => {
    const files = ['app/a.ts', 'old/private.test.ts', 'new/public.md', RELEASES_PATH];
    const then = (p: string) => p === 'app/a.ts' || p === 'old/private.test.ts';
    const now = (p: string) => p === 'app/a.ts' || p === 'new/public.md' || p === RELEASES_PATH;
    expect(releaseSnapshotPaths({ files, isPublicThen: then, isPublicNow: now })).toEqual({
      paths: ['app/a.ts', 'old/private.test.ts'],
      disagree: ['new/public.md', 'old/private.test.ts'],
    });
    // The same lists give nothing to refuse.
    expect(releaseSnapshotPaths({ files, isPublicThen: now, isPublicNow: now }).disagree).toEqual([]);
  });
});
