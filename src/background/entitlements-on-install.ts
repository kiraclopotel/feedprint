// What the stored key turns on is fetched when the extension is installed or updated, so a key held across an
// update, whose list may have lapsed while the install was away, is checked before its first reading instead
// of at the next popup open. A free install has nothing to fetch: the refresh only clears.

import { refreshEntitlements } from '../storage/license-entitlements';

/** `publicKey` defaults to the one the build carries; a test passes its own to run the path a shipped key takes. */
export function refreshEntitlementsOnInstall(reason: string, publicKey?: JsonWebKey | null): void {
  if (reason !== 'install' && reason !== 'update') return;
  void refreshEntitlements(publicKey).catch(() => undefined);
}
