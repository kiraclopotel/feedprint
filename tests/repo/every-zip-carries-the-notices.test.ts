// The MIT licence React ships under asks for its notice "in all copies", and a store zip is a copy.
// Both extensions bundle react, react-dom and the scheduler react-dom pulls in, yet the notices file
// named none of them and neither build put the file into the folder the zip is cut from.
//
// So this checks the two halves: the notices file carries the licence of every package the bundles
// take from node_modules, and each product's build writes that file into its own output.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { repoPath } from '../helpers/repo-root';

const NOTICES = 'THIRD-PARTY-NOTICES.md';

function read(path: string): string {
  return readFileSync(repoPath(...path.split('/')), 'utf8');
}

/** Licence text compared by its words, so the file's own line wrapping and indentation do not count. */
function words(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

interface Shipped { name: string; dir: string }

/** Every package the bundles can take code from: the runtime dependencies and what they depend on. */
function shippedPackages(): Shipped[] {
  const pkg = JSON.parse(read('package.json')) as { dependencies?: Record<string, string> };
  const found = new Map<string, string>();
  const visit = (name: string, from: string): void => {
    if (found.has(name)) return;
    const manifest = createRequire(from).resolve(`${name}/package.json`);
    found.set(name, dirname(manifest));
    const deps = (JSON.parse(readFileSync(manifest, 'utf8')) as { dependencies?: Record<string, string> }).dependencies ?? {};
    for (const dep of Object.keys(deps)) visit(dep, manifest);
  };
  for (const name of Object.keys(pkg.dependencies ?? {})) visit(name, repoPath('package.json'));
  return [...found].map(([name, dir]) => ({ name, dir }));
}

describe('the notices file carries every bundled package', () => {
  const shipped = shippedPackages();

  it('knows what it is checking, so it cannot pass by finding nothing', () => {
    expect(shipped.map((p) => p.name)).toEqual(expect.arrayContaining(['react', 'react-dom']));
  });

  it.each(shipped.map((p) => [p.name, p.dir]))('%s: named, with its licence text in full', (name, dir) => {
    const notices = read(NOTICES);
    const named = new RegExp(`(^|[^\\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`);
    expect(named.test(notices), `${NOTICES} does not name ${name}`).toBe(true);
    const licence = readFileSync(join(dir, 'LICENSE'), 'utf8');
    expect(words(notices), `${NOTICES} does not carry the licence of ${name}`).toContain(words(licence));
  });
});

describe('each build writes the notices file into the folder its zip is cut from', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // The two builds that empty their output folder, Receipts' main build into dist/ and Off's into
  // dist-off/; the builds after them add to that folder and never remove from it.
  it.each([
    ['Receipts', undefined],
    ['Off', 'off'],
  ])('%s', async (_product, target) => {
    vi.stubEnv('BUILD_TARGET', target);
    // Keeps the config from creating a dev-reload secret file on a machine that has none.
    vi.stubEnv('FW_DEV_RELOAD', '0');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.resetModules();
    const config = (await import(pathToFileURL(repoPath('vite.config.ts')).href) as { default: { plugins?: unknown[] } }).default;
    const plugin = [config.plugins ?? []].flat(Infinity)
      .find((p): p is { name: string; writeBundle: unknown } => !!p && typeof p === 'object' && 'name' in p && p.name === 'copy-static-assets');
    expect(plugin, 'the static-assets plugin is in this build').toBeDefined();

    const out = mkdtempSync(join(tmpdir(), 'fw-notices-'));
    try {
      await (plugin!.writeBundle as (options: { dir: string }) => unknown).call({}, { dir: out });
      expect(readFileSync(join(out, NOTICES), 'utf8')).toBe(read(NOTICES));
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
