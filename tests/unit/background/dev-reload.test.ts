// Dev-only self-reload decision logic (src/background/dev-reload.ts).
//
// The reload decision must be pure and conservative: only a real mismatch
// between two KNOWN build ids WITH a matching secret may restart the extension.
// Every degraded input (missing server, junk payload, unbaked bundle, mismatched secret)
// must mean "do nothing" — a failed read restarting the extension would be a
// self-inflicted protection drop.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { repoPath } from '../../helpers/repo-root';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { shouldReloadForBuildId, parseServerBuildId, parseServerSecret } from '../../../src/background/dev-reload';

describe('shouldReloadForBuildId — conservative mismatch-only decision', () => {
  it('reloads on a real mismatch between two known ids with matching secret', () => {
    expect(shouldReloadForBuildId('fwbid-aaa-111', 'fwbid-bbb-222', 'fwsec-xxx', 'fwsec-xxx')).toBe(true);
  });

  it('does not reload when the ids match (post-reload steady state — no loop)', () => {
    expect(shouldReloadForBuildId('fwbid-aaa-111', 'fwbid-aaa-111', 'fwsec-xxx', 'fwsec-xxx')).toBe(false);
  });

  it('does not reload when the bundle carries no baked id (vitest/node realm)', () => {
    expect(shouldReloadForBuildId('', 'fwbid-bbb-222', 'fwsec-xxx', 'fwsec-xxx')).toBe(false);
  });

  it('does not reload when the server id is empty (failed or junk read)', () => {
    expect(shouldReloadForBuildId('fwbid-aaa-111', '', 'fwsec-xxx', 'fwsec-xxx')).toBe(false);
  });

  it('does not reload when the baked secret is empty (vitest/node realm)', () => {
    expect(shouldReloadForBuildId('fwbid-aaa-111', 'fwbid-bbb-222', '', 'fwsec-xxx')).toBe(false);
  });

  it('does not reload when the server secret is empty (failed or junk read)', () => {
    expect(shouldReloadForBuildId('fwbid-aaa-111', 'fwbid-bbb-222', 'fwsec-xxx', '')).toBe(false);
  });

  it('does not reload when the secrets do not match (unauthenticated server)', () => {
    expect(shouldReloadForBuildId('fwbid-aaa-111', 'fwbid-bbb-222', 'fwsec-xxx', 'fwsec-yyy')).toBe(false);
  });
});

describe('parseServerBuildId — junk-tolerant payload parsing', () => {
  it('extracts a well-formed buildId', () => {
    expect(parseServerBuildId({ buildId: 'fwbid-aaa-111' })).toBe('fwbid-aaa-111');
  });

  it('trims whitespace', () => {
    expect(parseServerBuildId({ buildId: '  fwbid-aaa-111\n' })).toBe('fwbid-aaa-111');
  });

  it.each([
    [null], [undefined], ['a string'], [42], [{}], [{ buildId: 7 }], [{ buildId: null }], [[]],
  ])('returns empty for junk payload %#', (payload) => {
    expect(parseServerBuildId(payload)).toBe('');
  });
});

describe('parseServerSecret — junk-tolerant payload parsing', () => {
  it('extracts a well-formed secret', () => {
    expect(parseServerSecret({ secret: 'fwsec-abc123' })).toBe('fwsec-abc123');
  });

  it('trims whitespace', () => {
    expect(parseServerSecret({ secret: '  fwsec-abc123\n' })).toBe('fwsec-abc123');
  });

  it.each([
    [null], [undefined], ['a string'], [42], [{}], [{ secret: 7 }], [{ secret: null }], [[]],
  ])('returns empty for junk payload %#', (payload) => {
    expect(parseServerSecret(payload)).toBe('');
  });
});

// scripts/dev/dev-reload-server.mjs — CORS must never send a partial
// wildcard (ACAO does not support one). The exact chrome-extension:// origin
// is echoed back only when the request is FROM a chrome-extension:// origin;
// any other origin gets no Access-Control-Allow-Origin header at all.
describe('dev-reload-server CORS — exact-origin echo, no partial wildcard', () => {
  const PORT = 18790;
  const SERVER_SCRIPT = repoPath('scripts', 'dev', 'dev-reload-server.mjs');
  let child: ChildProcess;
  let distDir: string;

  beforeAll(async () => {
    distDir = mkdtempSync(join(tmpdir(), 'fw-dev-reload-'));
    child = spawn(process.execPath, [SERVER_SCRIPT, '--port', String(PORT), '--dist', distDir], {
      stdio: 'ignore',
    });

    const deadline = Date.now() + 5000;
    for (;;) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/health`);
        if (res.ok) return;
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) throw new Error('dev-reload-server did not become ready in time');
      await new Promise((r) => setTimeout(r, 50));
    }
  });

  afterAll(() => {
    child.kill();
    rmSync(distDir, { recursive: true, force: true });
  });

  it('echoes back the exact chrome-extension:// origin, with Vary: Origin', async () => {
    const origin = 'chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef';
    const res = await fetch(`http://127.0.0.1:${PORT}/health`, { headers: { Origin: origin } });
    expect(res.headers.get('access-control-allow-origin')).toBe(origin);
    expect(res.headers.get('vary')).toBe('Origin');
  });

  it('sends no Access-Control-Allow-Origin header for a non-extension origin', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/health`, {
      headers: { Origin: 'https://evil.example.com' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

// Where the dev-reload alarm is handled, and why it is not a listener
// (2026-09-19).
//
// chrome.alarms.onAlarm.addListener used to sit inside the callback to
// chrome.management.getSelf, so it was registered after an async round trip.
// Under MV3 a listener added after an await is not reliably present when the
// worker's realm is torn down and rebuilt, and the alarm that drives this could
// then arrive at a worker that had not re-registered for it.
//
// The first fix registered it synchronously in initDevReload, and that was
// wrong too: service-worker.ts has exactly one onAlarm listener on purpose and
// a test asserts the count, so a second listener traded one defect for another.
// It is a case inside that one dispatcher now, which is registered at module
// level, and the development check lives in the handler where a late answer
// belongs.
//
// Only unpacked development installs can reach any of it. It is worth a test
// because a reload path that fails silently looks like a build that did not
// take.
describe('the dev-reload alarm is handled, not listened for', () => {
  it('does nothing until getSelf has confirmed a development install', async () => {
    const { handleDevReloadAlarm, initDevReload } = await import('../../../src/background/dev-reload');
    let reloads = 0;
    let created = 0;
    // A getSelf that never answers: the worst case this is about.
    (globalThis as unknown as { chrome: unknown }).chrome = {
      alarms: { onAlarm: { addListener: () => { throw new Error('dev-reload must not add a listener'); } },
        create: () => { created += 1; } },
      management: { getSelf: () => {} },
      runtime: { lastError: undefined, reload: () => { reloads += 1; } },
    };

    // Must not throw: it must not be adding a listener of its own.
    initDevReload();
    expect(created, 'and no alarm created before the answer').toBe(0);

    handleDevReloadAlarm('fw-dev-reload-check');
    expect(reloads, 'an alarm before the answer does nothing').toBe(0);

    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  it('ignores every alarm that is not its own', async () => {
    const { handleDevReloadAlarm } = await import('../../../src/background/dev-reload');
    let reloads = 0;
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: { lastError: undefined, reload: () => { reloads += 1; } },
    };
    for (const name of ['scan-purge', 'forensic-prune', 'forensic-month-rotation', '']) {
      handleDevReloadAlarm(name);
    }
    expect(reloads).toBe(0);
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });
});
