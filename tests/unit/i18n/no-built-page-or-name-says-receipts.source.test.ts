// Receipts is called Feedprint. A tab, a window or Chrome's extensions list takes its words from three places only:
// the <title> of each page the build copies, the extension's name in each language, and the manifest that points at
// them. None of them may say the old name, or a tab reads "Receipts" on a build that says Feedprint everywhere else.

import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { readSource } from '../../helpers/read-source';
import { repoPath } from '../../helpers/repo-root';

const OLD = /Receipts|Social Media Archive and Feed Record/;

const PAGES = ['src/ui/dashboard/index.html', 'src/ui/popup/index.html'];
const LOCALES = readdirSync(repoPath('_locales')).map((l) => `_locales/${l}/messages.json`);

describe('no built page or extension name says the old name', () => {
  it.each(PAGES)('%s has a title, and it says Feedprint', (path) => {
    // A page is a few lines of markup, so the floor is the size of its head line, not of a source module.
    const title = /<title>([^<]*)<\/title>/.exec(readSource(path, { minBytes: 60 }))?.[1];
    expect(title).toMatch(/^Feedprint/);
    expect(title).not.toMatch(OLD);
  });

  it.each(LOCALES)('%s names the product Feedprint and never the old name', (path) => {
    const messages = JSON.parse(readSource(path)) as Record<string, { message: string }>;
    expect(messages.receiptsName.message).toMatch(/^Feedprint/);
    expect(messages.receiptsShortName.message).toBe('Feedprint');
    const old = Object.entries(messages).filter(([, m]) => OLD.test(m.message)).map(([k]) => k);
    expect(old).toEqual([]);
  });

  it('the manifest takes its name from those strings', () => {
    const manifest = JSON.parse(readSource('manifest.json')) as { name: string; short_name: string; action?: { default_title?: string } };
    expect(manifest.name).toBe('__MSG_receiptsName__');
    expect(manifest.short_name).toBe('__MSG_receiptsShortName__');
    expect(manifest.action?.default_title ?? '').not.toMatch(OLD);
  });
});
