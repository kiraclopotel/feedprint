// Sending a "this broke" report to us (11 Oct 2026). Feedprint's popup only: Off has no network and its build is checked to hold
// no address of ours, so this file is never imported from anything Off ships.
//
// One plain POST of the text the person has just seen: no key, no cookie, no referrer, nothing stored by the browser. The relay
// checks the body against the same closed grammar and refuses anything that is not a structure-only report (worker/src/report-intake.ts).

import type { SendResult } from './DescribePage';

export const DOM_REPORT_URL = 'https://api.feelingwise.org/v1/dom-report';

export async function sendDomReport(text: string, fetchImpl: typeof fetch = fetch): Promise<SendResult> {
  try {
    const response = await fetchImpl(DOM_REPORT_URL, {
      method: 'POST',
      body: text,
      headers: { 'content-type': 'text/plain' },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
    if (response.status === 204) return 'sent';
    if (response.status === 429) return 'slow';
    return 'failed';
  } catch {
    return 'failed';
  }
}
