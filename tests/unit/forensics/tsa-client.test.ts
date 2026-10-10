/** @vitest-environment jsdom */
// FeelingWise — RFC 3161 TSA client contract.
//
// Locks the pure / failure-path contract of src/forensics/tsa-client.ts +
// src/forensics/chain-anchor-store.ts. Network paths (fetchTimeStampToken
// success) are covered manually against the live Worker because vitest
// jsdom doesn't sandbox the Cloudflare egress.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { repoPath } from '../../helpers/repo-root';

import {
  fetchTimeStampToken,
  requestVerifiedTimestamps,
  TSA_ENDPOINTS,
  ANCHORS_PER_ROUND,
  matchPatternFor,
  isSameAuthorityAsAny,
  type TsaAnchorResponse,
} from '../../../src/forensics/tsa-client';
import { anchorFromTsaResponse } from '../../../src/forensics/chain-anchor-store';

function installStorageStub(initial: Record<string, unknown> = {}): { state: Record<string, unknown> } {
  const state: Record<string, unknown> = { ...initial };
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: (keys: string | string[]) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of arr) {
            if (k in state) out[k] = state[k];
          }
          return Promise.resolve(out);
        },
        set: (obj: Record<string, unknown>) => {
          Object.assign(state, obj);
          return Promise.resolve();
        },
        remove: (keys: string | string[]) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          for (const k of arr) delete state[k];
          return Promise.resolve();
        },
      },
    },
  };
  return { state };
}

describe('fetchTimeStampToken — failure paths (no network)', () => {
  beforeEach(() => {
    installStorageStub();
  });

  it('rejects invalid hash format before any network call', async () => {
    const r = await fetchTimeStampToken('not-hex');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_hash');
  });

  it('rejects short hex (must be 64 chars)', async () => {
    const r = await fetchTimeStampToken('abcdef');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_hash');
  });

  it('no longer refuses a free install, and reports why each authority failed', async () => {
    // Until 2026-09-04 this returned `free_tier` before any network call, so no
    // shipped install ever received a timestamp while the site told parents
    // every entry carried one. The tier gate is gone. With no host permission
    // and no network in the test environment the call still fails, but the
    // reason now names the authority and the obstacle instead of the price.
    const validHash = 'a'.repeat(64);
    const r = await fetchTimeStampToken(validHash);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).not.toBe('free_tier');
      expect(r.reason).toMatch(/_(no_host_permission|network_error|http_\d+)$/);
    }
  });
});

