# Instagram: a post opened by its link

`post-by-link-1.html` and `post-by-link-2.html` are two public posts opened by their link, signed out, saved by the
Tester on 11 Oct 2026 (`crew/tester/ig-post-tree-1.html` and `-2.html`, an outline of the page with every text
replaced by its length) and turned back into HTML with `from-tree.mjs`:

- the tags, their nesting, `role`, `dir`, `href`, `datetime`, `aria-label`, `alt` and the Tester's own `data-tester-*`
  marks are the page's; classes, styles and sources are dropped;
- each text is filled to its recorded length: words for a caption or a comment, a handle-like word inside a link;
- an address keeps its kind and length (a comment's own link is `/p/<code>/c/<17 digits>/`, a profile link is
  `/<name>/`);
- the page's small words keep their real kind, because the reader tells chrome from a comment by what it says: "Reply"
  and "Like" in buttons, an age such as "12h" in a time.

The Tester's marks name the caption (`data-tester-caption-text`). Its comment marks are a guess and are not used.

To use a new tree: `node tests/fixtures/instagram/from-tree.mjs <tree.html> <out.html>`.
