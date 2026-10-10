// The product asks for no permission it does not use.
//
// A person reading the install dialog is told what the extension may do, and that dialog is the
// only place most of them will ever read it. The promise behind it is a never-event: no permission
// in either manifest that nothing in the code uses, and no host pattern wider than the sites the
// code actually touches.
//
// This test is a list, not a search. It cannot tell whether a permission is used, so it pins the
// exact sets and names the use site for each, which means a new permission cannot arrive quietly:
// it arrives as a failing test, and the only way to make it pass is to write down where it is used.
// That is the moment the store listing's data-use answers and the privacy page get reconsidered,
// which is the thing that would otherwise be forgotten.
//
// The use sites below were each read on 2026-09-18.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT as ROOT } from '../helpers/repo-root';

type Manifest = { permissions?: string[]; host_permissions?: string[]; background?: unknown };

const read = (name: string): Manifest => JSON.parse(readFileSync(join(ROOT, name), 'utf8')) as Manifest;

/** Every permission the recorder asks for, and the file that uses it. */
const RECEIPTS_PERMISSIONS: Record<string, string> = {
  storage: 'settings and the licence, throughout',
  unlimitedStorage: 'src/forensics/store.ts, the record can pass the default quota',
  alarms: 'src/background/service-worker.ts, the time stamp round',
  downloads: 'src/forensics/backup.ts, writing a backup and an export to disk',
  'downloads.ui': 'src/forensics/backup.ts, hiding the download shelf so a daily backup is quiet',
};

/**
 * Every address the recorder may reach, and why.
 *
 * The six social patterns are `*://*.<site>/*`: any subdomain, and either http or https. That is
 * wider than the code strictly needs, which only ever builds https links back to a post, and it is
 * written down here rather than quietly narrowed, because the content script list uses the same
 * patterns and a mismatch between the two would stop the recorder from loading on a page a person
 * is looking at. Narrowing them is a change to both lists at once, measured in the walk.
 */
const RECEIPTS_HOSTS: Record<string, string> = {
  '*://*.twitter.com/*': 'a surface it records',
  '*://*.x.com/*': 'a surface it records',
  '*://*.instagram.com/*': 'a surface it records',
  '*://*.tiktok.com/*': 'a surface it records',
  '*://*.facebook.com/*': 'a surface it records',
  '*://*.youtube.com/*': 'a surface it records',
  'https://api.feelingwise.org/*': 'src/ai/client.ts, the reading proxy, and the time stamp fallback',
  'https://freetsa.org/*': 'src/forensics/tsa-client.ts, a time stamp authority',
  // 'https://tsa.cesnet.cz/*' was here until 2026-09-23. The client no longer asks CESNET, whose
  // service is meant for research and education institutions, so the permission went with it.
  'http://timestamp.digicert.com/*': 'src/forensics/tsa-client.ts, a time stamp authority. Plain http on purpose: the token carries its own signature and is checked against a pinned certificate, so the transport does not decide anything. A store reviewer may still ask.',
  'http://timestamp.sectigo.com/*': 'src/forensics/tsa-client.ts, a time stamp authority, the same reasoning',
};

/** Off asks for one permission. The absence is the product. */
const OFF_PERMISSIONS: Record<string, string> = {
  storage: "the person's own settings, and nothing else",
};

/** Off reaches the six sites it filters, and holds no address of ours at all. */
const OFF_HOSTS = Object.keys(RECEIPTS_HOSTS).filter((h) => h.startsWith('*://'));

describe('the product asks for no permission it does not use', () => {
  it('the recorder asks for exactly these permissions, each with a use named here', () => {
    expect(read('manifest.json').permissions?.sort()).toEqual(Object.keys(RECEIPTS_PERMISSIONS).sort());
  });

  it('the recorder may reach exactly these addresses, each with a reason named here', () => {
    expect(read('manifest.json').host_permissions?.sort()).toEqual(Object.keys(RECEIPTS_HOSTS).sort());
  });

  it('Off asks for storage and nothing else', () => {
    expect(read('manifest.off.json').permissions?.sort()).toEqual(Object.keys(OFF_PERMISSIONS).sort());
  });

  it('Off may reach the six sites it filters and nothing else, and ships no worker', () => {
    expect(read('manifest.off.json').host_permissions?.sort()).toEqual(OFF_HOSTS.sort());
    expect(read('manifest.off.json').background).toBeUndefined();
  });
});
