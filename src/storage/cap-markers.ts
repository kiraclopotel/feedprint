// Storage keys for the proxy-cap latches, in one place so license.ts can
// clear them without importing the AI clients (which import license.ts).
//
// Both markers are bound to the licence that hit the cap: a trial key that
// capped on day 10 must not keep a freshly pasted paid key off text AI until
// the month rolls (STORAGE-LICENCE-WORKER-1). setLicense and clearLicense
// remove both; the text latch also carries the licence fingerprint and the
// client compares it on every call.

/** Issues-tab marker. Value: { cap: 'daily'|'monthly', periodKey, licenseFingerprint? } (UTC keys). */
export const TEXT_CAP_STORAGE_KEY = 'textCapReached';

// There was a second marker here, for the media AI that watched and listened to video. Nothing
// writes it any more: that path is not in the product and the proxy has no media route (checked
// 2026-09-16, PLAN-2026-09-16 item 6.4). Its key is still cleared on a licence change, as a
// literal in license.ts, so an install that latched it years ago is not left latched.

/**
 * Non-secret identity of a licence for marker binding: the tier plus the
 * last four characters of the secret. Stored beside the full key in the same
 * storage area, so it reveals nothing the area does not already hold.
 */
export function licenseFingerprint(tier: string, secret: string): string {
  return `${tier}:${secret.slice(-4)}`;
}
