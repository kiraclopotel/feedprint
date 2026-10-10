// @vitest-environment jsdom
//
// Section 4 cause 5: every FeelingWise IndexedDB database is extension-
// private, but a content script's `indexedDB` is the host page's origin.
// An opener that runs there creates an empty copy of the database in the
// page's origin (the writer never meets the reader, and the page can
// enumerate the name). Every opener now calls assertExtensionRealm before
// indexedDB.open (src/storage/realm-guard.ts).
//
// Two locks: a static one that enumerates every `indexedDB.open` in src/
// and requires the guard in the same file ahead of it, and a behavioral
// one that calls each store's public entry in a page-origin jsdom and
// asserts indexedDB.open is never reached.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { _resetRealmGuardForTests, lastRealmRefusal } from '../../../src/storage/realm-guard';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('static: every indexedDB.open in src/ sits behind assertExtensionRealm', () => {
  const srcRoot = join(process.cwd(), 'src');
  // The call form, so a comment that names the API does not count as an opener.
  const openers = walk(srcRoot).filter(f => /(const|let) \w+ = indexedDB\.open\(/.test(readFileSync(f, 'utf8')));

  it('enumerates the known openers', () => {
    const names = openers.map(f => relative(srcRoot, f).replace(/\\/g, '/')).sort();
    expect(names).toEqual([
      // archive-naming.ts owns the archive-DB open since archive-on-evict:
      // chain-rotation and archive-writer both call it, so the opener moved
      // out of chain-rotation.ts rather than being duplicated.
      'forensics/archive-naming.ts',
      'forensics/archive-reader.ts',
      'forensics/author-store.ts',
      'forensics/backup-folder-wire.ts',
      'forensics/idb-open.ts',
      // Salvage lives in its own database so recovered prior-generation
      // records can never collide with the live chain's positions.
      'forensics/salvage-store.ts',
      'forensics/scan-log.ts',
      'forensics/store.ts',
    ]);
  });

  for (const file of openers) {
    it(`${relative(srcRoot, file).replace(/\\/g, '/')} guards before it opens`, () => {
      const src = readFileSync(file, 'utf8');
      expect(src).toMatch(/from '(\.\.\/)+storage\/realm-guard'/);
      const guardAt = src.indexOf('assertExtensionRealm(');
      // The first real call, not a comment that mentions the API.
      const openAt = src.search(/(const|let) \w+ = indexedDB\.open\(/);
      expect(guardAt).toBeGreaterThan(-1);
      expect(guardAt).toBeLessThan(openAt);
    });
  }
});

describe('behavioral: page-origin realm never reaches indexedDB.open', () => {
  const originalLocation = window.location;
  let open: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetRealmGuardForTests();
    (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: 'https://www.instagram.com/', protocol: 'https:', host: 'www.instagram.com', origin: 'https://www.instagram.com' },
    });
    open = vi.spyOn(indexedDB, 'open');
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    vi.restoreAllMocks();
  });

  const cases: Array<[string, string, () => Promise<unknown>]> = [
    ['forensics/store.ts', 'feelingwise-forensics', async () => {
      const m = await import('../../../src/forensics/store');
      return m.getRecords();
    }],
    ['forensics/scan-log.ts', 'feelingwise-scans', async () => {
      const m = await import('../../../src/forensics/scan-log');
      return m.getScanEvents();
    }],
    ['forensics/theme-cache.ts', 'feelingwise-derived', async () => {
      const m = await import('../../../src/forensics/theme-cache');
      return m.readThemeCache([]).catch(() => null);
    }],
    ['forensics/capture-behavior.ts', 'feelingwise-behavior-capture', async () => {
      const m = await import('../../../src/forensics/capture-behavior');
      m.__resetCaptureBehaviorForTests();
      return m.readAllCapturedBehavior();
    }],
    ['forensics/capture-prompt-io.ts', 'feelingwise-prompt-io-capture', async () => {
      const m = await import('../../../src/forensics/capture-prompt-io');
      m.__resetCapturePromptIOForTests();
      return m.readAllCapturedTuples();
    }],
    ['forensics/backup-folder-wire.ts', 'feelingwise-backup-folder', async () => {
      const m = await import('../../../src/forensics/backup-folder-wire');
      return m.getBackupFolderWireStatus();
    }],
    ['forensics/archive-reader.ts', 'feelingwise-forensics-2026-07', async () => {
      const m = await import('../../../src/forensics/archive-reader');
      return m.readArchiveRecords('2026-07').catch(() => null);
    }],
    ['forensics/author-store.ts', 'feelingwise-authors', async () => {
      const m = await import('../../../src/forensics/author-store');
      return m.getAllAuthorProfiles();
    }],
    ['core/perf-trace.ts', 'feelingwise-pipeline-v2-metrics', async () => {
      const m = await import('../../../src/diagnostics/perf-trace');
      return m.readRecords().catch(() => null);
    }],
  ];

  for (const [name, dbName, run] of cases) {
    it(`${name} refuses and records ${dbName}`, async () => {
      await run();
      expect(open).not.toHaveBeenCalled();
      expect(lastRealmRefusal()).toMatchObject({ dbName, origin: 'https://www.instagram.com' });
      expect(await indexedDB.databases()).toEqual([]);
    });
  }

  it('forensics/chain-rotation.ts refuses before touching an archive', async () => {
    const m = await import('../../../src/forensics/chain-rotation');
    expect(m.archiveDbName('2026-07')).toBe('feelingwise-forensics-2026-07');
    // Rotation runs only in the service worker; here the guard fires on the
    // chain store it reads first, so no archive can be created either.
    const store = await import('../../../src/forensics/store');
    await store.getRecords();
    expect(open).not.toHaveBeenCalled();
  });
});
