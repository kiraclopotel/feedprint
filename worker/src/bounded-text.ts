// A request body read up to a byte cap, from the stream, so the bound holds for a body of any shape.
//
// A header check against Content-Length alone is the half of the door the client writes: a chunked request carries no
// Content-Length at all, and one that lies about it passes. `request.text()` then buffers the whole body into the isolate
// whatever its size (an adversarial read of 18 Sep 2026 found this on the routes in proxy.ts, which keeps its own copy of
// this function; the report route used the header and `request.text()` until 12 Oct 2026).
//
// Returns null when the body exceeds `maxBytes` (the stream is cancelled, so nothing beyond the chunk that crossed the line
// is held), '' when there is no body.
export async function readBoundedText(request: Request, maxBytes: number): Promise<string | null> {
  const stream = request.body;
  if (!stream) return '';
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => { /* the peer is gone; nothing to do */ });
      return null;
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  // Decoded once at the end, so a multi-byte character split across two chunks still decodes correctly.
  return new TextDecoder().decode(joined);
}
