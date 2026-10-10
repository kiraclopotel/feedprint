/** @vitest-environment jsdom */
// The page's console never shows the words a post was hidden or masked for (10 Oct 2026, stage 3). A content
// script writes into the console of the page it runs on: anyone with the browser's developer tools open there (a
// parent helping, a support screenshot, a pasted bug report) read the slur, the coded-harm phrase or the swear word
// the reading matched, beside the post's id. The verdict lines stay, with a count of what matched.
//
// Two checks. (1) Each deterministic branch of the post reading runs for real on a post it acts on, with every
// console method watched: its own verdict line is written, and no console call carries the matched words. (2) A scan
// of every console call in src: none passes a value under a name known to hold words (the list in WORDS: matches,
// evidence, a post's or a rewrite's text, page HTML, an author, a caption, a matched token, a post's address, a
// provider's error text, samples read off the page), and nothing in src
// reaches the console around the scan. A call that must is marked in the comment just above it with
// `console-text-ok:` and its reason. The scan reads names, not values: a word passed under another name is not seen.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { REPO_ROOT } from '../../helpers/repo-root';

vi.mock('../../../src/storage/settings', () => ({
  getSettings: vi.fn(),
  isFeatureEnabled: (
    settings: { features?: Record<string, { enabled?: boolean }> },
    id: string,
  ) => settings.features?.[id]?.enabled === true,
}));
vi.mock('../../../src/storage/license', () => ({
  getLicense: vi.fn(async () => ({ tier: 'family', secret: 's' })),
  dailyCapForTier: vi.fn(() => 2000),
  effectiveMonthlyTokenCap: vi.fn(() => 1_000_000),
  isUncappedTier: vi.fn(() => false),
}));
vi.mock('../../../src/storage/cache', () => ({
  processingCache: { getPersistent: vi.fn(async () => null), set: vi.fn() },
}));
vi.mock('../../../src/core/calibration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/core/calibration')>()),
  getEffectiveThreshold: vi.fn(async () => 0.45),
}));
(globalThis as { chrome?: unknown }).chrome = {
  runtime: { id: 'fw-test', sendMessage: vi.fn(async () => ({ ok: true, profile: null })) },
};
vi.mock('../../../src/ai/client', () => ({
  getLastCallMeta: vi.fn(() => ({ model: 'llama-3.1-8b-instant', provider: 'groq' })),
  getLastFailureKind: () => null,
}));
vi.mock('../../../src/ai/neutralize-only', () => ({
  neutralizeText: vi.fn(async () => 'I strongly disagree with these people.'),
}));
vi.mock('../../../src/core/neutralizer', () => ({
  combinedDetectAndNeutralize: vi.fn(async () => ({
    analysis: {
      postId: 'x', isManipulative: false, overallScore: 0, overallConfidence: 0, processingTimeMs: 1,
      techniques: [], primaryTechnique: undefined, action: undefined,
    },
    neutralized: null,
  })),
}));

import { process as readPost } from '../../../src/analysis/pipeline';
import { getSettings } from '../../../src/storage/settings';
import { _resetForTests as resetFlushBudget } from '../../../src/ai/global-flush-budget';
import { _resetAuthorProfileCacheForTests } from '../../../src/forensics/author-profile-client';
import type { PostContent } from '../../../src/types/post';

const METHODS = ['log', 'info', 'debug', 'warn', 'error'] as const;
let printed: string[] = [];

/** Everything a console call was given, objects and arrays spelled out, as one string per call. */
function spell(args: unknown[]): string {
  return args.map((a) => {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');
}

beforeEach(() => {
  printed = [];
  for (const m of METHODS) {
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => { printed.push(spell(args)); });
  }
  resetFlushBudget();
  _resetAuthorProfileCacheForTests();
});
afterEach(() => { vi.restoreAllMocks(); });

function setMode(mode: string, strictLanguage: boolean) {
  (getSettings as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    mode, strictLanguage, locale: 'en', outputLanguage: 'auto', dailyCap: 2000, monthlyUsdCapOverride: null,
    totalChecksToday: 0, totalTokensThisMonth: 0,
  });
}
function post(text: string, kind?: PostContent['kind']): PostContent {
  return {
    id: 'p1', text, author: '@u', timestamp: new Date().toISOString(), platform: 'twitter', kind,
    domRef: new WeakRef(document.createElement('div')),
  } as PostContent;
}

