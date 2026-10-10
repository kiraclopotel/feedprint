// The donation sender refuses before a level is chosen too, like every other sender: a fresh install
// in setup has not said what may leave the computer, so nothing does. A failed settings read still
// refuses (the-donation-sender-asks-the-level-first.test.ts), and a chosen Moderate or Relaxed still sends.

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

async function install(initial: Record<string, unknown>): Promise<void> {
  installChromeStorageStub({ initial });
  await saveSettings({});
}

afterEach(() => {
  _setDonationRecipientsForTesting(null);
  vi.restoreAllMocks();
});

describe('the donation sender waits for a level to be chosen', () => {
  it.each(['teen', 'adult'] as const)('a fresh install with %s stored but no level chosen sends nothing', async (mode) => {
    await install({ mode, levelChosen: false });
    _setDonationRecipientsForTesting([RECIPIENT]);
    const fetchSpy = vi.fn();
    const buildDocument = vi.fn(async () => '<html></html>');
    const outcome = await donateExport([record], filter, 'en', { fetch: fetchSpy, buildDocument });
    expect(outcome.kind).toBe('refused');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(buildDocument).not.toHaveBeenCalled();
  });

  it('once the level is chosen at Moderate, it sends as before', async () => {
    await install({ mode: 'teen', levelChosen: true });
    _setDonationRecipientsForTesting([RECIPIENT]);
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK' }) as Response);
    const buildDocument = vi.fn(async () => '<html></html>');
    await donateExport([record], filter, 'en', { fetch: fetchSpy, buildDocument });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
