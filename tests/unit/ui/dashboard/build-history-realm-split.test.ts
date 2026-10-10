/**
 * Turn 89 — the service worker's graph must stay self-contained.
 *
 * The regression this locks: importing `storage/build-history` and
 * `background/dev-reload` from the dashboard made the bundler hoist the service
 * worker's modules into a shared chunk, which carried the baked `fwbid-` build
 * id out of dist/service-worker.js. check-sw-bundle gate 4 caught it, but only
 * at build time and only by luck of having that gate. These are the cheap
 * source-level locks.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { BUILD_HISTORY_KEY } from '../../../../src/storage/build-history';
import { BUILD_HISTORY_KEY_READ } from '../../../../src/ui/dashboard/build-history-read';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const BUILD_HISTORY_READ_PATH = 'src/ui/dashboard/build-history-read.ts';
const DIAGNOSTICS_PROVENANCE_PATH = 'src/ui/dashboard/diagnostics-provenance.ts';
const OPERATIONAL_EVENTS_PANEL_PATH = 'src/ui/dashboard/components/OperationalEventsPanel.tsx';
const SERVICE_WORKER_PATH = 'src/background/service-worker.ts';

describe('build history realm split', () => {
  it('the writer and reader agree on the storage key', () => {
    // The key is duplicated on purpose so the two realms do not share a module.
    // This is the guard that makes the duplication safe.
    expect(BUILD_HISTORY_KEY_READ).toBe(BUILD_HISTORY_KEY);
  });

  it('the dashboard never imports from background/', () => {
    const files = [BUILD_HISTORY_READ_PATH, DIAGNOSTICS_PROVENANCE_PATH];
    for (const f of files) {
      expect(read(f), `${f} must not import background/`).not.toMatch(/from\s+'[^']*background\//);
    }
    expect(read(OPERATIONAL_EVENTS_PANEL_PATH))
      .not.toMatch(/from\s+'[^']*background\/dev-reload'/);
  });

  it('the dashboard never imports the worker-side build-history writer', () => {
    for (const f of [
      OPERATIONAL_EVENTS_PANEL_PATH,
      DIAGNOSTICS_PROVENANCE_PATH,
      BUILD_HISTORY_READ_PATH,
    ]) {
      expect(read(f), `${f} must not import storage/build-history`).not.toMatch(/storage\/build-history'/);
    }
  });

  it('the service worker still bakes the build id into its own graph', () => {
    const sw = read(SERVICE_WORKER_PATH);
    expect(sw).toMatch(/from '\.\/dev-reload'/);
    expect(sw).toMatch(/getBakedBuildId\(\)/);
  });
});
