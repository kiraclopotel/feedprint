// The one line after an update (PLAN-2026-09-17 item 8a): it appears once after a version change,
// stays until opened or dismissed, and never comes back for that version. A fresh install sees
// nothing, and a profile from before the version key existed is told apart from a fresh install
// by the settings it already wrote.

import { describe, it, expect, afterEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { installChromeStorageStub, type ChromeStorageStub } from '../../../helpers/chrome-storage';
import {
  SEEN_VERSION_KEY, acknowledgeUpdate, decideUpdateNotice, readUpdateNotice, updatesPageUrl,
} from '../../../../src/storage/update-notice';
import { UpdateNoticeLine } from '../../../../src/ui/popup/UpdateNotice';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';

let stub: ChromeStorageStub | null = null;
afterEach(() => { stub?.restore(); stub = null; });

describe('the decision', () => {
  it('shows after a version change and not when the version is acknowledged', () => {
    expect(decideUpdateNotice('2.5.10', '2.5.9', true)).toBe('show');
    expect(decideUpdateNotice('2.5.10', '2.5.10', true)).toBe('none');
    expect(decideUpdateNotice('2.5.10', '2.5.10', false)).toBe('none');
  });
  it('treats a profile with no stored version as fresh only when it never wrote settings', () => {
    expect(decideUpdateNotice('2.5.10', undefined, false)).toBe('fresh');
    expect(decideUpdateNotice('2.5.10', undefined, true)).toBe('show');
  });
  it('shows nothing when the version cannot be read', () => {
    expect(decideUpdateNotice('', undefined, true)).toBe('none');
    expect(decideUpdateNotice('', '2.5.9', true)).toBe('none');
  });
});

describe('over storage', () => {
  it('a fresh install is stamped with its own version and sees no line, then or later', async () => {
    stub = installChromeStorageStub({ manifest: { version: '2.5.10' } });
    expect(await readUpdateNotice()).toEqual({ show: false, version: '2.5.10' });
    expect(stub.state[SEEN_VERSION_KEY]).toBe('2.5.10');
    // The setup finishes; the next open still shows nothing.
    stub.state.setupDone = true;
    expect((await readUpdateNotice()).show).toBe(false);
  });

  it('a recorder profile from before the key existed sees the line once, and never again after it is acknowledged', async () => {
    stub = installChromeStorageStub({ manifest: { version: '2.5.10' }, initial: { setupDone: true, parentPin: 'x' } });
    expect((await readUpdateNotice()).show).toBe(true);
    // Not acknowledged yet: a second open still shows it (a stray click must not lose it).
    expect((await readUpdateNotice()).show).toBe(true);
    await acknowledgeUpdate('2.5.10');
    expect(stub.state[SEEN_VERSION_KEY]).toBe('2.5.10');
    expect((await readUpdateNotice()).show).toBe(false);
    expect((await readUpdateNotice()).show).toBe(false);
  });

  it('an Off profile that picked a mode counts as ran-before; one that never touched a switch does not', async () => {
    stub = installChromeStorageStub({ manifest: { version: '1.0.6' }, initial: { mode: 'teen', features: {} } });
    expect((await readUpdateNotice()).show).toBe(true);
    stub.restore();
    stub = installChromeStorageStub({ manifest: { version: '1.0.6' }, initial: { fw_off_tally: { 'block-ads': 3 } } });
    expect((await readUpdateNotice()).show).toBe(false);
    expect(stub.state[SEEN_VERSION_KEY]).toBe('1.0.6');
  });

  it('the next update shows the line again, exactly once more', async () => {
    stub = installChromeStorageStub({ manifest: { version: '2.5.11' }, initial: { [SEEN_VERSION_KEY]: '2.5.10', setupDone: true } });
    expect((await readUpdateNotice()).show).toBe(true);
    await acknowledgeUpdate('2.5.11');
    expect((await readUpdateNotice()).show).toBe(false);
  });

  it('a runtime with no manifest shows nothing and writes nothing', async () => {
    stub = installChromeStorageStub({ initial: { setupDone: true } });
    expect(await readUpdateNotice()).toEqual({ show: false, version: '' });
    expect(stub.state[SEEN_VERSION_KEY]).toBeUndefined();
  });
});

describe('the page it opens', () => {
  it('is the Updates page in English or Romanian, at the band for that version', () => {
    expect(updatesPageUrl('en', '2.5.10')).toBe('https://feelingwise.org/updates#v2-5-10');
    expect(updatesPageUrl('ro', '2.5.10')).toBe('https://feelingwise.org/updates-ro#v2-5-10');
    expect(updatesPageUrl('es', '1.0.6')).toBe('https://feelingwise.org/updates#v1-0-6');
    expect(updatesPageUrl('pt-BR', '1.0.6')).toBe('https://feelingwise.org/updates#v1-0-6');
    expect(updatesPageUrl('en', '')).toBe('https://feelingwise.org/updates');
  });
});

describe('the line as rendered', () => {
  it('names the version, links to the Updates page in a new tab and offers a dismiss, in every language', () => {
    for (const lang of UI_LANGUAGES) {
      const html = renderToString(
        createElement(I18nProvider, { lang, children: createElement(UpdateNoticeLine, { version: '2.5.10', onDone: () => {} }) }),
      );
      expect(html).toContain(POPUP_STRINGS[lang].updateNoticeLine('2.5.10'));
      expect(html).toContain(`aria-label="${POPUP_STRINGS[lang].updateNoticeDismiss}"`);
      expect(html).toContain(`href="${updatesPageUrl(lang, '2.5.10')}"`);
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
    }
  });
});
