// @vitest-environment jsdom
//
// README.md:97, said to every user who asks for help: "What a person pastes to support carries
// counts, never the text of a post, and handles are hashed."
//
// The thing that sentence is about is one button: "Copy diagnostics" on the dashboard's Issues tab
// (src/ui/dashboard/components/OperationalEventsPanel.tsx, copyDiagnostics). Nothing beside the
// button repeats the promise in any of the four language tables - opsMemorySub only says it "puts
// the raw data on your clipboard to paste back for analysis" - so the README sentence is the whole
// of what is promised, and this file is the whole of what checks it.
//
// The subject is the button's own output, not a reconstruction of it: the panel is mounted, the
// real readers run against a real seeded store, the real button is clicked, and what the real
// navigator.clipboard.writeText call receives is what gets examined. Three carriers are seeded,
// one per path in this payload that has ever had content on it:
//
//   1. the forensic chain (src/forensics/store.ts addRecord) - post text, handle, profile URL;
//   2. the comment-room mutation tally (src/diagnostics/room-attribution-outcome.ts) - the one
//      summariser here that keeps raw author / caption / url on the device and redacts them on the
//      way out (the DASH-1 defect, which shipped raw, and M90a, the platform id in the exemplar
//      key);
//   3. the scan log (src/forensics/scan-log.ts) - every scan event carries the author's handle.
//
// A leak is looked for by walking the parsed payload and by scanning the serialised string, never
// by reading named fields, because a field nobody thought to name is exactly how one gets out. A
// field added next month is caught by the shape pin at the bottom rather than missed by an
// assertion that did not know to look at it.
//
// What this file does NOT reach is written on the registry entry, not here.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('../../../../../src/forensics/signing', () => ({
  signHash: vi.fn(async () => 'test-signature'),
  verifyHash: vi.fn(async () => true),
  getPublicKeyFingerprint: vi.fn(async () => 'test-fingerprint'),
}));

import { OperationalEventsPanel } from '../../../../../src/ui/dashboard/components/OperationalEventsPanel';
import { I18nProvider } from '../../../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';
import { addRecord, getRecords } from '../../../../../src/forensics/store';
import { getScanEvents, logScanEvent } from '../../../../../src/forensics/scan-log';
import { readRoomMutations, recordRoomMutation } from '../../../../../src/diagnostics/room-attribution-outcome';
import { computeRecordIntegrityHash } from '../../../../../src/forensics/canonical-payload';
import { CHAIN_GENESIS_HASH } from '../../../../../src/forensics/chain-integrity';
import { installChromeStorageStub, type ChromeStorageStub } from '../../../../helpers/chrome-storage';
import { deleteDbs } from '../../../../helpers/indexeddb';
import type { ForensicRecord } from '../../../../../src/types/forensic';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Strings no feed would produce, so a hit is a leak and never a coincidence. */
const SENTINEL_TEXT = 'ZZQQ-POST-TEXT-SENTINEL-nobody-outside-this-device-should-read-this';
const SENTINEL_HANDLE = '@zzqq_handle_sentinel';
const SENTINEL_PROFILE_URL = `https://x.com/${SENTINEL_HANDLE.slice(1)}`;

/**
 * jsdom and Node each own a Uint8Array, and fake-indexeddb clones stored values through Node's
 * structuredClone. The gzip envelope written by addRecord came back failing
 * `payload instanceof Uint8Array` against jsdom's copy, so isCompressedEnvelope read it as a raw
 * legacy record, getRecords() handed the panel the still-compressed envelope, and the seeded post
 * text and handle never reached the summarisers at all: every assertion below would then have
 * passed against nothing (found while writing this file, 2026-09-18). Aligning the two realms is a
 * repair to this environment; the extension has one realm and never had this problem. The
 * `sentinels really are in the data` test is the standing guard against it coming back.
 */
const NODE_UINT8ARRAY = Object.getPrototypeOf(Buffer.prototype).constructor as Uint8ArrayConstructor;

const originalLocation = window.location;

/** The forensic and scan databases are extension-private; the realm guard refuses jsdom's default
 *  http://localhost origin, which would silently degrade the whole seed to empty. */
