// The interface says "the AI provider", never a company, because the company behind the proxy can
// change without a new build. Key names such as opsGroqCalls are code, not copy, and are not checked.

import { describe, expect, it } from 'vitest';
import { UI_LANGUAGES } from '../../../../src/i18n';
import { DASHBOARD_STRINGS } from '../../../../src/i18n/dashboard-strings';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { MARKER_STRINGS } from '../../../../src/i18n/marker-strings';

const PROVIDER_NAME = /groq|deep\s?infra|workers[\s-]ai/i;

/** Every string value in a table, with its path; a function contributes its template text. */
function values(node: unknown, path: string, out: Array<[string, string]>): Array<[string, string]> {
  if (typeof node === 'string') out.push([path, node]);
  else if (typeof node === 'function') out.push([path, String(node)]);
  else if (node && typeof node === 'object') {
    for (const [key, child] of Object.entries(node)) values(child, `${path}.${key}`, out);
  }
  return out;
}

describe('the interface names no AI provider', () => {
  const tables = { dashboard: DASHBOARD_STRINGS, popup: POPUP_STRINGS, markers: MARKER_STRINGS };
  for (const [name, table] of Object.entries(tables)) {
    for (const lang of UI_LANGUAGES) {
      it(`${name}, ${lang}`, () => {
        const found = values(table[lang], lang, []).filter(([, text]) => PROVIDER_NAME.test(text));
        expect(found.map(([path, text]) => `${path}: ${text}`)).toEqual([]);
      });
    }
  }

  it('the check reads nested tables and function templates, where the provider name sat', () => {
    const en = values(DASHBOARD_STRINGS.en, 'en', []).map(([path]) => path);
    expect(en).toContain('en.opsStageHelp.combined_call');
    expect(en).toContain('en.opsLlmFailures');
  });
});
