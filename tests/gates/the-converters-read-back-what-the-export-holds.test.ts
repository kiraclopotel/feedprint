// verifier/to-csv.mjs and verifier/to-4cat.mjs turn an export, or a pool of several, into a table. The promise is
// that the table read back holds what the signed file holds, row for row and character for character, so a group's
// numbers can be traced to signed records. Both run here on the published vector whose text is not plain ASCII,
// because quotes, commas, line breaks and marked letters are where a table quietly changes a text. The public copy
// carries the vectors but not the site's example export; tests/private/site runs the same tools on that one.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error - the shipped tools are plain JavaScript with no types
import { poolFrom, rowsOf, toCsv, COLUMNS } from '../../verifier/to-csv.mjs';
// @ts-expect-error - the shipped tools are plain JavaScript with no types
import { fourcatRows, toFourcatCsv, FOURCAT_COLUMNS } from '../../verifier/to-4cat.mjs';
// @ts-expect-error - the shipped tools are plain JavaScript with no types
import { isObservation, parseExport } from '../../verifier/observations.mjs';
import { REPO_ROOT } from '../helpers/repo-root';

/** RFC 4180 read back: quoted fields may hold commas, doubled quotes and line breaks. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; } else if (c === '\r' && text[i + 1] === '\n') { /* the CR of CRLF */ } else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const VECTOR = resolve(REPO_ROOT, 'verifier/vectors/11-text-escaping.html');
let text: string;
type Record = { [k: string]: unknown; originalText: string; integrityHash: string; timestamp: string };
let served: Record[];

beforeAll(() => {
  text = readFileSync(VECTOR, 'utf8');
  served = (parseExport(text).records as Record[]).filter((r) => isObservation(r));
});

describe('the CSV of a published vector', () => {
  it('has the column names on its first line and one row per served item, text unchanged', async () => {
    const pool = await poolFrom(text, '11-text-escaping.html');
    expect(pool.refused).toEqual([]);
    const csv: string = toCsv(await rowsOf(pool));
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const [head, ...rows] = parseCsv(csv.slice(1));
    expect(head).toEqual(COLUMNS);
    expect(rows).toHaveLength(served.length);
    const textAt = head.indexOf('originalText');
    const hashAt = head.indexOf('integrityHash');
    const byHash = new Map(served.map((r) => [r.integrityHash, r.originalText]));
    // FORMAT.md section 10: a reader drops one leading apostrophe, put there so a spreadsheet does not run the text.
    for (const row of rows) expect(row[textAt].replace(/^'/, '')).toBe(byHash.get(row[hashAt]));
  });

  it('leaves the byte order mark out when asked, for scripts', async () => {
    const csv: string = toCsv(await rowsOf(await poolFrom(text, '11-text-escaping.html')), { bom: false });
    expect(csv.startsWith('recorder,')).toBe(true);
  });

  it('carries no model reading in any column', () => {
    for (const reading of ['neutralizedText', 'techniques', 'overallScore', 'verdict', 'aiModel', 'aiProvider']) {
      expect(COLUMNS).not.toContain(reading);
    }
  });
});

describe('the 4CAT file of a published vector', () => {
  it('starts with the five columns 4CAT names, one row per served item, each id unique', async () => {
    const csv: string = toFourcatCsv(await fourcatRows(await poolFrom(text, '11-text-escaping.html')));
    const [head, ...rows] = parseCsv(csv);
    expect(head.slice(0, 5)).toEqual(FOURCAT_COLUMNS);
    expect(FOURCAT_COLUMNS).toEqual(['id', 'thread_id', 'author', 'body', 'timestamp']);
    // 4CAT stores body as it is written, so the 4CAT file carries the served text with nothing in front of it.
    const byHash = new Map(served.map((r) => [r.integrityHash, r.originalText]));
    for (const row of rows) expect(row[head.indexOf('body')]).toBe(byHash.get(row[0]));
    expect(rows).toHaveLength(served.length);
    expect(new Set(rows.map((r) => r[0])).size).toBe(rows.length);
  });

  it('writes the time as UTC wall clock in the notation 4CAT recommends, and keeps the recorded time beside it', async () => {
    const rows = await fourcatRows(await poolFrom(text, '11-text-escaping.html'));
    for (const row of rows) {
      expect(row.timestamp).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
      expect(Date.parse(row.timestamp.replace(' ', 'T') + 'Z')).toBe(Math.floor(Date.parse(row.timestamp_recorded) / 1000) * 1000);
    }
  });

  it('puts a comment in the thread of the post it was recorded under, when that post is in the file', async () => {
    const records = parseExport(text).records as Record[];
    const comment = records.find((r) => typeof r.parentRecordId === 'string' && isObservation(r)
      && records.some((p) => p.id === r.parentRecordId && isObservation(p)));
    const rows = await fourcatRows(await poolFrom(text, '11-text-escaping.html'));
    if (!comment) {
      // The vector holds no comment under a recorded post; the rule is then that every row is its own thread.
      for (const row of rows) expect(row.thread_id).toBe(row.id);
      return;
    }
    const parent = records.find((p) => p.id === comment.parentRecordId)!;
    expect(rows.find((r: { id: string }) => r.id === comment.integrityHash).thread_id).toBe(parent.integrityHash);
  });
});

describe('the column lists in FORMAT.md', () => {
  // A group writes its analysis against the columns the format names, so the two headers are quoted in FORMAT.md
  // section 10 and read back here from the files the tools write: a renamed or moved column fails until both agree.
  const fenced = (): string[] => {
    const doc = readFileSync(resolve(REPO_ROOT, 'verifier/FORMAT.md'), 'utf8').replace(/\r\n/g, '\n');
    return [...doc.matchAll(/^```\n([^\n`]+)\n```$/gm)].map((m) => m[1]);
  };

  it('quotes the CSV header the tool writes, in its order', async () => {
    const csv: string = toCsv(await rowsOf(await poolFrom(text, '11-text-escaping.html')), { bom: false });
    const header = csv.split('\r\n')[0];
    expect(fenced().filter((line) => line.startsWith('recorder,'))).toEqual([header]);
  });

  it('quotes the 4CAT header the tool writes, in its order', async () => {
    const csv: string = toFourcatCsv(await fourcatRows(await poolFrom(text, '11-text-escaping.html')));
    const header = csv.split('\r\n')[0];
    expect(fenced().filter((line) => line.startsWith('id,thread_id,'))).toEqual([header]);
  });
});
