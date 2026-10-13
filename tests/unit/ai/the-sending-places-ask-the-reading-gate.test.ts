/** @vitest-environment jsdom */
//
// One gate for every place that can send something out (types/reading-gate.ts), built before Strict reads (the Leader's
// piece A, 12 Oct 2026). The switch that lets Strict read (types/strict-reads-switch.ts) is shut in the build, so this file
// runs each place twice: with the switch as shipped (shut), where every answer is the one makesNoOutsideCall gave, and with
// it opened by the test, where Strict is let through only for an adult who holds a paid key and has agreed.
//
//   free Strict, key but no agreement, key and agreement  x  switch shut, switch open  x  each sending place
//
// A free Strict install sends nothing from any place in either state; the other levels are unchanged in both; an install whose
// level is not chosen sends nothing in both. The donation stays refused at Strict even when Strict reads: it sends the whole
// record to a research recipient, which is not the reading the adult agreed to.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const GATE = vi.hoisted(() => ({
  open: false,
  mode: 'child' as 'child' | 'teen' | 'adult',
  levelChosen: true as boolean,
  master: true,
  tier: 'free' as string,
  consent: null as object | null,
}));

vi.mock('../../../src/types/strict-reads-switch', () => ({
  get STRICT_READS_WITH_A_KEY() { return GATE.open; },
}));
vi.mock('../../../src/storage/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/storage/settings')>()),
  getSettings: vi.fn(async () => ({
    mode: GATE.mode, levelChosen: GATE.levelChosen, aiAnalysisEnabled: GATE.master,
    strictLanguage: false, dailyCap: 0, totalChecksToday: 0, totalTokensThisMonth: 0, monthlyUsdCapOverride: null,
    locale: 'en', outputLanguage: 'auto', features: {},
  })),
  recordAiCall: vi.fn(async () => undefined),
}));
vi.mock('../../../src/storage/license', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/storage/license')>()),
  getLicense: vi.fn(async () => (GATE.tier === 'free' ? { tier: 'free', secret: '' } : { tier: GATE.tier, secret: 'abc123' })),
}));
vi.mock('../../../src/storage/reading-consent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/storage/reading-consent')>()),
  getReadingConsent: vi.fn(async () => GATE.consent),
}));

import { callAI, probeProxy, readingAllowed } from '../../../src/ai/client';
import { refreshEntitlements } from '../../../src/storage/license-entitlements';
import { carryOutRelayFetch } from '../../../src/background/relay-fetch';
import { syncRepairs } from '../../../src/background/repairs-sync';
import { requestVerifiedTimestamps } from '../../../src/forensics/tsa-client';
import { donateExport, _setDonationRecipientsForTesting } from '../../../src/forensics/donation';
import { needsReadingConsent } from '../../../src/ui/popup/panels/ReadingConsentScreen';
import { readingActive, mayCallOut, levelMayCallOut } from '../../../src/types/reading-gate';
import { makesNoOutsideCall } from '../../../src/types/mode';
import { getSettings } from '../../../src/storage/settings';
import { getLicense } from '../../../src/storage/license';
import { getReadingConsent } from '../../../src/storage/reading-consent';
import { readSource } from '../../helpers/read-source';

const AGREED = { textVersion: 'reading-consent-3', textHash: 'h', at: '2026-10-12T10:00:00Z', provider: 'DeepInfra' };
const HASH = 'ab'.repeat(32);
const KEY_JWK = { kty: 'EC', crv: 'P-256', x: 'a', y: 'b' } as JsonWebKey;

let fetchSpy: ReturnType<typeof vi.fn>;
let store: Map<string, unknown>;
let probeSeq = 0;

function installChrome(): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { id: undefined },
    permissions: { contains: async () => true },
    storage: {
      local: {
        get: vi.fn(async (keys?: string | string[] | null) => {
          const out: Record<string, unknown> = {};
          const names = keys == null ? [...store.keys()] : Array.isArray(keys) ? keys : [keys];
          for (const k of names) if (store.has(k)) out[k] = store.get(k);
          return out;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => { for (const [k, v] of Object.entries(items)) store.set(k, v); }),
        remove: vi.fn(async () => undefined),
      },
      session: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) },
      onChanged: { addListener: vi.fn() },
    },
  };
}

beforeEach(() => {
  store = new Map();
  installChrome();
  fetchSpy = vi.fn(async () => ({
    ok: false, status: 503, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0), text: async () => '',
    json: async () => ({}), clone() { return this; },
  }) as unknown as Response);
  vi.stubGlobal('fetch', fetchSpy);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  Object.assign(GATE, { open: false, mode: 'child', levelChosen: true, master: true, tier: 'free', consent: null });
  vi.mocked(getReadingConsent).mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  _setDonationRecipientsForTesting(null);
});

