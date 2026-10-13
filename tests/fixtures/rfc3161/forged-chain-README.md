# Two deliberately forged time-stamp tokens with a broken chain

Made on 13 October 2026 with OpenSSL 3.5.5 after the cold audit of that day (finding 2: the chain
walk matched names and signatures but never asked whether an issuer was a certificate authority).
Nothing trusts either token. Both were stamped over the SHA-256 of the ASCII string
`issued under a non-CA certificate`, which is
`4f1e629aaccdda8554e30f9489695949c3ae2248ab8b78d8481c73d0a895974d`.

- `forged-nonca-issuer-resp.der`: root `CN=Test Root CA` (CA) signs `CN=Not A CA`
  (basicConstraints CA:FALSE, keyUsage digitalSignature), which signs the time-stamping
  certificate `CN=Test TSA`. Every signature in the chain verifies; the middle certificate may
  not issue certificates, so the chain must fail.
- `forged-expired-issuer-resp.der`: the same root signs `CN=Expired Intermediate CA` (a real CA,
  valid 2020-01-01 to 2021-01-01), which signs `CN=Test TSA`. The token's time is 13 October
  2026, outside the intermediate's validity, so the chain must fail.
