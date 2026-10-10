/** @vitest-environment jsdom */
// At Strict nothing leaves the computer, so a license key turns nothing on there: with a key, the
// Issues tab's AI health says the reading is off at this level and that Moderate turns it on. A
// free install is told nothing about the AI reading at any level (ai-wording.ts).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { Mode } from '../../../../../src/types/mode';

let MODE: Mode = 'child';
let TIER: 'free' | 'family' = 'free';

vi.mock('../../../../../src/storage/license', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/storage/license')>();
  return { ...actual, getLicense: vi.fn(async () => ({ ...actual.FREE_LICENSE, tier: TIER })) };
});
vi.mock('../../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/storage/settings')>();
  return { ...actual, getSettings: vi.fn(async () => ({ ...(await actual.getSettings()), mode: MODE })) };
});

import { OperationalEventsPanel } from '../../../../../src/ui/dashboard/components/OperationalEventsPanel';
import { I18nProvider } from '../../../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';
import { UI_LANGUAGES } from '../../../../../src/i18n';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type PanelProps = NonNullable<Parameters<typeof OperationalEventsPanel>[0]>;
const Panel = OperationalEventsPanel as (props: PanelProps) => ReturnType<typeof OperationalEventsPanel>;
type Lang = (typeof UI_LANGUAGES)[number];

let host: HTMLDivElement;
let root: Root;

async function openIssues(mode: Mode, lang: Lang, tier: 'free' | 'family' = 'free'): Promise<string> {
  MODE = mode;
  TIER = tier;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() } },
  };
  await act(async () => {
    root.render(createElement(I18nProvider, {
      lang,
      children: createElement(Panel, {
        fetchBuckets: (() => Promise.resolve([])) as PanelProps['fetchBuckets'],
        fetchSelectorHealth: (() => Promise.resolve(null)) as unknown as PanelProps['fetchSelectorHealth'],
        integrity: null,
      }),
    }));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return host.textContent ?? '';
}

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
});

describe.each(UI_LANGUAGES)('%s: a free install, at Strict or Moderate', (lang) => {
  const t = DASHBOARD_STRINGS[lang];

  it.each(['child', 'teen'] as Mode[])('at %s shows no AI-off line', async (mode) => {
    const text = await openIssues(mode, lang);
    expect(text).not.toContain(t.opsAiOff);
    expect(text).not.toContain(t.opsAiOffStrict);
  });
});

describe('the Strict line in English', () => {
  it('names Strict and asks for no license', () => {
    const s = DASHBOARD_STRINGS.en.opsAiOffStrict;
    expect(s).toMatch(/Strict/);
    expect(s).not.toMatch(/Add a|license in the popup/i);
  });
});

// With a key at Strict the AI health section still says the reading is off: Strict sends nothing
// out, so the key-holder line never claims classification is enabled.
describe.each(UI_LANGUAGES)('%s: the AI health section with a key', (lang) => {
  const t = DASHBOARD_STRINGS[lang];
  const active = (tier: string): string => `${t.opsLicenseActive1}${tier}${t.opsLicenseActive2}`;

  it('at Strict with a paid tier shows the Strict key-holder line and no "enabled" line', async () => {
    const text = await openIssues('child', lang, 'family');
    expect(text).toContain(t.opsAiOffStrictKey);
    expect(text).not.toContain(active('family'));
    expect(text).not.toContain(t.opsAiOffStrict);
    expect(text).not.toContain(t.opsNoAiCalls);
  });

  it('at Moderate with a paid tier still says the license is active', async () => {
    const text = await openIssues('teen', lang, 'family');
    expect(text).toContain(active('family'));
    expect(text).not.toContain(t.opsAiOffStrictKey);
  });
});

describe('the Strict lines in English', () => {
  it('the free line ends by naming Moderate with a license key', () => {
    expect(DASHBOARD_STRINGS.en.opsAiOffStrict.endsWith('Moderate with a license key turns the AI reading on.')).toBe(true);
    expect(DASHBOARD_STRINGS.en.opsAiOffStrict).not.toMatch(/changes nothing/);
  });

  it('the key-holder line says AI is off at Strict and that Moderate turns it on with the key', () => {
    expect(DASHBOARD_STRINGS.en.opsAiOffStrictKey).toBe(
      '● AI is OFF at Strict. This level sends nothing out, so no AI classification runs (only the built-in harm filter). Moderate turns the AI reading on with your license key.',
    );
  });
});