describe('TSA endpoint list — independence is the point', () => {
  it('carries at least two operators so no single authority is the whole answer', () => {
    expect(TSA_ENDPOINTS.length).toBeGreaterThanOrEqual(2);
    expect(ANCHORS_PER_ROUND).toBeGreaterThanOrEqual(2);
  });

  it('spans more than one established jurisdiction', () => {
    const established = new Set(TSA_ENDPOINTS.map(e => e.jurisdiction).filter(j => j !== 'country not established'));
    expect(established.size).toBeGreaterThanOrEqual(2);
  });

  it('no longer asks CESNET, whose service is meant for research and education institutions', () => {
    // CESNET's own pages say its time-stamp service is intended for research
    // and educational institutions and other registered users (read
    // 2026-09-23, docs/research/2026-09-23-direction/research/check-2.md, row
    // T2). A browser extension anyone can install is neither, so it left the
    // list that day, and manifest.json lost its host with it.
    expect(TSA_ENDPOINTS.map(e => e.id)).not.toContain('cesnet');
    expect(TSA_ENDPOINTS.some(e => new URL(e.url).hostname.endsWith('cesnet.cz'))).toBe(false);
  });

  it('every endpoint yields a match pattern the browser will accept', () => {
    // A Chrome match pattern has no port. Building one from URL.origin carries
    // the port when there is one, so CESNET's `https://tsa.cesnet.cz:5817/*`
    // was invalid and its permission check could never succeed: that authority
    // was skipped on every round without ever reporting a reason a person would
    // recognise (found 2026-09-04). No endpoint here uses a port today; this
    // keeps the next one that does from repeating it.
    for (const e of TSA_ENDPOINTS) {
      const pattern = matchPatternFor(e.url);
      expect(pattern, `no pattern for ${e.id}`).not.toBeNull();
      expect(pattern, `${e.id} pattern carries a port`).not.toMatch(/:\d+\/\*$/);
      expect(pattern).toMatch(/^https?:\/\/[^:/]+\/\*$/);
    }
  });

  it('the manifest carries a matching host permission for every endpoint', async () => {
    // An endpoint with no permission is skipped forever, and the reason reads
    // like an outage. Reading the manifest here is what stops the two lists
    // drifting apart.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const manifest = JSON.parse(
      readFileSync(repoPath('manifest.json'), 'utf8'),
    ) as { host_permissions: string[] };
    for (const e of TSA_ENDPOINTS) {
      const pattern = matchPatternFor(e.url)!;
      expect(
        manifest.host_permissions,
        `manifest.json has no host permission matching ${e.id} (${pattern})`,
      ).toContain(pattern);
    }
  });

  it('refuses to build a pattern for a scheme that is not a web request', () => {
    expect(matchPatternFor('chrome-extension://abc/x')).toBeNull();
    expect(matchPatternFor('not a url')).toBeNull();
  });

  it('every endpoint has a unique id and a parseable absolute URL', () => {
    const ids = new Set<string>();
    for (const e of TSA_ENDPOINTS) {
      expect(ids.has(e.id), `duplicate endpoint id ${e.id}`).toBe(false);
      ids.add(e.id);
      expect(() => new URL(e.url)).not.toThrow();
      expect(e.label.length).toBeGreaterThan(0);
    }
  });
});

/** A verified response, the only shape the anchor path is allowed to store. */
function tsaResponse(over: Partial<TsaAnchorResponse> = {}): TsaAnchorResponse {
  return {
    ok: true,
    tsaProvider: 'freetsa',
    route: 'direct',
    response: 'r',
    tst: 't',
    generalizedTime: null,
    verification: {
      ok: true,
      genTime: null,
      messageImprintHex: null,
      messageImprintAlgorithm: null,
      serialNumber: null,
      policyOid: null,
      nonceHex: null,
      signerSubject: 'CN=www.freetsa.org',
      signerCertSha256: 'ab'.repeat(32),
      rootCertSha256: 'cd'.repeat(32),
      knownRootName: 'FreeTSA (freetsa.org) Root CA',
      checks: [{ name: 'message-imprint', ok: true, detail: 'stamped over the head hash' }],
      error: null,
    },
    ...over,
  };
}

