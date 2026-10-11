// FeelingWise - Extension context guard
// Detects MV3 service worker death and stops all future chrome.runtime calls.
// Once the service worker dies, chrome.runtime.sendMessage() throws
// "Extension context invalidated" on every call. This module detects that
// and flips a flag so all subsequent calls become no-ops.

let contextValid = true;

const CONTEXT_INVALIDATED = 'Extension context invalidated';

// Throttle the per-error-signature warning emitted below. SW flap / network
// hiccups can produce many identical errors in a short window — without
// dedup the console floods. Window is per error signature (message type +
// error string); first occurrence logs, then a single trailing
// "[FW] X further suppressed in last Ns" if more arrive before reset.
const WARN_THROTTLE_WINDOW_MS = 5_000;
const warnThrottleState = new Map<string, { firstAt: number; count: number }>();

/** The TypeError a read through a vanished chrome.storage throws: "(reading 'local')" and its kin. */
const STORAGE_READ = /\(reading '(?:local|sync|session|managed|storage|onChanged)'\)/;

/** True when this script's chrome.storage is gone (the extension was reloaded under it). */
function storageGone(): boolean {
  try {
    return typeof chrome === 'undefined' || !chrome.storage?.local;
  } catch {
    return true;
  }
}

export function isContextError(err: unknown): boolean {
  if (err instanceof Error) {
    if (err.message.includes(CONTEXT_INVALIDATED)) return true;
    // After an unpacked reload the orphaned script's chrome.storage is
    // undefined, so a read throws "Cannot read properties of undefined
    // (reading 'local')", a TypeError without the message above (owner's
    // screen, Off 1.0.13 on YouTube, 2026-10-08 20:0x).
    // Only that read: any other TypeError stays a real error, storage or not.
    return err instanceof TypeError && STORAGE_READ.test(err.message) && storageGone();
  }
  return String(err).includes(CONTEXT_INVALIDATED);
}

/**
 * True when the extension this script belongs to is gone: Chrome leaves a content script whose extension was reloaded
 * under it a runtime without its id and no storage at all. Both are required, because a page with only part of the
 * extension's API (a test's stand-in, a page with no chrome at all) is not an orphan and must keep working.
 */
function orphaned(): boolean {
  try {
    if (typeof chrome === 'undefined' || chrome === null || !chrome.runtime) return false;
    return !chrome.runtime.id && !chrome.storage;
  } catch {
    return true;
  }
}

export function isContextAlive(): boolean {
  // The flag alone missed an orphan whose first act was a storage read: its starts threw "reading 'onChanged'" in a
  // loop instead of going quiet after one line.
  if (contextValid && orphaned()) markContextInvalidated();
  return contextValid;
}

/**
 * Mark the context dead from a NON-messaging path — e.g. a `chrome.storage`
 * read that threw "Extension context invalidated" (getLicense / getSettings
 * read storage directly, bypassing safeSendMessage). Flips the shared flag so
 * every guarded path (messaging AND storage) goes dormant after the FIRST
 * detection, and logs the graceful-shutdown line ONCE — without this an
 * orphaned content script's read loop floods the console with hundreds of
 * identical warnings (found 2026-06-20). Idempotent + silent after the first call.
 */
let invalidationLogged = false;

/**
 * Run once when the extension goes away under an open tab.
 *
 * The console line below is the only thing this module used to do about it, and
 * a console line is read by nobody the product is for (M68, live evidence
 * 2026-07-13: a Child-mode tab that survived an extension reload sat under
 * covers saying "FeelingWise is checking this content" that could never
 * resolve). A listener lets the page-side layer say what happened where a
 * person is actually looking.
 *
 * Listeners run inside a try/catch each: this fires while the extension is
 * already dying, and one listener throwing must not stop the others or the
 * log line. They are cleared after firing, because the flag is one-way and a
 * retained listener would only keep a dead page alive in memory.
 */
const invalidationListeners = new Set<() => void>();
export function onContextInvalidated(listener: () => void): void {
  if (!contextValid) {
    // Already gone. Run it now rather than never, so registration order
    // cannot decide whether a page gets told.
    try { listener(); } catch { /* see above */ }
    return;
  }
  invalidationListeners.add(listener);
}

