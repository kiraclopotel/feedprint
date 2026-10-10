// Ten databases, six of them cleared, and nothing comparing the lists.
//
// resetForensicChain's docblock enumerates what the reset clears, and the
// dialog in front of it tells a person what they are about to lose. Both lists
// were written by hand, and the product had grown four more IndexedDB
// databases since: a theme cache holding labels built out of the words of the
// posts, two dev-flag capture stores holding verbatim post text (and, in one
// case, the prompts and the model's raw answers), and a salvage store holding
// records imported by hand from old exports.
//
// None of those four was in either list, and none was wrong on purpose: each
// is normally empty or disposable, which is exactly why nobody looked. A store
// that is usually empty still has to be emptied by the act that says it empties
// things, or named as deliberately kept.
//
// So this check does not test the wipe. It tests that every database the
// product can open has been PLACED: either the reset clears it, or the docblock
// says in words why it does not. A new store added tomorrow fails here until
// somebody decides which it is. (2026-09-18)

import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT as ROOT } from '../helpers/repo-root';

const STORE_FILE = join(ROOT, 'src', 'forensics', 'store.ts');

/**
 * Every name the product actually opens a database under.
 *
 * The docblock here said "a `DB_NAME` or `archiveDbName`-shaped position" and
 * the pattern matched `const DB_NAME = '…'` and nothing else, so a store opened
 * under any other constant was invisible to the check written for exactly this
 * class of miss (found 2026-09-19).
 *
 * Two wider readers were tried and both were worse, which is worth recording
 * because each looked right. A net over every `feelingwise-…` string dragged in
 * five download filenames and a chain hash, and would have needed an exemption
 * list, which is how a guard stops guarding. Finding a database because it is
 * OPENED as one, by resolving every `indexedDB.open(X)`, saw five of the nine:
 * four stores go through a shared open helper and never touch indexedDB
 * themselves. The count case below is what caught that.
 *
 * What it does now is the union of the two honest halves: a `DB_NAME` constant
 * by convention, or any constant this tree actually hands to `indexedDB.open`.
 * The second is the hole the old pattern left, a store opened under some other
 * constant name.
 *
 * **The limit, said out loud rather than implied:** a store under a constant
 * that is neither called `DB_NAME` nor passed to `indexedDB.open` directly,
 * reaching the database only through a helper, is still invisible. The case
 * below narrows even that, by failing when a shape of opener appears that this
 * reader does not understand.
 *
 * Measured when this was widened: nine `DB_NAME` constants, three `open(name)`
 * sites taking a caller-supplied name, and the archive function. No database
 * was being missed, so this closes a hole rather than a leak, which is the only
 * moment it can be done cheaply.
 *
 * Read as text rather than imported, because importing the modules would open
 * the databases.
 */
function databaseNamesInSource(): Map<string, string> {
  const found = new Map<string, string>();
  const openerIdents = openerIdentifiers();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) { walk(abs); continue; }
      if (!entry.isFile() || !['.ts', '.tsx'].includes(extname(entry.name))) continue;
      const text = readFileSync(abs, 'utf8');
      for (const m of text.matchAll(/const ([A-Za-z_$][\w$]*) = '(feelingwise-[a-z0-9-]+)'/g)) {
        const [, ident, name] = m;
        // `DB_NAME` by convention, OR any constant this tree hands to
        // indexedDB.open. The first covers the four stores that go through a
        // shared open helper rather than calling indexedDB themselves, which is
        // why "found because it is opened" cannot stand alone: written that way
        // first, it saw five of the nine, and the count case below caught it.
        if (ident !== 'DB_NAME' && !openerIdents.has(ident)) continue;
        if (!found.has(name)) found.set(name, entry.name);
      }
    }
  };
  walk(join(ROOT, 'src'));
  return found;
}

/** The identifiers every `indexedDB.open` in the tree is handed. */
function openerIdentifiers(): Set<string> {
  const idents = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) { walk(abs); continue; }
      if (!entry.isFile() || !['.ts', '.tsx'].includes(extname(entry.name))) continue;
      for (const m of readFileSync(abs, 'utf8').matchAll(/indexedDB\.open\(\s*([A-Za-z_$][\w$]*)/g)) {
        idents.add(m[1]);
      }
    }
  };
  walk(join(ROOT, 'src'));
  return idents;
}

/** The two lists in resetForensicChain's docblock, as one blob of prose. */
function resetDocblock(): string {
  const text = readFileSync(STORE_FILE, 'utf8');
  const start = text.indexOf('**What it clears:**');
  const end = text.indexOf('export async function resetForensicChain(');
  expect(start, 'the docblock still has its What it clears list').toBeGreaterThan(-1);
  expect(end, 'and resetForensicChain is still below it').toBeGreaterThan(start);
  return text.slice(start, end);
}

describe('every database the product opens is placed by the reset', () => {
  const names = databaseNamesInSource();

  it('found the databases at all', () => {
    // A green run over an empty list proves nothing. Nine were counted the day
    // this was written, plus the per-month archives, which are built from a key
    // rather than a constant and are named in the docblock in words.
    expect(names.size).toBeGreaterThanOrEqual(8);
    expect([...names.keys()]).toContain('feelingwise-forensics');
  });

  it('every way a database is opened is one this reader understands', () => {
    // The half that keeps the reader honest as the code moves. Three shapes are
    // known: a constant this file resolves, a caller-supplied `name`, and the
    // archive function whose months the docblock names in words. A FOURTH shape
    // appearing means the reader has gone blind again in the same way it was
    // blind before 2026-09-19, and it must fail here rather than pass quietly.
    const known = new Set(['DB_NAME', 'name', 'archiveDbName']);
    const unknown = [...openerIdentifiers()].filter((i) => !known.has(i));
    expect(
      unknown,
      unknown.length === 0 ? '' :
        `indexedDB.open is called with ${unknown.join(', ')}, which this guard cannot resolve ` +
        'to a database name. Either give the store a `const DB_NAME`, or teach the reader the ' +
        'new shape. A name this check cannot read is a store the reset is not holding to account.',
    ).toEqual([]);
  });

  it('names each one in the docblock, as cleared or as deliberately kept', () => {
    const doc = resetDocblock();
    const unplaced = [...names.keys()].filter((n) => !doc.includes(n));
    expect(
      unplaced,
      unplaced.length === 0 ? '' :
        `these databases are opened by the product and appear in neither list of ` +
        `resetForensicChain's docblock:\n  ${unplaced.join('\n  ')}\n\n` +
        'Decide which it is. If the reset should empty it, clear it there and add it to ' +
        '"What it clears". If it should survive, add it to "What it deliberately leaves, and why" ' +
        'with the reason. Do not leave it unnamed: a store nobody placed is a store that outlives ' +
        'the act a person believed had emptied it.',
    ).toEqual([]);
  });

  it('actually clears the three that the docblock says it clears', () => {
    const text = readFileSync(STORE_FILE, 'utf8');
    // The list this file was written for. Each is called inside the reset's
    // own Promise.allSettled, not merely mentioned in a comment.
    for (const call of ['clearThemeCache()', 'clearCapturedBehavior()', 'clearCapturedTuples()']) {
      expect(text, `the reset calls ${call}`).toContain(call);
    }
  });
});
