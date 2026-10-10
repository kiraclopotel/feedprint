// @vitest-environment jsdom
//
// Locks the 2026-08-24 defect: content scripts on x.com / facebook.com /
// instagram.com / tiktok.com / youtube.com logged
//   "[FW perf-trace] persist failed RealmGuardError: [FeelingWise] Refused
//    to open IndexedDB "feelingwise-pipeline-v2-metrics" outside the
//    extension origin"
// The v2 perf-trace persist path (src/diagnostics/perf-trace.ts stage()/recordSpan)
// runs in the content-script realm, which shares the host page's origin —
// not the extension origin. It used to open the metrics store directly
// (persistRecord -> openDb -> openSimpleStore -> assertExtensionRealm),
// which the realm guard correctly refuses there. The fix
// (`dispatchPersist`) sends the record to the service worker by message
// instead of ever calling `indexedDB.open` from this realm; the service
// worker's CAPTURE_PERF_RECORD handler performs the actual write at the
// extension origin (covered separately in tests/unit/forensics/service-worker.test.ts).
//
// This suite proves, from a simulated page-origin realm:
//   - flag OFF: no IndexedDB open, no message sent, nothing logged — no
//     persist attempt happens at all.
//   - flag ON: no IndexedDB open (the realm-guard trip is gone), and the
//     record is dispatched to the service worker by message instead.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { _resetRealmGuardForTests, lastRealmRefusal } from '../../../src/storage/realm-guard';
import { __resetFeatureFlagsCacheForTests } from '../../../src/storage/feature-flags';
import { startTrace, recordSpan } from '../../../src/diagnostics/perf-trace';

type SendMessageMock = ReturnType<typeof vi.fn<(message: unknown) => Promise<unknown>>>;

interface ChromeStub {
  storage: {
    local: {
      get: (keys: string[] | string | object) => Promise<Record<string, unknown>>;
      set: (data: Record<string, unknown>) => Promise<void>;
    };
  };
  runtime: {
    sendMessage: SendMessageMock;
  };
}

function installChromeStub(flags: Record<string, unknown>, sendMessage: SendMessageMock): void {
  const data: Record<string, unknown> = { ...flags };
  const stub: ChromeStub = {
    storage: {
      local: {
        get: async (keys) => {
          if (Array.isArray(keys)) {
            const out: Record<string, unknown> = {};
            for (const k of keys) if (k in data) out[k] = data[k];
            return out;
          }
          return data;
        },
        set: async (next) => { Object.assign(data, next); },
      },
    },
    runtime: { sendMessage },
  };
  (globalThis as unknown as { chrome: ChromeStub }).chrome = stub;
}

describe('perf-trace — content-realm persist routing (no direct IndexedDB open)', () => {
  const originalLocation = window.location;
  let openSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetFeatureFlagsCacheForTests();
    _resetRealmGuardForTests();
    (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    // Simulate a content script on x.com — a page origin, not the
    // extension origin. Mirrors tests/unit/storage/store-openers-realm-guard.test.ts.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: 'https://x.com/', protocol: 'https:', host: 'x.com', origin: 'https://x.com' },
    });
    openSpy = vi.spyOn(indexedDB, 'open');
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    vi.restoreAllMocks();
    delete (globalThis as Partial<{ chrome: unknown }>).chrome;
  });

  it('flag OFF: stage().end() never opens IndexedDB, never sends a message, never logs "persist failed"', async () => {
    const sendMessage: SendMessageMock = vi.fn(async (_message: unknown) => undefined);
    installChromeStub({ ff_captureV2Metrics: false }, sendMessage);

    const tracer = await startTrace({ platform: 'twitter', mode: 'teen' });
    const end = tracer.stage('combined_call');
    end({ success: true });
    await new Promise((r) => setTimeout(r, 5));

    expect(openSpy).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(lastRealmRefusal()).toBeNull();
    const warnedPersistFailed = warnSpy.mock.calls.some(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('[FW perf-trace] persist failed'),
    );
    expect(warnedPersistFailed).toBe(false);
  });

  it('flag OFF: recordSpan never opens IndexedDB, never sends a message', async () => {
    const sendMessage: SendMessageMock = vi.fn(async (_message: unknown) => undefined);
    installChromeStub({ ff_captureV2Metrics: false }, sendMessage);

    await recordSpan({ platform: 'tiktok', mode: 'teen' }, 'combined_call', 500);
    await new Promise((r) => setTimeout(r, 5));

    expect(openSpy).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(lastRealmRefusal()).toBeNull();
  });

  it('flag ON: stage().end() dispatches to the service worker instead of opening IndexedDB', async () => {
    const sendMessage: SendMessageMock = vi.fn(async (_message: unknown) => undefined);
    installChromeStub({ ff_captureV2Metrics: true }, sendMessage);

    const tracer = await startTrace({ platform: 'twitter', mode: 'teen', provider: 'groq' });
    const end = tracer.stage('combined_call');
    end({ success: true });
    await new Promise((r) => setTimeout(r, 5));

    expect(openSpy).not.toHaveBeenCalled();
    expect(lastRealmRefusal()).toBeNull();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toMatchObject({
      type: 'CAPTURE_PERF_RECORD',
      payload: {
        version: 1,
        stage: 'combined_call',
        platform: 'twitter',
        mode: 'teen',
        provider: 'groq',
        success: true,
      },
    });
    const warnedPersistFailed = warnSpy.mock.calls.some(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('[FW perf-trace] persist failed'),
    );
    expect(warnedPersistFailed).toBe(false);
  });

  it('flag ON: recordSpan dispatches to the service worker instead of opening IndexedDB', async () => {
    const sendMessage: SendMessageMock = vi.fn(async (_message: unknown) => undefined);
    installChromeStub({ ff_captureV2Metrics: true }, sendMessage);

    await recordSpan(
      { platform: 'tiktok', mode: 'teen' },
      'combined_call',
      500,
      { provider: 'groq', success: true },
    );
    await new Promise((r) => setTimeout(r, 5));

    expect(openSpy).not.toHaveBeenCalled();
    expect(lastRealmRefusal()).toBeNull();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toMatchObject({
      type: 'CAPTURE_PERF_RECORD',
      payload: { stage: 'combined_call', ms: 500, provider: 'groq', success: true },
    });
  });
});
