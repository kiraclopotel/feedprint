// A record about a document, a consent string or a typed note shares the chain with feed records and
// hashes only what it states (src/types/record-subject.ts, the Contracts design section 3).
//
// The bytes are written out by hand below and hashed with Node's own SHA-256, so this test does not
// trust the production hasher to tell it what the production hasher should produce. It pins three
// things: a subject record carries no feed field and no stand-in for one; `subject` is hashed whole,
// after every older key; and the public checker's copy of the payload reads it the same way.

import { createHash, webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import { VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE } from '../../../src/forensics/verifier-core-source';
import type { UnhashedSubjectRecord } from '../../../src/types/record-subject';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

type Unhashed = UnhashedSubjectRecord;

const nodeSha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

function checkerPayload(): (r: unknown) => string {
  return new Function(`${VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE}; return canonicalPayload;`)() as (r: unknown) => string;
}

const TERMS_TEXT = 'Terms of Service. This plan renews every year. To leave, give 30 days’ notice.';

function documentRecord(): Unhashed {
  return {
    id: 'cr-doc-001',
    timestamp: '2026-10-09T18:30:00.000Z',
    prevRecordHash: 'ab'.repeat(32),
    chainPosition: 3,
    publicKeyFingerprint: 'fp-contracts-01',
    kind: 'document',
    subject: {
      v: 1,
      address: 'https://shop.example/terms',
      addressTrimmed: true,
      title: 'Terms of Service',
      textHash: nodeSha256(TERMS_TEXT),
      textReader: 'fw-visible-text/1',
      text: TERMS_TEXT,
      boxes: [{ label: 'I agree to the terms', checked: true, type: 'checkbox' }],
      by: 'click',
    },
  };
}

function consentRecord(): Unhashed {
  return {
    id: 'cr-consent-001',
    timestamp: '2026-10-09T18:31:00.000Z',
    prevRecordHash: 'cd'.repeat(32),
    chainPosition: 4,
    publicKeyFingerprint: 'fp-contracts-01',
    kind: 'consent',
    subject: {
      v: 1,
      address: 'https://news.example/',
      standard: 'tcf-eu-2',
      string: 'CQSbk4AQSbk4ANwAAAENAwCgAAAAAAAAAAYgACPAAAAA.IDKQA4AAgAKAGQAygAAA.YAAAAAAAAAAA',
      route: 'message',
      api: { eventStatus: 'useractioncomplete', gdprApplies: true, cmpStatus: 'loaded' },
      by: 'click',
    },
  };
}

function noteRecord(): Unhashed {
  return {
    id: 'cr-note-001',
    timestamp: '2026-10-09T18:32:00.000Z',
    prevRecordHash: 'ef'.repeat(32),
    chainPosition: 5,
    kind: 'note',
    subject: {
      v: 1,
      agreement: 'ag-7f3a',
      about: ['cr-doc-001'],
      fields: [{ name: 'renews', value: '2027-10-09' }, { name: 'price', value: '9.99 a month' }],
    },
  };
}

describe('a subject record hashes only what it states', () => {
  it('hashes a document record to the bytes written out by hand: chain fields, the four defaults, kind, subject', async () => {
    const r = documentRecord();
    const bytes = '{"id":"cr-doc-001","timestamp":"2026-10-09T18:30:00.000Z",'
      + '"aiModel":"","aiProvider":"","detectionMode":"","configSnapshot":null,'
      + `"prevRecordHash":"${'ab'.repeat(32)}","chainPosition":3,"kind":"document",`
      + '"publicKeyFingerprint":"fp-contracts-01",'
      + `"subject":${JSON.stringify(r.subject)}}`;
    expect(await computeRecordIntegrityHash(r)).toBe(nodeSha256(bytes));
  });

  it('carries no feed field and no stand-in for one in its hashed bytes', async () => {
    const payload = checkerPayload()(consentRecord());
    for (const feedKey of ['platform', 'originalText', 'author', 'postUrl', 'techniques', 'overallScore',
      'userAgeCategory', 'aiSource', 'feedSource', 'verdict']) {
      expect(payload, feedKey).not.toContain(`"${feedKey}"`);
    }
    expect(payload).not.toContain('twitter');
  });

  it('puts subject last, after every key that existed before it', () => {
    const payload = checkerPayload()(noteRecord());
    expect(Object.keys(JSON.parse(payload) as object).at(-1)).toBe('subject');
  });

  it.each([
    ['document', documentRecord],
    ['consent', consentRecord],
    ['note', noteRecord],
  ])('the public checker reads a %s record to the same hash as the writer', async (_kind, make) => {
    const r = make();
    expect(nodeSha256(checkerPayload()(r))).toBe(await computeRecordIntegrityHash(r));
  });

  it('a change anywhere inside the subject changes the hash', async () => {
    const real = await computeRecordIntegrityHash(documentRecord());
    const ticked = documentRecord();
    if (ticked.kind !== 'document') throw new Error('unreachable');
    ticked.subject = { ...ticked.subject, boxes: [{ label: 'I agree to the terms', checked: false, type: 'checkbox' }] };
    expect(await computeRecordIntegrityHash(ticked)).not.toBe(real);

    const restring = consentRecord();
    if (restring.kind !== 'consent') throw new Error('unreachable');
    restring.subject = { ...restring.subject, api: { ...restring.subject.api, eventStatus: 'tcloaded' } };
    expect(await computeRecordIntegrityHash(restring)).not.toBe(await computeRecordIntegrityHash(consentRecord()));
  });

  it('a subject of null hashes as no subject at all, in the writer and in the public checker', async () => {
    const without = { id: 'v-0', timestamp: '2026-10-09T18:30:00.000Z', prevRecordHash: '', chainPosition: 0, kind: 'post' };
    const withNull = { ...without, subject: null };
    const expected = nodeSha256(checkerPayload()(without));
    expect(checkerPayload()(withNull)).not.toContain('"subject"');
    expect(nodeSha256(checkerPayload()(withNull))).toBe(expected);
    expect(await computeRecordIntegrityHash(withNull as unknown as Unhashed)).toBe(expected);
  });
});
