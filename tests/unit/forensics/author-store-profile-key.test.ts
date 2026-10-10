// M18 — author profiles must be namespaced by platform. Before the fix the IDB
// keyPath was the bare 'handle', so @user on TikTok and @user on Instagram
// collapsed into one record and their totalSeen/totalFlagged counts merged.
// The store now keys on the composite `profileKey` (handle@platform). IDB
// round-trips are not exercisable in the node/jsdom test env (no IndexedDB,
// fake-indexeddb not a dependency — same constraint as capture-prompt-io.test
// and perf-trace.test), so this locks the key-derivation mechanism that the
// keyPath is built from: the same handle on two platforms yields two distinct
// keys, which is exactly what keeps them as two distinct IDB records.

import { describe, it, expect } from 'vitest';
import { authorProfileKey } from '../../../src/forensics/author-store';

describe('author-store composite profile key (M18)', () => {
  it('same handle on two platforms produces two distinct keys', () => {
    const tiktok = authorProfileKey('@user', 'tiktok');
    const instagram = authorProfileKey('@user', 'instagram');
    expect(tiktok).not.toBe(instagram);
  });

  it('same handle + same platform is stable (one profile)', () => {
    expect(authorProfileKey('@user', 'tiktok')).toBe(authorProfileKey('@user', 'tiktok'));
  });

  it('encodes both handle and platform in the key', () => {
    expect(authorProfileKey('@user', 'tiktok')).toBe('@user@tiktok');
  });

  it('different handles on the same platform stay distinct', () => {
    expect(authorProfileKey('@alice', 'tiktok')).not.toBe(authorProfileKey('@bob', 'tiktok'));
  });
});
