import * as React from 'react';
import { useDashboardT, useUiLanguage } from '../../../i18n/react';
import { COVER_SITE_NAMES } from '../../../i18n/cover-strings';
import type { Platform } from '../../../types/post';
import { formatDateLocal, formatDateTimeLocal, formatTimeLocal } from '../../shared/format-time';
import { readGapMarkerLine } from '../gap-marker-line';

/**
 * A gap marker said as a sentence in the reader's clock. Its signed line is what a person sends when asking for help,
 * so it stays one click away behind Copy diagnostics; printed on the card it read as a fault.
 */
export function GapMarkerSentence({ text }: { text: string }) {
  const t = useDashboardT();
  const lang = useUiLanguage();
  const [copied, setCopied] = React.useState(false);
  const line = readGapMarkerLine(text);
  // A formatter prints a time it cannot read as it stands, so an unreadable time leaves the sentence without one.
  const readable = line !== null && Number.isFinite(Date.parse(line.fromISO)) && Number.isFinite(Date.parse(line.toISO));
  const sameDay = readable && formatDateLocal(line.fromISO, lang) === formatDateLocal(line.toISO, lang);
  const clock = (iso: string) => (!readable ? null : sameDay ? formatTimeLocal(iso, lang) : formatDateTimeLocal(iso, lang));
  // A line that does not read back still gets a sentence; the card's heading already carries the label.
  const sentence = t.feedGapSentence({
    reason: line?.reason ?? '',
    count: line?.count ?? 0,
    from: line ? clock(line.fromISO) : null,
    to: line ? clock(line.toISO) : null,
    site: line ? COVER_SITE_NAMES[line.platform as Platform] ?? null : null,
  });
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false));
  };
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 }}>
      <span data-testid="gap-sentence">{sentence}</span>
      <button type="button" className="btn ghost" style={{ fontSize: 12, padding: '2px 8px', minHeight: 24 }} onClick={copy} data-testid="gap-copy">
        {copied ? t.feedGapCopied : t.opsCopyDiagnostics}
      </button>
    </span>
  );
}
