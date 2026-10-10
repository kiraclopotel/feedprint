// Evidence-gap register item 9 (2026-09-06): the chain records its own gaps.
//
// Before this, every loss path ended in an unsigned day-scoped counter or in
// nothing, so a record never written and a post that never existed looked the
// same in the export. The gap marker is a signed chain record with no content
// whose hashed text states a bound on what was lost, where, why and between
// which instants. This file pins: the hashed line and the reader's line; the
// realm-boundary shape check, two-sided; that the details are inside the
// signature; that the canonical payload did not change (the stability pin in
// canonical-payload-stability.test.ts is the proof for existing records); the
// content ledger's batching and its retire-only-what-was-sent rule; and the
// emit sites by source lock.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { computeRecordIntegrityHash } from '../../../../src/forensics/canonical-payload';
import { gapMarkerSummary, gapMarkerText, isGapMarkerInput } from '../../../../src/forensics/gap-marker';
import type { GapMarkerInput } from '../../../../src/types/gap-marker';
import { SYSTEM_MARKER_KINDS } from '../../../../src/forensics/system-records';
import type { ForensicRecord } from '../../../../src/types/forensic';
import { _setProductForTesting } from '../../../../src/product';
import { readSource } from '../../../helpers/read-source';

/** The export builder is four files since 2026-09-16 (PLAN-2026-09-16 item 10.1): the builder, the
 *  scripts the page carries, the stylesheet, and the string table under i18n. A scan of "the
 *  export's source" reads all four through readSource, which refuses an emptied or re-export-only
 *  file, so a later split cannot turn this scan into an empty pass. */
const EXPORT_SOURCES = [
  'src/forensics/html-export.ts',
  'src/forensics/html-export-scripts.ts',
  'src/forensics/html-export-styles.ts',
  'src/i18n/export-strings.ts',
];
const exportSource = (): string => EXPORT_SOURCES.map((p) => readSource(p)).join(String.fromCharCode(10));


if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const sendMock = vi.fn<(m: unknown) => Promise<unknown> | undefined>();
let contextAlive = true;
vi.mock('../../../../src/storage/context-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/context-guard')>();
  return {
    ...actual,
    safeSendMessage: (m: unknown) => sendMock(m),
    isContextAlive: () => contextAlive,
  };
});

import {
  _resetGapLedgerForTesting,
  flushGapLedger,
  noteGap,
  pendingGapMessages,
  setGapLedgerPlatform,
  _flushGapLedgerOnUnloadForTesting,
} from '../../../../src/content/record/gap-ledger';

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

const sample: GapMarkerInput = {
  reason: 'backlog-overflow',
  platform: 'tiktok',
  count: 412,
  unit: 'nodes',
  fromISO: '2026-09-06T10:00:00.000Z',
  toISO: '2026-09-06T10:03:00.000Z',
};

describe('gap marker text', () => {
  it('the hashed line names reason, platform, count, unit and both instants', () => {
    expect(gapMarkerText(sample, '2026-09-06T10:04:00.000Z', false)).toBe(
      '[gap-marker @ 2026-09-06T10:04:00.000Z] reason=backlog-overflow platform=tiktok'
      + ' count=412 unit=nodes from=2026-09-06T10:00:00.000Z to=2026-09-06T10:03:00.000Z',
    );
    expect(gapMarkerText(sample, '2026-09-06T10:04:00.000Z', true)).toMatch(/ settings-read-failed$/);
  });

  it('the reader line says what was lost in its unit, and a recorder-down gap says no heartbeat', () => {
    expect(gapMarkerSummary(sample)).toBe(
      'gap: 412 nodes lost (backlog-overflow, tiktok) between 2026-09-06T10:00:00.000Z and 2026-09-06T10:03:00.000Z',
    );
    expect(gapMarkerSummary({ ...sample, reason: 'recorder-down', count: 0, platform: 'unknown' })).toBe(
      'gap: no heartbeat between 2026-09-06T10:00:00.000Z and 2026-09-06T10:03:00.000Z',
    );
  });
});

