// A local server a browser will open never keeps a port Chromium refuses.
import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { CHROME_RESTRICTED_PORTS, listenOnASafePort } from './safe-listen.mjs';

/** A server whose successive listen(0) calls land on the given ports, as the system's draw would. */
function drawing(ports: number[]) {
  const log = { listens: 0, closes: 0 };
  let current = 0;
  const server = {
    listen(_port: number, _host: string, ready: () => void) { current = ports[log.listens++]; ready(); return server; },
    address: () => ({ port: current, address: '127.0.0.1', family: 'IPv4' }),
    close(done: () => void) { log.closes += 1; done(); return server; },
  };
  return { server: server as never, log };
}

describe('listenOnASafePort', () => {
  it('draws again when the system hands out a refused port, and keeps the first safe one', async () => {
    const { server, log } = drawing([1719, 6667, 41234]);
    expect(await listenOnASafePort(server)).toBe(41234);
    expect(log).toEqual({ listens: 3, closes: 2 });
  });

  it('keeps a safe port at once, without closing anything', async () => {
    const { server, log } = drawing([41234]);
    expect(await listenOnASafePort(server)).toBe(41234);
    expect(log).toEqual({ listens: 1, closes: 0 });
  });

  it('gives up after ten refused draws in a row, naming the last one', async () => {
    const { server, log } = drawing(Array(10).fill(1719));
    await expect(listenOnASafePort(server)).rejects.toThrow(/10 free ports in a row.*1719/);
    expect(log.listens).toBe(10);
  });

  it('lists the ports a stale copy of the list tends to miss', () => {
    expect([1719, 4190, 6679, 10080].every((p) => CHROME_RESTRICTED_PORTS.has(p))).toBe(true);
  });

  it('on a real server returns the port the server is listening on, and it is not a refused one', async () => {
    const server = createServer();
    try {
      const port = await listenOnASafePort(server);
      expect(CHROME_RESTRICTED_PORTS.has(port)).toBe(false);
      expect((server.address() as { port: number }).port).toBe(port);
    } finally {
      await new Promise<void>((ok) => server.close(() => ok()));
    }
  });
});
