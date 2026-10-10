// Behavior locks on export donation (src/forensics/donation.ts).
//
// The roster ships empty, so the shipped build can send to nobody. With a
// recipient set for the test, the POST body is the standalone HTML export
// itself, nothing about the sender is added, an http endpoint is refused
// before any document is built, and a failure comes back typed.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DONATION_RECIPIENTS, activeDonationRecipient, donateExport, _setDonationRecipientsForTesting,
  type DonationRecipient,
} from '../../../src/forensics/donation';
import type { ExportFilterResult } from '../../../src/forensics/exporter';
import type { ForensicRecord } from '../../../src/types/forensic';
import { installChromeStorageStub } from '../../helpers/chrome-storage';
import { saveSettings } from '../../../src/storage/settings';

const RECIPIENT: DonationRecipient = {
  id: 'test-org',
  name: 'Test Organisation',
  endpoint: 'https://donate.example.org/receipts',
  noticeUrl: 'https://example.org/notice',
};

const record = { id: 'r1' } as unknown as ForensicRecord;
const filterOf = (included: ForensicRecord[]): ExportFilterResult => ({
  included, totalSource: included.length, excludedUnreviewed: 0, excludedLowConfidence: 0, excludedNonDetection: 0,
});
const DOCUMENT = '<!DOCTYPE html><html>export</html>';
const buildDocument = vi.fn(async () => DOCUMENT);

// F50: the sender asks the level first, and a read that fails reads as Strict, so these cases run on an install at Moderate.
beforeEach(async () => {
  installChromeStorageStub({ initial: { mode: 'teen', levelChosen: true } });
  await saveSettings({});
});

afterEach(() => {
  _setDonationRecipientsForTesting(null);
  buildDocument.mockClear();
});

describe('donation roster', () => {
  it('ships empty: the build can send to nobody', () => {
    expect(DONATION_RECIPIENTS).toEqual([]);
    expect(activeDonationRecipient()).toBeNull();
  });

  it('refuses with no-recipient and builds nothing', async () => {
    const fetchSpy = vi.fn();
    const out = await donateExport([record], filterOf([record]), 'en', { fetch: fetchSpy, buildDocument });
    expect(out).toEqual({ kind: 'refused', reason: 'no-recipient' });
    expect(buildDocument).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('donateExport with a recipient', () => {
  it('POSTs the HTML export itself, with no cookies, referrer or sender field', async () => {
    _setDonationRecipientsForTesting([RECIPIENT]);
    const fetchSpy = vi.fn(async () => new Response('', { status: 200, headers: { 'X-Receipt': 'rcpt-42' } }));
    const out = await donateExport([record], filterOf([record]), 'ro', { fetch: fetchSpy, buildDocument });
    expect(buildDocument).toHaveBeenCalledWith([record], filterOf([record]), 'ro');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(RECIPIENT.endpoint);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(DOCUMENT);
    expect(init.credentials).toBe('omit');
    expect(init.referrerPolicy).toBe('no-referrer');
    expect(Object.keys(init.headers as Record<string, string>)).toEqual(['Content-Type']);
    expect(out).toEqual({ kind: 'sent', recipientId: 'test-org', bytes: DOCUMENT.length, records: 1, receipt: 'rcpt-42' });
  });

  it('reads a plain-text body as the receipt when no header is given', async () => {
    _setDonationRecipientsForTesting([RECIPIENT]);
    const fetchSpy = vi.fn(async () => new Response('  thank you, id 7 \n', { status: 200 }));
    const out = await donateExport([record], filterOf([record]), 'en', { fetch: fetchSpy, buildDocument });
    expect(out.kind).toBe('sent');
    expect(out.kind === 'sent' && out.receipt).toBe('thank you, id 7');
  });

  it('refuses an http endpoint before building the document', async () => {
    _setDonationRecipientsForTesting([{ ...RECIPIENT, endpoint: 'http://donate.example.org/receipts' }]);
    const fetchSpy = vi.fn();
    const out = await donateExport([record], filterOf([record]), 'en', { fetch: fetchSpy, buildDocument });
    expect(out).toEqual({ kind: 'refused', reason: 'insecure-endpoint' });
    expect(buildDocument).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses an export with no records', async () => {
    _setDonationRecipientsForTesting([RECIPIENT]);
    const fetchSpy = vi.fn();
    const out = await donateExport([], filterOf([]), 'en', { fetch: fetchSpy, buildDocument });
    expect(out).toEqual({ kind: 'refused', reason: 'nothing-to-send' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns the HTTP status when the recipient does not accept', async () => {
    _setDonationRecipientsForTesting([RECIPIENT]);
    const fetchSpy = vi.fn(async () => new Response('', { status: 413, statusText: 'Payload Too Large' }));
    const out = await donateExport([record], filterOf([record]), 'en', { fetch: fetchSpy, buildDocument });
    expect(out).toEqual({ kind: 'failed', status: 413, detail: 'Payload Too Large' });
  });

  it('returns the network error when nothing answers', async () => {
    _setDonationRecipientsForTesting([RECIPIENT]);
    const fetchSpy = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const out = await donateExport([record], filterOf([record]), 'en', { fetch: fetchSpy, buildDocument });
    expect(out).toEqual({ kind: 'failed', status: null, detail: 'Failed to fetch' });
  });
});
