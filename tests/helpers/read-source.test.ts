// The source reader refuses the two ways a text scan passes while reading nothing
// (PLAN-2026-09-16 item 7.2).
import { describe, expect, it } from 'vitest';
import { readSource } from './read-source';
import { REPO_ROOT, repoPath } from './repo-root';

describe('readSource', () => {
  it('reads a real source file from the repository root, whatever folder the test sits in', () => {
    const text = readSource('src/storage/usage-weights.ts');
    expect(text).toContain('chatTokenEquivalents');
    expect(repoPath('package.json').startsWith(REPO_ROOT)).toBe(true);
  });

  it('refuses a file that is too small to be the subject of a scan', () => {
    expect(() => readSource('.nvmrc')).toThrow(/under the .*floor for a source scan/);
  });

  it('refuses a file that is only imports and re-exports', () => {
    // A split leaves a shim like this behind; a scan of it would pass against no content.
    // The floor is lowered here so the re-export check is what refuses it, not the size.
    expect(() => readSource('tests/fixtures/re-export-shim.ts', { minBytes: 1 }))
      .toThrow(/only imports and re-exports/);
  });

  it('says which file it refused, so the fix is obvious', () => {
    expect(() => readSource('.nvmrc')).toThrow(/^\.nvmrc is/);
  });

  it('lets a caller raise the floor for a file it knows is large', () => {
    expect(() => readSource('src/storage/usage-weights.ts', { minBytes: 10_000_000 })).toThrow(/10000000-byte floor/);
  });
});
