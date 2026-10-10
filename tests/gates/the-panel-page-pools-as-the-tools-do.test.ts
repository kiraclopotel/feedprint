/** @vitest-environment jsdom */
// verifier/panel.html is the double-click way a group pools its volunteers' files, so it runs kit.browser.js, a
// plain-script copy of pool.mjs and the table tools made by scripts/build-kit-browser.mjs. A copy can drift, so the
// file on disk must be what the build writes now, and the browser copy, loaded the way the page loads it, must give
// the same pool and the same two tables as the command-line tools on the published vector whose text is not plain
// ASCII.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error - the build script is plain JavaScript with no types
import { buildKitBrowserSource } from '../../scripts/build-kit-browser.mjs';
// @ts-expect-error - the shipped tools are plain JavaScript with no types
import { buildPool } from '../../verifier/pool.mjs';
// @ts-expect-error - the shipped tools are plain JavaScript with no types
import { rowsOf, toCsv } from '../../verifier/to-csv.mjs';
// @ts-expect-error - the shipped tools are plain JavaScript with no types
import { fourcatRows, toFourcatCsv } from '../../verifier/to-4cat.mjs';
import { REPO_ROOT } from '../helpers/repo-root';

const read = (p: string) => readFileSync(resolve(REPO_ROOT, p), 'utf8');
type Kit = { pool: { buildPool: typeof buildPool }; toCsv: { rowsOf: typeof rowsOf; toCsv: typeof toCsv }; to4cat: { fourcatRows: typeof fourcatRows; toFourcatCsv: typeof toFourcatCsv } };
let kit: Kit;
let example: string;

beforeAll(() => {
  // The page loads these two as classic scripts, in this order.
  (0, eval)(read('verifier/verify-export.browser.js'));
  (0, eval)(read('verifier/kit.browser.js'));
  kit = (window as unknown as { FWKit: Kit }).FWKit;
  example = read('verifier/vectors/11-text-escaping.html');
});

describe('the panel page', () => {
  it('loads the browser kit the build writes now, so the page cannot run older tools than the folder holds', () => {
    expect(read('verifier/kit.browser.js')).toBe(buildKitBrowserSource());
  });

  it('loads the checker and the kit, nothing from the network', () => {
    const page = read('verifier/panel.html');
    const sources = [...page.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
    expect(sources).toEqual(['verify-export.browser.js', 'kit.browser.js']);
    expect(page).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });

  it('pools a published vector as pool.mjs does, and writes the same two tables', async () => {
    const inputs = [{ label: '11-text-escaping.html', text: example }];
    const inBrowser = await kit.pool.buildPool(inputs);
    const inNode = await buildPool(inputs);
    expect(JSON.parse(JSON.stringify(inBrowser))).toEqual(JSON.parse(JSON.stringify(inNode)));
    expect(inBrowser.refused).toEqual([]);
    expect(kit.toCsv.toCsv(await kit.toCsv.rowsOf(inBrowser))).toBe(toCsv(await rowsOf(inNode)));
    expect(kit.to4cat.toFourcatCsv(await kit.to4cat.fourcatRows(inBrowser))).toBe(toFourcatCsv(await fourcatRows(inNode)));
  });
});
