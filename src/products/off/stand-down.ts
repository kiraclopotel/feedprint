// Off stands down where the recorder runs: whole beside a recorder that runs every switch, and switch by
// switch beside one that names what it runs (content/engagement/recorder-runs.ts).
//
// Both extensions carry the same engagement code with the same style-tag
// ids and markers. With both installed (the owner's profile), two copies run
// on one page and each one's pass undoes the other's hides: X's compose box
// flickered with both on and was steady with either alone (2026-09-03). The
// recorder stamps `data-fw-recorder` on the root element when it starts
// (content/index.ts); Off checks the stamp before starting and keeps watching
// for it, since the recorder may load a moment later.

export const RECORDER_STAMP = 'data-fw-recorder';

export function recorderPresent(root: Element = document.documentElement): boolean {
  return root.hasAttribute(RECORDER_STAMP);
}

/** Calls `onPresent` once when the stamp appears; returns the stop function. */
export function watchRecorder(onPresent: () => void, root: Element = document.documentElement): () => void {
  if (recorderPresent(root)) { onPresent(); return () => {}; }
  const observer = new MutationObserver(() => {
    if (!recorderPresent(root)) return;
    observer.disconnect();
    onPresent();
  });
  observer.observe(root, { attributes: true, attributeFilter: [RECORDER_STAMP] });
  return () => observer.disconnect();
}