describe('isGapMarkerInput (realm boundary, two-sided)', () => {
  const accept: unknown[] = [
    sample,
    { ...sample, platform: 'unknown', count: 0 },
    { ...sample, reason: 'recorder-down', unit: 'records' },
    { ...sample, surfaceOrigin: 'https://www.tiktok.com' },
  ];
  const reject: unknown[] = [
    null,
    'gap',
    { ...sample, reason: 'because' },
    { ...sample, platform: 'myspace' },
    { ...sample, count: -1 },
    { ...sample, count: 1.5 },
    { ...sample, count: '412' },
    { ...sample, unit: 'posts' },
    { ...sample, fromISO: 'yesterday' },
    { ...sample, toISO: undefined },
  ];
  it.each(accept.map((x, i) => [i, x]))('accepts case %i', (_i, x) => {
    expect(isGapMarkerInput(x)).toBe(true);
  });
  it.each(reject.map((x, i) => [i, x]))('rejects case %i', (_i, x) => {
    expect(isGapMarkerInput(x)).toBe(false);
  });
});

describe('the details are inside the signature and the canonical payload is untouched', () => {
  function marker(text: string): Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'> {
    return {
      id: 'fr-gap-test',
      timestamp: '2026-09-06T10:04:00.000Z',
      platform: 'tiktok',
      originalText: text,
      originalHash: 'h',
      originalLength: text.length,
      neutralizedText: '',
      author: '',
      postUrl: '',
      techniques: [],
      overallScore: 0,
      userAgeCategory: 'adult',
      aiSource: 'local',
      feedSource: 'unknown',
      detectionMode: 'gap-marker',
      prevRecordHash: 'prev',
      chainPosition: 7,
      verdict: 'pass',
      kind: 'gap-marker',
      resetReason: 'r',
      publicKeyFingerprint: 'fp',
    } as unknown as Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>;
  }

  it('changing the count changes the integrity hash', async () => {
    const a = await computeRecordIntegrityHash(marker(gapMarkerText(sample, 't', false)));
    const b = await computeRecordIntegrityHash(marker(gapMarkerText({ ...sample, count: 411 }, 't', false)));
    expect(a).not.toBe(b);
  });

  it('canonical-payload.ts has no gap-specific field: existing records hash as before', () => {
    const src = read('src/forensics/canonical-payload.ts');
    expect(src).not.toMatch(/gap-marker|gapReason|gap[A-Z]\w*:/);
    // And the verifier embedded in the export names the kind wherever it
    // names the prune marker, so a gap marker renders and verifies the same.
    const exportSrc = exportSource();
    const prune = exportSrc.match(/k==='prune-marker'/g)?.length ?? 0;
    const gap = exportSrc.match(/k==='gap-marker'/g)?.length ?? 0;
    const heartbeat = exportSrc.match(/k==='heartbeat-marker'/g)?.length ?? 0;
    const imported = exportSrc.match(/k==='import-marker'/g)?.length ?? 0;
    const repair = exportSrc.match(/k==='repair-marker'/g)?.length ?? 0;
    const redaction = exportSrc.match(/k==='redaction-marker'/g)?.length ?? 0;
    expect(prune).toBeGreaterThan(0);
    expect(gap).toBe(prune);
    expect(heartbeat).toBe(prune);
    expect(imported).toBe(prune);
    expect(repair).toBe(prune);
    expect(redaction).toBe(prune);
  });

  it('is a system marker: every parent-facing aggregation excludes it', () => {
    expect(SYSTEM_MARKER_KINDS.has('gap-marker')).toBe(true);
  });
});