export function markContextInvalidated(): void {
  contextValid = false;
  if (invalidationLogged) return;
  invalidationLogged = true;
  for (const listener of invalidationListeners) {
    try {
      listener();
    } catch {
      // A listener that throws while the extension is dying must not take the
      // others, or the log line, with it.
    }
  }
  invalidationListeners.clear();
  console.info(
    '[FeelingWise] Extension was reloaded — refresh this tab to resume. (Expected after extension reload / reinstall.)',
  );
}

/**
 * Wrapper around chrome.runtime.sendMessage that detects context death
 * and stops all future calls. Fire-and-forget: returns undefined if
 * context is dead.
 */
export function safeSendMessage(message: unknown): Promise<unknown> | undefined {
  if (!contextValid) return undefined;

  // extension reload nukes `chrome.runtime` synchronously in the
  // orphaned content script. Accessing `.sendMessage` on undefined throws
  // before the promise chain attaches → uncaught TypeError surfaced in
  // queue.ts as "Cannot read properties of undefined (reading 'sendMessage')".
  // Guard the access; if the runtime is gone, mark context dead and bail.
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
    markContextInvalidated();
    return undefined;
  }

  try {
    return chrome.runtime.sendMessage(message as any).catch((err: unknown) => {
      if (isContextError(err)) {
        markContextInvalidated();
        console.warn('[FeelingWise] Extension context invalidated — stopping all messaging');
        return;
      }
      // Non-context errors used to be silently swallowed, masking
      // chain-write failures (SW handler threw, IDB rejected, etc.).
      // Surface them as warnings so the parent or a developer can see
      // chain-write problems in the console; fire-and-forget contract is
      // preserved (callers still don't await for chain writes). Throttled per
      // error signature so SW flap doesn't flood the console.
      const msgType =
        typeof message === 'object' && message !== null && 'type' in (message as Record<string, unknown>)
          ? String((message as Record<string, unknown>).type)
          : 'unknown';
      const errKey = `${msgType}::${err instanceof Error ? err.message : String(err)}`;
      const now = Date.now();
      const existing = warnThrottleState.get(errKey);
      if (!existing || now - existing.firstAt > WARN_THROTTLE_WINDOW_MS) {
        if (existing && existing.count > 1) {
          console.warn(
            `[FeelingWise] safeSendMessage failed for ${msgType} ` +
            `(+${existing.count - 1} suppressed in last ${WARN_THROTTLE_WINDOW_MS / 1000}s):`,
            err,
          );
        } else {
          console.warn(`[FeelingWise] safeSendMessage failed for ${msgType}:`, err);
        }
        warnThrottleState.set(errKey, { firstAt: now, count: 1 });
      } else {
        existing.count++;
      }
    });
  } catch (err) {
    // sendMessage can throw synchronously (not just reject) when the runtime
    // is half-dead. Treat the same as the async failure path.
    if (isContextError(err)) {
      markContextInvalidated();
    }
    return undefined;
  }
}

/**
 * Called by the processing queue to report errors.
 * Returns true if the queue should stop (context is dead).
 */
let consecutiveContextErrors = 0;
const CONTEXT_ERROR_THRESHOLD = 3;

export function reportProcessingError(err: unknown): boolean {
  if (isContextError(err)) {
    consecutiveContextErrors++;
    if (consecutiveContextErrors >= CONTEXT_ERROR_THRESHOLD) {
      markContextInvalidated();
      // message rewritten so parents and developers stop wondering
      // what's wrong when this surfaces in chrome://extensions errors.
      // Triggered by extension reload / uninstall+reinstall while a tab is
      // still open: the orphaned content script keeps running but
      // chrome.runtime.sendMessage starts throwing "Extension context
      // invalidated" on every call. Refreshing the tab re-injects a fresh
      // content script under the new extension instance and resumes
      // normally. This isn't a bug — it's the graceful shutdown.
      console.info(
        '[FeelingWise] Extension was reloaded — refresh this tab to resume scanning. (This is expected after extension reload / reinstall.)',
      );
      return true;
    }
  } else {
    consecutiveContextErrors = 0;
  }
  return false;
}
