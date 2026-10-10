// The one place a record is hashed before it is stored.
//
// Every writer (the six logger paths, the manual flag and the nine marker kinds)
// builds its partial record, stamps its signer fingerprint, and hands it here.
// What the extension states about itself (`stamp`) is added in this one place,
// so a new statement reaches every record kind at once and no writer can forget it.

import type { ForensicRecord, InstallType, RecordStamp } from '../types/forensic';
import { getBuildId } from '../core/build-id';
import { computeRecordIntegrityHash } from './canonical-payload';

type Unhashed = Omit<ForensicRecord, 'integrityHash' | 'signature'>;

// Chrome's own words. A value outside them is a browser newer than this code, and a guess
// at what it means would be the extension vouching for something it cannot read.
const INSTALL_TYPES: ReadonlySet<string> = new Set<InstallType>(['normal', 'development', 'sideload', 'admin', 'other']);

// The install type cannot change while the worker lives, and asking on every record would
// put a browser call in front of every write. Only an answer is kept: a call that failed is
// asked again on the next record, so one bad moment does not leave a whole worker life unstated.
let installTypeAnswer: Promise<InstallType | undefined | null> | undefined;

/** Chrome's word, undefined for a word this code does not know, null when the browser did not answer. */
// Every record write waits on this answer under the chain lock, so a browser that never answers
// must not hold the record up: past this, the record goes out without the install type.
const INSTALL_TYPE_WAIT_MS = 2000;

async function askInstallType(): Promise<InstallType | undefined | null> {
  try {
    const self = await Promise.race([
      chrome.management.getSelf(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('no answer')), INSTALL_TYPE_WAIT_MS)),
    ]);
    return INSTALL_TYPES.has(self.installType) ? (self.installType as InstallType) : undefined;
  } catch {
    return null;
  }
}

async function installType(): Promise<InstallType | undefined> {
  if (!installTypeAnswer) {
    const asked = askInstallType();
    installTypeAnswer = asked;
    void asked.then(answer => { if (answer === null && installTypeAnswer === asked) installTypeAnswer = undefined; });
  }
  return (await installTypeAnswer) ?? undefined;
}

/**
 * What the worker that writes the record says about itself. Absent means "not stated":
 * nothing baked in, or a browser that would not say, writes no value rather than a guess.
 *
 * A record carrying `stamp` reads as tampered in any checker older than the one that hashes
 * it, so a build that writes these must not reach users before that checker is published.
 */
export async function recordStamp(): Promise<RecordStamp | undefined> {
  const stamp: RecordStamp = {};
  const recorderBuildId = getBuildId();
  if (recorderBuildId) stamp.recorderBuildId = recorderBuildId;
  const install = await installType();
  if (install) stamp.installType = install;
  return Object.keys(stamp).length > 0 ? stamp : undefined;
}

export async function finalizeRecord<T extends Unhashed>(partial: T): Promise<T & { integrityHash: string }> {
  const stamp = partial.stamp ?? await recordStamp();
  const stamped: T = stamp === undefined ? partial : { ...partial, stamp };
  const integrityHash = await computeRecordIntegrityHash(stamped);
  return { ...stamped, integrityHash };
}
