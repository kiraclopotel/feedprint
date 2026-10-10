// "Write to the maker" (8 Oct 2026): a prefilled email from Receipts' Home, the head's answer to the in-app chat idea
// (its cold debate, 8 Oct 2026: build the mail first, count what it brings). It carries three facts and nothing else:
// the install's record key (the short fingerprint every export prints, so two messages from one install can be told
// apart), the version, and the record backup's last failure. Never the licence key, the site or the switches. Nothing
// leaves until the person sends the email from their own mail program.

import type { PopupStrings } from '../../i18n/popup/types';
import { REPORT_ADDRESS } from './report-link';

export interface MakerFacts {
  /** The record key's short fingerprint; null when it could not be read. */
  keyId: string | null;
  version: string;
  lastError: string | null;
}

/** The longest error line the mail carries; the rest of a long message is left out. */
const ERROR_MAX = 160;

/** The backup's last failure, when the last backup failed; nothing once a later one went well. */
export function makerLastError(health: { lastStatus?: string; lastError?: string } | undefined): string | null {
  if (!health || health.lastStatus !== 'error' || !health.lastError) return null;
  return health.lastError;
}

export function makerMailto(facts: MakerFacts, t: PopupStrings): string {
  const error = facts.lastError ? facts.lastError.split('\n')[0].slice(0, ERROR_MAX) : t.offReportNone;
  const lines = [
    t.makerAsk,
    '',
    '',
    '',
    `${t.makerKey}: ${facts.keyId ?? t.makerKeyUnread}`,
    `${t.receiptsReportVersion}: ${facts.version}`,
    `${t.makerLastError}: ${error}`,
  ];
  return `mailto:${REPORT_ADDRESS}?subject=${encodeURIComponent(t.makerSubject)}&body=${encodeURIComponent(lines.join('\n'))}`;
}

/** The record key's fingerprint from the service worker, which holds the key; null when it does not answer. */
export async function readRecordKeyId(): Promise<string | null> {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_SIGNING_METADATA' }) as
      { ok?: boolean; metadata?: { fingerprint?: string } } | undefined;
    const fp = res?.ok ? res.metadata?.fingerprint : undefined;
    return typeof fp === 'string' && /^[0-9a-f]{16}$/.test(fp) ? fp : null;
  } catch {
    return null;
  }
}

/** The backup health the record keeps (src/forensics/backup.ts, fw_backup_health), read without loading that module. */
export async function readLastError(): Promise<string | null> {
  try {
    const stored = await chrome.storage.local.get('fw_backup_health');
    return makerLastError(stored.fw_backup_health as { lastStatus?: string; lastError?: string } | undefined);
  } catch {
    return null;
  }
}
