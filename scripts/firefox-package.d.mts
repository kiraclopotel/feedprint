// Types for the Firefox packager, so the typed test lane can import it.
// The script itself is plain JS because it runs under node with no build step.

/** The longest name addons.mozilla.org accepts, in every language of the listing. */
export declare const AMO_NAME_LIMIT: number;

export interface FirefoxOverlay {
  chromeDist: string;
  firefoxDist: string;
  nameKey: string;
  gecko: {
    id: string;
    strict_min_version: string;
    data_collection_permissions: { required: string[]; optional?: string[] };
  };
  names: Record<string, string>;
}

/** One product's entry in scripts/firefox/overlay.json. */
export declare function readOverlay(product: string, root?: string): FirefoxOverlay;

/** The Firefox manifest made from the built Chrome manifest. Pure; throws on anything it does not expect. */
export declare function firefoxManifest(
  chrome: Record<string, unknown>,
  overlay: Pick<FirefoxOverlay, 'gecko'>,
): Record<string, unknown>;

/** The keys outside the allowed three in which the Firefox manifest differs from Chrome's. */
export declare function manifestDrift(chrome: Record<string, unknown>, firefox: Record<string, unknown>): string[];

/** Each language's messages with the product name made to fit; throws when a name is over the limit. */
export declare function firefoxMessages(
  messagesByLocale: Record<string, Record<string, { message: string }>>,
  overlay: Pick<FirefoxOverlay, 'nameKey' | 'names'>,
): Record<string, Record<string, { message: string }>>;

/** Copies the Chrome build, writes the Firefox manifest and names, and checks every other file is the same bytes. */
export declare function makeFirefoxCopy(
  product: string,
  root?: string,
): { to: string; files: number; rewritten: number; version: string };
