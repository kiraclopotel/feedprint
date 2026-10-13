// A stored go-ahead for the paid reading, for tests whose key must reach the network.
//
// From 13 Oct 2026 the client reads the go-ahead before any reading leaves (src/ai/client.ts, cold audit finding 4),
// so a test that seeds a key and expects a request seeds this beside it. The slot is the first 32 hex characters of
// SHA-256 over the bearer, as src/storage/reading-consent.ts computes it; node's hash keeps this synchronous.

import { createHash } from 'node:crypto';
import { READING_CONSENT_TEXT_VERSION } from '../../src/storage/reading-consent';

/** `{ readingConsent: {...} }` holding a go-ahead for each bearer (`fw-<tier>-<secret>`, the stored key). */
export function readingConsentFor(...bearers: string[]): { readingConsent: Record<string, unknown> } {
  const all: Record<string, unknown> = {};
  for (const bearer of bearers) {
    const slot = createHash('sha256').update(bearer).digest('hex').slice(0, 32);
    all[slot] = {
      textVersion: READING_CONSENT_TEXT_VERSION,
      textHash: 'a'.repeat(64),
      at: '2026-10-13T00:00:00.000Z',
      provider: 'DeepInfra',
    };
  }
  return { readingConsent: all };
}
