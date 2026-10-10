// One number format per surface: the sibling of one-clock-per-surface, one
// field over.
//
// A number on a FeelingWise surface was written with a bare `.toLocaleString()`
// in twenty six places. That follows the BROWSER's locale, not the language the
// reader picked in FeelingWise's own settings, so a Romanian interface on a US
// English browser printed "3,278" where Romanian writes "3.278". Two call sites
// did it right, each in its own way: one passed intlLocaleFor(uiLang) into
// toLocaleString, the other built its own Intl.NumberFormat. Three
// implementations of one rule, twenty six copies missing it, nothing comparing
// them: the same shape as the clocks, found the same way, on the same day.
//
// It matters more than it looks, because this product's whole claim rests on
// counts a person quotes to somebody else. A thousands separator that disagrees
// with the sentence around it is the small wrongness that makes a reader doubt
// the number.
//
// Non-display uses are exempt in the open, with the same NOT-DISPLAYED marker
// and the same requirement that the marker carry a real reason.

import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT as ROOT } from '../helpers/repo-root';

const UI_DIR = join(ROOT, 'src', 'ui');
/** The module every other file routes through. */
const FORMATTER = join('src', 'ui', 'shared', 'format-number.ts').split(sep).join('/');
/** Its sibling, which names the banned idioms in its own docblock. */
const TIME_FORMATTER = join('src', 'ui', 'shared', 'format-time.ts').split(sep).join('/');

const MARKER = 'NOT-DISPLAYED:';
const MARKER_LOOKBACK = 5;

interface Ban { name: string; hit: (line: string) => boolean; why: string }

const BANS: Ban[] = [
  {
    name: 'bare toLocaleString on a number',
    hit: (l) => /\.toLocaleString\(\s*\)/.test(l),
    why: 'formats a number in the BROWSER locale, not the interface language the reader chose. Use formatCount / formatDecimal / formatPercent from src/ui/shared/format-number.ts.',
  },
  {
    name: 'toLocaleString with a hand-passed locale',
    hit: (l) => /\.toLocaleString\(\s*[^)]/.test(l) && !/toLocaleDateString|toLocaleTimeString/.test(l),
    why: 'is the right answer written in the wrong place. It was one of the two correct call sites, and being correct in its own way is how three implementations of one rule came about. Use formatCount from src/ui/shared/format-number.ts.',
  },
  {
    name: 'Intl.NumberFormat',
    hit: (l) => l.includes('Intl.NumberFormat'),
    why: 'builds a number formatter outside the one module that owns them. Add the shape to src/ui/shared/format-number.ts instead, so every surface shares it and every surface is cached the same way.',
  },
];

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(abs));
    else if (entry.isFile() && ['.ts', '.tsx'].includes(extname(entry.name))) out.push(abs);
  }
  return out;
}

function isComment(line: string): boolean {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

function markerAbove(lines: string[], i: number): string | null {
  for (let k = i; k >= Math.max(0, i - MARKER_LOOKBACK); k--) {
    const at = lines[k].indexOf(MARKER);
    if (at >= 0) return lines[k].slice(at + MARKER.length).trim();
  }
  return null;
}

interface Finding { where: string; ban: string; line: string }

function scan(): { violations: Finding[]; fileCount: number } {
  const violations: Finding[] = [];
  const files = listSourceFiles(UI_DIR);
  for (const abs of files) {
    const rel = relative(ROOT, abs).split(sep).join('/');
    if (rel === FORMATTER || rel === TIME_FORMATTER) continue;
    const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (isComment(line)) return;
      for (const ban of BANS) {
        if (!ban.hit(line)) continue;
        const reason = markerAbove(lines, i);
        if (reason !== null && reason.length >= 12) continue;
        violations.push({ where: `${rel}:${i + 1}`, ban: ban.name, line: line.trim() });
      }
    });
  }
  return { violations, fileCount: files.length };
}

