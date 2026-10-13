// The dashboard has to look finished and of high quality, not generic. Seen
// as a stranger (crew/dashboard/INVENTORY.md), the page was
// a component-library admin: rounded shadowed cards on a dot grid, a teal accent and four more, capitals as a style, a
// looping heartbeat. The house system (docs/design/site-v6/DESIGN.md) says what replaces each, and every direction shown
// to him shares it. These locks fail if any of the generic marks grows back.
//
// Source-scan style on purpose: the drift is "someone adds a 12px radius or a drop shadow", which no behavioural test sees.

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { readSource } from '../../../helpers/read-source';
import { repoPath } from '../../../helpers/repo-root';

const DASHBOARD = 'src/ui/dashboard/Dashboard.tsx';
const HOUSE = 'src/ui/dashboard/dashboard-house.css';
const DESIGN = 'src/ui/dashboard/dashboard-design.css';
const FRAME = 'src/ui/dashboard/dashboard-frame.css';

describe('the dashboard wears the house system', () => {
  it('loads the house tokens and then the frame last, after the shared tokens and its own sheet', () => {
    const src = readSource(DASHBOARD);
    // Built from parts: the repository's path checker reads a whole import line in a test as a path of the test's own.
    const at = (sheet: string): number => src.indexOf(['import ', "'", sheet, "'"].join(''));
    const tokens = at('../shared/tokens.css');
    const design = at('./dashboard-design.css');
    const house = at('./dashboard-house.css');
    expect(tokens).toBeGreaterThanOrEqual(0);
    expect(design).toBeGreaterThan(tokens);
    expect(house).toBeGreaterThan(design);
    expect(at('./dashboard-frame.css')).toBeGreaterThan(house);
  });

  it('carries the four inputs in both schemes and maps the old accent to ink', () => {
    const css = readSource(HOUSE);
    expect(css).toMatch(/:root\[data-theme="light"\] \{[^}]*--fw-ground: #eeeff1;[^}]*--fw-ink: {4}#141518;/);
    expect(css).toMatch(/:root\[data-theme="dark"\] \{[^}]*--fw-ground: #0f1012;[^}]*--fw-ink: {4}#dfe0e2;/);
    expect(css).toMatch(/--fw-noise: {2}#b4123f;/);
    expect(css).toMatch(/--fw-record: #4531c9;/);
    expect(css).toMatch(/--fw-teal: var\(--fw-ink\);/);
    expect(css).toMatch(/--fw-accent: var\(--fw-ink\);/);
    // A bare :root would lose to the old shared file's :root[data-theme=...] blocks.
    expect(css).not.toMatch(/^:root \{/m);
  });

  it('sets one face, with figures that line up, and no file it cannot find', () => {
    const css = readSource(HOUSE);
    expect(css).toContain('--fw-font: "Bricolage Grotesque"');
    const frame = readSource(FRAME);
    expect(frame).toMatch(/--fw-font-mono: var\(--fw-font\);/);
    expect(frame).toMatch(/font-variant-numeric: tabular-nums;/);
  });

  it('ships the face in the package: the rule names the file first, the file is there, local() stays as the fallback', () => {
    const css = readSource(HOUSE);
    const face = css.match(/@font-face \{[^}]*font-family: "Bricolage Grotesque"[^}]*\}/)![0];
    const src = face.match(/src:([^;]+);/)![1];
    expect(src.trim().startsWith("url('./fonts/BricolageGrotesque-Variable.woff2') format('woff2')"), 'the file comes first').toBe(true);
    expect(src).toContain('local("Bricolage Grotesque")');
    // A url() to a file that is not there is a failed load on every open of the page.
    const file = repoPath('src', 'ui', 'dashboard', 'fonts', 'BricolageGrotesque-Variable.woff2');
    expect(existsSync(file), 'the font file sits beside the stylesheet').toBe(true);
    const bytes = readFileSync(file);
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('wOF2');
    expect(bytes.length).toBeGreaterThan(50_000);
    expect(existsSync(repoPath('src', 'ui', 'dashboard', 'fonts', 'OFL.txt')), 'the licence travels with the file').toBe(true);
  });

  it('the active tab is ink over the record colour, the product\'s own, and the bars are ink', () => {
    const css = readSource(FRAME);
    expect(css).toMatch(/\.dash-tab\.active \{ background: transparent; color: var\(--fw-ink\); font-weight: 500; border-bottom-color: var\(--fw-record\); \}/);
    expect(css).toMatch(/\.bar-fill \{ background: var\(--fw-ink\) !important; \}/);
  });

  it('has no dot grid, no glow, no corner past 2 px, no capitals as a style, nothing that loops but the spinner', () => {
    const css = readSource(DESIGN);
    const sheets = [DESIGN, FRAME, HOUSE].map((f) => readSource(f)).join('\n');
    expect(sheets).not.toContain('radial-gradient(circle at 1px 1px');
    expect(sheets).not.toMatch(/text-transform: uppercase/);
    const radii = [...sheets.matchAll(/border-radius: ([^;]+);/g)].map((m) => m[1].trim());
    const round = radii.filter((v) => v.split(/\s+/).some((t) => !cornerHolds(t)));
    expect(round).toEqual([]);
    const shadows = [...css.matchAll(/box-shadow: ([^;]+);/g)].map((m) => m[1].trim())
      .filter((v) => v !== 'none' && !v.startsWith('var(--fw-shadow') && v !== '0 0 0 2px var(--fw-accent)'
        && !/^0 0 0 4px color-mix/.test(v)); // the Timeline marker's faint halo
    expect(shadows).toEqual([]);
    const loops = [...css.matchAll(/animation: ([^;]+);/g)].map((m) => m[1]).filter((v) => /infinite/.test(v));
    expect(loops).toEqual(['fw-spin 0.8s linear infinite']);
  });

  it('no component rounds a corner past 2 px inline', () => {
    const offenders: string[] = [];
    for (const rel of listTsx('src/ui/dashboard')) {
      const src = readFileSync(repoPath(rel), 'utf8'); // small components sit under readSource's floor
      for (const m of src.matchAll(/borderRadius: ?(?:(\d+(?:\.\d+)?)\b|(['"])([^'"]+)\2)/g)) {
        const tokens = m[1] !== undefined ? [m[1]] : m[3].trim().split(/\s+/);
        if (tokens.some((t) => !cornerHolds(t))) offenders.push(`${rel}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('sets no text under 12 px and no capitals as a style, in the sheets or inline', () => {
    const small = /font-size: ?(\d+(?:\.\d+)?)px/g;
    const sheet = [DESIGN, FRAME, HOUSE].flatMap((f) => [...readSource(f).matchAll(small)])
      .filter((m) => parseFloat(m[1]) < 12).map((m) => m[0]);
    expect(sheet).toEqual([]);
    const inline: string[] = [];
    for (const rel of listTsx('src/ui/dashboard')) {
      const src = readFileSync(repoPath(rel), 'utf8');
      for (const m of src.matchAll(/fontSize: ?(\d+(?:\.\d+)?)\b/g)) if (parseFloat(m[1]) < 12) inline.push(`${rel}: ${m[0]}`);
      if (/textTransform: ?'uppercase'/.test(src)) inline.push(`${rel}: textTransform uppercase`);
    }
    expect(inline).toEqual([]);
  });
});

// The house sheet sets every old radius token to 0 or 2 px except --fw-r-2 and the two names that point at it, the
// overlay corner of 4 px (dashboard-house.css); a card or panel that reaches for one of those is past the house's 2 px.
const ROUND_TOKENS = /^var\(--fw-(r-2|r-xl|radius-xl)\)$/;

function cornerHolds(t: string): boolean {
  if (t === '0') return true;
  if (t.startsWith('var(')) return !ROUND_TOKENS.test(t);
  return parseFloat(t) <= 2;
}

function listTsx(dirRel: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const name of readdirSync(repoPath(rel))) {
      const child = `${rel}/${name}`;
      if (statSync(repoPath(child)).isDirectory()) walk(child);
      else if (child.endsWith('.tsx')) out.push(child);
    }
  };
  walk(dirRel);
  return out;
}
