// The toolbar icon's badge: a red "!" while the reading waits for the person's go-ahead (the relay asked for it and nothing
// has answered since, storage/reading-pause.ts), an amber "!" while the reading service is not answering at all
// (storage/reading-trouble.ts), else today's count in teal, or nothing at zero. The icon's hover text says why a "!" shows
// (12 Oct 2026, the Tester's recheck: it said only the product's name), and is the name again when none does.
//
// Without it a person who never opens the popup sees every post as written, with no dot and no word why. Opening the popup
// shows the screen that asks; giving the go-ahead clears the marker and the next paint puts the count back.

import { getSettings } from '../storage/settings';
import { READING_PAUSED_STORAGE_KEY } from '../storage/reading-pause';
import { READING_TROUBLE_STORAGE_KEY, readingTroubleStands } from '../storage/reading-trouble';

/** The manifest's own title for the icon (a __MSG_...__ name), in the browser's language. */
function nameTitle(): string | undefined {
  const raw = chrome.runtime.getManifest().action?.default_title;
  const key = raw?.match(/^__MSG_(.+)__$/)?.[1];
  return (key ? chrome.i18n.getMessage(key) : raw) || undefined;
}

async function paintTitle(why: 'paused' | 'trouble' | null): Promise<void> {
  try {
    const action = chrome.action as { setTitle?: (details: { title: string }) => Promise<void> | void };
    if (typeof action.setTitle !== 'function') return;
    const title = why === 'paused' ? chrome.i18n.getMessage('actionTitleReadingPaused')
      : why === 'trouble' ? chrome.i18n.getMessage('actionTitleReadingTrouble')
      : nameTitle();
    if (title) await action.setTitle({ title });
  } catch { /* the hover text is best-effort */ }
}

export async function paintToolbarIcon(neutralizedToday?: number): Promise<void> {
  try {
    const stored = await chrome.storage.local.get([READING_PAUSED_STORAGE_KEY, READING_TROUBLE_STORAGE_KEY]);
    if (stored?.[READING_PAUSED_STORAGE_KEY]) {
      await chrome.action.setBadgeText({ text: '!' });
      await chrome.action.setBadgeBackgroundColor({ color: '#c0392b' });
      await paintTitle('paused');
      return;
    }
    // The reading service is not answering: an amber "!", for what needs nothing from the person, against the red one
    // for the go-ahead that does.
    if (readingTroubleStands(stored?.[READING_TROUBLE_STORAGE_KEY])) {
      await chrome.action.setBadgeText({ text: '!' });
      await chrome.action.setBadgeBackgroundColor({ color: '#d98a00' });
      await paintTitle('trouble');
      return;
    }
    const count = neutralizedToday ?? (await getSettings()).totalNeutralizedToday;
    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#00bcd4' });
    await paintTitle(null);
  } catch { /* the icon is best-effort */ }
}