type Who = 'free Strict' | 'Strict with a key, no agreement' | 'Strict with a key and the agreement';
const WHO: Record<Who, { tier: string; consent: object | null }> = {
  'free Strict': { tier: 'free', consent: null },
  'Strict with a key, no agreement': { tier: 'family', consent: null },
  'Strict with a key and the agreement': { tier: 'family', consent: AGREED },
};
function become(who: Who, open: boolean): void {
  Object.assign(GATE, { open, mode: 'child', levelChosen: true, master: true, ...WHO[who] });
}

// Each place answers one question: did the place let a call through.
const PLACES: Record<string, () => Promise<boolean>> = {
  // client.ts: the reading (callAI refuses with master-off before any network code), its pre-check, and the key probe
  'callAI (the reading)': async () => {
    fetchSpy.mockClear();
    const r = await callAI('system', 'user', true, {});
    // The two refusals made before any network code: the level or the master switch (master-off), and no key (tier-free).
    const refusedAtTheGate = !r.ok && r.error.kind === 'cap-exhausted' && (r.error.cap === 'master-off' || r.error.cap === 'tier-free');
    return fetchSpy.mock.calls.length > 0 || !refusedAtTheGate;
  },
  'readingAllowed (the cached rewrite)': async () => readingAllowed(await getSettings() as never, await getLicense()),
  'probeProxy (is the key alive)': async () => { fetchSpy.mockClear(); await probeProxy(`fw-family-probe${++probeSeq}`); return fetchSpy.mock.calls.length > 0; },
  // the worker and the rest of the sending files
  'the worker carrying a relay call': async () => {
    fetchSpy.mockClear();
    const reply = await carryOutRelayFetch({ id: 'r1', url: 'https://api.feelingwise.org/v1/chat/completions', body: '{}', deadlineMs: 1000, headers: {} });
    return reply.ok || reply.kind !== 'refused';
  },
  'the repair file': async () => (await syncRepairs(fetchSpy as unknown as typeof fetch)) !== 'not-allowed',
  'the time stamp': async () => { fetchSpy.mockClear(); await requestVerifiedTimestamps(HASH); return fetchSpy.mock.calls.length > 0; },
};
const READING_PLACES = Object.keys(PLACES).filter((p) => !p.startsWith('probeProxy'));

