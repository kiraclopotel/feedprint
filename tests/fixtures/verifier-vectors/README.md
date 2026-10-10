# Fixture keys

`keys.json` (own, old, substituted) and `example-key.json` hold P-256 key pairs, private halves included, made
for these files. No build ships their private halves.

- `keys.json` signs the checker's vectors (`scripts/build-verifier-vectors.ts`), so that a rebuild moves only the
  signatures and a wording change can be reviewed by its diff.
- `example-key.json` signs the small example export (`landing/example-export.html`, built by
  `scripts/build-demo-export.ts`), for the same reason.

The full demo (`example-export-full.html`) is signed by a second key, kept inside `scripts/build-demo-export.ts`
as its fallback key, with its own note there.

A record signed by one of these keys proves nothing about who made it: anyone who reads this folder can sign with
them. That is what a test key is for.

Each file's own `note` names the commit that generated it and what it signs.
