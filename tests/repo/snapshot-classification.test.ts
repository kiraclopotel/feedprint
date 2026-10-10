// Nothing is private only by omission (PLAN-2026-09-16, item 0.7). The public snapshot is an
// allowlist, so anything left off it stays private, and that is safe until someone widens a
// prefix. So every top-level entry and every docs/<folder> is named on the allowlist or the
// denylist, and every exact allowlist path is a tracked file (a moved script would otherwise drop
// out of the public tree without a sound). docs/ root files and scripts/ root files are
// containers with their own guards later in the plan (4.13 and 5.10). Inside the public copy
// (which carries SOURCE-COMMIT) every file is public by construction, so only the checks that
// hold there run.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CALIBRATION_ALLOWED, PRIVATE_DENYLIST, PUBLIC_ALLOWLIST, isPublicPath } from '../../scripts/public-snapshot.mjs';

import { REPO_ROOT as ROOT } from '../helpers/repo-root';
const IN_PUBLIC_COPY = existsSync(join(ROOT, 'SOURCE-COMMIT'));

/** Entries decided later, each with the plan item that decides it. The list only shrinks. */
const PENDING: Record<string, string> = {};

function tracked(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
}

function named(entry: string): boolean {
  const all = [...PUBLIC_ALLOWLIST, ...PRIVATE_DENYLIST];
  return all.some((e) => e === entry || (e.endsWith('*') && entry.startsWith(e.slice(0, -1))));
}

/** The unit a path is classified by: its top-level entry, or docs/<folder>/ inside docs. */
function unitOf(path: string): string | null {
  const seg = path.split('/');
  if (seg.length === 1) return path;
  if (seg[0] === 'docs') return seg.length > 2 ? `docs/${seg[1]}/` : null;
  if (seg[0] === 'scripts' && seg.length === 2) return null;
  return `${seg[0]}/`;
}

describe('public snapshot: every unit is classified', () => {
  const files = tracked();

  it('every exact allowlist path is a tracked file', () => {
    // Both lists carry prefixes (ending in /) and exact paths; only the exact ones name a file.
    const exact = [...PUBLIC_ALLOWLIST, ...CALIBRATION_ALLOWED].filter((e) => !e.endsWith('/'));
    expect(exact.filter((e) => !files.includes(e))).toEqual([]);
  });

  it.skipIf(IN_PUBLIC_COPY)('every top-level entry and docs folder is named on a list', () => {
    const units = new Set(files.map(unitOf).filter((u): u is string => u !== null));
    const unnamed = [...units].filter((u) => {
      if (named(u)) return false;
      // A folder is named when an entry names a path inside it (scripts/, tests/ carry exact entries).
      if (u.endsWith('/') && [...PUBLIC_ALLOWLIST, ...PRIVATE_DENYLIST].some((e) => e.startsWith(u))) return false;
      return true;
    });
    expect(unnamed.filter((u) => !(u in PENDING)).sort()).toEqual([]);
  });

  it.skipIf(IN_PUBLIC_COPY)('the pending list only holds entries that are still unnamed and still tracked', () => {
    for (const entry of Object.keys(PENDING)) {
      expect(files.includes(entry), `${entry} is tracked`).toBe(true);
      expect(named(entry), `${entry} is now named: remove it from PENDING`).toBe(false);
    }
  });

  it('the moderation sample stays private although its folder ships', () => {
    expect(isPublicPath('tests/fixtures/calibration/external-openai-mod-1680.json')).toBe(false);
    expect(isPublicPath('tests/fixtures/calibration/adversarial-benign-v1.json')).toBe(true);
  });

  it('a dated plan file is never public, whatever its date', () => {
    expect(isPublicPath('PLAN-2026-09-16.md')).toBe(false);
    expect(isPublicPath('PLAN-2031-01-01.md')).toBe(false);
  });
});
