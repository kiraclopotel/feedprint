// Types for the packager, so the typed test lane can import it (PLAN-2026-09-16 item 5.8).
// The script itself is plain JS because it runs under node with no build step.

/** Writes the store zip from a built folder and reports what went in. */
export declare function packageExtension(opts?: {
  distDir?: string;
  outFile?: string;
}): { outFile: string; fileCount: number; bytes: number };

/**
 * The manifest name as the store shows it in the default locale: a `__MSG_key__` placeholder is
 * resolved from the built _locales, a literal name is returned as it stands. Throws when the
 * placeholder has no message, so a package never gets a nameless zip.
 */
export declare function resolveManifestName(
  distDir: string,
  manifest: { name?: unknown; default_locale?: string },
): string;

/**
 * Files that live in the built folder and are deliberately left out of the zip.
 * Since 2026-09-19: `build-id.json`, which only the local dev-reload server
 * reads, off disk, and which shipped a field called `secret` to every store
 * install up to 2.5.11.
 */
export declare const NOT_IN_THE_ZIP: readonly string[];

/**
 * The name a zip gets from the build it was cut from: `<slug>-<version>`, plus
 * `.local` when nothing asked for a particular place. The marker keeps a plain
 * `npm run package` from writing a nameless twin of the release artefact into
 * the folder a person uploads from (2026-09-19).
 */
export declare function zipNameFor(distDir: string, opts: { local: boolean }): string;
