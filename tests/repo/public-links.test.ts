// A link in the public copy has to lead somewhere in the public copy.
//
// The citations guard already holds a path literal anywhere in a living file to
// a file that exists. That is a different question from this one: a path can
// exist in this repository and be absent from the copy a stranger clones, and a
// markdown link is the one citation shape a reader actually clicks. On
// 2026-09-17 the defect register left the public copy, as the plan had decided
// months of entries earlier, and three links in docs/spec still pointed at it;
// nothing caught them, because every one of those paths exists here.
//
// So: every markdown link in a public file, whose target is a path in this
// repository, must resolve to a path that is itself public. Prose that names a
// private file is fine and is sometimes the honest thing to write ("the
// register is private, its entry numbers are stable"); a link is a promise that
// clicking it works.

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, posix } from 'node:path';
import { readFileSync } from 'node:fs';

import { isPublicPath } from '../../scripts/public-snapshot.mjs';
import { REPO_ROOT as ROOT } from '../helpers/repo-root';

/** Markdown inline links: the target of `[text](target)`, before any title. */
const LINK = /\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

function tracked(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0').filter(Boolean);
}

/** What a link target points at, relative to the repository root, or null when it is not one. */
function resolveTarget(fromFile: string, raw: string): string | null {
  const target = raw.split('#')[0].trim();
  if (!target) return null;                                   // a bare anchor on this page
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null;       // http, https, mailto, data
  if (target.startsWith('//')) return null;                   // protocol-relative
  const base = posix.dirname(fromFile.split('\\').join('/'));
  const resolved = posix.normalize(posix.join(target.startsWith('/') ? '.' : base, target));
  if (resolved.startsWith('..')) return null;                 // outside the repository
  return resolved.replace(/\/$/, '');
}

describe('public markdown links stay inside the public copy', () => {
  const publicMarkdown = tracked().filter(f => f.endsWith('.md') && isPublicPath(f));

  it('reads the public markdown files, so the guard cannot silently guard nothing', () => {
    // The floor is what docs/spec and the roots already carry. Raise it when
    // more public documentation ships; never lower it to make a red test pass.
    expect(publicMarkdown.length).toBeGreaterThanOrEqual(20);
    expect(publicMarkdown).toContain('docs/spec/README.md');
    expect(publicMarkdown).toContain('README.md');
  });

  it('every link target that is a path in this repository is public, and is there', () => {
    const dangling: string[] = [];
    const private_: string[] = [];
    for (const file of publicMarkdown) {
      const text = readFileSync(join(ROOT, file), 'utf8');
      for (const match of text.matchAll(LINK)) {
        const resolved = resolveTarget(file, match[1]);
        if (resolved === null) continue;
        if (!existsSync(join(ROOT, resolved))) { dangling.push(`${file} -> ${match[1]}`); continue; }
        if (!isPublicPath(resolved)) private_.push(`${file} -> ${match[1]} (${resolved})`);
      }
    }
    // Two separate lists, because they are two different mistakes: a link to
    // nothing is broken here as well, and a link to a private path works here
    // and only breaks for the reader it was written for.
    expect(dangling).toEqual([]);
    expect(private_).toEqual([]);
  });
});
