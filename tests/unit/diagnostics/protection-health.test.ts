// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PROTECTION_HEALTH_FRESH_MS,
  PROTECTION_SLOW_MS,
  _resetProtectionHealthForTesting,
  aggregateProtectionHealthSnapshots,
  assessProtectionHealth,
  currentProtectionHealthSnapshot,
  readProtectionHealth,
  removeProtectionCover,
  summarizeProtectionIssues,
  syncProtectionCover,
  type ProtectionHealthSnapshot,
} from '../../../src/diagnostics/protection-health';

function snapshot(overrides: Partial<ProtectionHealthSnapshot> = {}): ProtectionHealthSnapshot {
  return {
    version: 1,
    observedAt: 10_000,
    host: 'x.com',
    surfaceSessionId: 'ss-test',
    liveHosts: 1,
    visibleHosts: 1,
    oldestMs: 2_000,
    owners: { post: 1, generic: 1 },
    ownerlessHosts: 0,
    missingOverlayHosts: 0,
    ...overrides,
  };
}

describe('protection health assessment', () => {
  beforeEach(() => {
    _resetProtectionHealthForTesting();
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('distinguishes a normal live check from an overdue cover', () => {
    expect(assessProtectionHealth(snapshot(), 10_000)).toBe('checking');
    expect(assessProtectionHealth(
      snapshot({ oldestMs: PROTECTION_SLOW_MS + 1 }),
      10_000,
    )).toBe('slow');
  });

  it('treats missing overlays as broken ownership', () => {
    expect(assessProtectionHealth(snapshot({ missingOverlayHosts: 1 }), 10_000)).toBe('broken');
  });

  it('does not report old page state as current', () => {
    expect(assessProtectionHealth(
      snapshot(),
      10_000 + PROTECTION_HEALTH_FRESH_MS + 1,
    )).toBe('stale');
  });

  it('aggregates fresh tabs so a newer idle tab cannot mask a broken X cover', () => {
    const broken = snapshot({
      observedAt: 9_000,
      surfaceSessionId: 'ss-x-broken',
      missingOverlayHosts: 1,
    });
    const newerIdle = snapshot({
      observedAt: 10_000,
      host: 'facebook.com',
      surfaceSessionId: 'ss-fb-idle',
      liveHosts: 0,
      visibleHosts: 0,
      oldestMs: 0,
      owners: { post: 0, generic: 0 },
    });

    const combined = aggregateProtectionHealthSnapshots([broken, newerIdle], 10_000);

    expect(combined?.liveHosts).toBe(1);
    expect(combined?.missingOverlayHosts).toBe(1);
    expect(combined?.host).toBe('facebook.com, x.com');
    expect(assessProtectionHealth(combined!, 10_000)).toBe('broken');
  });

  it('counts one shared host, its owner scopes, age, and missing overlay', () => {
    const host = document.createElement('article');
    const overlay = document.createElement('div');
    overlay.className = 'fw-provisional-shield';
    host.appendChild(overlay);
    document.body.appendChild(host);
    host.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: 400, bottom: 500,
      width: 400, height: 500, toJSON: () => ({}),
    });

    syncProtectionCover({
      element: host,
      overlay,
      mountedAt: 1_000,
      ownerScopes: ['post', 'generic'],
    });
    const healthy = currentProtectionHealthSnapshot(50_000, 6_000);

    expect(healthy.liveHosts).toBe(1);
    expect(healthy.visibleHosts).toBe(1);
    expect(healthy.oldestMs).toBe(5_000);
    expect(healthy.owners).toEqual({ post: 1, generic: 1 });
    expect(healthy.ownerlessHosts).toBe(0);
    expect(healthy.missingOverlayHosts).toBe(0);

    overlay.remove();
    expect(currentProtectionHealthSnapshot(50_001, 6_001).missingOverlayHosts).toBe(1);

    removeProtectionCover(host);
    expect(currentProtectionHealthSnapshot(50_002, 6_002).liveHosts).toBe(0);
  });

  it('excludes a retained off-screen cover from the stuck-age so it is not falsely slow (CHILD-3)', () => {
    const host = document.createElement('article');
    const overlay = document.createElement('div');
    overlay.className = 'fw-provisional-shield';
    host.appendChild(overlay);
    document.body.appendChild(host);
    // No getBoundingClientRect stub → jsdom reports a 0x0 rect → off-screen,
    // exactly like an SPA-retained feed the router has moved away from.
    syncProtectionCover({ element: host, overlay, mountedAt: 1_000, ownerScopes: ['post'] });

    // Observed 60s after mount — well past PROTECTION_SLOW_MS.
    const snap = currentProtectionHealthSnapshot(200_000, 61_000);

    expect(snap.liveHosts).toBe(1);
    expect(snap.oldestMs).toBe(0);
    expect(assessProtectionHealth(snap, 200_000)).not.toBe('slow');
  });

  it('still reports a genuinely stuck on-screen cover as slow (CHILD-3)', () => {
    const host = document.createElement('article');
    const overlay = document.createElement('div');
    overlay.className = 'fw-provisional-shield';
    host.appendChild(overlay);
    document.body.appendChild(host);
    host.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: 400, bottom: 500,
      width: 400, height: 500, toJSON: () => ({}),
    }) as DOMRect;
    syncProtectionCover({ element: host, overlay, mountedAt: 1_000, ownerScopes: ['post'] });

    const snap = currentProtectionHealthSnapshot(200_000, 61_000);

    expect(snap.visibleHosts).toBe(1);
    expect(snap.oldestMs).toBeGreaterThan(PROTECTION_SLOW_MS);
    expect(assessProtectionHealth(snap, 200_000)).toBe('slow');
  });

  it('tracks an active host again after a temporary detach and resync', () => {
    const host = document.createElement('article');
    const overlay = document.createElement('div');
    host.appendChild(overlay);
    document.body.appendChild(host);
    syncProtectionCover({ element: host, overlay, mountedAt: 1_000, ownerScopes: ['generic'] });

    host.remove();
    expect(currentProtectionHealthSnapshot(5_000, 2_000).liveHosts).toBe(0);

    document.body.appendChild(host);
    syncProtectionCover({ element: host, overlay, mountedAt: 1_000, ownerScopes: ['generic'] });
    expect(currentProtectionHealthSnapshot(5_001, 2_001).liveHosts).toBe(1);
  });

  it('persists a per-session heartbeat that the Issues page can read', async () => {
    vi.useFakeTimers();
    const storage: Record<string, unknown> = {};
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({ ...storage })),
          set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(storage, values); }),
        },
      },
    });
    const host = document.createElement('article');
    const overlay = document.createElement('div');
    host.appendChild(overlay);
    document.body.appendChild(host);

    syncProtectionCover({ element: host, overlay, mountedAt: performance.now(), ownerScopes: ['post'] });
    await vi.advanceTimersByTimeAsync(1_100);

    const persisted = await readProtectionHealth();
    expect(persisted?.liveHosts).toBe(1);
    expect(persisted?.owners.post).toBe(1);
    expect(persisted?.surfaceSessionId).toMatch(/^ss-/);
  });


});
