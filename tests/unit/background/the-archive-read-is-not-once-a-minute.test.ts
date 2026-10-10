// The deep archive read ran about once a minute, for ever, on every install.
//
// `service-worker.ts` calls the chain-height check at module scope with the
// archive half switched on, and its comment says that is safe because it
// happens on a worker start rather than on every tick. A worker start is not a
// rare event. `forensic-outbox-drain` is armed at `periodInMinutes: 1` and an
// MV3 worker idles out at about thirty seconds, so Chrome starts a fresh realm
// roughly every minute for as long as it is open, and module scope runs every
// time.
//
// The archive read enumerates the whole IndexedDB database list and then opens,
// counts and closes one database per archived month. A person with a year of
// archives paid about twelve database opens a minute, indefinitely, for an
// answer that changes at most once. Found 2026-09-19, and new in 2.5.11: the
// check itself landed the day before.
//
// These cases hold the bound. The shallow check still runs on every realm,
// because that is the one that catches the live record being destroyed; the
// archive read is skipped while a recent one is on the note.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const archiveCalls = { listed: 0, counted: 0 };

vi.mock('../../../src/forensics/archive-reader', () => ({
  listArchiveMonthsDetailed: vi.fn(async () => {
    archiveCalls.listed++;
    return { complete: true, months: ['2026-01', '2026-02', '2026-03'] };
  }),
  countArchivedRecords: vi.fn(async () => {
    archiveCalls.counted++;
    return { complete: true, count: 900 };
  }),
}));

const chainReads = { state: 0 };

vi.mock('../../../src/forensics/store', () => ({
  getChainState: vi.fn(async () => { chainReads.state++; return { nextPosition: 12 }; }),
  getChainOriginKind: vi.fn(async () => 'fresh'),
}));

vi.mock('../../../src/forensics/gap-marker', () => ({
  appendGapMarker: vi.fn(async () => undefined),
}));

import { checkChainHeightOnRealmStart } from '../../../src/background/chain-height';
import { installChromeStorageStub, type ChromeStorageStub } from '../../helpers/chrome-storage';

const HOUR = 60 * 60 * 1000;
let storage: ChromeStorageStub;

/**
 * A `chrome.storage.session` on top of the stub's local, kept in its own object
 * so a test can empty it the way a browser restart does. The shipped helper has
 * no session area, which is itself the fallback path this code has to survive.
 */
function installSession(): { state: Record<string, unknown> } {
  const state: Record<string, unknown> = {};
  const chromeAny = (globalThis as { chrome?: { storage?: Record<string, unknown> } }).chrome;
  chromeAny!.storage!.session = {
    get: (k: string) => Promise.resolve(k in state ? { [k]: state[k] } : {}),
    set: (obj: Record<string, unknown>) => { Object.assign(state, obj); return Promise.resolve(); },
  };
  return { state };
}

beforeEach(() => {
  archiveCalls.listed = 0;
  archiveCalls.counted = 0;
  chainReads.state = 0;
  storage = installChromeStorageStub();
});

afterEach(() => {
  storage.restore();
  vi.clearAllMocks();
});

describe('the archive read is not once a minute (2026-09-19)', () => {
  it('reads the archives on the first realm of a browser session', async () => {
    installSession();
    await checkChainHeightOnRealmStart(0);
    expect(archiveCalls.listed, 'the first realm still does the deep read').toBe(1);
  });

  it('a minute of fresh realms costs one archive read, not sixty', async () => {
    installSession();
    // Sixty realm starts, one minute apart: the real cadence, measured against
    // the alarm and the MV3 idle timeout rather than guessed.
    for (let minute = 0; minute < 60; minute++) {
      await checkChainHeightOnRealmStart(minute * 60 * 1000);
    }
    expect(archiveCalls.listed, 'one enumeration an hour, not sixty').toBe(1);
    expect(archiveCalls.counted, 'and one pass over the month databases').toBe(1);
    // The half that must NOT be throttled: the live record is read every time,
    // because a destroyed chain has to be seen within minutes, not hours.
    expect(chainReads.state, 'the shallow check still runs on every realm').toBe(60);
  });

  it('reads them again once the interval has passed', async () => {
    installSession();
    await checkChainHeightOnRealmStart(0);
    await checkChainHeightOnRealmStart(5 * HOUR);
    expect(archiveCalls.listed, 'still inside the interval').toBe(1);
    await checkChainHeightOnRealmStart(7 * HOUR);
    expect(archiveCalls.listed, 'past it').toBe(2);
  });

  it('a browser restart reads them again, whatever the clock says', async () => {
    const session = installSession();
    await checkChainHeightOnRealmStart(0);
    expect(archiveCalls.listed).toBe(1);
    // Closing the browser empties session storage. The next realm is one minute
    // later on the clock and must still read.
    for (const k of Object.keys(session.state)) delete session.state[k];
    await checkChainHeightOnRealmStart(60 * 1000);
    expect(archiveCalls.listed, 'the first realm of a session always reads').toBe(2);
  });

  it('falls back to local storage when the realm has no session area, and is still bounded', async () => {
    // No installSession() here: the shipped test stub has no session area, and
    // neither does a realm on an older Chrome. The note goes to local storage,
    // which outlives the browser, so the guarantee weakens from "once per
    // session" to "once per interval" and stays bounded either way.
    for (let minute = 0; minute < 60; minute++) {
      await checkChainHeightOnRealmStart(minute * 60 * 1000);
    }
    expect(archiveCalls.listed, 'bounded without session storage too').toBe(1);
    expect(storage.state['fw_chain_height_archives_read_at'], 'the note landed in local').toBe(0);
  });

  it('reads the archives when both stores refuse, because a worker that cannot remember checks', async () => {
    const chromeAny = (globalThis as { chrome?: { storage?: Record<string, unknown> } }).chrome;
    const broken = {
      get: () => Promise.reject(new Error('no storage')),
      set: () => Promise.reject(new Error('no storage')),
    };
    chromeAny!.storage!.session = broken;
    chromeAny!.storage!.local = broken;
    await checkChainHeightOnRealmStart(0);
    await checkChainHeightOnRealmStart(60 * 1000);
    expect(archiveCalls.listed, 'the old behaviour is the safe end of this').toBe(2);
  });
});
