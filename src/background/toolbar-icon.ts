// The toolbar icon's badge: a red "!" while the reading waits for the person's go-ahead (the relay asked for it and nothing
// has answered since, storage/reading-pause.ts), else today's count in teal, or nothing at zero.
//
// Without it a person who never opens the popup sees every post as written, with no dot and no word why. Opening the popup
// shows the screen that asks; giving the go-ahead clears the marker and the next paint puts the count back.

import { getSettings } from '../storage/settings';
import { READING_PAUSED_STORAGE_KEY } from '../storage/reading-pause';

export async function paintToolbarIcon(neutralizedToday?: number): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(READING_PAUSED_STORAGE_KEY);
    if (stored?.[READING_PAUSED_STORAGE_KEY]) {
      await chrome.action.setBadgeText({ text: '!' });
      await chrome.action.setBadgeBackgroundColor({ color: '#c0392b' });
      return;
    }
    const count = neutralizedToday ?? (await getSettings()).totalNeutralizedToday;
    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#00bcd4' });
  } catch { /* the icon is best-effort */ }
}
