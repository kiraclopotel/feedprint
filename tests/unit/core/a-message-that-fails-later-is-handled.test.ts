// @vitest-environment jsdom
//
// B7 unit 3, site 5 (S15, the raw sendMessage part): places that sent a message to the background realm with a bare
// `void chrome.runtime.sendMessage(...)`. A try/catch around that call catches only a throw on the spot. When the background is
// asleep or the page's link to the extension is gone, the call does not throw: it returns a promise that rejects later, and
// nobody was listening, so the rejection surfaced as an unhandled one in the extension's error list (diagnostics/perf-trace.ts,
// the timing record; ui/dashboard/Dashboard.tsx, the "open original" click). Both now go through safeSendMessage
// (storage/context-guard.ts), which attaches the handler and, for a dead context, stops further sends. This test drives the
// perf record for real with a send that fails later, and pins the dashboard click's source (the screen is too heavy to render
// for one line). The third place, the prompt capture in core/neutralizer.ts, is a frozen judge file and waits for the owner's
// word (its diff and its test case are kept in run/maker/evidence/B7u3s5-*).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSource } from '../../helpers/read-source';

vi.mock('../../../src/storage/feature-flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/storage/feature-flags')>();
  return { ...actual, isFeatureEnabled: vi.fn(async () => true) };
});

import { recordSpan } from '../../../src/diagnostics/perf-trace';

/**
 * A send that fails later. It is a thenable that records whether anything ever attached a rejection handler: a bare
 * `void send()` attaches none, so the failure would be unhandled; safeSendMessage attaches one with .catch.
 */
function sendThatFailsLater(): { send: ReturnType<typeof vi.fn>; handled: () => boolean } {
  let handled = false;
  const failing = {
    then(_ok?: unknown, onRejected?: unknown) { if (onRejected) handled = true; return failing; },
    catch(onRejected?: unknown) { if (onRejected) handled = true; return failing; },
  };
  return { send: vi.fn(() => failing), handled: () => handled };
}

function installChrome(sendMessage: unknown): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { sendMessage, id: 'test' },
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) } },
  };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  // A content script on a page origin: the perf record is routed to the background by message there.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href: 'https://x.com/', protocol: 'https:', host: 'x.com', origin: 'https://x.com' },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as Partial<{ chrome: unknown }>).chrome;
});

describe('B7u3 site 5: a message that fails later is handled, never left unhandled', () => {
  it('the perf record: its send gets a rejection handler', async () => {
    const { send, handled } = sendThatFailsLater();
    installChrome(send);

    await recordSpan({ platform: 'tiktok', mode: 'teen' }, 'combined_call', 500);
    await new Promise((r) => setTimeout(r, 5));

    expect(send, 'the record was sent').toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ type: 'CAPTURE_PERF_RECORD' });
    expect(handled(), 'a later failure of the send is handled').toBe(true);
  });

  it('control: a send that throws on the spot still never breaks the caller', async () => {
    installChrome(() => { throw new Error('receiver went away'); });
    await expect(recordSpan({ platform: 'tiktok', mode: 'teen' }, 'combined_call', 500)).resolves.toBeUndefined();
  });

  it('the dashboard "open original" click sends through safeSendMessage, not a bare sendMessage', () => {
    const source = readSource('src/ui/dashboard/Dashboard.tsx', { minBytes: 5000 });
    expect(source).toMatch(/safeSendMessage\(\{ type: 'OPEN_ORIGINAL'/);
    expect(source).not.toMatch(/void chrome\.runtime\.sendMessage\(\{ type: 'OPEN_ORIGINAL'/);
  });
});
