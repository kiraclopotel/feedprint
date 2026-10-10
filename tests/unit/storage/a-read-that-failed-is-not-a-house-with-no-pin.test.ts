/** @vitest-environment jsdom */
//
// A storage blip told every parent-PIN gate in the product that no PIN had
// ever been set.
//
// `getSettings` fails closed on a read error, and the comment beside it says
// what that means: return the strongest protection, Child mode and the child
// feature grid, never the lighter teen defaults. It does exactly that for
// those two fields. The snapshot it returns is `{...DEFAULTS, mode:'child',
// features:childPreset()}`, and `DEFAULTS.parentPin` is the empty string, so
// the same snapshot that hardens the filters reports that the house has no
// parent PIN.
//
// Every gate reads "no PIN" as "nothing here is protected, let them through":
//
//   the popup opens Settings with no prompt, and from there a child reaches
//     every protection toggle, the blocklist, the quiet-hours schedule and the
//     AI breaker;
//   modeSwitchRequiresPin returns false, so Child to Adult is two clicks;
//   the service worker resets the forensic chain, and restores a backup that
//     can replace the chain AND the signing identity, unauthenticated.
//
// The snapshot already carried the signal. `readFailedFallback: true` was set
// at both fallback returns and read by nothing but the forensic config
// snapshots, which record it faithfully and act on nothing.
//
// The root was one word. `getLocalWithRetry` absorbs exactly this blip for
// every other reader in the tree, and the settings read was the only reader
// fetching a LIST of keys, which its type refused. A comment in settings.ts
// had found that, named it, and left it: "switching call sites is a change to
// local-read.ts's contract, not a same-file fix, and stays out of this pass."
// It then named the consequence it had considered, a counter written from an
// unconfirmed snapshot, which the write side already guarded. The PIN was not
// considered. The helper's body always accepted a list.
//
// Retry is the fix; the gates are the defence, because three attempts can
// still all fail. A gate must never turn "I could not find out" into "there is
// no PIN": the first is recoverable on the next read, an opened gate is not.
//
// Found 2026-09-19 by a read-only scan of the child-safety promise, verified
// at the fallback return and at all four gates before anything moved.

import { describe, expect, it } from 'vitest';
import { modeSwitchRequiresPin } from '../../../src/ui/popup/switches';
import { parentPinUnknown } from '../../../src/storage/settings';
import { readSource } from '../../helpers/read-source';
import type { FWSettings } from '../../../src/storage/settings';

/** The shape getSettings returns when the read failed, in the fields that matter. */
const FAILED = { mode: 'child', parentPin: '', readFailedFallback: true } as unknown as
  Pick<FWSettings, 'mode' | 'parentPin' | 'readFailedFallback'>;
/** A real child install that genuinely has no PIN. */
const NO_PIN = { mode: 'child', parentPin: '' } as unknown as
  Pick<FWSettings, 'mode' | 'parentPin' | 'readFailedFallback'>;
/** A real child install with a PIN set. */
const WITH_PIN = { mode: 'child', parentPin: 'hash:abc' } as unknown as
  Pick<FWSettings, 'mode' | 'parentPin' | 'readFailedFallback'>;

describe('a read that failed is not a house with no PIN (2026-09-19)', () => {
  it('the helper tells the two apart', () => {
    expect(parentPinUnknown(FAILED)).toBe(true);
    expect(parentPinUnknown(NO_PIN), 'a real install with no PIN is known, not unknown').toBe(false);
    expect(parentPinUnknown(WITH_PIN)).toBe(false);
  });

  it('a child cannot leave Child mode on the strength of a failed read', () => {
    expect(modeSwitchRequiresPin(FAILED, 'adult'), 'unknown demands the PIN').toBe(true);
    expect(modeSwitchRequiresPin(FAILED, 'teen')).toBe(true);
  });

  it('and the two real cases are unchanged, or this fix costs a parent their popup', () => {
    // An install that truly has no PIN must still switch freely: turning
    // "unknown" into "locked" is only safe while "known and absent" stays open.
    expect(modeSwitchRequiresPin(NO_PIN, 'adult')).toBe(false);
    expect(modeSwitchRequiresPin(WITH_PIN, 'adult')).toBe(true);
    // Going INTO child never needs a PIN, whatever the snapshot says.
    expect(modeSwitchRequiresPin(FAILED, 'child')).toBe(false);
    expect(modeSwitchRequiresPin(WITH_PIN, 'child')).toBe(false);
  });

  it('the settings read goes through the retry every other reader uses', () => {
    const src = readSource('src/storage/settings.ts');
    expect(src, 'the list read is retried').toContain(
      "await getLocalWithRetry([...SETTINGS_KEYS, 'videoControls'])",
    );
    expect(src, 'and no longer reads straight through').not.toContain(
      "await chrome.storage.local.get([...SETTINGS_KEYS, 'videoControls'])",
    );
  });

  it('the retry helper accepts the list of keys that read needs', () => {
    // The whole reason that reader had no retry. Held here so a later
    // narrowing of the type silently un-retries the settings read.
    const src = readSource('src/storage/local-read.ts');
    expect(src).toContain('key: string | string[],');
  });

  it('the popup does not open Settings on a snapshot it could not read', () => {
    const src = readSource('src/ui/popup/Popup.tsx');
    const gate = src.indexOf('if (parentPinUnknown(settings))');
    const open = src.indexOf("if (!settings.parentPin) { setScreen('settings'); return; }");
    expect(gate, 'the unknown case is handled').toBeGreaterThan(0);
    expect(gate, 'and handled before the no-PIN case, or it never runs').toBeLessThan(open);
  });

  it('neither destructive gate in the service worker opens on one', () => {
    // A chain reset and a restore are irreversible, and any extension realm
    // can post the envelope that asks for them.
    const src = readSource('src/background/service-worker.ts');
    expect(src.match(/if \(parentPinUnknown\(settings\)\) \{/g)?.length, 'both branches').toBe(2);
    for (const branch of ['RESET_FORENSIC_CHAIN', 'RESTORE_FORENSIC_BACKUP']) {
      const at = src.indexOf(`'[FeelingWise] ${branch} refused: settings could not be read'`);
      expect(at, `${branch} says why it refused`).toBeGreaterThan(0);
    }
  });
});
