// @vitest-environment jsdom
//
// EVIDENCE-PATH-2: the author profile store is extension-private. Opening it
// from a content script (host page origin) created an empty copy of
// 'feelingwise-authors' in every visited site's origin, which the page could
// enumerate, and the lookup always returned null. The store now refuses to
// open outside the chrome-extension: origin and records why. The extension
// origin (service worker, dashboard) still opens normally.
//
// jsdom's default URL is http://localhost/, which is a page origin. The
// extension-origin case swaps `location` for a chrome-extension: URL via a
// jsdom-settable property override.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
  getAuthorProfile,
  getAllAuthorProfiles,
  updateAuthorProfile,
} from '../../../src/forensics/author-store';
import {
  RealmGuardError,
  _resetRealmGuardForTests,
  isExtensionRealm,
  lastRealmRefusal,
} from '../../../src/storage/realm-guard';

function setLocation(href: string): void {
  const url = new URL(href);
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href, protocol: url.protocol, host: url.host, origin: url.origin },
  });
}

const originalLocation = window.location;

beforeEach(() => {
  _resetRealmGuardForTests();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  vi.restoreAllMocks();
});

describe('author-store realm guard (EVIDENCE-PATH-2)', () => {
  it('page origin: never calls indexedDB.open, reads degrade to empty, refusal is recorded', async () => {
    setLocation('https://www.tiktok.com/@someone');
    expect(isExtensionRealm()).toBe(false);
    const open = vi.spyOn(indexedDB, 'open');

    expect(await getAuthorProfile('@u', 'tiktok')).toBeNull();
    expect(await getAllAuthorProfiles()).toEqual([]);
    await expect(updateAuthorProfile('@u', 'tiktok', true, ['false-urgency'])).rejects.toBeInstanceOf(
      RealmGuardError,
    );

    expect(open).not.toHaveBeenCalled();
    expect(lastRealmRefusal()).toMatchObject({
      dbName: 'feelingwise-authors',
      origin: 'https://www.tiktok.com',
    });
    expect(await indexedDB.databases()).toEqual([]);
  });

  it('extension origin: opens the store and round-trips a profile', async () => {
    setLocation('chrome-extension://abcdefghijklmnop/dashboard.html');
    expect(isExtensionRealm()).toBe(true);
    const open = vi.spyOn(indexedDB, 'open');

    await updateAuthorProfile('@u', 'tiktok', true, ['false-urgency']);
    await updateAuthorProfile('@u', 'tiktok', false, []);
    const profile = await getAuthorProfile('@u', 'tiktok');

    expect(open).toHaveBeenCalled();
    expect(profile).toMatchObject({ handle: '@u', platform: 'tiktok', totalSeen: 2, totalFlagged: 1 });
    expect(lastRealmRefusal()).toBeNull();
  });
});
