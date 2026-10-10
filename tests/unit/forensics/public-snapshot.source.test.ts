// The public snapshot (docs/OPEN-SOURCE-SPLIT-2026-09-14.md, section 6): the
// allowlist carries everything the reproducible build needs and nothing the
// private list names, and the content scan refuses the key shapes of the 6 Sep
// history check. Two-sided on purpose: a path that must go and a path that
// must never go, for each class.
import { describe, expect, it, vi } from 'vitest';
import { readSource } from '../../helpers/read-source';
import { repoPath } from '../../helpers/repo-root';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { committedBlobs, isPublicPath, publicPaths, scanContent } from '../../../scripts/public-snapshot.mjs';
import { TREE_READ_TIMEOUT_MS } from '../../helpers/spawn-timeout';

// Reads the whole tree or asks git, which outlasts the 5s default on a busy machine; see the helper.
vi.setConfig({ testTimeout: TREE_READ_TIMEOUT_MS });

/** What a call returned, or the error it threw, kept for the case that checks it. */
type Answer<T> = { value: T } | { error: unknown };

function answer<T>(call: () => T): Answer<T> {
  try {
    return { value: call() };
  } catch (error) {
    return { error };
  }
}

function valueOf<T>(a: Answer<T>): T {
  if ('error' in a) throw a.error;
  return a.value;
}

