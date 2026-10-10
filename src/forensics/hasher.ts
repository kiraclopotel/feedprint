// SHA-256 via Web Crypto API — available in both content scripts and service workers
export async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Fresh random salt as lowercase hex (`bytes` octets). */
export function randomSaltHex(bytes = 16): string {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

/**
 * PBKDF2-HMAC-SHA256 over a low-entropy secret (the parent PIN, a recovery
 * phrase). Returns 32 derived bytes as lowercase hex. The salt is hex as
 * produced by randomSaltHex; the iteration count is the caller's contract
 * and is stored next to the digest so it can be raised later.
 */
export async function pbkdf2Hex(secret: string, saltHex: string, iterations: number): Promise<string> {
  const salt = new Uint8Array(saltHex.length / 2);
  for (let i = 0; i < salt.length; i++) salt[i] = parseInt(saltHex.substr(i * 2, 2), 16);
  const baseKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, baseKey, 256,
  );
  return toHex(new Uint8Array(bits));
}

/**
 * Constant-time string equality. Always walks the full length of `a` so the
 * time taken does not leak how many leading characters matched; a length
 * mismatch is folded into the result rather than short-circuited.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ (i < b.length ? b.charCodeAt(i) : 0);
  }
  return diff === 0;
}
