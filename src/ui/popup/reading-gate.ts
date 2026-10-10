// Whether this install's key turns the AI reading on: the one question every AI word in the popup asks first, so a free
// install shows none (the Subscription seat's outcome, 9 Oct 2026: "a free install shows no AI button").
// Today a paid key is the answer, the same test the AI client makes before it reads. The signed list of what a key
// turns on is merged (src/storage/license-entitlements.ts, hasFeature), but its public key is still null, so it answers
// no for every key; readingOn moves to hasFeature(<the reading's feature name>) in one line on the day the AI client
// asks it too, and nothing else in the popup changes.

import { useEffect, useState } from 'react';
import type { LicenseInfo } from '../../storage/license';

/** What the popup knows at once, before any stored answer is read. */
export function readingOnNow(license: LicenseInfo): boolean {
  return license.tier !== 'free';
}

/** Whether the key turns the AI reading on. Asynchronous, so the signed answer can replace the guess without a caller changing. */
export async function readingOn(license: LicenseInfo): Promise<boolean> {
  return readingOnNow(license);
}

/** The gate for a screen: the immediate guess first, then the answer. */
export function useReadingOn(license: LicenseInfo): boolean {
  const [on, setOn] = useState(() => readingOnNow(license));
  useEffect(() => {
    let live = true;
    void readingOn(license).then((v) => { if (live) setOn(v); });
    return () => { live = false; };
  }, [license]);
  return on;
}
