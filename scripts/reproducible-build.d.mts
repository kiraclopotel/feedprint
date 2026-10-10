// Types for the reproducible build, so the typed test lane can import it (PLAN-2026-09-16 item 5.8).
// The script itself is plain JS because it runs under node with no build step.

/** Every zip uploaded to the Chrome Web Store, with the commit, the Node version and the hashes. */
export declare const RELEASES_PATH: string;
/** The products a row may name: the two Chrome uploads and their Firefox copies. */
export declare const RELEASE_PRODUCTS: string[];
/** The columns, in order. Columns may be added at the end, never removed or reordered. */
export declare const RELEASE_COLUMNS: string[];
/** Where Chrome fetches store updates from: the value the store writes into an installed manifest. */
export declare const STORE_UPDATE_URL: string;
/** The Chrome Web Store's public key for verified_contents.json, DER as hex, as Chromium publishes it. */
export declare const WEBSTORE_PUBLIC_KEY_HEX: string;

/** `fwbid-<12 commit hex>-r<version digits>`: the shape check-sw-bundle greps for. */
export declare function reproducibleBuildId(commit: string, version: string): string;

/** `fwsec-<10 hex>` derived from the commit: the shape vite.config.ts accepts. */
export declare function reproducibleSecret(commit: string): string;

/** What one product builds from and writes: its manifest, npm script, folder, file stem and store id (null for a Firefox copy). */
export declare function productConfig(product: string): {
  name: string;
  manifest: string;
  script: string;
  dist: string;
  stem: string;
  storeId: string | null;
};

/** True when two paths name the same file (Windows paths compare without case). */
export declare function samePath(a: string, b: string, platform?: string): boolean;

/** The command line as flags; anything unknown, repeated or missing its value is refused. */
export declare function parseArgs(argv: string[]): Record<string, string | true>;

/**
 * The commit the build id is derived from: `--source-commit <sha>`, else the SOURCE-COMMIT file a
 * public snapshot carries, else this repository's HEAD. Says where it came from as well.
 */
export declare function resolveSourceCommit(
  argv: string[],
  root: string,
  gitHead: () => string,
): { commit: string; from: string };

export interface ReleaseRow {
  product: string;
  version: string;
  commit: string;
  node: string;
  filesSha256: string;
  zipSha256: string;
  uploaded: string;
}

/** The rows of docs/spec/RELEASES.tsv; throws on anything malformed. */
export declare function parseReleases(text: string): ReleaseRow[];

/** SHA-256 of the lines `<file sha256>  <path>`, ordered by path: the contents, whatever the zip. */
export declare function filesDigest(tree: Map<string, Buffer>): string;

/** Chromium's tree hash of one file, base64url, as verified_contents.json records it. */
export declare function treeHashRoot(buf: Buffer, blockSize?: number, hashBlockSize?: number): string;

/** The extension id Chrome derives from a manifest `key`. */
export declare function extensionIdFromKey(base64Key: string): string;

/** What the Chrome Web Store signed for an installed copy; throws when the signature does not verify. */
export declare function readSignedContents(
  json: unknown,
  publicKeyHex?: string,
): { itemId: string; itemVersion: string; files: Map<string, string> };

/** A build compared with the copy Chrome installed from the store. */
export declare function compareWithStore(input: {
  built: Map<string, Buffer>;
  signed: { itemId: string; itemVersion: string; files: Map<string, string> };
  installedManifest: Record<string, unknown>;
  storeId: string;
}): { matching: string[]; problems: string[] };
