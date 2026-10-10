// Chain-write serialization lock factory.
//
// getChainState() reads the largest committed chainPosition from IDB.
// Multiple parallel callers (e.g., the comment-batch flush of 10
// comments) could all read before any of them writes, all stamp the
// same nextPosition, and all addRecord with duplicate positions. The
// chain integrity walker would then trip on duplicates — VISION §1.1
// violation ("Concurrency-safe across all execution contexts. No race
// conditions").
//
// Fix: serialize the getChainState + computeIntegrityHash + addRecord
// sequence. The lock instance lives in logger.ts and serializes all chain
// writes across the log* entrypoints.
//
// Pattern: each call captures the current lock, reassigns the lock to a
// new pending promise BEFORE awaiting the prior one, awaits the prior,
// runs work, releases. FIFO ordering. try/finally on release so a thrown
// work() doesn't deadlock the next caller.

export function createChainWriteLock(): <T>(work: () => Promise<T>) => Promise<T> {
  let lock: Promise<void> = Promise.resolve();
  return async function withChainWriteLock<T>(work: () => Promise<T>): Promise<T> {
    const prior = lock;
    let release!: () => void;
    lock = new Promise<void>((r) => { release = r; });
    try {
      await prior;
      return await work();
    } finally {
      release();
    }
  };
}

/**
 * Per-realm shared singleton. Every chain-write site in the SAME realm
 * (SW realm OR dashboard realm OR content-script realm) imports this
 * symbol and shares one lock instance. Pre-2026-05-24 each module
 * created its own lock via `createChainWriteLock()` — `logger.ts:24`
 * and `manual-flag.ts:29` held two independent instances, so two
 * concurrent dashboard-realm chain writes (e.g. manual-flag racing
 * anchorChainHead) could both call getChainState + stamp duplicate
 * chainPosition. Audit A4-BLOCKER-2 (V1.5 #3). With this singleton, all
 * in-realm chain writes serialize through one queue.
 *
 * Cross-realm coordination (dashboard vs SW) still requires routing
 * dashboard chain writes through SW envelopes — see service-worker.ts
 * MANUAL_FLAG handler. Same-realm singletons cannot synchronize across
 * Chrome MV3's realm boundary by themselves.
 */
export const sharedChainWriteLock = createChainWriteLock();
