// F50 (board/units/F50.md; FINDINGS F50, SCOPE item 12). The setup screens may say "nothing leaves this computer" at Strict only when every
// sender is gated by the level. The donation sender (src/forensics/donation.ts) was the one that was not: at Strict it held back only
// because the donation roster ships empty. It now asks the level before anything else, the way the time-stamp client does
// (tsa-client.ts, requestVerifiedTimestamps): at Strict it refuses with reason 'strict' before the roster is looked at, before a
// document is built and before any fetch, and a settings read that fails reads as Strict (settings.ts fails closed), so not knowing
// the level is no reason to send a file out.
//
// donation.test.ts and export-tab-render.test.ts keep their cases; donation.test.ts now runs its cases on an install at Moderate
// (one beforeEach, added by a diff the inspector helper applied), since a read that fails reads as Strict.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { installChromeStorageStub } from '../../helpers/chrome-storage';
import { saveSettings } from '../../../src/storage/settings';
import {
  donateExport, _setDonationRecipientsForTesting, type DonationRecipient,
} from '../../../src/forensics/donation';
import type { ExportFilterResult } from '../../../src/forensics/exporter';
import type { ForensicRecord } from '../../../src/types/forensic';

const RECIPIENT: DonationRecipient = {
  id: 'test-org',
  name: 'Test Organisation',
  endpoint: 'https://donate.example.org/receipts',
  noticeUrl: 'https://example.org/notice',
};

const record = { id: 'r1' } as unknown as ForensicRecord;
const filter: ExportFilterResult = {
  included: [record], totalSource: 1, excludedUnreviewed: 0, excludedLowConfidence: 0, excludedNonDetection: 0,
};
const DOCUMENT = '<!DOCTYPE html><html>export</html>';

/** An install at a level, with the settings cache dropped so the read sees it. */
async function atLevel(mode: 'child' | 'teen' | 'adult'): Promise<void> {
  installChromeStorageStub({ initial: { mode, levelChosen: true } });
  await saveSettings({});
}

/** An install whose settings cannot be read: every read of storage fails. */
async function unreadable(): Promise<void> {
  installChromeStorageStub({ initial: { mode: 'adult', levelChosen: true } });
  await saveSettings({});
  const chromeAny = (globalThis as unknown as { chrome: { storage: { local: { get: unknown } } } }).chrome;
  chromeAny.storage.local.get = () => Promise.reject(new Error('storage unreadable'));
  // The cache is dropped by a write; this read must reach the failing storage.
  await new Promise((r) => setTimeout(r, 0));
}

afterEach(() => {
  _setDonationRecipientsForTesting(null);
  vi.restoreAllMocks();
});

describe('F50: the donation sender asks the level first', () => {
  it('at Strict, with a recipient, it refuses with reason strict and builds and sends nothing', async () => {
    await atLevel('child');
    _setDonationRecipientsForTesting([RECIPIENT]);
    const fetchSpy = vi.fn();
    const buildDocument = vi.fn(async () => DOCUMENT);
    const out = await donateExport([record], filter, 'en', { fetch: fetchSpy, buildDocument });
    expect(out).toEqual({ kind: 'refused', reason: 'strict' });
    expect(fetchSpy, 'nothing is sent').not.toHaveBeenCalled();
    expect(buildDocument, 'no document is built').not.toHaveBeenCalled();
  });

  it('at Strict, with the real empty roster, the level answers first: reason strict', async () => {
    await atLevel('child');
    const out = await donateExport([record], filter, 'en', { fetch: vi.fn(), buildDocument: vi.fn(async () => DOCUMENT) });
    expect(out).toEqual({ kind: 'refused', reason: 'strict' });
  });

  it('with the settings unreadable it reads as Strict: refused, nothing built or sent', async () => {
    await unreadable();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    _setDonationRecipientsForTesting([RECIPIENT]);
    const fetchSpy = vi.fn();
    const buildDocument = vi.fn(async () => DOCUMENT);
    const out = await donateExport([record], filter, 'en', { fetch: fetchSpy, buildDocument });
    expect(out).toEqual({ kind: 'refused', reason: 'strict' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(buildDocument).not.toHaveBeenCalled();
  });

  it.each([['teen', 'Moderate'], ['adult', 'Relaxed']] as const)('guard: at %s (%s) with a recipient the send goes out as before', async (mode, _label) => {
    await atLevel(mode);
    _setDonationRecipientsForTesting([RECIPIENT]);
    const fetchSpy = vi.fn(async () => new Response('', { status: 200, headers: { 'X-Receipt': 'rcpt-1' } }));
    const buildDocument = vi.fn(async () => DOCUMENT);
    const out = await donateExport([record], filter, 'en', { fetch: fetchSpy, buildDocument });
    expect(out.kind).toBe('sent');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(buildDocument).toHaveBeenCalledTimes(1);
  });

  it.each([['teen', 'Moderate'], ['adult', 'Relaxed']] as const)('guard: at %s (%s) with the real empty roster the answer is still no-recipient', async (mode, _label) => {
    await atLevel(mode);
    const fetchSpy = vi.fn();
    const out = await donateExport([record], filter, 'en', { fetch: fetchSpy, buildDocument: vi.fn(async () => DOCUMENT) });
    expect(out).toEqual({ kind: 'refused', reason: 'no-recipient' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
