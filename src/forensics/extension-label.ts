// The words page one uses for the extension that made the file.
//
// A reproducible build sets the manifest's version_name to the version, the build id and the
// digest of the source it was built from (scripts/version-name.mjs), so the label answers "which
// code wrote this" and not only "which version". An ad hoc build names its build id alone.

interface ManifestVersion {
  version?: string;
  version_name?: string;
}

export function extensionLabel(manifest: ManifestVersion | undefined): string {
  const named = manifest?.version_name?.trim() || manifest?.version;
  return named ? `FeelingWise V${named}` : 'FeelingWise V1';
}