function setExtensionRealm(): void {
  const href = 'chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef/dashboard.html';
  const url = new URL(href);
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href, protocol: url.protocol, host: url.host, origin: url.origin },
  });
}

async function seedChainRecord(): Promise<void> {
  const partial = {
    id: 'rec-sentinel-1',
    timestamp: new Date().toISOString(),
    platform: 'twitter',
    originalText: SENTINEL_TEXT,
    originalHash: 'hash-of-the-sentinel',
    originalLength: SENTINEL_TEXT.length,
    neutralizedText: SENTINEL_TEXT,
    author: SENTINEL_HANDLE,
    postUrl: `${SENTINEL_PROFILE_URL}/status/1`,
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'for-you',
    prevRecordHash: CHAIN_GENESIS_HASH,
    chainPosition: 0,
    chainAnchor: 'genesis-v1',
    publicKeyFingerprint: 'test-fingerprint',
  } as unknown as Omit<ForensicRecord, 'integrityHash' | 'signature'>;
  await addRecord({ ...partial, integrityHash: await computeRecordIntegrityHash(partial) } as ForensicRecord);
}

let chromeStub: ChromeStorageStub;
let host: HTMLDivElement | null = null;
let root: Root | null = null;
let copied: string[] = [];

/** Let the panel's best-effort readers resolve; they are promise chains over IDB and
 *  chrome.storage, not one await. */
async function settle(ticks = 20): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  }
}

beforeEach(async () => {
  vi.stubGlobal('Uint8Array', NODE_UINT8ARRAY);
  setExtensionRealm();
  copied = [];
  chromeStub = installChromeStorageStub({ manifest: { version: '2.5.10' } });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text: string) => { copied.push(text); } },
  });
  await deleteDbs('feelingwise-forensics', 'feelingwise-scans');

  await seedChainRecord();
  await logScanEvent({
    timestamp: new Date().toISOString(),
    platform: 'twitter',
    feedSource: 'for-you',
    author: SENTINEL_HANDLE,
    postId: `${SENTINEL_HANDLE}/status/1`,
    action: 'hide',
  });
  await recordRoomMutation(
    { author: SENTINEL_HANDLE, url: SENTINEL_PROFILE_URL, caption: SENTINEL_TEXT },
    { author: `${SENTINEL_HANDLE}_second`, url: `${SENTINEL_PROFILE_URL}/other`, caption: `${SENTINEL_TEXT} again` },
    4,
    `${SENTINEL_HANDLE}/status/1`,
  );
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  host?.remove();
  host = null;
  chromeStub.restore();
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  vi.unstubAllGlobals();
});

/** Mount the panel, press the real button, hand back what the clipboard was given. */
async function payloadFromTheButton(): Promise<{ text: string; value: unknown }> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(I18nProvider, {
      lang: 'en',
      children: createElement(OperationalEventsPanel, {}),
    }));
  });
  await settle();

  const label = DASHBOARD_STRINGS.en.opsCopyDiagnostics;
  const button = Array.from(host.querySelectorAll('button')).find(b => b.textContent === label);
  if (!button) throw new Error(`the panel rendered no "${label}" button, so nothing was checked`);
  await act(async () => { button.click(); });
  await settle(3);
  if (copied.length !== 1) {
    throw new Error(`the button wrote ${copied.length} values to the clipboard, expected exactly 1`);
  }
  return { text: copied[0], value: JSON.parse(copied[0]) };
}

// ─── walking the payload, never reading named fields ───────────────────────

interface Leaf { path: string; value: unknown }

/** Every leaf, with array indices collapsed to [] so a list growing does not move the shape pin. */
function leaves(value: unknown, path = ''): Leaf[] {
  if (Array.isArray(value)) return value.flatMap(v => leaves(v, `${path}[]`));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  }
  return [{ path, value }];
}

/** Object keys are walked as well as values: a key carries a handle as easily as a value does, and
 *  a counter map keyed by author would be a leak with no string value anywhere. */
function objectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(objectKeys);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => [k, ...objectKeys(v)]);
  }
  return [];
}

const stringLeaves = (payload: unknown): Array<Leaf & { value: string }> =>
  leaves(payload).filter((l): l is Leaf & { value: string } => typeof l.value === 'string');

