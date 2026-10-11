// Reads one segment of a consent string as the standard lays it out: base64url characters, six
// bits each, read left to right, every field big-endian.
//
// A read past the end does not return a guess. It throws a TcReadStop that names the field, and
// decode.ts turns that into a value; nothing outside this folder ever sees the throw.

import type { IdSet, IdSpan, TcDecodeErrorCode, TcSegmentName } from './types';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const SIXBIT: ReadonlyMap<string, number> = new Map([...ALPHABET].map((c, i) => [c, i]));

/** Thrown inside the decoder only; decode.ts catches it and returns it as an error value. */
export class TcReadStop extends Error {
  constructor(
    readonly code: TcDecodeErrorCode,
    readonly segment: TcSegmentName | null,
    readonly field: string | null,
    readonly offset: number,
  ) {
    super(`${code} at ${segment ?? '-'}.${field ?? '-'} bit ${offset}`);
  }
}

/** The six-bit values of one segment's characters. `start` is the segment's offset in the whole string. */
export function sixBitValues(segmentText: string, start: number): number[] {
  // Trailing '=' is base64 padding. The standard names no padding rule ("URL-safe base64"); padding
  // carries no bits, so it is dropped rather than refused. Cut by a loop, not a regular expression:
  // /=+$/ backtracks quadratically over a long run of '=' that does not reach the end.
  let end = segmentText.length;
  while (end > 0 && segmentText[end - 1] === '=') end--;
  const values: number[] = [];
  for (let i = 0; i < end; i++) {
    const v = SIXBIT.get(segmentText[i]);
    if (v === undefined) throw new TcReadStop('bad-character', null, null, start + i);
    values.push(v);
  }
  return values;
}

/** Spans sorted and merged where they overlap or touch, so each id is covered once. */
export function mergeSpans(spans: readonly IdSpan[]): IdSpan[] {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/**
 * The ids a set of spans names, ascending, each once. Spans are merged before they are expanded, so
 * the work is bounded by the 65,535 ids a 16-bit id can name, however many overlapping ranges a string
 * repeats: 4,095 copies of 1 to 65,535 would otherwise be 268 million steps in the person's browser.
 */
function expandSpans(spans: readonly IdSpan[]): number[] {
  const ids: number[] = [];
  for (const [start, end] of mergeSpans(spans)) for (let id = start; id <= end; id++) ids.push(id);
  return ids;
}

export class BitReader {
  private pos = 0;
  readonly length: number;

  constructor(
    private readonly values: readonly number[],
    private readonly segment: TcSegmentName,
  ) {
    this.length = values.length * 6;
  }

  get offset(): number {
    return this.pos;
  }

  private bit(): number {
    const v = this.values[Math.floor(this.pos / 6)];
    const b = (v >> (5 - (this.pos % 6))) & 1;
    this.pos++;
    return b;
  }

  private need(bits: number, field: string): void {
    if (this.pos + bits > this.length) throw new TcReadStop('truncated', this.segment, field, this.pos);
  }

  /** An unsigned integer of `bits` bits (at most 52, so it stays exact as a number). */
  int(bits: number, field: string): number {
    this.need(bits, field);
    let n = 0;
    // Multiplication, not shifts: a 36-bit timestamp does not fit the 32 bits a shift works in.
    for (let i = 0; i < bits; i++) n = n * 2 + this.bit();
    return n;
  }

  bool(field: string): boolean {
    return this.int(1, field) === 1;
  }

  /** A fixed-width bit field where bit 0 is id 1: the ids whose bit is set, ascending. */
  flags(bits: number, field: string): number[] {
    this.need(bits, field);
    const ids: number[] = [];
    for (let id = 1; id <= bits; id++) if (this.bit() === 1) ids.push(id);
    return ids;
  }

  /** Two letters of six bits each, a = 0 to z = 25. */
  letters(field: string): string {
    const at = this.pos;
    const a = this.int(6, field);
    const b = this.int(6, field);
    if (a > 25 || b > 25) throw new TcReadStop('bad-letter', this.segment, field, at);
    return String.fromCharCode(97 + a, 97 + b);
  }

  /**
   * NumEntries (12 bits) range entries: IsARange (1), StartOrOnlyId (16), and EndId (16) when it is a
   * range. `maxId`, when given, bounds every id; a restriction's ranges have no declared maximum.
   */
  rangeSpans(field: string, maxId?: number): IdSpan[] {
    const count = this.int(12, `${field}.NumEntries`);
    const spans: IdSpan[] = [];
    for (let e = 0; e < count; e++) {
      const isRange = this.bool(`${field}.IsARange`);
      const startAt = this.pos;
      const start = this.int(16, `${field}.StartOrOnlyVendorId`);
      const end = isRange ? this.int(16, `${field}.EndVendorId`) : start;
      if (end < start) throw new TcReadStop('bad-range', this.segment, field, startAt);
      if (start === 0 || (maxId !== undefined && end > maxId)) {
        throw new TcReadStop('id-out-of-range', this.segment, field, startAt);
      }
      spans.push([start, end]);
    }
    return spans;
  }

  /** A vendor section: MaxVendorId (16), IsRangeEncoding (1), then a bit field or range entries. */
  vendorSection(field: string): IdSet {
    const maxId = this.int(16, `${field}.MaxVendorId`);
    const isRange = this.bool(`${field}.IsRangeEncoding`);
    const ids = isRange ? expandSpans(this.rangeSpans(field, maxId)) : this.flags(maxId, `${field}.BitField`);
    return { maxId, ids };
  }

  /** True when any bit from here to the end is 1. */
  anyBitLeft(): boolean {
    while (this.pos < this.length) if (this.bit() === 1) return true;
    return false;
  }
}
