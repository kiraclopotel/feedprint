// FeelingWise - shared <style> tag helpers for the engagement modules.
//
// Every engagement module injects its CSS through one <style> element keyed
// by a stable id (the controller's STYLE_TAG_IDS list removes them all on a
// settings reset). The bodies were copy-pasted ten times; this is the one
// copy. Ids are owned by the callers and must not change.

/** Inject `css` under `id` once; a second call with the same id is a no-op. */
export function ensureStyleTag(id: string, css: string): void {
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
}

/** Remove the <style> element with `id`, if present. */
export function removeStyleTag(id: string): void {
  document.getElementById(id)?.remove();
}
