// FeelingWise - export donation to a named recipient organisation.
//
// The one honest shape of "collect users' records" (docs/history/2026-09/DIRECTION-2026-09-06.md,
// section 2a): the user presses a button that sends their own export, from their
// own computer, straight to an organisation that has agreed in writing to
// receive it and is the data controller for what it holds. FeelingWise is the
// instrument; it never sees, relays or keeps a copy. Every earlier attempt to
// see what feeds serve people collected centrally and was switched off at the
// centre; a record that goes user to recipient has no centre to switch off.
//
// The roster below SHIPS EMPTY. With no recipient there is no card on the
// Export tab, no network call and no string a user can read. The commit that
// names a recipient fills DONATION_RECIPIENTS, adds the recipient's origin to
// manifest.json host_permissions (an extension page's fetch to a foreign origin
// needs either that or the recipient's CORS consent), and links the
// recipient's own data notice, in that order, in one commit. Nothing here is
// read from settings or from the network: what a build can send to is fixed at
// build time and readable in the source. The other end is verifier/receive-export.mjs,
// a reference receiver an organisation runs behind its own TLS: one POST, the
// checker run over the file, a receipt back (tests/unit/forensics/receive-export.test.ts).

import { getSettings } from '../storage/settings';
import { makesNoOutsideCall } from '../types/mode';
import type { ForensicRecord } from '../types/forensic';
import { buildHtmlExportDocument, type ExportFilterResult } from './exporter';
import type { ExportLocale } from './html-export';

export interface DonationRecipient {
  /** Stable id, used in the receipt line and in tests. */
  id: string;
  /** The organisation's name as it appears on the button. Never translated. */
  name: string;
  /** HTTPS endpoint that accepts a POST whose body is the HTML export. */
  endpoint: string;
  /** The recipient's own data notice: what they keep, for how long, under which law. */
  noticeUrl: string;
}

/** Empty on purpose. See the header. */
export const DONATION_RECIPIENTS: readonly DonationRecipient[] = [];

let overrideForTesting: readonly DonationRecipient[] | null = null;

/** The recipient a build can send to, or null when the roster is empty. */
export function activeDonationRecipient(): DonationRecipient | null {
  const roster = overrideForTesting ?? DONATION_RECIPIENTS;
  return roster[0] ?? null;
}

export function _setDonationRecipientsForTesting(roster: readonly DonationRecipient[] | null): void {
  overrideForTesting = roster;
}

export type DonationOutcome =
  | { kind: 'sent'; recipientId: string; bytes: number; records: number; receipt: string | null }
  | { kind: 'refused'; reason: 'strict' | 'no-recipient' | 'insecure-endpoint' | 'nothing-to-send' }
  | { kind: 'failed'; status: number | null; detail: string };

export interface DonationDeps {
  fetch?: typeof fetch;
  buildDocument?: typeof buildHtmlExportDocument;
}

/**
 * Build the standalone HTML export and POST it to the recipient. The body is
 * the export file itself, unchanged, so the recipient can run its embedded
 * checker exactly as a person would. No identifier of the sender is added:
 * the export already states which public key signed it and nothing else.
 * A receipt is whatever the recipient answers with in an `X-Receipt` header
 * or a plain-text body; it is shown, never stored.
 */
export async function donateExport(
  records: ForensicRecord[],
  filter: ExportFilterResult,
  locale: ExportLocale,
  deps: DonationDeps = {},
): Promise<DonationOutcome> {
  // The level is asked first: at Strict, and before a level is chosen, nothing leaves this computer, whatever the roster holds.
  // A settings read that fails reads as Strict (getSettings fails closed), as it does for the time-stamp client (tsa-client.ts):
  // not knowing the level is no reason to send a file out.
  const settings = await getSettings();
  if (makesNoOutsideCall(settings)) return { kind: 'refused', reason: 'strict' };
  const recipient = activeDonationRecipient();
  if (!recipient) return { kind: 'refused', reason: 'no-recipient' };
  if (!/^https:\/\//.test(recipient.endpoint)) return { kind: 'refused', reason: 'insecure-endpoint' };
  if (filter.included.length === 0) return { kind: 'refused', reason: 'nothing-to-send' };

  const build = deps.buildDocument ?? buildHtmlExportDocument;
  const html = await build(records, filter, locale);
  const doFetch = deps.fetch ?? fetch;
  try {
    const response = await doFetch(recipient.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: html,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    if (!response.ok) {
      return { kind: 'failed', status: response.status, detail: response.statusText || `HTTP ${response.status}` };
    }
    const headerReceipt = response.headers.get('X-Receipt');
    const bodyReceipt = headerReceipt ? null : (await response.text().catch(() => '')).trim().slice(0, 200);
    return {
      kind: 'sent',
      recipientId: recipient.id,
      bytes: new TextEncoder().encode(html).byteLength,
      records: filter.included.length,
      receipt: headerReceipt ?? (bodyReceipt || null),
    };
  } catch (err) {
    return { kind: 'failed', status: null, detail: err instanceof Error ? err.message : String(err) };
  }
}
