// M11 (F39, both products): the 15-minute PIN grace starts only when the PIN is TYPED, never because a PIN was set.
// A person who sets a PIN and then tries it (close, reopen) must be asked, and a device handed over in the
// minutes after setting must not be open. The mark (markPinVerified) is made in exactly one place: verifyPin,
// which runs when a right PIN is entered. The three places that used to make it on "set" (SetPinPanel on Save,
// SetPinPanel on "I wrote it down", the setup wizard) no longer do.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const callers = sourceFiles(join(root, 'src'))
  .map((file) => ({ file: file.slice(root.length + 1).replace(/\\/g, '/'), text: readFileSync(file, 'utf8') }))
  .filter(({ text }) => /\bmarkPinVerified\s*\(/.test(text.replace(/\/\/.*$/gm, '')));

describe('the PIN grace starts only on a typed PIN', () => {
  it('markPinVerified is called only in settings.ts', () => {
    expect(callers.map((c) => c.file)).toEqual(['src/storage/settings.ts']);
  });

  it('and there only inside verifyPin, after a right PIN', () => {
    const text = readFileSync(join(root, 'src/storage/settings.ts'), 'utf8').replace(/\/\/.*$/gm, '');
    const calls = text.match(/\bmarkPinVerified\s*\(/g) ?? [];
    // one definition (export async function markPinVerified) and one call
    expect(calls.length).toBe(2);
    expect(text).toMatch(/if \(ok\) await markPinVerified\(\);/);
  });
});
