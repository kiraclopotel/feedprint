#!/usr/bin/env node
// FeelingWise — mint one build id for a whole build run.
//
// WHY THIS EXISTS. `npm run build` invokes vite four times (main / bootstrap /
// content / pageworld). Each invocation evaluates vite.config.ts afresh, so a
// build id generated inside the config would differ per bundle and the four
// halves of one build would disagree about which build they are. This script
// mints ONE id and writes it to `.fw-build-id`; every vite invocation in the
// run reads that file, so the service worker and the content script carry the
// SAME id by construction.
//
// That shared id is what lets a record say which code judged it, and what lets
// a content script notice it is orphaned: the service worker is always the new
// build after a reload, while a tab opened before the reload keeps running the
// old content script until that tab reloads (see docs/design/STALE-TAB.md).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = resolve(root, '.fw-build-id');

// The reproducible build (scripts/reproducible-build.mjs) pins an id derived
// from the commit before it runs `npm run build`, and asks this script to
// keep it. Only a well-formed pinned id is kept; anything else is replaced.
if (process.env.FW_KEEP_BUILD_ID === '1' && existsSync(file)) {
  const pinned = readFileSync(file, 'utf8').trim();
  if (/^fwbid-[a-z0-9]+-[a-z0-9]+$/.test(pinned)) {
    console.log(`[fw] build id ${pinned} (kept: reproducible build)`);
    process.exit(0);
  }
}

// The `fwbid-` prefix is the extraction anchor scripts/check-sw-bundle.mjs
// greps for in the built service-worker bundle. Keep it.
const id = `fwbid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

writeFileSync(file, id, 'utf8');
console.log(`[fw] build id ${id}`);
