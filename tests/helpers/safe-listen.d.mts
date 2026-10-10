// Types for safe-listen.mjs.
//
// The helper is plain ESM because the screenshot and fit scripts in scripts/ are node scripts and cannot
// import TypeScript, while the tests that open a local server run under vitest and are TypeScript. One
// implementation, two kinds of caller, and this file is what lets the typed ones see it.
import type { Server } from 'node:http';

/** Ports Chromium refuses to load (ERR_UNSAFE_PORT). */
export const CHROME_RESTRICTED_PORTS: ReadonlySet<number>;

/** Listens on 127.0.0.1 at a port Chromium will load, drawing again when the system hands out a refused one. */
export function listenOnASafePort(server: Pick<Server, 'listen' | 'address' | 'close'>): Promise<number>;