describe('anchorFromTsaResponse — pure shape contract', () => {
  it('builds a ChainAnchor with all fields from the TSA response', () => {
    const anchor = anchorFromTsaResponse(
      tsaResponse({
        response: 'base64-of-full-response',
        tst: 'base64-of-tst',
        generalizedTime: '2026-05-28T12:34:56Z',
      }),
      152,
      'deadbeefcafebabe' + '0'.repeat(48),
    );
    expect(anchor.anchoredChainPosition).toBe(152);
    expect(anchor.tsaProvider).toBe('freetsa');
    expect(anchor.responseB64).toBe('base64-of-full-response');
    expect(anchor.tstB64).toBe('base64-of-tst');
    expect(anchor.generalizedTime).toBe('2026-05-28T12:34:56Z');
    expect(anchor.anchoredIntegrityHash).toMatch(/^deadbeefcafebabe0+$/);
    expect(anchor.id).toMatch(/^anchor-\d+-[a-z0-9]+$/);
    // requestedAt is a local-clock ISO string
    expect(anchor.requestedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('records how the token reached the machine and what the check found', () => {
    const anchor = anchorFromTsaResponse(tsaResponse(), 7, 'a'.repeat(64));
    expect(anchor.route).toBe('direct');
    expect(anchor.verification?.ok).toBe(true);
    expect(anchor.verification?.knownRootName).toBe('FreeTSA (freetsa.org) Root CA');
    expect(anchor.verification?.checks[0].name).toBe('message-imprint');
  });

  it('passes through null generalizedTime when the token carried no readable time', () => {
    const anchor = anchorFromTsaResponse(tsaResponse(), 0, 'a'.repeat(64));
    expect(anchor.generalizedTime).toBeNull();
  });

  it('produces unique ids across calls', () => {
    const tsa = tsaResponse();
    const a = anchorFromTsaResponse(tsa, 1, 'a'.repeat(64));
    const b = anchorFromTsaResponse(tsa, 1, 'a'.repeat(64));
    expect(a.id).not.toBe(b.id);
  });
});

describe('one round, independent operators', () => {
  const anchor = (tsaProvider: string, root: string | null): TsaAnchorResponse => ({
    ok: true,
    tsaProvider,
    route: 'direct',
    response: 'AA==',
    tst: 'AA==',
    generalizedTime: '2026-09-05T00:00:00Z',
    verification: {
      ok: true, genTime: '2026-09-05T00:00:00Z', messageImprintHex: null, messageImprintAlgorithm: null,
      serialNumber: null, policyOid: null, nonceHex: null, signerSubject: null,
      rootCertSha256: root, knownRootName: root ? 'root' : null, checks: [],
    } as unknown as TsaAnchorResponse['verification'],
  });

  it('refuses the proxy token when a direct request to the same authority already answered', () => {
    // Direct FreeTSA succeeded, the others failed, the proxy fetched FreeTSA
    // again: that is one authority twice, not two authorities.
    const direct = anchor('freetsa', 'aa'.repeat(32));
    const viaProxy = { ...anchor('freetsa', 'aa'.repeat(32)), route: 'proxy' as const };
    expect(isSameAuthorityAsAny([direct], viaProxy)).toBe(true);
  });

  it('accepts a second operator whose token chains to a different root', () => {
    expect(isSameAuthorityAsAny([anchor('freetsa', 'aa'.repeat(32))], anchor('sectigo', 'bb'.repeat(32)))).toBe(false);
  });

  it('falls back to the endpoint id when a root is not carried', () => {
    expect(isSameAuthorityAsAny([anchor('freetsa', null)], anchor('freetsa', null))).toBe(true);
    expect(isSameAuthorityAsAny([anchor('freetsa', null)], anchor('digicert', null))).toBe(false);
  });
});

describe('one round keeps going when an authority fails', () => {
  // With CESNET gone the list is shorter, so a round that stopped at the first
  // failure would lose half its authorities to one outage. These pin that a
  // failure of either kind moves the round on to the next authority. A free
  // install is used so the proxy is never asked and every request seen here is
  // a direct one.
  const HEAD = 'ab'.repeat(32);
  let fetched: string[] = [];
  let realFetch: typeof globalThis.fetch;

  function installChrome(canReach: (pattern: string) => boolean): void {
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: { id: 'test-extension' },
      permissions: { contains: async ({ origins }: { origins: string[] }) => canReach(origins[0]) },
      storage: { local: { get: async () => ({}) } },
    };
  }

  beforeEach(() => {
    fetched = [];
    realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: unknown) => {
      fetched.push(String(input));
      return { ok: false, status: 503 } as unknown as Response;
    }) as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  it('asks the next authority after one answers with an error, until the list ends', async () => {
    installChrome(() => true);
    const round = await requestVerifiedTimestamps(HEAD);
    expect(round.anchors).toEqual([]);
    expect(fetched.sort()).toEqual(TSA_ENDPOINTS.map(e => e.url).sort());
    expect(round.reasons.sort()).toEqual(TSA_ENDPOINTS.map(e => `${e.id}_http_503`).sort());
  });

  it('asks the others when the browser will not let it reach one', async () => {
    const blocked = TSA_ENDPOINTS[0];
    installChrome(pattern => pattern !== matchPatternFor(blocked.url));
    const round = await requestVerifiedTimestamps(HEAD);
    expect(fetched).not.toContain(blocked.url);
    expect(fetched.sort()).toEqual(TSA_ENDPOINTS.slice(1).map(e => e.url).sort());
    expect(round.reasons).toContain(`${blocked.id}_no_host_permission`);
  });
});
