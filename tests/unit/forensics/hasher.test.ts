import { describe, it, expect } from 'vitest';
import { sha256 } from '../../../src/forensics/hasher';

describe('SHA-256 hasher', () => {
  it('produces consistent 64-char hex string', async () => {
    const hash = await sha256('hello world');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces known hash for known input', async () => {
    // SHA-256 of "hello world" is well-known
    const hash = await sha256('hello world');
    expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  it('different inputs produce different hashes', async () => {
    const h1 = await sha256('text one');
    const h2 = await sha256('text two');
    expect(h1).not.toBe(h2);
  });
});
