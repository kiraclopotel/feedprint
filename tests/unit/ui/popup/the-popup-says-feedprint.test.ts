// Receipts is called Feedprint from the 2.5.18 release (his word, 9 Oct). The popup, the extension's own name in
// Chrome (the manifest and its four locale files), the toolbar title, the wordmark, the on-page picker and the checker
// say Feedprint and never the old name. The extension keeps its ID, its users and its reviews; only the words change.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { repoPath } from '../../../helpers/repo-root';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';

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
const file = (p: string): string => readFileSync(repoPath(p), 'utf8');

describe.each(UI_LANGUAGES)('%s: the popup says Feedprint', (lang) => {
  const text = allText(POPUP_STRINGS[lang]);
  it('never says the old product name', () => {
    expect(text.filter((s) => /\bReceipts\b/.test(s))).toEqual([]);
  });
  it('names the product where it names itself (the day\'s figure, the setup, the mails)', () => {
    expect(text.filter((s) => s.includes('Feedprint')).length).toBeGreaterThanOrEqual(8);
  });
});

describe('Chrome shows the name Feedprint', () => {
  const manifest = JSON.parse(file('manifest.json')) as { name: string; short_name?: string; action?: { default_title?: string } };
  it.each(['en', 'es', 'pt_BR', 'ro'])('%s: the name, the short name and the toolbar title', (loc) => {
    const messages = JSON.parse(file(`_locales/${loc}/messages.json`)) as Record<string, { message: string }>;
    const key = (ref: string | undefined) => /^__MSG_(\w+)__$/.exec(ref ?? '')?.[1] ?? '';
    const name = messages[key(manifest.name)]?.message ?? '';
    const shortName = messages[key(manifest.short_name)]?.message ?? '';
    const title = messages[key(manifest.action?.default_title)]?.message ?? '';
    expect(name.startsWith('Feedprint - ')).toBe(true);
    expect(name.length).toBeLessThanOrEqual(75);
    expect(shortName).toBe('Feedprint');
    expect(title.startsWith('Feedprint ')).toBe(true);
    for (const s of [name, shortName, title]) expect(s).not.toMatch(/\bReceipts\b/);
  });

  it('the popup tab, its wordmark and the on-page picker say Feedprint', () => {
    expect(file('src/ui/popup/index.html')).toContain('<title>Feedprint</title>');
    const brand = file('src/ui/shared/brand.tsx');
    expect(brand).toContain('aria-label="Feedprint by FeelingWise"');
    expect(brand).not.toMatch(/>\s*Receipts\s*</);
    expect(file('src/content/engagement/picker.ts')).toContain("(isOffProduct() ? 'Off' : 'Feedprint')");
  });

  it('the checker names a Feedprint export', () => {
    expect(file('verifier/index.html')).not.toMatch(/\bReceipts export\b/);
    expect(file('verifier/README.md').split('\n')[0]).toBe('# verify-export: a checker for Feedprint exports');
  });
});
