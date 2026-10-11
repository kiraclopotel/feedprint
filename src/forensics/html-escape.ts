// FeelingWise - the one HTML escaper for text that goes into an export page or a report.

/** Absent is ''. A withheld record has no text, author or address (redaction.ts removes them on the copy that leaves). */
export function escapeHtml(value: string | undefined): string {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
