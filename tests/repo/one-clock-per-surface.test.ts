// One clock per surface: the patterns that put four date shapes on one screen
// may not come back.
//
// A cold read of the dashboard (2026-09-18) found `13/9-19/9` beside
// `9/18/2026, 5:51:26 PM` beside `2026-09-18 14:50:44 UTC`: four shapes, two
// clocks, and nothing on the page saying which clock any of them was on. Each
// came from a different hand-rolled idiom, so this test bans the idioms rather
// than the symptom. Every rendering of a date or a time under src/ui/ goes
// through src/ui/shared/format-time.ts, which takes the reader's INTERFACE
// language (not the browser's) and separates the reader's clock from the
// record's.
//
// Non-display uses (a storage key, a download filename, a period marker) are
// not renderings and are exempt, but only in the open: the line, or the five
// lines above it, must carry a NOT-DISPLAYED marker with a reason. A bare
// marker is not enough, and the reasons are asserted below so the exemption
// list cannot quietly grow by copy-paste.
//
// SCOPE, stated 2026-09-19 so that it is a decision and not an accident.
//
// This guard walks src/ui and nothing else. Its sibling,
// one-number-format-per-surface, had the same limit and it was an accident
// there: thirty two numbers sat in src/i18n, one folder outside the scan,
// inside translated sentences, and a Romanian reader saw them in the browser's
// format. Fixed in 8596a898. The same question was then asked of this rule, and
// the answer came out differently, so it is written down rather than left for
// the next person to re-derive:
//
//   • src/i18n formats no dates and no times at all. Measured: zero
//     toLocaleDateString, zero toLocaleTimeString, zero Intl.DateTimeFormat
//     across every file under it. There is nothing there to cover.
//
//   • landing/ builds its own Intl.DateTimeFormat instances, five of them in
//     demo.html alone, and that is correct rather than a gap. An export is one
//     self-contained file that has to open on a stranger's machine with the
//     network off and nothing installed; it cannot import a shared module,
//     because there is nothing to import from. Its clock discipline is the
//     export's own and belongs with the export, not here.
//
// So the scope is the extension's own surfaces, on purpose. If a third surface
// ever renders a date from the reader's own settings, it belongs in this scan
// and this comment should shrink by one bullet.

import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { REPO_ROOT as ROOT } from '../helpers/repo-root';
// Imported with the file, not inside the case that reads it, because an import has no time limit and
// loading the string tables inside the case took 3.5 of its 5 seconds beside 48 busy processes.
import { DASHBOARD_STRINGS } from '../../src/i18n/dashboard-strings';
import { TREE_READ_TIMEOUT_MS } from '../helpers/spawn-timeout';

// Reads the whole tree or asks git, which outlasts the 5s default on a busy machine; see the helper.
vi.setConfig({ testTimeout: TREE_READ_TIMEOUT_MS });

const UI_DIR = join(ROOT, 'src', 'ui');
/** The module every other file routes through. It is the one place these idioms belong. */
const FORMATTER = join('src', 'ui', 'shared', 'format-time.ts');

const MARKER = 'NOT-DISPLAYED:';
/** How far above a line the marker may sit (a comment block introducing it). */
const MARKER_LOOKBACK = 5;

interface Ban {
  name: string;
  /** Applied to one line of source. */
  hit: (line: string) => boolean;
  why: string;
}

const DATE_GETTER = /\.(getDate|getMonth|getFullYear|getDay|getHours|getMinutes|getSeconds|getUTCDate|getUTCMonth|getUTCFullYear|getUTCDay|getUTCHours|getUTCMinutes|getUTCSeconds)\(\)/;

