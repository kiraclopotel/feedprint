// Q78 + Q83 + Q85 (wiring W69): background-sw smalls.
//
// Q78: the global download-UI toggle heals at SW module scope on every
// worker start (an eviction inside downloadQuietly's window used to leave
// the whole profile's download UI off until browser restart).
// Q83: GET_CHAIN_DEBUG_STATS consults lastRecordReadFailed instead of
// answering "0 records, chain healthy" for an unopenable store.
// Q85: a forensic delivery message with a falsy payload gets an explicit
// error reply instead of silence (three content-side retries per loss).

import { describe, expect, it, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { restoreDownloadUiOnStartup } from '../../../src/forensics/backup';

const SERVICE_WORKER_PATH = 'src/background/service-worker.ts';
const sw = readFileSync(join(process.cwd(), SERVICE_WORKER_PATH), 'utf8');

afterEach(() => {
  delete (globalThis as any).chrome;
});

describe('Q78 — download-UI respawn net', () => {
  it('re-enables the UI when the API exists', async () => {
    const setUiOptions = vi.fn(async () => undefined);
    (globalThis as any).chrome = { downloads: { setUiOptions } };
    await restoreDownloadUiOnStartup();
    expect(setUiOptions).toHaveBeenCalledWith({ enabled: true });
  });

  it('never throws without the API or without chrome', async () => {
    await expect(restoreDownloadUiOnStartup()).resolves.toBeUndefined();
    (globalThis as any).chrome = { downloads: {} };
    await expect(restoreDownloadUiOnStartup()).resolves.toBeUndefined();
  });

  it('runs at SW module scope beside the pump kick (source-lock)', () => {
    expect(sw).toContain('void restoreDownloadUiOnStartup();');
  });
});

describe('Q83 — no green zero on an unreadable store (source-lock)', () => {
  it('the debug-stats branch consults lastRecordReadFailed before answering', () => {
    const block = sw.match(/if \(message\.type === 'GET_CHAIN_DEBUG_STATS'\) \{[\s\S]{0,900}/)?.[0] ?? '';
    expect(block).toContain('if (lastRecordReadFailed()) {');
    expect(block).toContain("error: 'record store unreadable'");
    const failCheckAt = block.indexOf('lastRecordReadFailed()');
    const okAnswerAt = block.indexOf('buildChainDebugStatsResponse(records)');
    expect(failCheckAt).toBeGreaterThan(-1);
    expect(failCheckAt).toBeLessThan(okAnswerAt);
  });
});

describe('Q85 — falsy delivery payload gets an explicit reply (source-lock)', () => {
  it('the guard answers before the payload-bearing branch', () => {
    const errAt = sw.indexOf("error: 'missing forensic delivery payload'");
    const okBranchAt = sw.indexOf('FORENSIC_DELIVERY_TYPES.has(message.type as ForensicDeliveryType) && message.payload');
    expect(errAt).toBeGreaterThan(-1);
    expect(errAt).toBeLessThan(okBranchAt);
  });
});