/**
 * Every way a secret can sit in a payload while a plain substring search says it does not. A hash
 * is deliberately NOT on this list: the promise allows a hash and forbids an encoding, and an
 * encoding is anything a reader turns back into the handle without holding the original.
 */
function reversibleForms(secret: string): Array<{ encoding: string; needle: string }> {
  const bare = secret.startsWith('@') ? secret.slice(1) : secret;
  const b64 = Buffer.from(secret, 'utf8').toString('base64');
  const bareB64 = Buffer.from(bare, 'utf8').toString('base64');
  return [
    { encoding: 'raw', needle: secret },
    { encoding: 'raw, without the @', needle: bare },
    { encoding: 'base64', needle: b64 },
    { encoding: 'base64, without the @', needle: bareB64 },
    { encoding: 'base64url', needle: b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') },
    { encoding: 'hex', needle: Buffer.from(secret, 'utf8').toString('hex') },
    { encoding: 'hex, without the @', needle: Buffer.from(bare, 'utf8').toString('hex') },
    { encoding: 'percent-encoded', needle: encodeURIComponent(secret) },
    { encoding: 'reversed', needle: [...secret].reverse().join('') },
  ].filter(f => f.needle.length >= 8);
}

/** Where a secret shows up, in any reversible form, anywhere: leaf values, object keys, and the
 *  serialised text (a value the walk cannot reach still reaches support). */
function findSecret(payload: unknown, serialised: string, secret: string): string[] {
  const haystacks: Array<{ where: string; text: string }> = [
    ...stringLeaves(payload).map(l => ({ where: `the value at ${l.path}`, text: l.value })),
    ...objectKeys(payload).map(k => ({ where: `the object key "${k}"`, text: k })),
    { where: 'the serialised clipboard text', text: serialised },
  ];
  const hits: string[] = [];
  for (const { encoding, needle } of reversibleForms(secret)) {
    const lowered = needle.toLowerCase();
    for (const { where, text } of haystacks) {
      if (text.toLowerCase().includes(lowered)) hits.push(`${encoding} in ${where}`);
    }
  }
  return [...new Set(hits)];
}

const sha256Hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

// ─── the shape, pinned ─────────────────────────────────────────────────────

/** The keys copyDiagnostics writes, in its own order. A block added to that object literal lands
 *  here first, so somebody has to say what the new block can carry before it ships. */
const PINNED_BLOCKS: readonly string[] = [
  'provenance',
  'diagnostics',
  'diagnosticCounterTotals',
  'diagnosticCounterFirstSeen',
  'neutralizerCounters',
  'protectionHealth',
  'canary',
  'selectorHealth',
  'perfSummary',
  'scanActivity',
  'licenseTier',
  'groqSummary',
  'roomMutationSummary',
  'forensicIntegrity',
  'recordIdentity',
  'forensicDeliveryStatus',
  'forensicDeliveryReadFailed',
];

/** Timestamps and day keys: the only dates a payload carries. */
const TIMESTAMP_FIELDS: readonly string[] = [
  'provenance.capturedAt',
  'provenance.build.runningSince',
  'diagnostics.date',
  'canary.date',
  'selectorHealth.date',
  'perfSummary.firstTimestamp',
  'perfSummary.lastTimestamp',
  'groqSummary.firstTs',
  'groqSummary.lastTs',
  'roomMutationSummary.since',
  'roomMutationSummary.recentChanges[].ts',
];
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z)?$/;

/** Sentences written in the source, about the numbers. These are the fields that LOOK free-form,
 *  so they are named here one by one rather than waved through as a group. */
const PROSE_FIELDS: readonly string[] = [
  'provenance.windows.diagnostics',
  'provenance.windows.diagnosticCounterTotals',
  'provenance.windows.diagnosticCounterFirstSeen',
  'provenance.windows.protectionHealth',
  'provenance.windows.canary',
  'provenance.windows.selectorHealth',
  'provenance.windows.perfSummary',
  'provenance.windows.scanActivity',
  'provenance.windows.groqSummary',
  'provenance.windows.roomMutationSummary',
  'provenance.windows.recordIdentity',
  'provenance.windows.forensicIntegrity',
  'provenance.windows.forensicDeliveryStatus',
  'provenance.windows.neutralizerCounters',
  'provenance.windows.licenseTier',
  'provenance.windows.forensicDeliveryReadFailed',
  'roomMutationSummary.breakdown[].label',
  'forensicIntegrity.remediation',
  'forensicIntegrity.reason',
];

