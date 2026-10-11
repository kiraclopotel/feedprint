// Which repair file is in force (11 Oct 2026).
//
// Two copies can exist on a device: the one packaged with the extension (packaged.ts, signed when the build was made)
// and the one Feedprint fetched later and stored under `fw_repairs`. Each is checked against the packaged public keys
// every time it is read, so a stored copy is trusted only as far as its signature goes, not because it sits in our own
// storage. The one with the higher version is put in force. Off has no network and no worker, so it only ever has the
// packaged copy plus whatever Feedprint's storage-sharing does not give it: nothing. Off's repairs arrive in its store
// updates, as a new packaged file.

import { parseRepairEnvelope, type RepairFile } from './format';
import { verifyRepairEnvelope } from './signed';
import { REPAIR_PUBLIC_KEYS } from './public-keys';
import { PACKAGED_REPAIRS } from './packaged';
import { applyRepairFile } from './families';

export const REPAIRS_STORAGE_KEY = 'fw_repairs';
export const REPAIRS_STATUS_KEY = 'fw_repairs_status';

async function verifiedFile(text: unknown): Promise<RepairFile | null> {
  if (typeof text !== 'string') return null;
  const envelope = parseRepairEnvelope(text);
  return envelope ? verifyRepairEnvelope(envelope, REPAIR_PUBLIC_KEYS) : null;
}

async function storedEnvelopeText(): Promise<string | undefined> {
  if (typeof chrome === 'undefined' || !chrome?.storage?.local) return undefined;
  try {
    const stored = await chrome.storage.local.get([REPAIRS_STORAGE_KEY]);
    const value = stored[REPAIRS_STORAGE_KEY];
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Put the best verified repair file in force and return its version, 0 when there is none. Never throws. */
export async function loadRepairs(): Promise<number> {
  try {
    const [packaged, stored] = await Promise.all([verifiedFile(PACKAGED_REPAIRS), storedEnvelopeText().then(verifiedFile)]);
    const best = stored && (!packaged || stored.version > packaged.version) ? stored : packaged;
    applyRepairFile(null);
    if (best) applyRepairFile(best);
    return best?.version ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Store a fetched envelope when it verifies and is newer than what the device already has (packaged or stored).
 * 'stored': kept, 'older': valid but not newer, 'invalid': not a repair file we signed. Never throws.
 */
export async function acceptFetchedRepairs(text: string): Promise<'stored' | 'older' | 'invalid'> {
  try {
    const incoming = await verifiedFile(text);
    if (!incoming) return 'invalid';
    const [packaged, stored] = await Promise.all([verifiedFile(PACKAGED_REPAIRS), storedEnvelopeText().then(verifiedFile)]);
    const have = Math.max(packaged?.version ?? 0, stored?.version ?? 0);
    if (incoming.version <= have) return 'older';
    if (typeof chrome === 'undefined' || !chrome?.storage?.local) return 'invalid';
    await chrome.storage.local.set({ [REPAIRS_STORAGE_KEY]: text });
    return 'stored';
  } catch {
    return 'invalid';
  }
}
