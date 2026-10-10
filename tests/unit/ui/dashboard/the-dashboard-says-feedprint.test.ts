// The dashboard names the product it belongs to, Feedprint, in every language. "FeelingWise" is the maker's name and
// stays only where it means the maker or a real name on disk: the maker's servers, and the backup folder the
// extension writes ("FeelingWise/feelingwise-latest.json"), which a person finds in Downloads under that name.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { repoPath } from '../../../helpers/repo-root';
import { DASHBOARD_STRINGS } from '../../../../src/i18n/dashboard-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';
import { PRODUCT_NAME } from '../../../../src/ui/dashboard/dashboard-words';

function allText(table: object): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.push(v);
    else if (typeof v === 'function') out.push(String(v));
    else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
  };
  walk(table);
  return out;
}

// The maker and the folder, in the four languages' own phrasing.
const MAKER_OR_FOLDER = /FeelingWise\/feelingwise-latest|FeelingWise downloads folder|descărcări FeelingWise|descargas de FeelingWise|downloads do FeelingWise|no FeelingWise server|(niciun|ningún|nenhum) (server|servidor) (de |da )?FeelingWise/g;

describe.each(UI_LANGUAGES)('%s: the dashboard says Feedprint', (lang) => {
  const text = allText(DASHBOARD_STRINGS[lang]);

  it('never says the old product name', () => {
    expect(text.filter((s) => /\bReceipts\b/.test(s))).toEqual([]);
  });

  it('says FeelingWise only for the maker or the folder on disk', () => {
    expect(text.filter((s) => s.replace(MAKER_OR_FOLDER, '').includes('FeelingWise'))).toEqual([]);
  });

  it('names the product in the record\'s own sentences', () => {
    expect(text.some((s) => s.includes(PRODUCT_NAME))).toBe(true);
  });
});

describe('the browser tab says Feedprint', () => {
  it('the record page is titled with the product name, never the old one', () => {
    const html = readFileSync(repoPath('src/ui/dashboard/index.html'), 'utf8');
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
    expect(title).toContain(PRODUCT_NAME);
    expect(title).not.toMatch(/\bReceipts\b/);
  });
});
