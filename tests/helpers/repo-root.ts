// Where the repository starts, for a test that reads a file (PLAN-2026-09-16 item 7.2).
//
// Twenty-nine test files computed this themselves, in two spellings, each counting the folders
// between itself and the root. That count is what breaks when a test moves: wave 11 moves most of
// this suite into folders that mirror src, and a depth written into every file would have to be
// rewritten in every file. Here it is computed once, from this file's own place.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of the repository root. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A path inside the repository, from its root: `repoPath('src', 'ai', 'client.ts')`. */
export function repoPath(...parts: string[]): string {
  return join(REPO_ROOT, ...parts);
}