describe('one number format per surface (2026-09-18)', () => {
  const { violations, fileCount } = scan();

  it('actually read src/ui', () => {
    expect(fileCount).toBeGreaterThan(40);
  });

  it('routes every number under src/ui through format-number.ts', () => {
    const report = violations
      .map((v) => {
        const ban = BANS.find((b) => b.name === v.ban);
        return `  ${v.where}\n    ${v.ban}: ${v.line}\n    ${ban?.why ?? ''}`;
      })
      .join('\n');
    expect(
      violations,
      violations.length === 0 ? '' :
        `${violations.length} browser-locale number rendering(s) under src/ui:\n${report}\n\n` +
        `If the value is NOT rendered, put a "${MARKER} <reason>" comment on the line or just` +
        ' above it. Do not use the marker to silence a rendering.',
    ).toEqual([]);
  });

  // The scan above walks src/ui only, and on 19 September that scope was the
  // whole of the defect it was written for: src/ui was clean and src/i18n held
  // thirty two bare .toLocaleString() calls, inside translated sentences. A
  // Romanian reader on a US English browser was shown "3,278" in the middle of
  // a Romanian sentence, which is the exact wrongness the header describes,
  // one directory outside where the guard was looking.
  //
  // Those thirty two now pass their own file's locale. That is not the whole
  // rule: the string tables still format numbers themselves rather than calling
  // format-number.ts, and roughly two hundred call sites would have to move for
  // them to. That move is worth making and is not made here. What is held here
  // is the narrower thing the reader actually feels, so it cannot come back
  // while the larger tidy waits.
  it('never lets a translated sentence take its numbers from the browser', () => {
    const files = listSourceFiles(join(ROOT, 'src', 'i18n'));
    expect(files.length, 'the scan reached the string tables').toBeGreaterThan(8);
    const bare: Finding[] = [];
    for (const abs of files) {
      const rel = relative(ROOT, abs).split(sep).join('/');
      const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        if (isComment(line)) return;
        if (!/\.toLocaleString\(\s*\)/.test(line)) return;
        const reason = markerAbove(lines, i);
        if (reason !== null && reason.length >= 12) return;
        bare.push({ where: `${rel}:${i + 1}`, ban: 'bare toLocaleString', line: line.trim() });
      });
    }
    expect(
      bare,
      bare.length === 0 ? '' :
        `${bare.length} number(s) under src/i18n formatted in the BROWSER's locale, not the` +
        ` reader's:\n${bare.map((v) => `  ${v.where}\n    ${v.line}`).join('\n')}\n\n` +
        'Each string table is written in one language. Pass that language\'s tag, the way the' +
        ' file\'s own neighbours already do (\'ro-RO\', \'es-ES\', \'pt-BR\', \'en-US\').',
    ).toEqual([]);
  });

  // The case above tells an author to "pass that language's tag, the way the
  // file's own neighbours already do", and until 2026-09-19 nothing checked that
  // the tag they passed was their own. A bare call is loud: it follows the
  // browser and a Romanian reader sees a comma. Passing 'en-US' inside ro.ts is
  // silent and identical in effect, and it is the likelier mistake, because a
  // language file is usually written by copying its neighbour.
  it('lets a language file name its own locale and no other', () => {
    const LANGS = ['en', 'es', 'pt-br', 'ro'];
    /** 'pt-BR' and 'pt' are one language here; the subtag boundary is the hyphen. */
    const base = (tag: string) => tag.toLowerCase().split('-')[0];

    const wrong: { where: string; lang: string; tag: string; line: string }[] = [];
    let checked = 0;
    for (const abs of listSourceFiles(join(ROOT, 'src', 'i18n'))) {
      const rel = relative(ROOT, abs).split(sep).join('/');
      const lang = LANGS.find((l) => rel.endsWith(`/${l}.ts`));
      if (!lang) continue; // index.ts, types.ts and the shared helpers are not one language
      checked += 1;
      readFileSync(abs, 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (isComment(line)) return;
        for (const m of line.matchAll(/\.toLocale(?:String|DateString|TimeString)\(\s*'([^']+)'/g)) {
          if (base(m[1]) !== base(lang)) {
            wrong.push({ where: `${rel}:${i + 1}`, lang, tag: m[1], line: line.trim() });
          }
        }
      });
    }

    expect(checked, 'the four shipped languages were each found and read').toBeGreaterThanOrEqual(4);
    expect(
      wrong,
      wrong.length === 0 ? '' :
        `${wrong.length} sentence(s) formatted in a language other than the file's own:\n` +
        wrong.map((w) => `  ${w.where}\n    ${w.lang}.ts passes '${w.tag}': ${w.line}`).join('\n') +
        '\n\nA string table is written in one language and formats its numbers in that one.',
    ).toEqual([]);
  });

  // The case above finds a language file by its NAME: a path ending `/en.ts`,
  // `/ro.ts`, `/es.ts` or `/pt-br.ts`. Four files under src/i18n answer all four
  // languages inside one file instead, `export-strings.ts` with four inline
  // blocks across two thousand lines and `marker-strings.ts` with a const per
  // language, and none of them was being read at all (found 2026-09-19).
  //
  // They are held to a different rule rather than the same one, because in a
  // file with four languages there is no such thing as "the file's own locale"
  // and a tag cannot be attributed to a block without parsing. The rule is that
  // such a file formats no numbers itself: the formatting belongs in a
  // per-language file, where the case above can read it, or in the one
  // formatter module. Zero calls there today, so this costs nothing and cannot
  // be wrong; the day somebody needs one, they get a sentence saying where it
  // goes instead of a check that never looked.
  it('lets no multi-language string table format a number nobody can place', () => {
    const LANG_MARK = /\b(?:en|ro|es)\s*:|'pt-BR'\s*:|_EN\b|_RO\b|_ES\b|_PT_BR\b/g;
    const offenders: string[] = [];
    let multiLanguageFiles = 0;
    for (const abs of listSourceFiles(join(ROOT, 'src', 'i18n'))) {
      const rel = relative(ROOT, abs).split(sep).join('/');
      if (['en', 'es', 'pt-br', 'ro'].some((l) => rel.endsWith(`/${l}.ts`))) continue;
      const text = readFileSync(abs, 'utf8');
      const marks = new Set((text.match(LANG_MARK) ?? []).map((m) => m.replace(/[\s:'_]/g, '').toLowerCase()));
      if (marks.size < 2) continue; // index.ts, types.ts and the shared helpers
      multiLanguageFiles += 1;
      text.split(/\r?\n/).forEach((line, i) => {
        if (isComment(line)) return;
        for (const m of line.matchAll(/\.toLocale(?:String|DateString|TimeString)\(([^)]*)/g)) {
          // `[^)]*` above stops at the first close paren, so the captured
          // argument of `intlLocaleFor('ro')` is `intlLocaleFor('ro'` with none
          // of its own. Matching up to the quote rather than past it is why.
          const arg = m[1].trim();
          if (/^intlLocaleFor\('(en|ro|es|pt-BR)'/.test(arg)) continue;
          offenders.push(`  ${rel}:${i + 1}\n    ${line.trim()}`);
        }
      });
    }
    expect(multiLanguageFiles, 'the multi-language tables were found at all').toBeGreaterThanOrEqual(2);
    expect(
      offenders,
      offenders.length === 0 ? '' :
        `${offenders.length} number(s) formatted inside a table that answers four languages:\n` +
        offenders.join('\n') +
        '\n\nThere is no "this file\'s language" here to check a tag against. Say which ' +
        "language it is with intlLocaleFor('<lang>'), move the formatting into the " +
        'per-language file, or call the one formatter module.',
    ).toEqual([]);
  });

  it('holds the formatter module to its own rule', () => {
    // Comments stripped: its docblock names the idioms it exists to replace.
    const code = readFileSync(join(ROOT, FORMATTER), 'utf8')
      .split(/\r?\n/)
      .filter((l) => !isComment(l))
      .join('\n');
    expect(code, 'the one module builds the one formatter').toContain('new Intl.NumberFormat');
    expect(code, 'and reads the interface language, never the browser').toContain('intlLocaleFor');
    expect(code).not.toContain('navigator.language');
    expect((code.match(/new Intl\.NumberFormat/g) ?? []).length, 'built in exactly one place').toBe(1);
  });
});
