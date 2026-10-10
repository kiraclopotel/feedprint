// Setup lives in the toolbar popup, and Chrome puts a new extension under the puzzle-piece menu, so a stranger who
// never finds it never starts setup and nothing is recorded (walker, 29 Sep 2026, R1). On a fresh install only,
// open the popup page in a tab, in the layout the detached popup already uses, so the first thing they see is setup.
// An update, a Chrome update and a shared-module update open nothing.
//
// It opens only while setup is unfinished (M6, 30 Sep 2026): a browser that loads the extension from a folder can
// report the install reason at every start, and the tab must not come back after setup. "Finished" is the popup's own
// rule (Popup.tsx: setupDone, or a stored PIN, or a read that cannot say). A read that fails opens nothing.

import { getSettings, parentPinUnknown } from '../storage/settings';

export function openSetupOnInstall(reason: string): void {
  if (reason !== 'install') return;
  void Promise.resolve()
    .then(async () => {
      const settings = await getSettings();
      if (settings.setupDone || settings.parentPin || parentPinUnknown(settings)) return;
      await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?detached=1') });
    })
    .catch((err) => {
      console.warn('[FeelingWise] could not open the setup page:', err);
    });
}