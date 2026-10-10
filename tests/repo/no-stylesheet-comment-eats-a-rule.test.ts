// A CSS comment that swallows a rule compiles clean and ships.
//
// There is no parse error for it. `/*` opens, and if the `*/` is missing the
// parser simply keeps reading until it finds the next one, silently discarding
// every declaration in between. The build succeeds, the bundle is valid, the
// only symptom is a control that looks slightly wrong on screen.
//
// This tree had two, in one stylesheet, identical in shape: a sentence stopping
// mid-clause on a semicolon, with the `*/` gone along with whatever was meant to
// follow it. The first ate the `.pg-trust-chip` base rule, which carries
// `display: inline-flex` and the gap the header chip depends on, so the
// dashboard header read "RECORDS14" with the label and the number touching. It
// was confirmed absent from the shipped stylesheet in dist/ before the fix. The
// second ate the ON states of the layout editor's own toggle and chips, so
// pressing "Edit layout" left the button looking unpressed.
//
// The first was found by a stranger reading the dashboard on a first install,
// who wrote "RECORDS0" down as a rendering oddity without knowing why. The
// second was found only because the check written for the first was run over
// the whole file, which is the argument for this test existing at all: one of
// these is a typo and two is a habit. (2026-09-18)

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TREE_READ_TIMEOUT_MS } from '../helpers/spawn-timeout';

// Reads the whole tree or asks git, which outlasts the 5s default on a busy machine; see the helper.
vi.setConfig({ testTimeout: TREE_READ_TIMEOUT_MS });

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Comment bodies that contain a whole declaration block.
 *
 * A brace pair inside a comment is not proof on its own, so this is deliberately
 * narrow: both `{` and `}` must be present, which is what a swallowed rule looks
 * like and what ordinary prose does not. An unclosed comment at end of file is
 * reported separately, because nothing follows it to be eaten.
 */
function commentsHoldingARule(css: string): { line: number; why: string }[] {
  const found: { line: number; why: string }[] = [];
  let i = 0;
  for (;;) {
    const open = css.indexOf('/*', i);
    if (open === -1) return found;
    const close = css.indexOf('*/', open + 2);
    if (close === -1) {
      found.push({ line: css.slice(0, open).split('\n').length, why: 'never closed' });
      return found;
    }
    const body = css.slice(open + 2, close);
    if (body.includes('{') && body.includes('}')) {
      found.push({ line: css.slice(0, open).split('\n').length, why: 'holds a rule' });
    }
    i = close + 2;
  }
}

function stylesheets(): string[] {
  const out = execFileSync('git', ['ls-files', '*.css'], { cwd: REPO_ROOT, encoding: 'utf8' });
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

/**
 * The CSS that does not live in a .css file (added 2026-09-19).
 *
 * This guard read `git ls-files '*.css'` and nothing else, so its coverage was
 * "the folders where CSS usually is" rather than "the rule it states". The
 * public site ships fifty three HTML pages that carry their own CSS inline;
 * `landing/check.html`'s block alone is about 1,750 characters of real rules.
 * An unterminated comment there eats the rules after it, compiles clean and
 * ships, which is the entire reason this file exists, on the pages a stranger
 * actually loads.
 *
 * Each block is returned with the line it starts on, so a finding names a line
 * in the HTML file rather than a line in an extract nobody can find.
 */
function inlineStyleBlocks(): Array<{ rel: string; css: string; startLine: number }> {
  const files = execFileSync('git', ['ls-files', '*.html'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n').map((l) => l.trim()).filter(Boolean);
  const out: Array<{ rel: string; css: string; startLine: number }> = [];
  for (const rel of files) {
    const html = readFileSync(join(REPO_ROOT, rel), 'utf8');
    for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
      const body = m[1];
      if (!body.includes('{')) continue;
      out.push({ rel, css: body, startLine: html.slice(0, m.index).split('\n').length });
    }
  }
  return out;
}

describe('no stylesheet comment eats a rule', () => {
  // Git is asked and every file read here, while vitest collects this file, because collecting has
  // no time limit and reading every stylesheet and page can outlast the per-test limit when the
  // machine is busy.
  const sheets = stylesheets().map((rel) => ({ rel, css: readFileSync(join(REPO_ROOT, rel), 'utf8') }));
  const blocks = inlineStyleBlocks();

  it('reads every tracked stylesheet, so a new one cannot arrive unwatched', () => {
    expect(sheets.length, 'found the stylesheets').toBeGreaterThan(0);
    for (const { rel, css } of sheets) {
      const bad = commentsHoldingARule(css);
      expect(bad, `${rel}: comment(s) swallowing a rule at ${bad.map((b) => b.line).join(', ')}`).toEqual([]);
    }
  });

  it('reads the CSS that lives inside the HTML pages too', () => {
    // The site is the reason this branch exists; if it ever stops carrying its
    // own CSS, this number tells whoever removed it to come and delete this.
    expect(blocks.length, 'found the inline stylesheets').toBeGreaterThan(10);
    for (const { rel, css, startLine } of blocks) {
      const bad = commentsHoldingARule(css);
      expect(
        bad,
        `${rel}: an inline <style> starting at line ${startLine} has comment(s) swallowing a rule` +
        ` at +${bad.map((b) => b.line).join(', +')} lines into the block`,
      ).toEqual([]);
    }
  });

  // A check that found nothing because it looked for nothing is worthless, so
  // the detector is shown to fire on the exact shape that shipped twice.
  it('fires on the shape that shipped twice', () => {
    const broken = [
      '/* A heading that stops mid-sentence;',
      '.a-real-rule { display: inline-flex; gap: 6px; }',
      '/* the next comment closes the first one */',
      '.another { color: red; }',
    ].join('\n');
    expect(commentsHoldingARule(broken)).toEqual([{ line: 1, why: 'holds a rule' }]);

    const closed = [
      '/* A heading that finishes its sentence. */',
      '.a-real-rule { display: inline-flex; gap: 6px; }',
    ].join('\n');
    expect(commentsHoldingARule(closed)).toEqual([]);
  });

  it('does not fire on ordinary prose, or on a brace mentioned in a comment', () => {
    const fine = [
      '/* ====== SECTION ======',
      '   Several lines of explanation, with a colon: and a semicolon;',
      '   and a mention of the { character on its own. */',
      '.rule { color: blue; }',
    ].join('\n');
    expect(commentsHoldingARule(fine)).toEqual([]);
  });
});