describe('the page console never shows the words a post was hidden or masked for', () => {
  // Each row: the mode, the post, the verdict the reading gives, and the words it matched.
  // Each row: the mode, the post, the verdict, the branch's own console line (so a row cannot pass on another branch),
  // and the words it matched. A swear word is matched by its stem ("fuck"), so the stem is what is looked for.
  const rows: { branch: string; mode: string; strict: boolean; text: string; kind?: PostContent['kind'];
    action: string; line: string; words: string[] }[] = [
    { branch: 'a slur', mode: 'teen', strict: false, text: 'faggot', action: 'hide', line: 'slur detected for p1', words: ['faggot'] },
    { branch: 'coded harm', mode: 'teen', strict: false, text: 'kill yourself', action: 'hide', line: 'coded-harm self-harm-encouragement for p1', words: ['kill yourself'] },
    { branch: 'a swear word in child mode', mode: 'child', strict: false, text: 'shit', action: 'hide', line: 'profanity detected for p1', words: ['shit'] },
    { branch: 'swearing that dehumanises', mode: 'teen', strict: true, text: 'these fucking rats should be exterminated from our country', action: 'hide', line: 'profane + dehumanizing → HIDE for p1', words: ['fuck', 'rats', 'exterminated'] },
    { branch: 'swearing over a video that narrates violence', mode: 'teen', strict: true, text: 'this is fucking insane — a young man was beaten and forced to perform a dance', kind: 'video', action: 'hide', line: 'profane + violence-narrating video → HIDE for p1', words: ['fuck', 'beaten'] },
    { branch: 'a swear word masked', mode: 'teen', strict: true, text: 'this movie was fucking amazing honestly', action: 'neutralize', line: 'profanity → MASK (teen mode) for p1', words: ['fuck'] },
    { branch: 'dehumanising words', mode: 'teen', strict: false, text: 'these rats should be exterminated from our country', action: 'hide', line: 'dehumanization detected for p1', words: ['rats', 'exterminated'] },
    { branch: 'a video that narrates violence', mode: 'teen', strict: false, text: 'a young man was beaten and forced to perform a dance', kind: 'video', action: 'hide', line: 'Pipeline: violence-narrating video → HIDE for p1', words: ['beaten'] },
  ];
  for (const r of rows) {
    it(`${r.branch}: the verdict stands and its words stay out of the console`, async () => {
      setMode(r.mode, r.strict);
      const result = await readPost(post(r.text, r.kind));
      expect(result.action).toBe(r.action);
      expect(printed.some((line) => line.includes(r.line)), `the branch's own line "${r.line}" is written`).toBe(true);
      for (const w of r.words) {
        expect(printed.filter((line) => line.toLowerCase().includes(w)), `"${w}" reached the console`).toEqual([]);
      }
    });
  }
});