describe('content gap ledger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetGapLedgerForTesting();
    _setProductForTesting('receipts');
    sendMock.mockReset();
    contextAlive = true;
    setGapLedgerPlatform('twitter');
  });
  afterEach(() => {
    vi.useRealTimers();
    _setProductForTesting(null);
  });

  it('batches per reason with a widening window and ignores empty counts', () => {
    vi.setSystemTime(new Date('2026-09-06T10:00:00.000Z'));
    noteGap('backlog-overflow', 300, 'nodes');
    noteGap('backlog-overflow', 0, 'nodes');
    vi.setSystemTime(new Date('2026-09-06T10:02:00.000Z'));
    noteGap('backlog-overflow', 200, 'nodes');
    noteGap('retry-overflow', 1, 'records');
    const msgs = pendingGapMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({
      type: 'GAP_LOG',
      payload: {
        reason: 'backlog-overflow', platform: 'twitter', count: 500, unit: 'nodes',
        fromISO: '2026-09-06T10:00:00.000Z', toISO: '2026-09-06T10:02:00.000Z',
      },
    });
    expect(msgs[1].payload).toMatchObject({ reason: 'retry-overflow', count: 1, unit: 'records' });
  });

  it('an accepted flush retires the entry; a refused one keeps it', async () => {
    noteGap('retry-exhausted', 2, 'records');
    sendMock.mockResolvedValueOnce({ ok: false });
    await flushGapLedger();
    expect(pendingGapMessages()).toHaveLength(1);
    sendMock.mockResolvedValueOnce({ ok: true });
    await flushGapLedger();
    expect(pendingGapMessages()).toHaveLength(0);
    expect(sendMock).toHaveBeenCalledTimes(2);
    const sent = sendMock.mock.calls[1][0] as { type: string; deliveryCapturedAt: string; payload: GapMarkerInput };
    expect(sent.type).toBe('GAP_LOG');
    expect(sent.deliveryCapturedAt).toBe(sent.payload.toISO);
  });

  // The worker's forensic gate refuses a delivery with no id, so a GAP_LOG
  // without one was rejected on every flush and no content-realm loss ever
  // reached the chain.
  it('every GAP_LOG carries a delivery id, and a retry resends the same one', async () => {
    noteGap('retry-overflow', 1, 'records');
    sendMock.mockResolvedValueOnce({ ok: false });
    await flushGapLedger();
    sendMock.mockResolvedValueOnce({ ok: true });
    await flushGapLedger();
    const first = sendMock.mock.calls[0][0] as { deliveryId?: string };
    const second = sendMock.mock.calls[1][0] as { deliveryId?: string };
    expect(typeof first.deliveryId).toBe('string');
    expect(first.deliveryId).toBeTruthy();
    expect(second.deliveryId).toBe(first.deliveryId);
  });

  // THE CLOSING TAB. flushOnce awaits a service-worker round trip between
  // messages, and at pagehide that round trip never resolves — the page is
  // being torn down — so every reason after the first was never handed to
  // sendMessage at all. Which loss survived was decided by which reason
  // happened to be noted first: a backlog of hidden NODES could outrank a lost
  // forensic RECORD, the higher-stakes unit.
  it('the pagehide flush sends every pending reason, not just the first', () => {
    noteGap('backlog-hidden', 40, 'nodes');
    noteGap('retry-overflow', 1, 'records');
    // Never resolves, exactly as a destroyed page never receives the answer.
    sendMock.mockImplementation(() => new Promise(() => {}));
    _flushGapLedgerOnUnloadForTesting();
    expect(sendMock).toHaveBeenCalledTimes(2);
    const reasons = sendMock.mock.calls.map(c => (c[0] as { payload: GapMarkerInput }).payload.reason);
    expect(reasons).toContain('backlog-hidden');
    expect(reasons).toContain('retry-overflow');
  });

  // And if a 60-second timer flush was mid-await when the tab closed, the
  // `flushing` guard made the unload path return having sent nothing at all.
  it('the pagehide flush is not blocked by a timer flush already in flight', () => {
    noteGap('retry-exhausted', 3, 'records');
    sendMock.mockImplementation(() => new Promise(() => {}));
    void flushGapLedger();            // takes the flushing guard, never resolves
    sendMock.mockClear();
    _flushGapLedgerOnUnloadForTesting();
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  // Nothing is retired on the unload path: retiring needs an acknowledgement,
  // none can arrive, and dropping an entry on no answer is how a loss is lost.
  it('the pagehide flush retires nothing', () => {
    noteGap('retry-overflow', 2, 'records');
    sendMock.mockImplementation(() => new Promise(() => {}));
    _flushGapLedgerOnUnloadForTesting();
    expect(pendingGapMessages()).toHaveLength(1);
  });

  it('two flushes racing send the counts once, not twice', async () => {
    noteGap('retry-exhausted', 4, 'records');
    let release!: () => void;
    sendMock.mockImplementationOnce(() => new Promise(r => { release = () => r({ ok: true }); }));
    const a = flushGapLedger();
    const b = flushGapLedger();   // pagehide over the timer's flush
    release();
    await Promise.all([a, b]);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(pendingGapMessages()).toHaveLength(0);
  });

  it('a note that lands during the send survives, its window starting where the sent one ended', async () => {
    vi.setSystemTime(new Date('2026-09-06T10:00:00.000Z'));
    noteGap('backlog-hidden', 10, 'nodes');
    sendMock.mockImplementationOnce(async () => {
      vi.setSystemTime(new Date('2026-09-06T10:00:30.000Z'));
      noteGap('backlog-hidden', 5, 'nodes');
      return { ok: true };
    });
    await flushGapLedger();
    const left = pendingGapMessages();
    expect(left).toHaveLength(1);
    expect(left[0].payload.count).toBe(5);
    expect(left[0].payload.fromISO).toBe('2026-09-06T10:00:00.000Z');
  });

  // THE LOST ACKNOWLEDGEMENT. An entry used to keep its delivery id while later
  // notes grew its count, so a resend carried a bigger number under an id the
  // outbox had already made up its mind about. The outbox dedupes on that id and
  // neither updates a pending row nor revisits a committed receipt, so it
  // answered ok:true without taking the new number — and the ledger, seeing
  // ok:true, deleted the entry. The chain kept a marker saying one record was
  // lost while the ledger discarded five.
  it('a resend carries exactly what its first send carried', async () => {
    noteGap('retry-overflow', 1, 'records');
    sendMock.mockResolvedValueOnce(undefined);   // sent, no answer
    await flushGapLedger();
    const firstSend = sendMock.mock.calls[0][0] as { deliveryId: string; payload: GapMarkerInput };
    expect(firstSend.payload.count).toBe(1);

    noteGap('retry-overflow', 4, 'records');     // four more losses arrive
    sendMock.mockResolvedValue({ ok: true });
    await flushGapLedger();

    const resends = sendMock.mock.calls.slice(1).map(c => c[0] as { deliveryId: string; payload: GapMarkerInput });
    // The unacknowledged delivery is resent unchanged, so a dedup hit on it
    // cannot swallow a number it never carried...
    const same = resends.find(r => r.deliveryId === firstSend.deliveryId);
    expect(same).toBeDefined();
    expect(same!.payload.count).toBe(1);
    // ...and the four that arrived after it travel under their own id.
    const fresh = resends.find(r => r.deliveryId !== firstSend.deliveryId);
    expect(fresh).toBeDefined();
    expect(fresh!.payload.count).toBe(4);
    // Between them the chain hears about all five, once each.
    expect(resends.reduce((n, r) => n + r.payload.count, 0)).toBe(5);
    expect(pendingGapMessages()).toHaveLength(0);
  });

  // The two markers must leave no interval unaccounted for: a note carries the
  // moment it was raised, not the moment each loss happened.
  it('the entry opened after a send starts its window where the sent one ended', async () => {
    vi.setSystemTime(new Date('2026-09-06T10:00:00.000Z'));
    noteGap('backlog-hidden', 10, 'nodes');
    sendMock.mockResolvedValueOnce({ ok: true });
    await flushGapLedger();
    vi.setSystemTime(new Date('2026-09-06T10:00:30.000Z'));
    noteGap('backlog-hidden', 5, 'nodes');
    const left = pendingGapMessages();
    expect(left).toHaveLength(1);
    expect(left[0].payload.count).toBe(5);
    expect(left[0].payload.fromISO).toBe('2026-09-06T10:00:00.000Z');
    expect(left[0].payload.toISO).toBe('2026-09-06T10:00:30.000Z');
  });

  it('the timer flushes a minute after the first note', async () => {
    sendMock.mockResolvedValue({ ok: true });
    noteGap('retry-overflow', 1, 'records');
    expect(sendMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('a dead context sends nothing and keeps the ledger', async () => {
    noteGap('retry-overflow', 1, 'records');
    contextAlive = false;
    await flushGapLedger();
    expect(sendMock).not.toHaveBeenCalled();
    expect(pendingGapMessages()).toHaveLength(1);
  });

  it('is reachable only from the recorder: Off never loads the ledger', () => {
    // The ledger used to ask isOffProduct() and clear itself. It no longer asks, because Off does
    // not import it: the only entry point that does is the recorder's content script
    // (PLAN-2026-09-16 item 9.2).
    expect(read('src/content/record/gap-ledger.ts')).not.toContain('isOffProduct');
    expect(read('src/products/off/content.ts')).not.toContain('gap-ledger');
    // Matched as a pattern: written as a literal, the repository's resolver guard reads this
    // test file as importing it.
    expect(read('src/content/index.ts')).toMatch(/from '\.\/record\/gap-ledger'/);
  });
});

describe('emit sites (source lock)', () => {
  it('the retry buffer notes overflow and exhaustion beside its counter', () => {
    const src = read('src/content/record/forensic-retry.ts');
    expect(src).toContain("noteGap(reason === 'Overflow' ? 'retry-overflow' : 'retry-exhausted', 1, 'records')");
  });

  it('the interceptor notes its two backlog drops in nodes', () => {
    const src = read('src/content/post-path/dom-interceptor.ts');
    expect(src).toContain("noteGap('backlog-overflow', this._pendingNodes.size, 'nodes')");
    expect(src).toContain("noteGap('backlog-hidden', this._pendingNodes.size, 'nodes')");
  });

  it('the outbox pump writes a marker for a quarantined delivery and dispatches GAP_LOG', () => {
    const src = read('src/forensics/forensic-delivery-pump.ts');
    expect(src).toContain("case 'GAP_LOG':");
    expect(src).toContain("reason: 'delivery-quarantined'");
    expect(src).toContain("if (entry.type !== 'GAP_LOG')");
  });

  it('GAP_LOG rides the durable outbox like every retained record', () => {
    expect(read('src/background/service-worker.ts')).toMatch(/'SKIPPED_LOG',\s*'GAP_LOG',\s*\]\);/);
    expect(read('src/forensics/delivery-outbox.ts')).toContain("| 'GAP_LOG'");
    expect(read('src/types/messages.ts')).toContain("type: 'GAP_LOG'");
  });

  it('the content boot names the platform and installs the pagehide flush', () => {
    const src = read('src/content/index.ts');
    expect(src).toContain('setGapLedgerPlatform(platform);');
    expect(src).toContain('installGapLedgerUnloadFlush();');
  });
});

// THE ONE LOSS PATH WITH NO REASON AT ALL. An extension update orphans the
// content script in every tab already open — chrome.runtime is nuked
// synchronously in those scripts — so anything they had observed and not yet
// delivered never arrives, and nothing wrote a thing. A routine auto-update
// took records off the chain silently, and the chain's whole claim is that a
// loss is stated rather than vanishing.
describe('the gap an extension update leaves', () => {
  const at = '2026-09-08T12:00:00.000Z';
  const input = {
    reason: 'context-invalidated' as const, platform: 'unknown' as const,
    count: 0, unit: 'records' as const, fromISO: at, toISO: at,
  };

  it('says an unknown amount was lost, never zero', () => {
    const line = gapMarkerSummary(input);
    expect(line).toContain('every tab already open was cut off from the recorder');
    expect(line).toContain('not knowable');
    // "0 records lost" would read as nothing lost, which is the opposite of
    // what this marker exists to say.
    expect(line).not.toContain('0 records lost');
  });

  it('is a reason the hashed line and the validator both accept', () => {
    const text = gapMarkerText(input, at, false);
    expect(text).toContain('reason=context-invalidated');
    expect(isGapMarkerInput(input)).toBe(true);
  });
});
