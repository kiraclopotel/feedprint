// The look batch L8 to L12 (board/units/L8.md to L12.md; board/desks/look/QUEUE.md rows L9 to L12), read off the source:
// L8   the popup header's "Open your record" button draws the record's own icon, not the outside-link icon;
// L9   every dash-btn or dash-input class in src resolves to a rule in the dashboard sheet (the Export tab's controls were drawn as
//      white system buttons on the dark page because the classes had no rule), and a disabled .btn looks off;
// L10  a disabled export card looks off, and the report card shows RECOMMENDED only while it can be used;
// L11  the Record tab's last two cards have inner room;
// L12  the Statistics tab has two widths only: full cards, and tiles three to a row.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT as ROOT } from '../../../helpers/repo-root';

const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const CSS = read('src/ui/dashboard/dashboard-design.css');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.tsx?$/.test(name)) out.push(rel);
  }
  return out;
}

describe('L8: the record has its own icon in the popup header', () => {
  it('"Open your record" draws FileText, not ExternalLink', () => {
    const header = read('src/ui/popup/panels/header.tsx');
    const at = header.indexOf('onClick={onOpenDashboard}');
    expect(at).toBeGreaterThan(-1);
    const button = header.slice(at, header.indexOf('</button>', at));
    expect(button).toContain('<FileText');
    expect(button).not.toContain('<ExternalLink');
  });
});

describe('L9: the dashboard classes have rules', () => {
  it('every dash-btn or dash-input used in src has a rule in the dashboard sheet', () => {
    const used = new Set<string>();
    for (const f of sourceFiles('src/ui')) {
      for (const m of read(f).matchAll(/className="([^"]*)"/g)) {
        for (const c of m[1].split(/\s+/)) if (c === 'dash-btn' || c === 'dash-input') used.add(c);
      }
    }
    for (const c of used) expect(CSS, `.${c} has no rule`).toMatch(new RegExp(`\\.${c}\\s*[{:,]`));
    expect(used.has('dash-btn'), 'the Export tab buttons now use the dashboard\'s own .btn').toBe(false);
  });

  it('the Export tab field has a field look with a focus ring, and a disabled button looks off', () => {
    const tab = read('src/ui/dashboard/components/ExportTab.tsx');
    expect(tab.match(/className="dash-input"/g) ?? [], 'the passphrase field and the name field at the top').toHaveLength(2);
    expect(CSS).toMatch(/\.dash-input\s*\{[^}]*background: var\(--fw-surface\)/);
    expect(CSS).toMatch(/\.dash-input:focus\s*\{[^}]*box-shadow: 0 0 0 2px var\(--fw-accent\)/);
    expect(CSS).toMatch(/\.btn:disabled\s*\{[^}]*opacity: 0\.5;[^}]*cursor: not-allowed/);
  });
});

describe('L10: an export card that cannot be used looks off', () => {
  it('a disabled export card is dimmed, does not lift and shows the not-allowed cursor', () => {
    expect(CSS).toMatch(/\.export-card:disabled\s*\{[^}]*opacity: 0\.5;[^}]*cursor: not-allowed;[^}]*transform: none/);
    expect(CSS).toMatch(/\.export-card:disabled:hover\s*\{[^}]*transform: none/);
  });

  it('RECOMMENDED is drawn on the same condition the card is enabled', () => {
    const tab = read('src/ui/dashboard/components/ExportTab.tsx');
    expect(tab).toContain('disabled={busy || nothingFlagged}');
    expect(tab).toContain('{!(busy || nothingFlagged) && <span className="export-card-pill recommended">');
  });
});

describe('L11: the Record tab cards have inner room', () => {
  it('.entries-table-wrap has the 16 px step as padding', () => {
    expect(CSS).toMatch(/\.entries-table-wrap\s*\{\s*padding: var\(--fw-s-7\);\s*\}/);
  });
});

describe('L12: the Statistics tab has two widths only', () => {
  it('every stats card is full width or a third (a tile)', () => {
    const tab = read('src/ui/dashboard/components/StatisticsTab.tsx');
    const plainDivs = [...tab.matchAll(/className="stats-card( [a-z]+)?"/g)].map((m) => (m[1] ?? '').trim());
    for (const kind of plainDivs) expect(['full', 'third']).toContain(kind);
    const cards = tab.split('<StatsCard').slice(1).map((chunk) => chunk.slice(0, chunk.indexOf('>')));
    expect(cards.length).toBeGreaterThan(0);
    for (const props of cards) expect(props).toMatch(/^\s*\n\s*full\b/);
  });
});
