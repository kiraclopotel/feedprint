// FeelingWise — durable bookkeeping for recheck tabs (register M91).
//
// recheckRecord() opens a background tab and closes it in a `finally` — but
// an MV3 service worker can be hard-killed between tabs.create and that
// finally, leaking an invisible background tab loaded with a social URL and
// nothing to reconcile it on the next wake. This ledger closes that hole:
//
//   • rememberRecheckTab(tabId, deadline) — written IMMEDIATELY after
//     tabs.create, before any waiting, so the tab is never untracked.
//   • forgetRecheckTab(tabId) — the happy path's finally.
//   • sweepOrphanRecheckTabs() — run once at service-worker startup. At
//     startup no recheck is in flight in THIS worker instance, so every
//     stored entry belongs to a dead instance: expired entries are closed
//     immediately; not-yet-expired entries get a timer for their deadline
//     (if this worker also dies, the NEXT startup sweep catches them).
//
// chrome.storage.session is deliberate: it survives worker restarts but
// clears on browser restart — exactly a tab's own lifetime, so the ledger
// can never accumulate stale entries across browser sessions.

const LEDGER_KEY = 'fw_recheck_tabs';

type Ledger = Record<string, number>; // tabId (as string key) → deadline epoch ms

// Q81 (W70): every read-modify-write on the ledger runs through one
// promise chain (same discipline as inspection-registry.ts). Without it
// the module-scope sweep's final write could overwrite a concurrently
// registered tab, orphaning an invisible background tab on a social URL
// that no later sweep would ever reconcile.
let ledgerChain: Promise<unknown> = Promise.resolve();

function serialized<T>(op: () => Promise<T>): Promise<T> {
  const run = ledgerChain.then(op, op);
  ledgerChain = run.then(() => undefined, () => undefined);
  return run;
}

async function readLedger(): Promise<Ledger> {
  const out = await chrome.storage.session.get(LEDGER_KEY);
  const raw = out[LEDGER_KEY];
  return raw && typeof raw === 'object' ? (raw as Ledger) : {};
}

async function writeLedger(ledger: Ledger): Promise<void> {
  await chrome.storage.session.set({ [LEDGER_KEY]: ledger });
}

/** Track an open recheck tab. Call immediately after tabs.create resolves. */
export function rememberRecheckTab(tabId: number, deadlineMs: number): Promise<void> {
  return serialized(async () => {
    const ledger = await readLedger();
    ledger[String(tabId)] = deadlineMs;
    await writeLedger(ledger);
  });
}

/** Untrack a recheck tab the happy path closed itself. */
export function forgetRecheckTab(tabId: number): Promise<void> {
  return serialized(async () => {
    const ledger = await readLedger();
    if (String(tabId) in ledger) {
      delete ledger[String(tabId)];
      await writeLedger(ledger);
    }
  });
}

/**
 * Close orphaned recheck tabs left by a dead worker instance. Entries past
 * their deadline are closed now; live-window entries get a timer for their
 * remaining time plus a small grace (the prior instance's tabs.remove would
 * have fired by the deadline — if the entry still exists then, it is an
 * orphan). Returns what was done so callers/tests can assert.
 */
export function sweepOrphanRecheckTabs(
  now: number = Date.now(),
  schedule: (fn: () => void, ms: number) => void = (fn, ms) => { setTimeout(fn, ms); },
): Promise<{ closedNow: number[]; scheduled: number[] }> {
  return serialized(async () => {
    const ledger = await readLedger();
    const closedNow: number[] = [];
    const scheduled: number[] = [];
    const GRACE_MS = 5_000;

    for (const [key, deadline] of Object.entries(ledger)) {
      const tabId = Number(key);
      if (!Number.isFinite(tabId)) {
        delete ledger[key];
        continue;
      }
      if (deadline <= now) {
        try { await chrome.tabs.remove(tabId); } catch { /* tab already gone */ }
        delete ledger[key];
        closedNow.push(tabId);
      } else {
        scheduled.push(tabId);
        schedule(() => {
          // Q81 (W70): the deferred close is a read-modify-write too; it
          // joins the same chain so it cannot race a concurrent register.
          void serialized(async () => {
            // Re-read: the happy path may have forgotten the entry meanwhile.
            const current = await readLedger();
            if (!(key in current)) return;
            try { await chrome.tabs.remove(tabId); } catch { /* tab already gone */ }
            delete current[key];
            await writeLedger(current);
          });
        }, deadline - now + GRACE_MS);
      }
    }
    await writeLedger(ledger);
    return { closedNow, scheduled };
  });
}
