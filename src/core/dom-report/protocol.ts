// The two sentences a popup and a page say to each other about a page report (11 Oct 2026).
//
// The popup cannot read the page, so it asks the content script, which builds the report on the page (nothing leaves
// the page unbuilt) and answers with the text. Both products speak it; neither needs a permission beyond the ones they
// hold, because a message to a content script in a tab is not a tabs permission.

import type { ReportProblem } from './report';

export const DOM_REPORT_REQUEST = 'fw-dom-report';

export interface DomReportRequest {
  type: typeof DOM_REPORT_REQUEST;
  problem: ReportProblem;
}

export type DomReportRefusal = 'not-a-site' | 'private-surface' | 'not-clean';

export type DomReportAnswer = { ok: true; text: string } | { ok: false; reason: DomReportRefusal };

export function isDomReportRequest(value: unknown): value is DomReportRequest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.type === DOM_REPORT_REQUEST && (v.problem === 'hid-too-much' || v.problem === 'did-not-hide' || v.problem === 'other');
}
