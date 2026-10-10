// One id baked into every bundle of a build (scripts/new-build-id.mjs), so each record can say
// which code judged it. Reloading the extension replaces the service worker at once but not the
// content scripts in tabs already open, so a feed left open for hours keeps judging with the old
// build. The manifest version cannot tell them apart: it is read once at export time and is the
// same on every record.

declare const __FW_BUILD_ID__: string;

let provided = '';

/**
 * The service worker hands in the id baked into its own file. This module is shared with the
 * dashboard, so the bundler puts it in a chunk both import; without this the worker's statement of
 * its build would rest on that chunk, and the bundle check (scripts/check-sw-bundle.mjs gate 4)
 * that mirrors the worker's id for the dev reload finds none in service-worker.js.
 */
export function provideBuildId(id: string): void {
  provided = id;
}

/**
 * '' when nothing was baked in (vitest, node harnesses, a hand-rolled build). Empty means
 * unknown, which every reader treats as "cannot compare", not as a mismatch.
 */
export function getBuildId(): string {
  if (provided) return provided;
  return typeof __FW_BUILD_ID__ !== 'undefined' && typeof __FW_BUILD_ID__ === 'string'
    ? __FW_BUILD_ID__
    : '';
}
