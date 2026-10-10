// Chromium refuses to load a page from these ports (ERR_UNSAFE_PORT). A server that asks the system for
// any free port (listen(0)) can be handed one where the dynamic range starts low, so every local server a
// browser will open goes through listenOnASafePort. The list is Chromium's kRestrictedPorts (net/base/port_util.cc),
// the same as the Fetch standard's bad ports, taken from undici 7.29.1 (lib/web/fetch/constants.js, badPorts); a
// scan of ports 1 to 600 with Chromium 149 refused exactly the 57 of them that are listed here.
export const CHROME_RESTRICTED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110,
  111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061,
  6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);

const MAX_DRAWS = 10;

/**
 * Starts `server` on 127.0.0.1 at a port Chromium will load and returns that port. A draw that lands on a
 * restricted port is closed and drawn again; ten in a row means the draw is not random, so it throws.
 */
export async function listenOnASafePort(server) {
  const listen = () => new Promise((ok) => server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    ok(typeof address === 'object' && address ? address.port : 0);
  }));
  for (let draw = 1; ; draw += 1) {
    const port = await listen();
    if (!CHROME_RESTRICTED_PORTS.has(port)) return port;
    await new Promise((ok) => server.close(() => ok()));
    if (draw === MAX_DRAWS) throw new Error(`${MAX_DRAWS} free ports in a row were ones Chrome refuses; the last was ${port}`);
  }
}
