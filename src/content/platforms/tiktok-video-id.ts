/**
 * Read TikTok's live-verified FYP video id carrier. The wrapper is scoped to
 * one card and every matching wrapper must expose the same 19-digit id.
 */
export function readTikTokVideoIdFromXgWrapper(container: Element): string | null {
  const ids = new Set<string>();
  for (const wrapper of container.querySelectorAll<HTMLElement>('div[id^="xgwrapper-"]')) {
    const match = wrapper.id.match(/^xgwrapper-\d+-(\d{19})$/);
    if (!match) return null;
    ids.add(match[1]);
  }
  return ids.size === 1 ? Array.from(ids)[0] : null;
}
