// FeelingWise - accounts the recorder skips (evidence-gap register item 20,
// part 2, 2026-09-06, on the owner's lead).
//
// A parent can stop recording a named account going forward. The list lives
// in chrome.storage.local; the worker consults it at the one point every
// retained record passes (the FORENSIC_DELIVERY branch of service-worker.ts)
// and drops a delivery whose author, or whose room author for a room summary,
// is on it. Protection on the page is unchanged: the judge still runs, the
// hide still lands; only the record is not written.
//
// What the chain says about it. Nothing names the account: the point is to
// stop naming them. What it does say is that skipping happened: every skip
// bumps a counter that the next heartbeat carries as excludedSkipped=N in its
// hashed text, so a reader sees that N records were withheld at capture in
// that window without learning whose.

export interface AuthorExclusion {
  /** `${platform}:${normalized author}` */
  key: string;
  platform: string;
  /** The handle as the parent saw it, for the list on the Record tab. */
  author: string;
  addedAt: string;
  reason: string;
}

export const EXCLUSIONS_KEY = 'fwAuthorExclusions';
const EXCLUDED_SKIPPED_KEY = 'fwExcludedSkipped';
const EXCLUSION_REASON_MAX = 200;

/** One key per account: platform, then the handle lower-cased, trimmed, without a leading @. */
export function exclusionKey(platform: string, author: string): string {
  return `${platform}:${author.trim().replace(/^@+/, '').toLowerCase()}`;
}

function storage(): chrome.storage.StorageArea | null {
  return typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local : null;
}

export async function readExclusions(): Promise<AuthorExclusion[]> {
  const s = storage();
  if (!s) return [];
  try {
    const got = await s.get(EXCLUSIONS_KEY);
    const raw = got[EXCLUSIONS_KEY];
    return Array.isArray(raw) ? raw.filter((e): e is AuthorExclusion => !!e && typeof e === 'object' && typeof (e as AuthorExclusion).key === 'string') : [];
  } catch {
    return [];
  }
}

/** Add one account. Idempotent by key; returns the list afterwards. */
export async function addExclusion(platform: string, author: string, reason: string): Promise<AuthorExclusion[]> {
  const s = storage();
  const list = await readExclusions();
  const key = exclusionKey(platform, author);
  if (!author.trim() || list.some(e => e.key === key)) return list;
  const next = [...list, { key, platform, author: author.trim(), addedAt: new Date().toISOString(), reason: reason.slice(0, EXCLUSION_REASON_MAX) }];
  if (s) await s.set({ [EXCLUSIONS_KEY]: next });
  return next;
}

export async function removeExclusion(key: string): Promise<AuthorExclusion[]> {
  const s = storage();
  const next = (await readExclusions()).filter(e => e.key !== key);
  if (s) await s.set({ [EXCLUSIONS_KEY]: next });
  return next;
}

/**
 * The key with its diacritics folded, for comparison only.
 *
 * A stored key keeps the spelling the parent typed, so nothing on disk has to
 * be migrated; the comparison is what folds. Measured 2026-09-17: a household
 * that excluded "Serban" went on recording every post by "Șerban", and one that
 * excluded "Șerban" missed the same person written without diacritics, which is
 * how a Romanian name is written half the time. Facebook and TikTok authors are
 * display names, where this is the normal case.
 *
 * Punctuation is deliberately NOT folded. On X, `sam-q` and `sam_q` are two
 * different accounts, and an exclusion that took out the wrong person's record
 * would be the same failure in the other direction.
 */
function foldForComparison(key: string): string {
  return key.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export function isExcludedAuthor(list: ReadonlyArray<AuthorExclusion>, platform: string, author: string | undefined | null): boolean {
  if (!author) return false;
  const want = foldForComparison(exclusionKey(platform, author));
  return list.some(e => foldForComparison(e.key) === want);
}

/**
 * The author a delivery names, per type: the item's author for every content
 * record, the room's author for a room summary. Undefined when the payload
 * names nobody.
 */
export function excludableAuthor(type: string, payload: unknown): { platform: string; author: string } | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const p = payload as Record<string, unknown>;
  const platform = typeof p.platform === 'string' ? p.platform : undefined;
  if (!platform) return undefined;
  const field = type === 'ENVIRONMENT_LOG' ? p.roomAuthor : p.author;
  return typeof field === 'string' && field.trim() ? { platform, author: field } : undefined;
}

/** Count one skipped record; the heartbeat carries and resets the count. */
export async function noteExcludedSkip(): Promise<void> {
  const s = storage();
  if (!s) return;
  try {
    const got = await s.get(EXCLUDED_SKIPPED_KEY);
    const n = typeof got[EXCLUDED_SKIPPED_KEY] === 'number' ? (got[EXCLUDED_SKIPPED_KEY] as number) : 0;
    await s.set({ [EXCLUDED_SKIPPED_KEY]: n + 1 });
  } catch {
    // best-effort
  }
}

/**
 * The skips counted so far. Read only: the counter is cleared by
 * consumeExcludedSkipped AFTER the heartbeat that carries it is on the chain.
 * Reading and clearing in one step lost the count whenever the write that was
 * meant to disclose it threw, and a skip that no marker ever states is exactly
 * the silence this counter exists to break.
 */
export async function peekExcludedSkipped(): Promise<number> {
  const s = storage();
  if (!s) return 0;
  try {
    const got = await s.get(EXCLUDED_SKIPPED_KEY);
    return typeof got[EXCLUDED_SKIPPED_KEY] === 'number' ? (got[EXCLUDED_SKIPPED_KEY] as number) : 0;
  } catch {
    return 0;
  }
}

/**
 * Retire exactly the `n` skips a written heartbeat stated. Subtracts rather
 * than zeroing, so a skip counted while the marker was being signed is carried
 * by the next heartbeat instead of vanishing. Never goes below zero.
 */
export async function consumeExcludedSkipped(n: number): Promise<void> {
  if (!(n > 0)) return;
  const s = storage();
  if (!s) return;
  try {
    const got = await s.get(EXCLUDED_SKIPPED_KEY);
    const have = typeof got[EXCLUDED_SKIPPED_KEY] === 'number' ? (got[EXCLUDED_SKIPPED_KEY] as number) : 0;
    await s.set({ [EXCLUDED_SKIPPED_KEY]: Math.max(0, have - n) });
  } catch {
    // best-effort: an unretired count is carried again, never lost
  }
}
