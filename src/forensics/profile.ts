// FeelingWise — the profile an export names as its maker.
//
// Owner, 14 Sep 2026: an export read as if nobody owned it. Page one said
// "this file carries no name" and the rest of the page said "this device" and
// "this computer". A receipt handed to a school, a lawyer or a researcher has
// to say whose it is, in the sender's own word.
//
// So the file names a maker: a name the user chooses (any pseudonym; it is a
// label, not an identity claim, and page one says so) and the facts about the
// machine that Chrome will actually tell an extension. What it will NOT tell
// one, and what this module therefore never claims: the operating-system
// account name, the computer's name, the IP address. There is no extension
// API for any of them. Naming a "PC account" here would be an invention.
//
// What Chrome does expose: the operating system family, the browser and its
// major version, the interface language, and the time zone. Together with the
// signing-key fingerprint already on page one, that is the honest shape of
// "which machine made this".
//
// The name lives in chrome.storage.local under its own key, beside the
// settings blob rather than inside it, so no settings-schema migration is
// touched. The update gate reads the settings blob; a sidecar cannot fail it.

export interface ExportProfile {
  /** The name the user chose to be known by on the file; null when unset. */
  name: string | null;
  /** Operating-system family as the browser reports it ("Windows", "macOS", "Linux", ...). */
  platform: string | null;
  /** Browser and major version ("Chrome 130"). */
  browser: string | null;
  /** The browser's interface language tag ("en-GB"). */
  language: string | null;
  /** IANA time zone the machine was set to when the file was made. */
  timeZone: string | null;
}

const PROFILE_NAME_KEY = 'fw_profile_name';
/** Longest name the file will carry. Long enough for any pseudonym, short enough for a filename. */
export const PROFILE_NAME_MAX = 60;

/** Trim, collapse whitespace, cap. Empty in, null out. */
export function normalizeProfileName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/\s+/g, ' ').trim().slice(0, PROFILE_NAME_MAX).trim();
  return s.length > 0 ? s : null;
}

/** The name as a filename part: letters, digits and dashes only, lower-cased. Null when nothing survives. */
export function profileNameSlug(name: string | null): string | null {
  if (!name) return null;
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : null;
}

type StorageLike = {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (key: string) => Promise<void>;
};

function storage(): StorageLike | null {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
  return chrome.storage.local as unknown as StorageLike;
}

export async function getProfileName(): Promise<string | null> {
  const s = storage();
  if (!s) return null;
  try {
    const got = await s.get(PROFILE_NAME_KEY);
    return normalizeProfileName(got?.[PROFILE_NAME_KEY]);
  } catch {
    return null;
  }
}

/** Store the name; an empty name removes the key. Returns what was stored. */
export async function setProfileName(raw: string): Promise<string | null> {
  const s = storage();
  const name = normalizeProfileName(raw);
  if (!s) return name;
  if (name === null) await s.remove(PROFILE_NAME_KEY);
  else await s.set({ [PROFILE_NAME_KEY]: name });
  return name;
}

interface UaDataLike {
  platform?: string;
  brands?: Array<{ brand: string; version: string }>;
}

/**
 * The machine facts Chrome exposes, read from the navigator this runs in.
 * Every field is null when the environment does not offer it; nothing is
 * guessed. `nav` is injectable for tests.
 */
export function collectMachineFacts(nav: Partial<Navigator> & { userAgentData?: UaDataLike } = globalThis.navigator ?? {}): Omit<ExportProfile, 'name'> {
  const uaData = nav.userAgentData;
  let platform: string | null = uaData?.platform?.trim() || null;
  if (!platform && typeof nav.platform === 'string' && nav.platform) {
    const p = nav.platform;
    platform = /win/i.test(p) ? 'Windows' : /mac/i.test(p) ? 'macOS' : /linux/i.test(p) ? 'Linux' : /cros/i.test(p) ? 'ChromeOS' : p;
  }

  let browser: string | null = null;
  const brand = uaData?.brands?.find(b => /^(Google Chrome|Chromium|Microsoft Edge|Brave|Opera|Vivaldi)$/.test(b.brand))
    ?? uaData?.brands?.find(b => !/Not.?A.?Brand/i.test(b.brand));
  if (brand) {
    browser = `${brand.brand.replace(/^Google /, '')} ${brand.version}`;
  } else if (typeof nav.userAgent === 'string') {
    const m = /(Edg|OPR|Chrome|Firefox|Safari)\/(\d+)/.exec(nav.userAgent);
    if (m) browser = `${{ Edg: 'Edge', OPR: 'Opera' }[m[1]] ?? m[1]} ${m[2]}`;
  }

  const language = typeof nav.language === 'string' && nav.language ? nav.language : null;

  let timeZone: string | null = null;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    timeZone = null;
  }

  return { platform, browser, language, timeZone };
}

/** The profile an export carries: the chosen name plus the machine facts. */
export async function buildExportProfile(): Promise<ExportProfile> {
  return { name: await getProfileName(), ...collectMachineFacts() };
}

/** "Windows, Chrome 130, en-GB, Europe/Bucharest": the non-null facts, comma-joined. Empty string when none. */
export function machineLine(p: Omit<ExportProfile, 'name'>): string {
  return [p.platform, p.browser, p.language, p.timeZone].filter((x): x is string => !!x).join(', ');
}
