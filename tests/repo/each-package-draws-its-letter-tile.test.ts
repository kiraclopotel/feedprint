// Each package's toolbar and extensions-page icon is its letter tile: Feedprint's fp, Off's off. Both manifests name
// the same four paths, and the build fills them from assets/icons for Feedprint and assets/icons-off for Off, so this
// holds the manifests to those paths, the build to that choice, and each icon file to its size. That each file is
// byte for byte the tile the design folder exports is checked in tests/private/design/icons-match-the-design-exports.test.ts:
// the design folder is not in the public copy of this repository (scripts/public-snapshot.mjs).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoPath } from '../helpers/repo-root';

const SIZES = [16, 32, 48, 128] as const;
const PATHS = Object.fromEntries(SIZES.map((s) => [String(s), `assets/icons/icon-${s}.png`]));

/** Width and height from a PNG's header. */
function pngSize(bytes: Buffer): [number, number] {
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

describe('each package draws its letter tile', () => {
  for (const manifest of ['manifest.json', 'manifest.off.json']) {
    it(`${manifest} names the four icon paths, for the package and for its toolbar button`, () => {
      const m = JSON.parse(readFileSync(repoPath(manifest), 'utf8'));
      expect(m.icons).toEqual(PATHS);
      expect(m.action.default_icon).toEqual(PATHS);
    });
  }

  it('the build fills those paths from assets/icons-off for Off and from assets/icons for Feedprint', () => {
    expect(readFileSync(repoPath('vite.config.ts'), 'utf8'))
      .toMatch(/resolve\(__dirname, 'assets', isOffBuild \|\| isOffContentBuild \? 'icons-off' : 'icons'\)/);
  });

  for (const [folder, tile] of [['icons', 'feedprint'], ['icons-off', 'off']] as const) {
    for (const size of SIZES) {
      it(`assets/${folder}/icon-${size}.png is ${size} x ${size} (the ${tile} tile)`, () => {
        const icon = readFileSync(repoPath('assets', folder, `icon-${size}.png`));
        expect(pngSize(icon)).toEqual([size, size]);
      });
    }
  }
});
