// The page's side of a page report (11 Oct 2026): answer the popup's request with the report, and answer nobody else.

import { isDomReportRequest } from '../../core/dom-report/protocol';
import type { ReportProduct } from '../../core/dom-report/report';
import { collectDomReport } from './collect';

/**
 * Answer a request from this extension's own popup. A message from anywhere else, or a request that does not match the
 * shape exactly, gets no answer. The report is built on the request and not before, so a page nobody reports on pays nothing.
 */
export function installDomReportListener(product: ReportProduct): void {
  if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage?.addListener) return;
  chrome.runtime.onMessage.addListener((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (answer: unknown) => void) => {
    if (sender?.id !== chrome.runtime.id || !isDomReportRequest(message)) return false;
    void collectDomReport({ product, problem: message.problem })
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, reason: 'not-clean' }));
    return true;
  });
}
