# Brand source marks

`mark.svg` and `wordmark.svg`, rescued 2026-08-22 from the retired `feelingwise-design`
skill, which was the only place they existed as files.

The app does not load these. `src/ui/shared/brand.tsx` draws the mark and wordmark as
inline React SVG, which is what ships. These two files are the standalone source, for a
store listing, a press image, or anything outside the extension. If the inline version in
`brand.tsx` ever changes, change these to match, or delete them rather than let a second
version of the mark drift into existence.

The skill they came from is retained byte-identical at
`.brain/archive/skills-retired-2026-08-22/feelingwise-design/`, and the reason it was
retired is in that folder's MANIFEST.
