#!/usr/bin/env node
// receive-export.mjs: a reference receiver for donated Feedprint exports.
//
// Copyright 2026 FeelingWise. Licensed under the Apache License, Version 2.0;
// see the LICENSE file beside this one.
//
// For an organisation that has agreed to receive exports. Feedprint carries a
// "Send this export to <organisation>" button that POSTs the export file, from
// the person's own computer, to one HTTPS address, with no account and no
// identifier of the sender beyond the public key already inside the file.
// This program is the other end: it accepts the file, runs the same checker
// a person would (verify-export.mjs beside it), keeps the file with its
// reading, and answers with a receipt. The organisation running it is the
// data controller for what it keeps; the maker of the recorder never sees
// the file.
//
// Usage:  node receive-export.mjs --dir ./received [--port 8788] [--max-mb 64] [--host 127.0.0.1]
//
// Put it behind TLS (a reverse proxy that terminates HTTPS): the extension
// refuses to send to an http address. Nothing here logs an address, a header
// or a cookie; the only line printed per file is its receipt id and reading.
//
// Protocol, one request:
//   POST /            body: the export (text/html, or a bare JSON envelope)
//   200  X-Receipt: <id>   body: "receipt <id>: <verified|partial|failed>"
//   413  too large (the limit is printed in the body)
//   422  not a Feedprint export
//   405  anything but POST (OPTIONS is answered for browsers)
// The receipt id is the first 16 hex characters of the SHA-256 of the body,
// so the same file sent twice gets the same id and is kept once.

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyExportText } from './verify-export.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

/** The receiver as a function, so a test can run it on any port and stop it. */
export function createReceiver({ dir, maxBytes = 64 * 1024 * 1024, onReceived = () => {} }) {
  mkdirSync(dir, { recursive: true });
  return createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'X-Receipt');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method !== 'POST') { res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('POST an export here'); return; }
    const chunks = [];
    let size = 0;
    let refused = false;
    req.on('data', (chunk) => {
      if (refused) return;
      size += chunk.length;
      if (size > maxBytes) {
        refused = true;
        res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('too large: the limit here is ' + Math.round(maxBytes / (1024 * 1024)) + ' MB');
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (refused) return;
      void (async () => {
        const body = Buffer.concat(chunks);
        const text = body.toString('utf8');
        let report;
        try {
          report = await verifyExportText(text);
        } catch (err) {
          res.writeHead(422, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('not a Feedprint export: ' + (err && err.message ? err.message : String(err)));
          return;
        }
        const id = createHash('sha256').update(body).digest('hex').slice(0, 16);
        const isJson = text.trimStart().startsWith('{');
        const file = join(dir, id + (isJson ? '.json' : '.html'));
        writeFileSync(file, body);
        writeFileSync(join(dir, id + '.report.json'), JSON.stringify({ receipt: id, receivedAt: new Date().toISOString(), bytes: body.length, ...report }, null, 2), 'utf8');
        onReceived({ id, state: report.state, bytes: body.length, file });
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Receipt': id });
        res.end('receipt ' + id + ': ' + report.state);
      })();
    });
  });
}

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const dir = resolve(arg('--dir', './received'));
  const port = Number(arg('--port', '8788'));
  const host = arg('--host', '127.0.0.1');
  const maxBytes = Number(arg('--max-mb', '64')) * 1024 * 1024;
  const server = createReceiver({
    dir, maxBytes,
    onReceived: ({ id, state, bytes }) => { console.log(new Date().toISOString() + ' ' + id + ' ' + state + ' ' + bytes + ' bytes'); },
  });
  server.listen(port, host, () => {
    const a = server.address();
    console.log('receiving exports on http://' + host + ':' + a.port + '/ into ' + dir + ' (limit ' + Math.round(maxBytes / (1024 * 1024)) + ' MB)');
  });
}
