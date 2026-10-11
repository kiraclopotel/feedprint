// A fake chrome for the tests of the read count (B10-1): storage in memory, and a runtime whose
// USAGE_INCREMENT messages are delivered to the worker side's applier, as the service worker does.
// Every increment a page sends lands in `sent`, so a test can count messages as well as results.
import { vi } from 'vitest';
import { applyUsageIncrement } from '../../src/storage/settings';

export interface FakeCounterChrome {
  state: Record<string, unknown>;
  /** chrome.storage.session: memory only, never the disk. */
  session: Record<string, unknown>;
  sent: Array<{ type: string; payload: unknown }>;
}

export function installCounterChrome(initial: Record<string, unknown> = {}): FakeCounterChrome {
  const fake: FakeCounterChrome = { state: { ...initial }, session: {}, sent: [] };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        // Resolves on a microtask so overlapping callers can interleave.
        get: vi.fn(async () => ({ ...fake.state })),
        set: vi.fn(async (patch: Record<string, unknown>) => { Object.assign(fake.state, patch); }),
        remove: vi.fn(async (keys: string | string[]) => { for (const k of Array.isArray(keys) ? keys : [keys]) delete fake.state[k]; }),
      },
      session: {
        get: vi.fn(async () => ({ ...fake.session })),
        set: vi.fn(async (patch: Record<string, unknown>) => { Object.assign(fake.session, patch); }),
        remove: vi.fn(async (keys: string | string[]) => { for (const k of Array.isArray(keys) ? keys : [keys]) delete fake.session[k]; }),
      },
      onChanged: { addListener: vi.fn() },
    },
    runtime: {
      id: 'fw-test',
      sendMessage: vi.fn(async (message: { type: string; payload: unknown }) => {
        fake.sent.push(message);
        if (message.type !== 'USAGE_INCREMENT') return undefined;
        try {
          await applyUsageIncrement(message.payload as Parameters<typeof applyUsageIncrement>[0]);
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }),
    },
  };
  return fake;
}

/** Every leaf under `value`, so a test can say "only numbers and the date are stored". */
export function leaves(value: unknown, path = ''): Array<{ path: string; value: unknown }> {
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => leaves(v, `${path}.${k}`));
  }
  return [{ path, value }];
}