// What each place does for each person while the switch is shut: the answer it always gave.
describe('the switch shut (as shipped): every place gives the answer it gave before the gate', () => {
  for (const who of Object.keys(WHO) as Who[]) {
    for (const place of Object.keys(PLACES)) {
      it(`${who}: ${place} sends nothing`, async () => {
        become(who, false);
        expect(await PLACES[place]()).toBe(false);
      });
    }
  }

  it('Strict while it reads nothing looks up neither the licence nor the agreement for the time stamp and the repair file', async () => {
    become('Strict with a key and the agreement', false);
    await requestVerifiedTimestamps(HASH);
    await syncRepairs(fetchSpy as unknown as typeof fetch);
    expect(getReadingConsent).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('the switch open: free Strict, and a key without the agreement, still send nothing from the reading places', () => {
  for (const who of ['free Strict', 'Strict with a key, no agreement'] as Who[]) {
    for (const place of READING_PLACES) {
      it(`${who}: ${place} sends nothing`, async () => {
        become(who, true);
        expect(await PLACES[place]()).toBe(false);
      });
    }
  }

  it('Strict with a key and the agreement: the reading, its pre-check, the worker, the repair file and the time stamp go', async () => {
    become('Strict with a key and the agreement', true);
    for (const place of READING_PLACES) {
      expect(await PLACES[place](), place).toBe(true);
    }
  });

  it('the master switch off holds the reading back at Strict as everywhere', async () => {
    become('Strict with a key and the agreement', true);
    GATE.master = false;
    expect(await PLACES['callAI (the reading)']()).toBe(false);
    expect(await PLACES['readingAllowed (the cached rewrite)']()).toBe(false);
  });

  it('a key is checked whenever one exists, with or without the agreement (the probe and the licence refresh)', async () => {
    become('Strict with a key, no agreement', true);
    expect(await PLACES['probeProxy (is the key alive)']()).toBe(true);
    expect(await refreshEntitlements(KEY_JWK)).not.toBe('skipped');
  });

  it('the licence refresh at Strict with the switch shut is skipped, with a key and the agreement too', async () => {
    become('Strict with a key and the agreement', false);
    expect(await refreshEntitlements(KEY_JWK)).toBe('skipped');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('the agreement screen asks at Strict only once Strict reads, and never without a key', () => {
    const s = {
      license: { tier: 'family', secret: 'x' } as never,
      settings: { aiAnalysisEnabled: true, mode: 'child', levelChosen: true } as never,
      consent: null, servedProvider: null, keyRefused: false,
    };
    GATE.open = false;
    expect(needsReadingConsent(s)).toBe(false);
    GATE.open = true;
    expect(needsReadingConsent(s)).toBe(true);
    expect(needsReadingConsent({ ...s, license: { tier: 'free', secret: '' } as never })).toBe(false);
  });
});

describe('the other levels and an unchosen level are the same in both states', () => {
  for (const open of [false, true]) {
    const state = open ? 'open' : 'shut';

    it(`Moderate, switch ${state}: the time stamp, the repair file, the worker and the probe go, whatever the plan`, async () => {
      Object.assign(GATE, { open, mode: 'teen', levelChosen: true, tier: 'free', consent: null });
      expect(await PLACES['the time stamp']()).toBe(true);
      expect(await PLACES['the repair file']()).toBe(true);
      expect(await PLACES['the worker carrying a relay call']()).toBe(true);
      expect(await PLACES['probeProxy (is the key alive)']()).toBe(true);
    });

    it(`Moderate with a key and no agreement stays as it was (the relay holds that agreement), switch ${state}`, async () => {
      Object.assign(GATE, { open, mode: 'teen', levelChosen: true, tier: 'family', consent: null });
      expect(await PLACES['callAI (the reading)']()).toBe(true);
      expect(await PLACES['readingAllowed (the cached rewrite)']()).toBe(true);
    });

    it(`an install whose level is not chosen sends nothing from any place, even with a key and an agreement, switch ${state}`, async () => {
      Object.assign(GATE, { open, mode: 'teen', levelChosen: false, tier: 'family', consent: AGREED });
      for (const place of Object.keys(PLACES)) expect(await PLACES[place](), place).toBe(false);
      expect(await refreshEntitlements(KEY_JWK)).toBe('skipped');
    });
  }
});

describe('the donation stays refused at Strict even once Strict reads', () => {
  it.each([false, true])('the whole record is not sent to a recipient at Strict with a key and the agreement (switch open: %s)', async (open) => {
    become('Strict with a key and the agreement', open);
    _setDonationRecipientsForTesting([{ id: 'r', label: 'r', endpoint: 'https://example.org/in' } as never]);
    const out = await donateExport([], { included: [] } as never, 'en');
    expect(out).toEqual({ kind: 'refused', reason: 'strict' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('the pure gate', () => {
  const base = { mode: 'child' as const, levelChosen: true, aiAnalysisEnabled: true };

  it('with the switch shut it says what makesNoOutsideCall always said, for every level, key and agreement', () => {
    GATE.open = false;
    for (const mode of ['child', 'teen', 'adult'] as const) {
      for (const levelChosen of [true, false, undefined]) {
        for (const tier of ['free', 'family']) {
          for (const consent of [null, undefined, AGREED]) {
            const s = { mode, levelChosen, aiAnalysisEnabled: true };
            expect(mayCallOut(s, { tier }, consent), `${mode}/${levelChosen}/${tier}/${consent ? 'agreed' : String(consent)}`).toBe(!makesNoOutsideCall(s));
            if (makesNoOutsideCall(s)) expect(readingActive(s, { tier }, consent)).toBe(false);
          }
        }
      }
    }
  });

  it('with the switch open Strict reads for a paid key, the master switch on and the agreement given, and for nothing less', () => {
    GATE.open = true;
    expect(readingActive(base, { tier: 'family' }, AGREED)).toBe(true);
    expect(readingActive(base, { tier: 'family' }, null)).toBe(false);
    expect(readingActive(base, { tier: 'family' }, undefined)).toBe(false);
    expect(readingActive(base, { tier: 'free' }, AGREED)).toBe(false);
    expect(readingActive({ ...base, aiAnalysisEnabled: false }, { tier: 'family' }, AGREED)).toBe(false);
    expect(readingActive({ ...base, levelChosen: false }, { tier: 'family' }, AGREED)).toBe(false);
    expect(levelMayCallOut(base)).toBe(true);
    expect(levelMayCallOut({ ...base, levelChosen: false })).toBe(false);
  });

  it('Moderate and Relaxed need no agreement here, since the relay asks for theirs', () => {
    for (const open of [false, true]) {
      GATE.open = open;
      expect(readingActive({ ...base, mode: 'teen' }, { tier: 'family' }, null)).toBe(true);
      expect(readingActive({ ...base, mode: 'adult' }, { tier: 'family' }, undefined)).toBe(true);
      expect(readingActive({ ...base, mode: 'teen' }, { tier: 'free' }, null)).toBe(false);
    }
  });
});

describe('the two places no test here can call have to ask the gate', () => {
  it('the time-stamp alarm (service worker) and the read-this button ask the gate, not makesNoOutsideCall', () => {
    const worker = readSource('src/background/service-worker.ts');
    expect(worker).toContain('mayCallOutNow(await getSettings())');
    expect(worker).not.toContain('makesNoOutsideCall');
    const readThis = readSource('src/content/markers/read-this.ts');
    expect(readThis).toContain('readingActiveNow(settings, license)');
    expect(readThis).toContain('levelMayCallOut(settings)');
    expect(readThis).not.toContain('makesNoOutsideCall');
  });
});
