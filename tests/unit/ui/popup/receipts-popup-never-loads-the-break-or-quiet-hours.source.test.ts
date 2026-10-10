// Put on break and Quiet hours left Receipts: they are Off's switches. This walks Receipts' popup from its entry
// (src/ui/popup/index.html loads Popup.tsx) through every relative import, as the bundler would, and holds that no
// file it reaches is the quiet hours editor or anything of Off's popup, where the break fold lives. The dashboard's
// label for old 'media-timeout' records stays: it names what was done then, and the dashboard is not this entry.

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { repoPath } from '../../../helpers/repo-root';

const SRC = repoPath('src');
const ENTRY = join(SRC, 'ui', 'popup', 'Popup.tsx');
const IMPORT = /(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|import\s*\(\s*['"](\.[^'"]+)['"]\s*\)|import\s+['"](\.[^'"]+)['"]/g;

function resolveImport(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate) && /\.(ts|tsx)$/.test(candidate)) return candidate;
  }
  return null; // a stylesheet, an asset, or a file outside TypeScript
}

function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(IMPORT)) {
      const spec = m[1] ?? m[2] ?? m[3];
      const target = spec ? resolveImport(file, spec) : null;
      if (target && !seen.has(target)) queue.push(target);
    }
  }
  return seen;
}

describe("Receipts' popup never loads the break or quiet hours", () => {
  const files = [...reachable(ENTRY)].map((f) => relative(SRC, f).replace(/\\/g, '/'));

  it('walks a real graph from the entry', () => {
    expect(files).toContain('ui/popup/Popup.tsx');
    expect(files).toContain('ui/popup/panels/SettingsPanel.tsx');
    expect(files.length).toBeGreaterThan(20);
  });

  it('reaches neither the quiet hours editor nor any file of Off’s popup', () => {
    expect(files).not.toContain('ui/popup/QuietHoursEditor.tsx');
    expect(files.filter((f) => f.startsWith('products/off/'))).toEqual([]);
  });
});
