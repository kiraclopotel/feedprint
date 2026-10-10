/** @vitest-environment jsdom */
// Promise: pin-and-phrase-unreadable (scripts/verify/promises.product.registry.mjs).
//
// The setup screen tells the parent: "The PIN and the recovery phrase stay on this computer,
// inside this browser, kept only as a one-way fingerprint, which cannot be turned back into your PIN or phrase, and neither is ever sent anywhere."
// (src/i18n/popup/en.ts setupWhereSecretsNote). Two halves, and the registry note is explicit that
// the existing passphrase-never-leaves check is about the BACKUP passphrase and says nothing about
// these two secrets.
//
// This drives the real production sequence a first-run install goes through
// (src/ui/popup/panels/SetupWizard.tsx finishSetup, plus the draft writes
// src/storage/setup-draft.ts makes on every step change) against a storage stub built the same way
// tests/unit/storage/pin-recovery.test.ts and tests/unit/storage/settings-pin-hash.test.ts already
// do: a plain object standing in for chrome.storage.local and chrome.storage.session, so every value
// the run ever wrote is inspectable afterward, not just the final snapshot. A half-finished draft
// holding either secret in clear would be exactly the failure setup-draft.ts's own docblock names
// ("would make the half-finished state readable where the finished state is not"), so this test
// snapshots storage after every step, not only at the end.
//
// First half — "kept scrambled": every snapshot is searched for the PIN and the phrase, in the
// form the wizard shows them (raw digits, the phrase's displayed XXXX-XXXX and its hashed
// normalized form), upper/lower case, and base64 and hex re-encodings of each — the encodings a
// human reading a storage dump would try. Second half — "sent nowhere": every outbound call this
// run could make (fetch, chrome.runtime.sendMessage) is recorded and searched the same way.
//
// House rule: never print a secret into a test's output. Every check below reduces to a boolean
// (`found`/`sent`) before it reaches an assertion, so a failure prints true/false, never the value
// or the storage dump that triggered it.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const PIN = '7391';
const PHRASE_DISPLAY = 'WXYZ-2358'; // shaped like generateRecoveryPhrase's own output, fixed so the test is deterministic
const PHRASE_NORMALIZED = 'WXYZ2358';

function installStorageStub(): {
  local: Record<string, unknown>;
  session: Record<string, unknown>;
  sentMessages: unknown[];
} {
  const local: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};
  const sentMessages: unknown[] = [];

  function area(state: Record<string, unknown>) {
    return {
      get: (keys?: string | string[]) => {
        if (keys == null) return Promise.resolve({ ...state });
        const arr = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const k of arr) if (k in state) out[k] = state[k];
        return Promise.resolve(out);
      },
      set: (obj: Record<string, unknown>) => { Object.assign(state, obj); return Promise.resolve(); },
      remove: (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete state[k];
        return Promise.resolve();
      },
    };
  }

  (globalThis as { chrome?: unknown }).chrome = {
    storage: { local: area(local), session: area(session) },
    runtime: {
      id: 'test',
      sendMessage: (msg: unknown) => { sentMessages.push(msg); return Promise.resolve(); },
    },
  };

  return { local, session, sentMessages };
}

/** Every literal shape a leak could take: as typed, case-folded, base64, hex. Never logged. */
function candidateEncodings(secret: string): string[] {
  return [
    secret,
    secret.toLowerCase(),
    secret.toUpperCase(),
    Buffer.from(secret, 'utf8').toString('base64'),
    Buffer.from(secret, 'utf8').toString('hex'),
  ].filter((s) => s.length > 0);
}

const SECRET_ENCODINGS = [
  ...candidateEncodings(PIN),
  ...candidateEncodings(PHRASE_DISPLAY),
  ...candidateEncodings(PHRASE_NORMALIZED),
];

/**
 * The hexadecimal run a match sits inside, expanded both ways from `at`.
 *
 * Why it exists: the PIN is four digits and every digit is a hexadecimal
 * character, so a four-digit PIN turns up inside a random salt or a PBKDF2
 * digest by coincidence, and the salt and the digest are exactly what this run
 * writes. Measured 2026-09-19 over the two hashes a setup writes, 32 hex of
 * salt and 64 of digest each: 603 coincidences in 200,000 runs, one in 332.
 * That is a blocking gate on a security promise crying wolf every few hundred
 * commits, and the next reader to meet it has an obvious wrong fix to hand,
 * which is to weaken the search.
 *
 * A run of four digits inside ninety-six hexadecimal characters is not a
 * secret anybody can read back, so it is not what this test is looking for.
 * The whole run is measured rather than the two neighbouring characters,
 * because a salt that begins with the PIN has '$' on its left.
 */
