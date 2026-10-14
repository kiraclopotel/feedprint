/** @vitest-environment jsdom */
// Forty-eight tests import a panel (HomeTab, SettingsPanel, SetupWizard, KeysTab) from Popup.tsx. The
// module used to mount a whole popup into any page that imported it, appending its own div when there
// was no #root, and nothing unmounted it: on the public Linux runner its render ran after a test's DOM
// was torn down and failed the run (run 38493412145, "window is not defined"). It mounts only into
// the popup page's own #root now; the tests that want the real popup make one first.

import { expect, it } from 'vitest';

it('importing the popup module into a page without #root mounts nothing', async () => {
  document.body.innerHTML = '';
  await import('../../../../src/ui/popup/Popup');
  expect(document.body.children.length).toBe(0);
});