describe('no console call in src passes the words it read', () => {
  const ROOT = REPO_ROOT;
  // A name that holds words from a post, a rewrite or the page.
  const WORDS = /\b(\w*Hit|matches|evidence|outerHTML|innerHTML|textContent|innerText|detail|originalText|neutralizedText|rewrittenText|rewritten|original|author|handle|matchedToken|caption|unsafe\w*|snippet|excerpt|url|msg|\w*Samples)\b|\.text\b/;
  // Known and held: the rewrite checks in the frozen judge file print, at debug level (hidden unless the console's
  // verbose level is on), the phrase a rewrite was turned down for. That file changes only with the owner's word; the
  // change waits for it (10 Oct 2026). Each entry is the file and a piece of the call; nothing else is let through.
  const HELD: { file: string; call: string }[] = [
    { file: 'src/core/neutralizer.ts', call: 'metaHit' },
    { file: 'src/core/neutralizer.ts', call: 'advisoryHit' },
    { file: 'src/core/neutralizer.ts', call: 'unsafeVisible' },
  ];
  // A console reached another way than console.<method>( would pass the scan unseen.
  const ALIAS = /=\s*console\.(log|info|debug|warn|error)\b|console\[|console\.\w+\.(bind|apply|call)\(|console\.\w+\?\.\(/;
  // What only counts or names a kind of thing.
  const SAFE = /[\w.]+\.(length|size|category)\b|typeof\s+[\w.]+/g;

  function files(dir: string, out: string[] = []): string[] {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) files(p, out);
      else if (/\.tsx?$/.test(n)) out.push(p);
    }
    return out;
  }

  /** The code inside each console call's parentheses, with string literals emptied and template text dropped. */
  function consoleCalls(src: string): { line: number; code: string; marked: boolean }[] {
    const calls: { line: number; code: string; marked: boolean }[] = [];
    const re = /console\.(log|info|debug|warn|error)\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      let depth = 1;
      let i = re.lastIndex;
      let quote: string | null = null;
      for (; i < src.length && depth > 0; i++) {
        const c = src[i];
        if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
        if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
        if (c === '(') depth++; else if (c === ')') depth--;
      }
      const code = src.slice(re.lastIndex, i - 1)
        .replace(/`(?:\\.|\$\{[^}]*\}|[^`\\])*`/g, (t) => ` ${[...t.matchAll(/\$\{([^}]*)\}/g)].map((x) => x[1]).join(' ')} `)
        .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, "''");
      const before = src.slice(0, m.index).split('\n');
      // The comment just above the call: its lines, up to the first line that is not a comment.
      const above: string[] = [];
      for (let k = before.length - 2; k >= 0 && /^\s*\/\//.test(before[k]); k--) above.push(before[k]);
      calls.push({ line: before.length, code, marked: above.some((l) => l.includes('console-text-ok:')) });
    }
    return calls;
  }

  it('every console call passes counts, ids and kinds, never the words', () => {
    const found: string[] = [];
    const heldSeen = new Set<string>();
    for (const f of files(join(ROOT, 'src'))) {
      const rel = relative(ROOT, f).replace(/\\/g, '/');
      for (const c of consoleCalls(readFileSync(f, 'utf8'))) {
        if (c.marked || !WORDS.test(c.code.replace(SAFE, ''))) continue;
        const held = HELD.find((h) => h.file === rel && c.code.includes(h.call));
        if (held) { heldSeen.add(held.call); continue; }
        found.push(`${rel}:${c.line}: ${c.code.replace(/\s+/g, ' ').trim().slice(0, 120)}`);
      }
    }
    expect(found).toEqual([]);
    // An entry no longer needed (the owner's word came and the file changed) is taken off the list.
    expect([...heldSeen].sort(), 'every held entry still matches a call').toEqual(HELD.map((h) => h.call).sort());
  });

  it('nothing in src reaches the console another way (an alias, brackets, bind, apply, call, ?.)', () => {
    const found: string[] = [];
    for (const f of files(join(ROOT, 'src'))) {
      readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
        if (ALIAS.test(l)) found.push(`${relative(ROOT, f).replace(/\\/g, '/')}:${i + 1}: ${l.trim().slice(0, 100)}`);
      });
    }
    expect(found).toEqual([]);
  });

  it('the scan sees what it is for: a matched word passed to the console is found', () => {
    const calls = consoleCalls([
      "console.log(`hid ${post.id}:`, slurResult.matches);",
      "console.log(`hid ${post.id} (${slurResult.matches.length})`);",
      "console.debug('rejected: unsafe visible language -', unsafeVisible);",
      "console.log(`blocked video by ${input.author} (${input.blockReason})`);",
      "console.error('[FeelingWise] groq error:', msg);",
      "// console-text-ok: a reason",
      "console.log('x', node.outerHTML);",
    ].join('\n'));
    expect(calls.map((c) => !c.marked && WORDS.test(c.code.replace(SAFE, '')))).toEqual([true, false, true, true, true, false]);
    expect(ALIAS.test('const log = console.log;')).toBe(true);
    expect(ALIAS.test("console['log']('x');")).toBe(true);
  });
});
