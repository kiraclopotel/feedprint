// PH unit 2 (PAINT-1 S-22): the two Receipts pages a person meets in a browser tab are titled with the
// product's name. Since B1 the popup page is the first tab a new install opens, and it said "FeelingWise";
// the record page said "FeelingWise Dashboard". Chrome shows Receipts under the name Receipts, and Off
// under Off, so each page says its own. Off's page is not touched here.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const titleOf = (file: string): string => {
  const html = readFileSync(join(root, file), 'utf8');
  const m = html.match(/<title>([^<]*)<\/title>/);
  if (!m) throw new Error(`${file} has no title`);
  return m[1];
};

describe('the tab titles', () => {
  it('the popup page says Feedprint', () => {
    expect(titleOf('src/ui/popup/index.html')).toBe('Feedprint');
  });

  // The record product is now called Feedprint; the popup's own title is renamed with the popup.
  it('the record page says Feedprint: your record', () => {
    expect(titleOf('src/ui/dashboard/index.html')).toBe('Feedprint: your record');
  });

  it("Off's popup page keeps its own name", () => {
    expect(titleOf('src/products/off/popup/index.html')).toBe('Off');
  });
});
