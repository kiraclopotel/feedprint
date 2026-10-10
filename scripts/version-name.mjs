// The manifest's version_name: the version, the build id and, for a reproducible build, the digest
// of the source it was built from (scripts/public-snapshot.mjs, SOURCE-DIGEST). Chrome shows it on
// chrome://extensions and the export prints it on page one, so the person holding the file and the
// stranger rebuilding it read the same three things. An ad hoc build has no source digest to state.

/**
 * The reproducible build hands the digest to the build in this environment variable, never in a
 * file, so an interrupted run cannot leave a digest for a later ad hoc build to pick up.
 */
export const SOURCE_DIGEST_ENV = 'FW_SOURCE_DIGEST';

export function versionName({ version, buildId, sourceDigest }) {
  if (sourceDigest && !/^[0-9a-f]{64}$/.test(sourceDigest)) {
    throw new Error(`version_name: "${sourceDigest}" is not a source digest (64 lowercase hex)`);
  }
  return sourceDigest ? `${version} build ${buildId} source ${sourceDigest}` : `${version} build ${buildId}`;
}