const BANS: Ban[] = [
  {
    name: 'toLocaleDateString',
    hit: (l) => l.includes('toLocaleDateString'),
    why: 'formats a date in the BROWSER locale (or a hand-passed tag). Use a formatDateLocal / formatDayMonthLocal / formatWeekdayShort from src/ui/shared/format-time.ts, which takes the interface language.',
  },
  {
    name: 'toLocaleTimeString',
    hit: (l) => l.includes('toLocaleTimeString'),
    why: 'formats a time in the BROWSER locale. Use formatTimeLocal from src/ui/shared/format-time.ts.',
  },
  {
    name: 'Intl.DateTimeFormat',
    hit: (l) => l.includes('Intl.DateTimeFormat'),
    why: 'builds a date formatter outside the one module that owns them. Add the shape to src/ui/shared/format-time.ts instead, so every surface shares it.',
  },
  {
    name: 'new Date(...).toLocaleString',
    hit: (l) => /new Date\([^;]*\)\s*\.toLocaleString\s*\(/.test(l),
    why: 'a raw toLocaleString() on a Date follows the browser, not the reader\'s interface language. Use formatDateTimeLocal from src/ui/shared/format-time.ts.',
  },
  {
    name: 'hand-rolled date or clock string',
    hit: (l) => l.includes('`') && DATE_GETTER.test(l),
    why: 'a date or clock built out of Date getters inside a template literal is fixed in one order and one language. Use a formatter from src/ui/shared/format-time.ts (or localDayKey, for a bucket key).',
  },
  {
    // Added 2026-09-18, after the ban list written that morning walked past
    // five instances of the very defect it was written for: four
    // `r.timestamp.slice(0, 16).replace('T', ' ')` stamps on the Patterns tab
    // and a `b.bucket.slice(5)` axis label on Statistics, all of them beside
    // formatDateLocal output on the same screen. The first list banned the
    // idioms it had just seen; this one bans cutting a time string at all.
    name: 'a date or time cut out of a string',
    hit: (l) => /(timestamp|toISOString\(\)|\bts\b|\bbucket\b|dayKey|\.time\b)[^;]{0,40}\.slice\(/.test(l)
      || /\.replace\(\s*'T'\s*,/.test(l),
    why: 'a date or a time made by cutting an ISO string is a UTC value in no language, printed beside local dates in the reader\u2019s own. Use a formatter from src/ui/shared/format-time.ts: localDayKey for a per-day bucket the reader reads, formatDateTimeLocal for an instant on a reading surface, formatUtcStamp wrapped in t.utcStamp for an instant on an evidence surface.',
  },
  {
    name: 'day key cut out of an ISO string',
    hit: (l) => /(timestamp|toISOString\(\)|\bts\b|\bat\b|\.time\b)[^;]{0,40}\.slice\(\s*0\s*,\s*10\s*\)/.test(l),
    why: 'cutting the first ten characters of an ISO timestamp is a UTC calendar day. Every per-day bucket a person reads on a FeelingWise surface is the reader’s own day: use localDayKey from src/ui/shared/format-time.ts. Two panels cutting two different days from one chain is the defect of 2026-09-18, where the same two serves were "1 day" on the Patterns tab and "2 days" on the Overview.',
  },
  {
    name: 'sliced toISOString',
    hit: (l) => l.includes('.toISOString()') && (l.includes('.slice(') || l.includes('.replace(')),
    why: 'a sliced ISO string is a UTC stamp built by hand. Use formatUtcStamp / formatUtcTime from src/ui/shared/format-time.ts and wrap the result in t.utcStamp, which names the clock in words.',
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

/** A comment line states a rule or names a defect; it does not render anything. */
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

function scan(): { violations: Finding[]; exemptions: Finding[]; fileCount: number } {
  const violations: Finding[] = [];
  const exemptions: Finding[] = [];
  const files = listSourceFiles(UI_DIR);
  for (const abs of files) {
    const rel = relative(ROOT, abs);
    if (rel.split(sep).join('/') === FORMATTER.split(sep).join('/')) continue;
    const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (isComment(line)) return;
      for (const ban of BANS) {
        if (!ban.hit(line)) continue;
        const reason = markerAbove(lines, i);
        const found: Finding = { where: `${rel.split(sep).join('/')}:${i + 1}`, ban: ban.name, line: line.trim() };
        // A marker with no reason, or a one-word one, is not an exemption.
        if (reason !== null && reason.length >= 12) exemptions.push({ ...found, line: reason });
        else violations.push(found);
      }
    });
  }
  return { violations, exemptions, fileCount: files.length };
}

describe('one clock per surface (cold read of the dashboard, 2026-09-18)', () => {
  const { violations, exemptions, fileCount } = scan();

  it('actually read src/ui', () => {
    // A green run on zero files proves nothing.
    expect(fileCount).toBeGreaterThan(40);
  });

  it('routes every date and time under src/ui through format-time.ts', () => {
    const report = violations
      .map((v) => {
        const ban = BANS.find((b) => b.name === v.ban);
        return `  ${v.where}\n    ${v.ban}: ${v.line}\n    ${ban?.why ?? ''}`;
      })
      .join('\n');
    expect(
      violations,
      violations.length === 0 ? '' :
        `${violations.length} hand-rolled date/time rendering(s) under src/ui:\n${report}\n\n` +
        `If the value is NOT rendered (a storage key, a filename, a period marker), put a` +
        ` "${MARKER} <reason>" comment on the line or just above it, saying why it is not a` +
        ' surface. Do not use the marker to silence a rendering.',
    ).toEqual([]);
  });

  it('keeps every exemption reasoned', () => {
    // Read as documentation, not as a count to be grown: each of these is a
    // key, a filename or a cap-window marker, never something a person reads.
    expect(exemptions.length).toBeGreaterThan(0);
    for (const e of exemptions) {
      expect(e.line.length, `${e.where} carries a ${MARKER} marker with no real reason`).toBeGreaterThan(11);
    }
  });

  it('holds the formatter module itself to the same import rule', () => {
    // Comments stripped: the docblock NAMES the browser-locale idioms it
    // exists to replace, and that is the module doing its job, not using them.
    const code = readFileSync(join(ROOT, FORMATTER), 'utf8')
      .split(/\r?\n/)
      .filter((l) => !isComment(l))
      .join('\n');
    // It must take the interface language, never reach for the browser's.
    expect(code).toContain('intlLocaleFor');
    expect(code).not.toContain('navigator.language');
    expect(code).not.toContain('resolveUiLanguage');
  });
});

describe('the two clocks are told apart in words, not by a suffix', () => {
  // Every file under src/ui is read here, while vitest collects this file, because collecting has
  // no time limit and reading them all can outlast the per-test limit on a busy machine.
  const uiSources = listSourceFiles(UI_DIR).map((abs) => ({ abs, text: readFileSync(abs, 'utf8') }));

  it('leaves no bare " UTC" suffix pasted onto a value under src/ui', () => {
    const offenders: string[] = [];
    for (const { abs, text } of uiSources) {
      const rel = relative(ROOT, abs).split(sep).join('/');
      text.split(/\r?\n/).forEach((line, i) => {
        if (isComment(line)) return;
        // The shape the cold read found: a value with " UTC" glued to it.
        if (/\+\s*' UTC'/.test(line) || /\}\s*UTC</.test(line)) offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
      });
    }
    expect(
      offenders,
      offenders.length === 0 ? '' :
        `a bare "UTC" suffix is what a reader skips. Wrap the stamp in t.utcStamp instead:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('ships the words that name the clock in all four languages', () => {
    for (const lang of ['en', 'ro', 'es', 'pt-BR'] as const) {
      const t = DASHBOARD_STRINGS[lang];
      const stamped = t.utcStamp('2026-09-18 14:50:44');
      expect(stamped, `${lang} utcStamp must keep the stamp`).toContain('2026-09-18 14:50:44');
      expect(stamped, `${lang} utcStamp must name the clock`).toContain('UTC');
      // Words after the stamp, not a bare suffix: something is said about it.
      expect(
        stamped.replace('2026-09-18 14:50:44', '').trim().length,
        `${lang} utcStamp must say more than "UTC"`,
      ).toBeGreaterThan(6);
      // The ledger's clock note moved with its rows to the Feed log (10 Oct 2026).
      expect(t.feedLogClock.length, `${lang} feedLogClock`).toBeGreaterThan(40);
      expect(t.feedLogClock).toContain('UTC');
    }
  });
});
