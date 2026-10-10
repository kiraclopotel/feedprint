// The marker that says an auto-update lost records could be lost to that same
// auto-update.
//
// An UPDATE orphans the content script in every open tab: chrome.runtime is
// nuked synchronously in those scripts, so anything they had observed and not
// yet delivered never arrives. That was the only loss route in the product with
// no gap reason at all, and a marker was added for it on an earlier day.
//
// The marker was written with a bare `void appendGapMarker(...)` from a
// synchronous `onInstalled` listener. Nothing holds an MV3 worker open for
// that. So the statement whose whole purpose is to say an update took records
// off the chain could itself go missing in the update, with no retry and no
// trace: a gap reason that could disappear is the same silence it was written
// to end.
//
// Found 2026-09-19. The note goes down first now and is cleared only once the
// marker is on the chain, so a worker that dies mid-write leaves the intent
// behind and the next realm writes it. The time of the UPDATE is kept in the
// note, so a marker written an hour later still says when the records were
// lost rather than when somebody got round to saying so.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../../helpers/repo-root';

const worker = (): string => readFileSync(join(REPO_ROOT, 'src/background/service-worker.ts'), 'utf8');

/** The body of one named function in the worker, for reading in isolation. */
function bodyOf(name: string): string {
  const src = worker();
  const at = src.indexOf(`async function ${name}(`);
  expect(at, `${name} is in the worker`).toBeGreaterThan(-1);
  return src.slice(at, src.indexOf('\n}\n', at));
}

describe('the update gap outlives the update (2026-09-19)', () => {
  it('the update listener notes the gap before trying to write it', () => {
    const src = worker();
    const listener = src.match(/chrome\.runtime\.onInstalled\.addListener[\s\S]*?\n\}\);/)?.[0] ?? '';
    expect(listener, 'the listener was found').not.toBe('');
    expect(listener, 'the note goes down first').toContain('chrome.storage.local.set({ [PENDING_UPDATE_GAP_KEY]: at })');
    expect(listener, 'and the write is attempted from it').toContain('writePendingUpdateGap()');
    expect(listener, 'and nothing writes the marker straight out of the listener any more')
      .not.toContain('void appendGapMarker({');
  });

  it('the note is cleared only after the marker is on the chain', () => {
    // The ordering is the whole fix. Clearing first, or clearing in a finally,
    // would lose the gap exactly when the write is the thing that failed.
    const body = bodyOf('writePendingUpdateGap');
    const wrote = body.indexOf('await appendGapMarker(');
    const cleared = body.indexOf('chrome.storage.local.remove(PENDING_UPDATE_GAP_KEY)');
    expect(wrote, 'it writes the marker').toBeGreaterThan(-1);
    expect(cleared, 'and clears the note').toBeGreaterThan(-1);
    expect(cleared, 'in that order').toBeGreaterThan(wrote);
  });

  it('a failed write keeps the note rather than dropping it', () => {
    const body = bodyOf('writePendingUpdateGap');
    expect(body, 'the failure is caught').toContain('catch (err)');
    expect(body, 'and says the note is kept').toContain('kept for the next start');
    // No finally: a finally around the clear is the way this quietly reverts.
    expect(body).not.toContain('finally');
  });

  it('every fresh realm tries again, first', () => {
    // Second realms are not a rare case here. On an auto-update the worker that
    // noted the gap is the one most likely to die.
    const src = worker();
    expect(src, 'the realm start calls it').toContain('void writePendingUpdateGap();');
    const startCall = src.indexOf('void writePendingUpdateGap();');
    const chainCheck = src.indexOf('void checkChainHeightOnRealmStart()');
    expect(chainCheck, 'the chain-height check is still there').toBeGreaterThan(-1);
    expect(startCall, 'and the gap is stated before anything else writes to the chain')
      .toBeLessThan(chainCheck);
  });

  it('the perf-trace connection is let go when it stops being usable', () => {
    // Filed beside this one and closed with it: a cached IndexedDB handle that
    // was never invalidated. A failed open was remembered as a failure for the
    // life of the realm, and a connection nobody lets go of BLOCKS a delete,
    // which is what resetForensicChain does to this store by name. Same shape
    // as M289 one file over: a handle nobody was using standing in the way.
    const src = readFileSync(join(REPO_ROOT, 'src/diagnostics/perf-trace.ts'), 'utf8');
    expect(src, 'a closed connection is forgotten').toContain('db.onclose = forget;');
    expect(src, 'and another realm asking to delete is let through').toContain('db.onversionchange');
    expect(src, 'and a failed open is not remembered as a failure for ever')
      .toContain('if (_dbPromise === opening) _dbPromise = null;');
  });

  it('the time in the marker is the time of the update, not of the write', () => {
    // A marker written an hour later saying "an hour later" would put the loss
    // in the wrong place in a record whose whole value is the order of events.
    const body = bodyOf('writePendingUpdateGap');
    expect(body, 'the noted time is read back').toContain('typeof at !== \'string\'');
    expect(body, 'and used for both ends of the window').toContain('fromISO: at, toISO: at');
    expect(body, 'nothing recomputes it here').not.toContain('new Date().toISOString()');
  });
});
