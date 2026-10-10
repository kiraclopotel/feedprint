import { describe, expect, it, vi } from 'vitest';
import {
  initializeModeAwareProtection,
  type ModeStorageListener,
} from '../../../../src/content/protection/protection-runtime-startup';

/** A stored plan list as the proxy signs it; `day` moves only the dates. */
function plan(features: string[], day: number): { payload: string; sig: string } {
  const payload = JSON.stringify({
    v: 1, key_fp: 'family:abc123', features,
    issued_at: `2026-10-0${day}T00:00:00Z`, valid_until: `2026-10-1${day}T00:00:00Z`,
  });
  return { payload, sig: `sig-${day}` };
}

describe('protection runtime startup', () => {
  it('dispatches strictLanguage changes but ignores unrelated settings', async () => {
    let listener: ModeStorageListener | null = null;
    const onStrictLanguageChange = vi.fn();

    initializeModeAwareProtection(
      nextListener => { listener = nextListener; },
      vi.fn(),
      onStrictLanguageChange,
    );

    listener!({ uiLanguage: { newValue: 'ro' } }, 'local');
    expect(onStrictLanguageChange).not.toHaveBeenCalled();

    listener!({ strictLanguage: { newValue: true } }, 'local');
    expect(onStrictLanguageChange).toHaveBeenCalledTimes(1);
  });

  // A verdict the reading made earlier on the page replays from memory on re-detection; once the reading may not
  // run, it must not, so a change to the AI switch, the key or the plan list clears those verdicts at once.
  it.each([
    ['the AI switch', { aiAnalysisEnabled: { newValue: false } }],
    ['the key, removed', { fw_license_key: {} }],
    ['the plan list, to other features', { fw_entitlements: { oldValue: plan(['reading'], 1), newValue: plan(['reading', 'rewrite'], 2) } }],
    ['the plan list, cleared', { fw_entitlements: { oldValue: plan(['reading'], 1) } }],
  ])('invalidates the stored verdicts when %s changes', async (_what, changes) => {
    let listener: ModeStorageListener | null = null;
    const onPolicyChange = vi.fn();

    initializeModeAwareProtection(
      nextListener => { listener = nextListener; },
      vi.fn(),
      onPolicyChange,
    );

    listener!(changes, 'local');
    expect(onPolicyChange).toHaveBeenCalledTimes(1);
  });

  // Each successful refresh writes the plan list again with new dates; a page that rescanned on that would throw its
  // verdicts away every few hours for nothing.
  it('does not invalidate when a refresh renews only the dates of the same plan', async () => {
    let listener: ModeStorageListener | null = null;
    const onPolicyChange = vi.fn();

    initializeModeAwareProtection(
      nextListener => { listener = nextListener; },
      vi.fn(),
      onPolicyChange,
    );

    listener!({ fw_entitlements: { oldValue: plan(['reading', 'rewrite'], 1), newValue: plan(['rewrite', 'reading'], 2) } }, 'local');
    expect(onPolicyChange).not.toHaveBeenCalled();
  });

  it('invalidates the classification path on a feature-grid change (D10)', async () => {
    let listener: ModeStorageListener | null = null;
    const onPolicyChange = vi.fn();

    initializeModeAwareProtection(
      nextListener => { listener = nextListener; },
      vi.fn(),
      onPolicyChange,
    );

    listener!({ features: { newValue: {} } }, 'local');
    expect(onPolicyChange).toHaveBeenCalledTimes(1);
  });

  it('does not double-fire when a mode switch writes mode+features together', async () => {
    let listener: ModeStorageListener | null = null;
    const onModeChange = vi.fn();
    const onPolicyChange = vi.fn();

    initializeModeAwareProtection(
      nextListener => { listener = nextListener; },
      onModeChange,
      onPolicyChange,
    );

    // The popup's applyModeNow persists { mode, features, presets } in one
    // storage.set, so one onChanged event carries both keys. The mode handler
    // runs a superset of the policy invalidation; the policy callback must
    // stay silent or the feed rescans twice.
    listener!({ mode: { newValue: 'child' }, features: { newValue: {} } }, 'local');
    expect(onModeChange).toHaveBeenCalledTimes(1);
    expect(onPolicyChange).not.toHaveBeenCalled();
  });
});
