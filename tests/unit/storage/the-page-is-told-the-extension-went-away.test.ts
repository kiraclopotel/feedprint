/** @vitest-environment jsdom */
// M68. Until this hook existed, the only thing that happened when the extension
// went away under an open tab was one console.info line. Nobody the product is
// for reads a console, so a Child sat under covers saying "FeelingWise is
// checking this content" that could never resolve, and nothing on the page said
// otherwise.
//
// The module keeps one-way module state, so each case gets a fresh copy via
// vi.resetModules and a dynamic import. Sharing one import between them would
// make the second case depend on whether the first had already killed the
// context, which is exactly the class of test that passes alone and fails in a
// full run.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Guard = typeof import('../../../src/storage/context-guard');

async function freshGuard(): Promise<Guard> {
  vi.resetModules();
  return import('../../../src/storage/context-guard');
}

let info: ReturnType<typeof vi.spyOn>;
beforeEach(() => { info = vi.spyOn(console, 'info').mockImplementation(() => {}); });
afterEach(() => { info.mockRestore(); });

describe('when the extension goes away under an open tab', () => {
  it('tells whoever asked to be told', async () => {
    const guard = await freshGuard();
    const told: string[] = [];
    guard.onContextInvalidated(() => told.push('page'));

    expect(told).toEqual([]);
    guard.markContextInvalidated();

    expect(told).toEqual(['page']);
  });

  it('tells every listener, not just the first', async () => {
    const guard = await freshGuard();
    const told: string[] = [];
    guard.onContextInvalidated(() => told.push('covers'));
    guard.onContextInvalidated(() => told.push('markers'));

    guard.markContextInvalidated();

    expect(told).toEqual(['covers', 'markers']);
  });

  it('runs a listener that arrives too late, rather than never running it', async () => {
    // Registration order must not decide whether a page is told. A module that
    // loads after the context has already died is the normal case on a tab that
    // has been open a while, and it is the case that most needs telling.
    const guard = await freshGuard();
    guard.markContextInvalidated();

    let told = false;
    guard.onContextInvalidated(() => { told = true; });

    expect(told).toBe(true);
  });

  it('lets the others run when one listener throws', async () => {
    // This fires while the extension is already dying. One listener failing
    // must not take the rest of the page down with it, and must not swallow
    // the log line that follows.
    const guard = await freshGuard();
    const told: string[] = [];
    guard.onContextInvalidated(() => { throw new Error('a listener went wrong'); });
    guard.onContextInvalidated(() => told.push('still ran'));

    expect(() => guard.markContextInvalidated()).not.toThrow();
    expect(told).toEqual(['still ran']);
    expect(info).toHaveBeenCalledTimes(1);
  });

  it('tells each listener once, however many times the flag is set', async () => {
    // Every guarded path calls this the first time it sees the error, so on a
    // busy feed it is called many times in a row. A cover repainted on each one
    // would be work for nothing; a counter would be wrong.
    const guard = await freshGuard();
    let count = 0;
    guard.onContextInvalidated(() => { count++; });

    guard.markContextInvalidated();
    guard.markContextInvalidated();
    guard.markContextInvalidated();

    expect(count).toBe(1);
    expect(info).toHaveBeenCalledTimes(1);
  });

  it('still reports the context as dead to everything that polls it', async () => {
    const guard = await freshGuard();
    expect(guard.isContextAlive()).toBe(true);

    guard.markContextInvalidated();

    expect(guard.isContextAlive()).toBe(false);
  });
});
