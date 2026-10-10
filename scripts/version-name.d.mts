// Types for version-name.mjs, so vite.config.ts and the typed test lane can import it.
export declare const SOURCE_DIGEST_ENV: string;
export declare function versionName(input: { version: string; buildId: string; sourceDigest?: string }): string;
