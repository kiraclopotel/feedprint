// Build verifier/vectors/CONTENT-IDENTITY.json, the conformance suite a second
// implementer diffs against to prove their reading of FORMAT.md section 9 agrees
// with ours.
//
//   npm run gen:ci-vectors
//
// It imports the shipped rule rather than restating it, so the published file
// cannot drift from the code by being edited or by being forgotten. That is
// belt and braces with tests/gates/content-identity-vectors.test.ts, which
// checks the written file against the same function: the generator makes drift
// impossible, the gate makes a stale file loud.

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentIdentity, CONTENT_IDENTITY_VERSION } from '../src/forensics/content-identity';

// One plausible post. The accented characters and the family emoji are not
// decoration: they are what make the unicode cases real rather than contrived.
const POST = 'Guvernul ascunde adevărul. Trezește-te 👨‍👩‍👧 înainte să fie prea târziu!';

/**
 * Every case sharing a `group` must produce one identity. Any two groups must
 * produce different ones, except the single collision declared in the file.
 *
 * The groups ending `-cut` and `-unjoined` are the important half: they are
 * differences this rule deliberately does NOT merge, because a false merge
 * manufactures corroboration that never happened.
 */
const CASES: ReadonlyArray<readonly [group: string, name: string, text: string]> = [
  ['romanian-post', 'the text as served', POST],
  ['romanian-post', 'decomposed accents (NFD)', POST.normalize('NFD')],
  ['romanian-post', 'a trailing newline', `${POST}\n`],
  ['romanian-post', 'surrounding whitespace', `   ${POST}  `],
  ['romanian-post', 'a non-breaking space', POST.replace(' ', ' ')],
  ['romanian-post', 'a Windows line ending', POST.replace('!', '!\r\n')],
  ['romanian-post', 'a tab for a space', POST.replace(' ', '\t')],
  ['romanian-post', 'a doubled space', POST.replace('. ', '.  ')],
  ['romanian-post', 'a zero-width space', POST.replace('a', '​a')],
  ['romanian-post', 'a byte-order mark', `﻿${POST}`],
  ['romanian-post', 'a soft hyphen inside a word', POST.replace('Guvernul', 'Guver­nul')],
  ['romanian-post', 'an ideographic space', POST.replace(' ', '　')],

  ['romanian-post-cut', 'the same post truncated at a fold', `${POST.slice(0, 40)}…`],
  ['romanian-post-unjoined', 'the same post with the emoji joiner dropped', POST.replace(/‍/g, '')],

  ['paragraphs', 'two paragraphs', 'First line.\n\nSecond line.'],
  ['paragraphs', 'four blank lines between them', 'First line.\n\n\n\n\nSecond line.'],
  ['paragraphs', 'trailing spaces on each line', 'First line.   \n\n   Second line.  '],

  ['lowercase-claim', 'lower case', 'they are lying to you'],
  ['uppercase-claim', 'upper case, which is a different text', 'THEY ARE LYING TO YOU'],

  ['straight-quote', 'a straight apostrophe', "it's over"],
  ['curly-quote', 'a curly apostrophe, which is a different text', 'it’s over'],

  ['persian-zwnj', 'a non-joiner that shapes the letters', 'می‌روم'],
  ['persian-joined', 'the same letters without it, a different word', 'میروم'],

  ['empty', 'nothing at all', ''],
  ['whitespace-only', 'whitespace only, which normalises to nothing', '   \n\n  \t '],
];

async function main(): Promise<void> {
  const vectors = [];
  for (const [group, name, text] of CASES) {
    vectors.push({ group, name, text, identity: await contentIdentity(text) });
  }

  // The contract is checked here before the file is written, so a broken suite is
  // never published. The gate test checks the same thing from the other side.
  const byGroup = new Map<string, Set<string>>();
  for (const v of vectors) {
    if (!byGroup.has(v.group)) byGroup.set(v.group, new Set());
    byGroup.get(v.group)!.add(v.identity);
  }
  for (const [group, identities] of byGroup) {
    if (identities.size !== 1) throw new Error(`group ${group} produced ${identities.size} identities`);
  }
  const perGroup = [...byGroup.values()].map((s) => [...s][0]);
  const collisions = byGroup.size - new Set(perGroup).size;
  if (collisions !== 1) {
    throw new Error(`expected exactly one declared cross-group collision, found ${collisions}`);
  }

  const out = {
    rule: CONTENT_IDENTITY_VERSION,
    what: 'Conformance vectors for the content identity rule in FORMAT.md section 9.',
    contract: [
      'Every vector sharing a `group` MUST produce the identity given.',
      'Vectors in different groups MUST produce different identities, with one stated exception: `empty` and `whitespace-only` both normalise to the empty string and therefore share an identity.',
      'An identity is the literal string `fw-ci-1:` followed by the lowercase hex SHA-256 of the UTF-8 bytes of the normal form.',
    ],
    limits: [
      'An identity says two observers recorded the same text. It does not say either of them saw it on a platform, and it is not by itself evidence that anything was served.',
      'A group ending `-cut` or `-unjoined` is a difference this rule deliberately does NOT merge, because a false merge manufactures corroboration. See FORMAT.md section 9.',
      'Identical short text from different people produces one identity, by definition. Corroboration on very short text is weak.',
    ],
    vectors,
  };

  const path = resolve(dirname(fileURLToPath(import.meta.url)), '../verifier/vectors/CONTENT-IDENTITY.json');
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(`[content-identity-vectors] wrote ${vectors.length} vectors in ${byGroup.size} groups`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
