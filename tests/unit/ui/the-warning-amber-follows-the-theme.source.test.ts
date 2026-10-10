// A fixed amber (#d98a00) is about 3.2:1 on the light theme's white, where the light amber token is 5.4:1, so a warning
// drawn with the raw value is hard to read there. Every warning colour on the popup and the dashboard comes from the
// theme's --fw-amber, and the popup frame's edge is the theme's border colour, not black.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT as ROOT } from '../../helpers/repo-root';

const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...tsxFiles(rel));
    else if (name.endsWith('.tsx')) out.push(rel);
  }
  return out;
}

describe('the warning amber follows the theme', () => {
  it('no screen draws the raw amber as a colour value', () => {
    const hits = tsxFiles('src/ui').filter((f) => /'#d98a00'/i.test(read(f)));
    expect(hits).toEqual([]);
  });

  it('the popup frame has the border colour as its edge', () => {
    const css = read('src/ui/popup/popup-design.css');
    const frame = css.slice(css.indexOf('.fw-popup {'), css.indexOf('}', css.indexOf('.fw-popup {')));
    expect(frame).toContain('border: 1px solid var(--fw-border);');
    expect(frame).not.toMatch(/#000\b/);
  });
});