function hexRunAround(haystack: string, at: number, length: number): number {
  const isHex = (ch: string) => /[0-9a-fA-F]/.test(ch);
  let from = at;
  while (from > 0 && isHex(haystack[from - 1])) from--;
  let to = at + length;
  while (to < haystack.length && isHex(haystack[to])) to++;
  return to - from;
}

/**
 * A hexadecimal run this long is a stored salt or digest, not a value somebody
 * typed. The two this run writes are 32 and 64 characters.
 */
const HEX_RUN_IS_A_BLOB = 12;

/**
 * A needle short enough, and hexadecimal enough, to turn up inside those by
 * chance. The bound is set from the collision rate, not from taste: across the
 * 192 hexadecimal characters a setup writes there are about 190 windows, so a
 * needle of n hex characters collides about 190/16^n of the time. Four
 * characters is one run in 332 and was measured at exactly that; six is one in
 * 88,000; eight is one in four thousand million. Six is the last length where
 * a coincidence is something this repository would ever see, so needles longer
 * than that keep the plain search. The PIN is four digits by rule
 * (`/^\d{4}$/` in settings.ts), and its hex ENCODING is eight, so the PIN is
 * suppressed inside a blob and a hex-encoded PIN hidden in one is not.
 */
const HEX_NEEDLE_COLLIDES_MAX = 6;
function collidesWithHashes(needle: string): boolean {
  return needle.length <= HEX_NEEDLE_COLLIDES_MAX && /^[0-9a-fA-F]+$/.test(needle);
}

/**
 * True if any encoding of the PIN or the phrase appears in `haystack`.
 * Returns a bool on purpose: see the house rule in the docblock above.
 *
 * The suppression applies ONLY to a needle that is itself short and all
 * hexadecimal, which is the raw PIN and nothing else here. The hex ENCODING of
 * the PIN is eight characters and collides once in four billion, so it keeps
 * the plain search and would still catch a PIN hex-encoded into a blob.
 */
function leaksASecret(haystack: string): boolean {
  return SECRET_ENCODINGS.some((needle) => {
    if (!collidesWithHashes(needle)) return haystack.includes(needle);
    for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
      if (hexRunAround(haystack, at, needle.length) < HEX_RUN_IS_A_BLOB) return true;
    }
    return false;
  });
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  fetchSpy = vi.fn(async () => new Response('{}'));
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
});