/** Closed sets, taken from the types that produce them. A value off the list means the field stopped
 *  being an enum, which is how a free-form string arrives wearing an enum's name. */
const ENUM_FIELDS: Readonly<Record<string, readonly string[]>> = {
  'canary.status': ['clear', 'warned', 'unreadable', 'stale'],
  'licenseTier': ['free', 'starter', 'family', 'extended', 'dev'],
  'recordIdentity.alarm': ['ok', 'degraded', 'broken'],
  'recordIdentity.platforms[].state': ['ok', 'degraded', 'broken', 'insufficient'],
  'recordIdentity.state': ['ok', 'degraded', 'broken', 'insufficient'],
  'roomMutationSummary.recentChanges[].outcome': ['room-changed', 'room-regressed'],
  'roomMutationSummary.recentChanges[].fields[]': ['author', 'url', 'caption'],
  'roomMutationSummary.breakdown[].outcome': ['room-changed', 'room-regressed', 'filled', 'idempotent'],
  'forensicIntegrity.verificationState': ['verified', 'partial', 'failed'],
  'forensicIntegrity.brokenKind': ['tampered', 'key-mismatch', 'position-mismatch', 'chain-link-mismatch'],
};

/** Identifiers with a shape but no fixed list. The room key is the sharp one: M90a replaced the
 *  platform's own video/post id with a per-summary ordinal, and this pattern is what stops the id
 *  coming back. */
const IDENTIFIER_FIELDS: Readonly<Record<string, RegExp>> = {
  'provenance.build.id': /^(fwbid-[a-z0-9]+-[a-z0-9]+)?$/,
  'provenance.build.version': /^[0-9.]*$/,
  'provenance.saturated[]': /^[A-Za-z]+$/,
  'diagnostics.host': /^[a-z0-9.:-]*$/i,
  'recordIdentity.platforms[].platform': /^[a-z]+$/,
  'scanActivity.platforms[].key': /^[a-z]+$/,
  'scanActivity.feedSources[].key': /^[a-z-]+$/,
  'roomMutationSummary.recentChanges[].key': /^room-\d+$/,
};

