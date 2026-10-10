# What this record can establish, and what it cannot

For someone who has been handed a FeelingWise export, or who is reading this source to decide
whether the format is worth implementing against. It is the honest half of the specification: the
rest of `docs/spec/` says what the format holds and how it is checked, and this file says what a
checked file does and does not prove.

Nothing here is a disclaimer written by a lawyer. Each line is something a reader would otherwise
have to discover by testing the product, and several were discovered exactly that way.

## 1. What a passing check establishes

A file that the checker reads as verified establishes three things and no more.

- **Internal consistency.** Every record's content hashes to the hash stored on it, every record
  names the hash of the one before it, and the chain is unbroken across the records the file
  carries.
- **One signing key.** Every signature checks out under the public key embedded in the file, so
  all the records in it were signed by the holder of one private key on one computer.
- **A time it existed by,** where the file carries RFC 3161 tokens: an independent authority signed
  the chain head's hash at the time its certificate says, so the records up to that position
  existed in that form by then. The checker names the authority and says whether it recognises its
  root.

## 2. What it does not establish

- **Who made the file.** The key is generated on the device and nothing binds it to a person. A
  file says "one holder of this key", never "this person".
- **That the key is the original key.** A file built from a restored backup carries the key from
  that backup; a file built after a reset carries a new one. The export states which keys it holds
  and where each generation begins, and a reader can see a boundary, not who was on either side.
- **That the content was ever on the platform.** The recorder writes down what the page handed the
  browser it was running in. It does not fetch the item again, it does not ask the platform, and
  nothing in the file is a statement by the platform.
- **That the file is complete.** See section 3. A record of what one browser saw is not a record of
  what the feed served, and the file says so on its first page.
- **Admissibility anywhere.** Whether a court, a regulator or an employer accepts a file is a
  question about their rules, not about this format. The product makes no claim about it and the
  word evidence appears nowhere in what it prints.

## 3. What is missing from a record, by construction

- **Everything before the install.** The chain starts when the extension does.
- **Everything on a surface the recorder does not read.** Private messages, chats and any surface
  the extension deliberately refuses are never recorded. That refusal is not a gap in the record,
  it is the scope.
- **Stretches the recorder stood down for**, each one written into the chain as a gap marker with
  its reason and its size: a page producing DOM changes faster than any reader could follow, a tab
  left in the background whose queue the browser suspends, a memory ceiling, an extension update
  that orphaned the scripts in open tabs. A gap marker says a stretch is missing; it cannot say
  what was in it.
- **What the page never carried.** If an item's text was behind a control the recorder does not
  press, the record holds what the page carried and says so on the item.
- **An author the recorder refused.** Feeds reuse one slot for a new item while it is being read,
  so a name at the top of a card can belong to a different item than the words beneath it. When the
  recorder cannot show they belong together it records no name rather than the wrong one, and the
  record says that is what happened.

## 4. What the interpretation is, and is not

Some records carry a reading by a language model: a technique, a severity, a sentence about a
comment section. Read it as an opinion produced by a named model on a named date, never as a fact
about the item.

- A reading is **not reproducible**. The same text sent again can come back with another answer.
- A reading is **about form, not truth**. The model is asked what a text does, never whether it is
  true, and it is told to pass when unclear.
- A reading of a comment section is made from the comments the recorder actually read, which is
  often a handful. The number is printed beside every such reading. A label drawn from one or two
  comments is a label drawn from one or two comments.
- The measured rates for the instrument that ships are in `docs/METHODOLOGY.md` with the method
  that produced them. A number without its method is not usable, and the product never prints one.

## 5. What a second implementer should know

- The canonical hash is a JSON serialisation with a fixed key order; `verifier/FORMAT.md` holds the
  list and the rule that a new field is appended and never inserted, so a record written before a
  field existed hashes to exactly the same bytes afterwards. Every field carries the
  omit-when-undefined contract.
- `verifier/vectors/` holds valid and broken files with the verdict each must produce. A second
  checker that agrees with those vectors agrees with this one.
- The reference checker is `verifier/verify-export.mjs`, generated from source in this repository
  and readable as one file.

## 6. Where the rest is

- What the format holds and how it is read: the other files in `docs/spec/`.
- How the measured numbers were produced: `docs/METHODOLOGY.md`.
- What changed in each released version: `CHANGELOG.md`.

Comments in the source cite `docs/spec/known-issues.md` by entry number (M1, M2, and so on). That
is the working defect register, kept in the private repository because it is written in the
maintainer's own voice and quotes reports from named people. The entry numbers are stable
identifiers; what a reader of this copy needs from it is the list above, and anything found in this
source that this file does not cover is worth reporting rather than assuming.