describe('pin-and-phrase-unreadable', () => {
  it('never writes the PIN or the phrase readably at any point in a real setup run, and sends neither anywhere', async () => {
    const { local, session, sentMessages } = installStorageStub();
    const { saveSettings, applyPreset, setPin, setRecoveryPhrase } = await import('../../../src/storage/settings');
    const { saveSetupDraft, clearSetupDraft } = await import('../../../src/storage/setup-draft');

    const snapshots: string[] = [];
    const snapshot = () => {
      // Both storage areas, as a parent or an incident responder reading a device dump would see
      // them: every key, every value, concatenated. Kept in memory only — never printed.
      snapshots.push(JSON.stringify({ local, session }));
    };

    // Screen 0 (mode choice) and screen 1 (child/teen confirm): the draft holds only step + mode.
    await saveSetupDraft({ step: 0, mode: 'child' });
    snapshot();
    await saveSetupDraft({ step: 1, mode: 'child' });
    snapshot();

    // Screen 2: the parent types the PIN. Nothing is written until finishSetup — the wizard holds
    // it in React state alone (SetupWizard.tsx) — but the draft write that carries the wizard to
    // this screen must not have picked it up either.
    await saveSetupDraft({ step: 2, mode: 'child' });
    snapshot();

    // finishSetup's own sequence (SetupWizard.tsx), driven directly: settings before the PIN, then
    // the PIN, then the phrase, exactly the order and the calls production makes.
    const patch = applyPreset('child');
    await saveSettings({ mode: 'child', features: patch.features, presets: patch.presets });
    snapshot();
    await setPin(PIN);
    snapshot();
    await setRecoveryPhrase(PHRASE_DISPLAY);
    snapshot();
    await saveSettings({ setupDone: true });
    snapshot();
    await clearSetupDraft();
    snapshot();

    // First half: "kept scrambled" — not one snapshot, at any point in the run, carries either
    // secret in a form anyone could read back.
    const anySnapshotLeaked = snapshots.some(leaksASecret);
    expect(anySnapshotLeaked, 'the PIN or the recovery phrase appeared readably in storage at some point in the run').toBe(false);

    // The two keys the design actually writes are present and are not merely absent-by-accident:
    // a check that found nothing because it looked at nothing would be worthless.
    expect(typeof local['parentPin']).toBe('string');
    expect((local['parentPin'] as string).length).toBeGreaterThan(0);
    expect(typeof local['fw_pin_recovery']).toBe('string');
    expect((local['fw_pin_recovery'] as string).length).toBeGreaterThan(0);

    // Second half: "sent nowhere" — nothing about this run left the machine.
    expect(fetchSpy).not.toHaveBeenCalled();
    const anyMessageLeaked = sentMessages.some((m) => leaksASecret(JSON.stringify(m)));
    expect(anyMessageLeaked, 'the PIN or the recovery phrase appeared in a chrome.runtime message sent during the run').toBe(false);
  });

  // The detector is now allowed to ignore one thing, so it has to be shown
  // biting on everything else. Without this block the suppression above is a
  // weakening nobody measured, which is how a check quietly stops checking.
  it('the search still bites on a real leak and ignores only the coincidence', () => {
    const blob = 'a1b2c3d47391e5f6a7b8c9d0e1f2a3b4a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
    expect(blob.includes(PIN), 'the fixture really does contain the PIN by coincidence').toBe(true);
    expect(leaksASecret(JSON.stringify({ parentPin: 'pbkdf2$210000$' + blob })), 'a PIN inside a hash is not a readable leak').toBe(false);

    // Every shape a real leak takes, each one caught.
    expect(leaksASecret(JSON.stringify({ parentPinPlain: PIN }))).toBe(true);
    expect(leaksASecret(JSON.stringify({ note: 'the pin is ' + PIN + ' keep it safe' }))).toBe(true);
    expect(leaksASecret(JSON.stringify({ draft: { step: 2, typed: PIN } }))).toBe(true);
    expect(leaksASecret(JSON.stringify({ phrase: PHRASE_DISPLAY }))).toBe(true);
    expect(leaksASecret(JSON.stringify({ phrase: PHRASE_NORMALIZED.toLowerCase() }))).toBe(true);
    expect(leaksASecret(JSON.stringify({ b64: Buffer.from(PHRASE_DISPLAY, 'utf8').toString('base64') }))).toBe(true);
    // A PIN hex-encoded into the middle of a hex blob: eight hex characters,
    // which collide once in four thousand million, so this needle is past
    // HEX_NEEDLE_COLLIDES_MAX and keeps the plain search. The first draft of
    // the bound was written as "shorter than a blob", twelve, which swallowed
    // this case; the test caught it.
    const hexPin = Buffer.from(PIN, 'utf8').toString('hex');
    expect(leaksASecret('deadbeef' + hexPin + 'cafebabe'), 'a hex-encoded PIN hidden in a blob is still a leak').toBe(true);
  });

  it('the stored PIN hash does not verify against the phrase, and vice versa (scrambled, not just concatenated)', async () => {
    installStorageStub();
    const { setPin, setRecoveryPhrase, verifyPin, resetPinWithRecoveryPhrase } = await import('../../../src/storage/settings');
    await setPin(PIN);
    await setRecoveryPhrase(PHRASE_DISPLAY);

    expect(await verifyPin(PHRASE_DISPLAY)).toBe(false);
    expect(await verifyPin(PHRASE_NORMALIZED)).toBe(false);
    // A reset attempt using the PIN itself as if it were the phrase must not succeed either.
    expect(await resetPinWithRecoveryPhrase(PIN, '0000')).toBe(false);
  });
});
