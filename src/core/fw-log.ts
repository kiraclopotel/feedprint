// FeelingWise — log gate for the content script and the code it runs (the reading, the AI client). In core since
// 10 Oct 2026, so the AI client below content can use it; src/content/fw-log.ts re-exports it.
//
// Production console.log volume on heavy platforms (X reconciler ticks
// every few hundred ms, TikTok bundle scans every 3s, IG comment-pipeline
// re-runs per scroll) drowns operational signals in noise. `fwDebug`
// gates the per-event chatter behind a single `globalThis.__FW_DEBUG__`
// boolean. Unset = production silent. A content script runs in its own world, apart from the page's (Chrome's
// isolated worlds), so the switch is set in the extension's context, not the page's: in DevTools, open the console's
// context menu (it reads "top"), pick the extension (Feedprint or Off), then type
//
//   __FW_DEBUG__ = true;   // enable
//   __FW_DEBUG__ = false;  // disable
//
// Typed in "top", it sets the page's own window, which the extension never reads.
//
// What stays in production console:
//   • init logs (`[FeelingWise] active on X`, video pipeline init)
//   • operational warnings + errors (rate-limit, auth-revoked, dom-gone,
//     forensic chain breaks, settings migration failures)
//   • parent-visible interventions stamped once per post (`Neutralized
//     post N`, `Hid post N`)
//
// What's gated to `fwDebug`:
//   • per-event tracing (`[FW comment-batch] flushing N`,
//     `[FW onPostDetected] X post Y text-len`, batch-verdict per-comment)
//   • per-tick adapter survey output (`[FW tiktok-adapter] mutated=...`)
//   • gate-drop bookkeeping (`viewport-gate dropped bucket`)
//
// Tests run the same gate path (jsdom global is untouched), so `fwDebug`
// in unit tests is silent by default. Tests asserting on console output
// either set the flag explicitly or call the underlying console.log.

declare global {
  interface Window {
    __FW_DEBUG__?: boolean;
  }
  var __FW_DEBUG__: boolean | undefined;
}

function isDebugEnabled(): boolean {
  if (typeof globalThis === 'undefined') return false;
  const g = globalThis as typeof globalThis & { __FW_DEBUG__?: boolean };
  return g.__FW_DEBUG__ === true;
}

export function fwDebug(...args: unknown[]): void {
  if (!isDebugEnabled()) return;
  console.log(...args);
}

export function fwDebugDebug(...args: unknown[]): void {
  if (!isDebugEnabled()) return;
  console.debug(...args);
}

export {};
