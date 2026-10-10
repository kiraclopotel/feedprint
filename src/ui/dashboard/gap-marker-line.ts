// A gap marker's signed line ("[gap-marker @ T] reason=... platform=... count=... unit=... from=... to=...", written by
// gapMarkerText in forensics/gap-marker.ts) read back into its parts, so the timeline can say it in a sentence and keep
// the line itself for Copy diagnostics. Markers written before from= and to= existed fall back to the marker's own time.

export interface GapMarkerLine {
  reason: string;
  platform: string;
  count: number;
  fromISO: string;
  toISO: string;
}

const HEAD = /^\[gap-marker @ ([^\]]+)\]/;

export function readGapMarkerLine(text: string): GapMarkerLine | null {
  const head = HEAD.exec(text);
  if (!head) return null;
  const field = (name: string): string | undefined => new RegExp(`(?:^|\\s)${name}=(\\S+)`).exec(text)?.[1];
  const reason = field('reason');
  if (!reason) return null;
  const at = head[1];
  const count = Number(field('count'));
  return {
    reason,
    platform: field('platform') ?? 'unknown',
    count: Number.isFinite(count) ? count : 0,
    fromISO: field('from') ?? at,
    toISO: field('to') ?? at,
  };
}
