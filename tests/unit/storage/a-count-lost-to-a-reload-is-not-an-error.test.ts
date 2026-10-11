// @vitest-environment jsdom
//
// After the extension reloads under an open tab, the tab's counts cannot reach the service worker. That loss is by
// design and the context guard already says once, as an info line, to refresh the tab. A warning on top of it lands in
// chrome://extensions as an Error the person can do nothing about. A count lost for any other reason is still a fault
// and still warns once.

import { beforeEach, describe, expect, it, vi } from 'vitest';

function installChrome(sendMessage: (message: unknown) => Promise<unknown>, { orphaned = false } = {}) {
  const storage = {
    local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) },
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  };
  // An orphan keeps a runtime without its id and loses storage altogether.
  (globalThis as unknown as { chrome: unknown }).chrome = orphaned
    ? { runtime: { sendMessage: vi.fn(sendMessage) } }
    : { storage, runtime: { id: 'fw-test', sendMessage: vi.fn(sendMessage) } };
}

const usageWarnings = (warn: ReturnType<typeof vi.spyOn>) =>
  warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes('usage increment'));

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('a count lost to an extension reload is not an error', () => {
  it('the reload\'s rejection gives one info line from the guard and no warning, now or on the next count', async () => {
    installChrome(async () => { throw new Error('Extension context invalidated.'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { incrementMetricsHidden } = await import('../../../src/storage/settings');

    await incrementMetricsHidden(1);
    await incrementMetricsHidden(1);

    expect(usageWarnings(warn)).toEqual([]);
    expect(info.mock.calls.filter((c) => String(c[0]).includes('refresh this tab'))).toHaveLength(1);
  });

  it('an orphaned script, whose runtime has lost its id, sends nothing and warns nothing', async () => {
    let sent = 0;
    installChrome(async () => { sent += 1; return { ok: true }; }, { orphaned: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { incrementMetricsHidden } = await import('../../../src/storage/settings');

    await incrementMetricsHidden(1);

    expect(sent).toBe(0);
    expect(usageWarnings(warn)).toEqual([]);
  });

  it('a count lost for a real reason still warns, once', async () => {
    installChrome(async () => { throw new Error('Could not establish connection. Receiving end does not exist.'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { incrementMetricsHidden } = await import('../../../src/storage/settings');

    await incrementMetricsHidden(1);
    await incrementMetricsHidden(1);

    const lost = usageWarnings(warn);
    expect(lost).toHaveLength(1);
    expect(String(lost[0][0])).toContain('Receiving end does not exist');
  });
});
