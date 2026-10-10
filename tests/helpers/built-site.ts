// A built copy of feelingwise.org, served the way the host serves it, for the tests that measure
// the layout in a real browser. The generator writes into a scratch folder, so the committed site is
// never touched, and anything the generator does not write (images, the stylesheet's neighbours,
// the example exports) is read from landing/.

import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

import { chromium, type Browser } from 'playwright';

import { REPO_ROOT } from './repo-root';

const LANDING = resolve(REPO_ROOT, 'landing');
const GENERATOR = resolve(REPO_ROOT, 'scripts', 'site', 'build.mjs');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript',
  '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
};

export interface BuiltSite {
  out: string;
  origin: string;
  browser: Browser;
  /** Every built page as a clean path, "/" for the home page; the example exports are left out. */
  paths: string[];
  close(): Promise<void>;
}

/** A clean address as the host answers it: the built page first, anything else from landing/. */
function fileFor(out: string, path: string): string | null {
  const name = path === '/' ? 'index.html' : path.slice(1);
  for (const dir of [out, LANDING]) {
    for (const candidate of [name, `${name}.html`]) {
      const file = join(dir, candidate);
      if (existsSync(file) && !candidate.endsWith('/')) return file;
    }
  }
  return null;
}

export async function openBuiltSite(): Promise<BuiltSite> {
  const out = mkdtempSync(join(tmpdir(), 'fw-site-'));
  execFileSync(process.execPath, [GENERATOR, '--out', out], { encoding: 'utf8' });
  const server: Server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    const file = fileFor(out, path);
    if (!file) { res.writeHead(404, { 'content-type': TYPES['.html'] }); res.end(readFileSync(join(out, '404.html'))); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const address = server.address();
  const origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  const browser = await chromium.launch();
  const paths = readdirSync(out)
    .filter((f) => f.endsWith('.html'))
    .map((f) => (f === 'index.html' ? '/' : `/${f.slice(0, -5)}`));
  return {
    out, origin, browser, paths,
    async close() {
      await browser.close();
      server.close();
      rmSync(out, { recursive: true, force: true });
    },
  };
}
