// A commit that fails after its request succeeded fires only the transaction's
// abort event. A side-store write that listens for errors alone then never
// settles and keeps its connection open; the author update does this under the
// worker's per-author lock, so every later sighting of that account waits too.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logScanEvent, purgeScanEvents } from '../../../src/forensics/scan-log';
import { updateAuthorProfile } from '../../../src/forensics/author-store';
import { deleteDb } from '../../helpers/indexeddb';
import type { ScanEvent } from '../../../src/types/scan-event';

const SCANS = 'feelingwise-scans';
const AUTHORS = 'feelingwise-authors';

type Method = 'add' | 'put' | 'delete';

/** The next call of this store method on this database succeeds and then its transaction aborts before it commits. */
function abortAtCommitAfter(method: Method, dbName: string): void {
  const honest = IDBObjectStore.prototype[method] as (this: IDBObjectStore, ...args: unknown[]) => IDBRequest;
  vi.spyOn(IDBObjectStore.prototype, method).mockImplementation(function (this: IDBObjectStore, ...args: unknown[]) {
    const req = honest.apply(this, args);
    if (this.transaction.db.name === dbName) {
      req.addEventListener('success', () => this.transaction.abort(), { once: true });
    }
    return req;
  } as never);
}

/** How a call ended within the time given, so a hang fails as a hang and not as the suite timeout. */
async function outcomeWithin<T>(work: Promise<T>, ms: number): Promise<{ state: 'resolved' | 'rejected' | 'hung'; value?: T }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<{ state: 'hung' }>((resolve) => {
    timer = setTimeout(() => resolve({ state: 'hung' }), ms);
  });
  try {
    return await Promise.race([
      work.then((value) => ({ state: 'resolved' as const, value }), () => ({ state: 'rejected' as const })),
      late,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function scanEvent(timestamp: string): ScanEvent {
  return { timestamp, platform: 'twitter', action: 'pass' } as unknown as ScanEvent;
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await deleteDb(SCANS);
  await deleteDb(AUTHORS);
});

describe('a side-store write whose commit aborts', () => {
  it('a scan log entry rejects and lets go of its database', async () => {
    abortAtCommitAfter('add', SCANS);

    const outcome = await outcomeWithin(logScanEvent(scanEvent(new Date().toISOString())), 1000);

    expect(outcome.state).toBe('rejected');
    await expect(deleteDb(SCANS), 'no connection is left open').resolves.toBeUndefined();
  });

  it('a scan log purge reports nothing purged and lets go of its database', async () => {
    await logScanEvent(scanEvent('2020-01-01T00:00:00.000Z'));
    abortAtCommitAfter('delete', SCANS);

    const outcome = await outcomeWithin(purgeScanEvents(30), 1000);

    expect(outcome).toEqual({ state: 'resolved', value: 0 });
    await expect(deleteDb(SCANS), 'no connection is left open').resolves.toBeUndefined();
  });

  it('an author profile update rejects and lets go of its database', async () => {
    abortAtCommitAfter('put', AUTHORS);

    const outcome = await outcomeWithin(updateAuthorProfile('someone', 'twitter', false, []), 1000);

    expect(outcome.state).toBe('rejected');
    await expect(deleteDb(AUTHORS), 'no connection is left open').resolves.toBeUndefined();
  });
});
