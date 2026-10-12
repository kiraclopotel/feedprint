# Notes beside the licence

Feedprint (called FeelingWise Receipts until October 2026) and FeelingWise Off, the recorder and the filter built
from this tree, are free software: you can redistribute them and/or modify them under the terms of the GNU Affero
General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your
option) any later version. The full text is the file LICENSE, which names the copyright holder on its first line.

Two things sit outside that licence:

* The checker and the record format in verifier/ are Apache License 2.0 (verifier/LICENSE), so that a second
  implementer of the format, a court's expert or a company embedding the checker inherits no copyleft from the
  specification.

* The names "FeelingWise", "Feedprint", "Receipts" and "Off", the marks and the icons are not licensed (AGPL
  section 7(e) and Apache section 6). A fork must use its own name.

On authorship: the code in this tree is written by Claude, an AI model, under the copyright holder's direction;
README.md says which models and how. The licence is granted on whatever rights the copyright holder has in it.
What does not depend on the licence, and is what the recorder's claim rests on, is the reproducible build and the
published hash of every store upload (docs/spec/RELEASES.tsv).

Why these notes are not in LICENSE itself: a licence file that holds anything beyond the licence text and a
copyright line is not recognised as that licence by the tools that read repositories, so LICENSE carries only those.