/** Every leaf the button copies with this seed in place. Exact on purpose. */
const PINNED_PATHS: readonly string[] = [
  'canary.date',
  'canary.status',
  'diagnostics.date',
  'diagnostics.host',
  'diagnostics.peakMB',
  'forensicDeliveryReadFailed',
  'forensicDeliveryStatus.discardedRestoreCount',
  'forensicDeliveryStatus.failedCount',
  'forensicDeliveryStatus.pendingCount',
  'forensicDeliveryStatus.quarantinedCount',
  'forensicIntegrity.chainLength',
  'forensicIntegrity.counts.broken',
  'forensicIntegrity.counts.pre-chain',
  'forensicIntegrity.counts.pre-rekey',
  'forensicIntegrity.counts.prior-key',
  'forensicIntegrity.counts.unsigned',
  'forensicIntegrity.counts.verified',
  'forensicIntegrity.remediation',
  'forensicIntegrity.uncheckedAfterBreak',
  'forensicIntegrity.valid',
  'forensicIntegrity.verificationState',
  'groqSummary.attempts',
  'groqSummary.calls',
  'groqSummary.completionTokens',
  'groqSummary.errorCalls',
  'groqSummary.firstTs',
  'groqSummary.lastRetryAfterMs',
  'groqSummary.lastTs',
  'groqSummary.latencyMaxMs',
  'groqSummary.latencyP50',
  'groqSummary.latencyP95',
  'groqSummary.minRemainingRequests',
  'groqSummary.minRemainingTokens',
  'groqSummary.okCalls',
  'groqSummary.promptTokens',
  'groqSummary.retriedCalls',
  'groqSummary.totalTokens',
  'groqSummary.truncatedCalls',
  'licenseTier',
  'perfSummary.firstTimestamp',
  'perfSummary.lastTimestamp',
  'perfSummary.totalRecords',
  'protectionHealth',
  'provenance.build.id',
  'provenance.build.runningSince',
  'provenance.build.version',
  'provenance.capturedAt',
  'provenance.spansMultipleBuilds',
  'provenance.windows.canary',
  'provenance.windows.diagnosticCounterFirstSeen',
  'provenance.windows.diagnosticCounterTotals',
  'provenance.windows.diagnostics',
  'provenance.windows.forensicDeliveryReadFailed',
  'provenance.windows.forensicDeliveryStatus',
  'provenance.windows.forensicIntegrity',
  'provenance.windows.groqSummary',
  'provenance.windows.licenseTier',
  'provenance.windows.neutralizerCounters',
  'provenance.windows.perfSummary',
  'provenance.windows.protectionHealth',
  'provenance.windows.recordIdentity',
  'provenance.windows.roomMutationSummary',
  'provenance.windows.scanActivity',
  'provenance.windows.selectorHealth',
  'recordIdentity.alarm',
  'recordIdentity.anonymous',
  'recordIdentity.anonymousPct',
  'recordIdentity.contentRecords',
  'recordIdentity.missingAuthor',
  'recordIdentity.missingUrl',
  'recordIdentity.platforms[].anonymous',
  'recordIdentity.platforms[].anonymousPct',
  'recordIdentity.platforms[].contentRecords',
  'recordIdentity.platforms[].missingAuthor',
  'recordIdentity.platforms[].missingUrl',
  'recordIdentity.platforms[].platform',
  'recordIdentity.platforms[].state',
  // The aggregate's own state, added 2026-09-19 so the headline obeys the
  // same denominator floor its rows do. An enum of four words, same as the
  // per-platform one directly above.
  'recordIdentity.state',
  'recordIdentity.windowMs',
  'recordIdentity.worst',
  'roomMutationSummary.breakdown[].count',
  'roomMutationSummary.breakdown[].label',
  'roomMutationSummary.breakdown[].outcome',
  'roomMutationSummary.breakdown[].pct',
  'roomMutationSummary.commentsAtRoomChange',
  'roomMutationSummary.fieldChanges.author',
  'roomMutationSummary.fieldChanges.caption',
  'roomMutationSummary.fieldChanges.url',
  'roomMutationSummary.maxCommentsAtRoomChange',
  'roomMutationSummary.recentChanges[].bucketed',
  'roomMutationSummary.recentChanges[].fields[]',
  'roomMutationSummary.recentChanges[].from.author',
  'roomMutationSummary.recentChanges[].from.caption',
  'roomMutationSummary.recentChanges[].from.url',
  'roomMutationSummary.recentChanges[].key',
  'roomMutationSummary.recentChanges[].outcome',
  'roomMutationSummary.recentChanges[].to.author',
  'roomMutationSummary.recentChanges[].to.caption',
  'roomMutationSummary.recentChanges[].to.url',
  'roomMutationSummary.recentChanges[].ts',
  'roomMutationSummary.roomChanged',
  'roomMutationSummary.roomChangedPct',
  'roomMutationSummary.roomRegressed',
  'roomMutationSummary.since',
  'roomMutationSummary.total',
  'scanActivity.actedOn',
  'scanActivity.actedPct',
  'scanActivity.busiestHour',
  'scanActivity.cancelled',
  'scanActivity.feedSources[].actedOn',
  'scanActivity.feedSources[].actedPct',
  'scanActivity.feedSources[].key',
  'scanActivity.feedSources[].scanned',
  'scanActivity.passed',
  'scanActivity.platforms[].actedOn',
  'scanActivity.platforms[].actedPct',
  'scanActivity.platforms[].key',
  'scanActivity.platforms[].scanned',
  'scanActivity.totalScanned',
  'selectorHealth.date',
];

