// The two JUDGE-V1 files are a measured instrument (docs/audits/2026-08-25-true-judgement/JUDGE.md):
// a change to either is a new instrument and happens only with the owner's word. The pre-commit
// hook blocks a staged modify, delete or rename; this lock catches anything that reaches the tree
// another way (a merge, a rebase, a hook bypass). When the owner does unlock them, the new hashes
// are written here in the same commit, with his word cited.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT as ROOT } from '../helpers/repo-root';

// UNLOCKED ONCE, on the owner's word.
//
// He asked for a decision on whether a rewrite should need two judges instead of one,
// was given the measurement, and said to start. That is the word this lock asks for.
//
// What changed, and it is deliberately small. Neither file's JUDGE-V1 question moved: the
// prompt is byte-identical and its hash 4f32b70b07b7 is still asserted in
// tests/unit/ai/judge-v1-adult.test.ts, the schema is unchanged, the cut is still 4 and
// the hide line still 8. prompts.ts gained one constant, the second judge's model id.
// neutralizer.ts gained a model argument on askJudgeV1 and now asks that second model
// when the first has fired, acting only if both do.
//
// The instrument itself is a separate file, src/ai/judge-pair.ts, because
// .claude/rules/judge.md says a new instrument is a new file behind a pre-registered
// measurement. That measurement is docs/research/provider-2026-09-21/
// PREREGISTRATION-TEST-READ.md, whose bar was committed (fb307359) before the sealed
// split was opened: both judges firing was right 126 of 126 on the held-out 500 and 115
// of 115 on dev, against 78.4 percent for the single judge it replaces.
const FROZEN: Record<string, string> = {
  'src/ai/prompts.ts': '76b4183dd8a448e060bbf87ac95e4f267054f36e1409b147ba4c5da5a0127686',
  'src/core/neutralizer.ts': 'ee088c6a351d7974c38d86f7dec86e4df2f481825356c33e78e79972eb811ec7',
};

describe('frozen judge files', () => {
  for (const [path, sha256] of Object.entries(FROZEN)) {
    it(`${path} is byte-identical to its frozen hash`, () => {
      // Read as bytes: a line-ending conversion on checkout is a change too.
      const bytes = readFileSync(join(ROOT, path));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha256);
    });
  }

  it('the pre-commit hook blocks both paths by name', () => {
    const hook = readFileSync(join(ROOT, '.githooks', 'pre-commit'), 'utf8');
    for (const path of Object.keys(FROZEN)) expect(hook).toContain(`'${path}'`);
  });
});

// UNLOCKED, 2026-09-22, on his word, typed by his hand at the desktop file's prompt: two comment lines reworded, no code changed, A/B build identical (37 files).
// UNLOCKED again, on the owner's word to apply the judge patch. What changed is docs/plans/frozen-judge-patch-2026-09-23.md, applied as its patch.