describe('public snapshot: the split', () => {
  it('carries the tree the zips are built from', () => {
    for (const p of [
      'src/forensics/store.ts',
      'src/ai/prompts.ts',
      'src/products/off/content.ts',
      'src/core/profanity-filter.ts',
      'tests/unit/forensics/archive-summary.test.ts',
      'tests/fixtures/rfc3161/dfn-resp.der',
      'tests/fixtures/calibration/policy-table-v1.json',
      '_locales/en/messages.json',
      'assets/brand/mark.svg',
      'manifest.json',
      'manifest.off.json',
      'package-lock.json',
      'vite.config.ts',
      'scripts/reproducible-build.mjs',
      'scripts/package.mjs',
      'scripts/new-build-id.mjs',
      'scripts/version-name.mjs',
      'scripts/check-sw-bundle.mjs',
      'scripts/build-standalone-verifier.ts',
      'verifier/verify-export.mjs',
      'verifier/FORMAT.md',
      'docs/spec/subsystems/forensic-chain.md',
      'docs/METHODOLOGY.md',
      'README.md',
      'CHANGELOG.md',
      'LICENSE',
      'THIRD-PARTY-NOTICES.md',
      '.gitattributes',
      '.nvmrc',
      '.githooks/pre-push',
      '.github/workflows/ci.yml',
      'docs/spec/RELEASES.tsv',
      'tests/fixtures/chrome-web-store-install/receipts-2.5.8/verified_contents.json',
    ]) {
      expect(isPublicPath(p), p).toBe(true);
    }
  });

  it('never carries the private list, even under an allowed prefix', () => {
    for (const p of [
      'corpus/derived/2026-09-07-context/items.jsonl',
      'past-forensics/export.json',
      '.fw-chain.json',
      'worker/src/proxy.ts',
      'worker/wrangler.toml',
      'landing/index.html',
      'landing/wrangler.site.toml',
      'store/listing.md',
      'OUTBOX/2026-09-14-email-ai-forensics.md',
      'docs/audits/2026-09-13-wiring/FINDINGS.md',
      'docs/research/PROVIDER-SURVEY-2026-09-14.md',
      'docs/measurements/2026-08-02-harness/verify-probe.mjs',
      'docs/outreach/APTI-MANOLEA-2026-09-08.md',
      'docs/LONG-PLAN.md',
      'docs/VOICE.md',
      'docs/STATE-LOG.md',
      'docs/OPEN-SOURCE-SPLIT-2026-09-14.md',
      'docs/history/archive/SPECIFICATION.md',
      'STATE.md',
      'presentstate.md',
      'futurestate.md',
      'SESSION-PROMPT.md',
      '.brain/lessons/x.md',
      '.claude/settings.json',
      'experiments/x.ts',
      'tools/nano-harness/run.html',
      'worker/scripts/license-admin.mjs',
      'worker/scripts/mint-trial-license.mjs',
      'worker/scripts/license-report.mjs',
      'scripts/corpus/build.mjs',
      'scripts/eyes-exam/manifest.json',
      'scripts/research/chain/analyze-chain-export.mjs',
      'tests/calibration/private-run.json',
    ]) {
      expect(isPublicPath(p), p).toBe(false);
    }
  });

  // Git lists the tree here, while vitest collects this file, because collecting has no time limit
  // and a git process can take seconds to start on a busy machine.
  const tree = answer(() => publicPaths());
  // Every committed path at HEAD, listed the way publicPaths lists them, so the excluded side can be counted.
  const tracked = answer(() =>
    execFileSync('git', ['ls-tree', '-r', '-z', '--name-only', 'HEAD'], { cwd: repoPath(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\0')
      .filter(Boolean),
  );

  it('reads the real tree: about a thousand tracked files, every private prefix absent', () => {
    const paths = valueOf(tree);
    const all = valueOf(tracked);
    const excluded = all.filter((p) => !isPublicPath(p));
    // Two sanity bounds, not a budget. The floor proves the walk found the tree
    // rather than an empty list. The second bound counts what is EXCLUDED, as
    // the comment here asked: until 2026-10-01 it was a ceiling on the public
    // count (1300, then 1600), and ordinary growth (about 300 public files in the
    // twelve days to 1 Oct) hit it twice, read each time as a file allowance.
    // A ceiling widened to 3000 would have guarded nothing: the whole tree was
    // 2787 paths that day, so even a filter that let everything through would
    // pass. The excluded side was 1186 on 2026-10-01 and grows as audits,
    // research and history pile up; under 900 means the denylist has stopped
    // working or a private folder of about 290 files or more has been pulled in
    // (docs/history alone is 287). Smaller pull-ins are what the prefix cases
    // below name one by one.
    expect(paths.length).toBeGreaterThan(900);
    expect(paths.length + excluded.length).toBe(all.length);
    expect(excluded.length).toBeGreaterThan(900);
    for (const bad of ['corpus/', 'past-forensics/', 'worker/', 'landing/', 'OUTBOX/', 'docs/audits/', 'docs/research/', 'STATE.md']) {
      expect(paths.some((p) => p.startsWith(bad)), bad).toBe(false);
    }
    expect(paths).toContain('scripts/reproducible-build.mjs');
    expect(paths).toContain('package-lock.json');
  });
});

// Every key shape below is assembled at run time: this file is itself in the public tree, and a
// literal would make the scan refuse the snapshot it is testing (found 2026-09-15, first real run).
const SUPPORT = 'support' + '@feelingwise.org';

describe('public snapshot: the content scan', () => {
  it('refuses each key shape and reports the line, never the text', () => {
    const cases: [string, string][] = [
      ['groq-key', 'const k = "gsk_' + 'A'.repeat(52) + '";'],
      ['sk-key', 'token: sk-' + 'b'.repeat(40)],
      ['aws-key', 'AKIA' + 'Q'.repeat(16)],
      ['slack-token', 'xox' + 'b-123456789012-abcdefghij'],
      ['github-token', 'ghp_' + 'z'.repeat(36)],
      ['account-id', 'name = "x"\naccount_id = "0123456789abcdef"'],
      ['private-key-block', '-----BEGIN ' + 'PRIVATE KEY-----'],
    ];
    for (const [name, text] of cases) {
      const hits = scanContent('src/x.ts', 'line one\n' + text);
      expect(hits.map((h) => h.pattern), name).toContain(name);
      expect(hits[0].line).toBeGreaterThanOrEqual(2);
      expect(Object.keys(hits[0])).toEqual(['path', 'line', 'pattern']);
    }
  });

  it('passes ordinary code, a short design-mock key and a fixture status id', () => {
    expect(scanContent('src/x.ts', 'const key = "gsk_VRF1234567890abcdef";')).toEqual([]);
    expect(scanContent('tests/unit/content/platforms/wire/wire-x.test.ts', 'https://x.com/someone/status/1234567890123456789')).toEqual([]);
    expect(scanContent('src/ai/client.ts', 'const skip = "sk-ip"; // not a key')).toEqual([]);
  });

  it('allows the support address only on the pages that already carry it', () => {
    expect(scanContent('README.md', `Contact ${SUPPORT}`)).toEqual([]);
    expect(scanContent('src/ui/popup/x.tsx', SUPPORT).map((h) => h.pattern)).toEqual(['support-address']);
  });

  it('refuses a real-looking post id and a handle in a document, and nothing else there', () => {
    const doc = 'docs/spec/known-issues.md';
    const patterns = (text: string) => scanContent(doc, text).map((h) => h.pattern);
    expect(patterns('status 2070000000000000555 carried the text')).toEqual(['long-numeric-id']);
    expect(patterns('reported by (@someperson) on the feed')).toEqual(['handle']);
    // The invented shapes the scrub of 2026-09-17 wrote, code spans, paths and the words documents use.
    expect(patterns('status 1900000000000000001 and 7900000000000000002 (@invented_handle)')).toEqual([]);
    expect(patterns('`@core/x` and docs/@types and a @handle and the @user and @eslint')).toEqual([]);
    expect(patterns('the owner saw it live')).toEqual([]);
  });

  // The public tree carries src/, tests/ and verifier/ as well as docs/, so each pattern names
  // where it does not look. Real people's names are matched by the private name check, from
  // salted fingerprints, because a pattern here would spell them.
  it('looks for ids everywhere and handles outside tests and the files that hold npm scopes', () => {
    const patterns = (path: string, text: string) => scanContent(path, text).map((h) => h.pattern);

    // An id in source: anything off the 19000... convention.
    expect(patterns('src/ai/client.ts', '// keyed on 7920000000000000966')).toEqual(['long-numeric-id']);
    // An id under tests/: a shape we write passes, a 15 to 19 digit run with no such shape does
    // not. The real-looking one is assembled so that this file does not carry it.
    expect(patterns('tests/fixtures/wire/instagram/feed-timeline.json', '"pk": "3000000000000000001"')).toEqual([]);
    expect(patterns('tests/helpers/repo-root.ts', 'https://x.com/someone/status/1234567890123456789')).toEqual([]);
    expect(patterns('tests/helpers/repo-root.ts', "'/groups/190000000000052/' and 7099887766554433221")).toEqual([]);
    const realLooking = '5830172' + '94615038';
    expect(patterns('tests/helpers/repo-root.ts', `'/groups/${realLooking}/'`)).toEqual(['long-numeric-id']);

    // A handle: source and documents are scanned; the files whose @names are npm scopes are not.
    expect(patterns('src/ai/client.ts', '// seen on @realadvertiser')).toEqual(['handle']);
    expect(patterns('package-lock.json', '"@typescript-eslint/parser": {}')).toEqual([]);
    expect(patterns('eslint.config.mjs', "plugins: { '@typescript-eslint': p }")).toEqual([]);
  });
});

describe('public snapshot: the bytes are the commit, never the working files', () => {
  // Git is asked here, while vitest collects this file, because collecting has no time limit and
  // each of these git processes can take seconds to start on a busy machine.
  const paths = ['README.md', 'tests/fixtures/rfc3161/dfn-resp.der'];
  const blobs = answer(() => committedBlobs(paths));
  const stored = paths.map((p) => answer(() => execFileSync('git', ['cat-file', 'blob', `HEAD:${p}`])));
  const refusal = answer(() => committedBlobs(['no/such/file.txt']));

  // A Windows worktree held tests/fixtures/calibration/user-words-v1.json with CRLF while the commit holds
  // LF, so MANIFEST.txt named a hash the public repository would never contain (2026-09-15).
  it('reads each path as git stores it at HEAD, text and binary alike', () => {
    const read = valueOf(blobs);
    for (const [i, p] of paths.entries()) {
      const expected = valueOf(stored[i]);
      expect(Buffer.compare(read.get(p) as Buffer, expected), p).toBe(0);
    }
  });

  it('refuses a path that is not a committed file', () => {
    expect(() => valueOf(refusal)).toThrow(/not a committed blob/);
  });
});

describe('public snapshot: a stranger on Windows builds the same bytes', () => {
  it('carries a line-ending rule that keeps every text file LF on checkout', () => {
    // The comment lines name core.autocrlf to explain the measurement; only rules count here.
    const rules = readSource('.gitattributes')
      .split(/\r?\n/)
      .filter((line) => !line.startsWith('#'))
      .join('\n');
    expect(rules).toMatch(/^\* text=auto eol=lf$/m);
    expect(rules).not.toMatch(/eol=crlf|autocrlf/i);
    expect(isPublicPath('.gitattributes')).toBe(true);
  });
});
