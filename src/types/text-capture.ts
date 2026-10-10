// TextCapture: the shape, with no behavior attached.
//
// It was declared in src/types/forensic.ts, and src/types/messages.ts imported it from there, which made the
// types layer depend on a layer above it (PLAN-2026-09-16 item 8.6). The module keeps its logic and
// re-exports this name, so nothing that imports it had to change.

/**
 * What the page carried against what the screen showed for an item's text.
 * See `ForensicRecord.textCapture` and docs/design/TEXT-CAPTURE-2026-09-05.md.
 */
export type TextCapture = 'whole' | 'folded' | 'cut' | 'platform';
// 'platform' (since 2026-09-17, PLAN-2026-09-17 item 6): the page carried no text for the item and
// the text on the record is the caption the platform's own data sent for it, filled by
// src/content/page-world/wire-store.ts. A reader must know it was not read off the screen.
