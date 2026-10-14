// Cold audit 13 Oct 2026, finding 3: the private signing key moved from chrome.storage.local, which a
// content script can read, to the extension's own IndexedDB. The old slot's name may appear in one
// place only, the module that moves an older install's key out of it; any other reader or writer
// would bring the exposure back.

import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT as ROOT } from '../helpers/repo-root';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(abs));
    else if (['.ts', '.tsx'].includes(extname(entry.name))) out.push(abs);
  }
  return out;
}

describe('no code keeps the private signing key in chrome.storage', () => {
  it('the old slot is named only by the signing module', () => {
    const naming = sourceFiles(join(ROOT, 'src'))
      .filter((f) => readFileSync(f, 'utf8').includes('fw_signing_private_jwk'))
      .map((f) => relative(ROOT, f).replace(/\\/g, '/'));
    expect(naming).toEqual(['src/forensics/signing.ts']);
  });

  it('the signing module only reads and removes the old slot, never writes it', () => {
    const text = readFileSync(join(ROOT, 'src', 'forensics', 'signing.ts'), 'utf8');
    const sets = [...text.matchAll(/chrome\.storage\.local\.set\(\{([\s\S]*?)\}\)/g)].map((m) => m[1]);
    expect(sets.length).toBeGreaterThan(0);
    for (const body of sets) {
      expect(body).not.toMatch(/STORAGE_KEY_PRIVATE|privateJwk|fw_signing_private_jwk/);
    }
  });
});
