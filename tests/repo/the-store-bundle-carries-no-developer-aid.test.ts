// UP2 (board/units/UP2.md; SCOPE item 3, FINDINGS F46, PROPOSALS P30 ride-along S23). The store service worker held the local dev-reload probe:
// the address 127.0.0.1:8790 and the path fw-build-id (src/background/dev-reload.ts), asked at a tick when the install is an unpacked
// development one. Nothing a store install needs, and the one place the worker named a local address (VERIFY.md 30 Sep 19:44).
//
// The bundle gate (scripts/check-sw-bundle.mjs) fails a store build (FW_DEV_RELOAD=0, which both packagers set) whose service worker
// carries one of its DEVELOPER_AIDS, and the build leaves them out. This file reads the list and the wiring off the source; the builds
// themselves were run for the commit: a store build with the gate and without the removal fails on both entries; with it, the store
// worker holds neither; the development build still holds both.
//
// NOT here: a developer licence key (fw-dev-...). The server accepts one when a record for it is seeded and the owner's own install may hold
// one, so taking it out of a store build is the head's call; the list names two entries until then.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT as ROOT } from '../helpers/repo-root';

const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

describe('UP2: the list in the bundle gate', () => {
  it('names exactly the probe address and path, and no licence key pattern', () => {
    const gate = read('scripts/check-sw-bundle.mjs');
    const list = gate.slice(gate.indexOf('const DEVELOPER_AIDS = ['), gate.indexOf('];', gate.indexOf('const DEVELOPER_AIDS = [')));
    const needles = [...list.matchAll(/needle: '([^']+)'/g)].map((m) => m[1]);
    expect(needles).toEqual(['127.0.0.1:8790', 'fw-build-id']);
    expect(list).not.toMatch(/fw-dev-/);
  });
});

describe('UP2: the wiring', () => {
  it('the bundle gate fails a store build on the clause, and only a store build', () => {
    const gate = read('scripts/check-sw-bundle.mjs');
    const at = gate.indexOf('if (!wantSecret) {\n    const DEVELOPER_AIDS');
    expect(at, 'the clause sits inside the store-build branch').toBeGreaterThan(-1);
    expect(gate.slice(at, at + 700)).toContain("fail('developer-aid'");
  });

  it('the main build tells the worker whether this is a store build, from the same flag that drops the secret', () => {
    const vite = read('vite.config.ts');
    expect(vite).toContain('__FW_DEV_RELOAD__: JSON.stringify(BAKE_DEV_SECRET)');
    expect(vite).toContain("const BAKE_DEV_SECRET = process.env.FW_DEV_RELOAD !== '0'");
  });

  it('dev-reload.ts folds its address and its poll away when that flag is off, and reads as on when it is absent (vitest, node)', () => {
    const src = read('src/background/dev-reload.ts');
    expect(src).toContain("const DEV_RELOAD_ON = typeof __FW_DEV_RELOAD__ === 'undefined' || __FW_DEV_RELOAD__;");
    expect(src).toContain("DEV_RELOAD_ON ? 'http://127.0.0.1:8790/fw-build-id' : ''");
    expect(src.match(/if \(!DEV_RELOAD_ON\) return;/g) ?? [], 'both entry points return first').toHaveLength(2);
  });
});
