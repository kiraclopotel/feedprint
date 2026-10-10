# A deliberately forged time-stamp token

`forged-selfminted-resp.der` is NOT from any real authority. It was made on 2026-09-04 with
OpenSSL in about a minute: a self-signed certificate authority whose subject reads
`C=US, O=DigiCert Inc, CN=DigiCert Trusted Root G4`, a time-stamping certificate issued under
it, and a token signed over a hash chosen by whoever made it. Nothing trusts it and nothing
can. It exists so a test can prove what FeelingWise does when handed one.

It is here because an audit of `src/forensics/rfc3161.ts` on 2026-09-04 built exactly this and
the verifier returned ok: true. It still does, and that is deliberate: a token from an
authority we have not met is not automatically a forgery, and failing every one of them would
be wrong. What changed is what consumes the verdict.

- `src/forensics/tsa-client.ts` refuses to STORE an anchor that does not chain to a pinned
  certificate. The client asked one of the authorities whose certificates it pins, so a token
  chaining anywhere else is not from the authority that was asked.
- The export prints a third headline for it rather than "every check passed", and says that
  anyone can run a timestamping service and sign their own tokens.

The token was stamped over the SHA-256 of the ASCII string `attacker chose this`, which is
`f234ff9e567d48d727a2849d07276ef32ec3f8c088aa850842b883ccbb817cde`.
