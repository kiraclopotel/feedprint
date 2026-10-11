// What was already counted today, kept in memory only (11 Oct 2026, the Leader's option c for the popup count).
//
// A page counts each comment it reads, and a revisit reads the same comments again: one video opened three times read
// 125, 205, 285 for about 107 threads. To count a comment once a day the counter's writer (the service worker) keeps a
// set of short one-way hashes of the comments it has counted. The set lives in chrome.storage.session: memory only, never
// written to disk, gone when the browser closes, and replaced when the UTC day turns over. The stored count in
// chrome.storage.local stays numbers only; no hash, no key and no text of a comment is written there.
//
// A hash is the first six bytes of the SHA-256 of the comment's key (video, author, the start of the text), twelve hex
// characters: enough to tell today's comments apart, too short to be read back to a comment.

const SET_KEY = 'fw_read_hashes';
/** The most hashes one day's set holds; past it the oldest are shed, and a comment shed is counted once more. */
const SET_CAP = 20_000;

interface ReadSet { day: string; hashes: string[] }

/** A comment key as twelve hex characters, or null where the browser cannot hash (the caller then counts it plainly). */
export async function shortReadHash(key: string): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
    return Array.from(new Uint8Array(digest).slice(0, 6), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/**
 * How many of `hashes` are new today, adding them to today's set. Where there is no memory-only area to ask (a test
 * host, a realm that cannot reach it) or it fails, every hash counts as new: the count is then what it was before the
 * set existed, never lower.
 */
export async function takeNewReadHashes(day: string, hashes: string[]): Promise<number> {
  const area = typeof chrome !== 'undefined' ? chrome.storage?.session : undefined;
  if (!area) return hashes.length;
  try {
    const got = await area.get(SET_KEY);
    const stored = got?.[SET_KEY] as Partial<ReadSet> | undefined;
    const today: string[] = stored?.day === day && Array.isArray(stored.hashes) ? [...stored.hashes] : [];
    const known = new Set(today);
    let fresh = 0;
    for (const h of hashes) {
      if (known.has(h)) continue;
      known.add(h);
      today.push(h);
      fresh++;
    }
    await area.set({ [SET_KEY]: { day, hashes: today.length > SET_CAP ? today.slice(-SET_CAP) : today } satisfies ReadSet });
    return fresh;
  } catch {
    return hashes.length;
  }
}