describe('what a person pastes to support (README.md:97)', () => {
  it('the sentinels really are in the data the payload is built from', async () => {
    // Without this, every assertion below passes on an empty device and proves nothing. It is
    // first on purpose: it reads the three stores through the same readers the panel uses.
    const records = await getRecords();
    expect(records.map(r => r.originalText)).toContain(SENTINEL_TEXT);
    expect(records.map(r => r.author)).toContain(SENTINEL_HANDLE);

    const tally = await readRoomMutations();
    expect(tally?.recentChanges?.[0]?.from.author).toBe(SENTINEL_HANDLE);
    expect(tally?.recentChanges?.[0]?.from.caption).toBe(SENTINEL_TEXT);
    expect(tally?.recentChanges?.[0]?.key).toContain(SENTINEL_HANDLE);

    const scans = await getScanEvents();
    expect(scans.map(s => s.author)).toContain(SENTINEL_HANDLE);
  });

  it('carries no post text, anywhere in it', async () => {
    const { text, value } = await payloadFromTheButton();
    expect(findSecret(value, text, SENTINEL_TEXT)).toEqual([]);
  });

  it('carries no handle, in any form a reader could turn back into the handle', async () => {
    const { text, value } = await payloadFromTheButton();
    // As of 2026-09-18 no handle is in this payload in ANY form, hashed or otherwise, so the
    // promise's "handles are hashed" holds by absence rather than by hashing. If one is ever added
    // it must arrive as a digest: the next test is what says the difference.
    expect(findSecret(value, text, SENTINEL_HANDLE)).toEqual([]);
    expect(findSecret(value, text, SENTINEL_PROFILE_URL)).toEqual([]);
  });

  it('would pass a hashed handle and catch an encoded one', async () => {
    // The clause "handles are hashed" is only worth something if the check can tell a hash from a
    // dressed-up handle. A payload that carries base64 or hex of the handle has published the
    // handle; a payload that carries its SHA-256 has not.
    const asHash = { accountHash: sha256Hex(SENTINEL_HANDLE) };
    expect(findSecret(asHash, JSON.stringify(asHash), SENTINEL_HANDLE)).toEqual([]);

    for (const dressed of [
      { accountHash: Buffer.from(SENTINEL_HANDLE, 'utf8').toString('base64') },
      { accountHash: Buffer.from(SENTINEL_HANDLE.slice(1), 'utf8').toString('base64') },
      { accountHash: Buffer.from(SENTINEL_HANDLE, 'utf8').toString('hex') },
      { accountHash: encodeURIComponent(SENTINEL_HANDLE) },
      { accountHash: [...SENTINEL_HANDLE].reverse().join('') },
      { [`counts.${SENTINEL_HANDLE}`]: 3 },
    ]) {
      expect(
        findSecret(dressed, JSON.stringify(dressed), SENTINEL_HANDLE),
        `a reversible encoding slipped past the check: ${JSON.stringify(dressed)}`,
      ).not.toEqual([]);
    }
  });

  it('has no free-form field: every block and every field is pinned', async () => {
    const { value } = await payloadFromTheButton();
    expect(Object.keys(value as object)).toEqual(PINNED_BLOCKS);
    expect([...new Set(leaves(value).map(l => l.path))].sort()).toEqual([...PINNED_PATHS].sort());
  });

  it('has no free-form field: every string it carries is a date, a sentence from the source, an enum or an identifier', async () => {
    const { value } = await payloadFromTheButton();
    const unclassified: string[] = [];
    const wrong: string[] = [];

    for (const { path, value: s } of stringLeaves(value)) {
      if (TIMESTAMP_FIELDS.includes(path)) {
        if (!TIMESTAMP.test(s)) wrong.push(`${path} is not a timestamp: ${JSON.stringify(s)}`);
      } else if (PROSE_FIELDS.includes(path)) {
        continue; // a sentence the source wrote about the numbers; the leak tests cover its content
      } else if (path in ENUM_FIELDS) {
        if (!ENUM_FIELDS[path].includes(s)) wrong.push(`${path} left its closed set: ${JSON.stringify(s)}`);
      } else if (path in IDENTIFIER_FIELDS) {
        if (!IDENTIFIER_FIELDS[path].test(s)) wrong.push(`${path} is not the identifier it should be: ${JSON.stringify(s)}`);
      } else {
        unclassified.push(`${path} = ${JSON.stringify(s)}`);
      }
    }

    expect(
      unclassified,
      'a string field nobody has classified is a field that can carry the text of a post; '
      + 'classify it above (date / sentence from the source / enum / identifier) or take it out of the payload',
    ).toEqual([]);
    expect(wrong, 'a pinned string field is no longer the shape it was pinned as').toEqual([]);
  });
});
