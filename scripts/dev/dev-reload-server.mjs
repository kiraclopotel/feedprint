#!/usr/bin/env node
// FeelingWise — dev-reload token server.
//
// Serves the CURRENT dist/build-id.json so an unpacked dev install of the
// extension can notice that a new build landed on disk and reload itself
// (src/background/dev-reload.ts). Runs only while the operator wants
// live-reload capability; when it is not running, the extension's poll
// fails silently and nothing happens.
//
// The build id is read fresh from disk on every request, so a rebuild IS
// the signal — no separate "bump" step exists.
//
// Usage: node scripts/dev/dev-reload-server.mjs [--port 8790] [--dist <path>]

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const argv = process.argv.slice(2);
let port = 8790;
let dist = join(REPO_ROOT, 'dist');
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--port') port = Number(argv[++i]);
  else if (argv[i] === '--dist') dist = resolve(argv[++i]);
}

const server = createServer((req, res) => {
  // CORS restricted to the extension origin. ACAO does not support partial
  // wildcards (chrome-extension://*), so echo back the exact Origin when it
  // is a chrome-extension:// origin; otherwise send no ACAO at all. The
  // endpoint carries a build id string, nothing else.
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.startsWith('chrome-extension://')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  if (req.url === '/fw-build-id') {
    try {
      const raw = readFileSync(join(dist, 'build-id.json'), 'utf8');
      const payload = JSON.parse(raw);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    } catch {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'no build-id.json in dist — run npm run build' }));
    }
    return;
  }
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[dev-reload-server] serving ${dist}/build-id.json on http://127.0.0.1:${port}/fw-build-id`);
});
