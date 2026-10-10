/** @vitest-environment jsdom */
// The outcome's own check, as two walks through the whole popup after setup, at Moderate and at Relaxed: Home, the
// License tab and Settings, read as a person sees them. With no key no screen names the AI reading but the License
// tab's one line on what a key adds, and each place shows its own content, so a blank screen cannot pass. With a key
// whose plan covers the reading, Settings shows the AI card and the License tab names it and the rows it covers.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';

import { installStorage, t } from '../../../helpers/popup-walk';
import { screenWords as words } from '../../../helpers/screen-words';
import { SEEN_VERSION_KEY } from '../../../../src/storage/update-notice';

vi.mock('../../../../src/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/ai/client')>();
  return { ...actual, probeProxy: vi.fn(async () => 'ok') };
});

/** AI as a capitalised word, and the English words for the reading, a rewrite, the model and the BETA label. */
const AI_WORDS = /\bAI\b|(^|[^\p{L}])(reading|rewrit|model|beta)/iu;

const pause = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

let rootEl: HTMLElement;

beforeEach(() => {
  rootEl = document.createElement('div');
  rootEl.id = 'root';
  document.body.appendChild(rootEl);
});

afterEach(() => {
  document.body.innerHTML = '';
});

type Places = { home: string; license: string; settings: string; frame: string; notice: string; settingsHeader: string };

/**
 * Opens the popup on stored settings, as an install updated from an older version so the update notice is on screen,
 * and returns what each of its places says: the Home and License panels by their own tabpanel, Settings as the screen
 * that replaces them without the header the three share, the frame around Home (header, tab bar and update notice) as
 * the rest of the same root, the notice by itself, and the header as Settings shows it.
 */
async function walk(stored: Record<string, unknown>): Promise<Places> {
  installStorage({ setupDone: true, levelChosen: true, [SEEN_VERSION_KEY]: '0.0.1', ...stored });
  vi.resetModules();
  await act(async () => { await import('../../../../src/ui/popup/Popup'); });
  for (let i = 0; i < 40 && !rootEl.querySelector(`button[aria-label="${t.settingsBtn}"]`); i++) await pause(50);
  await pause(100);
  // The helper's import of Popup mounts a second popup outside this root, so each id is in the page twice, and jsdom
  // answers an #id query from the whole page; an attribute selector stays inside this root.
  const home = words(rootEl.querySelector('[id="pop-tabpanel-home"]'));
  const frame = words(rootEl).replace(home, '');
  const notice = words(rootEl.querySelector('.pop-update'));
  const tabs = Array.from(rootEl.querySelectorAll<HTMLElement>('[role="tab"]'));
  const licenseTab = tabs.find((b) => b.textContent?.trim() === t.tabLicense);
  expect(licenseTab, 'the License tab').toBeDefined();
  await act(async () => { licenseTab!.click(); });
  await pause(100);
  const license = words(rootEl.querySelector('[id="pop-tabpanel-keys"]'));
  await act(async () => { rootEl.querySelector<HTMLElement>(`button[aria-label="${t.settingsBtn}"]`)!.click(); });
  await pause(200);
  const header = words(rootEl.querySelector('.fw-popup > :first-child'));
  const settings = words(rootEl).replace(header, '');
  return { home, license, settings, frame, notice, settingsHeader: header };
}

describe.each([['Moderate', 'teen'], ['Relaxed', 'adult']])('at %s', (_level, mode) => {
  it('with no key, no screen names the AI reading', { timeout: 30000 }, async () => {
    const seen = await walk({ mode });
    // A blank panel would pass the check below, so each place must show what it is for first.
    expect(seen.home.trim().length, 'Home shows something').toBeGreaterThan(20);
    expect(seen.license, 'the License tab shows its card').toContain(t.licCardName);
    expect(seen.settings, 'Settings shows the level choice').toContain(t.modeSegTeen);
    expect(seen.frame, 'the frame shows the tab bar').toContain(t.tabLicense);
    expect(seen.notice, 'the update notice is on screen').toContain(t.updateNoticeLine('|').split('|')[0].trim());
    expect(seen.settingsHeader, 'Settings shows the header').toContain('Feedprint');
    // The one sentence that may name the reading without a key: once, on the License tab, beside its link.
    expect(seen.license.split(t.keyAdds).length - 1, 'the License tab says what a key adds once').toBe(1);
    expect(seen.license, 'the License tab links to the help page').toContain(t.keyGetLink);
    const outsideTheLine = { ...seen, license: seen.license.replace(t.keyAdds, '') };
    for (const [place, text] of Object.entries(outsideTheLine)) expect(text, place).not.toMatch(AI_WORDS);
  });

  it('with a key whose plan covers the reading, the reading shows', { timeout: 30000 }, async () => {
    const seen = await walk({ mode, fw_license_key: 'fw-starter-abc12345' });
    // The AI card itself, inside Settings: its group heading and its main switch.
    expect(seen.settings).toContain(t.groupAi);
    expect(seen.settings).toContain(t.featAiMasterName);
    // The License tab names what the key turns on and the rows it covers, and does not offer a key.
    expect(seen.license).toContain(t.keySubActive);
    for (const name of [t.featAiMasterName, t.featRewriteName, t.reframeRewritesName, t.outputLangName]) {
      expect(seen.license).toContain(name);
    }
    expect(seen.license).not.toContain(t.keyAdds);
  });
});
